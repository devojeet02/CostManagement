import { Component, OnInit } from '@angular/core';
import { AuditLogService, AuditLogDto, AuditLogFilterOptions } from '../../services/audit-log.service';
import { SnackbarService } from '../../features/snackbar/snackbar.service';

/**
 * CCM-060 "Audit Log Viewer" — read-only, system-wide log of create/update/delete actions
 * across Invoice, Forecast, Headcount, Period and Master Data. Backed by
 * GET /api/v1/audit-log (paged, filtered, newest-first) and /audit-log/filters (dropdown
 * options). Admin-only per the story's AC #1 — gated by nav-bar-menu.dev.ts's role-5 entry,
 * same mechanism as the sibling Admin Cost Management / Period Management screens.
 *
 * No edit/delete affordances anywhere in this component — AC #5 makes the log read-only.
 * The 1-year retention purge (AC #6) runs entirely server-side; there is nothing for this
 * screen to trigger.
 */
@Component({
  selector: 'app-audit-log',
  templateUrl: './audit-log.component.html',
  styleUrls: ['./audit-log.component.scss']
})
export class AuditLogComponent implements OnInit {

  readonly pageSize = 25;

  rows: AuditLogDto[] = [];
  total = 0;
  page = 1;
  isLoading = false;

  filterOptions: AuditLogFilterOptions = { users: [], actionTypes: [], modules: [] };

  fromDate: string | null = null;
  toDate: string | null = null;
  selectedUser = '';
  selectedActionType = '';
  selectedModule = '';

  constructor(private auditLogService: AuditLogService, private snackbar: SnackbarService) {}

  ngOnInit(): void {
    this.auditLogService.getFilterOptions().subscribe({
      next: options => this.filterOptions = options,
      error: err => console.error('Failed to load audit log filter options', err)
    });
    this.load();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.fromDate = null;
    this.toDate = null;
    this.selectedUser = '';
    this.selectedActionType = '';
    this.selectedModule = '';
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page) return;
    this.page = page;
    this.load();
  }

  private load(): void {
    this.isLoading = true;
    this.auditLogService.list({
      fromDate: this.fromDate,
      toDate: this.toDate,
      user: this.selectedUser || null,
      actionType: this.selectedActionType || null,
      module: this.selectedModule || null,
      page: this.page,
      pageSize: this.pageSize
    }).subscribe({
      next: result => {
        this.rows = result.items;
        this.total = result.total;
        this.isLoading = false;
      },
      error: err => {
        this.isLoading = false;
        this.snackbar.show(`Failed to load audit log — ${err?.error?.error ?? err?.message ?? 'unknown error'}`, 'error');
      }
    });
  }
}
