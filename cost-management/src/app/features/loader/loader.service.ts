import { Injectable } from '@angular/core';
import { BehaviorSubject, MonoTypeOperatorFunction, Observable, defer } from 'rxjs';
import { finalize } from 'rxjs/operators';

/** What the global loader is currently showing. */
export interface LoaderState {
  active: boolean;
  message: string;
  /** True while a screen is hosting its own anchored loader, so the shell overlay stands down. */
  anchored: boolean;
}

/**
 * Drives the module's single global loading overlay (`<cm-loader global>`, mounted once in
 * the shell alongside `<cm-snackbar>`). Mirrors SnackbarService: injected anywhere, one
 * instance rendered in one place.
 *
 * Use it for a blocking wait the user shouldn't interact through. A screen that already has
 * somewhere sensible to put a spinner — a table body, a card — is better served by an inline
 * `<cm-loader [show]="…">`, which doesn't cover the whole page.
 */
@Injectable({ providedIn: 'root' })
export class LoaderService {
  private readonly state = new BehaviorSubject<LoaderState>({ active: false, message: '', anchored: false });
  readonly state$ = this.state.asObservable();

  /**
   * One entry per outstanding show(), newest last; the newest is what the overlay displays.
   *
   * A LIST rather than a boolean because two waits can legitimately overlap (a year change
   * firing while an earlier load is still in flight); with a boolean the first to finish would
   * hide the overlay while the second was still running.
   *
   * Each entry carries an id so hide(id) can remove THE ONE ITS show() CREATED. Popping the
   * newest instead is wrong whenever waits overlap and finish out of order: leave a screen
   * mid-load, and its late hide() would pop the NEXT screen's entry, leaving the new screen
   * showing the old screen's message until its own request finished.
   */
  private entries: { id: number; message: string }[] = [];

  private seq = 0;

  /**
   * Mounted `<cm-loader [global]="true" [overlay]="false">` instances.
   *
   * A screen that places its own anchored loader is saying "render the wait HERE, in my content
   * area". While one is mounted the shell's full-screen overlay suppresses itself, so a single
   * show() lights exactly one indicator rather than both. Counted rather than a boolean because
   * routing overlaps: the incoming screen's anchor registers before the outgoing one's is
   * released, and a boolean would be switched off by that teardown.
   */
  private anchors = 0;

  get isActive(): boolean { return this.entries.length > 0; }

  /** Returns a token to pass to hide(). Callers that ignore it get the old newest-first behaviour. */
  show(message = 'Loading…'): number {
    const id = ++this.seq;
    this.entries.push({ id, message });
    this.emit();
    return id;
  }

  hide(id?: number): void {
    if (this.entries.length === 0) return;   // an unbalanced hide() must never go negative
    if (id === undefined) {
      this.entries.pop();
    } else {
      const i = this.entries.findIndex(e => e.id === id);
      if (i === -1) return;                  // already removed, e.g. by reset()
      this.entries.splice(i, 1);
    }
    this.emit();
  }

  /** Called by an anchored loader on init; pair with releaseAnchor() on destroy. */
  registerAnchor(): void {
    this.anchors++;
    this.emit();
  }

  releaseAnchor(): void {
    if (this.anchors === 0) return;
    this.anchors--;
    this.emit();
  }

  /** Clear everything regardless of the count — for a hard reset, e.g. on navigation. */
  reset(): void {
    this.entries = [];
    // anchors are NOT cleared: they track mounted components, not in-flight work.
    this.emit();
  }

  /**
   * Pipe an observable through the overlay: shows on subscribe, hides on complete, error OR
   * unsubscribe.
   *
   * Preferred over calling show()/hide() by hand, because `finalize` runs on every one of
   * those paths. A hand-written pair placed only in `next` and `error` leaks a permanent
   * overlay the first time a switchMap cancels the request.
   */
  track<T>(message?: string): MonoTypeOperatorFunction<T> {
    return (source: Observable<T>) =>
      // defer so the counter moves on SUBSCRIBE, not when the operator is composed —
      // otherwise a cold observable built early would light the overlay immediately.
      defer(() => {
        // Captured per subscription, so the matching hide() removes exactly this wait.
        const id = this.show(message);
        return source.pipe(finalize(() => this.hide(id)));
      });
  }

  private emit(): void {
    this.state.next({
      active: this.entries.length > 0,
      message: this.entries[this.entries.length - 1]?.message ?? '',
      anchored: this.anchors > 0
    });
  }
}
