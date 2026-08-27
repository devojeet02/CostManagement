import {
  AfterViewChecked, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit,
  Output, SimpleChanges, ViewChild
} from '@angular/core';
import { ForecastComment } from '../../constants/forecast.constants';

/** Viewport rect of the grid cell the popover hangs off. */
export interface CellAnchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The justification popover for ONE month cell of a forecast line (RFC criterion 5).
 *
 * It opens against the cell being edited rather than as a page-centre dialog: the comment
 * explains one number, and pulling the user away from that number to a 12-box form made them
 * re-find which month they had just changed.
 *
 * Positioning is `position: fixed` off a viewport rect the parent captures from the cell.
 * The Forecast grid nests sticky, `z-index`-ed scroll wrappers, and anything rendered inside a
 * cell is painted by those stacking contexts no matter how high its own z-index goes — the same
 * trap `cm-hierarchy-select` hit. So the parent renders exactly one of these at the ROOT of its
 * template and feeds it coordinates; nothing is portalled to `<body>`, which is what made the
 * hierarchy-select fix so delicate.
 *
 * It holds no state of its own — the parent owns the draft, so a cancelled popover discards
 * cleanly and the save guard has a single source of truth.
 */
@Component({
  selector: 'cm-forecast-cell-comment',
  templateUrl: './forecast-cell-comment.component.html',
  styleUrls: ['./forecast-cell-comment.component.scss']
})
export class ForecastCellCommentComponent
  implements OnInit, OnChanges, AfterViewChecked, OnDestroy {
  @Input() isOpen = false;

  /** Column heading, e.g. "Mar 2026". */
  @Input() label = '';

  /** Which line and series the cell belongs to, e.g. "IO1 – CRM Migration · Forecast". */
  @Input() context = '';

  /** The justification being typed. Owned by the parent; this emits changes back. */
  @Input() comment = '';
  @Output() commentChange = new EventEmitter<string>();

  /** Everything already recorded for this month, oldest first. */
  @Input() history: ForecastComment[] = [];

  /**
   * True when this month's value was changed in this session and the line is already saved,
   * so a justification is required before the grid can be saved.
   */
  @Input() required = false;

  /** Locked month / read-only scenario — the box is shown but cannot be typed into. */
  @Input() disabled = false;

  /** Where the cell is on screen. Null keeps the popover off-screen rather than at 0,0. */
  @Input() anchor: CellAnchor | null = null;

  /**
   * Whether to put the caret in the comment box on open.
   *
   * **False when the popover opened because the user clicked into the CELL** — they are about
   * to type a number, and stealing the caret would make the cell impossible to edit. True when
   * they clicked the cell's comment marker, where writing the comment is the whole intent.
   */
  @Input() autoFocusInput = false;

  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('panel') panelRef?: ElementRef<HTMLDivElement>;
  @ViewChild('input') inputRef?: ElementRef<HTMLTextAreaElement>;

  /** Resolved viewport coordinates, written once per open by `place()`. */
  top = 0;
  left = 0;

  /**
   * False until `place()` has run for this open. The panel has to be in the DOM to be measured,
   * so for one frame it would otherwise sit at the coordinates of the PREVIOUS cell — a visible
   * jump from the last-edited month to this one. Hidden (not removed) until placed.
   */
  placed = false;

  /** Fixed width, so the left edge can be clamped before the panel has been measured. */
  private static readonly WIDTH = 320;

  /** Breathing room from the cell and from the viewport edges. */
  private static readonly GAP = 6;
  private static readonly MARGIN = 8;

  /** Set when a new anchor arrives; consumed by the next `ngAfterViewChecked`. */
  private needsPlacement = false;

  /** Focus the box on open only — re-focusing on every CD pass would fight the caret. */
  private needsFocus = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] || changes['anchor']) {
      this.needsPlacement = true;
      this.placed = false;
    }

    // Only ever on an explicit request — see `autoFocusInput`. `autoFocusInput` is checked for
    // a change of its own because clicking a cell's comment marker while the popover is ALREADY
    // open on that cell flips only this flag: `isOpen` never transitions, so keying the caret
    // off that alone would leave the click doing nothing.
    const opened = changes['isOpen']?.currentValue === true;
    const askedForCaret = changes['autoFocusInput']?.currentValue === true;
    if (this.isOpen && this.autoFocusInput && (opened || askedForCaret)) this.needsFocus = true;
  }

  /**
   * Placement runs after the view so the panel's real height is known — a trail of six edits is
   * three times the height of an empty box, and guessing would flip it above the cell wrongly.
   *
   * Guarded by `needsPlacement` so this is one pass per open, not a per-CD write loop, and
   * deferred to a MICROTASK because `top`/`left` are bound with `[style.top.px]`: writing them
   * straight from `ngAfterViewChecked` changes a binding that has just been checked and throws
   * `ExpressionChangedAfterItHasBeenCheckedError` in dev builds. The microtask lands the write
   * in a fresh change-detection cycle instead — the same trick LoaderService uses.
   */
  ngAfterViewChecked(): void {
    if (!this.isOpen) return;

    // Focus is tracked separately from placement: clicking the comment marker on the cell the
    // popover is already open against asks for the caret WITHOUT moving the panel.
    const place = this.needsPlacement;
    const focus = this.needsFocus;
    if (!place && !focus) return;
    this.needsPlacement = false;
    this.needsFocus = false;

    Promise.resolve().then(() => {
      if (!this.isOpen) return;
      if (place) this.place();
      if (focus) this.inputRef?.nativeElement.focus();
    });
  }

  /** Below the cell when it fits, above when it doesn't, clamped inside the viewport. */
  private place(): void {
    const a = this.anchor;
    const panel = this.panelRef?.nativeElement;
    if (!a || !panel) return;

    const { GAP, MARGIN, WIDTH } = ForecastCellCommentComponent;
    const height = panel.offsetHeight;

    const below = a.top + a.height + GAP;
    const above = a.top - height - GAP;
    // Prefer below; flip only when it would run off the bottom AND there is room above,
    // so a tall trail near the foot of the grid doesn't end up half off the top instead.
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    this.top = fitsBelow || above < MARGIN ? Math.min(below, window.innerHeight - height - MARGIN) : above;
    this.top = Math.max(MARGIN, this.top);

    // Right-align to the cell: month columns are ~74px, so left-aligning a 320px panel to a
    // December cell would push it past the edge and get clamped back into the wrong place.
    const preferred = a.left + a.width - WIDTH;
    this.left = Math.max(MARGIN, Math.min(preferred, window.innerWidth - WIDTH - MARGIN));

    this.placed = true;
  }

  /**
   * Keep the popover on its cell while the page or the grid scrolls.
   *
   * Bound manually in the CAPTURE phase rather than with `@HostListener('window:scroll')`:
   * the cell lives inside the grid's own scroll wrappers, and scroll does not bubble, so a
   * window-level listener never fires for the scroll that actually moves the cell.
   */
  private readonly onViewportChange = () => {
    if (!this.isOpen) return;
    // The anchor was captured in viewport coordinates, so re-read the cell's current position.
    const el = this.anchorEl;
    if (el) {
      const r = el.getBoundingClientRect();
      this.anchor = { top: r.top, left: r.left, width: r.width, height: r.height };
    }
    this.place();
  };

  /**
   * The cell element itself, so scrolling can re-read its position. Optional — without it the
   * popover simply stays where it was opened.
   */
  @Input() anchorEl: HTMLElement | null = null;

  /**
   * Close when the user goes somewhere else.
   *
   * This replaced a full-screen backdrop. A backdrop was fine while the popover only opened
   * after an edit, but now it opens the moment a cell is clicked, and an invisible sheet over
   * the grid swallowed the FIRST click on every other cell — moving between two months took
   * two clicks. Detecting the outside click instead leaves the grid fully clickable.
   *
   * Clicks on the anchor cell itself are ignored so the popover survives the user going back
   * to correct the number it belongs to.
   */
  private readonly onDocumentPointerDown = (e: Event) => {
    if (!this.isOpen) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (this.panelRef?.nativeElement.contains(target)) return;
    if (this.anchorEl?.contains(target)) return;
    this.closed.emit();
  };

  private readonly onDocumentKeydown = (e: KeyboardEvent) => {
    if (this.isOpen && e.key === 'Escape') this.closed.emit();
  };

  ngOnInit(): void {
    window.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
    // Capture phase: a handler on the grid could otherwise stop the event before it reaches us.
    document.addEventListener('mousedown', this.onDocumentPointerDown, true);
    document.addEventListener('keydown', this.onDocumentKeydown);
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    document.removeEventListener('mousedown', this.onDocumentPointerDown, true);
    document.removeEventListener('keydown', this.onDocumentKeydown);
  }

  /** The warning only fires once the box is actually empty, not merely because it's required. */
  get showWarning(): boolean {
    return this.required && !this.comment?.trim();
  }

  onInput(value: string): void {
    this.commentChange.emit(value);
  }

  /** "Edit 1", "Edit 2", … in the order the edits happened. */
  editLabel(index: number): string {
    return `Edit ${index + 1}`;
  }

  trackComment(_index: number, c: ForecastComment): number { return c.id; }
}
