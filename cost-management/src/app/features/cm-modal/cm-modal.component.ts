import {
  Component, Input, Output, EventEmitter, HostBinding, HostListener, ElementRef, OnDestroy,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'cm-modal',
  templateUrl: './cm-modal.component.html',
  styleUrls: ['./cm-modal.component.scss']
})
export class CmModalComponent implements OnDestroy {
  /**
   * Renders the overlay as a child of `document.body` instead of leaving it where the component
   * sits in the DOM.
   *
   * ── Why this exists ──────────────────────────────────────────────────────────────────────
   * The overlay is `position: fixed; z-index: 2000`, which should put it above the app shell's
   * sidenav (1200). It did not: the shell's layout creates a STACKING CONTEXT around the routed
   * content, so the modal's z-index is only compared against its siblings inside that context,
   * never against the shell's own chrome. A fixed element inside a transformed ancestor is also
   * positioned and CLIPPED by that ancestor rather than the viewport.
   *
   * The symptoms were all one bug: the modal's left edge hidden behind the sidenav, the header
   * showing the shell's logo through it, the close button not responding because the shell was
   * on top intercepting the click, and the page behind still scrolling because the overlay was
   * not really covering it.
   *
   * Moving the node to `document.body` escapes every ancestor context at once. Safe under Ivy,
   * which removes nodes via their CURRENT `parentNode` rather than a parent recorded at creation.
   *
   * ⚠️ OPT-IN, default false. Every existing dialog in this module keeps its current behaviour;
   * only the wide ones that actually overlapped the shell set it. The others carry the same
   * latent bug and can opt in when it bites.
   */
  @Input() attachToBody = false;

  /**
   * Explicit card width, e.g. `min(1180px, calc(100vw - 48px))`.
   *
   * ⚠️ Needed BECAUSE of `attachToBody`. A caller normally sizes the card with
   * `:host ::ng-deep .modal-card`, which Angular compiles to `[_nghost-x] .modal-card` — once
   * the overlay moves to `<body>` it is no longer a descendant of the host, so that selector
   * silently stops matching and the card snaps back to its 680px default. Applied inline, which
   * survives the move.
   */
  @Input() cardWidth = '';

  /**
   * Custom properties the modal's own stylesheet reads. Callers set these on their `:host`, and
   * the overlay INHERITS them — until it is moved to `<body>`, which severs the inheritance and
   * leaves the card transparent with unreadable text. They are copied onto the element as inline
   * styles at move time so theming survives.
   *
   * ⚠️ Keep in step with the `var(--…)` names used in modal.component.scss.
   */
  private static readonly THEME_VARS = [
    '--bg-secondary', '--bg-hover', '--border-color',
    '--text-heading', '--text-primary', '--text-muted',
    '--accent-color', '--transition-speed',
  ];

  /** Where the overlay came from, so it can be put back before Angular tears it down. */
  private movedOverlay: HTMLElement | null = null;

  constructor(private hostRef: ElementRef<HTMLElement>) {}

  /**
   * Fires when the overlay enters or leaves the DOM (it is behind `*ngIf`), which is exactly
   * when the move needs doing or undoing.
   */
  @ViewChild('overlay')
  set overlay(ref: ElementRef<HTMLElement> | undefined) {
    if (!this.attachToBody) return;

    const el = ref?.nativeElement;
    if (el && el.parentElement !== document.body) {
      // Read the inherited custom properties BEFORE the move — afterwards they are gone.
      const inherited = getComputedStyle(this.hostRef.nativeElement);
      for (const name of CmModalComponent.THEME_VARS) {
        const value = inherited.getPropertyValue(name).trim();
        if (value) el.style.setProperty(name, value);
      }

      document.body.appendChild(el);
      this.movedOverlay = el;
    } else if (!el) {
      this.movedOverlay = null;
    }
  }

  ngOnDestroy(): void {
    // The host may be destroyed while still open (route change), leaving the relocated overlay
    // orphaned in <body> with no way to close it.
    this.movedOverlay?.remove();
    this.movedOverlay = null;
  }

  /**
   * Removes the native `title` attribute from the host element.
   *
   * Callers write `<cm-modal title="Invoice Change History">` — a static attribute, which
   * feeds the @Input AND stays in the DOM as a real HTML `title`. Since `.modal-overlay` is
   * `position: fixed; inset: 0` inside this host, the browser showed that title as a native
   * tooltip wherever the pointer rested, anywhere on screen, the whole time the modal was
   * open. Same fix as cm-confirm-dialog.
   */
  @HostBinding('attr.title') readonly hostTitle = null;

  @Input() title = '';
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();

  close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }
}
