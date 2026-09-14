import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/** CCM-061 "User & Access Management" — one person known to Cost Management. */
export interface UserDto {
  id: number;
  email: string;
  displayName?: string | null;
  roleId?: number | null;
  roleName?: string | null;
  isActive: boolean;
  teamEntities: UserTeamEntityDto[];
}

export interface UserTeamEntityDto {
  id: number;
  team: string;
  site: string;
}

export interface UserFilter {
  activeOnly?: boolean;
  search?: string;
}

/**
 * Mock User & Access Management backend for the showcase.
 *
 * Exists because the Headcount screen's Employee column is a lookup over the ACTIVE USERS rather
 * than a hardcoded name list — the people who can be planned are the people the system knows.
 *
 * `displayName` is deliberately null on two of these. It is nullable in production and the grid
 * falls back to the email, so the showcase should exercise that path rather than hide it.
 */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly users: UserDto[] = [
    { id: 11, email: 'amarthya.chaterjii@acumant.com', displayName: 'CHATERJII, Amarthya',
      roleName: 'Admin', isActive: true, teamEntities: [] },
    { id: 12, email: 'devojeet.modak@acumant.com', displayName: 'Devojeet Modak',
      roleName: 'Accounting Department', isActive: true, teamEntities: [] },
    { id: 4,  email: 'jennifer.douglas@eur.crowncork.com', displayName: null,
      roleName: 'Dept Head / Budget Owner', isActive: true, teamEntities: [] },
    { id: 3,  email: 'vanshika.verma@acumant.com', displayName: null,
      roleName: null, isActive: true, teamEntities: [] },
    { id: 2,  email: 'fred.mitchell@eur.crowncork.com', displayName: 'Fred Mitchell',
      roleName: 'Dept Head / Budget Owner', isActive: true, teamEntities: [] },
    { id: 9,  email: 'former.colleague@eur.crowncork.com', displayName: 'Former Colleague',
      roleName: null, isActive: false, teamEntities: [] },
  ];

  /** GET /api/v1/users — AC #1: view all active users + assignments. */
  list(filter: UserFilter): Observable<UserDto[]> {
    let rows = this.users.slice();
    if (filter && filter.activeOnly) rows = rows.filter(u => u.isActive);
    if (filter && filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter(u =>
        (u.displayName || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return of(rows).pipe(delay(180));
  }
}
