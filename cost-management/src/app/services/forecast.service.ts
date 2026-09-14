import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { ForecastRow } from '../constants/forecast.constants';

/**
 * Payload sent to the Cost Center backend for a forecast row. Extends the on-screen
 * ForecastRow with the persistence-only fields the backend needs: the calendar year the
 * monthly values belong to, the display order, and the audit login (LastUpdatedBy).
 */
export interface ForecastRowPayload extends ForecastRow {
  scenario?: string;
  year: number;
  sortOrder: number;
  lastUpdatedBy: string;
}

/** One field's before/after within a change event. */
export interface ForecastFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/**
 * One change event — a single save, with every field it altered.
 *
 * The backend stores one row per changed field and regroups them on read, so an edit
 * touching four months arrives here as ONE event with four `changes`, not four events.
 * Render `changes` as a list; never assume one change per event.
 */
export interface ForecastChangeLog {
  timestamp: string;
  user: string | null;
  /** The forecast line this event belongs to, plus enough context to identify it. */
  forecastDataId: number;
  internalOrder: string | null;
  description: string | null;
  scenario: string | null;
  site: string | null;
  team: string | null;
  account: string | null;
  year: number;
  changes: ForecastFieldChange[];
}

/** Server-side filters for the audit screen. */
export interface ForecastHistoryFilters {
  year?: number | null;
  scenario?: string;
  user?: string;
  internalOrder?: string;
  fromDate?: string;
  toDate?: string;
}

/** Dimensions the paged read filters on. Values are whatever the grid's chips hold. */
export interface ForecastPageFilters {
  site?: string;
  team?: string;
  account?: string;
  scenario?: string;
  category?: string;
  supplier?: string;
  currency?: string;
}

/** GET /forecast/paged response. */
export interface PagedForecast {
  /** Rows matching the filter across every page, not just this one. */
  total: number;
  page: number;
  pageSize: number;
  items: ForecastRow[];
  /**
   * Column totals for the WHOLE filtered set, keyed by sub-row type, 12 months each.
   * The grid cannot work these out itself — it only holds one page, and summing that would
   * produce a footer that silently means "this page" while looking like a year total.
   */
  totals: { [type: string]: number[] };
}

/** Options for bulkSave. Omit to keep the original full-state contract. */
export interface BulkSaveOptions {
  /** FALSE upserts only what is sent and deletes only `deletedIds` — what a paged client needs. */
  pruneAbsent?: boolean;
  deletedIds?: number[];
}

/** Paged wrapper returned by GET /forecast/history. */
export interface PagedForecastHistory {
  total: number;
  page: number;
  pageSize: number;
  items: ForecastChangeLog[];
}

/** Optional per-row seed flags — the toggles and checkboxes the Forecast grid reacts to. */
interface SeedExtras {
  type?: 'OPEX' | 'CAPEX';
  differentCurrency?: boolean;
  contractCurrency?: string;
  contract?: (number | null)[];
  contractActual?: (number | null)[];
  exchangeRate?: number;
  rechargeRequired?: boolean;
  recharge?: (number | null)[];
  rechargeActual?: (number | null)[];
}

/**
 * Forecast grid data - SHOWCASE BUILD.
 *
 * WARNING: no backend. Interfaces above are production's; only the transport differs.
 *
 * Rows are held in memory so an edit survives a save and a reload of the screen (not of the
 * browser). The sub-row shape is the real one - Contract / Local / Actual / Recharge - because
 * that split is the point of the screen, and a flattened mock would misrepresent it.
 */
@Injectable({ providedIn: 'root' })
export class ForecastService {

  private rows: ForecastRow[] | null = null;

