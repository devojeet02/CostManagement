import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

export interface DashboardOptionDto {
  value: string;
  label: string;
}

/**
 * The six filters the dashboard renders.
 *
 * ⚠️ `regions`, `countries` and `entities` always come back EMPTY — this database has no
 * geographic or legal-entity dimension. The controls stay on screen showing only their
 * "All …" option; see the backend notes.
 */
export interface DashboardFiltersDto {
  regions: DashboardOptionDto[];
  countries: DashboardOptionDto[];
  entities: DashboardOptionDto[];
  /** Real and filterable, unlike regions/countries/entities above. */
  sites: DashboardOptionDto[];
  /** Site currencies present in the data — drives the currency multi-select. */
  currencies: DashboardOptionDto[];
  /** Spend categories. Value is the NAME — tblCMCategory has no code column. */
  categories: DashboardOptionDto[];
  departments: DashboardOptionDto[];
  vendors: DashboardOptionDto[];
  scenarios: DashboardOptionDto[];
}

export interface DashboardTotalsDto {
  /** The SELECTED PERIOD when a month range is set; the whole year otherwise. */
  actualSpend: number;
  /** The same figures across the whole year, ignoring the period — F1-AC3 wants both. */
  ytdActualSpend: number;
  ytdForecastTotal: number;
  ytdBudgetTotal: number;
  /** True when a period narrower than the full year is in effect. */
  isPeriodFiltered: boolean;
  /** e.g. "May-Jul". Empty when the whole year is in scope. */
  periodLabel: string;
  forecastTotal: number;
  /** Often 0 — check `hasBudgetData` before showing this as a real budget. */
  budgetTotal: number;
  hasBudgetData: boolean;
  unbudgetedSpend: number;
  invoiceCount: number;
  /**
   * INTERIM: identical to `invoiceCount` — with no approval workflow, a saved invoice IS a
   * processed one. Bind to this rather than invoiceCount so the split needs no client change
   * when email-chain approval lands.
   */
  processedInvoiceCount: number;
  creditNoteCount: number;
  rechargedTotal: number;
}

export interface DashboardMonthPointDto {
  month: number;
  /** Null where nothing has posted — the chart must break the line, not plot zero. */
  actual: number | null;
  forecast: number | null;
  /**
   * The agreed budget for the month, from forecast rows under a Budget scenario. Null until a
   * budget has been entered through the Budget Planner.
   *
   * Distinct from `forecast` on purpose: budget is the baseline signed off at the start of the
   * year, rolling forecast is the current estimate.
   */
  budget: number | null;
}

export interface DashboardBreakdownDto {
  label: string;
  actual: number;
  forecast: number;
  utilizationPercent: number | null;
  /**
   * The agreed budget for this row. Populated for DEPARTMENTS only — the Budget Planner works
   * per team, so a vendor or category budget would be meaningless. 0 until a budget exists.
   */
  budget: number;
  /**
   * Actual ÷ budget × 100, or null when this row has no budget. The null is the signal to fall
   * back to the forecast comparison rather than reporting a false overspend.
   */
  budgetUtilizationPercent: number | null;
}

/**
 * What a Top-N breakdown left out. The panels show only the largest few rows, so their
 * visible figures do NOT sum to the headline total — this is what lets the UI say why.
 */
export interface DashboardRemainderDto {
  hiddenCount: number;
  hiddenActual: number;
}

export interface DashboardActivityDto {
  month: number;
  invoiceCount: number;
}

/**
 * One financial alert, DERIVED from the data — never invented. `detail` explains how the
 * figure was reached so a number can be traced rather than trusted blindly.
 */
export interface DashboardAlertDto {
  key: string;
  title: string;
  /** 'risk' | 'attention' | 'healthy' — drives the colour. */
  severity: string;
  amount: number | null;
  count: number | null;
  detail: string;
}

/** Something the dashboard shows that the database cannot supply. */
export interface DashboardGapDto {
  key: string;
  label: string;
  reason: string;
}

export interface CostDashboardDto {
  year: number;
  /** Null when the data spans several currencies — see `currencyMix`. */
  currency: string | null;
  currencyMix: string[];
  actualsThrough: string | null;
  actualsThroughMonth: number;

  filters: DashboardFiltersDto;
  totals: DashboardTotalsDto;
  monthly: DashboardMonthPointDto[];
  vendors: DashboardBreakdownDto[];
  categories: DashboardBreakdownDto[];
  departments: DashboardBreakdownDto[];
  vendorsRemainder: DashboardRemainderDto;
  categoriesRemainder: DashboardRemainderDto;
  departmentsRemainder: DashboardRemainderDto;
  rechargeBySite: DashboardBreakdownDto[];
  invoiceActivity: DashboardActivityDto[];
  alerts: DashboardAlertDto[];
  dataGaps: DashboardGapDto[];
}

