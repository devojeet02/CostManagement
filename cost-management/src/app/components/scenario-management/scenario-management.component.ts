import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SelectGroup } from '../../features/cm-hierarchy-select/cm-hierarchy-select.component';
import { LoaderService } from '../../features/loader/loader.service';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { MasterDataService, LookupItemDto } from '../../services/master-data.service';
import { CostCenterDashboardService, CostCenterRowDto, ScenarioYearColumn } from '../../services/cost-center-dashboard.service';
import { ForecastService } from '../../services/forecast.service';
import { UserPreferenceService } from '../../services/user-preference.service';

/** CCM-051: element-wise sum of two 12-month arrays (either may be absent). */
function sumMonthly(a: number[] | undefined, b: number[] | undefined): number[] {
  const result = new Array(12).fill(0);
  for (let m = 0; m < 12; m++) result[m] = (a?.[m] ?? 0) + (b?.[m] ?? 0);
  return result;
}

export interface Scenario {
  /** "{ScenarioCode}-{Year}", e.g. "ACT-2025" — matches the backend's column key format directly. */
  id: string;
  /** Scenario code, e.g. "ACT", "RFC1", "RFC3" — shown as the short column label. */
  code: string;
  /** tblCMScenario.ScenarioType, e.g. "Actual" / "Forecast" / "Budget". */
  scenarioType: string;
  year: number;
  displayName: string;
  /** Reporting scenarios (RFC/Budget) are read-only by default per RFP §8.2. */
  locked: boolean;
}

export interface VarianceColumn {
  id: string;
  label: string;
  compareLeft: string;  // scenarioId
  compareRight: string; // scenarioId
}

/** CCM-049: the shape saved into tblCMUserPreference.ConfigJson for this screen. The backend never parses this — it is opaque JSON to it — so this interface is the only place its shape is defined; keep it in sync with what applySavedLayout/saveLayout actually read and write. */
interface SavedScenarioLayout {
  /** Every scenario id, in the user's drag-reordered display order (not just the visible ones — a hidden column keeps its place in line so re-ticking it doesn't jump it to the end). */
  columnOrder: string[];
  visibleColumns: string[];       // scenario ids, e.g. "ACT-2025"
  varianceCols: VarianceColumn[];
  selectedSite: string;
  selectedTeam: string;
}

export interface CostRow {
  id: string;
  account: string;
  spendType?: string;
  spendLayer?: string;
  category?: string;
  system?: string;
  supplier?: string;
  internalOrder?: string;
  itemDescription?: string;
  isParent: boolean;
  isExpandable: boolean;
  children?: CostRow[];
  values: { [scenarioId: string]: number };
  /** CCM-051: 12 monthly running totals (Jan..Dec), keyed like `values` — only present for non-Actual (Forecast/Budget) scenario columns. */
  cumulativeVariance?: { [scenarioId: string]: number[] };
}

@Component({
  selector: 'app-scenario-management',
  templateUrl: './scenario-management.component.html',
  styleUrls: ['./scenario-management.component.scss']
})
export class ScenarioManagementComponent implements OnInit, AfterViewInit, OnDestroy {

  /** Theme custom properties the overlay's styles read. Copied on at move time: moving the node to <body> severs the inheritance from `.cm-root` and the card renders transparent. */
  private static readonly THEME_VARS = [
    '--bg-card', '--bg-hover', '--bg-input',
    '--border-color', '--border-active',
    '--text-heading', '--text-primary', '--text-muted',
    '--accent-color', '--transition-speed',
  ];

  /** The overlay once moved, so it can be returned before Angular tears it down. */
  private movedOverlay: HTMLElement | null = null;

  /** Portals the overlay to <body> so it dims the WHOLE window, sidenav and top bar included. ⚠️ NOT a z-index problem — see cm-modal's `attachToBody` for why raising one cannot work. */
  @ViewChild('scenarioOverlay')
  set scenarioOverlay(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (el && el.parentElement !== document.body) {
      const inherited = getComputedStyle(this.hostEl.nativeElement);
      for (const name of ScenarioManagementComponent.THEME_VARS) {
        const value = inherited.getPropertyValue(name).trim();
        if (value) el.style.setProperty(name, value);
      }
      document.body.appendChild(el);
      this.movedOverlay = el;
    } else if (!el) {
      this.movedOverlay = null;
    }
  }

