import {
  Directive, ElementRef, HostListener, Input, OnDestroy, Renderer2
} from '@angular/core';

export type TooltipPosition =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * `cmTooltip` — the AKS platform's tooltip, ported to Angular as a directive.
 *
 * Drop-in replacement for the native `title` attribute, which renders as the browser's
 * unstyled OS tooltip (slow, unthemed, and out of place on a dark UI).
 *
 *   <button cmTooltip="Reopen the period to edit">…</button>
 *   <span [cmTooltip]="lockReason" cmTooltipPosition="bottom-left">…</span>
 *
 * ── Why a directive rather than a wrapper component ──
 * The React original wraps its child in a `.ttp-trigger` span and anchors the bubble to
 * that span. Their own notes record the consequence: inside a `flex-direction: column`
 * container the span stretches full width, so the bubble points at the row's centre
 * instead of the element, needing a per-site `align-self: flex-start` fix. A directive
 * attaches to the real element, so that class of bug cannot occur here.
 *
 * ── Positioning ──
 * The bubble is appended to `document.body` (the equivalent of their React portal) so it
 * escapes any `overflow: hidden` or stacking context, and is `position: fixed` against
 * the trigger's viewport rect, clamped to stay on screen.
 */
@Directive({
  selector: '[cmTooltip]'
})
export class TooltipDirective implements OnDestroy {

  /** Tooltip text. Empty/null disables the tooltip entirely — nothing is rendered. */
  @Input('cmTooltip') text: string | null | undefined = '';

  @Input('cmTooltipPosition') position: TooltipPosition = 'top';

  /** Milliseconds before showing. Matches the AKS default. */
  @Input('cmTooltipDelay') delay = 500;

  /** Extra class on the bubble — `ttp-dark` switches to the dark variant. */
  @Input('cmTooltipClass') extraClass = '';

  private bubble: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private el: ElementRef<HTMLElement>, private renderer: Renderer2) {}

  // ── Triggers ────────────────────────────────────────────────────────────────
  @HostListener('mouseenter') onEnter(): void { this.scheduleShow(); }
  @HostListener('focus')      onFocus(): void { this.scheduleShow(); }

  @HostListener('mouseleave') onLeave(): void { this.hide(); }
  @HostListener('blur')       onBlur(): void  { this.hide(); }

  /**
   * Clicking an element that then navigates away fires no mouseleave, which would strand
   * the bubble on screen. The AKS original hides on mousedown for exactly this reason.
   */
  @HostListener('mousedown')  onDown(): void  { this.hide(); }

  private scheduleShow(): void {
    if (!this.text || !String(this.text).trim()) return;

    // Clear any pending timer FIRST. Repeated mouseenter — the pointer crossing child
    // nodes inside the trigger — otherwise orphans a timer that fires after the pointer
    // has already left, leaving the tooltip stuck. Same fix as the AKS source.
    this.clearTimer();
    this.timer = setTimeout(() => this.show(), this.delay);
  }

  private show(): void {
    if (this.bubble) return;

    const bubble = this.renderer.createElement('div') as HTMLElement;
    const cls = `ttp-bubble ttp-${this.position}${this.extraClass ? ' ' + this.extraClass : ''}`;
    this.renderer.setAttribute(bubble, 'class', cls);
    this.renderer.setAttribute(bubble, 'role', 'tooltip');

    const content = this.renderer.createElement('div') as HTMLElement;
    this.renderer.setAttribute(content, 'class', 'ttp-content');
    this.renderer.appendChild(content, this.renderer.createText(String(this.text)));
    this.renderer.appendChild(bubble, content);

    const arrow = this.renderer.createElement('div') as HTMLElement;
    this.renderer.setAttribute(arrow, 'class', 'ttp-arrow');
    this.renderer.appendChild(bubble, arrow);

    // Geometry is set INLINE rather than left to the stylesheet. The directive positions the
    // bubble with top/left, which a statically-positioned element ignores — so if
    // tooltip.css has not loaded (a dev server that has not restarted since angular.json
    // changed, or a consumer that forgot to register it) the bubble would drop to the end of
    // <body> at the bottom of the page and the coordinates would do nothing. Owning the
    // layout here makes placement work regardless; the stylesheet owns only appearance.
    this.renderer.setStyle(bubble, 'position', 'fixed');
    this.renderer.setStyle(bubble, 'z-index', '99999');
    this.renderer.setStyle(bubble, 'pointer-events', 'none');
    // Measure off-screen first so the bubble is never painted at the wrong spot.
    this.renderer.setStyle(bubble, 'top', '0px');
    this.renderer.setStyle(bubble, 'left', '-9999px');

    // Body, not the host — escapes overflow/stacking contexts (the React portal's job).
    this.renderer.appendChild(document.body, bubble);
    this.bubble = bubble;

    this.position_();
  }

  /** Same placement algorithm and viewport clamping as the AKS component. */
  private position_(): void {
    if (!this.bubble) return;

    const t = this.el.nativeElement.getBoundingClientRect();
    const b = this.bubble.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (this.position) {
      case 'bottom':
        top = t.bottom + gap;
        left = t.left + t.width / 2 - b.width / 2;
        break;
      case 'left':
        top = t.top + t.height / 2 - b.height / 2;
        left = t.left - b.width - gap;
        break;
      case 'right':
        top = t.top + t.height / 2 - b.height / 2;
        left = t.right + gap;
        break;
      case 'top-left':
        top = t.top - b.height - gap;
        left = t.left;
        break;
      case 'top-right':
        top = t.top - b.height - gap;
        left = t.right - b.width;
        break;
      case 'bottom-left':
        top = t.bottom + gap;
        left = t.left;
        break;
      case 'bottom-right':
        top = t.bottom + gap;
        left = t.right - b.width;
        break;
      case 'top':
      default:
        top = t.top - b.height - gap;
        left = t.left + t.width / 2 - b.width / 2;
        break;
    }

    // Clamp to the viewport so a tooltip near an edge stays fully readable.
    const pad = 8;
    if (left < pad) left = pad;
    if (left + b.width > window.innerWidth - pad) left = window.innerWidth - b.width - pad;
    if (top < pad) top = pad;
    if (top + b.height > window.innerHeight - pad) top = window.innerHeight - b.height - pad;

    this.renderer.setStyle(this.bubble, 'top', `${top}px`);
    this.renderer.setStyle(this.bubble, 'left', `${left}px`);
  }

  private hide(): void {
    this.clearTimer();
    if (this.bubble) {
      this.renderer.removeChild(document.body, this.bubble);
      this.bubble = null;
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * The bubble lives on document.body, so destroying the host does NOT remove it. Without
   * this, navigating away mid-hover would leave an orphan bubble on screen forever.
   */
  ngOnDestroy(): void {
    this.hide();
  }
}
