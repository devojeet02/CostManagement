import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import {
  AlertRecord,
  BusinessDimension,
  CostCenterDashboardData,
  CostManagementDatabase,
  DashboardFilterOption,
  DashboardKpi,
  DepartmentTower,
  FilterKey,
  FinancialAlert,
  ForecastPoint,
  InvoiceRecord,
  MonthlyCostRecord,
  ScenarioRecord,
  SpendCategory,
  VendorSpend,
} from './cost-dashboard.data';
import { COST_MANAGEMENT_DATABASE } from './cost-dashboard.records';
import {
  CostDashboardService, CostDashboardDto, DashboardGapDto, DashboardAlertDto,
  DashboardMonthPointDto, VendorInvoiceLineDto
} from '../../services/cost-dashboard.service';

type SeriesKey = 'actual' | 'forecast';

interface ChartPoint extends ForecastPoint {
  index: number;
  x: number;
  actualY: number | null;
  forecastY: number;
}

interface KpiStatusResult {
  status: string;
  trend: 'good' | 'bad' | 'neutral';
  statusIcon: 'up' | 'down' | 'flat';
  statusColor: string;
}

@Component({
  selector: 'cm-cost-dashboard',
  templateUrl: './cost-dashboard.component.html',
  styleUrls: ['./cost-dashboard.component.scss']
})
export class CostDashboardComponent implements OnInit {
  @ViewChild('pdfExportSection') pdfExportSection?: ElementRef<HTMLElement>;

  private readonly sourceData: CostManagementDatabase = COST_MANAGEMENT_DATABASE;
  private readonly donutRadius = 44;

  readonly chartWidth = 1200;
  readonly chartHeight = 300;
  readonly chartPadding = { top: 22, right: 28, bottom: 48, left: 58 };
  readonly departmentChartWidth = 940;
  readonly departmentChartHeight = 320;
  readonly departmentChartPadding = { top: 24, right: 24, bottom: 72, left: 62 };
  readonly departmentBarWidth = 56;

  hoveredChartPoint: ChartPoint | null = null;
  hoveredSeries: SeriesKey = 'forecast';
  hoveredDepartment: DepartmentTower | null = null;
  isExporting = false;

  selectedFilters: Record<FilterKey, string> = this.getInitialFilters();
  filterGroups: { key: FilterKey; options: DashboardFilterOption[] }[] = this.buildFilterGroups();
  data: CostCenterDashboardData = this.buildDashboardData();

  // ══════════════════════════════════════════════════════════════════════════
  // LIVE DATA
  //
  // This dashboard was written standalone against a sample dataset
  // (cost-dashboard.records.ts). Everything the Cost Center database can actually answer is
  // now fetched from /api/v1/cost-dashboard and OVERLAID on that sample structure:
  // KPI totals, the monthly series, and the vendor / category / department / recharge
  // breakdowns are real.
  //
  // What stays sample data — because the database has no such concept — is listed in
  // `dataGaps` and labelled on screen, so nothing invented is passed off as real:
  // financial alerts, invoice approval status, processing time, region/country/entity,
  // and the cost-tower split. Never quietly promote one of those to look live.
  // ══════════════════════════════════════════════════════════════════════════

  /** Server aggregates for the current filters. Null until the first load completes. */
  live: CostDashboardDto | null = null;
  liveLoading = false;
  liveError = false;

  /** Year the dashboard is reporting on. */
  year = new Date().getFullYear();

  // ── Site and currency (added 2026-08-24, approved by the PM and Jennifer) ─────────────
  //
  // Kept OUT of `selectedFilters`/`FilterKey` on purpose. That type and its Record are shared
  // with the sample dataset, so widening it would force a sample entry for dimensions the
  // sample has no concept of. These two are server-only and render in their own row.

  /**
   * Whether the Actuals-vs-Budget chart is showing.
   *
   * It lives in its own component (`cm-budget-trend`) and is revealed on demand rather than
   * added as a third series to the Rolling Forecast chart above. The two answer different
   * questions — forecast is "are we tracking to our latest estimate", budget is "are we within
   * what was signed off" — and keeping them apart leaves the much-used forecast chart untouched
   * while F4's remaining criteria (cumulative view, variance line) grow in the new component.
   */
  showBudgetTrend = false;

  /** Site code, '' = all sites. */
  selectedSite = '';
  siteOptions: DashboardFilterOption[] = [];

  /** Spend category NAME, '' = all. Value is the name — tblCMCategory has no code column. */
  selectedCategory = '';
  categoryOptions: DashboardFilterOption[] = [];

  /**
   * Period range in MONTHS, 1-12 (F1-AC3, F3-AC3). 1-12 = the whole year, which is the
   * behaviour that existed before this filter — so nothing changes until it is touched.
   *
   * Months rather than dates because that is the finest grain this data has; see
   * `cm-period-range`.
   */
  periodFrom = 1;
  periodTo = 12;

  get isPeriodFiltered(): boolean {
    return this.periodFrom !== 1 || this.periodTo !== 12;
  }

  /** Highest month with posted actuals — drives the picker's "Year to date" preset. */
  get actualsThroughMonth(): number {
    return this.live?.actualsThroughMonth ?? 0;
  }

  /**
   * Source of Change report (F5), opened from the toolbar.
   *
   * Deliberately just a flag: the report is a self-contained component with its own service, so
   * the dashboard neither fetches nor knows anything about it beyond whether it is showing.
   */
  sourceOfChangeOpen = false;

  openSourceOfChange(): void { this.sourceOfChangeOpen = true; }
  closeSourceOfChange(): void { this.sourceOfChangeOpen = false; }

  onPeriodChange(range: { from: number; to: number }): void {
    this.periodFrom = range.from;
    this.periodTo = range.to;
    this.loadLive();
  }

  /**
   * What the Total Spend card is actually showing.
   *
   * It said "YTD" unconditionally, which was already wrong on a past year — pick 2025 and the
   * card claimed year-to-date while showing a closed year.
   */
  private get spendCardPeriodLabel(): string {
    if (this.live?.totals.isPeriodFiltered) return this.live.totals.periodLabel;
    if (!this.live) return 'YTD';
    return this.year === new Date().getFullYear() ? 'YTD' : 'Full year';
  }

  /**
   * Status line under the Total Spend figure.
   *
   * Carries the YEAR total whenever a period is selected — that is the other half of F1-AC3,
   * and "£40k in May-Jul" means little without "£220k across the year" beside it.
   */
  private spendCardStatus(metrics: { actualYtd: number; budgetYtd: number; hasBudget: boolean }): KpiStatusResult {
    if (this.live?.totals.isPeriodFiltered) {
      return {
        status: `${this.formatMoney(this.live.totals.ytdActualSpend)} across the year`,
        trend: 'neutral',
        statusIcon: 'flat',
        statusColor: '#8fa2ba',
      };
    }

    return metrics.hasBudget
      ? this.getSpendStatus(metrics.actualYtd, metrics.budgetYtd)
      : { status: 'No budget to compare', trend: 'neutral', statusIcon: 'flat', statusColor: '#8fa2ba' };
  }

  /**
   * Site-currency codes to include. Empty = all.
   *
   * ⚠️ This REPLACES the epic's "GBP default with USD toggle", and the difference matters: a
   * toggle implies conversion, and this database has no corporate rate to convert with (see
   * the mixed-currency gap). Selecting one currency instead FILTERS, which is what makes the
   * headline totals a genuine single-currency figure rather than GBP + EUR + USD added up.
   */
  selectedCurrencies: string[] = [];
  currencyOptions: DashboardFilterOption[] = [];
  currencyMenuOpen = false;

  constructor(private dashboardService: CostDashboardService) {}

  /** False until the first response (or failure) lands — see the template's loader. */
  hasLoadedOnce = false;

  ngOnInit(): void {
    // ⚠️ selectedFilters starts from the SAMPLE dataset — including a sample department id.
    // Sending that on the first request filtered the server down to nothing, so the dashboard
    // opened empty and only populated once a filter was touched (which reset it to "All").
    // Start from "All" on every server-bound filter; the real options arrive with the response
    // and pruneSelectedFilters() keeps them valid from then on.
    this.selectedFilters = { ...this.selectedFilters, department: '', vendor: '', scenario: '' };
    this.loadLive();
  }

  private loadLive(): void {
    this.liveLoading = true;
    this.liveError = false;

    this.dashboardService.get({
      year: this.year,
      // Only the three filters with a real backing dimension are sent; the other three have
      // nothing to filter on. See the service doc.
      department: this.selectedFilters.department || null,
      vendor: this.selectedFilters.vendor || null,
      scenario: this.selectedFilters.scenario || null,
      site: this.selectedSite || null,
      category: this.selectedCategory || null,
      currencies: this.selectedCurrencies,
      // Only sent when narrower than the full year, so the request is byte-identical to what it
      // was before this filter existed whenever the period is untouched.
      fromMonth: this.isPeriodFiltered ? this.periodFrom : null,
      toMonth: this.isPeriodFiltered ? this.periodTo : null,
    }).subscribe({
      next: result => {
        this.live = result;
        this.liveLoading = false;
        this.hasLoadedOnce = true;
        this.data = this.buildDashboardData();
        // The dropdowns bind to filterGroups, not data.filters — rebuild or they keep the
        // sample options.
        this.filterGroups = this.buildFilterGroups();
        this.buildSiteAndCurrencyOptions(result);
        this.pruneSelectedFilters();
      },
      error: err => {
        console.error('Failed to load the cost dashboard', err);
        this.live = null;
        this.liveLoading = false;
        this.liveError = true;
        // Let the sample fallback render rather than leaving the loader up forever.
        this.hasLoadedOnce = true;
        // Fall back to the sample structure so the screen still renders rather than blanking.
        this.data = this.buildDashboardData();
        this.filterGroups = this.buildFilterGroups();
      },
    });
  }

