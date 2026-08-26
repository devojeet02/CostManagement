import { Component, OnInit } from '@angular/core';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { LoaderService } from '../../features/loader/loader.service';
import { MasterDataService, LookupItemDto } from '../../services/master-data.service';
import { BudgetService, BudgetPlanDto, BudgetTeamRowDto } from '../../services/budget.service';

/** One editable team row. Kept separate from the DTO so edits never mutate the server response. */
interface BudgetRow {
  teamId: number;
  teamName: string;
  /** Jan-Dec. Null means "nothing budgeted", which the save path treats differently from 0. */
  months: (number | null)[];
  /** What the working forecast holds for this team — context only. */
  forecastTotal: number;
}

/**
 * Budget Planner — sets a whole year's budget for the BUD scenario.
 *
 * ── Why this screen exists ─────────────────────────────────────────────────────────────────
 * A Budget scenario is created read-only (any code starting BUD/RFC/ACT), and the Forecast
 * grid's save path throws on any new row in a locked scenario. That is RFP §8.2 working as
 * designed — a budget is a signed-off baseline, not something anyone can type over. The side
 * effect was that BUD stayed empty, so the dashboard's `hasBudgetData` was false and every
 * "actual vs budget" comparison quietly fell back to rolling forecast.
 *
 * This screen writes through `PUT /api/v1/budget`, the sanctioned bulk path, which bypasses the
 * per-row edit guard exactly as `CopyScenarioAsync` does.
 *
 * ── Grain ──────────────────────────────────────────────────────────────────────────────────
 * One row per TEAM. A budget is decided top-down ("Applications gets 400k"), and Team is what
 * the dashboard's department panel groups by — so this is the coarsest budget that still lights
 * up the red/green comparison the epic asks for.
 *
 * ── Repeatable until approved ──────────────────────────────────────────────────────────────
 * Saving REPLACES the year's budget and may be repeated freely while the numbers are argued
 * over. Approving freezes it; there is no un-approve (a baseline that can be quietly reopened
 * is not a baseline). Everything on screen goes read-only once approved.
 */
@Component({
  selector: 'app-budget-planner',
  templateUrl: './budget-planner.component.html',
  styleUrls: ['./budget-planner.component.scss'],
})
export class BudgetPlannerComponent implements OnInit {
  readonly monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Same bounds as the dashboard's year stepper — next year's budget is set before it starts. */
  readonly years = [2024, 2025, 2026, 2027, 2028];

  // TODO: replace with the signed-in user once identity lands — same gap as everywhere else.
  private readonly currentUser = 'Devojeet Modak';

  year = new Date().getFullYear();
  plan: BudgetPlanDto | null = null;
  rows: BudgetRow[] = [];

  /** The top-down figure typed into "Total annual budget" before spreading. */
  spreadTotal: number | null = null;

  sites: LookupItemDto[] = [];
  accounts: LookupItemDto[] = [];
  currencies: LookupItemDto[] = [];
  siteId = 0;
  accountId = 0;
  currencyId = 0;

  isLoading = false;
  isSaving = false;
  /** Set by any edit; cleared on save. Drives the unsaved-changes warning. */
  isDirty = false;

  /** Whether the "this budget is approved — edit anyway?" confirmation is showing. */
  showReopenConfirm = false;

  constructor(
    private budgetService: BudgetService,
    private masterData: MasterDataService,
    private snackbar: SnackbarService,
    private loader: LoaderService,
  ) {}

  ngOnInit(): void {
    this.loadLookups();
    this.load();
  }

  // ── Loading ────────────────────────────────────────────────────────────────────────────

  private loadLookups(): void {
    this.masterData.getSites().subscribe({ next: x => (this.sites = x), error: () => (this.sites = []) });
    // Flat, not the grouped getAccounts() — this is a single picker, not a hierarchy.
    this.masterData.getAccountsFlat().subscribe({ next: x => (this.accounts = x), error: () => (this.accounts = []) });
    this.masterData.getCurrencies().subscribe({ next: x => (this.currencies = x), error: () => (this.currencies = []) });
  }

