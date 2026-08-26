import { Injectable } from '@angular/core';
import { BehaviorSubject, MonoTypeOperatorFunction, Observable, defer } from 'rxjs';
import { finalize } from 'rxjs/operators';

/** What the global loader is currently showing. */
export interface LoaderState {
  active: boolean;
  message: string;
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
  private readonly state = new BehaviorSubject<LoaderState>({ active: false, message: '' });
  readonly state$ = this.state.asObservable();

  /**
   * Outstanding show() calls.
   *
   * Reference-counted rather than a plain boolean because two requests can legitimately
   * overlap (a year change firing while an earlier load is still in flight). With a boolean
   * the first one to finish would hide the overlay while the second was still running.
   */
  private pending = 0;

  /** One entry per outstanding show(); the newest is what the overlay displays. */
  private messages: string[] = [];

  get isActive(): boolean { return this.pending > 0; }

  show(message = 'Loading…'): void {
    this.pending++;
    this.messages.push(message);
    this.emit();
  }

  hide(): void {
    if (this.pending === 0) return;   // unbalanced hide() must never drive the count negative
    this.pending--;
    this.messages.pop();
    this.emit();
  }

  /** Clear everything regardless of the count — for a hard reset, e.g. on navigation. */
  reset(): void {
    this.pending = 0;
    this.messages = [];
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
        this.show(message);
        return source;
      }).pipe(finalize(() => this.hide()));
  }

  private emit(): void {
    this.state.next({
      active: this.pending > 0,
      message: this.messages[this.messages.length - 1] ?? ''
    });
  }
}