  private seed(): ForecastRow[] {
    const months = (base: number, drift: number): (number | null)[] => {
      const out: (number | null)[] = [];
      for (let i = 0; i < 12; i++) out.push(Math.round(base + drift * i));
      return out;
    };
    // Recharges land in a few months only — enough for the green 'Forecast after Recharge' line
    // to show real figures in those months and a plain 0 everywhere else, which is the behaviour
    // that line is meant to demonstrate.
    const some = (base: number, at: number[]): (number | null)[] => {
      const out: (number | null)[] = new Array(12).fill(null);
      at.forEach((i, n) => out[i] = Math.round(base * (1 + n * 0.1)));
      return out;
    };
    // Actuals stop after July, matching the rest of the demo data.
    const actuals = (base: number): (number | null)[] => {
      const out: (number | null)[] = [];
      for (let i = 0; i < 12; i++) out.push(i >= 4 && i <= 6 ? Math.round(base) : null);
      return out;
    };

    return [
      this.row(1, 'IO1', 'SAP Developer Support', 'sap', 'IT Subscriptions', 'gl-6100',
               'Subscription', 'Run', 'SAP', 'PAR-2026-014', 'uk', 'infrastructure',
               months(12000, 250), actuals(4000),
               { rechargeRequired: true, recharge: some(3000, [2, 5, 8]),
                 rechargeActual: some(2850, [4, 5, 6]) }),
      this.row(2, 'IO2', 'Concur Integration', 'accenture1', 'IT Subscriptions', 'gl-6300',
               'Service', 'Grow', 'ServiceNow', 'PAR-2026-021', 'uk', 'infrastructure',
               months(7200, 120), actuals(2100)),
      this.row(3, 'IO3', 'AI Reporting Services', 'msft-azure', 'Cloud Services', 'gl-6200',
               'Service', 'Transform', 'Azure', 'PAR-2026-033', 'london-hq', 'applications',
               months(4750, 90), actuals(900),
               { differentCurrency: true, contractCurrency: 'EUR', exchangeRate: 1.17,
                 contract: months(5560, 105), contractActual: actuals(1053) }),
      this.row(4, 'IO5', 'Infrastructure Refresh', 'abb', 'IT Outsource', 'gl-7200',
               'Maintenance', 'Run', 'SAP', 'PAR-2026-007', 'uk', 'model-processes',
               months(3500, 60), actuals(0)),
      this.row(5, 'IO4', 'Vendor Assurance Reviews', 'accenture1', 'IT Outsource', 'gl-6300',
               'Service', 'Run', 'ServiceNow', 'PAR-2026-041', 'amsterdam', 'governance-vendor',
               months(2800, 45), actuals(700)),
      this.row(6, 'IO6', 'Endpoint Security Tooling', 'msft-azure', 'Software Licensing', 'gl-6100',
               'Subscription', 'Run', 'Azure', 'PAR-2026-052', 'manchester', 'infrastructure',
               months(5400, 110), actuals(1350)),
      this.row(7, 'IO1', 'Core Platform Capacity', 'abb', 'Cloud Services', 'gl-6200',
               'Subscription', 'Grow', 'Azure', 'PAR-2026-063', 'dublin', 'infrastructure',
               months(6100, 180), actuals(1500),
               { type: 'CAPEX', rechargeRequired: true, recharge: some(1800, [1, 4, 7, 10]),
                 rechargeActual: some(1750, [4, 5, 6]) }),
      this.row(8, 'IO3', 'Salesforce Integration Work', 'accenture1', 'IT Outsource', 'gl-6300',
               'Service', 'Grow', 'Salesforce', 'PAR-2026-070', 'france', 'applications',
               months(3900, 75), actuals(980),
               // Recharge ticked with nothing recorded: the green line must read a flat 0, not blank.
               { rechargeRequired: true }),
      this.row(9, 'IO5', 'Planning Model Rebuild', 'sap', 'IT Subscriptions', 'gl-6100',
               'Service', 'Transform', 'SAP', 'PAR-2026-088', 'usa', 'model-processes',
               months(4300, 130), actuals(1100)),
      this.row(10, 'IO2', 'Data Lake Storage', 'google', 'Cloud Services', 'gl-6200',
               'Subscription', 'Grow', 'Azure', 'PAR-2026-095', 'amsterdam', 'infrastructure',
               months(2500, 95), actuals(620)),
      this.row(11, 'IO6', 'Identity Platform Licences', 'msft-azure', 'Software Licensing', 'gl-6100',
               'Subscription', 'Run', 'ServiceNow', 'PAR-2026-102', 'bradford', 'governance-vendor',
               months(1900, 30), actuals(480)),
      this.row(12, 'IO4', 'Infrastructure Investment Programme', 'abb', 'IT Outsource', 'gl-7200',
               'CapEx', 'Transform', 'SAP', 'PAR-2026-118', 'london-hq', 'applications',
               months(8200, 210), actuals(2050),
               { type: 'CAPEX' }),
    ];
  }

