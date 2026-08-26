import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/** CCM-060 "Audit Log Viewer" — one row of the system-wide audit trail. */
export interface AuditLogDto {
  id: number;
  timestamp: string;
  user: string;
  actionType: string;
  module: string;
  recordAffected: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface PagedResultDto<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface AuditLogFilter {
  fromDate?: string | null;
  toDate?: string | null;
  user?: string | null;
  actionType?: string | null;
  module?: string | null;
  page?: number;
  pageSize?: number;
}

export interface AuditLogFilterOptions {
  users: string[];
  actionTypes: string[];
  modules: string[];
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {

  /** GET /api/v1/audit-log — paged, filtered, newest-first. */
  /**
   * SHOWCASE: a fixed set of plausible audit entries, filtered and paged in memory.
   *
   * WARNING: field names must match AuditLogDto exactly. An earlier version of this mock used
   * invented names and the screen rendered eight rows of EMPTY cells - it compiled perfectly,
   * because the objects were cast. If this ever looks blank again, check the field names first.
   */
  private readonly entries: AuditLogDto[] = [
    { id: 1, timestamp: '2026-07-31T18:00:00Z', user: 'A. Admin', actionType: 'Update',
      module: 'Period', recordAffected: 'July 2026',
      oldValue: 'Open', newValue: 'Closed' },
    { id: 2, timestamp: '2026-07-28T09:14:00Z', user: 'Devojeet Modak', actionType: 'Create',
      module: 'Invoice', recordAffected: 'INV-1005',
      oldValue: null, newValue: '3 lines, GBP 12,000' },
    { id: 3, timestamp: '2026-07-27T16:02:00Z', user: 'Devojeet Modak', actionType: 'Update',
      module: 'Forecast', recordAffected: 'RFC1 / Infrastructure / Jun',
      oldValue: '78,000', newValue: '88,100' },
    { id: 4, timestamp: '2026-07-26T11:30:00Z', user: 'Devojeet Modak', actionType: 'Approve',
      module: 'Scenario', recordAffected: 'BUD 2026',
      oldValue: 'Draft', newValue: 'Approved' },
    { id: 5, timestamp: '2026-07-25T08:45:00Z', user: 'A. Admin', actionType: 'Create',
      module: 'Master Data', recordAffected: 'Site: Dublin',
      oldValue: null, newValue: 'Dublin' },
    { id: 6, timestamp: '2026-06-15T13:22:00Z', user: 'Devojeet Modak', actionType: 'Update',
      module: 'Invoice', recordAffected: 'INV-1012',
      oldValue: 'Amsterdam 100%', newValue: 'Amsterdam 60% / France 40%' },
    { id: 7, timestamp: '2026-06-02T10:05:00Z', user: 'A. Admin', actionType: 'Update',
      module: 'User Access', recordAffected: 'j.smith',
      oldValue: 'Viewer', newValue: 'Department Head' },
    { id: 8, timestamp: '2026-05-19T15:40:00Z', user: 'Devojeet Modak', actionType: 'Create',
      module: 'Forecast', recordAffected: 'FC / Applications / IO2',
      oldValue: null, newValue: '15,359' },
  ];

  list(filter: AuditLogFilter): Observable<PagedResultDto<AuditLogDto>> {
    const f = filter as any;
    let rows = this.entries.slice();

    if (f.user) rows = rows.filter(r => r.user === f.user);
    if (f.actionType) rows = rows.filter(r => r.actionType === f.actionType);
    if (f.module) rows = rows.filter(r => r.module === f.module);
    if (f.fromDate) rows = rows.filter(r => r.timestamp >= f.fromDate);
    if (f.toDate) rows = rows.filter(r => r.timestamp <= f.toDate + 'T23:59:59Z');

    const page = f.page || 1;
    const pageSize = f.pageSize || 20;
    const start = (page - 1) * pageSize;

    return of({
      items: rows.slice(start, start + pageSize),
      total: rows.length,
      page,
      pageSize,
    }).pipe(delay(160));
  }

  getFilterOptions(): Observable<AuditLogFilterOptions> {
    const uniq = (pick: (e: AuditLogDto) => string) =>
      this.entries.map(pick).filter((v, i, a) => a.indexOf(v) === i).sort();

    return of({
      users: uniq(e => e.user),
      actionTypes: uniq(e => e.actionType),
      modules: uniq(e => e.module),
    }).pipe(delay(160));
  }
}