/** One invoice line behind a vendor's spend figure (F2-AC5). */
export interface VendorInvoiceLineDto {
  invoiceId: number;
  invoiceDataId: number;
  invoiceNumber: string;
  invoiceDate: string;
  /** 1-12 — the month the line POSTED to, which is what the dashboard buckets by. */
  postingMonth: number;
  description: string | null;
  internalOrder: string | null;
  category: string | null;
  department: string | null;
  site: string | null;
  /** Site-currency amount. Credits are NOT negated here — see `isCredit`. */
  amount: number;
  currency: string | null;
  isCredit: boolean;
  isBudgeted: boolean;
}

export interface VendorDrillDto {
  vendor: string;
  year: number;
  /** Σ the lines with credits negated — matches the vendor's figure on the dashboard. */
  total: number;
  lineCount: number;
  currencyMix: string[];
  lines: VendorInvoiceLineDto[];
}

export interface CostDashboardFilters {
  year?: number | null;
  department?: string | null;
  vendor?: string | null;
  scenario?: string | null;
  /** Site code. Narrows both actuals and forecast. */
  site?: string | null;
  /**
   * Spend category NAME. Narrows both sides on the line's category.
   *
   * ⚠️ Budget lines carry no category, so selecting one removes the budget from the figures.
   */
  category?: string | null;
  /**
   * Site-currency codes to include. Empty/omitted = all.
   *
   * ⚠️ Filters, never converts — there is no corporate rate in this database. Selecting a
   * single currency is what makes the headline totals a coherent figure rather than a sum of
   * GBP + EUR + USD.
   */
  currencies?: string[] | null;
  /**
   * Period range in MONTHS, 1-12 inclusive. Omitted = the whole year.
   *
   * ⚠️ Months, not dates — invoice lines carry PostingMonth and forecast rows carry twelve
   * month columns, so there is no finer grain to filter on.
   */
  fromMonth?: number | null;
  toMonth?: number | null;
}

/**
 * Cost Center dashboard data - SHOWCASE BUILD.
 *
 * WARNING: this deployment has NO BACKEND. The interfaces above are copied verbatim from the
 * real `CostDashboardService` so the screens are byte-identical to production; only the
 * transport differs - every method returns generated data through `of()` instead of HTTP.
 *
 * Mocking the SERVICE rather than the components is deliberate: the dashboard, budget chart,
 * vendor drill and Source of Change report are unmodified copies of the real ones, so what is
 * demoed here is genuinely the shipped UI rather than a lookalike.
 *
 * Figures echo the real development database so the demo reads plausibly.
 */
@Injectable({ providedIn: 'root' })
export class CostDashboardService {

  private readonly teams = [
    { code: 'infrastructure',    label: 'Infrastructure',      actual: 18440, forecast: 895039, budget: 245250 },
    { code: 'applications',      label: 'Applications',        actual:    62, forecast:      0, budget: 245250 },
    { code: 'governance-vendor', label: 'Governance & Vendor', actual:  3847, forecast:      0, budget: 245250 },
    { code: 'model-processes',   label: 'Model & Processes',   actual:   355, forecast:      0, budget: 245250 },
  ];

  private readonly vendorList = [
    { code: 'sap',        label: 'SAP',          actual: 12240, forecast: 150000 },
    { code: 'acumant',    label: 'Acumant05',    actual:  6514, forecast:  86400 },
    { code: 'google',     label: 'Google Cloud', actual:  3345, forecast:  57000 },
    { code: 'accenture1', label: 'Accenture1',   actual:   200, forecast:   9000 },
    { code: 'msft-azure', label: 'MSFT Azure',   actual:   199, forecast:   6400 },
    { code: 'abb',        label: 'ABB',          actual:   156, forecast:   4200 },
  ];

  private readonly categoryList = [
    { label: 'IT Subscriptions',   actual: 14200, forecast: 420000 },
    { label: 'IT Outsource',       actual:  4100, forecast: 210000 },
    { label: 'Software Licensing', actual:  2900, forecast: 140000 },
    { label: 'Cloud Services',     actual:  1100, forecast:  85000 },
    { label: 'Uncategorised',      actual:   404, forecast:  40039 },
  ];

  private readonly siteList = [
    { code: 'uk',         label: 'UK' },
    { code: 'amsterdam',  label: 'Amsterdam' },
    { code: 'france',     label: 'France' },
    { code: 'usa',        label: 'USA' },
    { code: 'bradford',   label: 'Bradford' },
    { code: 'london-hq',  label: 'London HQ' },
    { code: 'manchester', label: 'Manchester' },
    { code: 'dublin',     label: 'Dublin' },
  ];