  load(): void {
    this.isLoading = true;
    this.loader.show('Loading budget…');

    this.budgetService.get(this.year).subscribe({
      next: plan => {
        this.plan = plan;
        this.rows = plan.teams.map(t => this.toRow(t));
        this.siteId = plan.siteId;
        this.accountId = plan.accountId;
        this.currencyId = plan.currencyId;
        this.spreadTotal = plan.totalBudget > 0 ? plan.totalBudget : null;
        this.isDirty = false;
        this.isLoading = false;
        this.loader.hide();
      },
      error: err => {
        this.isLoading = false;
        this.loader.hide();
        this.snackbar.show(this.errorText(err, 'Could not load the budget'), 'error');
      },
    });
  }

  private toRow(t: BudgetTeamRowDto): BudgetRow {
    // Copy the array — binding straight to the DTO would make the "reload discards edits"
    // behaviour a lie.
    const months = Array.from({ length: 12 }, (_, i) => t.months?.[i] ?? null);
    return { teamId: t.teamId, teamName: t.teamName, months, forecastTotal: t.forecastTotal };
  }

  onYearChange(year: number): void {
    this.year = Number(year);
    this.load();
  }

  // ── Totals ─────────────────────────────────────────────────────────────────────────────

  rowTotal(row: BudgetRow): number {
    return row.months.reduce((sum: number, v) => sum + (v ?? 0), 0);
  }

  monthTotal(monthIndex: number): number {
    return this.rows.reduce((sum, r) => sum + (r.months[monthIndex] ?? 0), 0);
  }

  get grandTotal(): number {
    return this.rows.reduce((sum, r) => sum + this.rowTotal(r), 0);
  }

  get totalForecast(): number {
    return this.rows.reduce((sum, r) => sum + r.forecastTotal, 0);
  }

  /** Budget minus forecast. Positive = budget is above the current plan. */
  get varianceVsForecast(): number {
    return this.grandTotal - this.totalForecast;
  }

  // ── Spreading ──────────────────────────────────────────────────────────────────────────

  /**
   * Spreads a single annual figure evenly across all 12 months of every team.
   *
   * ⚠️ The remainder goes onto December rather than being lost to rounding — 100,000 / 12 is
   * 8,333.33, and twelve of those is 99,999.96. A budget that does not add up to the number
   * someone typed is a budget nobody will trust.
   */
  spreadEvenlyAcrossTeams(): void {
    if (this.isApproved) return;
    const total = Number(this.spreadTotal);
    if (!total || total <= 0) {
      this.snackbar.show('Enter a total annual budget first.', 'warning');
      return;
    }
    if (this.rows.length === 0) return;

    // Split between teams first, then across months, so each team's own row also adds up.
    const perTeam = this.splitEvenly(total, this.rows.length);
    this.rows.forEach((row, i) => (row.months = this.splitEvenly(perTeam[i], 12)));

    this.isDirty = true;
    this.snackbar.show(
      `Spread ${this.money(total)} evenly across ${this.rows.length} teams and 12 months.`, 'success');
  }

  /** Spreads one team's annual figure across its own 12 months. */
  spreadRowEvenly(row: BudgetRow): void {
    if (this.isApproved) return;
    const total = this.rowTotal(row);
    if (total <= 0) {
      this.snackbar.show(`Enter a figure for ${row.teamName} first.`, 'warning');
      return;
    }
    row.months = this.splitEvenly(total, 12);
    this.isDirty = true;
  }

  /**
   * Divides `total` into `parts` values that sum back to exactly `total`.
   * Every part is rounded to 2dp and the remainder lands on the last one.
   */
  private splitEvenly(total: number, parts: number): number[] {
    const each = Math.round((total / parts) * 100) / 100;
    const result = new Array(parts).fill(each);
    const drift = Math.round((total - each * parts) * 100) / 100;
    result[parts - 1] = Math.round((each + drift) * 100) / 100;
    return result;
  }

  clearAll(): void {
    if (this.isApproved) return;
    this.rows.forEach(r => (r.months = new Array(12).fill(null)));
    this.spreadTotal = null;
    this.isDirty = true;
  }

  onCellChange(row: BudgetRow, monthIndex: number, value: string): void {
    const parsed = value === '' || value == null ? null : Number(value);
    row.months[monthIndex] = parsed == null || isNaN(parsed) ? null : parsed;
    this.isDirty = true;
  }