  /** ⚠️ Put the node back before *ngIf drops it (Angular asks the RECORDED parent), and on destroy, or it is stranded on <body>. */
  private restoreOverlay(): void {
    const el = this.movedOverlay;
    if (el && el.parentElement === document.body) {
      this.hostEl.nativeElement.appendChild(el);
    }
    this.movedOverlay = null;
  }


  /** Cancels in-flight requests when the screen is torn down. Without it a fetch started here outlives the screen: navigate away mid-load and the wait it registered with LoaderService stays open, so the NEXT screen shows a spinner for a request that is no longer anyone's. Unsubscribing also fires track()'s finalize, which releases it. */
  private readonly destroy$ = new Subject<void>();

  @ViewChild('metadataPane') metadataPaneRef!: ElementRef<HTMLElement>;
  @ViewChild('scenariosPane') scenariosPaneRef!: ElementRef<HTMLElement>;

  /** CCM-049: key this screen's saved layout is stored under (one row per user+screen). */
  private readonly SCREEN_KEY = 'ScenarioManagement';

  constructor(
    private snackbar: SnackbarService,
    private masterDataService: MasterDataService,
    private dashboardService: CostCenterDashboardService,
    private forecastService: ForecastService,
    private loader: LoaderService,
    private userPreferenceService: UserPreferenceService,
    private hostEl: ElementRef<HTMLElement>
  ) {}

  // ── Site / Team filters — populated from GET /api/MasterData/sites|teams ──
  sites: string[] = ['All Sites'];
  teams: string[] = ['All Teams'];
  selectedSite = 'All Sites';
  selectedTeam = 'All Teams';

  hoveredRowId: string | null = null;

  // ── Scenario columns — populated from GET /api/MasterData/scenarios ──
  scenarios: Scenario[] = [];

  // ── CCM-047: Column Picker — which scenario columns are actually shown. Defaults to "all" (matches the screen's pre-CCM-047 behaviour) unless CCM-049 restores a saved subset. ──
  visibleScenarioIds = new Set<string>();
  showColumnPicker = false;

  get visibleScenarios(): Scenario[] {
    return this.scenarios.filter(s => this.visibleScenarioIds.has(s.id));
  }

  // ── CCM-048: Variance comparison columns — user-managed (add/remove any two financial columns). Seeded with the old V1/V2 auto-derivation as the out-of-the-box default; CCM-049 then persists whatever the user actually builds on top of that. ──
  varianceCols: VarianceColumn[] = [];
  showVarianceBuilder = false;
  newVarianceLeft = '';
  newVarianceRight = '';
  private nextVarianceColId = 1;

  showAddScenarioModal = false;
  newScenarioCode = '';
  /** Blank so the field opens on its placeholder and the type is a deliberate choice. */
  newScenarioType = '';
  newScenarioYear = 2026;
  /** Which existing scenario's forecast entries to copy into the new one. Empty = start blank. */
  copyFromScenarioId = '';
  readonly years = [2024, 2025, 2026, 2027, 2028];

  /** The three the screen has always suggested; kept even when no scenario uses them yet. */
  private static readonly BASE_SCENARIO_TYPES = ['Forecast', 'Budget', 'Actual'];

  /** Options behind the Scenario Type combo. A FIELD, not a getter. cm-hierarchy-select memoises its filtering on the IDENTITY of the array passed to [groups]; a getter would hand it a new array every change-detection pass, so the memo would never hit and the option elements would be torn down and rebuilt each time - and an option rebuilt between mousedown and mouseup never fires a click at all. */
  scenarioTypeGroups: SelectGroup[] = ScenarioManagementComponent.buildTypeGroups([]);
  isSavingScenario = false;
  // No real auth wired up yet — mirrors invoice-upload.component.ts's autoStamp.user mock.
  private readonly currentUser = 'Devojeet Modak';

  draggedScenarioId: string | null = null;
  dragOverScenarioId: string | null = null;

  costRows: CostRow[] = [];
  /** Starts true so the spinner is up on entry rather than the grid flashing empty first. */
  isLoadingRows = true;

  ngOnInit(): void {
    this.loadFilters();
    this.loadScenarios();
  }

