import { Component, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { DashboardMonthPointDto } from '../../services/cost-dashboard.service';

/** One month, resolved to pixel positions. */
interface TrendPoint {
  month: string;
  x: number;
  actual: number | null;
  budget: number | null;
  actualY: number | null;
  budgetY: number | null;
  /** actual − budget. Null when either side is missing — a gap, not a zero variance. */
  variance: number | null;
}

/**
 * Actuals vs Budget over time (Dashboard & Analytics epic, F4).
 *
 * ── Why this is a separate component ───────────────────────────────────────────────────────
 * The dashboard already has "Actual Spend vs Rolling Forecast". That chart answers an
 * OPERATIONAL question — are we tracking to our latest estimate? This one answers a GOVERNANCE
 * question — are we within what was signed off? Same shape, different meaning, different
 * audience. Adding a third series to the existing chart would blur both and put a working,
 * much-used view at risk for a feature that is still growing (F4 also wants a cumulative view
 * and a variance line).
 *
 * Deliberately self-contained: it takes the server's monthly series and renders it, holding no
 * knowledge of the dashboard's filters, sample-data fallback or KPI logic.
 *
 * ⚠️ Budget is NOT rolling forecast. `monthly[].budget` comes from forecast rows under a Budget
 * scenario, which only the Budget Planner can write. It is empty for any year nobody has
 * budgeted — hence the empty state rather than a chart of zeros.
 */
@Component({
  selector: 'cm-budget-trend',
  templateUrl: './budget-trend.component.html',
  styleUrls: ['./budget-trend.component.scss'],
})
export class BudgetTrendComponent {
  private static readonly MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  @Input() set monthly(value: DashboardMonthPointDto[] | null) {
    this.source = value ?? [];
  }

  /** Currency the figures are in, e.g. "GBP". Blank when the totals mix currencies. */
  @Input() currency = '';
  @Input() year = new Date().getFullYear();

  /**
   * The narrowing filters currently applied upstream, so the empty state can tell "no budget
   * exists" apart from "no budget matches what you filtered to".
   *
   * ⚠️ Worth the extra inputs. A whole year's budget is booked against ONE site, so filtering to
   * any other site — or to a currency that site does not use — legitimately returns no budget
   * while actual spend still shows. Without this the chart said "No budget entered for 2026" and
   * sent the user to the Budget Planner, when the real fix was to clear a filter.
   */
  @Input() activeSiteLabel = '';
  @Input() activeCurrencies: string[] = [];

  private source: DashboardMonthPointDto[] = [];

  hovered: TrendPoint | null = null;

  /** 'monthly' = spend in each month; 'cumulative' = running year-to-date total (F4-AC2). */
  mode: 'monthly' | 'cumulative' = 'monthly';

  setMode(mode: 'monthly' | 'cumulative'): void {
    this.mode = mode;
    this.hovered = null;   // a tooltip showing monthly figures over a cumulative chart lies
  }

  /**
   * The series actually plotted — the raw months, or their running totals.
   *
   * ⚠️ Cumulative is not simply `reduce`. Two rules keep it honest:
   *
   * 1. **The actual line still starts and ends where real data does.** Running it from January
   *    would plot 0 for months that have not been loaded, and running it to December would hold
   *    a flat line across months that have not happened — both read as "we spent nothing", which
   *    is a claim the data does not make. Between the first and last posted month a gap DOES
   *    carry the total forward, because there the flat segment is true: no spend that month.
   * 2. **Budget accumulates independently.** It is known for the whole year up front, so its
   *    curve runs Jan-Dec regardless of how far actuals have got.
   */
  private get series(): DashboardMonthPointDto[] {
    if (this.mode === 'monthly') return this.source;

    const actualIndexes = this.source
      .map((m, i) => (m.actual != null ? i : -1))
      .filter((i) => i >= 0);
    const firstActual = actualIndexes.length ? actualIndexes[0] : -1;
    const lastActual = actualIndexes.length ? actualIndexes[actualIndexes.length - 1] : -1;

    let runningActual = 0;
    let runningBudget = 0;
    let budgetStarted = false;

    return this.source.map((m, i) => {
      if (m.actual != null) runningActual += m.actual;
      if (m.budget != null) { runningBudget += m.budget; budgetStarted = true; }

      const inActualRange = firstActual >= 0 && i >= firstActual && i <= lastActual;

      return {
        month: m.month,
        actual: inActualRange ? runningActual : null,
        budget: budgetStarted ? runningBudget : null,
        forecast: null,
      };
    });
  }

  // Geometry. Fixed viewBox, scaled by CSS — same approach as the dashboard's own charts.
  //
  // Two stacked plots share the x axis: the spend chart on top, and a variance strip beneath it.
  // ⚠️ The variance needs its OWN band because it goes negative and the spend axis starts at 0 —
  // plotting an overspend of −70k on that scale would put it off the bottom of the chart.
  readonly width = 960;
  readonly height = 424;
  readonly padding = { top: 20, right: 24, bottom: 42, left: 74 };

  /**
   * Height of the variance strip, and the gap separating it from the spend chart.
   *
   * ⚠️ The gap also has to carry the strip's title, which sits above `varianceTop`. At 16 the
   * two plots read as one crowded chart and the title collided with the spend baseline — the
   * separation is what tells the eye these are different scales.
   */
  private readonly varianceHeight = 84;
  private readonly varianceGap = 48;

  /** Bottom of the SPEND plot — not the bottom of the svg. */
  get mainBottom(): number {
    return this.height - this.padding.bottom - this.varianceHeight - this.varianceGap;
  }

  get varianceTop(): number { return this.mainBottom + this.varianceGap; }
  get varianceBottom(): number { return this.varianceTop + this.varianceHeight; }

  /** Zero sits mid-band, so over- and underspend get equal room either side. */
  get varianceZeroY(): number { return this.varianceTop + this.varianceHeight / 2; }

  /** True when a budget exists to compare against. Drives the empty state. */
  get hasBudget(): boolean {
    return this.source.some((m) => m.budget != null && m.budget !== 0);
  }

  /** Any spend in the current selection, even though no budget matched it. */
  get hasActuals(): boolean {
    return this.source.some((m) => m.actual != null && m.actual !== 0);
  }

  /** A site or currency selection is narrowing what this chart can see. */
  get isNarrowed(): boolean {
    return !!this.activeSiteLabel || this.activeCurrencies.length > 0;
  }

  /** "Amsterdam", "EUR", or "Amsterdam and EUR" — what to name in the empty state. */
  get narrowedBy(): string {
    const parts: string[] = [];
    if (this.activeSiteLabel) parts.push(this.activeSiteLabel);
    if (this.activeCurrencies.length) parts.push(this.activeCurrencies.join(' / '));
    return parts.join(' and ');
  }

  get points(): TrendPoint[] {
    const max = this.maxValue;
    const inner = this.width - this.padding.left - this.padding.right;
    // 12 slots, plotted at the CENTRE of each so the line is not flush with the axis.
    const step = inner / 12;

    return this.series.map((m, i) => {
      const x = this.padding.left + step * i + step / 2;
      return {
        month: BudgetTrendComponent.MONTHS[m.month - 1] ?? String(m.month),
        x,
        actual: m.actual,
        budget: m.budget,
        actualY: m.actual == null ? null : this.toY(m.actual, max),
        budgetY: m.budget == null ? null : this.toY(m.budget, max),
        // Only a real variance when BOTH exist. Treating a missing actual as 0 would report a
        // full-budget underspend for every month that has not happened yet.
        variance: m.actual == null || m.budget == null ? null : m.actual - m.budget,
      };
    });
  }

  private get maxValue(): number {
    // Scales to whatever is being plotted — cumulative totals are an order of magnitude larger
    // than monthly ones, so a fixed scale would flatten one mode or clip the other.
    const values = this.series.flatMap((m) => [m.actual ?? 0, m.budget ?? 0]);
    const max = Math.max(0, ...values);
    // Headroom so the peak is not welded to the top edge.
    return max === 0 ? 1 : max * 1.12;
  }

  private toY(value: number, max: number): number {
    const inner = this.mainBottom - this.padding.top;
    return this.padding.top + inner - (value / max) * inner;
  }

  get axisTicks(): number[] {
    const max = this.maxValue;
    return [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  }

  yFor(value: number): number {
    return this.toY(value, this.maxValue);
  }

  get baselineY(): number {
    return this.mainBottom;
  }

  // ── Variance strip (F4-AC3) ──────────────────────────────────────────────────────────
  //
  // The gap between actuals and budget, month by month. Above the zero line is overspend,
  // below is underspend. Drawn as a line with a filled area so the shape reads at a glance,
  // plus a dot per month for the hover target.

  /** True when at least one month can be compared. Months awaiting actuals are not variances. */
  get hasVariance(): boolean {
    return this.points.some((p) => p.variance != null);
  }

  /** Symmetric scale, so +50k and −50k are the same distance from zero. */
  private get maxAbsVariance(): number {
    const values = this.points
      .map((p) => p.variance)
      .filter((v): v is number => v != null)
      .map(Math.abs);
    const max = Math.max(0, ...values);
    return max === 0 ? 1 : max * 1.15;
  }

  varianceY(value: number): number {
    const half = this.varianceHeight / 2;
    return this.varianceZeroY - (value / this.maxAbsVariance) * half;
  }

  /** Per-month y for the variance series, null where there is nothing to compare. */
  varianceYFor(point: TrendPoint): number | null {
    return point.variance == null ? null : this.varianceY(point.variance);
  }

  /** Breaks on months with no variance — same rule as the actual line. */
  get variancePath(): string {
    let d = '';
    let pen = false;

    for (const p of this.points) {
      const y = this.varianceYFor(p);
      if (y == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p.x} ${y} `;
      pen = true;
    }
    return d.trim();
  }

  /** Area between the variance line and zero, closed back along the zero line. */
  get varianceArea(): string {
    const drawn = this.points.filter((p) => p.variance != null);
    if (drawn.length === 0) return '';

    const top = drawn.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${this.varianceY(p.variance!)} `).join('');
    const first = drawn[0];
    const last = drawn[drawn.length - 1];
    return `${top}L${last.x} ${this.varianceZeroY} L${first.x} ${this.varianceZeroY} Z`;
  }

  /** Extremes of the variance scale, for the strip's two axis labels. */
  get varianceTicks(): { value: number; y: number }[] {
    const max = this.maxAbsVariance;
    return [
      { value: max, y: this.varianceY(max) },
      { value: -max, y: this.varianceY(-max) },
    ];
  }

  /**
   * Whether the run of variances is net over budget — colours the strip.
   * Judged on the total, not the last month, so one heavy month does not flip the whole read.
   */
  get isNetOverBudget(): boolean {
    const total = this.points.reduce((sum, p) => sum + (p.variance ?? 0), 0);
    return total > 0;
  }

  /**
   * Path for one series, breaking wherever a month has no value.
   *
   * ⚠️ The break matters. Actuals stop at the last posted month, and joining across the gap
   * would draw a line implying spend that has not happened.
   */
  path(series: 'actual' | 'budget'): string {
    let d = '';
    let pen = false;

    for (const p of this.points) {
      const y = series === 'actual' ? p.actualY : p.budgetY;
      if (y == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p.x} ${y} `;
      pen = true;
    }
    return d.trim();
  }

  /** Filled area under the actual line, closed to the baseline. Empty when nothing has posted. */
  get actualArea(): string {
    const drawn = this.points.filter((p) => p.actualY != null);
    if (drawn.length === 0) return '';

    const top = drawn.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.actualY} `).join('');
    const first = drawn[0];
    const last = drawn[drawn.length - 1];
    return `${top}L${last.x} ${this.baselineY} L${first.x} ${this.baselineY} Z`;
  }

  // ── Today marker ─────────────────────────────────────────────────────────────────────
  //
  // Same behaviour as the Rolling Forecast chart's marker: a dotted line with a pill you can
  // drag across the chart, showing the live date as it moves, and offering the way back once
  // parked. Only on the current year — a "Today" line inside a closed year points at nothing.
  //
  // ⚠️ The x maths is NOT copied from the dashboard. That chart spreads 12 points across 11
  // intervals edge to edge; this one plots each month at the CENTRE of a 1/12 slot. Reusing the
  // dashboard's formula here would put the marker half a month out.

  @ViewChild('trendSvg') trendSvg?: ElementRef<SVGSVGElement>;

  /** Free x position while dragged, in SVG units. Null = sitting on the real today. */
  scrubX: number | null = null;
  isScrubbing = false;
  private didDrag = false;
  private downX = 0;

  /** Movement below this is still a click, not a drag — a mousemove fires on almost every click. */
  private static readonly DRAG_THRESHOLD_PX = 3;
  /** How near a point the line must get before its tooltip shows, in SVG units. */
  private static readonly POINT_SNAP_RADIUS = 16;

  get showTodayMarker(): boolean {
    return this.year === new Date().getFullYear();
  }

  /** Width of one month's slot. Points sit at the centre of theirs. */
  private get slotWidth(): number {
    return (this.width - this.padding.left - this.padding.right) / 12;
  }

  /** Fractional month index (0-11.99) → x, matching how the points are laid out. */
  private xForMonthFraction(fraction: number): number {
    return this.padding.left + this.slotWidth * fraction + this.slotWidth / 2;
  }

  get todayX(): number {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayProgress = (now.getDate() - 1) / daysInMonth;
    return this.xForMonthFraction(Math.min(11, Math.max(0, now.getMonth() + dayProgress)));
  }

  get todayLabel(): string {
    return new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  get markerX(): number {
    return this.scrubX ?? this.todayX;
  }

  get isMarkerMoved(): boolean {
    return this.scrubX !== null;
  }

  /** How far down the marker line runs — through the variance strip when one is drawn. */
  get markerBottom(): number {
    return this.hasVariance ? this.varianceBottom : this.mainBottom;
  }

  /** The date under the marker, derived from its x position. */
  get markerDateLabel(): string {
    const fraction = Math.min(11, Math.max(0,
      (this.markerX - this.padding.left - this.slotWidth / 2) / this.slotWidth));

    const monthIndex = Math.min(11, Math.floor(fraction));
    const daysInMonth = new Date(this.year, monthIndex + 1, 0).getDate();
    const day = Math.min(daysInMonth, Math.max(1,
      Math.round((fraction - monthIndex) * daysInMonth) + 1));

    return new Date(this.year, monthIndex, day)
      .toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  get markerLabel(): string {
    if (!this.isMarkerMoved) return `Today ${this.todayLabel}`;
    if (this.isScrubbing) return this.markerDateLabel;
    return 'Go back to Today';
  }

  get markerPillWidth(): number {
    if (!this.isMarkerMoved) return 74;
    return this.isScrubbing ? 52 : 104;
  }

  startScrub(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isScrubbing = true;
    this.didDrag = false;
    this.downX = event.clientX;
  }

  @HostListener('document:mousemove', ['$event'])
  onScrubMove(event: MouseEvent): void {
    if (!this.isScrubbing) return;
    if (Math.abs(event.clientX - this.downX) < BudgetTrendComponent.DRAG_THRESHOLD_PX) return;
    this.didDrag = true;
    this.scrubTo(event.clientX);
  }

  @HostListener('document:mouseup')
  onScrubEnd(): void {
    this.isScrubbing = false;
  }

  /** Clicking the parked pill returns to today. Ignored right after a drag, which also clicks. */
  onMarkerClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.didDrag || !this.isMarkerMoved) return;
    this.resetScrub();
  }

  resetScrub(): void {
    this.scrubX = null;
    this.hovered = null;
  }

  /**
   * ⚠️ The chart is a viewBox-scaled SVG, so a client coordinate must be divided by the
   * element's rendered width — otherwise the line drifts further from the pointer as the
   * window widens.
   */
  private scrubTo(clientX: number): void {
    const svg = this.trendSvg?.nativeElement;
    const points = this.points;
    if (!svg || points.length === 0) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;

    const raw = (clientX - rect.left) * (this.width / rect.width);
    this.scrubX = Math.min(this.width - this.padding.right, Math.max(this.padding.left, raw));

    let nearest: TrendPoint | null = null;
    let best = Infinity;
    for (const point of points) {
      const distance = Math.abs(point.x - this.scrubX);
      if (distance < best) { best = distance; nearest = point; }
    }

    // Between months there is nothing to report, so the tooltip clears rather than lingering.
    this.hovered = nearest && best <= BudgetTrendComponent.POINT_SNAP_RADIUS ? nearest : null;
  }

  setHovered(point: TrendPoint): void { this.hovered = point; }
  clearHovered(): void { this.hovered = null; }

  /** Keeps the tooltip inside the viewBox near the right-hand edge. */
  tooltipX(point: TrendPoint): number {
    return Math.min(point.x + 12, this.width - this.padding.right - 190);
  }

  money(value: number | null): string {
    if (value == null) return '—';
    const formatted = Math.round(value).toLocaleString('en-GB');
    return this.currency ? `${this.currency} ${formatted}` : formatted;
  }

  /** Axis labels stay short — full precision lives in the tooltip. */
  axisLabel(value: number): string {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(Math.round(value));
  }

  varianceLabel(point: TrendPoint): string {
    if (point.variance == null) return '—';
    const sign = point.variance > 0 ? '+' : '';
    return `${sign}${this.money(point.variance)}`;
  }

  /** Over budget is the thing worth noticing, so it gets the warning colour. */
  varianceColor(point: TrendPoint): string {
    if (point.variance == null) return '#8fa2ba';
    return point.variance > 0 ? '#ff6477' : '#14d59a';
  }

  trackByMonth(_index: number, point: TrendPoint): string {
    return point.month;
  }
}
