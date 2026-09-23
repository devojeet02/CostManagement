import { Component, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnDestroy, Output, ViewChild } from '@angular/core';

/** Shared confirmation dialog. A small yes/no prompt for actions worth pausing on — deleting a row, discarding work, and so on. Every label is an input, so a caller phrases the question in its own terms rather than bending to a generic one. Purely presentational: it owns no business logic and performs no action itself. The host decides what "confirm" means and does the work in its own handler. It mirrors cm-modal's overlay, backdrop-click and Escape behaviour so it feels like the rest of the module, but is a separate component because cm-modal is a 680px content shell — far too wide for a one-line question. */
@Component({
  selector: 'cm-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.scss']
})
export class ConfirmDialogComponent implements OnDestroy {

  /** Theme custom properties the overlay's styles read. Copied on at move time: moving the node to <body> severs the inheritance from `.cm-root` and the card renders transparent. */
  private static readonly THEME_VARS = [
    '--bg-secondary', '--bg-hover', '--bg-primary', '--border-color',
    '--text-heading', '--text-primary', '--text-muted',
    '--accent-color', '--transition-speed',
  ];

  /** The overlay once moved, so it can be returned before Angular tears it down. */
  private movedOverlay: HTMLElement | null = null;

  /** Portals the overlay to <body> so it dims the WHOLE window, sidenav and top bar included. ⚠️ NOT a z-index problem — see cm-modal's `attachToBody` for why raising one cannot work. */
  @ViewChild('confirmOverlay')
  set confirmOverlay(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (el && el.parentElement !== document.body) {
      const inherited = getComputedStyle(this.hostEl.nativeElement);
      for (const name of ConfirmDialogComponent.THEME_VARS) {
        const value = inherited.getPropertyValue(name).trim();
        if (value) el.style.setProperty(name, value);
      }
      document.body.appendChild(el);
      this.movedOverlay = el;
    } else if (!el) {
      this.movedOverlay = null;
    }
  }

  /** ⚠️ Put the node back before *ngIf drops it (Angular asks the RECORDED parent), and on destroy, or it is stranded on <body>. */
  private restoreOverlay(): void {
    const el = this.movedOverlay;
    if (el && el.parentElement === document.body) {
      this.hostEl.nativeElement.appendChild(el);
    }
    this.movedOverlay = null;
  }

  constructor(private hostEl: ElementRef<HTMLElement>) {}

  ngOnDestroy(): void {
    this.restoreOverlay();
  }

  /** Visibility. The host owns this flag. */
  /** Removes the native `title` attribute from the host element. `title` is an @Input here, but callers write it as a STATIC attribute (`<cm-confirm-dialog title="Delete this row?">`) and a static attribute stays in the DOM as a real HTML `title` as well as feeding the input. The overlay is `position: fixed; inset: 0` INSIDE that host, so the browser showed its native tooltip wherever the pointer came to rest anywhere on screen for as long as the dialog was open. Fixed here rather than by switching every call site to `[title]="'…'"`, which would work but silently regresses the moment someone writes the attribute form again. */
  @HostBinding('attr.title') readonly hostTitle = null;

  @Input() isOpen = false;

  @Input() title = 'Are you sure?';

  /** The question itself. Keep it a full sentence — it is the main thing read. */
  @Input() message = '';

  /** Optional second line for consequences or context. */
  @Input() detail = '';

  @Input() confirmLabel = 'Yes';
  @Input() cancelLabel = 'No';

  /** 'danger' turns the confirm button red — use it for destructive actions. */
  @Input() variant: 'danger' | 'primary' = 'primary';

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  onConfirm(): void {
    this.confirmed.emit();
  }

  /** Backdrop click, the cancel button and Escape all land here. */
  onCancel(): void {
    this.cancelled.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.onCancel();
  }
}
