import { Component, OnInit } from '@angular/core';
import { PeriodService, PeriodDto } from '../../services/period.service';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { LoaderService } from '../../features/loader/loader.service';

/**
 * RFP §8.2 "Opening / Locking periods": open a month = the Forecast screen accepts edits for
 * it, closed = read-only. This is independent of a scenario's own lock — RFC1/RFC2/RFC3/BUDGET
 * scenarios (tblCMScenario.IsReadOnly) are always read-only regardless of period state; this
 * screen only governs the working (non-reporting) forecast scenarios.
 */
@Component({
  selector: 'app-period-management',
  templateUrl: './period-management.component.html',
  styleUrls: ['./period-management.component.scss']
})
export class PeriodManagementComponent implements OnInit {

  readonly years = [2024, 2025, 2026, 2027, 2028];
  selectedYear = 2026;

  periods: PeriodDto[] = [];
  isLoading = false;
  savingId: number | null = null;

  // No real auth wired up yet — mirrors the other admin screens' autoStamp.user mock.
  private readonly currentUser = 'Devojeet Modak';

  constructor(
    private periodService: PeriodService,
    private snackbar: SnackbarService,
    private loader: LoaderService
  ) {}

  ngOnInit(): void {
    this.loadYear();
  }

  onYearChange(): void {
    this.loadYear();
  }

  /**
   * `isLoading` is kept exactly as it was (it still gates the "No periods found" row, which
   * would otherwise flash on every year change). The loader is additive: the flag previously
   * drove no visible indicator at all, so a slow year switch looked like nothing happened.
   */
  private loadYear(): void {
    this.isLoading = true;
    this.periodService.list(this.selectedYear).pipe(
      this.loader.track<PeriodDto[]>('Loading periods…')
    ).subscribe({
      next: rows => { this.periods = rows; this.isLoading = false; },
      error: err => {
        this.isLoading = false;
        this.snackbar.show(`Failed to load periods — ${err?.error?.error ?? err?.message ?? 'unknown error'}`, 'error');
      }
    });
  }

  toggle(period: PeriodDto): void {
    const nextState = !period.isOpen;
    this.savingId = period.id;
    this.periodService.setOpen(period.id, nextState, this.currentUser).subscribe({
      next: updated => {
        period.isOpen = updated.isOpen;
        period.lastUpdatedBy = updated.lastUpdatedBy;
        this.savingId = null;
        this.snackbar.show(`${period.monthName} ${period.year} is now ${updated.isOpen ? 'open' : 'closed'}.`, 'success');
      },
      error: err => {
        this.savingId = null;
        this.snackbar.show(`Failed to update ${period.monthName} — ${err?.error?.error ?? err?.message ?? 'unknown error'}`, 'error');
      }
    });
  }
}
