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
  /** CCM-051: 12 monthly running totals (Jan..Dec), keyed like `values` — present only for non-Actual (Forecast/Budget) columns. */
  cumulativeVariance?: { [columnKey: string]: number[] };
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

  /**
   * GET /api/v1/cost-center-dashboard?site=...&team=...&columns=ACT:2025,RFC1:2026
   *
   * SHOWCASE: the Scenario Management comparison grid. Values are keyed "{ScenarioCode}-{Year}",
   * matching the real column key format, so the screen renders whatever columns it asks for
   * without special-casing the demo.
   *
   * ⚠️ Every dimension the grid can GROUP BY has to be present on the row - account, spend type,
   * spend layer, category, system, supplier, internal order. A row missing one renders a dash in
   * that column and, worse, collapses into a single "—" group the moment the user groups by it.
   */
  get(site: string | null, team: string | null,
      columns: ScenarioYearColumn[]): Observable<CostCenterDashboardResponse> {

    const seeds = [
      { account: 'gl-6100', itemDescription: 'SAP Developer Support', base: 150000,
        spendType: 'Subscription', spendLayer: 'Application', category: 'IT Subscriptions',
        system: 'SAP', supplier: 'SAP', internalOrder: 'IO1' },
      { account: 'gl-6300', itemDescription: 'Concur Integration', base: 86400,
        spendType: 'Project', spendLayer: 'Platform', category: 'Consulting',
        system: 'ServiceNow', supplier: 'Accenture1', internalOrder: 'IO3' },
      { account: 'gl-6200', itemDescription: 'AI Reporting Services', base: 57000,
        spendType: 'Subscription', spendLayer: 'Application', category: 'Software',
        system: 'Azure', supplier: 'MSFT Azure', internalOrder: 'IO2' },
      { account: 'gl-7200', itemDescription: 'Infrastructure Refresh', base: 42000,
        spendType: 'Capex', spendLayer: 'Infrastructure', category: 'Hardware',
        system: 'Azure', supplier: 'ABB', internalOrder: 'IO5' },
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

    const rows: CostCenterRowDto[] = seeds.map(seed => {
      const values: { [key: string]: number } = {};
      const cumulativeVariance: { [key: string]: number[] } = {};

      columns.forEach(c => {
        const key = c.scenario + '-' + c.year;
        const annual = Math.round(seed.base * factorFor(c.scenario));
        values[key] = annual;

        // CCM-051: CumVar(M) = CumVar(M-1) + (Forecast(M) - Actual(M)), reset every January.
        // Actual columns have nothing to compare themselves against, so they carry none - the
        // screen renders those cells blank, and inventing a series here would read as real.
        if (c.scenario !== 'ACT') {
          const forecastMonth = annual / 12;
          const actualMonth = (seed.base * factorFor('ACT')) / 12;
          let running = 0;
          cumulativeVariance[key] = new Array(12).fill(0).map((_v, mi) => {
            // Actuals only exist to July in this demo; later months drift by the forecast alone.
            const actual = mi < 7 ? actualMonth : 0;
            running += Math.round(forecastMonth - actual);
            return running;
          });
        }
      });

      return {
        account: seed.account,
        spendType: seed.spendType,
        spendLayer: seed.spendLayer,
        category: seed.category,
        system: seed.system,
        supplier: seed.supplier,
        internalOrder: seed.internalOrder,
        itemDescription: seed.itemDescription,
        values,
        cumulativeVariance,
      };
    });

    return of({ rows }).pipe(delay(180));
  }
}
