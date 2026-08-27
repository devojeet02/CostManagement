import { Component, HostListener, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import {
  MONTHS, TYPES,
  DEFAULT_FILTERS, DEFAULT_TOGGLES,
  ForecastRow, ForecastFilters, ForecastToggles, SubRow, SubRowType,
  ForecastComment, ForecastCommentInput,
  // MOCK_FORECAST_ROWS is deliberately no longer imported — the grid shows real data only.
  // The constant still exists in forecast.constants.ts for reference/tests.
  buildDefaultSubRows, API_ENDPOINTS
} from '../../constants/forecast.constants';
import { SelectGroup, SelectOption } from '../../features/hierarchy-select/hierarchy-select.component';
import { MonthCommentSlot } from '../../features/forecast-comments-modal/forecast-comments-modal.component';
import { CellAnchor } from '../../features/forecast-cell-comment/forecast-cell-comment.component';
import { formatAmount } from '../../features/number-format/number-format.util';
import { ForecastService, ForecastRowPayload } from '../../services/forecast.service';
import { MasterDataService, LookupItemDto, AccountDto } from '../../services/master-data.service';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { PeriodService } from '../../services/period.service';
import { InternalOrderService } from '../../services/internal-order.service';
import { RechargeService, RechargeInstructionDto } from '../../services/recharge.service';

@Component({
  selector: 'cm-forecast',
  templateUrl: './forecast.component.html',
  styleUrls: ['./forecast.component.scss']
})
export class ForecastComponent implements OnInit {

  /** Audit login stamped on saved rows (LastUpdatedBy) — mirrors the Invoice screen. */
  private readonly currentUser = 'Devojeet Modak';

  /**
   * Live SAP Internal Order lookup — the SAME source the Invoice Upload screen uses
   * (`/api/v1/master/internal-orders`). The grid previously had a free-text box here, so a
   * forecast row could hold an internal order that exists nowhere in the master data; since
   * Actuals are matched to forecast rows on InternalOrder (+ Site/Team/Account/Year), a typo
   * silently produced blank actuals with nothing to indicate why.
   *
   * Arrow fn so `this` stays bound when cm-hierarchy-select calls it on each keystroke.
   */
  searchInternalOrders = (query: string): Observable<SelectGroup[]> =>
    this.ioService.search(query);

  /**
   * Preloaded Internal Order catalogue, passed as `[groups]` ALONGSIDE `[searchFn]`.
   *
   * Typing still searches the server (`searchFn` wins for the dropdown list — see
   * `filteredGroups`, which returns the remote results whenever a searchFn is present). This
   * is used only so cm-hierarchy-select can resolve an already-saved CODE back to its label,
   * making a loaded row read "IO1 – CRM Migration" instead of a bare "IO1".
   */
  ioCatalogue: SelectGroup[] = [];

  private loadInternalOrderCatalogue(): void {
    // Empty query returns the full list; it is small standing data.
    this.ioService.search('').subscribe({
      next: groups => this.ioCatalogue = groups ?? [],
      // Non-fatal: without it, rows fall back to showing the bare code, exactly as before.
      error: err => console.error('Failed to load the internal order catalogue', err)
    });
  }

  constructor(
    private forecastService: ForecastService,
    private masterDataService: MasterDataService,
    private periodService: PeriodService,
    private ioService: InternalOrderService,
    private snackbar: SnackbarService,
    private rechargeService: RechargeService
  ) {}

  ngOnInit(): void {
    ForecastComponent.discardLegacyLocalComments();
    this.loadForecast();
    this.loadPeriods();
    this.loadDropdownData();
    this.loadInternalOrderCatalogue();
  }

  /**
   * Comments used to be written to localStorage and never reached the server. They are now
   * persisted properly, and the old store was deliberately NOT migrated — it holds free text
   * with no author, no timestamp and no link to a particular edit, which is exactly what a
   * justification trail is supposed to carry.
   *
   * Removed rather than ignored so it doesn't sit in users' browsers indefinitely.
   * Safe to delete this once every browser has loaded the screen at least once.
   */
  private static discardLegacyLocalComments(): void {
    try {
      localStorage.removeItem('forecast-row-comments');
    } catch {
      // Private-browsing or a disabled store — nothing to clean up in that case anyway.
    }
  }

  // ── Period locks (RFP §8.2) ─────────────────────────────────────────────────
  /**
   * Closed months for `currentYear`, indexed 0-11 to line up with the grid's columns.
   *
   * The backend already refuses to save a change to a closed month
   * (`ForecastService.EnsureEditableAsync`), but the grid had no idea which those were — you
   * could type into a locked month and only find out at Save. This mirrors that state onto
   * the columns so it is visible before anything is typed. Enforcement stays server-side;
   * this is presentation.
   */
  lockedMonths: boolean[] = new Array(12).fill(false);

  /** Who closed each month, for the tooltip. Indexed 0-11. */
  private lockedBy: (string | null)[] = new Array(12).fill(null);

  /** Loads the open/closed state for the year on screen. */
  private loadPeriods(): void {
    this.periodService.list(this.currentYear).subscribe({
      next: periods => {
        const locked = new Array(12).fill(false);
        const by: (string | null)[] = new Array(12).fill(null);
        for (const p of periods ?? []) {
          const idx = (p.month ?? 0) - 1;          // API months are 1-12
          if (idx < 0 || idx > 11) continue;
          locked[idx] = p.isOpen === false;
          by[idx] = p.lastUpdatedBy ?? null;
        }
        this.lockedMonths = locked;
        this.lockedBy = by;
      },
      error: err => {
        // Leave every month editable rather than locking the grid on a failed lookup — the
        // backend still refuses a genuinely closed month, so nothing can slip through.
        this.lockedMonths = new Array(12).fill(false);
        this.lockedBy = new Array(12).fill(null);
        console.error('Failed to load period locks', err);
      }
    });
  }

  // ── Changes / variance column ───────────────────────────────────────────────
  /**
   * Sum of each sub-row's values as last SAVED, keyed `rowId|subType`.
   *
   * The baseline is the ORIGINALLY FILLED state — what the grid held when it was loaded — and
   * is deliberately NOT re-captured after a save. Saving therefore does not zero the column:
   * the badge keeps showing everything done on top of the original, which is the point of the
   * column during an RFC cycle.
   *
   * It resets on a genuine reload (page refresh, year change), because at that moment the
   * freshly loaded values ARE the originally-filled state for the new session.
   *
   * ⚠️ This snapshot is now only a FALLBACK. The real baseline is persisted server-side
   * (`OriginalLocalTotal` / `OriginalContractTotal` on tblCMForecastData), so the delta
   * survives a page refresh; see subVariance. This map still covers rows the server holds
   * no original for — a brand-new unsaved row, or a backend without those columns.
   *
   * Stores the total rather than the 12 values: that is all the column shows, and it keeps
   * the snapshot cheap on a large grid.
   */
  private savedTotals = new Map<string, number>();

  /** Set by a save so the following reload keeps the original baseline instead of resetting it. */
  private preserveBaselineOnNextLoad = false;

  private baselineKey(rowId: number, subType: SubRowType): string {
    return `${rowId}|${subType}`;
  }

  /**
   * Snapshot every sub-row's total as the baseline. Skipped for the reload that follows a
   * save, so the column keeps measuring against the original rather than resetting to zero.
   */
  private captureBaseline(): void {
    if (this.preserveBaselineOnNextLoad) {
      this.preserveBaselineOnNextLoad = false;
      return;
    }
    this.savedTotals.clear();
    for (const row of this.forecastRows) {
      for (const sub of row.subRows ?? []) {
        this.savedTotals.set(this.baselineKey(row.id, sub.type), this.getSubTotal(sub.values));
      }
    }
  }

  /**
   * Signed variance for one sub-row: current total − ORIGINAL total.
   * Positive = more spend than the line started with.
   *
   * The original comes from the server (`originalLocalTotal` / `originalContractTotal`,
   * recorded once when the line was created), so the delta survives saving and reloading:
   * a line created at 1000 and saved at 1010 still reads +10 after a refresh, and only
   * returns to 0 when it is edited back to 1000.
   *
   * Falls back to the session snapshot when no original is stored — a brand-new unsaved
   * row, a sub-row type the backend doesn't persist (recharge / other-scenario), or a
   * backend without the columns yet. That degrades to the previous session-scoped
   * behaviour rather than treating the whole total as new spend.
   */
  subVariance(row: ForecastRow, sub: SubRow): number {
    const current = this.getSubTotal(sub.values);
    const original = this.originalTotalFor(row, sub);
    if (original !== null) return current - original;

    const baseline = this.savedTotals.get(this.baselineKey(row.id, sub.type));
    return current - (baseline ?? 0);
  }

  /** Persisted original for this sub-row, or null when the server holds none. */
  private originalTotalFor(row: ForecastRow, sub: SubRow): number | null {
    // Only the Forecast (local) and Contract series have stored month columns, so only
    // those two have a recorded original.
    const stored = sub.type === 'local'    ? row.originalLocalTotal
                 : sub.type === 'contract' ? row.originalContractTotal
                 : undefined;
    return stored == null ? null : Number(stored);
  }

  /**
   * Whether to render a badge at all.
   *
   * Editable rows ALWAYS get one — zero shows as a green badge, exactly as the Scenario
   * Management variance column does (its `getVarianceBadgeClass` returns `favorable` for
   * anything <= 0, never a blank). Only read-only Actuals fall back to a dash: they are
   * server-derived and can never vary, so a permanent green zero on them would be noise.
   */
  hasVariance(row: ForecastRow, sub: SubRow): boolean {
    return !this.isReadOnlySub(sub);
  }

  /** Below this a difference is float noise, not a real edit — treated as unchanged. */
  private static readonly VARIANCE_EPSILON = 0.005;

  /**
   * Three-way direction for the badge.
   *
   * Unchanged is deliberately its OWN state rather than being folded in with "reduced":
   * green means the edit saved money, and a row nobody has touched has not saved anything.
   * (Scenario Management colours zero green, but there zero is a real comparison between two
   * scenarios; here it just means "untouched", which is a different thing.)
   */
  varianceState(row: ForecastRow, sub: SubRow): 'up' | 'down' | 'flat' {
    return ForecastComponent.directionOf(this.subVariance(row, sub));
  }

  private static directionOf(value: number): 'up' | 'down' | 'flat' {
    if (value >= ForecastComponent.VARIANCE_EPSILON) return 'up';
    if (value <= -ForecastComponent.VARIANCE_EPSILON) return 'down';
    return 'flat';
  }

  /** '+' / '−' / '' — nothing prefixed when unchanged. */
  varianceSign(row: ForecastRow, sub: SubRow): string {
    const s = this.varianceState(row, sub);
    return s === 'up' ? '+' : s === 'down' ? '−' : '';
  }

  /** Magnitude shown in the badge — direction is carried by the colour. */
  fmtVariance(row: ForecastRow, sub: SubRow): string {
    return formatAmount(Math.abs(this.subVariance(row, sub)), 2);
  }

  /** Column total for one sub-row type, across the rows currently displayed. */
  getTypeVariance(type: SubRowType): number {
    return this.filteredForecastRows.reduce((sum, row) => {
      const sub = row.subRows?.find(s => s.type === type);
      return sub ? sum + this.subVariance(row, sub) : sum;
    }, 0);
  }

  /** Same rule as hasVariance: always badge a total, except for the derived Actual rows. */
  hasTypeVariance(type: SubRowType): boolean {
    return !ForecastComponent.ACTUAL_SUB_TYPES.includes(type);
  }

  typeVarianceState(type: SubRowType): 'up' | 'down' | 'flat' {
    return ForecastComponent.directionOf(this.getTypeVariance(type));
  }

  typeVarianceSign(type: SubRowType): string {
    const s = this.typeVarianceState(type);
    return s === 'up' ? '+' : s === 'down' ? '−' : '';
  }

  fmtTypeVariance(type: SubRowType): string {
    return formatAmount(Math.abs(this.getTypeVariance(type)), 2);
  }

  /**
   * Sub-row types derived server-side from posted invoices. Never user-editable: whatever the
   * client sends for them is discarded on save and recomputed on every read.
   */
  private static readonly ACTUAL_SUB_TYPES: SubRowType[] = ['actual', 'contract-actual', 'recharge-actual'];

  /**
   * True when this sub-row is read-only.
   *
   * Trusts the backend's `readOnly` flag first, then falls back to the type list — the flag is
   * absent from some locally-built rows (a new row from `buildDefaultSubRows` before its first
   * save, and the mock fallback), and an Actual row must be read-only in every one of those
   * cases. The two agree wherever both are present.
   */
  isReadOnlySub(sub: SubRow): boolean {
    return sub.readOnly === true || ForecastComponent.ACTUAL_SUB_TYPES.includes(sub.type);
  }

  /** Why a value cell can't be edited — the month lock, or the row being an Actual. */
  cellLockTitle(sub: SubRow, monthIndex: number): string {
    if (this.isMonthLocked(monthIndex)) return this.monthLockTitle(monthIndex);
    if (this.isReadOnlySub(sub)) {
      return 'Actuals are derived from posted invoices and cannot be edited here.'
        + ' They update automatically when an invoice is saved against this cost line.';
    }
    return '';
  }

  /** True when that month (0-11) is closed for editing. */
  isMonthLocked(monthIndex: number): boolean {
    return this.lockedMonths[monthIndex] === true;
  }

  /** Tooltip explaining why the column is not editable. */
  monthLockTitle(monthIndex: number): string {
    if (!this.isMonthLocked(monthIndex)) return '';
    const who = this.lockedBy[monthIndex];
    return `${this.months[monthIndex]} ${this.currentYear} is closed for editing.`
      + ` Values are locked as actuals.`
      + (who ? ` Closed by ${who}.` : '')
      + ` Reopen it on the Period Management screen to edit this month.`;
  }

  /**
   * Load the grid from the backend. The read-only Actual sub-rows arrive already
   * derived from posted invoices. Falls back to the mock data if the API is unreachable
   * so the screen still renders offline.
   */
  /** True while the grid is fetching, so the template can show a loader instead of a blank table. */
  isLoading = false;

  /** Set when the fetch fails, so the template can offer a retry rather than an empty grid. */
  loadError = false;

  loadForecast(): void {
    this.isLoading = true;
    this.loadError = false;

    this.forecastService.list(this.currentYear).subscribe({
      next: rows => {
        this.isLoading = false;
        // Real data only. An empty year renders the empty state — it must NOT fall back to
        // sample rows, which looked like saved forecast data and could be edited and saved
        // as if it were real.
        this.forecastRows = rows ?? [];
        this.applySavedOrder();
        // What just loaded IS the last saved state — the Changes column measures against it.
        this.captureBaseline();
        // Always refreshed, unlike the baseline: this is what "edited since load" compares to,
        // so an edit that has already been justified must stop counting as one.
        this.captureLoadedMonthly();
      },
      error: err => {
        this.isLoading = false;
        this.loadError = true;
        this.forecastRows = [];
        this.captureBaseline();
        console.error('Failed to load forecast', err);
        this.snackbar.show('Could not load the forecast. Please try again.', 'error');
      }
    });
  }

  /** Lookup rows → options that persist the code (falls back to the name when there is none). */
  private static toCodeOptions(rows: LookupItemDto[], withCode = false): SelectOption[] {
    return rows.map(r => ({
      value: r.code ?? r.name,
      label: withCode && r.code ? `${r.code} – ${r.name}` : r.name
    }));
  }

  /** Lookup rows → options that persist the name (spend type / layer / system / category). */
  private static toNameOptions(rows: LookupItemDto[]): SelectOption[] {
    return rows.map(r => ({ value: r.name, label: r.name }));
  }

  /** Wraps flat options in the single group the hierarchy-select filter chips expect. */
  private static toSingleGroup(label: string, items: SelectOption[]): SelectGroup[] {
    return items.length === 0 ? [] : [{ group: label, items }];
  }

  /**
   * Loads every master-data-driven dropdown on this screen from the backend, so the
   * Admin screen is the single source of truth. Mirrors InvoiceUploadComponent.
   */
  private loadDropdownData(): void {
    this.masterDataService.getSites().subscribe({
      next: rows => {
        this.sites = ForecastComponent.toCodeOptions(rows);
        this.siteFilterGroups = ForecastComponent.toSingleGroup('Sites', this.sites);
      },
      error: err => console.error('Failed to load sites', err)
    });

    this.masterDataService.getTeams().subscribe({
      next: rows => {
        this.teams = ForecastComponent.toCodeOptions(rows);
        this.teamFilterGroups = ForecastComponent.toSingleGroup('Teams', this.teams);
      },
      error: err => console.error('Failed to load teams', err)
    });

    this.masterDataService.getScenarios().subscribe({
      next: rows => {
        // withCode=true: scenario Names collide ("Forecast" for FC/RFC1/RFC3/etc.) so the
        // code has to be in the label or the dropdown is unpickable — see CCM-060 chat.
        this.scenarios = ForecastComponent.toCodeOptions(rows, true);
        this.scenarioFilterGroups = ForecastComponent.toSingleGroup('Scenarios', this.scenarios);
      },
      error: err => console.error('Failed to load scenarios', err)
    });

    this.masterDataService.getAccounts().subscribe({
      next: (rows: AccountDto[]) => {
        this.accounts = rows.map(r => ({ value: r.code, label: `${r.code} – ${r.name}` }));
        this.accountFilterGroups = ForecastComponent.toSingleGroup('Accounts', this.accounts);
      },
      error: err => console.error('Failed to load accounts', err)
    });

    this.masterDataService.getSuppliers().subscribe({
      next: rows => this.suppliers = ForecastComponent.toCodeOptions(rows),
      error: err => console.error('Failed to load suppliers', err)
    });

    this.masterDataService.getCurrencies().subscribe({
      next: rows => this.currencies = ForecastComponent.toCodeOptions(rows),
      error: err => console.error('Failed to load currencies', err)
    });

    this.masterDataService.getSpendTypes().subscribe({
      next: rows => this.spendTypes = ForecastComponent.toNameOptions(rows),
      error: err => console.error('Failed to load spend types', err)
    });

    this.masterDataService.getSpendLayers().subscribe({
      next: rows => this.spendLayers = ForecastComponent.toNameOptions(rows),
      error: err => console.error('Failed to load spend layers', err)
    });

    this.masterDataService.getSystems().subscribe({
      next: rows => this.systems = ForecastComponent.toNameOptions(rows),
      error: err => console.error('Failed to load systems', err)
    });

    this.masterDataService.getCategories().subscribe({
      next: rows => this.categories = ForecastComponent.toNameOptions(rows),
      error: err => console.error('Failed to load categories', err)
    });
  }

  isMobileView = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;

  @HostListener('window:resize')
  onResize(): void {
    this.isMobileView = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
  }

  // ── Reference data ─────────────────────────────────────────────────────────
  // Everything except months/types is master data maintained on the Admin screen and
  // loaded from /api/v1/master/* by loadDropdownData(), same as the Invoice Upload screen.
  // OPEX/CAPEX has no master table, so it stays a constant.
  readonly months       = MONTHS;
  readonly types        = TYPES;
  readonly apiEndpoints = API_ENDPOINTS; // kept for future wiring

  // Grid column dropdowns. Value is what gets persisted on the forecast row; label is
  // what the user sees. Site/team/supplier/currency/account persist the lookup CODE
  // (matching the Invoice Upload screen) so both screens key off the same values.
  sites:       SelectOption[] = [];
  teams:       SelectOption[] = [];
  categories:  SelectOption[] = [];
  suppliers:   SelectOption[] = [];
  spendTypes:  SelectOption[] = [];
  spendLayers: SelectOption[] = [];
  systems:     SelectOption[] = [];
  currencies:  SelectOption[] = [];
  accounts:    SelectOption[] = [];
  scenarios:   SelectOption[] = [];

  // ── Grouped catalogues for the filter chips (hierarchy-select dropdowns) ────
  // Same master data as the grid dropdowns above, wrapped in a single group. Values
  // match what the grid persists, so `filteredForecastRows` (which compares e.g.
  // `row.site === filters.site`) keeps working unchanged. Default filter values are
  // empty strings → no filter applied → all rows show.
  siteFilterGroups:     SelectGroup[] = [];
  teamFilterGroups:     SelectGroup[] = [];
  accountFilterGroups:  SelectGroup[] = [];
  scenarioFilterGroups: SelectGroup[] = [];

  // ── State ──────────────────────────────────────────────────────────────────
  currentYear = 2026;
  filters: ForecastFilters = { ...DEFAULT_FILTERS };
  toggles: ForecastToggles = { ...DEFAULT_TOGGLES };

  // TODO: Replace with:
  //   this.http.get<ForecastRow[]>(API_ENDPOINTS.forecast.getAll())
  //     .subscribe(rows => this.forecastRows = rows);
  // Starts EMPTY, not seeded with sample rows — otherwise the grid paints dummy data for the
  // moment before the first response lands, which reads as real saved forecast.
  forecastRows: ForecastRow[] = [];

  get filteredForecastRows(): ForecastRow[] {
    return this.forecastRows.filter(row => {
      if (this.filters.site     && row.site     && row.site     !== this.filters.site)     return false;
      if (this.filters.team     && row.team     && row.team     !== this.filters.team)     return false;
      if (this.filters.account  && row.account  && row.account  !== this.filters.account)  return false;
      if (this.filters.scenario && row.scenario && row.scenario !== this.filters.scenario) return false;
      if (this.filters.type     && row.type     && row.type     !== this.filters.type)     return false;
      if (this.filters.category && row.category && row.category !== this.filters.category) return false;
      if (this.filters.supplier && row.supplier && row.supplier !== this.filters.supplier) return false;
      if (this.filters.currency && row.currency && row.currency !== this.filters.currency) return false;
      return true;
    });
  }

  // ── Visible sub-row types ──────────────────────────────────────────────────

  /** Types for the top block: TOTAL [Account] */
  get totalBlockTypes(): SubRowType[] {
    const t: SubRowType[] = ['local'];
    if (this.toggles.showSourceCurrency) t.push('contract');
    if (this.toggles.showActual)         t.push('actual');
    if (this.toggles.showActual && this.toggles.showSourceCurrency) t.push('contract-actual');
    if (this.toggles.showOtherScenario)  t.push('other-scenario');
    return t;
  }

  /** Types for the bottom block: TOTAL RECHARGE [Account] */
  /** Empty while recharge is hidden, which drops the whole TOTAL RECHARGE footer block. */
  get rechargeBlockTypes(): SubRowType[] {
    if (!this.toggles.showRecharge) return [];
    const t: SubRowType[] = ['recharge'];
    if (this.toggles.showActual)         t.push('recharge-actual');
    if (this.toggles.showOtherScenario)  t.push('recharge-other-scenario');
    return t;
  }

  /** All visible types in body rows */
  get visibleTypes(): SubRowType[] {
    return [...this.totalBlockTypes, ...this.rechargeBlockTypes];
  }

  visibleSubRows(row: ForecastRow): SubRow[] {
    return row.subRows.filter(s => {
      if (s.type === 'contract') {
        return row.differentCurrency && this.toggles.showSourceCurrency;
      }
      if (s.type === 'contract-actual') {
        return row.differentCurrency && this.toggles.showSourceCurrency && this.toggles.showActual;
      }
      if (s.type === 'local') {
        return true;
      }
      if (s.type === 'recharge') {
        // Recharge lines are excluded from the RFC grid unless explicitly asked for — they are
        // billed out to the business, not part of this cost centre's own forecast. The
        // Recharge View screen is where they are read.
        return row.rechargeRequired && this.toggles.showRecharge;
      }
      if (s.type === 'actual') {
        return this.toggles.showActual;
      }
      if (s.type === 'other-scenario') {
        return this.toggles.showOtherScenario;
      }
      return false; // recharge-actual and recharge-other-scenario are body-invisible, only for totals
    });
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  getSubTotal(values: (number | null)[]): number {
    return values.reduce((s: number, v) => s + (v ?? 0), 0);
  }

  getTypeColTotal(type: SubRowType, mi: number): number {
    return this.filteredForecastRows.reduce((t, row) => {
      // For recharge, only sum if row has rechargeRequired
      if (type === 'recharge' && !row.rechargeRequired) return t;
      // For contract, only sum if row has differentCurrency
      if (type === 'contract' && !row.differentCurrency) return t;
      // For contract actuals, only sum if row has differentCurrency
      if (type === 'contract-actual' && !row.differentCurrency) return t;

      const sub = row.subRows.find(s => s.type === type);
      return t + (sub ? (sub.values[mi] ?? 0) : 0);
    }, 0);
  }

  getTypeTotal(type: SubRowType): number {
    return this.months.reduce((t, _, i) => t + this.getTypeColTotal(type, i), 0);
  }

  getTypeLabel(type: SubRowType): string {
    switch (type) {
      case 'local':                   return 'Forecast';
      case 'contract':                return 'Forecasted in Contract Currency';
      case 'actual':                  return 'Actual';
      case 'contract-actual':         return 'Actual in Contract Currency';
      case 'other-scenario':          return 'Other Scenario';
      case 'recharge':                return 'Forecast';
      case 'recharge-actual':         return 'Actual';
      case 'recharge-other-scenario': return 'Other Scenario';
      default:                        return '';
    }
  }

  // ── Year navigation ────────────────────────────────────────────────────────
  // Forecast rows + their invoice-derived actuals are year-specific, so reload on change.
  // Locks are per year, so they must be refetched alongside the grid.
  prevYear(): void { this.currentYear--; this.loadForecast(); this.loadPeriods(); }
  nextYear(): void { this.currentYear++; this.loadForecast(); this.loadPeriods(); }

  // ── Row management ─────────────────────────────────────────────────────────
  /** Temp id sequence for unsaved rows (negative → backend treats as insert). */
  private tempIdSeq = -1;

  addRow(): void {
    // A new row is blank, so it matches no active filter and would vanish the instant it is
    // added — the button would appear to do nothing. Clear the chips and say so, rather than
    // leaving the user staring at an unchanged grid.
    if (this.hasActiveFilters) {
      this.clearFilters();
      this.snackbar.show('Filters cleared so the new row is visible.', 'info');
    }

    this.forecastRows.push(this.blankRow());
  }

  /** CCM-011: a line added mid-cycle because spend genuinely exceeds its original PAR.
   * Requires a new PAR obtained externally, plus name/category/value before it can be saved
   * (see missingOverspendFields) — and renders with a distinct badge so it's never mistaken
   * for an originally-budgeted line. */
  addOverspendRow(): void {
    // Same vanish-on-add issue as addRow() above — clear filters here too.
    if (this.hasActiveFilters) {
      this.clearFilters();
      this.snackbar.show('Filters cleared so the new row is visible.', 'info');
    }
    this.forecastRows.push({ ...this.blankRow(), isOverspendAddition: true });
  }

  private blankRow(): ForecastRow {
    // New rows get a negative temp id so the backend inserts them on Save; the real
    // server id replaces it when the grid reloads after a successful save.
    return {
      id:               this.tempIdSeq--,
      internalOrder:    '',
      par:              '',
      spendType:        '',
      spendLayer:       '',
      system:           '',
      team:             '',
      type:             'OPEX',
      category:         '',
      supplier:         '',
      description:      '',
      currency:         'GBP',
      contractCurrency: 'USD',
      differentCurrency: false,
      rechargeRequired:  false,
      subRows:          buildDefaultSubRows('GBP', 'USD')
    };
  }

  // ── Delete a row (confirmed via the shared cm-confirm-dialog) ───────────────
  /** Row awaiting confirmation; null when the dialog is closed. */
  pendingDeleteRow: ForecastRow | null = null;

  get deleteDialogOpen(): boolean {
    return this.pendingDeleteRow !== null;
  }

  /** Names the row in the prompt so the user can tell which one they are about to remove. */
  get deleteDialogMessage(): string {
    const label = this.pendingDeleteRow?.internalOrder?.trim();
    return label
      ? `Are you sure you want to delete the row for internal order ${label}?`
      : 'Are you sure you want to delete this row?';
  }

  /** Opens the confirmation. The row is not touched until the user says yes. */
  askRemoveRow(row: ForecastRow): void {
    this.pendingDeleteRow = row;
  }

  cancelRemoveRow(): void {
    this.pendingDeleteRow = null;
  }

  confirmRemoveRow(): void {
    if (this.pendingDeleteRow) this.removeRow(this.pendingDeleteRow.id);
    this.pendingDeleteRow = null;
  }

  removeRow(id: number): void {
    // Local-only until Save, which posts the remaining rows for the year — the backend
    // soft-deletes whatever is missing from that payload. Keeps Cancel able to undo.
    this.forecastRows = this.forecastRows.filter(r => r.id !== id);
  }

  // ── Row reordering (drag & drop via detached rail, persisted via Save) ──────
  // Mirrors the Headcount drag-rail pattern: the drag handle lives in a
  // separate column OUTSIDE the data tables, dragging reorders the shared
  // `forecastRows` array (both left and right tables iterate it, so a logical
  // row moves as a unit), and the order is written to localStorage on Save.
  private readonly ORDER_KEY = 'forecast-row-order';

  draggedRowId: number | null = null;
  dragOverRowId: number | null = null;
  /** Transient DOM node used as the drag ghost; cleaned up in dragend. */
  private dragImageEl: HTMLElement | null = null;

  onRowDragStart(event: DragEvent, row: ForecastRow): void {
    this.draggedRowId = row.id;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to actually initiate the drag.
    event.dataTransfer.setData('text/plain', String(row.id));

    // Build a visible drag preview card so the user sees the row moving with
    // the cursor. Inline styles because component-scoped CSS doesn't reach
    // document.body where the preview node lives.
    const preview = document.createElement('div');
    preview.textContent = this.dragPreviewLabel(row);
    preview.style.cssText = [
      'position: absolute',
      'top: -1000px',
      'left: -1000px',
      'background: #1e293b',
      'color: #e2e8f0',
      'border: 1px solid #38bdf8',
      'border-radius: 6px',
      'padding: 7px 14px',
      'font: 600 12px system-ui, sans-serif',
      'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45)',
      'pointer-events: none',
      'white-space: nowrap',
      'z-index: 2147483647'
    ].join(';');
    document.body.appendChild(preview);
    this.dragImageEl = preview;
    event.dataTransfer.setDragImage(preview, 14, 14);
  }

  private dragPreviewLabel(row: ForecastRow): string {
    const parts = [row.internalOrder, row.supplier, row.team]
      .filter(p => !!p && String(p).trim().length > 0);
    return parts.length ? parts.join(' · ') : 'Forecast row';
  }

  onRowDragOver(event: DragEvent, row: ForecastRow): void {
    if (this.draggedRowId == null || this.draggedRowId === row.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverRowId = row.id;
  }

  onRowDragLeave(row: ForecastRow): void {
    if (this.dragOverRowId === row.id) this.dragOverRowId = null;
  }

  onRowDrop(event: DragEvent, target: ForecastRow): void {
    event.preventDefault();
    const srcId = this.draggedRowId;
    this.draggedRowId = null;
    this.dragOverRowId = null;
    if (srcId == null || srcId === target.id) return;

    const fromIdx = this.forecastRows.findIndex(r => r.id === srcId);
    const toIdx   = this.forecastRows.findIndex(r => r.id === target.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    // Direction-aware: down drag → drop AFTER target; up drag → drop BEFORE.
    // Inserting at `toIdx` in the post-splice array works for both because the
    // target's index shifts by -1 only when src was above it.
    const [moved] = this.forecastRows.splice(fromIdx, 1);
    this.forecastRows.splice(toIdx, 0, moved);
  }

  onRowDragEnd(): void {
    this.draggedRowId = null;
    this.dragOverRowId = null;
    if (this.dragImageEl) {
      this.dragImageEl.remove();
      this.dragImageEl = null;
    }
  }

  private loadSavedOrder(): number[] | null {
    try {
      const raw = localStorage.getItem(this.ORDER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeSavedOrder(ids: number[]): void {
    localStorage.setItem(this.ORDER_KEY, JSON.stringify(ids));
  }

  /** Re-sort forecastRows in-place to match the last saved order, if any. */
  private applySavedOrder(): void {
    const ids = this.loadSavedOrder();
    if (!ids || !ids.length) return;
    const indexOf = new Map<number, number>();
    ids.forEach((id, i) => indexOf.set(id, i));
    this.forecastRows.sort((a, b) => {
      const ai = indexOf.has(a.id) ? indexOf.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = indexOf.has(b.id) ? indexOf.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  // ── Monthly comments — RFC criterion 5 ─────────────────────────────────────
  //
  // Justifications used to be written to localStorage only, so nothing a user typed ever
  // reached the database. They now persist to tblCMForecastComment, one APPEND-ONLY row per
  // edit per month, and a comment is MANDATORY for any month changed on a line that has
  // already been saved. The first save of a new line needs none — there is nothing to justify
  // a change against yet.
  //
  // Comments are WRITTEN at the cell (cm-forecast-cell-comment opens on the month you just
  // changed) and READ per line (cm-forecast-comments-modal shows the Edit 1 / Edit 2 trail).
  // They used to be written in the twelve-box modal, which meant changing a number in the grid
  // and then hunting for that same month in an unrelated dialog.

  /** The read-only history modal for one line. */
  commentModalOpen = false;
  commentRow: ForecastRow | null = null;

  /**
   * Justifications typed this session but not yet saved, keyed by row id.
   *
   * Held here rather than on the row so they survive closing the modal — the save guard has to
   * know about them while the modal is shut, and a cancelled grid save must not lose them.
   * Cleared per row once a save succeeds.
   */
  private pendingComments = new Map<number, string[]>();

  /**
   * Every editable month value as it was last loaded from the server, keyed `rowId|subType`.
   *
   * This is what "edited in this session" is measured against. Deliberately separate from
   * `savedTotals`: that is the Changes column's baseline and is intentionally preserved across
   * a save, whereas this must refresh on every load or an already-justified edit would keep
   * demanding a new comment forever.
   */
  private loadedMonthly = new Map<string, (number | null)[]>();

  /** Snapshot the persisted monthly values. Runs on EVERY load, unlike captureBaseline. */
  private captureLoadedMonthly(): void {
    this.loadedMonthly.clear();
    for (const row of this.forecastRows) {
      for (const sub of row.subRows ?? []) {
        this.loadedMonthly.set(this.baselineKey(row.id, sub.type), [...(sub.values ?? [])]);
      }
    }
  }

  /** Values differing by less than this are float noise, not an edit. */
  private static readonly COMMENT_EPSILON = 0.005;

  /**
   * The series a justification can be demanded for.
   *
   * Only Forecast (local) and Contract have stored month columns, so only they can be edited
   * AND persisted. Actuals are server-derived, and recharge / other-scenario values are not
   * written back by the bulk save — demanding a comment for a change that will never reach the
   * database would block the save over nothing.
   */
  private static readonly COMMENTABLE_SUB_TYPES: SubRowType[] = ['local', 'contract'];

  /**
   * True when THIS cell — one row, one series, one month — was edited this session and that
   * edit needs justifying.
   *
   * Requires all of:
   * - the line is already persisted (`id > 0`) — the first save of a new row is free;
   * - the series is one a comment can be demanded for, and is editable;
   * - the value differs from what was loaded by more than float noise.
   *
   * Filling a previously-blank month on a saved line counts as an edit: the line has been
   * saved, so anything that moves its numbers afterwards is a change that needs a reason.
   */
  subMonthChanged(row: ForecastRow, sub: SubRow, monthIndex: number): boolean {
    if (row.id <= 0) return false;
    if (!ForecastComponent.COMMENTABLE_SUB_TYPES.includes(sub.type)) return false;
    if (this.isReadOnlySub(sub) || this.isMonthLocked(monthIndex)) return false;

    const loaded = this.loadedMonthly.get(this.baselineKey(row.id, sub.type));
    // No snapshot means the sub-row appeared after the load (e.g. a newly added series);
    // treat that as unchanged rather than demanding a comment for something never loaded.
    if (!loaded) return false;

    const before = Number(loaded[monthIndex] ?? 0);
    const after = Number(sub.values?.[monthIndex] ?? 0);
    return Math.abs(after - before) >= ForecastComponent.COMMENT_EPSILON;
  }

  /** True when any commentable series on this row+month was edited. */
  monthNeedsComment(row: ForecastRow, monthIndex: number): boolean {
    return (row.subRows ?? []).some(sub => this.subMonthChanged(row, sub, monthIndex));
  }

  /**
   * The red `!` on a cell: this cell was edited and its month still has no comment.
   *
   * Rendered on EVERY such cell across the grid, not just the row in focus — the save is
   * blocked by all of them at once, so all of them have to be findable at a glance.
   */
  cellNeedsComment(row: ForecastRow, sub: SubRow, monthIndex: number): boolean {
    return this.subMonthChanged(row, sub, monthIndex) && !this.hasCommentFor(row, monthIndex);
  }

  /**
   * The satisfied marker on a cell: edited, and justified. Without it a comment that has been
   * written has no trace on the grid, and there is no way back into the box to amend it.
   */
  cellHasComment(row: ForecastRow, sub: SubRow, monthIndex: number): boolean {
    return this.subMonthChanged(row, sub, monthIndex) && this.hasCommentFor(row, monthIndex);
  }

  /** Whether a justification for this row+month has been supplied this session. */
  private hasCommentFor(row: ForecastRow, monthIndex: number): boolean {
    return !!this.pendingComments.get(row.id)?.[monthIndex]?.trim();
  }

  /** Edited months on this row still missing their justification. */
  private missingCommentMonths(row: ForecastRow): number[] {
    const missing: number[] = [];
    for (let i = 0; i < 12; i++) {
      if (this.monthNeedsComment(row, i) && !this.hasCommentFor(row, i)) missing.push(i);
    }
    return missing;
  }

  /** Drives the red warning state on the row's comment button in the grid. */
  rowNeedsComment(row: ForecastRow): boolean {
    return this.missingCommentMonths(row).length > 0;
  }

  get commentModalTitle(): string {
    const label = this.commentRow?.internalOrder || 'Row';
    return `Monthly Comments — ${label} (${this.currentYear})`;
  }

  /**
   * Badge count: everything on record for this row plus everything staged — both kinds.
   * Previously counted months with a localStorage comment.
   */
  commentCount(row: ForecastRow): number {
    const saved = row.comments?.length ?? 0;
    const pendingCell = (this.pendingComments.get(row.id) ?? []).filter(c => !!c?.trim()).length;
    // Staged GC only counts where it is NEW; an edit to one already on record is not an extra.
    const pendingGeneral = (this.pendingGeneral.get(row.id) ?? [])
      .filter((c, i) => !!c?.trim() && !this.savedGeneralFor(row, i)).length;
    return saved + pendingCell + pendingGeneral;
  }

  /** The general comment on record for this row+month, if any. */
  private savedGeneralFor(row: ForecastRow, monthIndex: number): ForecastComment | undefined {
    return (row.comments ?? []).find(c => c.kind === 'GC' && c.month === monthIndex + 1);
  }

  /**
   * The month's general comment as it should appear in the box: what has been typed this
   * session if anything, otherwise what is on record.
   *
   * `??` not `||` — an empty string is a real staged value, meaning "the user cleared this
   * box". Falling through to the saved text there would silently undo the deletion.
   */
  private generalTextFor(row: ForecastRow, monthIndex: number): string {
    const staged = this.pendingGeneral.get(row.id)?.[monthIndex];
    return staged ?? this.savedGeneralFor(row, monthIndex)?.comment ?? '';
  }

  /** The 12 slots handed to cm-forecast-comments-modal for the open row. */
  get commentSlots(): MonthCommentSlot[] {
    const row = this.commentRow;
    if (!row) return [];

    return this.months.map((m, i) => ({
      label: `${m} ${this.currentYear}`,
      // CC only. The month's GC is an editable box, not part of the trail.
      cellComments: (row.comments ?? []).filter(c => c.kind === 'CC' && c.month === i + 1),
      // A closed month can't be edited, so `monthNeedsComment` already rules it out.
      required: this.monthNeedsComment(row, i) && !this.hasCommentFor(row, i),
      disabled: this.isMonthLocked(i)
    }));
  }

  /** The 12 general comments being edited for the open row. */
  generalDraft: string[] = [];

  /**
   * General comments typed this session but not yet saved, keyed by row id.
   *
   * Same reason as `pendingComments`: a cancelled grid save must not lose them, and the modal
   * being shut must not either. Cleared per save.
   */
  private pendingGeneral = new Map<number, string[]>();

  openComments(row: ForecastRow): void {
    this.commentRow = row;
    // Seed each box from staged-then-saved, so reopening shows what the user last typed.
    this.generalDraft = this.months.map((_, i) => this.generalTextFor(row, i));
    this.commentModalOpen = true;
  }

  /** Live update as the user types, so the badge stays accurate while the modal is open. */
  onGeneralDraftChange(change: { month: number; comment: string }): void {
    this.generalDraft[change.month] = change.comment;
  }

  /**
   * "Save Comments" stages the general notes against the row — the write happens with the
   * grid's own Save, the same as cell comments, so one Save writes the whole screen.
   */
  saveComments(): void {
    if (!this.commentRow) return;
    this.pendingGeneral.set(this.commentRow.id, [...this.generalDraft]);
    this.closeComments();
  }

  closeComments(): void {
    this.commentModalOpen = false;
    this.commentRow = null;
    this.generalDraft = [];
  }

  // ── The cell comment popover ───────────────────────────────────────────────

  cellCommentOpen = false;
  cellCommentRow: ForecastRow | null = null;
  cellCommentSub: SubRow | null = null;
  cellCommentMonth = -1;

  /** The single justification being typed, for `cellCommentRow` + `cellCommentMonth`. */
  cellCommentDraft = '';

  /** Viewport rect of the cell, and the cell itself so the popover can track scrolling. */
  cellCommentAnchor: CellAnchor | null = null;
  cellCommentAnchorEl: HTMLElement | null = null;

  /**
   * Whether the popover should take the caret when it opens. False for the cell-click path —
   * the user is about to type a number. See `ForecastCellCommentComponent.autoFocusInput`.
   */
  cellCommentAutoFocus = false;

  get cellCommentLabel(): string {
    return this.cellCommentMonth < 0 ? '' : `${this.months[this.cellCommentMonth]} ${this.currentYear}`;
  }

  /** "IO1 – CRM Migration · Forecast" — the popover covers the row it belongs to. */
  get cellCommentContext(): string {
    const row = this.cellCommentRow;
    if (!row) return '';
    const line = row.internalOrder || row.description || `Row ${row.id}`;
    return this.cellCommentSub ? `${line} · ${this.cellCommentSub.label}` : line;
  }

  /**
   * The CELL trail already on record for this month, shown under the box.
   * General comments are excluded — they belong to the month, not to any particular edit,
   * and are edited in the comments modal.
   */
  get cellCommentHistory(): ForecastComment[] {
    if (!this.cellCommentRow || this.cellCommentMonth < 0) return [];
    return (this.cellCommentRow.comments ?? [])
      .filter(c => c.kind === 'CC' && c.month === this.cellCommentMonth + 1);
  }

  get cellCommentRequired(): boolean {
    if (!this.cellCommentRow || this.cellCommentMonth < 0) return false;
    return this.monthNeedsComment(this.cellCommentRow, this.cellCommentMonth);
  }

  /**
   * Opens the box on one cell. `el` is the `<td>`, read for its viewport rect — the popover is
   * rendered at the root of this template, so it needs coordinates rather than a DOM parent.
   *
   * `focusInput` decides whether the caret moves into the comment box. It must stay false when
   * this is called from the cell gaining focus, or the cell could never be typed into.
   */
  openCellComment(
    row: ForecastRow, sub: SubRow, monthIndex: number, el: HTMLElement, focusInput = true
  ): void {
    const rect = el.getBoundingClientRect();
    this.cellCommentRow = row;
    this.cellCommentSub = sub;
    this.cellCommentMonth = monthIndex;
    this.cellCommentAnchorEl = el;
    this.cellCommentAnchor = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    this.cellCommentAutoFocus = focusInput;
    // Seed from what's staged for this month, never from the server trail — that is history,
    // shown beneath the box, and must not be edited or re-submitted.
    this.cellCommentDraft = this.pendingComments.get(row.id)?.[monthIndex] ?? '';
    this.cellCommentOpen = true;
  }

  /**
   * A month a comment can be attached to: a commentable series, editable, on this year's grid.
   *
   * Wider than `subMonthChanged` on purpose — the box opens when the cell is CLICKED, before
   * anything has been typed, so it cannot depend on the value having already moved.
   */
  private cellTakesComment(row: ForecastRow, sub: SubRow, monthIndex: number): boolean {
    return ForecastComponent.COMMENTABLE_SUB_TYPES.includes(sub.type)
      && !this.isReadOnlySub(sub)
      && !this.isMonthLocked(monthIndex);
  }

  /**
   * Called when an editable month input gains focus. The comment box opens against the cell
   * straight away — the user asked to see it as they start editing, not after the fact — and
   * deliberately does NOT take the caret, so typing goes into the cell as normal.
   *
   * Re-focusing a different cell simply re-anchors the same popover.
   */
  onCellValueFocus(row: ForecastRow, sub: SubRow, monthIndex: number, el: HTMLElement): void {
    if (!this.cellTakesComment(row, sub, monthIndex)) return;
    this.openCellComment(row, sub, monthIndex, el, false);
  }

  /** Live update as the user types, so the `!` markers and the save guard stay accurate. */
  onCellCommentChange(text: string): void {
    this.cellCommentDraft = text;
  }

  /**
   * "Save Comment" only stages it against the row — the write happens with the grid's own
   * Save, because a justification without the value it explains is meaningless.
   */
  saveCellComment(): void {
    const row = this.cellCommentRow;
    if (!row || this.cellCommentMonth < 0) return;

    const slots = this.pendingComments.get(row.id) ?? new Array(12).fill('');
    slots[this.cellCommentMonth] = this.cellCommentDraft;
    this.pendingComments.set(row.id, slots);
    this.closeCellComment();
  }

  closeCellComment(): void {
    this.cellCommentOpen = false;
    this.cellCommentRow = null;
    this.cellCommentSub = null;
    this.cellCommentMonth = -1;
    this.cellCommentDraft = '';
    this.cellCommentAnchor = null;
    this.cellCommentAnchorEl = null;
    this.cellCommentAutoFocus = false;
  }

  /**
   * Blocks the grid save when an edited month has no justification, and names what is missing.
   * Returns true when everything is accounted for.
   */
  private passesCommentGuard(): boolean {
    const offenders: string[] = [];

    for (const row of this.forecastRows) {
      const missing = this.missingCommentMonths(row);
      if (missing.length === 0) continue;
      const label = row.internalOrder || row.description || `Row ${row.id}`;
      offenders.push(`${label} — ${missing.map(i => this.months[i]).join(', ')}`);
    }

    if (offenders.length === 0) return true;

    this.snackbar.show(
      `Cannot save — a comment is mandatory for every edited month. Missing: ${offenders.join('; ')}.`,
      'error',
      9000
    );
    return false;
  }

  /** Pending CELL justifications for one row, as the payload the backend appends. */
  private newCommentsFor(row: ForecastRow): ForecastCommentInput[] {
    const pending = this.pendingComments.get(row.id) ?? [];
    const out: ForecastCommentInput[] = [];
    for (let i = 0; i < 12; i++) {
      const text = pending[i]?.trim();
      if (text) out.push({ month: i + 1, comment: text });
    }
    return out;
  }

  /**
   * Pending GENERAL comments for one row, as the payload the backend upserts.
   *
   * **Blank entries are included, unlike `newCommentsFor`.** An empty box means the user
   * cleared that month's note, and the backend deletes on blank — dropping it here would make
   * a deletion impossible. Rows whose modal was never opened have no staged array at all and
   * send nothing, so untouched months are never considered.
   */
  private generalCommentsFor(row: ForecastRow): ForecastCommentInput[] {
    const pending = this.pendingGeneral.get(row.id);
    if (!pending) return [];
    return pending.map((text, i) => ({ month: i + 1, comment: (text ?? '').trim() }));
  }

  /** CCM-011 AC#2: an overspend-addition line must have a name, category, PAR, and at least
   * one monthly value before it can be saved — same rule the backend enforces, checked here
   * first so the user gets an immediate, specific message instead of a round-trip error. */
  private missingOverspendFields(): string[] {
    const missing: string[] = [];
    this.forecastRows
      .filter(r => r.isOverspendAddition)
      .forEach(r => {
        const label = r.description?.trim() || `Row ${r.id}`;
        if (!r.description?.trim()) missing.push(`${label}: Name/Description`);
        if (!r.category?.trim()) missing.push(`${label}: Category`);
        if (!r.par?.trim()) missing.push(`${label}: PAR number`);
        const hasValue = r.subRows.some(s => s.values.some(v => v !== null && v !== undefined));
        if (!hasValue) missing.push(`${label}: at least one monthly value`);
      });
    return missing;
  }

  // ── Save / Cancel ──────────────────────────────────────────────────────────
  saveChanges(): void {
    // Two INDEPENDENT pre-flight gates, both of which can block the save. They cover disjoint
    // problems — a row that isn't well-formed (CCM-011) versus a change that isn't justified
    // (RFC criterion 5) — so a grid can fail either or both. Only the first message shows,
    // which is why the structural check goes first: "this row is incomplete" is more use than
    // "justify your edit" on a line that isn't finished being written.
    //
    // Both run before anything else, so a blocked save changes nothing at all — not even the
    // locally stored row order.
    const missingOverspend = this.missingOverspendFields();
    if (missingOverspend.length > 0) {
      this.snackbar.show(
        `Cannot save — overspend addition line(s) are incomplete: ${missingOverspend.join(', ')}.`,
        'error',
        8000
      );
      return;
    }

    if (!this.passesCommentGuard()) return;

    // Persist the current row order locally so it survives reloads.
    this.writeSavedOrder(this.forecastRows.map(r => r.id));

    // Stamp each row with the year, its current display order, and the audit login.
    // Read-only Actual sub-rows are ignored server-side (always re-derived from invoices).
    const payload: ForecastRowPayload[] = this.forecastRows.map((r, i) => ({
      ...r,
      year: this.currentYear,
      sortOrder: i,
      lastUpdatedBy: this.currentUser,
      // Only what was typed this session. `comments` (the trail) is echoed back untouched and
      // ignored by the backend — appending from it would duplicate the whole history each save.
      newComments: this.newCommentsFor(r),
      // Upserted, not appended: one general note per month, blank meaning delete.
      generalComments: this.generalCommentsFor(r)
    }));

    this.forecastService.bulkSave(payload, this.currentYear).subscribe({
      next: () => {
        this.snackbar.show('Forecast saved.', 'success');
        // Staged comments are now on the server; the reload brings them back as history.
        this.pendingComments.clear();
        this.pendingGeneral.clear();
        // The rows about to be replaced are the ones the open popover points at.
        this.closeCellComment();
        // Keep the original baseline across this reload — saving must not zero the Changes
        // column. The user is still meant to see everything done on top of the original.
        this.preserveBaselineOnNextLoad = true;
        // Reload so new rows pick up their real server ids and actuals refresh.
        this.loadForecast();
      },
      error: err => {
        const detail = err?.error?.error || err?.error?.detail || err?.message || 'unknown error';
        this.snackbar.show(`Save failed — ${detail}`, 'error', 8000);
      }
    });
  }

  /**
   * True when any filter chip is narrowing the grid. Distinguishes "this year has no forecast"
   * from "your filters hid everything" — two very different situations that otherwise both
   * present as an empty grid.
   */
  get hasActiveFilters(): boolean {
    const f = this.filters;
    return !!(f.site || f.team || f.account || f.scenario ||
              f.type || f.category || f.supplier || f.currency);
  }

  /**
   * Resets the chips only. Deliberately does NOT reload: filtering is client-side here
   * (`filteredForecastRows` is a getter), so a reload would needlessly discard unsaved edits —
   * which is `cancelChanges`' job, not this one's.
   */
  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
  }

  cancelChanges(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.toggles = { ...DEFAULT_TOGGLES };
    // Discard unsaved edits by re-fetching the last saved state from the backend.
    this.loadForecast();
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  /**
   * True for values below zero — drives the red styling on Actual cells.
   * Actuals go negative when a credit note outweighs the invoices on a cost line
   * (credits are subtracted server-side; see ForecastRepo.GetInvoiceActualsAsync).
   */
  isNegative(v: number | null | undefined): boolean {
    return v != null && Number(v) < 0;
  }

  fmt(v: number | null | undefined): string {
    if (v === null || v === undefined || v === 0) return '';
    return formatAmount(v, 2);
  }

  fmtTotal(v: number): string {
    if (!v) return '—';
    return formatAmount(v, 2);
  }

  // ── TrackBy helpers to prevent focus loss & DOM recreation ─────────────────
  trackByRow(index: number, row: ForecastRow): number {
    return row.id;
  }

  trackBySubRow(index: number, sub: SubRow): string {
    return sub.type;
  }


  // ── Recharge drill-down ────────────────────────────────────────────────────
  //
  // The grid's `recharge-actual` figures are already derived from invoice recharges
  // (ForecastRepo.GetInvoiceActualsAsync sums `RechargeAmount ?? amount × rate × pct/100`,
  // grouped by InternalOrder + PostingMonth). This drills into WHICH recharges make up that
  // number, querying /recharges on the SAME grain so the list adds up to what is on screen.
  //
  // ⚠️ That grain is internal order + posting year — NOT site/team/account. Two forecast rows
  // sharing an internal order therefore see the same recharges. The actuals figures already
  // have that property; the drill inherits it rather than introducing it, and the modal states
  // whether the list reconciles with the grid so a mismatch is visible rather than silent.
  //
  // ⚠️ Keyed off `recharge-actual` (what was really recharged), NOT the row's Recharge
  // checkbox (`rechargeRequired`, which is only an intent flag and does not gate the derived
  // actuals). Keying off the checkbox would hide the button on exactly the rows most worth
  // investigating — recharges nobody planned for.

  drillOpen = false;
  drillTitle = '';
  drillRows: RechargeInstructionDto[] = [];
  drillLoading = false;
  drillError = false;
  drillExpected: number | null = null;
  drillCurrency = '';

  /** A row's recharge-actual for the year. */
  private rowRechargeActual(row: ForecastRow): number {
    const sub = (row.subRows ?? []).find(s => s.type === 'recharge-actual');
    return (sub?.values ?? []).reduce((t: number, v) => t + (Number(v) || 0), 0);
  }

  /** Only offer the drill where there is something to drill into. */
  hasRecharges(row: ForecastRow): boolean {
    return Math.abs(this.rowRechargeActual(row)) > 0.005;
  }

  openRechargeDrill(row: ForecastRow): void {
    const label = row.internalOrder || row.description || `Row ${row.id}`;

    this.drillOpen = true;
    this.drillTitle = `Recharges — ${label} ${this.currentYear}`;
    this.drillExpected = this.rowRechargeActual(row);
    this.drillRows = [];
    this.drillError = false;
    this.drillLoading = true;
    // Set from the rows once they arrive, NOT from row.currency: a recharge is denominated in
    // the PROCESSING site's currency, which need not be this row's.
    this.drillCurrency = '';

    this.rechargeService.list(1, 200, {
      internalOrder: row.internalOrder || null,
      postingYear: this.currentYear
    }).subscribe({
      next: result => {
        this.drillRows = result.items ?? [];
        // One code when they agree, blank when the list mixes currencies — better no label
        // than a wrong one.
        const codes = new Set(this.drillRows.map(r => (r.currency || '').trim()).filter(c => !!c));
        this.drillCurrency = codes.size === 1 ? [...codes][0] : '';
        this.drillLoading = false;
      },
      error: err => {
        console.error('Failed to load recharges for this forecast row', err);
        this.drillLoading = false;
        this.drillError = true;
      }
    });
  }

  closeRechargeDrill(): void {
    this.drillOpen = false;
    this.drillRows = [];
    this.drillExpected = null;
  }

  trackByIndex(index: number, item: any): any {
    return index;
  }
}