  /**
   * CODES vs NAMES — get this wrong and the column renders BLANK.
   *
   * The grid's Site, Team, Supplier, Account and Currency selects carry master-data CODES
   * ('london-hq', 'gl-6100'); its Spend Type, Spend Layer, Category and System selects carry
   * master-data NAMES ('Subscription', 'IT Subscriptions'). That split is production's, not the
   * showcase's. A <select> whose model matches no option value shows nothing at all, so a code
   * written into a name column looks exactly like missing data.
   *
   * These fields also feed the Related Data panel's internal-order auto-fill, which reads the
   * forecast line as the canonical coding for an internal order — leave them blank and that
   * feature demos as an empty table.
   */
  private row(id: number, io: string, description: string, supplier: string,
              category: string, account: string,
              spendType: string, spendLayer: string, system: string, par: string,
              site: string, team: string,
              local: (number | null)[], actual: (number | null)[],
              extras: SeedExtras = {}): ForecastRow {
    const subRows: any[] = [
      { type: 'contract', label: 'Forecasted in Contract Currency',
        currency: extras.contractCurrency || 'GBP',
        values: (extras.contract || local).slice() },
      { type: 'local', label: 'Forecast', currency: 'GBP', values: local.slice() },
      { type: 'actual', label: 'Actual', currency: 'GBP', values: actual.slice(), readOnly: true },
    ];

    // Different Currency ticked means the row keeps its OWN contract figures; otherwise the grid
    // derives them as local x rate, so seeding a contract-actual line would be contradicted on screen.
    if (extras.differentCurrency) {
      subRows.push({ type: 'contract-actual', label: 'Actual in Contract Currency',
                     currency: extras.contractCurrency || 'GBP',
                     values: (extras.contractActual || actual).slice(), readOnly: true });
    }

    // Recharge ticked is what puts the green 'Forecast after Recharge' line on every row, and
    // recharge-actual is the figure it reads. Without both, that feature has nothing to show.
    if (extras.rechargeRequired) {
      subRows.push({ type: 'recharge', label: 'Recharge', currency: 'GBP',
                     values: (extras.recharge || new Array(12).fill(null)).slice() });
      subRows.push({ type: 'recharge-actual', label: 'Actual', currency: 'GBP',
                     values: (extras.rechargeActual || new Array(12).fill(null)).slice(),
                     readOnly: true });
    }

    return {
      id,
      internalOrder: io,
      // ForecastRow calls this `description` ("Item Desc" column). It was seeded as
      // `itemDescription`, which the `as unknown as ForecastRow` cast below happily accepted —
      // the column rendered empty and the Related Data panel had no description to inherit.
      description,
      supplier,
      category,
      account,
      spendType,
      spendLayer,
      system,
      par,
      site,
      team,
      scenario: 'FC',
      currency: 'GBP',
      type: extras.type || 'OPEX',
      differentCurrency: !!extras.differentCurrency,
      rechargeRequired: !!extras.rechargeRequired,
      exchangeRate: extras.exchangeRate ?? null,
      subRows,
    } as unknown as ForecastRow;
  }

  list(year: number): Observable<ForecastRow[]> {
    if (!this.rows) this.rows = this.seed();
    // A deep-ish copy, so the grid editing its own copy cannot corrupt the store before a save.
    const copy = this.rows.map(r => ({
      ...r,
      subRows: (r as any).subRows.map((sr: any) => ({ ...sr, values: sr.values.slice() })),
    })) as unknown as ForecastRow[];
    return of(copy).pipe(delay(220));
  }

  /**
   * Mock of GET /forecast/paged — one page, plus totals for the WHOLE filtered set.
   *
   * Filtering happens here rather than in the grid: with a paged grid, filtering the rows that
   * happen to be loaded would quietly ignore every other page.
   */
  listPaged(year: number, page: number, pageSize: number, filters?: ForecastPageFilters): Observable<PagedForecast> {
    if (!this.rows) this.rows = this.seed();

    const f: any = filters || {};
    // NULL-LENIENT, matching the real repo query: a row with no value for a dimension is KEPT.
    // Filtering strictly would silently drop every half-coded line the moment a filter is used.
    const keep = (r: any, key: string) => !f[key] || !r[key] || r[key] === f[key];
    const all = (this.rows as any[]).filter(r =>
      keep(r, 'site') && keep(r, 'team') && keep(r, 'account') && keep(r, 'scenario') &&
      keep(r, 'category') && keep(r, 'supplier') && keep(r, 'currency'));

    const copy = all.map(r => ({
      ...r,
      subRows: (r.subRows || []).map((sr: any) => ({ ...sr, values: (sr.values || []).slice() })),
    }));

    const size = pageSize > 0 ? pageSize : 10;
    let current = page > 0 ? page : 1;
    if ((current - 1) * size >= copy.length && copy.length > 0) {
      current = Math.ceil(copy.length / size);
    }

    return of({
      total: copy.length,
      page: current,
      pageSize: size,
      items: copy.slice((current - 1) * size, current * size) as unknown as ForecastRow[],
      totals: this.buildTotals(copy)
    }).pipe(delay(220));
  }