  /** Actuals exist May-Jul only, matching the development data, so the chart breaks after Jul. */
  private readonly actualByMonth: { [month: number]: number } = { 5: 12000, 6: 240, 7: 10464 };

  get(filters: CostDashboardFilters): Observable<CostDashboardDto> {
    const year = filters.year != null ? filters.year : new Date().getFullYear();
    const from = filters.fromMonth != null ? filters.fromMonth : 1;
    const to = filters.toMonth != null ? filters.toMonth : 12;
    const periodFiltered = from !== 1 || to !== 12;

    // Filters genuinely narrow the figures, so the demo behaves like the real screen.
    const teams = filters.department
      ? this.teams.filter(t => t.code === filters.department) : this.teams;
    const vendors = filters.vendor
      ? this.vendorList.filter(v => v.code === filters.vendor) : this.vendorList;
    const categories = filters.category
      ? this.categoryList.filter(c => c.label === filters.category) : this.categoryList;

    // Only the UK site carries the demo spend, as in the real data - so a EUR/USD-only or
    // non-UK site selection correctly returns nothing rather than inventing figures.
    const scale = this.currencyScale(filters.currencies || [])
      * (filters.site && filters.site !== 'uk' ? 0 : 1);

    const monthly: DashboardMonthPointDto[] = [];
    for (let i = 0; i < 12; i++) {
      const month = i + 1;
      const inPeriod = month >= from && month <= to;
      const rawActual = this.actualByMonth[month];
      monthly.push({
        month,
        actual: rawActual != null && inPeriod ? Math.round(rawActual * scale) : null,
        forecast: inPeriod ? Math.round((895039 / 12) * scale) : null,
        budget: inPeriod ? Math.round((981000 / 12) * scale) : null,
      });
    }

    const sumOf = (key: 'actual' | 'forecast' | 'budget') =>
      monthly.reduce((t, m) => t + (m[key] || 0), 0);

    let ytdActual = 0;
    Object.keys(this.actualByMonth).forEach(k => { ytdActual += this.actualByMonth[Number(k)]; });
    ytdActual = ytdActual * scale;

    const mix = scale === 0 ? [] : this.currencyMix(filters);

    const dto: CostDashboardDto = {
      year,
      currency: mix.length === 1 ? mix[0] : null,
      currencyMix: mix,
      actualsThrough: year + '-07-28',
      actualsThroughMonth: 7,
      filters: {
        regions: [], countries: [], entities: [],
        sites: this.siteList.map(s => ({ value: s.code, label: s.label })),
        currencies: ['EUR', 'GBP', 'USD'].map(c => ({ value: c, label: c })),
        categories: this.categoryList.map(c => ({ value: c.label, label: c.label })),
        departments: this.teams.map(t => ({ value: t.code, label: t.label })),
        vendors: this.vendorList.map(v => ({ value: v.code, label: v.label })),
        scenarios: [
          { value: 'ACT', label: 'ACT - Actual' },
          { value: 'BUD', label: 'BUD - Budget' },
          { value: 'FC', label: 'FC - Forecast' },
          { value: 'RFC1', label: 'RFC1 - Forecast' },
        ],
      },
      totals: {
        actualSpend: Math.round(sumOf('actual')),
        ytdActualSpend: Math.round(ytdActual),
        ytdForecastTotal: Math.round(895039 * scale),
        ytdBudgetTotal: Math.round(981000 * scale),
        isPeriodFiltered: periodFiltered,
        periodLabel: periodFiltered ? this.periodLabel(from, to) : '',
        forecastTotal: Math.round(sumOf('forecast')),
        budgetTotal: Math.round(sumOf('budget')),
        hasBudgetData: scale > 0,
        unbudgetedSpend: 0,
        invoiceCount: Math.round(18 * scale),
        processedInvoiceCount: Math.round(18 * scale),
        creditNoteCount: 0,
        rechargedTotal: Math.round(4200 * scale),
      },
      monthly,
      vendors: vendors.map(v => this.breakdown(v.label, v.actual * scale, v.forecast * scale, 0)),
      categories: categories.map(c => this.breakdown(c.label, c.actual * scale, c.forecast * scale, 0)),
      departments: teams.map(t => this.breakdown(t.label, t.actual * scale, t.forecast * scale, t.budget * scale)),
      vendorsRemainder: { hiddenCount: 0, hiddenActual: 0 },
      categoriesRemainder: { hiddenCount: 0, hiddenActual: 0 },
      departmentsRemainder: { hiddenCount: 0, hiddenActual: 0 },
      rechargeBySite: [
        this.breakdown('Amsterdam', 2400 * scale, 0, 0),
        this.breakdown('France', 1100 * scale, 0, 0),
        this.breakdown('USA', 700 * scale, 0, 0),
      ],
      invoiceActivity: [0, 0, 0, 0, 6, 4, 8, 0, 0, 0, 0, 0]
        .map((count, i) => ({ month: i + 1, invoiceCount: count })),
      alerts: [
        {
          key: 'vendorOverspend', title: '1 vendor over forecast', severity: 'attention',
          amount: 12240, count: 1,
          detail: 'SAP has spent above its forecast line for the year to date.',
        },
        {
          key: 'unforecastVendors', title: '2 vendors with no forecast', severity: 'risk',
          amount: 355, count: 2,
          detail: 'Spend recorded against vendors that carry no forecast line at all.',
        },
        {
          key: 'vendorsWithinForecast', title: '4 vendors tracking under forecast',
          severity: 'healthy', amount: null, count: 4,
          detail: 'These vendors are inside the plan for the year to date.',
        },
      ],
      dataGaps: [
        {
          key: 'geography', label: 'Region / Country / Entity',
          reason: 'No geographic or legal-entity dimension exists. A site is a plant, not a legal entity.',
        },
        {
          key: 'invoiceStatus', label: 'Invoice approval status',
          reason: 'No approval workflow exists, so every saved invoice counts as processed.',
        },
        {
          key: 'processingTime', label: 'Processing time',
          reason: 'No approval timestamps, so days-to-process cannot be derived.',
        },
        {
          key: 'costTower', label: 'Cost tower',
          reason: 'Ambiguous - Spend Layer or Spend Type? Needs a business decision.',
        },
      ],
    };

    // A little latency, so the loading states are actually visible in the demo.
    return of(dto).pipe(delay(220));
  }

