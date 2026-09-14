import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { HeadcountRow, MOCK_HEADCOUNT_ROWS } from '../constants/headcount.constants';

/**
 * Payload sent for a headcount row: the on-screen row plus the persistence-only fields —
 * display order and the audit login.
 */
export interface HeadcountRowPayload extends HeadcountRow {
  sortOrder: number;
  lastUpdatedBy: string;
}

/** What the paged read needs beyond the page itself. */
export interface HeadcountPageQuery {
  site?: string;
  team?: string;
  scenarioYear: number;
  otherScenarioYear: number;
}

/** GET /api/v1/headcount/paged response. */
export interface PagedHeadcount {
  /** Rows matching the filter across every page, not just this one. */
  total: number;
  page: number;
  pageSize: number;
  items: HeadcountRow[];
  /**
   * Column totals for the WHOLE filtered set, keyed by scenario band ('primary' / 'other'),
   * 12 monthly figures each. The grid only holds a page, so it cannot total the set itself.
   */
  totals: { [band: string]: number[] };
}

/**
 * Mock Headcount backend for the showcase.
 *
 * Mirrors the production service's surface exactly, so the screen's component code is identical
 * to the real one — only the data source differs. Seeded from MOCK_HEADCOUNT_ROWS, which the
 * production build no longer serves but which is precisely what a showcase wants.
 */
@Injectable({ providedIn: 'root' })
export class HeadcountService {
  private rows: HeadcountRow[] | null = null;

  private seed(): HeadcountRow[] {
    const rows = JSON.parse(JSON.stringify(MOCK_HEADCOUNT_ROWS)) as HeadcountRow[];
    // sortOrder round-trips in the real service, and the grid now relies on it rather than on
    // the row's index — without it, paging would renumber page 2 over the top of page 1.
    rows.forEach((r, i) => { if (r.sortOrder === undefined) r.sortOrder = i; });
    return rows;
  }

  /** A copy, so the grid editing its own rows cannot corrupt the store before a save. */
  private clone(r: any): any {
    return {
      ...r,
      scenarioRows: (r.scenarioRows || []).map((sr: any) => ({
        ...sr,
        valuesByYear: JSON.parse(JSON.stringify(sr.valuesByYear || {}))
      }))
    };
  }

  list(): Observable<HeadcountRow[]> {
    if (!this.rows) this.rows = this.seed();
    return of(this.rows.map(r => this.clone(r)) as HeadcountRow[]).pipe(delay(200));
  }

  /**
   * One page of the grid, plus totals for the WHOLE filtered set.
   *
   * Site/Team filter here rather than in the browser: with a paged grid, filtering the rows that
   * happen to be loaded would quietly ignore every other page.
   */
  listPaged(page: number, pageSize: number, opts: HeadcountPageQuery): Observable<PagedHeadcount> {
    if (!this.rows) this.rows = this.seed();

    // Strict matching, mirroring the real repo — the grid's own rule was strict too, so a row
    // with a blank site IS excluded once a site filter is applied.
    const all = (this.rows as any[]).filter(r =>
      (!opts.site || r.site === opts.site) && (!opts.team || r.team === opts.team));

    const size = pageSize > 0 ? pageSize : 10;
    let current = page > 0 ? page : 1;
    if ((current - 1) * size >= all.length && all.length > 0) {
      current = Math.ceil(all.length / size);
    }

    return of({
      total: all.length,
      page: current,
      pageSize: size,
      items: all.slice((current - 1) * size, current * size).map(r => this.clone(r)) as HeadcountRow[],
      totals: this.buildTotals(all, opts.scenarioYear, opts.otherScenarioYear)
    }).pipe(delay(200));
  }

  /**
   * Mirrors the grid's getColTotal(): each band is summed in ITS OWN year, because the screen
   * shows the primary band in one year and the comparison band in another.
   */
  private buildTotals(rows: any[], scenarioYear: number, otherScenarioYear: number): { [band: string]: number[] } {
    const totals: { [band: string]: number[] } = {};

    rows.forEach(row => {
      (row.scenarioRows || []).forEach((band: any) => {
        const year = band.type === 'other' ? otherScenarioYear : scenarioYear;
        const values = (band.valuesByYear || {})[year];
        if (!values) return;

        if (!totals[band.type]) totals[band.type] = new Array(12).fill(0);
        for (let i = 0; i < 12; i++) totals[band.type][i] += values[i] || 0;
      });
    });

    return totals;
  }

  /**
   * Upsert only. The real backend never prunes rows absent from the payload, which is what makes
   * saving a single page safe — so the mock must not prune either.
   */
  bulkSave(rows: HeadcountRowPayload[]): Observable<boolean> {
    if (!this.rows) this.rows = this.seed();
    const store = (this.rows as any[]).slice();

    (rows || []).forEach(r => {
      const at = store.findIndex((x: any) => x.id === (r as any).id);
      if (at >= 0) {
        store[at] = this.clone(r);
      } else {
        // A new row arrives with a negative placeholder id; give it a real one, as the server would.
        const nextId = Math.max(0, ...store.map((x: any) => x.id)) + 1;
        store.push({ ...this.clone(r), id: nextId });
      }
    });

    this.rows = store as HeadcountRow[];
    return of(true).pipe(delay(300));
  }
}