  reloadLive(): void {
    this.loadLive();
  }

  onFilterChange(key: FilterKey, value: string) {
    this.selectedFilters = {
      ...this.selectedFilters,
      [key]: value,
    };
    // Department / vendor / scenario are applied server-side, so refetch. The other three
    // filter nothing, but refetching for them too keeps one code path.
    this.loadLive();
    this.data = this.buildDashboardData();
  }

  // ── Site and currency ────────────────────────────────────────────────────────────────

  /**
   * Rebuilds the Site / Currency option lists — but ONLY when their content actually changed.
   *
   * ⚠️ This guard is load-bearing, not an optimisation. Selecting a site triggers a refetch, and
   * replacing the array unconditionally made `*ngFor` destroy and recreate every `<option>`.
   * The native <select> then loses its selected node and falls back to the first one ("Site:
   * All"), while `selectedSite` still holds the real choice — so the pick vanished from the
   * closed chip the instant it was made. `[ngModel]` does not rewrite it because the model value
   * never changed, only the DOM underneath it.
   *
   * These lists come from master data and do not vary with the filters, so keeping the same
   * array identity across loads is also simply correct.
   */
  private buildSiteAndCurrencyOptions(result: CostDashboardDto): void {
    const nextSites = [
      { label: 'Site: All', value: '' },
      ...result.filters.sites.map(o => ({ label: o.label, value: o.value })),
    ];
    if (!this.sameOptions(this.siteOptions, nextSites)) this.siteOptions = nextSites;

    const nextCurrencies = result.filters.currencies.map(o => ({ label: o.label, value: o.value }));
    if (!this.sameOptions(this.currencyOptions, nextCurrencies)) this.currencyOptions = nextCurrencies;

    const nextCategories = [
      { label: 'Category: All', value: '' },
      ...(result.filters.categories ?? []).map(o => ({ label: o.label, value: o.value })),
    ];
    if (!this.sameOptions(this.categoryOptions, nextCategories)) this.categoryOptions = nextCategories;

    // A currency that has dropped out of the data would otherwise stay selected invisibly and
    // filter everything to nothing — the same trap `pruneSelectedFilters` handles for the rest.
    const live = new Set(this.currencyOptions.map(o => o.value));
    const kept = this.selectedCurrencies.filter(c => live.has(c));
    if (kept.length !== this.selectedCurrencies.length) this.selectedCurrencies = kept;
  }

  /** Same values in the same order — the test for "no need to replace the array". */
  private sameOptions(a: DashboardFilterOption[], b: DashboardFilterOption[]): boolean {
    return a.length === b.length
      && a.every((o, i) => o.value === b[i].value && o.label === b[i].label);
  }

  /**
   * Identity for `*ngFor` over the option lists.
   *
   * Belt-and-braces alongside `sameOptions`: if the list ever legitimately changes, tracking by
   * value means only the genuinely new `<option>` nodes are touched, so an unrelated selection
   * still survives the update.
   */
  trackByOptionValue(_index: number, option: DashboardFilterOption): string {
    return option.value;
  }

  onSiteChange(value: string): void {
    this.selectedSite = value;
    this.loadLive();
  }

  onCategoryChange(value: string): void {
    this.selectedCategory = value;
    this.loadLive();
  }

  // ── Vendor drill-down (F2-AC5) ───────────────────────────────────────────────────────

  vendorDrillOpen = false;
  vendorDrillName = '';
  vendorDrillRows: VendorInvoiceLineDto[] = [];
  vendorDrillTotal = 0;
  vendorDrillCurrencyMix: string[] = [];
  vendorDrillLoading = false;
  vendorDrillError = false;

  /** The panel figure for the vendor being drilled, so the modal can reconcile against it. */
  vendorDrillExpected: number | null = null;

  /**
   * Opens the drill for one vendor.
   *
   * ⚠️ Live data only. The sample fallback's vendors are invented, so there are no invoice lines
   * to show — offering a drill there would open an empty modal and look broken.
   */
  openVendorDrill(vendorName: string): void {
    if (!this.live) return;

    this.vendorDrillOpen = true;
    this.vendorDrillName = vendorName;
    this.vendorDrillRows = [];
    this.vendorDrillTotal = 0;
    this.vendorDrillCurrencyMix = [];
    this.vendorDrillError = false;
    this.vendorDrillLoading = true;

    // Credits count negatively in the breakdown, so compare against the signed figure.
    this.vendorDrillExpected =
      this.live.vendors.find(v => v.label === vendorName)?.actual ?? null;

    this.dashboardService.getVendorLines(vendorName, {
      year: this.year,
      department: this.selectedFilters.department || null,
      vendor: this.selectedFilters.vendor || null,
      site: this.selectedSite || null,
      category: this.selectedCategory || null,
      currencies: this.selectedCurrencies,
      // The period must go too, or the drill would list months the panel figure excludes.
      fromMonth: this.isPeriodFiltered ? this.periodFrom : null,
      toMonth: this.isPeriodFiltered ? this.periodTo : null,
    }).subscribe({
      next: result => {
        this.vendorDrillRows = result.lines;
        this.vendorDrillTotal = result.total;
        this.vendorDrillCurrencyMix = result.currencyMix;
        this.vendorDrillLoading = false;
      },
      error: err => {
        console.error('Failed to load vendor invoice lines', err);
        this.vendorDrillLoading = false;
        this.vendorDrillError = true;
      },
    });
  }

  closeVendorDrill(): void {
    this.vendorDrillOpen = false;
  }

  /** Only offered on live data — see openVendorDrill. */
  get canDrillVendors(): boolean {
    return !!this.live;
  }

  toggleBudgetTrend(): void {
    this.showBudgetTrend = !this.showBudgetTrend;
  }

  /** The monthly series handed to `cm-budget-trend`. Empty until the first response lands. */
  get budgetTrendMonths(): DashboardMonthPointDto[] {
    return this.live?.monthly ?? [];
  }

  /**
   * Currency label for the budget chart — only when the figures are in ONE currency.
   *
   * Blank on a mixed total, because stamping "GBP" on a GBP + EUR + USD sum would be a lie.
   * Selecting a single currency in the filter above is what makes this appear.
   */
  get budgetTrendCurrency(): string {
    return this.isSingleCurrency ? this.live!.currencyMix[0] : '';
  }

  /** Human label for the selected site, '' when none. Used by the budget chart's empty state. */
  get selectedSiteLabel(): string {
    if (!this.selectedSite) return '';
    return this.siteOptions.find(o => o.value === this.selectedSite)?.label ?? this.selectedSite;
  }

  /**
   * True when Site or Currency is narrowing the figures.
   *
   * ⚠️ Deliberately NOT the same as `hasActiveFilters`. Department, Vendor and Scenario narrow
   * the budget too, but proportionally — pick a team and you get that team's budget. Site,
   * Currency and Category can remove it ENTIRELY: a year's budget is booked against one site,
   * and budget lines carry no category at all (the Budget Planner works per team). Only those
   * three turn "no budget" into a filtering artefact rather than a real gap.
   */
  get isBudgetNarrowed(): boolean {
    return !!this.selectedSite || !!this.selectedCategory || this.selectedCurrencies.length > 0;
  }

  toggleCurrencyMenu(): void {
    this.currencyMenuOpen = !this.currencyMenuOpen;
  }

  isCurrencySelected(code: string): boolean {
    return this.selectedCurrencies.includes(code);
  }

  /** Toggles one currency. Deselecting the last one means "all", not "none". */
  toggleCurrency(code: string): void {
    this.selectedCurrencies = this.isCurrencySelected(code)
      ? this.selectedCurrencies.filter(c => c !== code)
      : [...this.selectedCurrencies, code];
    this.loadLive();
  }

  clearCurrencies(): void {
    if (this.selectedCurrencies.length === 0) return;
    this.selectedCurrencies = [];
    this.loadLive();
  }

  /** What the closed currency chip reads. */
  get currencyLabel(): string {
    const n = this.selectedCurrencies.length;
    if (n === 0) return 'Currency: All';
    if (n === 1) return `Currency: ${this.selectedCurrencies[0]}`;
    return `Currency: ${this.selectedCurrencies.length} selected`;
  }

  /**
   * True when the figures are a single-currency total — the point of the currency filter.
   * Drives the reassurance shown beside it, the counterpart to the mixed-currency warning.
   */
  get isSingleCurrency(): boolean {
    return !!this.live && this.live.currencyMix.length === 1;
  }