  getVendorLines(vendorName: string, filters: CostDashboardFilters): Observable<VendorDrillDto> {
    const vendor = this.vendorList.filter(v => v.label === vendorName)[0];
    const scale = this.currencyScale(filters.currencies || [])
      * (filters.site && filters.site !== 'uk' ? 0 : 1);
    const total = Math.round((vendor ? vendor.actual : 0) * scale);

    const first = Math.round(total * 0.6);
    const second = Math.round(total * 0.2);
    const lines: VendorInvoiceLineDto[] = total === 0 ? [] : [
      this.line(1, 5, 'INV-1005', 'Annual support renewal', 'IO1', first),
      this.line(2, 6, 'INV-1012', 'Monthly platform charge', 'IO2', second),
      this.line(3, 7, 'INV-1020', 'Professional services', 'IO3', total - first - second),
    ];

    return of({
      vendor: vendorName,
      year: filters.year != null ? filters.year : new Date().getFullYear(),
      total,
      lineCount: lines.length,
      currencyMix: total === 0 ? [] : ['GBP'],
      lines,
    }).pipe(delay(180));
  }

  // -- helpers ------------------------------------------------------------------------

  private breakdown(label: string, actual: number, forecast: number, budget: number): DashboardBreakdownDto {
    return {
      label,
      actual: Math.round(actual),
      forecast: Math.round(forecast),
      budget: Math.round(budget),
      utilizationPercent: forecast ? Math.round((actual / forecast) * 1000) / 10 : null,
      budgetUtilizationPercent: budget ? Math.round((actual / budget) * 1000) / 10 : null,
    };
  }

  private line(id: number, month: number, invoiceNumber: string,
               description: string, io: string, amount: number): VendorInvoiceLineDto {
    return {
      invoiceId: id, invoiceDataId: id, invoiceNumber,
      invoiceDate: '2026-0' + month + '-15', postingMonth: month,
      description, internalOrder: io, category: 'IT Subscriptions',
      department: 'Infrastructure', site: 'UK',
      amount, currency: 'GBP', isCredit: false, isBudgeted: true,
    };
  }

  /** Only UK/GBP carries spend here, so a EUR- or USD-only selection returns nothing. */
  private currencyScale(selected: string[]): number {
    if (selected.length === 0) return 1;
    return selected.indexOf('GBP') >= 0 ? 1 : 0;
  }

  private currencyMix(filters: CostDashboardFilters): string[] {
    const selected = filters.currencies || [];
    if (selected.length) return selected.slice();
    if (filters.site === 'uk') return ['GBP'];
    return ['GBP', 'EUR', 'USD'];
  }

  private periodLabel(from: number, to: number): string {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return from === to ? names[from - 1] : names[from - 1] + '-' + names[to - 1];
  }
}