  ngAfterViewInit(): void {
    this.setupScrollSync();
  }

  ngOnDestroy(): void {
    this.restoreOverlay();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Mirrors vertical scroll between the fixed metadata pane and the scrollable scenarios pane. */
  private setupScrollSync(): void {
    const meta = this.metadataPaneRef?.nativeElement;
    const scen = this.scenariosPaneRef?.nativeElement;
    if (!meta || !scen) return;

    scen.addEventListener('scroll', () => { meta.scrollTop = scen.scrollTop; });
    meta.addEventListener('scroll', () => { scen.scrollTop = meta.scrollTop; });
  }

  private loadFilters(): void {
    this.masterDataService.getSites().subscribe({
      next: rows => this.sites = ['All Sites', ...rows.map(r => r.code ?? r.name)],
      error: err => console.error('Failed to load sites', err)
    });
    this.masterDataService.getTeams().subscribe({
      next: rows => this.teams = ['All Teams', ...rows.map(r => r.code ?? r.name)],
      error: err => console.error('Failed to load teams', err)
    });
  }

  /** Loads real scenarios from tblCMScenario, then restores (or defaults) the column-picker / variance-builder layout before loading the grid data. */
  private loadScenarios(): void {
    this.masterDataService.getScenarios().subscribe({
      next: (rows: LookupItemDto[]) => {
        this.scenarios = rows
          .filter(r => r.code && r.year)
          .map(r => ({
            id: `${r.code}-${r.year}`,
            code: r.code!,
            scenarioType: r.name,
            year: r.year!,
            displayName: `${r.code} ${r.year}`,
            locked: r.isReadOnly ?? false
          }))
          .sort((a, b) => a.year - b.year);

        // Offer the types already in use alongside the three defaults, rebuilt once per load.
        this.scenarioTypeGroups = ScenarioManagementComponent.buildTypeGroups(this.scenarios);
        this.loadSavedLayout();
      },
      error: err => {
        // Without this the spinner would spin forever: loadCostRows() is never reached, so nothing else clears the flag the template is now bound to.
        console.error('Failed to load scenarios', err);
        this.isLoadingRows = false;
      }
    });
  }

  /** Distinct scenario types, defaults first, de-duplicated case-insensitively so a stored "forecast" does not sit in the list beside "Forecast". */
  private static buildTypeGroups(scenarios: Scenario[]): SelectGroup[] {
    const byKey = new Map<string, string>();
    ScenarioManagementComponent.BASE_SCENARIO_TYPES.forEach(t => byKey.set(t.toLowerCase(), t));
    scenarios.forEach(s => {
      const t = (s.scenarioType ?? '').trim();
      if (t && !byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t);
    });
    return [{ group: 'Scenario Type', items: [...byKey.values()].map(t => ({ value: t, label: t })) }];
  }

  /** CCM-049 AC#1-2: restores the caller's saved layout (visible columns, variance pairs, Site/Team filters) if one exists; otherwise falls back to the pre-CCM-047/048 defaults (every column visible, the old auto-derived V1/V2 variance pair). Either way, the grid data load always follows — never left waiting on this call. */
  private loadSavedLayout(): void {
    // UserPreferenceService.get() never errors out to its caller — a fetch failure resolves to null, same as "nothing saved yet" (see the service for why) — so there is only one path here.
    this.userPreferenceService.get(this.SCREEN_KEY, this.currentUser).subscribe(saved => {
      if (saved) {
        this.applySavedLayout(saved);
      } else {
        this.applyDefaultLayout();
      }
      this.loadCostRows();
    });
  }

  private applyDefaultLayout(): void {
    this.visibleScenarioIds = new Set(this.scenarios.map(s => s.id));
    this.varianceCols = this.buildVarianceColumns(this.scenarios);
    this.selectedSite = 'All Sites';
    this.selectedTeam = 'All Teams';
  }

  private applySavedLayout(configJson: string): void {
    try {
      const cfg = JSON.parse(configJson) as SavedScenarioLayout;
      const knownIds = new Set(this.scenarios.map(s => s.id));

      // Reorder scenarios to match the saved drag order; anything saved-but-now-missing is dropped, and anything new since the save (not in the saved order at all) is appended in its natural (year-sorted) position rather than lost.
      if (cfg.columnOrder?.length) {
        const byId = new Map(this.scenarios.map(s => [s.id, s]));
        const ordered = cfg.columnOrder.map(id => byId.get(id)).filter((s): s is Scenario => !!s);
        const orderedIds = new Set(ordered.map(s => s.id));
        this.scenarios = [...ordered, ...this.scenarios.filter(s => !orderedIds.has(s.id))];
      }

      // A saved id/pair that no longer resolves (a scenario was deleted since) is dropped rather than left dangling — silently, since there is nothing actionable to tell the user beyond "your saved view referenced something that no longer exists".
      const visible = (cfg.visibleColumns ?? []).filter(id => knownIds.has(id));
      this.visibleScenarioIds = new Set(visible.length > 0 ? visible : this.scenarios.map(s => s.id));

      this.varianceCols = (cfg.varianceCols ?? [])
        .filter(v => knownIds.has(v.compareLeft) && knownIds.has(v.compareRight));
      this.nextVarianceColId = this.varianceCols.length + 1;

      // Not gated on `sites`/`teams` already being loaded — loadFilters() runs independently and may not have resolved yet at this point. The <select>'s ngModel binding self-heals once its <option> list populates, so setting the value now (even "early") is safe; gating on `.includes()` here would risk silently dropping a perfectly valid saved value just because of load-order timing.
      if (cfg.selectedSite) this.selectedSite = cfg.selectedSite;
      if (cfg.selectedTeam) this.selectedTeam = cfg.selectedTeam;
    } catch (e) {
      console.error('Saved layout was corrupt — falling back to defaults', e);
      this.applyDefaultLayout();
    }
  }

  /** CCM-049 AC#1: fires after every layout-affecting change — see class remarks on why this is simpler and more reliable than trying to hook a single "on exit" moment in an SPA. */
  private saveLayout(): void {
    const cfg: SavedScenarioLayout = {
      columnOrder: this.scenarios.map(s => s.id),
      visibleColumns: Array.from(this.visibleScenarioIds),
      varianceCols: this.varianceCols,
      selectedSite: this.selectedSite,
      selectedTeam: this.selectedTeam
    };
    this.userPreferenceService.save(this.SCREEN_KEY, this.currentUser, JSON.stringify(cfg))
      .subscribe({ error: err => console.error('Failed to save screen layout', err) });
  }

  /** CCM-049 AC#4. */
  resetToDefault(): void {
    this.userPreferenceService.reset(this.SCREEN_KEY, this.currentUser).subscribe({
      next: () => {
        this.applyDefaultLayout();
        this.loadCostRows();
        this.snackbar.show('View reset to default.', 'success');
      },
      error: err => {
        console.error('Failed to reset layout', err);
        this.snackbar.show('Failed to reset the view.', 'error');
      }
    });
  }

  /** Out-of-the-box default (first-ever visit / Reset to Default, CCM-049 AC#4): the two most recent non-Actual (RFC/Budget) scenarios compared, plus most recent Actual vs. most recent RFC/Budget. The user is free to remove either or add more via the CCM-048 builder below. */
  private buildVarianceColumns(scenarios: Scenario[]): VarianceColumn[] {
    const reporting = scenarios.filter(s => s.scenarioType.toLowerCase() !== 'actual');
    const actuals = scenarios.filter(s => s.scenarioType.toLowerCase() === 'actual');
    const cols: VarianceColumn[] = [];

    if (reporting.length >= 2) {
      const [left, right] = reporting.slice(-2);
      cols.push({ id: 'v1', label: this.varianceLabel(right, left), compareLeft: right.id, compareRight: left.id });
    }
    if (actuals.length >= 1 && reporting.length >= 1) {
      const latestActual = actuals[actuals.length - 1];
      const latestReporting = reporting[reporting.length - 1];
      cols.push({ id: 'v2', label: this.varianceLabel(latestActual, latestReporting), compareLeft: latestActual.id, compareRight: latestReporting.id });
    }
    this.nextVarianceColId = cols.length + 1;
    return cols;
  }

  /** CCM-048 AC#5: "clearly labelled (e.g. 'Budget 2026 vs RFC1 2026')" — left minus right, in the same order the value is computed (getVarianceValue). */
  private varianceLabel(left: Scenario, right: Scenario): string {
    return `${left.code} ${left.year} vs ${right.code} ${right.year}`;
  }

  toggleColumnPicker(): void {
    this.showColumnPicker = !this.showColumnPicker;
  }

  isColumnVisible(scenarioId: string): boolean {
    return this.visibleScenarioIds.has(scenarioId);
  }

  /** AC#4: user can add/remove columns freely. At least one column must stay visible — an empty grid isn't a meaningful state and every *ngFor colspan in the template assumes scenarios.length or visibleScenarios.length is nonzero. */
  toggleColumnVisibility(scenarioId: string): void {
    if (this.visibleScenarioIds.has(scenarioId)) {
      if (this.visibleScenarioIds.size === 1) {
        this.snackbar.show('At least one column must stay visible.', 'warning');
        return;
      }
      this.visibleScenarioIds.delete(scenarioId);
    } else {
      this.visibleScenarioIds.add(scenarioId);
    }
    this.saveLayout();
  }

  toggleVarianceBuilder(): void {
    this.showVarianceBuilder = !this.showVarianceBuilder;
    this.newVarianceLeft = '';
    this.newVarianceRight = '';
  }

  addVarianceColumn(): void {
    if (!this.newVarianceLeft || !this.newVarianceRight) {
      this.snackbar.show('Pick both columns to compare.', 'warning');
      return;
    }
    if (this.newVarianceLeft === this.newVarianceRight) {
      this.snackbar.show('Pick two different columns.', 'warning');
      return;
    }
    const left = this.scenarios.find(s => s.id === this.newVarianceLeft);
    const right = this.scenarios.find(s => s.id === this.newVarianceRight);
    if (!left || !right) return;

    this.varianceCols.push({
      id: `vc-${this.nextVarianceColId++}`,
      label: this.varianceLabel(left, right),
      compareLeft: left.id,
      compareRight: right.id
    });
    this.newVarianceLeft = '';
    this.newVarianceRight = '';
    this.saveLayout();
  }

  /** AC#6: variance columns can be removed individually. */
  removeVarianceColumn(id: string): void {
    this.varianceCols = this.varianceCols.filter(v => v.id !== id);
    this.saveLayout();
  }

  /** Calls the backend for every loaded scenario column, filtered by the current Site/Team selection. */
  private loadCostRows(): void {
    if (this.scenarios.length === 0) { this.costRows = []; this.isLoadingRows = false; return; }

    const columns: ScenarioYearColumn[] = this.scenarios.map(s => ({ scenario: s.code, year: s.year }));
    const site = this.selectedSite === 'All Sites' ? null : this.selectedSite;
    const team = this.selectedTeam === 'All Teams' ? null : this.selectedTeam;

    // track() shows/hides via finalize, so it also unwinds on error and on unsubscribe. The anchored <cm-loader> in the template renders it inside the grid area instead of as the shell's overlay card. isLoadingRows stays as the flag that hides the grid underneath.
    this.isLoadingRows = true;
    this.dashboardService.get(site, team, columns).pipe(
      this.loader.track('Loading cost centre data…'),
      takeUntil(this.destroy$)
    ).subscribe({
      next: res => {
        this.costRows = this.groupByAccount(res.rows);
        this.isLoadingRows = false;
      },
      error: err => {
        console.error('Failed to load cost center dashboard data', err);
        this.costRows = [];
        this.isLoadingRows = false;
      }
    });
  }

  /** Groups the backend's flat line rows into Account parent rows with children, matching the grid's layout. */
  private groupByAccount(rows: CostCenterRowDto[]): CostRow[] {
    const groups = new Map<string, CostRow>();

    rows.forEach((r, i) => {
      const accountKey = r.account ?? '(No Account)';
      let parent = groups.get(accountKey);
      if (!parent) {
        parent = { id: accountKey, account: accountKey, isParent: true, isExpandable: true, children: [], values: {} };
        groups.set(accountKey, parent);
      }
      parent.children!.push({
        id: `${accountKey}-${i}`,
        account: '',
        spendType: r.spendType ?? undefined,
        spendLayer: r.spendLayer ?? undefined,
        category: r.category ?? undefined,
        system: r.system ?? undefined,
        supplier: r.supplier ?? undefined,
        internalOrder: r.internalOrder ?? undefined,
        itemDescription: r.itemDescription ?? undefined,
        isParent: false,
        isExpandable: false,
        values: r.values,
        cumulativeVariance: r.cumulativeVariance
      });
    });

    const result = Array.from(groups.values());
    this.calculateParentTotals(result);
    return result;
  }

  private calculateParentTotals(rows: CostRow[]): void {
    for (const row of rows) {
      if (row.isParent && row.isExpandable && row.children) {
        row.values = {};
        row.cumulativeVariance = {};
        for (const child of row.children) {
          for (const scenarioId in child.values) {
            row.values[scenarioId] = (row.values[scenarioId] || 0) + child.values[scenarioId];
          }
          for (const scenarioId in child.cumulativeVariance) {
            row.cumulativeVariance[scenarioId] = sumMonthly(
              row.cumulativeVariance[scenarioId], child.cumulativeVariance[scenarioId]);
          }
        }
      }
    }
  }

  /** Filtering now happens server-side (Site/Team are query params) — this just re-fetches. */
  onFilterChange(): void {
    this.loadCostRows();
    this.saveLayout();
  }

  get filteredCostRows(): CostRow[] {
    return this.costRows;
  }

  getRowValue(row: CostRow, scenarioId: string): number {
    return row.values[scenarioId] || 0;
  }

  getVarianceValue(row: CostRow, col: VarianceColumn): number {
    return (row.values[col.compareLeft] || 0) - (row.values[col.compareRight] || 0);
  }

  /** RFP rule (§6, §10): more spend (positive) is unfavorable → red; zero or less is favorable → green. */
  getVarianceBadgeClass(row: CostRow, col: VarianceColumn): string {
    return this.getVarianceValue(row, col) > 0 ? 'variance-badge unfavorable' : 'variance-badge favorable';
  }

  getFormattedVariance(row: CostRow, col: VarianceColumn): string {
    const diff = this.getVarianceValue(row, col);
    const formatted = Math.abs(diff / 1000).toFixed(0);
    return diff > 0 ? `+${formatted}` : `-${formatted}`;
  }

  getColumnTotal(scenarioId: string): number {
    return this.filteredCostRows
      .filter(row => row.isParent)
      .reduce((sum, row) => sum + (row.values[scenarioId] || 0), 0);
  }

  getVarianceColumnTotal(col: VarianceColumn): number {
    return this.filteredCostRows
      .filter(row => row.isParent)
      .reduce((sum, row) => sum + this.getVarianceValue(row, col), 0);
  }

  getVarianceTotalBadgeClass(col: VarianceColumn): string {
    return this.getVarianceColumnTotal(col) > 0 ? 'variance-badge unfavorable' : 'variance-badge favorable';
  }

  getFormattedVarianceTotal(col: VarianceColumn): string {
    const diff = this.getVarianceColumnTotal(col);
    const formatted = Math.abs(diff / 1000).toFixed(0);
    return diff > 0 ? `+${formatted}` : `-${formatted}`;
  }

  // ── CCM-051: Cumulative Variance row (Jan..Dec running total per scenario column) ──
  readonly monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /** Only Forecast/Budget columns carry a cumulative variance — Actual has nothing to compare itself to. */
  hasCumulativeVariance(scenario: Scenario): boolean {
    return scenario.scenarioType?.toLowerCase() !== 'actual';
  }

  getCumulativeVarianceMonthly(row: CostRow, scenarioId: string): number[] {
    return row.cumulativeVariance?.[scenarioId] ?? new Array(12).fill(0);
  }

  /** RFP/AC#5: positive cumulative variance (spend running ahead of forecast) is red; zero/negative is green. */
  getCumVarBadgeClass(value: number): string {
    return value > 0 ? 'variance-badge unfavorable' : 'variance-badge favorable';
  }

  getFormattedCumVar(value: number): string {
    const formatted = Math.abs(value / 1000).toFixed(0);
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  }

  getCumulativeVarianceTotal(scenarioId: string): number[] {
    return this.filteredCostRows
      .filter(row => row.isParent)
      .reduce((sum: number[], row) => sumMonthly(sum, this.getCumulativeVarianceMonthly(row, scenarioId)), new Array(12).fill(0));
  }

  // ── Prepare a scenario (RFP §8.1) Creates the tblCMScenario row, then — if a source was picked — copies every forecast entry (keys/metadata + values) from that scenario into the new one, via POST /api/Forecast/copy-scenario.

  openAddScenario(): void {
    this.newScenarioCode = '';
    this.newScenarioType = '';
    this.newScenarioYear = 2026;
    this.copyFromScenarioId = this.scenarios[this.scenarios.length - 1]?.code ?? '';
    this.showAddScenarioModal = true;
  }

  /** Closes only when the backdrop itself was clicked, not when the click came from inside the card. */
  onModalBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeAddScenario();
  }

