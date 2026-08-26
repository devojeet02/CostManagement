import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/**
 * Forecast operations — SHOWCASE BUILD.
 *
 * ⚠️ Only the members the ported screens actually call are present. The real service is much
 * larger; stubbing the whole thing would be dead code that later readers would mistake for a
 * working port. If another screen is brought over, add what it needs here deliberately.
 */
@Injectable({ providedIn: 'root' })
export class ForecastService {
  /** Scenario Management's "prepare a scenario" flow — reports a plausible copy count. */
  copyScenario(fromScenario: string, toScenario: string,
               lastUpdatedBy: string): Observable<{ linesCopied: number }> {
    return of({ linesCopied: 4 }).pipe(delay(260));
  }
}
