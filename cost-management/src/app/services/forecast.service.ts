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

/** Paged wrapper returned by GET /forecast/history. */
export interface PagedForecastHistory {
  total: number;
  page: number;
  pageSize: number;
  items: ForecastChangeLog[];
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
    // Actuals stop after July, matching the rest of the demo data.
    const actuals = (base: number): (number | null)[] => {
      const out: (number | null)[] = [];
      for (let i = 0; i < 12; i++) out.push(i >= 4 && i <= 6 ? Math.round(base) : null);
      return out;
    };

    return [
      this.row(1, 'IO1', 'SAP Developer Support', 'sap', 'it-subscriptions', 'gl-6100',
               months(12000, 250), actuals(4000)),
      this.row(2, 'IO2', 'Concur Integration', 'accenture1', 'it-subscriptions', 'gl-6300',
               months(7200, 120), actuals(2100)),
      this.row(3, 'IO3', 'AI Reporting Services', 'msft-azure', 'cloud-services', 'gl-6200',
               months(4750, 90), actuals(900)),
      this.row(4, 'IO5', 'Infrastructure Refresh', 'abb', 'it-outsource', 'gl-7200',
               months(3500, 60), actuals(0)),
    ];
  }

  private row(id: number, io: string, description: string, supplier: string,
              category: string, account: string,
              local: (number | null)[], actual: (number | null)[]): ForecastRow {
    return {
      id,
      internalOrder: io,
      itemDescription: description,
      supplier,
      category,
      account,
      site: 'uk',
      team: 'infrastructure',
      scenario: 'FC',
      currency: 'GBP',
      subRows: [
        { type: 'contract', label: 'Forecasted in Contract Currency', currency: 'GBP',
          values: local.slice() },
        { type: 'local', label: 'Forecast', currency: 'GBP', values: local.slice() },
        { type: 'actual', label: 'Actual', currency: 'GBP', values: actual.slice(), readOnly: true },
      ],
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

  bulkSave(rows: ForecastRowPayload[], year: number): Observable<boolean> {
    // The real endpoint is authoritative for the whole year, so the mock replaces wholesale too.
    if (rows && rows.length) {
      this.rows = rows.map(r => ({
        ...(r as any),
        subRows: ((r as any).subRows || []).map((sr: any) => ({ ...sr, values: (sr.values || []).slice() })),
      })) as unknown as ForecastRow[];
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