  closeAddScenario(): void {
    this.showAddScenarioModal = false;
  }

  addScenario(): void {
    if (!this.newScenarioCode.trim()) {
      this.snackbar.show('Scenario code is required.', 'error');
      return;
    }
    // Required now that the field starts blank: it is saved as the scenario's name, and an empty one would leave an unlabelled scenario in the list.
    if (!this.newScenarioType.trim()) {
      this.snackbar.show('Scenario type is required.', 'error');
      return;
    }
    if (this.scenarios.some(s => s.code === this.newScenarioCode && s.year === this.newScenarioYear)) {
      this.snackbar.show(`${this.newScenarioCode} ${this.newScenarioYear} already exists.`, 'warning');
      return;
    }

    this.isSavingScenario = true;
    this.masterDataService.addScenario({
      code: this.newScenarioCode,
      name: this.newScenarioType,
      lastUpdatedBy: this.currentUser
    }).subscribe({
      next: () => {
        if (!this.copyFromScenarioId) {
          this.isSavingScenario = false;
          this.closeAddScenario();
          this.snackbar.show(`${this.newScenarioCode} ${this.newScenarioYear} created (blank).`, 'success');
          this.loadScenarios();
          return;
        }

        this.forecastService.copyScenario(this.copyFromScenarioId, this.newScenarioCode, this.currentUser).subscribe({
          next: res => {
            this.isSavingScenario = false;
            this.closeAddScenario();
            this.snackbar.show(
              `${this.newScenarioCode} ${this.newScenarioYear} created — copied ${res.linesCopied} line(s) from ${this.copyFromScenarioId}.`,
              'success'
            );
            this.loadScenarios();
          },
          error: err => {
            this.isSavingScenario = false;
            this.closeAddScenario();
            this.snackbar.show(
              `${this.newScenarioCode} created, but copying from ${this.copyFromScenarioId} failed — ${err?.error?.error ?? err?.message ?? 'unknown error'}`,
              'warning'
            );
            this.loadScenarios();
          }
        });
      },
      error: err => {
        this.isSavingScenario = false;
        this.snackbar.show(`Failed to create scenario — ${err?.error?.error ?? err?.message ?? 'unknown error'}`, 'error');
      }
    });
  }

