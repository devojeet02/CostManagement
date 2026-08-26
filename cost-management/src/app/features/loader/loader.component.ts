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

  private serviceState: LoaderState = { active: false, message: '' };
  private sub?: Subscription;

  constructor(private loader: LoaderService) {}

  ngOnInit(): void {
    if (!this.global) return;

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
    this.sub?.unsubscribe();
  }

  get visible(): boolean {
    return this.global ? this.serviceState.active : this.show;
  }

  get text(): string {
    return this.global ? this.serviceState.message : this.message;
  }
}
