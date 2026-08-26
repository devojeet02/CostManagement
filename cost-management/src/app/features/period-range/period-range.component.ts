import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

/** A month range, 1-12 inclusive. `1-12` means the whole year. */
export interface PeriodRange {
  from: number;
  to: number;
}

/**
 * Dual-ended period picker — pick a FROM month and a TO month.
 *
 * ── Why months and not dates ───────────────────────────────────────────────────────────────
 * Modelled on the AKS GlobalCalendar's two-ended interaction, but at MONTH precision, because
 * that is the finest grain this data has:
 *
 *   - invoice lines carry `PostingMonth` / `PostingYear` — no day component in the aggregation
 *   - forecast rows carry twelve month COLUMNS — no day granularity exists at all
 *   - `tblCMPeriod`, this module's own period concept, is keyed (PeriodYear, PeriodMonth)
 *
 * A day-precision range would happily accept "12 Mar - 27 Aug" and return whole months, showing
 * a precision the database cannot honour. Offering only what can be answered is the point.
 *
 * Presets cover what people actually ask for — this quarter, this month, year to date — so the
 * common cases are one click rather than two.
 */
@Component({
  selector: 'cm-period-range',
  templateUrl: './period-range.component.html',
  styleUrls: ['./period-range.component.scss'],
})
export class PeriodRangeComponent {
  static readonly MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  readonly months = PeriodRangeComponent.MONTHS;

  @Input() from = 1;
  @Input() to = 12;

  /**
   * Highest month with posted actuals, from `actualsThroughMonth`. Drives the "Year to date"
   * preset and dims months with nothing in them yet — selecting those returns zeros, which
   * looks like a broken filter rather than an empty future.
   */
  @Input() actualsThroughMonth = 0;

  @Output() rangeChange = new EventEmitter<PeriodRange>();

  isOpen = false;

  /** Which end the next click sets. Reset to 'from' whenever the panel opens. */
  private picking: 'from' | 'to' = 'from';

  /** Provisional start while a range is mid-selection, for the hover preview. */
  private pendingFrom: number | null = null;
  hoverMonth: number | null = null;

  constructor(private elementRef: ElementRef) {}

  get isWholeYear(): boolean {
    return this.from === 1 && this.to === 12;
  }

  get label(): string {
    if (this.isWholeYear) return 'Period: Full year';
    if (this.from === this.to) return `Period: ${this.months[this.from - 1]}`;
    return `Period: ${this.months[this.from - 1]} – ${this.months[this.to - 1]}`;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.picking = 'from';
      this.pendingFrom = null;
      this.hoverMonth = null;
    }
  }

  /**
   * Two-click selection: first click sets the start, second the end.
   *
   * Clicking a month EARLIER than the pending start is treated as a new start rather than an
   * error — it is what someone means when they overshoot, and refusing it just makes them click
   * twice more.
   */
  selectMonth(month: number): void {
    if (this.picking === 'from' || this.pendingFrom == null) {
      this.pendingFrom = month;
      this.picking = 'to';
      return;
    }

    if (month < this.pendingFrom) {
      this.pendingFrom = month;
      return;
    }

    this.emit(this.pendingFrom, month);
    this.pendingFrom = null;
    this.picking = 'from';
    this.isOpen = false;
  }

  // ── Presets ──────────────────────────────────────────────────────────────────────────

  /** Through the last posted month — the "year to date" of F1-AC3. Falls back to the full year. */
  applyYearToDate(): void {
    this.emitAndClose(1, this.actualsThroughMonth || 12);
  }

  /** The quarter containing the last posted month, or the current calendar quarter. */
  applyCurrentQuarter(): void {
    const anchor = this.actualsThroughMonth || new Date().getMonth() + 1;
    const start = Math.floor((anchor - 1) / 3) * 3 + 1;
    this.emitAndClose(start, start + 2);
  }

  /** The last month that actually has data — "current period" in the usual sense. */
  applyCurrentMonth(): void {
    const anchor = this.actualsThroughMonth || new Date().getMonth() + 1;
    this.emitAndClose(anchor, anchor);
  }

  applyFullYear(): void {
    this.emitAndClose(1, 12);
  }

  // ── Cell state ───────────────────────────────────────────────────────────────────────

  /** Start of the range being previewed — the committed one, or the pending click. */
  private get previewFrom(): number {
    return this.pendingFrom ?? this.from;
  }

  /** End of the preview: the hovered month while mid-selection, else the committed end. */
  private get previewTo(): number {
    if (this.pendingFrom != null) return this.hoverMonth ?? this.pendingFrom;
    return this.to;
  }

  isInRange(month: number): boolean {
    const lo = Math.min(this.previewFrom, this.previewTo);
    const hi = Math.max(this.previewFrom, this.previewTo);
    return month >= lo && month <= hi;
  }

  isEdge(month: number): boolean {
    return month === this.previewFrom || month === this.previewTo;
  }

  /** No actuals posted this month yet. Selectable — forecast and budget may still exist. */
  isFuture(month: number): boolean {
    return this.actualsThroughMonth > 0 && month > this.actualsThroughMonth;
  }

  onHover(month: number): void {
    if (this.pendingFrom != null) this.hoverMonth = month;
  }

  clearHover(): void {
    this.hoverMonth = null;
  }

  // ── Plumbing ─────────────────────────────────────────────────────────────────────────

  private emit(from: number, to: number): void {
    this.from = from;
    this.to = to;
    this.rangeChange.emit({ from, to });
  }

  private emitAndClose(from: number, to: number): void {
    this.emit(from, to);
    this.pendingFrom = null;
    this.picking = 'from';
    this.isOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen) return;
    if (!this.elementRef.nativeElement.contains(event.target)) {
      // Abandon a half-made selection rather than committing something never confirmed.
      this.isOpen = false;
      this.pendingFrom = null;
      this.picking = 'from';
    }
  }
}
