import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/** One justification captured while an RFC value was edited (F5-AC3). */
export interface SourceOfChangeCommentDto {
  /** 1-12, or 0 for a legacy comment with no month recorded. */
  month: number;
  monthName: string;
  comment: string;
  createdBy: string;
  createdDate: string;
  /** Position in the append-only trail — "Edit 1", "Edit 2", … */
  editNumber: number;
}

/**
 * One RFC line contributing to a team's variance.
 *
 * ⚠️ An RFC line, NOT an RFC-vs-Budget pair — budget is agreed per team and carries no internal
 * order, supplier or category, so there is no budget counterpart at this level.
 */
export interface SourceOfChangeLineDto {
  forecastDataId: number;
  itemDescription: string | null;
  internalOrder: string | null;
  category: string | null;
  supplier: string | null;
  account: string | null;
  site: string | null;
  rfcValue: number;
  isOverspendAddition: boolean;
  isUnbudgeted: boolean;
  changeCount: number;
  comments: SourceOfChangeCommentDto[];
}

export interface SourceOfChangeTeamDto {
  teamId: number;
  teamName: string;
  rfcValue: number;
  budgetValue: number;
  /** RFC − Budget. Positive is an overspend against the agreed budget. */
  variance: number;
  variancePercent: number | null;
  /** The rows F5-AC2 wants highlighted. */
  isOverspend: boolean;
  /** False when this team was never budgeted — its variance is not a comparison. */
  hasBudget: boolean;
  linesWithComments: number;
  lines: SourceOfChangeLineDto[];
}

export interface SourceOfChangeDto {
  year: number;
  scenarioCode: string;
  budgetScenarioCode: string;
  hasBudget: boolean;
  rfcTotal: number;
  budgetTotal: number;
  variance: number;
  teams: SourceOfChangeTeamDto[];
  availableScenarios: string[];
  /** Why the comparison is per team rather than per line — shown on screen. */
  grainNote: string;
}

export interface SourceOfChangeFilters {
  year?: number | null;
  scenario?: string | null;
  team?: string | null;
  category?: string | null;
  overspendOnly?: boolean | null;
}

/**
 * Source of Change report - SHOWCASE BUILD.
 *
 * WARNING: no backend here. The interfaces above are copied verbatim from the real service so
 * the report component is an unmodified copy of the shipped one; only the transport differs.
 *
 * The shape of the mock mirrors what the real repository returns, INCLUDING the awkward parts
 * that the report exists to surface: a team that is over budget, teams budgeted but carrying no
 * RFC lines at all, and lines with and without justifications.
 */
@Injectable({ providedIn: 'root' })
export class SourceOfChangeService {

  get(filters: SourceOfChangeFilters): Observable<SourceOfChangeDto> {
    const year = filters.year != null ? filters.year : new Date().getFullYear();
    const scenario = filters.scenario || 'RFC1';

    const teams: SourceOfChangeTeamDto[] = [
      {
        teamId: 1,
        teamName: 'Infrastructure',
        rfcValue: 293400,
        budgetValue: 245250,
        variance: 48150,
        variancePercent: 19.6,
        isOverspend: true,
        hasBudget: true,
        linesWithComments: 2,
        lines: [
          {
            forecastDataId: 24,
            itemDescription: 'SAP Developer Support',
            internalOrder: 'IO1', category: 'IT Subscriptions', supplier: 'SAP',
            account: 'GL 6100 - Software Licences', site: 'UK',
            rfcValue: 150000, isOverspendAddition: true, isUnbudgeted: false, changeCount: 3,
            comments: [
              {
                month: 4, monthName: 'Apr', editNumber: 1,
                comment: 'Uplift agreed with the vendor after the support tier was raised.',
                createdBy: 'Devojeet Modak', createdDate: '2026-04-14T09:12:00Z',
              },
              {
                month: 6, monthName: 'Jun', editNumber: 2,
                comment: 'Confirmed with Dept Head - covers the extra environments added in Q2.',
                createdBy: 'Devojeet Modak', createdDate: '2026-06-02T14:40:00Z',
              },
            ],
          },
          {
            forecastDataId: 25,
            itemDescription: 'Concur Integration',
            internalOrder: 'IO3', category: 'IT Subscriptions', supplier: 'Accenture1',
            account: 'GL 6300 - Professional Services', site: 'UK',
            rfcValue: 86400, isOverspendAddition: false, isUnbudgeted: false, changeCount: 1,
            comments: [
              {
                month: 5, monthName: 'May', editNumber: 1,
                comment: 'Pilot rollout delayed to align with the vendor go-live.',
                createdBy: 'Devojeet Modak', createdDate: '2026-05-20T11:05:00Z',
              },
            ],
          },
          {
            forecastDataId: 28,
            itemDescription: 'AI Reporting Services',
            internalOrder: 'IO5', category: 'Cloud Services', supplier: 'MSFT Azure',
            account: 'GL 6200 - Cloud Services', site: 'UK',
            rfcValue: 57000, isOverspendAddition: false, isUnbudgeted: true, changeCount: 2,
            comments: [],
          },
        ],
      },
      this.emptyTeam(2, 'Applications'),
      this.emptyTeam(3, 'Governance & Vendor'),
      this.emptyTeam(4, 'Model & Processes'),
    ];

    const filtered = filters.overspendOnly ? teams.filter(t => t.isOverspend) : teams;

    const rfcTotal = teams.reduce((t, x) => t + x.rfcValue, 0);
    const budgetTotal = teams.reduce((t, x) => t + x.budgetValue, 0);

    return of({
      year,
      scenarioCode: scenario,
      budgetScenarioCode: 'BUD',
      hasBudget: true,
      rfcTotal,
      budgetTotal,
      variance: rfcTotal - budgetTotal,
      teams: filtered,
      availableScenarios: ['RFC1', 'FC'],
      grainNote:
        'Budget is agreed per team; RFC lines carry internal order, supplier and category. ' +
        'The variance is therefore compared per team - the grain the two share - and the lines ' +
        'beneath each team explain how its RFC total was reached.',
    }).pipe(delay(240));
  }

  /**
   * A team budgeted but carrying no RFC lines at all.
   *
   * Deliberately included: it is a real finding, not a non-result, and the report is built to
   * surface it rather than drop the team.
   */
  private emptyTeam(teamId: number, teamName: string): SourceOfChangeTeamDto {
    return {
      teamId, teamName,
      rfcValue: 0,
      budgetValue: 245250,
      variance: -245250,
      variancePercent: -100,
      isOverspend: false,
      hasBudget: true,
      linesWithComments: 0,
      lines: [],
    };
  }
}
