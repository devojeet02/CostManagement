import { Component, EventEmitter, HostBinding, Input, Output } from '@angular/core';
import { ForecastComment } from '../../constants/forecast.constants';

/** One month's slot in the modal — its general note, its cell trail, and whether it's outstanding. */
export interface MonthCommentSlot {
  /** Column heading, e.g. "Mar 2026". */
  label: string;
  /**
   * The month's **cell comments** (CC) — the append-only justification trail, oldest first.
   * Read-only here; these are written on the grid cell itself.
   */
  cellComments: ForecastComment[];
  /** This month was edited on an already-saved line, so a cell comment is mandatory. */
  required: boolean;
  /** Locked month — the general box is shown but cannot be typed into. */
  disabled: boolean;
}

/**
 * The Monthly Comments modal for one forecast line.
 *
 * Two different things live under each month, and the distinction is the point:
 *
 * - **GC — General Comment.** One free-form note per month, edited here, replaced on save.
 *   This is the box the modal has always had; it now persists to the database rather than to
 *   the browser's localStorage.
 * - **CC — Cell Comments.** The mandatory justifications for changing that month's value
 *   (RFC criterion 5), append-only and written at the grid cell. **Read-only here** — they are
 *   a record of why numbers moved, and editing them would defeat the point. Collapsed behind a
 *   per-month button because a long-lived line accumulates them and they would otherwise bury
 *   the twelve general boxes.
 *
 * State stays with `ForecastComponent`: this renders `generalDrafts` and emits every keystroke
 * back up, so the screen keeps one source of truth for what the next save must write.
 */
@Component({
  selector: 'cm-forecast-comments-modal',
  templateUrl: './forecast-comments-modal.component.html',
  styleUrls: ['./forecast-comments-modal.component.scss']
})
export class ForecastCommentsModalComponent {
  /**
   * Removes the native `title` attribute from the host — see cm-modal for the full story.
   * Currently bound as `[title]`, which wouldn't leave one, but this host wraps cm-modal's
   * full-screen overlay, so writing the attribute form would resurrect the bug.
   */
  @HostBinding('attr.title') readonly hostTitle = null;

  @Input() isOpen = false;
  @Input() title = 'Monthly Comments';

  /** 12 slots, Jan–Dec. */
  @Input() slots: MonthCommentSlot[] = [];

  /** 12 general comments, Jan–Dec — the notes being edited now. */
  @Input() generalDrafts: string[] = [];

  /** (monthIndex, text) as the user types. */
  @Output() generalDraftChange = new EventEmitter<{ month: number; comment: string }>();

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  /**
   * Months whose cell trail is expanded, by index.
   *
   * Local view state on purpose — which panels are open is nobody else's business, and lifting
   * it to the screen would put a `Set` in the save path for no reason. Reset on close.
   */
  private expanded = new Set<number>();

  isExpanded(month: number): boolean {
    return this.expanded.has(month);
  }

  toggleCellComments(month: number): void {
    if (this.expanded.has(month)) this.expanded.delete(month);
    else this.expanded.add(month);
  }

  onClose(): void {
    this.expanded.clear();
    this.closed.emit();
  }

  onSave(): void {
    this.expanded.clear();
    this.saved.emit();
  }

  /** Months still needing a cell comment — these block the grid save. */
  get missing(): MonthCommentSlot[] {
    return this.slots.filter(s => s.required);
  }

  /** Those months named, e.g. "Mar 2026, Jul 2026" — a count alone doesn't say where to look. */
  get missingLabels(): string {
    return this.missing.map(s => s.label).join(', ');
  }

  onGeneralChange(month: number, comment: string): void {
    this.generalDraftChange.emit({ month, comment });
  }

  /** "Edit 1", "Edit 2", … in the order the edits happened. */
  editLabel(index: number): string {
    return `Edit ${index + 1}`;
  }

  trackSlot(index: number): number { return index; }

  trackComment(_index: number, c: ForecastComment): number { return c.id; }
}
