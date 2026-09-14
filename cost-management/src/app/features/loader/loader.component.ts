import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { LoaderService, LoaderState } from './loader.service';

/**
 * The module's shared loading indicator, in two shapes.
 *
 * **Inline** (default) — drop it where the content will appear:
 * ```html
 * <cm-loader [show]="loading" message="Loading invoices…"></cm-loader>
 * ```
 *
 * **Global overlay** — one instance, mounted in the shell next to `<cm-snackbar>`, driven by
 * `LoaderService` from anywhere:
 * ```html
 * <cm-loader [global]="true"></cm-loader>
 * ```
 *
 * The boolean inputs must be BOUND, not written as bare attributes: `strictTemplates` is on,
 * and `<cm-loader global>` passes the empty string, which fails to compile.
 *
 * It replaced four near-identical hand-rolled spinner blocks (Invoice View, Invoice Edit,
 * Forecast, Forecast Audit) that each carried their own copy of the same 28px ring and
 * @keyframes. Sizes and colours are unchanged from those, so the screens look exactly as
 * they did.
 *
 * Deliberately NOT used by `cm-related-data-panel`: its spinner is part of a compact inline
 * status line ("⟳ Loading related data…") tuned to that panel, and it works well as it is.
 */
@Component({
  selector: 'cm-loader',
  templateUrl: './loader.component.html',
  styleUrls: ['./loader.component.scss']
})
export class LoaderComponent implements OnInit, OnDestroy {
  /** Inline mode: whether to render. Ignored when `global` is set. */
  @Input() show = true;

  /** Text beside/under the spinner. Blank renders the spinner alone. */
  @Input() message = '';

  /** 14px / 28px / 40px ring. 28px matches every spinner this component replaced. */
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  /** Stack the message under the spinner (default) or sit it alongside. */
  @Input() layout: 'column' | 'row' = 'column';

  /** Add the standard state-block padding, for use as a standalone block. */
  @Input() padded = false;

  /**
   * Render as the full-screen overlay driven by LoaderService instead of an inline block.
   * Exactly one instance in the module should set this — the one in the shell.
   */
  @Input() global = false;

  /**
   * Global mode only. `true` (default) is the fixed full-screen scrim + card. `false` anchors the
   * wait to THIS element's container instead: same LoaderService driving it, but drawn as a scoped
   * cover over the content area rather than a card floating over the whole shell.
   *
   * Use it on a screen whose wait belongs to one region — a grid, a dashboard body. The card reads
   * as a modal popping up, which is right for a blocking action and wrong for "this panel is
   * fetching". While an anchored loader is mounted the shell's overlay stands down, so callers
   * keep using loader.track() and get the right presentation for the screen they are on.
   *
   * The host container must be a positioned ancestor - see .cm-loader-scoped.
   */
  @Input() overlay = true;

  private serviceState: LoaderState = { active: false, message: '', anchored: false };
  private sub?: Subscription;

  constructor(private loader: LoaderService) {}

  /** Service-driven, but drawn in place rather than as the shell-wide overlay. */
  get anchored(): boolean { return this.global && !this.overlay; }

  ngOnInit(): void {
    if (!this.global) return;

    if (this.anchored) this.loader.registerAnchor();

    this.sub = this.loader.state$.subscribe(state => {
      // Applied on a microtask, not synchronously.
      //
      // Callers legitimately call show() from their own ngOnInit (screens start loading as
      // soon as they appear). Writing straight to the field there would change this
      // already-checked component mid-pass and trip
      // ExpressionChangedAfterItHasBeenCheckedError in dev builds. A microtask lands the
      // value before Zone.js runs the next change-detection turn, so nothing is visibly
      // delayed — it just moves to a pass that hasn't started yet.
      Promise.resolve().then(() => (this.serviceState = state));
    });
  }

  ngOnDestroy(): void {
    if (this.anchored) this.loader.releaseAnchor();
    this.sub?.unsubscribe();
  }

  get visible(): boolean {
    if (!this.global) return this.show;
    // The shell's overlay yields to any anchored loader, so one show() lights one indicator.
    if (this.overlay) return this.serviceState.active && !this.serviceState.anchored;
    return this.serviceState.active;
  }

  get text(): string {
    return this.global ? this.serviceState.message : this.message;
  }
}