  /**
   * Column totals per sub-row type, mirroring the server's BuildTotals EXACTLY.
   *
   * Including its derivation: a row not flagged Diff Curr has no contract figures of its own, so
   * its contract lines are local (or actual) x the line's rate — which is what the grid now shows
   * per row. Diverging here puts a footer on screen that disagrees with the rows above it, and
   * reads 0 under a column of visible numbers.
   */
  private buildTotals(rows: any[]): { [type: string]: number[] } {
    const totals: { [type: string]: number[] } = {};

    const contractValues = (row: any, sub: any): (number | null)[] | null => {
      const isContract = sub.type === 'contract';
      const isContractActual = sub.type === 'contract-actual';
      if (!isContract && !isContractActual) return sub.values || [];
      if (row.differentCurrency) return sub.values || [];

      const source = (row.subRows || []).find((s: any) => s.type === (isContractActual ? 'actual' : 'local'));
      if (!source) return null;

      const rate = Number(row.exchangeRate) > 0 ? Number(row.exchangeRate) : 1;
      // Null stays null so an untouched month never becomes a synthetic 0.00.
      return (source.values || []).map((v: any) => (v === null || v === undefined ? null : +(v * rate).toFixed(2)));
    };

    rows.forEach(row => {
      (row.subRows || []).forEach((sub: any) => {
        if (sub.type === 'recharge' && !row.rechargeRequired) return;

        const values = contractValues(row, sub);
        if (!values) return;

        if (!totals[sub.type]) totals[sub.type] = new Array(12).fill(0);
        for (let i = 0; i < 12; i++) totals[sub.type][i] += values[i] || 0;
      });
    });

    return totals;
  }

  bulkSave(rows: ForecastRowPayload[], year: number, options?: BulkSaveOptions): Observable<boolean> {
    const clone = (r: any) => ({
      ...r,
      subRows: (r.subRows || []).map((sr: any) => ({ ...sr, values: (sr.values || []).slice() })),
    });

    if (options && options.pruneAbsent === false) {
      // Paged contract: upsert what we are given, delete only what is named. The caller holds one
      // page, so absence means "not loaded" — pruning here would wipe every unvisited row.
      if (!this.rows) this.rows = this.seed();
      const store = (this.rows as any[]).slice();
      (rows || []).forEach(r => {
        const at = store.findIndex((x: any) => x.id === (r as any).id);
        if (at >= 0) store[at] = clone(r); else store.push(clone(r));
      });
      const removed = options.deletedIds || [];
      this.rows = store.filter((x: any) => removed.indexOf(x.id) < 0) as unknown as ForecastRow[];
      return of(true).pipe(delay(320));
    }

    // Original contract: the payload IS the whole year, so the mock replaces wholesale.
    if (rows && rows.length) {
      this.rows = rows.map(clone) as unknown as ForecastRow[];
    }
    return of(true).pipe(delay(320));
  }

  copyScenario(fromScenario: string, toScenario: string,
               lastUpdatedBy: string): Observable<{ linesCopied: number }> {
    return of({ linesCopied: this.rows ? this.rows.length : 4 }).pipe(delay(260));
  }

  history(page = 1, pageSize = 25, filters?: ForecastHistoryFilters): Observable<PagedForecastHistory> {
    const items = [
      this.change(1, 1, 'Jun Forecast', '78,000', '88,100', '2026-07-27T16:02:00Z'),
      this.change(2, 1, 'Jul Forecast', '80,000', '82,400', '2026-07-27T16:03:00Z'),
      this.change(3, 2, 'Apr Forecast', '7,000', '7,560', '2026-06-14T10:20:00Z'),
    ];
    return of({ items, total: items.length, page, pageSize } as unknown as PagedForecastHistory)
      .pipe(delay(200));
  }

  historyForLine(forecastDataId: number): Observable<ForecastChangeLog[]> {
    return of([
      this.change(1, forecastDataId, 'Jun Forecast', '78,000', '88,100', '2026-07-27T16:02:00Z'),
    ]).pipe(delay(180));
  }

  private change(id: number, lineId: number, field: string, oldValue: string,
                 newValue: string, when: string): ForecastChangeLog {
    return {
      id, forecastDataId: lineId, actionTaken: field,
      oldStatus: oldValue, newStatus: newValue,
      changedBy: 'Devojeet Modak', changedDate: when,
      remarks: 'Adjusted during the RFC1 cycle.',
    } as unknown as ForecastChangeLog;
  }
}