  onRowTotalChange(row: BudgetRow, value: string): void {
    const parsed = Number(value);
    if (isNaN(parsed) || parsed <= 0) return;
    row.months = this.splitEvenly(parsed, 12);
    this.isDirty = true;
  }

  // ── Saving / approving ─────────────────────────────────────────────────────────────────

  get isApproved(): boolean {
    return this.plan?.isApproved === true;
  }

  get canEdit(): boolean {
    return !!this.plan?.scenarioExists && !this.isApproved;
  }

  save(): void {
    if (!this.canEdit || !this.plan) return;

    this.isSaving = true;
    this.loader.show('Saving budget…');

    this.budgetService.save({
      year: this.year,
      siteId: this.siteId,
      accountId: this.accountId,
      currencyId: this.currencyId,
      lastUpdatedBy: this.currentUser,
      teams: this.rows.map(r => ({ teamId: r.teamId, months: r.months })),
    }).subscribe({
      next: plan => {
        this.plan = plan;
        this.rows = plan.teams.map(t => this.toRow(t));
        this.isDirty = false;
        this.isSaving = false;
        this.loader.hide();
        this.snackbar.show(
          `${this.year} budget saved — ${this.money(plan.totalBudget)} across ${plan.teams.length} teams.`,
          'success');
      },
      error: err => {
        this.isSaving = false;
        this.loader.hide();
        this.snackbar.show(this.errorText(err, 'Could not save the budget'), 'error');
      },
    });
  }

  approve(): void {
    if (!this.canEdit) return;
    if (this.isDirty) {
      this.snackbar.show('Save your changes before approving.', 'warning');
      return;
    }

    this.isSaving = true;
    this.loader.show('Approving budget…');

    this.budgetService.approve(this.year, this.currentUser).subscribe({
      next: plan => {
        this.plan = plan;
        this.rows = plan.teams.map(t => this.toRow(t));
        this.isSaving = false;
        this.loader.hide();
        this.snackbar.show(`${this.year} budget approved and locked.`, 'success');
      },
      error: err => {
        this.isSaving = false;
        this.loader.hide();
        this.snackbar.show(this.errorText(err, 'Could not approve the budget'), 'error');
      },
    });
  }

  // ── Reopening an approved budget ───────────────────────────────────────────────────────

  /**
   * The message shown in the unlock confirmation.
   *
   * Written as a full explanation rather than a terse "Are you sure?" — the user is about to
   * undo a sign-off, and they should be able to see who approved it and when without leaving
   * the dialog.
   */
  get reopenMessage(): string {
    const who = this.plan?.approvedBy || 'someone';
    const when = this.plan?.approvedDate
      ? new Date(this.plan.approvedDate).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
        })
      : 'an earlier date';

    return `The ${this.year} budget was approved by ${who} on ${when} and is currently locked. ` +
      `It is the baseline the dashboard measures actual spend against, so reopening it will ` +
      `change how every variance figure is reported.`;
  }

  readonly reopenDetail =
    'Choosing Yes unlocks the budget so you can edit and save it again. You will need to ' +
    'approve it a second time once the revised figures are final.';

  askToReopen(): void {
    this.showReopenConfirm = true;
  }

  cancelReopen(): void {
    this.showReopenConfirm = false;
  }

  confirmReopen(): void {
    this.showReopenConfirm = false;
    this.isSaving = true;
    this.loader.show('Reopening budget…');

    this.budgetService.reopen(this.year, this.currentUser).subscribe({
      next: plan => {
        this.plan = plan;
        this.rows = plan.teams.map(t => this.toRow(t));
        this.isDirty = false;
        this.isSaving = false;
        this.loader.hide();
        this.snackbar.show(
          `${this.year} budget reopened — you can edit it again. Remember to approve it when you are done.`,
          'success');
      },
      error: err => {
        this.isSaving = false;
        this.loader.hide();
        this.snackbar.show(this.errorText(err, 'Could not reopen the budget'), 'error');
      },
    });
  }

  // ── Formatting ─────────────────────────────────────────────────────────────────────────

  money(value: number): string {
    const code = this.plan?.currencyCode || '';
    return `${code} ${Math.round(value).toLocaleString('en-GB')}`.trim();
  }

  private errorText(err: any, fallback: string): string {
    return err?.error?.error ?? err?.message ?? fallback;
  }
}
