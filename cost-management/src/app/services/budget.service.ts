import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';

/** One team's slice of the annual budget. `months` is always length 12, Jan-Dec. */
export interface BudgetTeamRowDto {
  teamId: number;
  teamCode: string;
  teamName: string;
  /** Null month = nothing budgeted, which is not the same as a budgeted zero. */
  months: (number | null)[];
  annualTotal: number;
  /** What the working forecast holds for this team — context only, never written. */
  forecastTotal: number;
}

export interface BudgetPlanDto {
  year: number;
  /** False when no Budget scenario exists for the year — the screen must say so. */
  scenarioExists: boolean;
  scenarioId: number;
  scenarioCode: string;

  /** Once approved the planner refuses to write; the budget is the dashboard's baseline. */
  isApproved: boolean;
  approvedBy: string | null;
  approvedDate: string | null;

  // Where the budget lines get booked. tblCMForecast demands a Site and Account that a
  // top-down budget has no natural value for, so they are shown rather than invented.
  siteId: number;
  accountId: number;
  currencyId: number;
  siteName: string | null;
  accountName: string | null;
  currencyCode: string | null;

  teams: BudgetTeamRowDto[];
  totalBudget: number;
  totalForecast: number;
}

export interface SaveBudgetRequest {
  year: number;
  siteId: number;
  accountId: number;
  currencyId: number;
  lastUpdatedBy: string;
  teams: { teamId: number; months: (number | null)[] }[];
}

/**
 * Budget Planner - SHOWCASE BUILD.
 *
 * WARNING: no backend. Interfaces and signatures are copied from production, so the screen is an
 * unmodified copy; only the transport differs.
 *
 * The plan is held IN MEMORY and really is mutated, so the demo behaves like the real thing:
 * spreading a total, saving, approving, and reopening all take effect and persist for the
 * session. It resets on reload, which is the right amount of permanence for a demo.
 *
 * The approval rule is enforced here too - saving an approved budget is refused with the same
 * message the API returns - because "why can't I edit this?" is exactly what a viewer will try.
 */
@Injectable({ providedIn: 'root' })
export class BudgetService {

  private readonly monthly = [81748, 81748, 81748, 81748, 81748, 81748,
                              81748, 81748, 81748, 81748, 81748, 81772];

  /** One plan per year, created on first request. */
  private plans: { [year: number]: BudgetPlanDto } = {};

  private planFor(year: number): BudgetPlanDto {
    if (!this.plans[year]) {
      const teams: BudgetTeamRowDto[] = [
        this.team(1, 'infrastructure', 'Infrastructure', 245250, 895039),
        this.team(2, 'applications', 'Applications', 245250, 0),
        this.team(3, 'governance-vendor', 'Governance & Vendor', 245250, 0),
        this.team(4, 'model-processes', 'Model & Processes', 245250, 0),
      ];

      this.plans[year] = {
        year,
        scenarioExists: true,
        scenarioId: 1,
        scenarioCode: 'BUD',
        isApproved: false,
        approvedBy: null,
        approvedDate: null,
        siteId: 1,
        accountId: 2,
        currencyId: 1,
        siteName: 'UK',
        accountName: 'GL 6200 - Cloud Services',
        currencyCode: 'GBP',
        teams,
        totalBudget: teams.reduce((t, x) => t + x.annualTotal, 0),
        totalForecast: teams.reduce((t, x) => t + x.forecastTotal, 0),
      };
    }
    return this.plans[year];
  }

  private team(teamId: number, teamCode: string, teamName: string,
               annual: number, forecastTotal: number): BudgetTeamRowDto {
    // An even spread with the rounding remainder on December, exactly as the screen's own
    // "spread evenly" does - so the demo opens already consistent with what that button produces.
    const each = Math.round((annual / 12) * 100) / 100;
    const months: (number | null)[] = [];
    for (let i = 0; i < 11; i++) months.push(each);
    months.push(Math.round((annual - each * 11) * 100) / 100);

    return {
      teamId, teamCode, teamName, months,
      annualTotal: annual,
      forecastTotal,
    };
  }

  get(year: number): Observable<BudgetPlanDto> {
    return of(this.clone(this.planFor(year))).pipe(delay(200));
  }

  save(request: SaveBudgetRequest): Observable<BudgetPlanDto> {
    const plan = this.planFor(request.year);

    if (plan.isApproved) {
      // Same refusal the API gives - the lock is the feature, so the demo must show it.
      return throwError(() => ({
        error: {
          error: 'The ' + request.year + ' budget was approved by ' + plan.approvedBy +
                 ' and is locked. Reopen it first if you need to change it.',
        },
      })).pipe(delay(200)) as Observable<BudgetPlanDto>;
    }

    plan.siteId = request.siteId;
    plan.accountId = request.accountId;
    plan.currencyId = request.currencyId;

    request.teams.forEach(incoming => {
      const row = plan.teams.filter(t => t.teamId === incoming.teamId)[0];
      if (!row) return;
      const months: (number | null)[] = [];
      for (let i = 0; i < 12; i++) {
        months.push(incoming.months && incoming.months[i] != null ? incoming.months[i] : null);
      }
      row.months = months;
      row.annualTotal = months.reduce((t: number, v) => t + (v || 0), 0);
    });

    plan.totalBudget = plan.teams.reduce((t, x) => t + x.annualTotal, 0);
    return of(this.clone(plan)).pipe(delay(260));
  }

  approve(year: number, approvedBy: string): Observable<BudgetPlanDto> {
    const plan = this.planFor(year);
    if (plan.totalBudget === 0) {
      return throwError(() => ({
        error: { error: 'Nothing has been budgeted yet - enter figures before approving.' },
      })).pipe(delay(200)) as Observable<BudgetPlanDto>;
    }
    plan.isApproved = true;
    plan.approvedBy = approvedBy;
    plan.approvedDate = new Date().toISOString();
    return of(this.clone(plan)).pipe(delay(240));
  }

  reopen(year: number, reopenedBy: string): Observable<BudgetPlanDto> {
    const plan = this.planFor(year);
    // approvedBy / approvedDate are deliberately kept, matching the API: reopening must not
    // erase the record of who signed the budget off.
    plan.isApproved = false;
    return of(this.clone(plan)).pipe(delay(240));
  }

  private clone(plan: BudgetPlanDto): BudgetPlanDto {
    return {
      ...plan,
      teams: plan.teams.map(t => ({ ...t, months: t.months.slice() })),
    };
  }
}
