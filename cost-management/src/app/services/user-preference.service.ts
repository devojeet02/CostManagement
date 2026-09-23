import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

export interface UserPreferenceDto {
  userName: string;
  screenKey: string;
  configJson: string;
  datetimeLastUpdated: string;
}

/**
 * CCM-049 "Screen Configuration Persistence" — a user's saved layout per (user, screen).
 *
 * SHOWCASE BUILD: no backend. Kept in `localStorage` rather than memory, unlike the other mocks,
 * because the whole point of this feature is that a layout survives leaving the screen — a
 * version that forgot on reload would demo as broken. Same reasoning as the Headcount row order.
 *
 * `configJson` is opaque here exactly as it is to the API: the calling screen owns the shape and
 * JSON.parse/stringify's it, so nothing in this service has to change when that shape does.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferenceService {

  private readonly storeKey = 'cm-user-preferences';

  /** Null - never an error - when nothing has been saved for this screen yet, matching the API's 204. */
  get(screenKey: string, user: string): Observable<string | null> {
    const all = this.read();
    const hit = all[this.key(screenKey, user)];
    return of(hit ? hit.configJson : null).pipe(delay(120));
  }

  save(screenKey: string, user: string, configJson: string): Observable<UserPreferenceDto> {
    const dto: UserPreferenceDto = {
      userName: user,
      screenKey,
      configJson,
      datetimeLastUpdated: new Date().toISOString(),
    };
    const all = this.read();
    all[this.key(screenKey, user)] = dto;
    this.write(all);
    return of(dto).pipe(delay(120));
  }

  reset(screenKey: string, user: string): Observable<void> {
    const all = this.read();
    delete all[this.key(screenKey, user)];
    this.write(all);
    return of(undefined as unknown as void).pipe(delay(120));
  }

  private key(screenKey: string, user: string): string { return `${user}::${screenKey}`; }

  // Private browsing and blocked site data both throw on access, so every read/write is guarded:
  // losing a saved layout is a nuisance, taking the screen down with it is not acceptable.
  private read(): { [key: string]: UserPreferenceDto } {
    try {
      return JSON.parse(localStorage.getItem(this.storeKey) || '{}');
    } catch {
      return {};
    }
  }

  private write(all: { [key: string]: UserPreferenceDto }): void {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(all));
    } catch {
      /* nothing to do - the layout simply will not survive this session */
    }
  }
}
