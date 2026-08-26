import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/** RFP §8.2 "Opening / Locking periods" — one calendar month's edit state for the forecast table. */
export interface PeriodDto {
  id: number;
  year: number;
  month: number; // 1-12
  monthName: string;
  isOpen: boolean;
  lastUpdatedBy?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PeriodService {

  /** GET /api/v1/periods?year= — all 12 months, auto-created as Open if missing. */
  /**
   * SHOWCASE: periods are held in memory, so opening and closing them works for a whole session
   * and resets on reload. Jan-Jul are closed because actuals exist for them; the rest are open.
   */
  private periods: { [year: number]: PeriodDto[] } = {};

  private forYear(year: number): PeriodDto[] {
    if (!this.periods[year]) {
      const names = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
      this.periods[year] = names.map((monthName, i) => ({
        id: year * 100 + (i + 1),
        year,
        month: i + 1,
        monthName,
        isOpen: i + 1 > 7,
        lastUpdatedBy: 'Devojeet Modak',
        datetimeLastUpdated: year + '-07-31T10:00:00Z',
      } as unknown as PeriodDto));
    }
    return this.periods[year];
  }

  list(year: number): Observable<PeriodDto[]> {
    return of(this.forYear(year).map(p => ({ ...p }))).pipe(delay(140));
  }

  setOpen(id: number, isOpen: boolean, lastUpdatedBy: string): Observable<PeriodDto> {
    const year = Math.floor(id / 100);
    const row = this.forYear(year).filter(p => p.id === id)[0];
    if (row) {
      row.isOpen = isOpen;
      (row as any).lastUpdatedBy = lastUpdatedBy;
      (row as any).datetimeLastUpdated = new Date().toISOString();
    }
    return of({ ...row }).pipe(delay(140));
  }
}
