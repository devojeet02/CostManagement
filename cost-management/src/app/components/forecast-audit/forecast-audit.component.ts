import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, switchMap, tap } from 'rxjs/operators';

import {
  ForecastService, ForecastChangeLog, ForecastHistoryFilters
} from '../../services/forecast.service';
import { MasterDataService } from '../../services/master-data.service';
import { InternalOrderService } from '../../services/internal-order.service';
import { SelectGroup } from '../../features/cm-hierarchy-select/cm-hierarchy-select.component';
import { SnackbarService } from '../../features/snackbar/snackbar.service';

/** Forecast Audit — the change log for forecast edits (RFC criterion 4). A dedicated screen rather than a per-row modal (which is how invoices do it) because the question here is different: on an invoice you are always looking at one invoice, whereas during an RFC cycle a Dept Head or auditor wants "what changed across the forecast, and who changed it". A per-row modal cannot answer that. Read-only throughout — this screen never writes. */
@Component({
  selector: 'app-forecast-audit',
  templateUrl: './forecast-audit.component.html',
  styleUrls: ['./forecast-audit.component.scss']
})
export class ForecastAuditComponent implements OnInit, OnDestroy {

  events: ForecastChangeLog[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  readonly pageSizeOptions = [10, 25, 50, 100];

  loading = false;
  loadError = false;

  filters: ForecastHistoryFilters = { year: null, scenario: '', user: '', internalOrder: '' };

  scenarioGroups: SelectGroup[] = [];

  /** Internal Order is a live SAP-backed search — far too large to preload. */
  searchInternalOrders = (query: string): Observable<SelectGroup[]> =>
    this.ioService.search(query);

  /** Debounces the free-text boxes so typing doesn't fire a request per keystroke. */
  private readonly filterInput$ = new Subject<void>();
  private readonly reload$ = new Subject<void>();
  private subs = new Subscription();

  constructor(
    private forecastService: ForecastService,
    private masterData: MasterDataService,
    private ioService: InternalOrderService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.subs.add(this.filterInput$.pipe(debounceTime(350)).subscribe(() => this.applyFilters()));
    this.subs.add(this.buildStream());
    this.loadFilterOptions();
    this.load();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  /** Single fetch pipeline. `switchMap` cancels a superseded request so a slow response can't land after a newer one; `catchError` sits INSIDE it so one failure doesn't kill the stream and leave the screen unable to reload. */
  private buildStream(): Subscription {
    return this.reload$.pipe(
      tap(() => { this.loading = true; this.loadError = false; }),
      switchMap(() => this.forecastService.history(this.page, this.pageSize, this.filters).pipe(
        catchError(err => {
          console.error('Failed to load forecast history', err);
          this.loadError = true;
          this.snackbar.show('Could not load the forecast audit log.', 'error');
          return of(null);
        })
      ))
    ).subscribe(result => {
      this.loading = false;
      if (result === null) { this.events = []; this.total = 0; return; }

      this.events = result.items ?? [];
      this.total = result.total ?? 0;

      // A page can fall past the end after filtering; step back rather than showing a blank page that reads like "no matches".
      if (this.events.length === 0 && this.page > 1 && this.total > 0) {
        this.page = this.totalPages;
        this.load();
      }
    });
  }

  load(): void { this.reload$.next(); }

  private loadFilterOptions(): void {
    this.masterData.getScenarios().subscribe({
      next: rows => {
        const items = (rows ?? [])
          .filter(r => !!r.code)
          .map(r => ({ value: r.code!, label: r.code! }));
        this.scenarioGroups = items.length ? [{ group: 'Scenarios', items }] : [];
      },
      error: err => console.error('Failed to load scenarios', err)
    });
  }

  get activeFilterCount(): number {
    const f = this.filters;
    return [f.year, f.scenario, f.user, f.internalOrder].filter(v => v !== null && v !== undefined && v !== '').length;
  }

  get hasActiveFilters(): boolean { return this.activeFilterCount > 0; }

  applyFilters(): void { this.page = 1; this.load(); }
  onFilterChanged(): void { this.applyFilters(); }
  onFilterTyped(): void { this.filterInput$.next(); }

  clearFilters(): void {
    this.filters = { year: null, scenario: '', user: '', internalOrder: '' };
    this.applyFilters();
  }

  get totalPages(): number { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
  get rangeStart(): number { return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1; }
  get rangeEnd(): number { return Math.min(this.page * this.pageSize, this.total); }
  get canPrev(): boolean { return this.page > 1 && !this.loading; }
  get canNext(): boolean { return this.page < this.totalPages && !this.loading; }

  goToPage(page: number): void {
    if (page === this.page || page < 1 || page > this.totalPages || this.loading) return;
    this.page = page;
    this.load();
  }

  prevPage(): void { if (this.canPrev) this.goToPage(this.page - 1); }
  nextPage(): void { if (this.canNext) this.goToPage(this.page + 1); }

  /** Rows-per-page changed. Keeps the entry you were looking at on screen by preserving the first visible index, rather than dumping you back on page 1. Bound one-way, so `this.pageSize` still holds the OLD size here. */
  onPageSizeChange(newSize: number): void {
    const size = Number(newSize);
    if (!Number.isFinite(size) || size <= 0) return;
    const firstVisibleIndex = (this.page - 1) * this.pageSize;
    this.pageSize = size;
    this.page = Math.min(Math.floor(firstVisibleIndex / size) + 1, this.totalPages);
    this.load();
  }

  /** Row identity: internal order, falling back to the description, then the line id. */
  rowLabel(e: ForecastChangeLog): string {
    return e.internalOrder?.trim()
      || e.description?.trim()
      || `Line #${e.forecastDataId}`;
  }

  /** SIAT context, skipping anything the row doesn't carry. */
  contextLabel(e: ForecastChangeLog): string {
    return [e.scenario, e.site, e.team, e.account].filter(v => !!v).join(' · ') || '—';
  }

  fmtTimestamp(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  /** Blank sides are real: a value cleared to nothing shows as an em dash, not "". */
  fmtValue(v: string | null | undefined): string {
    return v && String(v).trim() ? String(v) : '—';
  }

  trackByIndex(index: number): number { return index; }
}
