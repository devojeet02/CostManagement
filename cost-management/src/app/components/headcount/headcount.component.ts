import { Component, HostListener, ViewChild, ElementRef, OnInit } from '@angular/core';
import {
  HC_MONTHS, HC_REGIONS, HC_COUNTRIES, HC_EMPLOYEE_TYPES,
  HC_FUNCTIONS, HC_SCENARIO_YEARS,
  HC_DEFAULT_FILTERS, HC_DEFAULT_TOGGLES,
  HeadcountRow, HeadcountFilters, HeadcountToggles, HcScenarioRow, HcScenarioType,
  buildDefaultScenarioRows, HC_API_ENDPOINTS
} from '../../constants/headcount.constants';
import { SelectOption, SelectGroup } from '../../features/hierarchy-select/hierarchy-select.component';
import { formatAmount } from '../../features/number-format/number-format.util';
import { HeadcountService, HeadcountRowPayload } from '../../services/headcount.service';
import { MasterDataService, LookupItemDto } from '../../services/master-data.service';
import { UserService, UserDto } from '../../services/user.service';
import { SnackbarService } from '../../features/snackbar/snackbar.service';

@Component({
  selector: 'cm-headcount',
  templateUrl: './headcount.component.html',
  styleUrls: ['./headcount.component.scss']
})
export class HeadcountComponent implements OnInit {

  /** Audit login stamped on saved rows (LastUpdatedBy) — mirrors the Invoice screen. */
  private readonly currentUser = 'Devojeet Modak';

  constructor(
    private headcountService: HeadcountService,
    private masterDataService: MasterDataService,
    private userService: UserService,
    private snackbar: SnackbarService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.loadHeadcount();
    this.loadDropdownData();
  }

  /**
   * Loads the master-data-driven dropdowns from the backend so the Admin screen is the
   * single source of truth. Mirrors InvoiceUploadComponent / ForecastComponent.
   *
   * Only Site and Team come from master data. Category is the person's EMPLOYMENT TYPE
   * (Full Time / Part Time / VIE / TBA) — unrelated to the spend categories behind
   * /master/categories, and it has no lookup table of its own. It also drives screen
   * logic (the Function-for-TBA field is enabled only when category === 'TBA'), so it
   * stays on HC_EMPLOYEE_TYPES. Region / Country / Employee / Function likewise have no
   * master tables yet.
   */
  private loadDropdownData(): void {
    this.masterDataService.getSites().subscribe({
      next: rows => this.sites = HeadcountComponent.toCodeOptions(rows),
      error: err => console.error('Failed to load sites', err)
    });

    this.masterDataService.getTeams().subscribe({
      next: rows => this.teams = HeadcountComponent.toCodeOptions(rows),
      error: err => console.error('Failed to load teams', err)
    });

    // Employee comes from User & Access Management, not a lookup table — the people who can be
    // planned are the people the system already knows. activeOnly, because planning headcount
    // against a deactivated account is never what was meant.
    this.userService.list({ activeOnly: true }).subscribe({
      next: users => this.employeeGroups = HeadcountComponent.toEmployeeGroups(users),
      error: err => console.error('Failed to load users', err)
    });
  }

