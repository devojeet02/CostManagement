import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { forkJoin } from 'rxjs';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { LoaderService } from '../../features/loader/loader.service';
import { MasterDataService, LookupItemDto } from '../../services/master-data.service';
import { CostCenterDashboardService, CostCenterRowDto, ScenarioYearColumn } from '../../services/cost-center-dashboard.service';
import { ForecastService } from '../../services/forecast.service';

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
}

@Component({
  selector: 'app-scenario-management',
  templateUrl: './scenario-management.component.html',
  styleUrls: ['./scenario-management.component.scss']
})
export class ScenarioManagementComponent implements OnInit, AfterViewInit {

  @ViewChild('metadataPane') metadataPaneRef!: ElementRef<HTMLElement>;
  @ViewChild('scenariosPane') scenariosPaneRef!: ElementRef<HTMLElement>;

  constructor(
    private snackbar: SnackbarService,
    private masterDataService: MasterDataService,
    private dashboardService: CostCenterDashboardService,
    private forecastService: ForecastService,
    private loader: LoaderService
  ) {}

  // ── Site / Team filters — populated from GET /api/v1/master/sites|teams ──
  sites: string[] = ['All Sites'];
  teams: string[] = ['All Teams'];
  selectedSite = 'All Sites';
  selectedTeam = 'All Teams';

  // ── Row hover sync between the two split panes ───────────────────────
  hoveredRowId: string | null = null;

  // ── Scenario columns — populated from GET /api/v1/master/scenarios ──
  scenarios: Scenario[] = [];

  // ── Variance comparison columns — auto-derived once scenarios load ──
  varianceCols: VarianceColumn[] = [];

  // ── Prepare-a-scenario modal state (RFP §8.1) ────────────────────────
  showAddScenarioModal = false;
  newScenarioCode = '';
  newScenarioType = 'Forecast';
  newScenarioYear = 2026;
  /** Which existing scenario's forecast entries to copy into the new one. Empty = start blank. */
  copyFromScenarioId = '';
  readonly years = [2024, 2025, 2026, 2027, 2028];
  isSavingScenario = false;
  // No real auth wired up yet — mirrors invoice-upload.component.ts's autoStamp.user mock.
  private readonly currentUser = 'Devojeet Modak';

  // ── Column drag-reorder ───────────────────────────────────────────────
  draggedColIndex: number | null = null;
  dragOverColIndex: number | null = null;

  costRows: CostRow[] = [];
  isLoadingRows = false;

  ngOnInit(): void {
    this.loadFilters();
    this.loadScenarios();
  }

  ngAfterViewInit(): void {
    this.setupScrollSync();
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

  /** Loads real scenarios from tblCMScenario, builds the variance columns, then loads the grid data. */
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

        this.varianceCols = this.buildVarianceColumns(this.scenarios);
        this.loadCostRows();
      },
      error: err => console.error('Failed to load scenarios', err)
    });
  }

  /** V1 = the two most recent non-Actual (RFC/Budget) scenarios compared; V2 = most recent Actual vs. most recent RFC/Budget. */
  private buildVarianceColumns(scenarios: Scenario[]): VarianceColumn[] {
    const reporting = scenarios.filter(s => s.scenarioType.toLowerCase() !== 'actual');
    const actuals = scenarios.filter(s => s.scenarioType.toLowerCase() === 'actual');
    const cols: VarianceColumn[] = [];

    if (reporting.length >= 2) {
      const [left, right] = reporting.slice(-2);
      cols.push({ id: 'v1', label: 'V1', compareLeft: right.id, compareRight: left.id });
    }
    if (actuals.length >= 1 && reporting.length >= 1) {
      const latestActual = actuals[actuals.length - 1];
      const latestReporting = reporting[reporting.length - 1];
      cols.push({ id: 'v2', label: 'V2', compareLeft: latestActual.id, compareRight: latestReporting.id });
    }
    return cols;
  }

  /** Calls the backend for every loaded scenario column, filtered by the current Site/Team selection. */
  private loadCostRows(): void {
    if (this.scenarios.length === 0) { this.costRows = []; return; }

    const columns: ScenarioYearColumn[] = this.scenarios.map(s => ({ scenario: s.code, year: s.year }));
    const site = this.selectedSite === 'All Sites' ? null : this.selectedSite;
    const team = this.selectedTeam === 'All Teams' ? null : this.selectedTeam;

    // `isLoadingRows` was set on both paths but never bound to anything, so this fetch had no
    // visible indicator at all. The flag is left in place; the loader is what actually shows.
    this.isLoadingRows = true;
    this.dashboardService.get(site, team, columns).pipe(
      this.loader.track('Loading cost centre data…')
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
        values: r.values
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
        for (const child of row.children) {
          for (const scenarioId in child.values) {
            row.values[scenarioId] = (row.values[scenarioId] || 0) + child.values[scenarioId];
          }
        }
      }
    }
  }

  /** Filtering now happens server-side (Site/Team are query params) — this just re-fetches. */
  onFilterChange(): void {
    this.loadCostRows();
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

  // ── Prepare a scenario (RFP §8.1) ────────────────────────────────────
  // Creates the tblCMScenario row, then — if a source was picked — copies every
  // forecast entry (keys/metadata + values) from that scenario into the new one,
  // via POST /api/v1/forecast/copy-scenario.

  openAddScenario(): void {
    this.newScenarioCode = '';
    this.newScenarioType = 'Forecast';
    this.newScenarioYear = 2026;
    this.copyFromScenarioId = this.scenarios[this.scenarios.length - 1]?.code ?? '';
    this.showAddScenarioModal = true;
  }

  closeAddScenario(): void {
    this.showAddScenarioModal = false;
  }

  addScenario(): void {
    if (!this.newScenarioCode.trim()) {
      this.snackbar.show('Scenario code is required.', 'error');
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

  // ── Column drag-reorder ───────────────────────────────────────────────

  onDragStart(event: DragEvent, index: number): void {
    this.draggedColIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', index.toString());
    }
  }

  onDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (this.draggedColIndex !== null && this.draggedColIndex !== index) {
      this.dragOverColIndex = index;
    }
  }

  onDrop(event: DragEvent, index: number): void {
    event.preventDefault();
    if (this.draggedColIndex !== null && this.draggedColIndex !== index) {
      const dragged = this.scenarios[this.draggedColIndex];
      this.scenarios.splice(this.draggedColIndex, 1);
      this.scenarios.splice(index, 0, dragged);
    }
    this.onDragEnd();
  }

  onDragEnd(): void {
    this.draggedColIndex = null;
    this.dragOverColIndex = null;
  }
}