  /** The one currency the totals are in, when there is exactly one. Read by the template as a
   *  getter rather than `live?.currencyMix?.[0]` — indexed optional access is awkward in an
   *  Angular 15 template and reads worse than naming the thing. */
  get singleCurrencyCode(): string {
    return this.isSingleCurrency ? this.live!.currencyMix[0] : '';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.currencyMenuOpen) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.currency-multiselect')) this.currencyMenuOpen = false;
  }

  // ── DISABLED 2026-08-20: PDF export needs html2canvas + jspdf, neither of which is
  //    installed in this project. Adding two npm dependencies to a shared package.json is
  //    a separate decision, so the feature is parked rather than the packages assumed.
  //
  //    TO RESTORE:  npm install html2canvas jspdf
  //                 then uncomment this method AND the Export button in the template.
  //
  //    `isExporting` is left live — the template still binds it, and it simply stays false.
  //   async exportPdf() {
  //     if (this.isExporting) return;
  //
  //     this.isExporting = true;
  //     this.clearHoveredChartPoint();
  //     this.clearHoveredDepartment();
  //
  //     const exportElement = this.pdfExportSection?.nativeElement;
  //     if (!exportElement) {
  //       this.isExporting = false;
  //       return;
  //     }
  //
  //     const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  //
  //     document.body.classList.add('dashboard-pdf-exporting');
  //
  //     try {
  //       await new Promise((resolve) => window.requestAnimationFrame(resolve));
  //
  //       const canvas = await html2canvas(exportElement, {
  //         backgroundColor: '#071b2f',
  //         scale: 2,
  //         useCORS: true,
  //       });
  //       const imageData = canvas.toDataURL('image/png');
  //       const pdf = new jsPDF({
  //         orientation: 'landscape',
  //         unit: 'px',
  //         format: [canvas.width, canvas.height],
  //       });
  //
  //       pdf.addImage(imageData, 'PNG', 0, 0, canvas.width, canvas.height);
  //       pdf.save(`cost-center-department-performance-${this.getExportDateStamp()}.pdf`);
  //     } finally {
  //       document.body.classList.remove('dashboard-pdf-exporting');
  //       this.isExporting = false;
  //     }
  //   }

  /** Parked — see the note above. Kept so the template binding still resolves. */
  exportPdf(): void {
    /* no-op while the PDF packages are not installed */
  }

  private buildDashboardData(): CostCenterDashboardData {
    const selectedScenario = this.selectedScenario;
    const dashboardDepartment = this.defaultDepartment;
    const topRows = this.getFilteredCostRows();
    const topInvoices = this.getFilteredInvoices();
    const dashboardRows = this.getDashboardCostRows();
    const dashboardInvoices = this.getDashboardInvoices();
    const actualMonths = this.getActualMonths(topRows);
    const actualLoadedLabel = this.formatActualsLoaded(actualMonths);
    // Real figures where the database has them, sample figures otherwise. `live` is null
    // only before the first response lands or after a failed load.
    const L = this.live;

    const actualYtd = L
      ? L.totals.actualSpend
      : this.sum(topRows.filter((row) => row.actualAmount > 0), 'actualAmount');

    // Budget-to-date. With no Budget scenario rows there is nothing to compare against, so
    // this stays 0 and the variance card is suppressed rather than reporting the whole of
    // spend as "over budget".
    const budgetYtd = L
      ? (L.totals.hasBudgetData ? L.totals.budgetTotal : 0)
      : this.sum(topRows.filter((row) => actualMonths.includes(row.month)), 'budgetAmount');

    const totalBudget = L
      ? (L.totals.hasBudgetData ? L.totals.budgetTotal : 0)
      : this.sum(topRows, 'budgetAmount');

    const totalForecast = L ? L.totals.forecastTotal : this.sum(topRows, 'forecastAmount');
    const unbudgetedSpend = L ? L.totals.unbudgetedSpend : this.sum(topRows, 'unbudgetedAmount');
    const variance = actualYtd - budgetYtd;

    return {
      filters: L ? this.liveFilters(L) : this.buildFiltersObject(),
      kpis: this.buildKpis({
        actualYtd,
        budgetYtd,
        totalBudget,
        totalForecast,
        // Real count when live. The sample data filters on `status === 'processed'`; here
        // every saved invoice counts as processed (no approval workflow yet), so the two
        // agree in meaning — see the invoiceStatus data gap.
        invoiceCount: L ? L.totals.processedInvoiceCount
                        : topInvoices.filter((invoice) => invoice.status === 'processed').length,
        unbudgetedSpend,
        variance,
        // A missing budget must not be treated as a budget of zero — see buildKpis.
        hasBudget: L ? L.totals.hasBudgetData : true,
        creditNoteCount: L ? L.totals.creditNoteCount : 0,
      }),
      forecast: {
        // The sample scenarios carry revision labels ('Jul RFC', 'RFC2 Jun') and revisionMonth
        // pins that have no equivalent here — real scenarios are just codes (FC, RFC1). Show
        // the scenario actually selected instead of a sample revision name.
        activeRevision: L ? this.liveScenarioLabel() : selectedScenario.revisionLabel,
        actualsLoaded: L ? (L.actualsThroughMonth > 0
                            ? CostDashboardComponent.MONTH_LABELS[L.actualsThroughMonth - 1] + ' ' + L.year
                            : 'none yet')
                        : actualLoadedLabel,
        revisionNote: L ? this.liveRevisionNote() : this.getRevisionNote(),
        points: L ? this.liveForecastPoints(L) : this.buildForecastPoints(topRows),
      },
      vendors: L ? this.liveVendors(L) : this.buildVendorSpend(),
      alertLegend: [
        { label: 'Red', description: 'urgent financial risk', color: '#ff4f5e' },
        { label: 'Blue', description: 'operational attention', color: '#3a82ff' },
        { label: 'Green', description: 'ready or healthy approval state', color: '#14d59a' },
      ],
      alerts: L ? this.liveAlerts(L) : this.buildAlerts(),
      // ⚠️ The legend must name the baseline actually in use. It said "under forecast" while no
      // budget existed; now that the Budget Planner can populate BUD it has to switch, or the
      // chart claims to measure something it isn't.
      departmentLegend: [
        { label: L?.totals.hasBudgetData ? 'Budget baseline' : 'Rolling Forecast baseline',
          color: '#8fa2ba', style: 'line' },
        { label: 'Actual YTD', color: '#6559ee', style: 'bar' },
        { label: L?.totals.hasBudgetData ? 'Budget remaining' : 'Forecast remainder',
          color: '#ffcf3d', style: 'bar' },
        { label: 'Red = overspend', color: '#ff6477', style: 'pill' },
        { label: L?.totals.hasBudgetData ? 'Green = on/under budget' : 'Green = under forecast',
          color: '#14d59a', style: 'pill' },
      ],
      departments: L ? this.liveDepartments(L) : this.buildDepartmentTowers(dashboardRows),
      // Live data groups by TEAM (the schema's nearest thing to a department), not by the
      // sample's IT cost towers — so the heading must not keep claiming otherwise.
      departmentTitle: L ? 'Department Performance' : `${dashboardDepartment.label} Department Performance`,
      departmentName: L ? 'All departments' : dashboardDepartment.label,
      departmentSubtitle: L
        ? 'Forecast vs actual by team, for the selected filters'
        : `IT department only - ${this.sourceData.company.name} split across core cost towers`,
      departmentDescription: L
        ? 'Each bar is a team: actual spend against its forecast for the year.'
        : (dashboardDepartment.subtitle ?? dashboardDepartment.label),
      recharge: L ? this.liveRecharge(L) : this.buildRecharge(),
      categories: L ? this.liveCategories(L) : this.buildCategories(dashboardRows),
      invoiceActivity: L ? this.liveInvoiceActivity(L) : this.buildInvoiceActivity(dashboardInvoices),
    };
  }

  get maxDepartmentTotal(): number {
    return this.departmentMaxValue;
  }

  get departmentMaxValue(): number {
    const maxValue = Math.max(...this.data.departments.flatMap((item) => [item.forecast, item.actual + item.remainder]), 1);
    return this.getNiceAxisMax(maxValue);
  }

  get departmentYAxisTicks(): number[] {
    const tickCount = 4;
    const step = this.departmentMaxValue / tickCount;
    return Array.from({ length: tickCount + 1 }, (_, index) => this.round(step * index, 2));
  }

  get departmentPlotWidth(): number {
    return this.departmentChartWidth - this.departmentChartPadding.left - this.departmentChartPadding.right;
  }

  get departmentPlotHeight(): number {
    return this.departmentChartHeight - this.departmentChartPadding.top - this.departmentChartPadding.bottom;
  }

  getDepartmentX(index: number): number {
    const spacing = this.departmentPlotWidth / Math.max(this.data.departments.length, 1);
    return this.departmentChartPadding.left + spacing * index + spacing / 2;
  }

  getDepartmentBarX(index: number): number {
    return this.getDepartmentX(index) - this.departmentBarWidth / 2;
  }

  getDepartmentBarEndX(index: number): number {
    return this.getDepartmentX(index) + this.departmentBarWidth / 2;
  }

  getDepartmentY(value: number): number {
    const baseline = this.departmentChartHeight - this.departmentChartPadding.bottom;
    return baseline - (value / this.departmentMaxValue) * this.departmentPlotHeight;
  }

  getDepartmentBarHeight(value: number): number {
    return (value / this.departmentMaxValue) * this.departmentPlotHeight;
  }

  getDepartmentVarianceColor(tower: DepartmentTower): string {
    return tower.variancePercent > 0 ? tower.positiveColor : tower.negativeColor;
  }

  getDepartmentVarianceLabel(tower: DepartmentTower): string {
    return `${tower.variancePercent > 0 ? '+' : ''}${tower.variancePercent}%`;
  }

  setHoveredDepartment(tower: DepartmentTower) {
    this.hoveredDepartment = tower;
  }

  clearHoveredDepartment() {
    this.hoveredDepartment = null;
  }

  getDepartmentTooltipX(tower: DepartmentTower): number {
    const index = this.data.departments.indexOf(tower);
    return Math.min(this.departmentChartWidth - 245, Math.max(70, this.getDepartmentX(index) - 104));
  }

  getDepartmentTooltipY(tower: DepartmentTower): number {
    return Math.max(34, this.getDepartmentY(tower.actual + tower.remainder) - 112);
  }

  get chartMaxValue(): number {
    // Scales to what is plotted — cumulative totals dwarf monthly ones, so a fixed scale would
    // flatten one view or clip the other.
    const maxValue = Math.max(...this.forecastSeries.flatMap((point) => [point.forecast, point.actual ?? 0]), 1);
    return this.getNiceAxisMax(maxValue);
  }

  get yAxisTicks(): number[] {
    const tickCount = 5;
    const step = this.chartMaxValue / tickCount;
    return Array.from({ length: tickCount + 1 }, (_, index) => this.round(step * index, 2));
  }

  // ── Monthly / cumulative on the Rolling Forecast chart ───────────────────────────────
  //
  // Added after the same switch on the budget chart. ⚠️ Defaults to 'monthly', so this chart
  // renders exactly as it always has until someone deliberately switches — the view everyone
  // is used to is still the one they get.

  forecastMode: 'monthly' | 'cumulative' = 'monthly';

  setForecastMode(mode: 'monthly' | 'cumulative'): void {
    this.forecastMode = mode;
    // A tooltip holding monthly figures over a cumulative chart would be wrong.
    this.hoveredChartPoint = null;
  }

  /**
   * The forecast series actually plotted — raw months, or their running totals.
   *
   * Same two rules as the budget chart, for the same reasons:
   * 1. The ACTUAL line still starts and ends where real data does. Accumulating from January
   *    would plot 0 for months not yet loaded, and running to December would hold a flat line
   *    across months that have not happened — both assert "we spent nothing".
   * 2. Forecast accumulates across the whole year, because it is known up front.
   *
   * Revision markers ride along untouched: they belong to a month, not to a value.
   */
  private get forecastSeries(): ForecastPoint[] {
    const points = this.data.forecast.points;
    if (this.forecastMode === 'monthly') return points;

    const actualIndexes = points
      .map((p, i) => (p.actual !== null ? i : -1))
      .filter((i) => i >= 0);
    const firstActual = actualIndexes.length ? actualIndexes[0] : -1;
    const lastActual = actualIndexes.length ? actualIndexes[actualIndexes.length - 1] : -1;

    let runningActual = 0;
    let runningForecast = 0;

    return points.map((p, i) => {
      if (p.actual !== null) runningActual += p.actual;
      runningForecast += p.forecast;

      const inActualRange = firstActual >= 0 && i >= firstActual && i <= lastActual;

      return {
        ...p,
        actual: inActualRange ? runningActual : null,
        forecast: runningForecast,
      };
    });
  }

  get chartPoints(): ChartPoint[] {
    const points = this.forecastSeries;
    const plotWidth = this.chartWidth - this.chartPadding.left - this.chartPadding.right;

    return points.map((point, index) => {
      const x = this.chartPadding.left + (plotWidth / Math.max(points.length - 1, 1)) * index;

      return {
        ...point,
        index,
        x,
        actualY: point.actual === null ? null : this.getChartY(point.actual),
        forecastY: this.getChartY(point.forecast),
      };
    });
  }

  get actualPath(): string {
    return this.buildPath(this.chartPoints.filter((point) => point.actual !== null), 'actual');
  }

  get forecastPath(): string {
    return this.buildPath(this.chartPoints, 'forecast');
  }

  get forecastAreaPath(): string {
    const points = this.chartPoints;
    if (!points.length) return '';

    const baseline = this.chartHeight - this.chartPadding.bottom;
    const line = this.buildPath(points, 'forecast');
    const last = points[points.length - 1];
    const first = points[0];
    return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  }

  // ── "Today" marker ───────────────────────────────────────────────────────────────────
  //
  // ⚠️ This was pinned to `sourceData.company.asOfDate` — a hardcoded SAMPLE date
  // ('2026-07-09'). It therefore never moved, and worse, it drew a "Today" line at July's
  // position no matter which year was selected: a marker claiming to be today, sitting inside a
  // closed year, is actively misleading.
  //
  // It now reads the real clock, and only renders when the chart is actually showing the current
  // year — see `showTodayMarker`.

  /** True only when the selected year is the real current year. */
  get showTodayMarker(): boolean {
    return this.year === new Date().getFullYear();
  }

  // ── Dragging the marker ──────────────────────────────────────────────────────────────
  //
  // The marker can be dragged across the chart to read it like a ruler. Its APPEARANCE never
  // changes — same dotted line, same "Today <date>" pill — because it is a reading aid, not a
  // mode. It also moves FREELY rather than snapping: the tooltip appears only once the line
  // reaches a plotted point, so arriving at a dot is the thing that reveals a reading.

  @ViewChild('forecastSvg') forecastSvg?: ElementRef<SVGSVGElement>;

  /** Free x position while dragged, in SVG units. Null = sitting on the real today. */
  scrubX: number | null = null;
  isScrubbing = false;

  /** Whether the pointer actually moved between mousedown and mouseup — see onMarkerClick. */
  private didDrag = false;

  /** Where the press started, so a jittery click is not mistaken for a drag. */
  private downX = 0;

  /**
   * How far the pointer must travel before a press counts as a drag, in client px.
   *
   * ⚠️ Not zero. A mousemove almost always fires between mousedown and mouseup — both from a
   * real hand and from automation — so treating ANY movement as a drag meant "click to go back"
   * never fired: the click nudged the marker a few pixels instead of resetting it.
   */
  private static readonly DRAG_THRESHOLD_PX = 3;

  /** How near a point the line must get before its tooltip shows, in SVG units. */
  private static readonly POINT_SNAP_RADIUS = 16;

  get markerX(): number {
    return this.scrubX ?? this.todayX;
  }

  /** True once the marker has been moved off the real today. */
  get isMarkerMoved(): boolean {
    return this.scrubX !== null;
  }

  /**
   * The date the marker is currently sitting on, derived from its x position.
   *
   * The chart plots twelve monthly points, so a position BETWEEN them is a fraction through that
   * month — turned back into a real day here so dragging reads like a calendar rather than a
   * pixel offset. Uses the month's real length, so 15 Feb lands mid-February.
   */
  get markerDateLabel(): string {
    const plotWidth = this.chartWidth - this.chartPadding.left - this.chartPadding.right;
    const fractionalIndex = Math.min(11, Math.max(0,
      (this.markerX - this.chartPadding.left) / (plotWidth / 11)));

    const monthIndex = Math.min(11, Math.floor(fractionalIndex));
    const daysInMonth = new Date(this.year, monthIndex + 1, 0).getDate();
    const day = Math.min(daysInMonth, Math.max(1,
      Math.round((fractionalIndex - monthIndex) * daysInMonth) + 1));

    return new Date(this.year, monthIndex, day)
      .toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  /**
   * What the pill reads.
   *
   * Three states: on today, being dragged (the live date), and parked somewhere else — where it
   * offers the way back rather than leaving a stale date with no obvious undo.
   */
  get markerLabel(): string {
    if (!this.isMarkerMoved) return `Today ${this.todayLabel}`;
    if (this.isScrubbing) return this.markerDateLabel;
    return 'Go back to Today';
  }

  /** The pill is the drag handle, so it has to fit its own text at every state. */
  get markerPillWidth(): number {
    if (!this.isMarkerMoved) return 74;
    return this.isScrubbing ? 52 : 104;
  }

  startScrub(event: MouseEvent): void {
    event.preventDefault();     // stop the browser starting a native drag
    event.stopPropagation();
    this.isScrubbing = true;
    this.didDrag = false;
    this.downX = event.clientX;
    // NOT scrubTo() here: jumping the marker under the cursor on mousedown makes a plain click
    // shift it, which stops "click to go back" from working.
  }

  @HostListener('document:mousemove', ['$event'])
  onScrubMove(event: MouseEvent): void {
    if (!this.isScrubbing) return;
    // Below the threshold this is still a click, so leave the marker where it is.
    if (Math.abs(event.clientX - this.downX) < CostDashboardComponent.DRAG_THRESHOLD_PX) return;
    this.didDrag = true;
    this.scrubTo(event.clientX);
  }

  @HostListener('document:mouseup')
  onScrubEnd(): void {
    this.isScrubbing = false;
  }

  /**
   * A click on the pill returns the marker to today — but only when it is parked away from it,
   * which is the state where the pill reads "Go back to Today".
   *
   * ⚠️ A drag ends with a click too, so this checks `didDrag`. Without it, dragging the marker
   * and releasing would immediately snap it back and undo the drag.
   */
  onMarkerClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.didDrag || !this.isMarkerMoved) return;
    this.resetScrub();
  }

  /** Returns the marker to the real today and drops the tooltip. */
  resetScrub(event?: Event): void {
    event?.stopPropagation();
    this.scrubX = null;
    this.hoveredChartPoint = null;
  }

  /**
   * Moves the marker to a page X coordinate and reveals a reading only when it reaches a point.
   *
   * ⚠️ The chart is a viewBox-scaled SVG, so a client coordinate is NOT an SVG coordinate — it
   * must be divided by the element's rendered width. Without that the line drifts further from
   * the pointer the wider the window gets.
   */
  private scrubTo(clientX: number): void {
    const svg = this.forecastSvg?.nativeElement;
    const points = this.chartPoints;
    if (!svg || points.length === 0) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;

    const raw = (clientX - rect.left) * (this.chartWidth / rect.width);
    // Kept inside the plot area — a marker in the margins points at nothing.
    this.scrubX = Math.min(
      this.chartWidth - this.chartPadding.right,
      Math.max(this.chartPadding.left, raw),
    );

    let nearest: ChartPoint | null = null;
    let best = Infinity;
    for (const point of points) {
      const distance = Math.abs(point.x - this.scrubX);
      if (distance < best) { best = distance; nearest = point; }
    }

    // Between months there is nothing to report, so the tooltip clears rather than lingering on
    // whichever point happened to be closest.
    if (nearest && best <= CostDashboardComponent.POINT_SNAP_RADIUS) {
      this.hoveredChartPoint = nearest;
      this.hoveredSeries = nearest.actual !== null ? 'actual' : 'forecast';
    } else {
      this.hoveredChartPoint = null;
    }
  }


  get todayX(): number {
    const now = new Date();
    // Fraction THROUGH the current month, using that month's real length — the old code divided
    // by a fixed 31, which drifted the marker in every shorter month (up to ~3 days out in Feb).
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayProgress = (now.getDate() - 1) / daysInMonth;

    const fractionalIndex = Math.min(11, Math.max(0, now.getMonth() + dayProgress));
    const plotWidth = this.chartWidth - this.chartPadding.left - this.chartPadding.right;
    // 12 points span the width at 11 intervals, so the step is plotWidth / 11.
    return this.chartPadding.left + (plotWidth / 11) * fractionalIndex;
  }

  get todayLabel(): string {
    // en-GB to match the rest of the module; the sample-era code used en-US.
    return new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  setHoveredChartPoint(point: ChartPoint, series: SeriesKey) {
    this.hoveredChartPoint = point;
    this.hoveredSeries = series;
  }

  clearHoveredChartPoint() {
    this.hoveredChartPoint = null;
  }

  getTooltipX(point: ChartPoint): number {
    return Math.min(this.chartWidth - 232, Math.max(68, point.x - 96));
  }

  getTooltipY(point: ChartPoint): number {
    const y = this.hoveredSeries === 'actual' && point.actualY !== null ? point.actualY : point.forecastY;
    return Math.max(34, y - 108);
  }

  formatChartMoney(value: number | null): string {
    return value === null ? 'Forecast only' : this.formatMoney(value);
  }

  formatAxisMoney(value: number): string {
    if (value === 0) return '0';
    return this.formatMoney(value);
  }

  getRevisionLabel(point: ChartPoint): string {
    return point.revisionLabel ?? this.data.forecast.activeRevision;
  }

  getChartY(value: number): number {
    const plotHeight = this.chartHeight - this.chartPadding.top - this.chartPadding.bottom;
    const baseline = this.chartHeight - this.chartPadding.bottom;
    return baseline - (value / this.chartMaxValue) * plotHeight;
  }

  getKpiIcon(kpi: DashboardKpi): string {
    const icons: Record<string, string> = {
      'Total Spend': '$',
      'Budget Allocated': '%',
      Variance: '+/-',
      'Rolling Forecast': 'RF',
      'Invoices Processed': '#',
      'Unbudgeted Spend': '!',
    };

    return icons[kpi.label] ?? kpi.icon;
  }

  getRechargeSegmentDashArray(value: number): string {
    const circumference = 2 * Math.PI * this.donutRadius;
    const segmentLength = (value / 100) * circumference;
    return `${segmentLength} ${Math.max(0, circumference - segmentLength)}`;
  }

  getRechargeSegmentOffset(index: number): number {
    const cumulativePercent = this.data.recharge.slices.slice(0, index).reduce((sum, slice) => sum + slice.value, 0);
    const circumference = 2 * Math.PI * this.donutRadius;
    return -(cumulativePercent / 100) * circumference;
  }

  /**
   * Options for the six dropdowns.
   *
   * ⚠️ Reads LIVE filters when they have arrived. This used to call `buildFiltersObject()`
   * directly and was only ever evaluated once, at construction — so the dropdowns kept showing
   * the ported sample values (Americas/EMEA, invented vendors) no matter what the server
   * returned. `filterGroups` must therefore be rebuilt whenever `live` changes; see loadLive().
   */
  private buildFilterGroups(): { key: FilterKey; options: DashboardFilterOption[] }[] {
    const filters = this.live ? this.liveFilters(this.live) : this.buildFiltersObject();
    return [
      { key: 'region', options: filters.region },
      { key: 'country', options: filters.country },
      { key: 'entity', options: filters.entity },
      { key: 'department', options: filters.department },
      { key: 'vendor', options: filters.vendor },
      { key: 'scenario', options: filters.scenario },
    ];
  }

  private buildFiltersObject(): Record<FilterKey, DashboardFilterOption[]> {
    return {
      region: this.buildDimensionOptions('Region', this.sourceData.dimensions.regions, 'Global'),
      country: this.buildDimensionOptions('Country', this.sourceData.dimensions.countries),
      entity: this.buildDimensionOptions('Entity', this.sourceData.dimensions.entities),
      department: this.buildDimensionOptions('Department', this.sourceData.dimensions.departments, undefined, false),
      vendor: this.buildDimensionOptions('Vendor', this.sourceData.dimensions.vendors),
      scenario: this.sourceData.scenarios.map((scenario) => ({ label: `Scenario: ${scenario.label}`, value: scenario.id })),
    };
  }

  private buildDimensionOptions(prefix: string, dimensions: BusinessDimension[], allLabel = 'All', includeAll = true): DashboardFilterOption[] {
    const options = dimensions.map((item) => ({ label: `${prefix}: ${item.label}`, value: item.id }));
    return includeAll ? [{ label: `${prefix}: ${allLabel}`, value: 'all' }, ...options] : options;
  }


  /**
   * Drops any selection that does not exist in the live option lists.
   *
   * The initial values come from the sample dataset — a sample department id, a sample
   * scenario id, and `'all'` as its everything-sentinel where the live lists use `''`. None of
   * those survive the switch to real master data, and a `<select>` bound to a value with no
   * matching `<option>` renders blank. Anything unrecognised falls back to the list's first
   * option, which is always "All …".
   */
  private pruneSelectedFilters(): void {
    const next = { ...this.selectedFilters };

    for (const group of this.filterGroups) {
      const values = group.options.map((o) => o.value);
      if (!values.includes(next[group.key])) {
        next[group.key] = group.options[0]?.value ?? '';
      }
    }

    this.selectedFilters = next;
  }

  private getInitialFilters(): Record<FilterKey, string> {
    return {
      region: 'all',
      country: 'all',
      entity: 'all',
      department: this.sourceData.dimensions.departments[0]?.id ?? 'all',
      vendor: 'all',
      scenario: this.sourceData.scenarios.find((scenario) => scenario.isActive)?.id ?? this.sourceData.scenarios[0]?.id ?? 'budget',
    };
  }

  private get selectedScenario(): ScenarioRecord {
    return this.sourceData.scenarios.find((scenario) => scenario.id === this.selectedFilters.scenario) ?? this.sourceData.scenarios[0];
  }

  private get defaultScenario(): ScenarioRecord {
    return this.sourceData.scenarios.find((scenario) => scenario.isActive) ?? this.sourceData.scenarios[0];
  }

  private get defaultDepartment(): BusinessDimension {
    return this.sourceData.dimensions.departments[0];
  }

  private getFilteredCostRows(includeVendor = true): MonthlyCostRecord[] {
    return this.sourceData.monthlyCosts.filter((row) => {
      if (row.scenarioId !== this.selectedFilters.scenario) return false;
      if (!this.matchesFilter(row.regionId, this.selectedFilters.region)) return false;
      if (!this.matchesFilter(row.countryId, this.selectedFilters.country)) return false;
      if (!this.matchesFilter(row.entityId, this.selectedFilters.entity)) return false;
      if (!this.matchesFilter(row.departmentId, this.selectedFilters.department)) return false;
      if (includeVendor && !this.matchesFilter(row.vendorId, this.selectedFilters.vendor)) return false;
      return true;
    });
  }

  private getFilteredInvoices(includeVendor = true): InvoiceRecord[] {
    return this.sourceData.invoices.filter((invoice) => {
      if (!this.matchesFilter(invoice.regionId, this.selectedFilters.region)) return false;
      if (!this.matchesFilter(invoice.countryId, this.selectedFilters.country)) return false;
      if (!this.matchesFilter(invoice.entityId, this.selectedFilters.entity)) return false;
      if (!this.matchesFilter(invoice.departmentId, this.selectedFilters.department)) return false;
      if (includeVendor && !this.matchesFilter(invoice.vendorId, this.selectedFilters.vendor)) return false;
      return true;
    });
  }

  private getDashboardCostRows(): MonthlyCostRecord[] {
    return this.sourceData.monthlyCosts.filter(
      (row) => row.scenarioId === this.defaultScenario.id && row.departmentId === this.defaultDepartment.id,
    );
  }

  private getDashboardInvoices(): InvoiceRecord[] {
    return this.sourceData.invoices.filter((invoice) => invoice.departmentId === this.defaultDepartment.id);
  }

  private buildKpis(metrics: {
    actualYtd: number;
    budgetYtd: number;
    totalBudget: number;
    totalForecast: number;
    invoiceCount: number;
    unbudgetedSpend: number;
    variance: number;
    /** False when no Budget scenario rows exist — see below. */
    hasBudget: boolean;
    creditNoteCount: number;
  }): DashboardKpi[] {
    const forecastVariancePercent = metrics.totalBudget > 0 ? ((metrics.totalForecast - metrics.totalBudget) / metrics.totalBudget) * 100 : 0;
    const budgetUsagePercent = metrics.totalBudget > 0 ? (metrics.actualYtd / metrics.totalBudget) * 100 : 0;

    // ⚠️ With no Budget scenario rows, three cards would otherwise divide by a budget of zero
    // and report nonsense: "0% Used" in green, and the WHOLE of spend as variance "over
    // budget". A missing budget is not an under-spend — these say so instead of computing.
    const noBudget: KpiStatusResult = {
      status: 'No budget entered',
      trend: 'neutral',
      statusIcon: 'flat',
      statusColor: '#8fa2ba',
    };

    return [
      // ⚠️ The period label matters. This card read "YTD" unconditionally, which was wrong on
      // any past year and doubly wrong once a period filter existed. It now names what it is
      // actually showing, and the YTD figure moves into the status line beside it so the year
      // context is never lost (F1-AC3 — "displays both current period and year-to-date").
      this.createKpi('Total Spend', this.spendCardPeriodLabel, metrics.actualYtd, 'money',
        this.spendCardStatus(metrics),
        '$'),

      this.createKpi('Budget Allocated', '', metrics.totalBudget, 'money',
        metrics.hasBudget ? this.getBudgetStatus(budgetUsagePercent) : noBudget, '%',
        metrics.hasBudget ? undefined : 'Not entered'),

      this.createKpi('Variance', 'vs Budget', metrics.variance, 'money',
        metrics.hasBudget ? this.getVarianceStatus(metrics.variance) : noBudget, '+/-',
        metrics.hasBudget ? undefined : '—'),

      this.createKpi('Rolling Forecast', 'FY', metrics.totalForecast, 'money',
        metrics.hasBudget ? this.getForecastStatus(forecastVariancePercent) : noBudget, 'RF'),

      // Was a hardcoded green "+ live" trend — a fake signal on every load. Reports the
      // credit notes netted off instead, which is real and worth knowing.
      this.createKpi('Invoices Processed', '', metrics.invoiceCount, 'count',
        metrics.creditNoteCount > 0
          ? { status: metrics.creditNoteCount + ' credit note' + (metrics.creditNoteCount === 1 ? '' : 's') + ' netted off',
              trend: 'neutral', statusIcon: 'flat', statusColor: '#8fa2ba' }
          : { status: 'No credit notes', trend: 'good', statusIcon: 'flat', statusColor: '#14d59a' },
        '#'),

      this.createKpi('Unbudgeted Spend', '', metrics.unbudgetedSpend, 'money', this.getUnbudgetedStatus(metrics.unbudgetedSpend), '!'),
    ];
  }

  private createKpi(
    label: string,
    period: string,
    value: number,
    unit: 'money' | 'count',
    status: KpiStatusResult,
    icon: string,
    /** Replaces the formatted number, e.g. "Not entered" when there is no budget at all. */
    valueOverride?: string,
  ): DashboardKpi {
    return {
      label,
      period,
      baseValue: value,
      unit,
      value: valueOverride
        ?? (unit === 'count' ? this.formatCount(value) : this.formatSignedMoney(label === 'Variance' ? value : Math.abs(value), label === 'Variance')),
      status: status.status,
      trend: status.trend,
      statusIcon: status.statusIcon,
      statusColor: status.statusColor,
      icon,
      iconColor: label === 'Total Spend' ? '#ffffff' : '#aab5c3',
    };
  }


  // ══════════════════════════════════════════════════════════════════════════
  // LIVE MAPPERS — server aggregates → the shapes the template already renders
  //
  // These deliberately reuse the sample data's colour palette and label style: only the
  // NUMBERS become real, the presentation is unchanged, so the dashboard looks the same
  // whether it is showing live or sample figures.
  // ══════════════════════════════════════════════════════════════════════════

  private static readonly MONTH_LABELS =
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  private paletteFor(index: number, palette: string[] = ['#347cff', '#6559ee', '#14d59a', '#ffcf3d', '#ff6477', '#22c79a']): string {
    return palette[index % palette.length];
  }

  private liveForecastPoints(L: CostDashboardDto): ForecastPoint[] {
    return L.monthly.map((m) => ({
      month: CostDashboardComponent.MONTH_LABELS[m.month - 1],
      monthKey: String(m.month),
      // Null is meaningful: the chart breaks the actual line after the last posted month
      // rather than dropping it to zero for the rest of the year.
      actual: m.actual,
      forecast: m.forecast ?? 0,
    }));
  }

  private liveVendors(L: CostDashboardDto): VendorSpend[] {
    const total = L.vendors.reduce((sum, v) => sum + Math.abs(v.actual), 0);

    return L.vendors.map((v) => {
      const utilization = v.utilizationPercent ?? 0;
      return {
        name: v.label,
        percent: total > 0 ? Math.round((Math.abs(v.actual) / total) * 100) : 0,
        utilization: Math.min(100, Math.round(utilization)),
        status: utilization >= 105 ? 'over' : utilization >= 92 ? 'watch' : 'within',
        approvedBudget: v.forecast > 0 ? this.formatMoney(v.forecast) : 'No forecast',
        currentSpend: this.formatMoney(v.actual),
        budgetContext: v.forecast <= 0
          ? 'Spend with no forecast line — nothing was planned for this vendor.'
          : utilization >= 105
            ? 'Spend is above the forecast and needs owner review.'
            : utilization >= 92
              ? 'Spend is close to plan and should be monitored through month end.'
              : 'Spend is tracking below forecast.',
      } as VendorSpend;
    });
  }

  /**
   * Teams side by side, measured against BUDGET where one exists and rolling forecast otherwise.
   *
   * The epic's criterion is "red = overspend vs budget". That was unservable while no Budget
   * scenario rows existed, so this compared against forecast and the legend said so. Now that
   * the Budget Planner can populate BUD, each row uses its own budget when it has one — per row,
   * not per dashboard, because a partially-budgeted year is a real state: budget a team and it
   * switches to the true comparison while the rest keep the forecast one.
   *
   * ⚠️ `budget > 0` is the test, not `hasBudgetData`. A team with no budget must not be reported
   * as 100% overspent just because some other team has one.
   */
  private liveDepartments(L: CostDashboardDto): DepartmentTower[] {
    return L.departments.map((d, i) => {
      const baseline = d.budget > 0 ? d.budget : d.forecast;
      const againstBudget = d.budget > 0;

      const remainder = Math.max(0, baseline - d.actual);
      const variancePercent = baseline > 0 ? ((d.actual - baseline) / baseline) * 100 : 0;

      return {
        name: d.label,
        subtitle: againstBudget
          ? 'Budget vs actual'
          : d.forecast > 0 ? 'Forecast vs actual (no budget set)' : 'No forecast recorded',
        forecast: baseline,
        actual: d.actual,
        remainder,
        variancePercent: this.round(variancePercent, 1),
        fiscalLabel: this.formatMoney(baseline) + (againstBudget ? ' budget' : ' FY'),
        drillLabel: d.label + ' invoices',
        actualColor: variancePercent > 0 ? '#ff6477' : this.paletteFor(i),
        remainderColor: '#ffcf3d',
        baselineColor: '#8fa2ba',
        positiveColor: '#ff6477',
        negativeColor: '#14d59a',
      };
    });
  }

  private liveRecharge(L: CostDashboardDto): CostCenterDashboardData['recharge'] {
    const total = L.rechargeBySite.reduce((sum, r) => sum + r.actual, 0);

    return {
      totalAllocated: this.formatMoney(total),
      slices: L.rechargeBySite.map((r, i) => ({
        label: r.label,
        value: total > 0 ? Math.round((r.actual / total) * 100) : 0,
        color: this.paletteFor(i),
      })),
    };
  }

  private liveCategories(L: CostDashboardDto): SpendCategory[] {
    const total = L.categories.reduce((sum, c) => sum + Math.abs(c.actual), 0);

    return L.categories.map((c, i) => ({
      label: c.label,
      percent: total > 0 ? Math.round((Math.abs(c.actual) / total) * 100) : 0,
      baseAmount: c.actual,
      amount: this.formatMoney(c.actual),
      color: this.paletteFor(i, ['#234a87', '#347cff', '#6559ee', '#14d59a', '#ffcf3d', '#ff6477']),
    }));
  }

  /**
   * The sample version reports processed-count and average processing time. Neither exists
   * here — there is no approval workflow and no approval timestamps (see the invoiceStatus
   * and processingTime data gaps) — so this reports what IS real instead of inventing them.
   */

  /**
   * Server-derived alerts → the panel's shape.
   *
   * These replaced a hardcoded list of invented findings ("$2.4M at risk") that read as real.
   * Every one of these is provable from the data, and `detail` says how — surfaced as the
   * row's tooltip so the number can be traced.
   */
  private liveAlerts(L: CostDashboardDto): FinancialAlert[] {
    return L.alerts.map((a) => ({
      title: a.title,
      value: this.alertValue(a),
      severity: a.severity,
      color: a.severity === 'risk' ? '#ff4f5e'
           : a.severity === 'healthy' ? '#14d59a'
           : '#3a82ff',
    }));
  }

  /** Money if the alert carries an amount, else a count, else nothing to show. */
  private alertValue(a: DashboardAlertDto): string {
    if (a.amount != null && a.amount !== 0) return this.formatMoney(a.amount);
    if (a.count != null) return this.formatCount(a.count);
    return '—';
  }

  /** The derivation behind an alert, for its tooltip. */
  alertDetail(title: string): string {
    const match = this.live?.alerts.find((a) => a.title === title);
    return match ? match.detail : '';
  }

  private liveInvoiceActivity(L: CostDashboardDto): DashboardFilterOption[] {
    return [
      // Every saved invoice counts as processed for now — there is no approval workflow, so
      // nothing can be pending or blocked. Bound to processedInvoiceCount so this label stays
      // correct once the two figures diverge.
      { label: 'Invoices Processed', value: this.formatCount(L.totals.processedInvoiceCount) },
      { label: 'Credit Notes', value: this.formatCount(L.totals.creditNoteCount) },
      { label: 'Recharged Out', value: this.formatMoney(L.totals.rechargedTotal) },
      { label: 'Unbudgeted Spend', value: this.formatMoney(L.totals.unbudgetedSpend) },
    ];
  }

  /**
   * Placeholder options for the three filters with no backing dimension.
   *
   * Region / Country / Entity do not exist in this database, but the controls are kept on the
   * dashboard (product decision) and an empty dropdown reads as broken. These are the ported
   * sample values, shown so the control looks and behaves normally — they filter NOTHING, and
   * the data-status strip says so explicitly. Replace with real options the moment those
   * columns land in the site master data.
   */
  private static readonly PLACEHOLDER_REGIONS = ['Americas', 'EMEA', 'APAC'];
  private static readonly PLACEHOLDER_COUNTRIES = ['United States', 'Germany', 'India', 'United Kingdom'];
  private static readonly PLACEHOLDER_ENTITIES = ['Crown Holdings Inc','Crown Manufacturing','Crown Digital', 'Crown EMEA BV', 'Crown APAC Pte'];

  private liveFilters(L: CostDashboardDto): Record<FilterKey, DashboardFilterOption[]> {
    // The prefix names the filter — but ONLY on the "All …" option, which is what a chip shows
    // while nothing is selected and is therefore its de-facto label. Repeating it on every row
    // ("Vendor: ABB", "Vendor: AWS", …) is noise once the dropdown is open, and the selection
    // itself already identifies the filter once made.
    const opts = (
      prefix: string,
      options: { value: string; label: string }[],
      allLabel = 'All',
    ): DashboardFilterOption[] => [
      { label: `${prefix}: ${allLabel}`, value: '' },
      ...options.map((o) => ({ label: o.label, value: o.value })),
    ];

    // Placeholders carry a `placeholder:` value so nothing can mistake them for a real code
    // if one is ever accidentally sent to the server.
    const placeholders = (prefix: string, labels: string[], allLabel = 'All'): DashboardFilterOption[] =>
      opts(prefix, labels.map((l) => ({ value: `placeholder:${l}`, label: l })), allLabel);

    return {
      // Not backed by any table — see PLACEHOLDER_* above.
      region: placeholders('Region', CostDashboardComponent.PLACEHOLDER_REGIONS, 'Global'),
      country: placeholders('Country', CostDashboardComponent.PLACEHOLDER_COUNTRIES),
      entity: placeholders('Entity', CostDashboardComponent.PLACEHOLDER_ENTITIES),

      // Real master data, filtered server-side.
      department: opts('Department', L.filters.departments),
      vendor: opts('Vendor', L.filters.vendors),
      scenario: opts('Scenario', L.filters.scenarios),
    };
  }



  /**
   * Whether any filter that actually filters is set.
   *
   * Only Department / Vendor / Scenario count. Region / Country / Entity are placeholders with
   * no backing dimension, so treating one as "active" would offer to clear something that was
   * never applied.
   */
  get hasActiveFilters(): boolean {
    return !!(this.selectedFilters.department || this.selectedFilters.vendor
      || this.selectedFilters.scenario || this.selectedSite || this.selectedCategory
      || this.selectedCurrencies.length || this.isPeriodFiltered);
  }

  /** Resets every working filter and refetches. The year is deliberately left alone. */
  clearDashboardFilters(): void {
    this.selectedFilters = {
      ...this.selectedFilters,
      department: '',
      vendor: '',
      scenario: '',
    };
    this.selectedSite = '';
    this.selectedCategory = '';
    this.selectedCurrencies = [];
    this.periodFrom = 1;
    this.periodTo = 12;
    this.loadLive();
    this.data = this.buildDashboardData();
  }

  // ── Year navigation ────────────────────────────────────────────────────────
  // The backend already takes ?year=; without a control the dashboard was pinned to the
  // current year and earlier data was unreachable.

  /** Don't offer years the business cannot have data for. */
  private static readonly FIRST_YEAR = 2024;

  get canGoPrevYear(): boolean {
    return !this.liveLoading && this.year > CostDashboardComponent.FIRST_YEAR;
  }

  get canGoNextYear(): boolean {
    // One year ahead is legitimate — next year's forecast is entered before it starts.
    return !this.liveLoading && this.year < new Date().getFullYear() + 1;
  }

  prevYear(): void {
    if (!this.canGoPrevYear) return;
    this.year -= 1;
    this.loadLive();
  }

  nextYear(): void {
    if (!this.canGoNextYear) return;
    this.year += 1;
    this.loadLive();
  }

  /** Label of the scenario currently selected, or a plain note when none is. */
  private liveScenarioLabel(): string {
    const selected = this.selectedFilters.scenario;
    if (!selected) return 'All scenarios';

    const group = this.filterGroups.find((g) => g.key === 'scenario');
    const option = group?.options.find((o) => o.value === selected);
    // Strip the "Scenario: " prefix the dropdown adds — this sits under its own heading.
    return option ? option.label.replace(/^Scenario:\s*/, '') : selected;
  }

  /**
   * Replaces the sample's revision commentary. The sample scenarios modelled dated revisions
   * ("RFC2 Jun") with pins on the chart; real scenarios are codes with no revision month, so
   * there is nothing to pin and this states what is actually plotted.
   */
  private liveRevisionNote(): string {
    return this.selectedFilters.scenario
      ? 'Forecast shown for the selected scenario'
      : 'Forecast combines every scenario for the year';
  }


  /**
   * "+3 more vendors (1,240.00 not shown)" — the panels are capped at the largest few rows, so
   * without this their figures silently disagree with the headline total.
   */
  private remainderNote(r: { hiddenCount: number; hiddenActual: number } | undefined, noun: string): string {
    if (!r || r.hiddenCount < 1) return '';
    const money = this.formatMoney(r.hiddenActual);
    return `+${r.hiddenCount} more ${noun}${r.hiddenCount === 1 ? '' : 's'} (${money} not shown)`;
  }

  get vendorsMoreNote(): string {
    return this.live ? this.remainderNote(this.live.vendorsRemainder, 'vendor') : '';
  }

  get categoriesMoreNote(): string {
    return this.live ? this.remainderNote(this.live.categoriesRemainder, 'category') : '';
  }

  get departmentsMoreNote(): string {
    return this.live ? this.remainderNote(this.live.departmentsRemainder, 'department') : '';
  }

  // ── Empty / caveat state, driven by what the server says it could not supply ──────────

  /** Loaded, and the year genuinely has no posted spend. */
  get hasNoActuals(): boolean {
    return !!this.live && this.live.totals.invoiceCount === 0;
  }

  /** A Budget scenario exists in master data but holds no forecast rows. */
  get hasNoBudget(): boolean {
    return !!this.live && !this.live.totals.hasBudgetData;
  }

  /** Totals span more than one site currency, so the headline figures are a mixed sum. */
  get hasMixedCurrency(): boolean {
    return !!this.live && this.live.currencyMix.length > 1;
  }

  get currencyMixLabel(): string {
    return this.live ? this.live.currencyMix.join(' + ') : '';
  }

  /** Panels still rendered from sample data because the database has no such concept. */
  get dataGaps(): DashboardGapDto[] {
    return this.live ? this.live.dataGaps : [];
  }

  hasGap(key: string): boolean {
    return this.dataGaps.some((g) => g.key === key);
  }

  gapReason(key: string): string {
    const gap = this.dataGaps.find((g) => g.key === key);
    return gap ? gap.reason : '';
  }

  /** "Actuals loaded through Jul 2026", or a plain note when nothing has posted. */
  get actualsThroughLabel(): string {
    if (!this.live || this.live.actualsThroughMonth < 1) return 'No actuals posted yet';
    return 'Actuals loaded through '
      + CostDashboardComponent.MONTH_LABELS[this.live.actualsThroughMonth - 1]
      + ' ' + this.live.year;
  }

  private buildForecastPoints(rows: MonthlyCostRecord[]): ForecastPoint[] {
    const revisions = this.sourceData.scenarios.filter((scenario) => scenario.revisionMonth);

    return this.monthsFromRows(rows).map((month) => {
      const monthRows = rows.filter((row) => row.month === month);
      const actual = this.sum(monthRows, 'actualAmount');
      const forecast = this.sum(monthRows, 'forecastAmount');
      const revision = revisions.find((scenario) => scenario.revisionMonth === month);

      return {
        month: this.formatMonthLabel(month, actual > 0, revision),
        monthKey: month,
        actual: actual > 0 ? actual : null,
        forecast,
        marker: revision ? this.getRevisionMarker(revision) : undefined,
        revisionLabel: revision?.revisionLabel,
      };
    });
  }

  /**
   * Sample-data fallback for the vendor panel.
   *
   * ⚠️ `percent` here means **share of the vendors shown**, matching `liveVendors()`. It used to
   * hold budget utilization, so the same field meant two different things depending on whether
   * the API had answered — invisible while the row just printed "43%", but wrong the moment the
   * tooltip started labelling it. Ranking is by SPEND for the same reason: it was sorting on
   * utilization, which is not what "ranked by spend amount" (F2-AC2) asks for.
   */
  private buildVendorSpend(): VendorSpend[] {
    const rows = this.sourceData.monthlyCosts.filter((row) => row.scenarioId === this.defaultScenario.id);
    const byVendor = this.groupBy(rows, 'vendorId');

    const ranked = Array.from(byVendor.entries())
      .map(([vendorId, vendorRows]) => {
        const vendor = this.findDimension(this.sourceData.dimensions.vendors, vendorId);
        const currentSpend = this.sum(vendorRows, 'actualAmount');
        const approvedBudget = this.sum(vendorRows, 'budgetAmount');
        return {
          name: vendor?.label ?? vendorId,
          currentSpend,
          approvedBudget,
          utilization: approvedBudget > 0 ? (currentSpend / approvedBudget) * 100 : 0,
        };
      })
      .sort((a, b) => Math.abs(b.currentSpend) - Math.abs(a.currentSpend))
      .slice(0, 5);

    // Share is of the vendors DISPLAYED, so the visible percentages add to 100 — computed after
    // the cap, exactly as the live path does.
    const shownTotal = ranked.reduce((sum, v) => sum + Math.abs(v.currentSpend), 0);

    return ranked.map((v) => ({
      name: v.name,
      percent: shownTotal > 0 ? Math.round((Math.abs(v.currentSpend) / shownTotal) * 100) : 0,
      utilization: Math.min(100, Math.round(v.utilization)),
      status: v.utilization >= 105 ? 'over' : v.utilization >= 92 ? 'watch' : 'within',
      approvedBudget: this.formatMoney(v.approvedBudget),
      currentSpend: this.formatMoney(v.currentSpend),
      budgetContext:
        v.utilization >= 105
          ? 'Spend is above the approved baseline and needs owner review.'
          : v.utilization >= 92
            ? 'Spend is close to plan and should be monitored through month end.'
            : 'Spend is tracking below approved budget.',
    } as VendorSpend));
  }

  private buildAlerts(): FinancialAlert[] {
    return this.sourceData.alerts.map((alert) => ({
      title: alert.title,
      value: this.formatAlertValue(alert),
      severity: alert.severity,
      color: this.getAlertColor(alert.severity),
    }));
  }

  private buildDepartmentTowers(rows: MonthlyCostRecord[]): DepartmentTower[] {
    const byTower = this.groupBy(rows, 'costTowerId');

    return this.sourceData.dimensions.costTowers.map((tower) => {
      const towerRows = byTower.get(tower.id) ?? [];
      const forecast = this.sum(towerRows, 'budgetAmount');
      const actual = this.sum(towerRows, 'actualAmount');
      const fullYearForecast = this.sum(towerRows, 'forecastAmount');
      const remainder = Math.max(0, fullYearForecast - actual);
      const variancePercent = forecast > 0 ? ((fullYearForecast - forecast) / forecast) * 100 : 0;

      return {
        name: tower.label,
        subtitle: tower.subtitle ?? '',
        forecast,
        actual,
        remainder,
        variancePercent: this.round(variancePercent, 1),
        fiscalLabel: `${this.formatMoney(forecast)} FY`,
        drillLabel: `${tower.label} invoices`,
        actualColor: variancePercent > 0 ? '#ff6477' : tower.color ?? '#6559ee',
        remainderColor: '#ffcf3d',
        baselineColor: '#8fa2ba',
        positiveColor: '#ff6477',
        negativeColor: '#14d59a',
      };
    });
  }

  private buildRecharge(): CostCenterDashboardData['recharge'] {
    const rows = this.sourceData.rechargeAllocations.filter((row) => row.departmentId === this.defaultDepartment.id);
    const total = this.sum(rows, 'amount');

    return {
      totalAllocated: this.formatMoney(total),
      slices: this.sourceData.dimensions.rechargeCenters.map((center) => {
        const amount = this.sum(rows.filter((row) => row.rechargeCenterId === center.id), 'amount');
        return {
          label: center.label,
          value: total > 0 ? Math.round((amount / total) * 100) : 0,
          color: center.color ?? '#347cff',
        };
      }),
    };
  }

  private buildCategories(rows: MonthlyCostRecord[]): SpendCategory[] {
    const byCategory = this.groupBy(rows, 'categoryId');
    const total = this.sum(rows, 'forecastAmount');

    return this.sourceData.dimensions.categories.map((category) => {
      const amount = this.sum(byCategory.get(category.id) ?? [], 'forecastAmount');
      return {
        label: category.label,
        percent: total > 0 ? Math.round((amount / total) * 100) : 0,
        baseAmount: amount,
        amount: this.formatMoney(amount),
        color: category.color ?? '#234a87',
      };
    });
  }

  private buildInvoiceActivity(invoices: InvoiceRecord[]): DashboardFilterOption[] {
    const processed = invoices.filter((invoice) => invoice.status === 'processed').length;
    const avgProcessingDays = invoices.length ? this.sum(invoices, 'processingDays') / invoices.length : 0;
    const creditInvoices = this.sum(invoices.filter((invoice) => invoice.isCredit), 'amount');
    const rechargedInvoices = invoices.filter((invoice) => invoice.isRecharged).length;

    return [
      { label: 'Processed This Month', value: this.formatCount(processed) },
      { label: 'Avg Processing Time', value: `${this.round(avgProcessingDays, 1)} Days` },
      { label: 'Credit Invoices', value: this.formatMoney(creditInvoices) },
      { label: 'Recharged Invoices', value: this.formatCount(rechargedInvoices) },
    ];
  }

  private buildPath(points: ChartPoint[], series: SeriesKey): string {
    return points
      .map((point, index) => {
        const y = series === 'actual' ? point.actualY ?? point.forecastY : point.forecastY;
        return `${index === 0 ? 'M' : 'L'} ${point.x} ${y}`;
      })
      .join(' ');
  }

  private getSpendStatus(actual: number, budget: number): KpiStatusResult {
    const usage = budget > 0 ? actual / budget : 0;
    if (usage >= 1.03) {
      return {
        status: `Over Budget (${this.formatMoney(actual - budget)})`,
        trend: 'bad',
        statusIcon: 'up',
        statusColor: '#ff4f5e',
      };
    }
    if (usage >= 0.92) return { status: 'On Track', trend: 'neutral', statusIcon: 'flat', statusColor: '#2f8cff' };
    return { status: 'Under Plan', trend: 'good', statusIcon: 'down', statusColor: '#14d59a' };
  }

  private getBudgetStatus(usedPercent: number): KpiStatusResult {
    if (usedPercent > 95) return { status: `${Math.round(usedPercent)}% Used`, trend: 'bad', statusIcon: 'up', statusColor: '#ff4f5e' };
    if (usedPercent > 75) return { status: `${Math.round(usedPercent)}% Used`, trend: 'neutral', statusIcon: 'flat', statusColor: '#2f8cff' };
    return { status: `${Math.round(usedPercent)}% Used`, trend: 'good', statusIcon: 'down', statusColor: '#14d59a' };
  }

  private getVarianceStatus(variance: number): KpiStatusResult {
    if (variance > 100000) {
      return {
        status: `Overspend (${this.formatMoney(variance)})`,
        trend: 'bad',
        statusIcon: 'up',
        statusColor: '#ff4f5e',
      };
    }
    if (variance < 0) return { status: 'Savings', trend: 'good', statusIcon: 'down', statusColor: '#14d59a' };
    return { status: 'Near Plan', trend: 'neutral', statusIcon: 'flat', statusColor: '#2f8cff' };
  }

  private getForecastStatus(variancePercent: number): KpiStatusResult {
    return {
      status: `${variancePercent >= 0 ? '+' : ''}${this.round(variancePercent, 1)}%`,
      trend: variancePercent > 0 ? 'bad' : 'good',
      statusIcon: variancePercent > 0 ? 'up' : 'down',
      statusColor: variancePercent > 0 ? '#ff4f5e' : '#14d59a',
    };
  }

  private getUnbudgetedStatus(amount: number): KpiStatusResult {
    if (amount > 250000) return { status: 'Risk Alert', trend: 'bad', statusIcon: 'up', statusColor: '#ff4f5e' };
    return { status: 'Low Risk', trend: 'good', statusIcon: 'down', statusColor: '#14d59a' };
  }

  private getActualMonths(rows: MonthlyCostRecord[]): string[] {
    return [...new Set(rows.filter((row) => row.actualAmount > 0).map((row) => row.month))].sort();
  }

  private monthsFromRows(rows: MonthlyCostRecord[]): string[] {
    return [...new Set(rows.map((row) => row.month))].sort();
  }

  private getRevisionNote(): string {
    const labels = this.sourceData.scenarios
      .filter((scenario) => scenario.revisionMonth)
      .map((scenario) => scenario.revisionLabel.replace(/^RFC/i, 'Rev'));
    return `${labels.length} forecast revisions: ${labels.join(' - ')}`;
  }

  private getRevisionMarker(scenario: ScenarioRecord): 'rev1' | 'rev2' | 'rev3' {
    if (scenario.id === 'rfc2') return 'rev2';
    if (scenario.id === 'rfc3') return 'rev3';
    return 'rev1';
  }

  private formatMonthLabel(month: string, hasActual: boolean, revision?: ScenarioRecord): string {
    const date = new Date(`${month}-01T00:00:00`);
    const label = date.toLocaleDateString('en-US', { month: 'short' });
    if (revision) return `${label} ${revision.revisionLabel.replace('RFC', 'Rev')}`;
    return `${label} ${hasActual ? 'A' : 'F'}`;
  }

  private formatActualsLoaded(months: string[]): string {
    if (!months.length) return 'None';
    const first = new Date(`${months[0]}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
    const last = new Date(`${months[months.length - 1]}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
    return `${first}-${last}`;
  }

  private formatAlertValue(alert: AlertRecord): string {
    if (alert.valueType === 'money') return this.formatMoney(alert.amount ?? 0);
    if (alert.valueType === 'count') return `${this.formatCount(alert.count ?? 0)} Invoices`;
    return alert.text ?? '';
  }

  private getAlertColor(severity: AlertRecord['severity']): string {
    if (severity === 'risk') return '#ff4f5e';
    if (severity === 'attention') return '#3a82ff';
    return '#14d59a';
  }

  /**
   * '' and 'all' both mean "no filter". The sample dataset uses 'all' as its sentinel while the
   * live option lists use '' — both reach this on the sample fallback path, and treating ''
   * as a real value would filter everything out.
   */
  private matchesFilter(value: string, selectedValue: string): boolean {
    return !selectedValue || selectedValue === 'all' || value === selectedValue;
  }

  private findDimension(dimensions: BusinessDimension[], id: string): BusinessDimension | undefined {
    return dimensions.find((dimension) => dimension.id === id);
  }

  private groupBy<T, K extends keyof T>(rows: T[], key: K): Map<string, T[]> {
    return rows.reduce((map, row) => {
      const value = String(row[key]);
      map.set(value, [...(map.get(value) ?? []), row]);
      return map;
    }, new Map<string, T[]>());
  }

  private sum<T>(rows: T[], key: keyof T): number {
    return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  }

  private getExportDateStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private formatSignedMoney(value: number, includeSign: boolean): string {
    if (!includeSign) return this.formatMoney(value);
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${this.formatMoney(Math.abs(value))}`;
  }

  private formatMoney(value: number): string {
    const valueInMillions = value / 1000000;
    if (valueInMillions >= 1) {
      return `$${this.round(valueInMillions, 1).toFixed(1)}M`;
    }

    return `$${Math.round(value / 1000)}K`;
  }

  private formatCount(value: number): string {
    return Math.round(value).toLocaleString('en-US');
  }

  private round(value: number, digits: number): number {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  private getNiceAxisMax(value: number): number {
    if (value <= 0) return 1;

    const paddedValue = value * 1.12;
    const exponent = Math.floor(Math.log10(paddedValue));
    const magnitude = Math.pow(10, exponent);
    const normalized = paddedValue / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

    return niceNormalized * magnitude;
  }
}
