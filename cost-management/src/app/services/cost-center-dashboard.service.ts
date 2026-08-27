import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/** One line row returned by GET /api/v1/cost-center-dashboard. */
export interface CostCenterRowDto {
  account: string | null;
  spendType: string | null;
  spendLayer: string | null;
  category: string | null;
  system: string | null;
  supplier: string | null;
  internalOrder: string | null;
  itemDescription: string | null;
  /** Keyed "{ScenarioCode}-{Year}", e.g. "ACT-2025" — matches ScenarioYearColumn below. */
  values: { [columnKey: string]: number };
}

export interface CostCenterDashboardResponse {
  rows: CostCenterRowDto[];
}

/** One requested scenario+year column, e.g. { scenario: 'RFC1', year: 2026 }. */
export interface ScenarioYearColumn {
  scenario: string;
  year: number;
}

@Injectable({ providedIn: 'root' })
export class CostCenterDashboardService {

  /** GET /api/v1/cost-center-dashboard?site=...&team=...&columns=ACT:2025,RFC1:2026 */
  /**
   * SHOWCASE: the Scenario Management comparison grid.
   *
   * Values are keyed "{ScenarioCode}-{Year}", matching the real column key format, so the screen
   * renders whatever columns it asks for without special-casing the demo.
   */
  get(site: string | null, team: string | null,
      columns: ScenarioYearColumn[]): Observable<CostCenterDashboardResponse> {

    const seeds = [
      { account: 'gl-6100', itemDescription: 'SAP Developer Support', base: 150000 },
      { account: 'gl-6300', itemDescription: 'Concur Integration', base: 86400 },
      { account: 'gl-6200', itemDescription: 'AI Reporting Services', base: 57000 },
      { account: 'gl-7200', itemDescription: 'Infrastructure Refresh', base: 42000 },
    ];

    // Each scenario reads the same lines at a different level, which is what makes the
    // comparison grid worth looking at.
    const factorFor = (code: string): number => {
      if (code === 'BUD') return 0.9;
      if (code === 'ACT') return 0.08;
      if (code === 'RFC1') return 1.0;
      if (code === 'RFC3') return 0.85;
      return 0.12;
    };

    const rows: CostCenterRowDto[] = seeds.map((seed, i) => {
      const values: { [key: string]: number } = {};
      columns.forEach(c => {
        values[c.scenario + '-' + c.year] = Math.round(seed.base * factorFor(c.scenario));
      });
      return {
        id: String(i + 1),
        account: seed.account,
        itemDescription: seed.itemDescription,
        values,
      } as unknown as CostCenterRowDto;
    });

    return of({ rows } as unknown as CostCenterDashboardResponse).pipe(delay(180));
  }
}
