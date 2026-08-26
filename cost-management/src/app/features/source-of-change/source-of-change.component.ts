import { Component, EventEmitter, Input, Output, SimpleChanges, OnChanges } from '@angular/core';
import {
  SourceOfChangeService, SourceOfChangeDto, SourceOfChangeTeamDto, SourceOfChangeLineDto,
} from '../../services/source-of-change.service';

/**
 * Source of Change report (Dashboard & Analytics epic, F5).
 *
 * "Which cost lines contributed to overspend in an RFC cycle versus the original Budget, and
 * why" — the variance per team, the lines that make it up, and the justifications captured
 * while those values were edited.
 *
 * ── Opened from the dashboard, but coupled to nothing ──────────────────────────────────────
 * Rendered in a `cm-modal` from a toolbar button rather than a route or a sidenav entry, and it
 * fetches through its own service. The dashboard's own load path, filters and layout are
 * untouched — the only change there is one button.
 *
 * ── The grain caveat ───────────────────────────────────────────────────────────────────────
 * The story asks for a per-LINE comparison. Budget is agreed per TEAM and carries no internal
 * order, supplier or category, so a per-line budget figure would have to be invented. The report
 * compares per team and lists the lines beneath, and says so via the server's `grainNote`.
 *
 * ⚠️ F5-AC6 — Jennifer's template has not arrived. This is a working report built on what the
 * data can prove; the presentation is expected to change once the template lands.
 */
@Component({
  selector: 'cm-source-of-change',
  templateUrl: './source-of-change.component.html',
  styleUrls: ['./source-of-change.component.scss'],
})
export class SourceOfChangeComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() year = new Date().getFullYear();

  @Output() closed = new EventEmitter<void>();

  data: SourceOfChangeDto | null = null;
  loading = false;
  loadError = false;

  scenario = '';
  overspendOnly = false;

  /** Teams expanded to show their lines. Collapsed by default — the variance is the headline. */
  private expanded = new Set<number>();

  constructor(private service: SourceOfChangeService) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Load when the modal opens, and reload if the year changed while it was open. Not on every
    // change: the dashboard re-renders often and this is a heavier query than it looks.
    if ((changes['isOpen'] && this.isOpen) || (changes['year'] && this.isOpen)) {
      this.load();
    }
  }

  load(): void {
    this.loading = true;
    this.loadError = false;

    this.service.get({
      year: this.year,
      scenario: this.scenario || null,
      overspendOnly: this.overspendOnly,
    }).subscribe({
      next: result => {
        this.data = result;
        // Adopt the server's choice on first load so the dropdown reflects what is shown.
        if (!this.scenario) this.scenario = result.scenarioCode;
        this.loading = false;
        // Open the worst offender — the report's whole point is what drove the overspend.
        this.expanded.clear();
        const worst = result.teams.find(t => t.isOverspend);
        if (worst) this.expanded.add(worst.teamId);
      },
      error: err => {
        console.error('Failed to load the Source of Change report', err);
        this.data = null;
        this.loading = false;
        this.loadError = true;
      },
    });
  }

  onScenarioChange(code: string): void {
    this.scenario = code;
    this.load();
  }

  toggleOverspendOnly(): void {
    this.overspendOnly = !this.overspendOnly;
    this.load();
  }

  // ── Expansion ────────────────────────────────────────────────────────────────────────

  isExpanded(team: SourceOfChangeTeamDto): boolean {
    return this.expanded.has(team.teamId);
  }

  toggleTeam(team: SourceOfChangeTeamDto): void {
    if (this.expanded.has(team.teamId)) this.expanded.delete(team.teamId);
    else this.expanded.add(team.teamId);
  }

  // ── Display ──────────────────────────────────────────────────────────────────────────

  get title(): string {
    return `Source of Change — ${this.data?.scenarioCode || ''} vs Budget ${this.year}`.trim();
  }

  money(value: number): string {
    const rounded = Math.round(value);
    return `${rounded < 0 ? '−' : ''}${Math.abs(rounded).toLocaleString('en-GB')}`;
  }

  /** Signed, because the sign is the whole message: + is over the agreed budget. */
  signedMoney(value: number): string {
    if (value === 0) return '0';
    return `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('en-GB')}`;
  }

  variancePercentLabel(team: SourceOfChangeTeamDto): string {
    if (!team.hasBudget || team.variancePercent == null) return '—';
    const v = team.variancePercent;
    return `${v > 0 ? '+' : ''}${v}%`;
  }

  /** Over budget is the thing worth noticing, so it gets the warning colour. */
  varianceClass(team: SourceOfChangeTeamDto): string {
    if (!team.hasBudget) return 'neutral';
    return team.variance > 0 ? 'over' : 'under';
  }

  fmtDate(value: string): string {
    const date = new Date(value);
    return isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  lineLabel(line: SourceOfChangeLineDto): string {
    return line.itemDescription?.trim() || line.internalOrder || line.supplier || '(no description)';
  }

  /** Total justifications across a team's lines — what the report exists to surface. */
  commentCount(team: SourceOfChangeTeamDto): number {
    return team.lines.reduce((sum, l) => sum + l.comments.length, 0);
  }

  get overspendCount(): number {
    return this.data?.teams.filter(t => t.isOverspend).length ?? 0;
  }

  trackByTeam(_i: number, team: SourceOfChangeTeamDto): number { return team.teamId; }
  trackByLine(_i: number, line: SourceOfChangeLineDto): number { return line.forecastDataId; }
}