  // ── Column drag-reorder CCM-047: the header now iterates visibleScenarios, not scenarios directly, so a plain *ngFor index no longer maps 1:1 onto this.scenarios (hidden columns sit interspersed in it). Identity (scenario id) is used instead — robust regardless of what is currently ticked visible.

  onDragStart(event: DragEvent, scenario: Scenario): void {
    this.draggedScenarioId = scenario.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', scenario.id);
    }
  }

  onDragOver(event: DragEvent, scenario: Scenario): void {
    event.preventDefault();
    if (this.draggedScenarioId !== null && this.draggedScenarioId !== scenario.id) {
      this.dragOverScenarioId = scenario.id;
    }
  }

  onDrop(event: DragEvent, target: Scenario): void {
    event.preventDefault();
    if (this.draggedScenarioId !== null && this.draggedScenarioId !== target.id) {
      const fromIdx = this.scenarios.findIndex(s => s.id === this.draggedScenarioId);
      if (fromIdx !== -1) {
        const [dragged] = this.scenarios.splice(fromIdx, 1);
        // Recompute target's index — it shifted if the drag source was before it.
        const toIdx = this.scenarios.findIndex(s => s.id === target.id);
        this.scenarios.splice(toIdx === -1 ? this.scenarios.length : toIdx, 0, dragged);
        this.saveLayout();
      }
    }
    this.onDragEnd();
  }

  onDragEnd(): void {
    this.draggedScenarioId = null;
    this.dragOverScenarioId = null;
  }
}