  /**
   * Active users → the single group of options behind the Employee lookup.
   *
   * `displayName` is nullable on UserDto — three of the five seeded users have none — so the
   * email is the fallback rather than letting an option render blank. Sorted, so the list is
   * predictable instead of however the API happened to order it.
   *
   * `value` and `label` are the same display string on purpose. The column persists a plain
   * name (`HeadcountRow.employee` is free text, there is no user FK), and the control keeps its
   * default bindValue of 'label', so what gets stored stays human-readable everywhere it is
   * echoed — the mobile card title and the delete confirmation both print it raw.
   */
  private static toEmployeeGroups(users: UserDto[]): SelectGroup[] {
    const items = users
      .map(u => (u.displayName ?? '').trim() || u.email)
      .filter(name => !!name)
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ value: name, label: name }));
    return items.length ? [{ group: 'Active users', items }] : [];
  }

  /**
   * Guarantees a 12-month array for every selectable year on every scenario band.
   *
   * Rows arrive carrying whichever years the backend knows about; the year list comes from a
   * separate call. Either can name a year the other does not, and the template does no
   * null-checking of its own, so this fills the gaps with zeros instead of letting an
   * undefined array reach `[mi]`.
   */
  private ensureYearCoverage(): void {
    for (const row of this.headcountRows) {
      for (const sub of row.scenarioRows ?? []) {
        sub.valuesByYear = sub.valuesByYear ?? {};
        for (const y of this.scenarioYears) {
          if (!sub.valuesByYear[y]) sub.valuesByYear[y] = Array(12).fill(0);
        }
      }
    }
  }

  /** Lookup rows → options persisting the code (falls back to the name when there is none). */
  private static toCodeOptions(rows: LookupItemDto[]): SelectOption[] {
    return rows.map(r => ({ value: r.code ?? r.name, label: r.name }));
  }

  /**
   * Load the grid from the backend. Each scenario band arrives with its values for every year.
   *
   * An empty response is a real answer — an empty roster — so it renders as an empty grid with
   * the Add Row button, NOT as demo data. Substituting MOCK_HEADCOUNT_ROWS here was actively
   * misleading: the five sample rows carried Site and Team values that match no master-data
   * lookup, so both dropdowns rendered blank and the screen looked broken when it was only
   * showing invented data. The error path mirrors ForecastComponent — empty grid, error
   * snackbar — so a failure is never mistaken for real content.
   */
  /**
   * Loads a page of the grid. Filtering, paging and totals are all server-side.
   *
   * `resetToFirstPage` is false when only the page or page size changed — resetting there would
   * make the pager unable to leave page 1.
   */
  private loadHeadcount(resetToFirstPage = true): void {
    this.isLoading = true;
    this.loadError = false;
    if (resetToFirstPage) this.resetPaging();

    this.headcountService.listPaged(this.page, this.pageSize, {
      site: this.filters.site,
      team: this.filters.team,
      scenarioYear: this.filters.scenarioYear,
      otherScenarioYear: this.filters.otherScenarioYear
    }).subscribe({
      next: res => {
        this.isLoading = false;
        this.headcountRows = this.mergeWithLoaded(res?.items ?? []);
        this.totalRowCount = res?.total ?? 0;
        this.serverTotals = res?.totals ?? {};
        this.ensureYearCoverage();
      },
      error: err => {
        this.isLoading = false;
        this.loadError = true;
        this.headcountRows = [];
        this.totalRowCount = 0;
        this.serverTotals = {};
        console.error('Failed to load headcount', err);
        this.snackbar.show('Could not load the headcount. Please try again.', 'error');
      }
    });
  }

  /**
   * Every row the user has loaded this session, by id.
   *
   * Two jobs, both consequences of paging an EDITABLE grid:
   *
   *  1. Edits must survive paging. Rows are mutated in place by ngModel, so a page revisit that
   *     replaced them with fresh server copies would silently discard whatever was typed.
   *  2. Save must cover every page visited, not just the one on screen — `saveChanges()` builds
   *     its payload from this map.
   *
   * Cleared on save, Cancel and any real reload (see `resetLoadedRows`).
   */
  private loadedRows = new Map<number, HeadcountRow>();

  /** Keeps in-flight edits by preferring the instance already held for an id. */
  private mergeWithLoaded(incoming: HeadcountRow[]): HeadcountRow[] {
    const merged: HeadcountRow[] = [];
    for (const row of incoming) {
      const held = this.loadedRows.get(row.id);
      if (held) { merged.push(held); continue; }
      this.loadedRows.set(row.id, row);
      merged.push(row);
    }

    // Unsaved rows exist only in the browser and belong to no server page, so they ride along
    // with whichever page is on screen rather than vanishing when the user pages away.
    const unsaved = [...this.loadedRows.values()].filter(r => this.isNewRow(r));
    return [...unsaved, ...merged];
  }

  private resetLoadedRows(): void {
    this.loadedRows.clear();
  }

  /** True while the initial fetch is in flight — drives the loading state block. */
  isLoading = false;

  /** True when the fetch failed, so the empty grid is explained as an error, not an empty roster. */
  loadError = false;

  /** Retry button on the error state. */
  retryLoad(): void {
    this.loadHeadcount();
  }

  /**
   * Resets the filter chips only. Deliberately does NOT reload: filtering is client-side
   * (`filteredHeadcountRows` is a getter), so a reload would needlessly discard unsaved edits.
   * Mirrors ForecastComponent.clearFilters().
   */
  clearFilters(): void {
    this.filters = { ...HC_DEFAULT_FILTERS };
    // Filtering is server-side now, so widening the set needs a refetch.
    this.applyFilters();
  }

  isMobileView = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;

  /**
   * Phone-sized: the two-table grid is swapped for a card list.
   *
   * 480 matches the Forecast screen's own card-view switch, so the module has ONE idea of
   * "phone" rather than one per screen. 768 keeps its existing job of narrowing the table for
   * the widths in between.
   */
  isCardView = typeof window !== 'undefined' ? window.innerWidth <= 480 : false;

  @HostListener('window:resize')
  onResize(): void {
    this.isMobileView = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    this.isCardView   = typeof window !== 'undefined' ? window.innerWidth <= 480 : false;
    if (!this.isMobileView) this.viewOptionsOpen = false;
    // A pane left open while the window grows to desktop would sit over a grid with no way to
    // close it - its Back button only renders on mobile.
    if (!this.isCardView && this.editingRow) this.applyRowEditor();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE (card view). Everything below renders only when isCardView / isMobileView, so the
  // desktop grid is untouched by construction — see the Forecast screen's notes for the
  // pattern this follows.
  // ══════════════════════════════════════════════════════════════════════════

  /** Footer popover carrying the header's toggle and Budget year, reachable mid-scroll. */
  viewOptionsOpen = false;

  toggleViewOptions(): void {
    this.viewOptionsOpen = !this.viewOptionsOpen;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClickForViewOptions(event: MouseEvent): void {
    if (!this.viewOptionsOpen) return;
    if (!(event.target as HTMLElement).closest('.hcm-opts')) this.viewOptionsOpen = false;
  }

  /** Where a pane's top edge sits, so the shell's nav stays visible above it. */
  panelTopOffset = 0;

  private measurePanelTopOffset(): number {
    // `.navbar-main`, NOT `.navbar`: the shell's off-canvas sidenav is `aside.sidenav.navbar`
    // and matches first, which measures ~524px and pushes the pane off the screen.
    const nav = document.querySelector('nav.navbar-main') as HTMLElement | null;
    if (!nav) return 0;
    const bottom = Math.round(nav.getBoundingClientRect().bottom);
    const ceiling = Math.round(window.innerHeight / 3);
    return bottom > 0 && bottom <= ceiling ? bottom : 0;
  }

  // ── Row editor ────────────────────────────────────────────────────────────
  // The card shows its fields as plain TEXT; editing happens in a full-screen pane.
  //
  // ⚠️ The pane binds DIRECTLY to the row, so the card behind it is already correct when it
  // closes. Back therefore has to UNDO: it restores the snapshot taken on open. Apply simply
  // stops reverting. Neither saves — the footer's Save posts the grid, as on desktop.

  editingRow: HeadcountRow | null = null;
  private editSnapshot: Partial<HeadcountRow> | null = null;

  /** Exactly the fields the pane can change — keep in step with its template, or Back will
   *  silently fail to revert whatever is missing. */
  private static readonly EDITABLE_FIELDS: (keyof HeadcountRow)[] =
    ['region', 'country', 'site', 'team', 'category', 'employee', 'functionForTba'];

  openRowEditor(row: HeadcountRow): void {
    const snap: Partial<HeadcountRow> = {};
    HeadcountComponent.EDITABLE_FIELDS.forEach(k => { (snap as any)[k] = (row as any)[k]; });
    this.editSnapshot = snap;
    this.editingRow = row;
    this.panelTopOffset = this.measurePanelTopOffset();
  }

  closeRowEditor(): void {
    if (this.editingRow && this.editSnapshot) {
      const row = this.editingRow, snap = this.editSnapshot;
      HeadcountComponent.EDITABLE_FIELDS.forEach(k => { (row as any)[k] = (snap as any)[k]; });
    }
    this.editingRow = null;
    this.editSnapshot = null;
  }

  applyRowEditor(): void {
    this.editingRow = null;
    this.editSnapshot = null;
  }

  /** Reads a stored site code back as its label for the card's plain-text facts. */
  siteLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return this.sites.find(o => o.value === value)?.label ?? value;
  }

  /** Same, for the Team column. Team is stored as a code and shown as a name. */
  teamLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return this.teams.find(o => o.value === value)?.label ?? value;
  }

  // ── Reference data ─────────────────────────────────────────────────────────
  // Site and Team are Admin-managed master data, loaded by loadDropdownData().
  // The rest have no lookup table yet — see the note on loadDropdownData().
  sites: SelectOption[] = [];
  /** Active users from User & Access Management, shaped for the Employee cm-hierarchy-select. */
  employeeGroups: SelectGroup[] = [];
  teams: SelectOption[] = [];

  readonly months        = HC_MONTHS;
  readonly regions       = HC_REGIONS;
  readonly countries     = HC_COUNTRIES;
  /** Employment type — NOT the spend categories behind /master/categories. */
  readonly employeeTypes = HC_EMPLOYEE_TYPES;
  readonly functions     = HC_FUNCTIONS;
  readonly scenarioYears = HC_SCENARIO_YEARS;
  readonly apiEndpoints  = HC_API_ENDPOINTS; // kept for future wiring

  // ── State ──────────────────────────────────────────────────────────────────
  filters: HeadcountFilters = { ...HC_DEFAULT_FILTERS };
  toggles: HeadcountToggles = { ...HC_DEFAULT_TOGGLES };

  // TODO: Replace with:
  //   this.http.get<HeadcountRow[]>(HC_API_ENDPOINTS.headcount.getAll())
  //     .subscribe(rows => this.headcountRows = rows);
  headcountRows: HeadcountRow[] = [];

  /**
   * True until the row has been saved: addRow() stamps unsaved rows with a NEGATIVE temp id,
   * and the reload after a successful save replaces it with the server's real one.
   */
  isNewRow(row: HeadcountRow): boolean {
    return row.id < 0;
  }

  /**
   * The rows on screen.
   *
   * Site and Team moved to the SERVER when this grid became paged — filtering the page in the
   * browser would only ever search the rows that happened to be loaded and quietly ignore every
   * other page. `headcountRows` therefore already holds the filtered page, and all that is left
   * here is the float-unsaved-to-top rule.
   */
  get filteredHeadcountRows(): HeadcountRow[] {
    const visible = this.headcountRows;

    // Unsaved rows float to the TOP so there is somewhere to type without scrolling to the end
    // of the list. DISPLAY ONLY - `headcountRows` keeps its order, which is what saveChanges()
    // stamps as `sortOrder` and what onRowDrop() reorders, so a new row still lands in its
    // normal place once saved and the reload gives it a real id. Same rule as the Forecast
    // screen; see its notes.
    const unsaved = visible.filter(r => this.isNewRow(r));
    if (unsaved.length === 0) return visible;
    return [...unsaved, ...visible.filter(r => !this.isNewRow(r))];
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  // Server-side, mirroring the Forecast grid and the Invoice View pager.

  /** Rows per page. User-selectable from the pager; 10 is the default. */
  pageSize = 10;

  readonly pageSizeOptions = [5, 10, 20, 50];

  /** Requested page. Read through `page`, which clamps it to what actually exists. */
  private pageRequested = 1;

  /** Rows matching the filter across every page. Reported by the server, not counted locally. */
  totalRowCount = 0;

  /**
   * The page actually shown.
   *
   * Clamped on READ rather than written back: this is evaluated during change detection, and
   * assigning to a field from a getter is exactly what raises
   * ExpressionChangedAfterItHasBeenChecked.
   */
  get page(): number {
    return Math.min(Math.max(1, this.pageRequested), this.totalPages);
  }

  get totalRows(): number {
    return this.totalRowCount;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalRowCount / this.pageSize));
  }

  /** 1-based index of the first row on this page (0 when the filtered set is empty). */
  get rangeStart(): number {
    return this.totalRows === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.totalRows);
  }

  get canPrev(): boolean { return this.page > 1; }
  get canNext(): boolean { return this.page < this.totalPages; }

  /** Page numbers to render, windowed around the current page with -1 as an ellipsis marker. */
  get pageNumbers(): number[] {
    const last = this.totalPages;
    if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);

    const pages: number[] = [1];
    const from = Math.max(2, this.page - 1);
    const to   = Math.min(last - 1, this.page + 1);

    if (from > 2) pages.push(-1);
    for (let p = from; p <= to; p++) pages.push(p);
    if (to < last - 1) pages.push(-1);

    pages.push(last);
    return pages;
  }

  goToPage(page: number): void {
    if (page === -1 || page === this.page || page < 1 || page > this.totalPages || this.isLoading) return;
    this.pageRequested = page;
    // `false`: this IS the page change, so resetting to page 1 would trap the pager there.
    this.loadHeadcount(false);
  }

  prevPage(): void { if (this.canPrev) this.goToPage(this.page - 1); }
  nextPage(): void { if (this.canNext) this.goToPage(this.page + 1); }

  /**
   * Rows-per-page changed. Keeps the row the user was looking at on screen rather than dumping
   * them back on page 1: the first visible row's index is preserved and the page recomputed
   * around it. Bound one-way, so `this.pageSize` still holds the OLD size here.
   */
  onPageSizeChange(newSize: number): void {
    const size = Number(newSize);
    // Guard rather than trust the control: a bad value would divide the pager by zero.
    if (!Number.isFinite(size) || size <= 0) return;

    const firstVisibleIndex = (this.page - 1) * this.pageSize;
    this.pageSize = size;
    this.pageRequested = Math.floor(firstVisibleIndex / size) + 1;
    this.loadHeadcount(false);
  }

  private resetPaging(): void {
    this.pageRequested = 1;
  }

  /** A filter or year changed: back to page 1 and refetch, since both are applied server-side. */
  applyFilters(): void {
    this.resetPaging();
    this.loadHeadcount();
  }

  /** Which year a given sub-row reads: primary → scenarioYear, other → otherScenarioYear. */
  yearFor(sub: HcScenarioRow): number {
    return sub.type === 'other' ? this.filters.otherScenarioYear : this.filters.scenarioYear;
  }

  /** The monthly values for the year that applies to this sub-row. */
  vals(sub: HcScenarioRow): (number | null)[] {
    return sub.valuesByYear[this.yearFor(sub)] ?? [];
  }

  // ── Visible scenario sub-rows ───────────────────────────────────────────────

  /** Scenario types currently shown — 'other' (Budget) only when the toggle is on. */
  get visibleScenarioTypes(): HcScenarioType[] {
    const t: HcScenarioType[] = ['primary'];
    if (this.toggles.showOtherScenario) t.push('other');
    return t;
  }

  visibleScenarioRows(row: HeadcountRow): HcScenarioRow[] {
    return row.scenarioRows.filter(s => s.type === 'primary' || this.toggles.showOtherScenario);
  }

  /** Scenario label, year-aware: e.g. 'RFC3 2026' / 'Budget 2025'. */
  scenarioLabel(type: HcScenarioType): string {
    const base = type === 'primary' ? 'RFC3' : 'Budget';
    const year = type === 'other' ? this.filters.otherScenarioYear : this.filters.scenarioYear;
    return `${base} ${year}`;
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  /** Row total = number of months the employee is present in that scenario/year. */
  getRowTotal(values: (number | null)[]): number {
    return values.reduce((s: number, v) => s + (v ?? 0), 0);
  }

  /** Column totals for the WHOLE filtered set, keyed by scenario band — see loadHeadcount. */
  private serverTotals: { [band: string]: number[] } = {};

  /**
   * Total headcount for a scenario in a given month, across every page.
   *
   * Served from the backend now. Summing the rows on screen would produce a footer covering only
   * the current page while looking exactly like a grid total — and the variance colouring below
   * reads these, so a page-only total would mis-colour the comparison too. The local sum survives
   * as the fallback for the moment before the first response lands.
   */
  getColTotal(type: HcScenarioType, mi: number): number {
    const fromServer = this.serverTotals[type];
    if (fromServer) return fromServer[mi] ?? 0;

    return this.filteredHeadcountRows.reduce((t, row) => {
      const sub = row.scenarioRows.find(s => s.type === type);
      return t + (sub ? (this.vals(sub)[mi] ?? 0) : 0);
    }, 0);
  }

  getScenarioTotal(type: HcScenarioType): number {
    return this.months.reduce((t, _, i) => t + this.getColTotal(type, i), 0);
  }

  /**
   * Variance class for the primary total against Budget for a given month.
   * red = over budget headcount, green = on/under budget. Only meaningful when
   * the Budget (other) scenario is visible.
   */
  varianceClass(mi: number): string {
    if (!this.toggles.showOtherScenario) return '';
    const primary = this.getColTotal('primary', mi);
    const other   = this.getColTotal('other', mi);
    if (primary > other) return 'hc-over';
    if (primary < other) return 'hc-under';
    return '';
  }

  // ── Binary enforcement (domain rule: 1 = present, 0 = absent, no fractions) ─
  normalizeBinary(sub: HcScenarioRow, mi: number): void {
    const arr = this.vals(sub);
    const v = arr[mi];
    arr[mi] = v && Number(v) >= 1 ? 1 : 0;
  }

  // ── Row management ─────────────────────────────────────────────────────────
  /** Temp id sequence for unsaved rows (negative → backend treats as insert). */
  private tempIdSeq = -1;

  addRow(): void {
    // New rows get a negative temp id so the backend inserts them on Save; the real
    // server id replaces it when the grid reloads after a successful save. That negative id is
    // also what isNewRow() keys the tint and the float-to-top on.
    this.headcountRows.push({
      id:             this.tempIdSeq--,
      region:         '',
      country:        '',
      site:           this.filters.site || '',
      category:       'Full Time',
      employee:       '',
      functionForTba: '',
      team:           this.filters.team || '',
      comment:        '',
      scenarioRows:   buildDefaultScenarioRows()
    });
    // Registered immediately: an unsaved row belongs to no server page, so any later fetch would
    // replace the array it was just pushed on to. mergeWithLoaded re-attaches it.
    const added = this.headcountRows[this.headcountRows.length - 1];
    this.loadedRows.set(added.id, added);
    this.resetPaging();
    // buildDefaultScenarioRows() keys its year map off the constant; the selectable years now
    // come from master data and may not be the same set.
    this.ensureYearCoverage();
    this.revealNewRow();
  }

  /**
   * Scrolls the newly added row into view.
   *
   * filteredHeadcountRows puts it at the TOP, which is off-screen for anyone who had scrolled
   * down - the button would look like it did nothing. setTimeout because the row does not exist
   * in the DOM until Angular has rendered this change.
   *
   * Instant, NOT smooth: adding the row grows the scroller, and that change of scrollHeight
   * lands mid-animation and cancels a smooth scroll (the Forecast screen measurably lost the
   * row off-screen that way).
   */
  private revealNewRow(): void {
    setTimeout(() => {
      // Scoped to the card list / left table: the first match in the document belongs to the
      // sticky drag rail, and scrolling THAT into view moves nothing useful.
      const el = this.host.nativeElement.querySelector('.hcm-card--new, .hc-left-table tr.hc-row-new');
      // A mobile card is taller than a phone viewport, and 'nearest' then aligns its BOTTOM -
      // which leaves the card header and its Edit button ~85px above the top edge. 'start' puts
      // the top of the card just under the sticky navbar. A desktop row is only ~30px tall, so
      // 'nearest' is right there: it scrolls the minimum needed and leaves the view settled.
      el?.scrollIntoView({ block: this.isCardView ? 'start' : 'nearest' });
    });
  }

  // ── Delete a row (confirmed via the shared cm-confirm-dialog) ───────────────
  /** Row awaiting confirmation; null when the dialog is closed. */
  pendingDeleteRow: HeadcountRow | null = null;

  get deleteDialogOpen(): boolean {
    return this.pendingDeleteRow !== null;
  }

  /** Names the row in the prompt so the user can tell which one they are removing. */
  get deleteDialogMessage(): string {
    const row = this.pendingDeleteRow;
    // TBA placeholder rows have no employee name — fall back to the role they will fill.
    const label = row?.employee?.trim() || row?.functionForTba?.trim();
    return label
      ? `Are you sure you want to delete the row for ${label}?`
      : 'Are you sure you want to delete this row?';
  }

  /** Opens the confirmation. The row is not touched until the user says yes. */
  askRemoveRow(row: HeadcountRow): void {
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
    // TODO: Also call HC_API_ENDPOINTS.headcount.delete(id) when API is ready. Until then a
    // removal is local-only and comes back on the next load — pre-existing, unchanged by paging.
    this.headcountRows = this.headcountRows.filter(r => r.id !== id);
    this.loadedRows.delete(id);
  }

  // ── Row reordering (drag & drop, persisted via Save) ────────────────────────
  // The drag handle lives in a rail OUTSIDE the data tables. Dragging reorders
  // the shared `headcountRows` array — both left and right tables iterate it,
  // so the whole logical row (left + right) moves as a unit. The order is
  // persisted as each row's `sortOrder`, which round-trips through the server.

  draggedRowId: number | null = null;
  dragOverRowId: number | null = null;
  /** Transient DOM node used as the drag ghost; cleaned up in dragend. */
  private dragImageEl: HTMLElement | null = null;

  // Scroll-sync between the detached drag rail and the data tables container.
  @ViewChild('railScroll')  railScrollEl?:  ElementRef<HTMLElement>;
  @ViewChild('tableScroll') tableScrollEl?: ElementRef<HTMLElement>;
  private syncingScroll = false;

  onRailScroll(): void {
    if (this.syncingScroll || !this.railScrollEl || !this.tableScrollEl) return;
    const src = this.railScrollEl.nativeElement;
    const dst = this.tableScrollEl.nativeElement;
    if (dst.scrollTop !== src.scrollTop) {
      this.syncingScroll = true;
      dst.scrollTop = src.scrollTop;
      requestAnimationFrame(() => this.syncingScroll = false);
    }
  }

  onTableScroll(): void {
    if (this.syncingScroll || !this.railScrollEl || !this.tableScrollEl) return;
    const src = this.tableScrollEl.nativeElement;
    const dst = this.railScrollEl.nativeElement;
    if (dst.scrollTop !== src.scrollTop) {
      this.syncingScroll = true;
      dst.scrollTop = src.scrollTop;
      requestAnimationFrame(() => this.syncingScroll = false);
    }
  }

  @ViewChild('leftPane')  leftPaneEl?:  ElementRef<HTMLElement>;
  @ViewChild('rightPane') rightPaneEl?: ElementRef<HTMLElement>;

  /**
   * Keeps the two panes vertically in step.
   *
   * At or below 1600px the shared scroll container is dropped and each pane scrolls on its own
   * (the split-pane media block), which is the only way to pin each pane's horizontal scrollbar
   * to its own bottom edge. The cost is that the panes would otherwise drift apart vertically
   * and the rows either side of the teal divider would stop describing the same record.
   *
   * Above 1600px both panes are overflow: visible, so no scroll event is ever raised here and
   * the original single-container behaviour is untouched.
   */
  onPaneScroll(source: 'left' | 'right'): void {
    if (this.syncingScroll || !this.leftPaneEl || !this.rightPaneEl) return;
    const src = source === 'left' ? this.leftPaneEl.nativeElement : this.rightPaneEl.nativeElement;
    const dst = source === 'left' ? this.rightPaneEl.nativeElement : this.leftPaneEl.nativeElement;
    if (dst.scrollTop === src.scrollTop) return;
    // Shared with the rail sync: one re-entrancy guard is enough because the assignment below
    // synchronously queues the paired scroll event, which the flag then swallows.
    this.syncingScroll = true;
    dst.scrollTop = src.scrollTop;
    requestAnimationFrame(() => this.syncingScroll = false);
  }

  onRowDragStart(event: DragEvent, row: HeadcountRow): void {
    this.draggedRowId = row.id;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to actually initiate the drag.
    event.dataTransfer.setData('text/plain', String(row.id));

    // Build a visible drag preview card so the user sees the row moving with
    // the cursor. The browser snapshots this DOM node at setDragImage time, so
    // inline styles are required (component-scoped CSS doesn't reach body).
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

  private dragPreviewLabel(row: HeadcountRow): string {
    const parts = [row.employee, row.site, row.team].filter(p => !!p && String(p).trim().length > 0);
    return parts.length ? parts.join(' · ') : 'Headcount row';
  }

  onRowDragOver(event: DragEvent, row: HeadcountRow): void {
    if (this.draggedRowId == null || this.draggedRowId === row.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverRowId = row.id;
  }

  onRowDragLeave(row: HeadcountRow): void {
    if (this.dragOverRowId === row.id) this.dragOverRowId = null;
  }

  onRowDrop(event: DragEvent, target: HeadcountRow): void {
    event.preventDefault();
    const srcId = this.draggedRowId;
    this.draggedRowId = null;
    this.dragOverRowId = null;
    if (srcId == null || srcId === target.id) return;

    const fromIdx = this.headcountRows.findIndex(r => r.id === srcId);
    const toIdx   = this.headcountRows.findIndex(r => r.id === target.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    // Direction-aware insertion so the source always moves in the direction
    // the user dragged:
    //   - dragging DOWN (fromIdx < toIdx): drop AFTER the target. After we
    //     splice the source out, the target's index has shifted left by 1,
    //     so inserting at `toIdx` in the post-splice array places the source
    //     just after the target.
    //   - dragging UP (fromIdx > toIdx): drop BEFORE the target. The target's
    //     index is unchanged (the splice happened after it), so inserting at
    //     `toIdx` places the source just before the target.
    // A previous version subtracted 1 in the downward case, which made
    // adjacent downward drags collapse into a no-op.
    const [moved] = this.headcountRows.splice(fromIdx, 1);
    this.headcountRows.splice(toIdx, 0, moved);
    this.renumberPageOrder();
  }

  /**
   * Rewrites `sortOrder` for the saved rows on this page after a drag.
   *
   * Needed because save no longer derives the order from the array index — under paging that
   * index restarts at 0 on every page. The rows on a page occupy a CONTIGUOUS block of global
   * positions, so the move is persisted by reusing that block's own numbers in the new visual
   * order: nothing on another page shifts, and the drag still survives a reload.
   */
  private renumberPageOrder(): void {
    const saved = this.headcountRows.filter(r => !this.isNewRow(r));
    const slots = saved
      .map(r => r.sortOrder)
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);

    saved.forEach((row, i) => { if (i < slots.length) row.sortOrder = slots[i]; });
  }

  onRowDragEnd(): void {
    this.draggedRowId = null;
    this.dragOverRowId = null;
    if (this.dragImageEl) {
      this.dragImageEl.remove();
      this.dragImageEl = null;
    }
  }

  // The localStorage row-order layer that used to live here is gone. It existed only because
  // `sortOrder` was re-derived from the array index at save time and so never round-tripped;
  // now the server's value is carried on the row and written back, which persists the order for
  // everyone rather than per browser — and, unlike a stored id list, is not silently wrong when
  // the grid only holds one page.

  // ── Monthly comments (per row, per scenario year) ───────────────────────────
  // Mirrors the Forecast screen: a per-row button opens a modal with 12 monthly
  // comment fields for the year selected in the Scenario Year dropdown, persisted
  // to localStorage. The hardcoded row.comment seed stays as a read-only reference.
  private readonly COMMENTS_KEY = 'headcount-row-comments';

  commentModalOpen = false;
  commentRow: HeadcountRow | null = null;
  /** Working copy of the 12 month comments while the modal is open. */
  commentDraft: string[] = [];

  /** The year the comment modal reads/writes — driven by the Scenario Year chip. */
  get currentYear(): number {
    return this.filters.scenarioYear;
  }

  /** Shape in localStorage: { [rowId]: { [year]: string[12] } } */
  private loadCommentStore(): Record<string, Record<string, string[]>> {
    try {
      const raw = localStorage.getItem(this.COMMENTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeCommentStore(store: Record<string, Record<string, string[]>>): void {
    localStorage.setItem(this.COMMENTS_KEY, JSON.stringify(store));
  }

  get commentModalTitle(): string {
    const label = this.commentRow?.employee || 'Row';
    return `Monthly Comments — ${label} (${this.currentYear})`;
  }

  /** Number of months with a saved comment for this row in the current year (badge). */
  commentCount(row: HeadcountRow): number {
    const saved = this.loadCommentStore()[row.id]?.[this.currentYear] ?? [];
    return saved.filter(c => !!c && c.trim().length > 0).length;
  }

  openComments(row: HeadcountRow): void {
    this.commentRow = row;
    const saved = this.loadCommentStore()[row.id]?.[this.currentYear] ?? [];
    // Always 12 slots, pre-filled with whatever was saved for this row+year.
    this.commentDraft = this.months.map((_, i) => saved[i] ?? '');
    // Mobile renders this as a pane below the shell nav, so it needs the offset measured now.
    // Harmless on desktop, where the modal path ignores it.
    this.panelTopOffset = this.measurePanelTopOffset();
    this.commentModalOpen = true;
  }

  saveComments(): void {
    if (!this.commentRow) return;
    const store = this.loadCommentStore();
    const rowKey = String(this.commentRow.id);
    if (!store[rowKey]) store[rowKey] = {};
    store[rowKey][this.currentYear] = [...this.commentDraft];
    this.writeCommentStore(store);
    this.closeComments();
  }

  /** True when this row has at least one non-empty monthly comment in any year. */
  private rowHasComments(rowId: number): boolean {
    const byYear = this.loadCommentStore()[rowId];
    if (!byYear) return false;
    return Object.values(byYear).some(months => months.some(c => !!c && c.trim().length > 0));
  }

  /**
   * Re-files comments from a new row's temporary id onto the real id the backend just assigned.
   *
   * Without this, commenting on a row BEFORE its first save loses the comment permanently: the
   * store is keyed by row id, and saving replaces a negative placeholder with a server id.
   *
   * The link is `sortOrder`, which the save above assigned deliberately and which comes back on
   * the row. One unpaged read is needed to find the new ids, because a freshly added row takes
   * the highest sortOrder and therefore lands on the LAST page — not the page about to reload.
   * Only ever runs when a new row actually carried comments, so the normal save costs nothing.
   */
  private remapNewRowComments(tempIdToSortOrder: Map<number, number>): void {
    if (tempIdToSortOrder.size === 0) return;

    this.headcountService.list().subscribe({
      next: rows => {
        const idBySortOrder = new Map<number, number>();
        for (const row of rows ?? []) {
          if (typeof row.sortOrder === 'number') idBySortOrder.set(row.sortOrder, row.id);
        }

        const store = this.loadCommentStore();
        let moved = false;

        tempIdToSortOrder.forEach((sortOrder, tempId) => {
          const realId = idBySortOrder.get(sortOrder);
          const entry = store[String(tempId)];
          // Never overwrite comments already filed against the real row.
          if (realId == null || !entry || store[String(realId)]) return;
          store[String(realId)] = entry;
          delete store[String(tempId)];
          moved = true;
        });

        if (moved) {
          this.writeCommentStore(store);
          // The badge counts read the store directly, so the reload already under way will
          // pick the re-filed comments up.
        }
      },
      // A failure here loses nothing that was not already lost; the comments stay under the
      // temporary key rather than being deleted, so a retry can still find them.
      error: err => console.error('Could not re-file comments for newly saved rows', err)
    });
  }

  closeComments(): void {
    this.commentModalOpen = false;
    this.commentRow = null;
    this.commentDraft = [];
  }

  // ── Save / Cancel ──────────────────────────────────────────────────────────
  saveChanges(): void {
    // EVERY row loaded this session, not just the page on screen: edits made on page 1 must
    // still save after paging to page 3. Rows never loaded are simply absent, which is safe
    // because the headcount bulk save only ever upserts — it does not prune what it is not sent.
    const toSave = [...new Set([...this.loadedRows.values(), ...this.headcountRows])];

    // sortOrder comes from the ROW, not from its index in the array. Under paging the index
    // restarts at 0 on every page, so index-based numbering would have page 2 renumber itself
    // over the top of page 1. New rows have none yet and go to the end.
    let nextOrder = this.totalRowCount;

    // Monthly comments are filed under the row id. An unsaved row's id is a NEGATIVE placeholder,
    // so once the backend hands back a real one every comment typed against that row would be
    // orphaned under the old key and never seen again. The sortOrder each new row is about to be
    // given is the durable link between the two, so remember it and re-file afterwards.
    const commentsToRemap = new Map<number, number>();

    const payload: HeadcountRowPayload[] = toSave.map(r => {
      const sortOrder = r.sortOrder ?? nextOrder++;
      if (this.isNewRow(r) && this.rowHasComments(r.id)) commentsToRemap.set(r.id, sortOrder);
      return { ...r, sortOrder, lastUpdatedBy: this.currentUser };
    });

    this.headcountService.bulkSave(payload).subscribe({
      next: () => {
        this.snackbar.show('Headcount saved.', 'success');
        // Everything in the cache is now on the server; keeping it would re-send saved rows and
        // pin new rows to their temporary negative ids.
        this.resetLoadedRows();
        this.remapNewRowComments(commentsToRemap);
        // Reload so new rows pick up their real server ids.
        this.loadHeadcount();
      },
      error: err => {
        const detail = err?.error?.detail || err?.error || err?.message || 'unknown error';
        this.snackbar.show(`Save failed — ${detail}`, 'error', 8000);
      }
    });
  }

  cancelChanges(): void {
    this.filters = { ...HC_DEFAULT_FILTERS };
    this.toggles = { ...HC_DEFAULT_TOGGLES };
    // The cached rows ARE the unsaved edits, so they go first — otherwise mergeWithLoaded would
    // hand the very edits being cancelled straight back.
    this.resetLoadedRows();
    this.loadHeadcount();
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  fmtTotal(v: number): string {
    return v ? formatAmount(v, 2) : '—';
  }

  /** Like fmtTotal but preserves a literal "0" (used for per-row totals). */
  fmtCount(v: number): string {
    return formatAmount(v ?? 0, 2);
  }

  // ── TrackBy helpers to prevent focus loss & DOM recreation ─────────────────
  trackByRow(index: number, row: HeadcountRow): number {
    return row.id;
  }

  trackByScenario(index: number, sub: HcScenarioRow): string {
    return sub.type;
  }

  trackByIndex(index: number, item: any): any {
    return index;
  }
}
