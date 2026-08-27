import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, switchMap, tap } from 'rxjs/operators';
import { InvoiceService, InvoiceListItem, InvoiceListFilters } from '../../services/invoice.service';
import { MasterDataService, AccountDto } from '../../services/master-data.service';
import { InternalOrderService } from '../../services/internal-order.service';
import { SelectGroup } from '../../features/hierarchy-select/hierarchy-select.component';
import { SnackbarService } from '../../features/snackbar/snackbar.service';

/**
 * Invoice View — the landing screen for the invoice area.
 *
 * Lists every saved invoice, paged, and lets the user open the attached PDF in the shared
 * cm-pdf-viewer overlay. "Upload Invoice" routes on to the Invoice Upload form, which is now
 * reached through this screen rather than being the module's default route.
 *
 * The list is read-only: nothing here writes, so no audit stamp (lastUpdatedBy) is involved.
 */
@Component({
  selector: 'app-invoice-view',
  templateUrl: './invoice-view.component.html',
  styleUrls: ['./invoice-view.component.scss']
})
export class InvoiceViewComponent implements OnInit, OnDestroy {

  /** Rows per page. User-selectable from the pager; 10 is the default. */
  pageSize = 10;

  /** Choices offered in the pager. The backend caps page size at 500, so all are safe. */
  readonly pageSizeOptions = [5, 10, 20, 50];

  invoices: InvoiceListItem[] = [];
  total = 0;
  page = 1;

  loading = false;
  /** Set when the list request fails, so the template can offer a retry. */
  loadError = false;

  // ── Filters ─────────────────────────────────────────────────────────────────
  /**
   * Applied server-side, because the list is paged — filtering the current page in the
   * browser would quietly ignore every other page. Supplier/Site/Team hold the lookup
   * **code** (cm-hierarchy-select with bindValue="value"); invNumber is free text.
   */
  filters: InvoiceListFilters = {
    supplier: '', site: '', team: '', invNumber: '',
    currency: '', internalOrder: '', account: ''
  };

  /** Catalogues for the typable chips, loaded from the Admin-managed master data. */
  supplierGroups: SelectGroup[] = [];
  siteGroups: SelectGroup[] = [];
  teamGroups: SelectGroup[] = [];
  currencyGroups: SelectGroup[] = [];
  accountGroups: SelectGroup[] = [];

  /**
   * Internal Order is a live SAP-backed search rather than a preloaded catalogue — the
   * list is far too large to ship to the browser. Arrow fn so `this` stays bound when
   * cm-hierarchy-select calls it on each keystroke.
   */
  searchInternalOrders = (query: string): Observable<SelectGroup[]> =>
    this.ioService.search(query);

  /** Debounces the invoice-number box so typing doesn't fire a request per keystroke. */
  private readonly filterInput$ = new Subject<void>();

  /**
   * Every list fetch goes through here so switchMap can cancel the previous one. Without it,
   * two in-flight requests can land out of order and a stale response overwrites the current
   * filter's rows — easy to hit by changing chips quickly.
   */
  private readonly reload$ = new Subject<void>();

  private subs = new Subscription();

  // ── PDF viewer state (the shared cm-pdf-viewer is driven by these) ──────────
  viewerOpen = false;
  viewerInvoiceId: number | null = null;
  viewerLabel = '';
  viewerFileName: string | null = null;

  constructor(
    private invoiceService: InvoiceService,
    private masterData: MasterDataService,
    private ioService: InternalOrderService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.subs.add(
      this.filterInput$.pipe(debounceTime(350)).subscribe(() => this.applyFilters())
    );
    this.subs.add(this.buildListStream());
    this.loadFilterOptions();
    this.load();
  }

  /**
   * The single list pipeline. `catchError` sits *inside* switchMap and swallows to `of(null)`
   * so a failed request can't kill the outer stream — otherwise the first error would leave
   * the screen permanently unable to reload.
   */
  private buildListStream(): Subscription {
    return this.reload$.pipe(
      tap(() => { this.loading = true; this.loadError = false; }),
      switchMap(() => this.invoiceService.list(this.page, this.pageSize, this.filters).pipe(
        catchError(err => {
          console.error('Failed to load invoices', err);
          this.loadError = true;
          this.snackbar.show('Could not load invoices. Please try again.', 'error');
          return of(null);
        })
      ))
    ).subscribe(result => {
      this.loading = false;

      if (result === null) {
        this.invoices = [];
        this.total = 0;
        return;
      }

      this.invoices = result.items ?? [];
      this.total = result.total ?? 0;

      // A page can fall past the end of a newly-filtered (or newly-shortened) result set;
      // step back rather than showing a blank page that reads like "no matches".
      if (this.invoices.length === 0 && this.page > 1 && this.total > 0) {
        this.page = this.totalPages;
        this.load();
      }
    });
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  /**
   * Catalogues for the filter chips. One subscription per lookup with its own error handler,
   * matching the Invoice Upload / Forecast convention — a dead endpoint leaves that one chip
   * empty (still typable) instead of blanking the whole filter bar.
   */
  private loadFilterOptions(): void {
    this.masterData.getSuppliers().subscribe({
      next: rows => this.supplierGroups = this.toGroups('Suppliers', rows),
      error: err => console.error('Failed to load suppliers', err)
    });
    this.masterData.getSites().subscribe({
      next: rows => this.siteGroups = this.toGroups('Sites', rows),
      error: err => console.error('Failed to load sites', err)
    });
    this.masterData.getTeams().subscribe({
      next: rows => this.teamGroups = this.toGroups('Teams', rows),
      error: err => console.error('Failed to load teams', err)
    });
    this.masterData.getCurrencies().subscribe({
      next: rows => this.currencyGroups = this.toGroups('Currencies', rows),
      error: err => console.error('Failed to load currencies', err)
    });
    // Accounts come back in their own shape (code + name + group), not LookupItemDto.
    this.masterData.getAccounts().subscribe({
      next: (rows: AccountDto[]) => {
        const items = (rows ?? [])
          .filter(r => !!r.code)
          .map(r => ({ value: r.code, label: `${r.code} – ${r.name}` }));
        this.accountGroups = items.length ? [{ group: 'Accounts', items }] : [];
      },
      error: err => console.error('Failed to load accounts', err)
    });
  }

  /**
   * Lookup rows → one hierarchy-select group. `value` is the code because that is what the
   * backend filters on; `label` is the friendly name the user reads and types against.
   * Rows with no code are dropped — they could never match a stored invoice.
   */
  private toGroups(group: string, rows: { code?: string | null; name: string }[]): SelectGroup[] {
    const items = (rows ?? [])
      .filter(r => !!r.code)
      .map(r => ({ value: r.code!, label: r.name || r.code! }));
    return items.length ? [{ group, items }] : [];
  }

  // ── Data ────────────────────────────────────────────────────────────────────

  /** Requests a fetch of the current page + filters. Also the template's retry action. */
  load(): void {
    this.reload$.next();
  }

  // ── Filter actions ──────────────────────────────────────────────────────────

  /** True when anything is narrowing the list — drives which empty state is shown. */
  get hasActiveFilters(): boolean {
    return this.activeFilterCount > 0;
  }

  /** How many chips currently hold a value — shown next to the Clear button. */
  get activeFilterCount(): number {
    const f = this.filters;
    return [f.invNumber, f.supplier, f.site, f.team, f.currency, f.internalOrder, f.account]
      .filter(v => !!v).length;
  }

  /**
   * A changed filter always returns to page 1: staying on page 4 of a result set that now has
   * one page would show an empty grid that looks like "no matches".
   */
  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  /** Chip selections apply immediately; the free-text box debounces through filterInput$. */
  onFilterChanged(): void { this.applyFilters(); }
  onFilterTyped(): void { this.filterInput$.next(); }

  clearFilters(): void {
    this.filters = {
      supplier: '', site: '', team: '', invNumber: '',
      currency: '', internalOrder: '', account: ''
    };
    this.applyFilters();
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /** 1-based index of the first row on this page (0 when the list is empty). */
  get rangeStart(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  get canPrev(): boolean { return this.page > 1 && !this.loading; }
  get canNext(): boolean { return this.page < this.totalPages && !this.loading; }

  /**
   * Page numbers to render, windowed around the current page with -1 as an ellipsis marker.
   * Keeps the pager a fixed width however many invoices exist.
   */
  get pageNumbers(): number[] {
    const last = this.totalPages;
    if (last <= 7) {
      return Array.from({ length: last }, (_, i) => i + 1);
    }

    const pages: number[] = [1];
    const from = Math.max(2, this.page - 1);
    const to   = Math.min(last - 1, this.page + 1);

    if (from > 2) pages.push(-1);
    for (let p = from; p <= to; p++) pages.push(p);
    if (to < last - 1) pages.push(-1);

    pages.push(last);
    return pages;
  }

  /**
   * Rows-per-page changed. Rather than dumping the user back on page 1, this keeps the row
   * they were looking at on screen: the first visible row's index is preserved and the page
   * recomputed around it. Going 10→20 while on page 3 (rows 21-30) therefore lands on page 2
   * (rows 21-40) instead of page 1.
   *
   * Bound one-way (`[ngModel]` + `(ngModelChange)`), so `this.pageSize` still holds the OLD
   * size when this runs and the new one arrives as the argument.
   */
  onPageSizeChange(newSize: number): void {
    const size = Number(newSize);
    // Guard rather than trust the control: a bad value here would divide the pager by zero.
    if (!Number.isFinite(size) || size <= 0) return;

    const firstVisibleIndex = (this.page - 1) * this.pageSize;
    this.pageSize = size;

    // totalPages is derived from the new pageSize, so this clamp is already correct.
    this.page = Math.min(Math.floor(firstVisibleIndex / size) + 1, this.totalPages);

    this.load();
  }

  goToPage(page: number): void {
    if (page === -1 || page === this.page || page < 1 || page > this.totalPages || this.loading) return;
    this.page = page;
    this.load();
  }

  prevPage(): void { if (this.canPrev) this.goToPage(this.page - 1); }
  nextPage(): void { if (this.canNext) this.goToPage(this.page + 1); }

  // ── PDF preview ─────────────────────────────────────────────────────────────

  /** Requirement: only rows with a linked PDF open the preview. */
  hasPdf(row: InvoiceListItem): boolean {
    return row.hasPdf === true;
  }

  /** Tooltip for the disabled state — the invoice exists, the file does not. */
  noPdfTitle(): string {
    return 'No invoice attached';
  }

  showPdf(row: InvoiceListItem): void {
    if (!this.hasPdf(row)) return;
    this.viewerInvoiceId = row.id;
    this.viewerLabel = row.invNumber || `Invoice ${row.id}`;
    this.viewerFileName = row.fileName ?? null;
    this.viewerOpen = true;
  }

  closeViewer(): void {
    this.viewerOpen = false;
    this.viewerInvoiceId = null;
    this.viewerLabel = '';
    this.viewerFileName = null;
  }

  // ── Header actions ──────────────────────────────────────────────────────────

  /**
   * Refetches what is currently on screen. Filters and page are deliberately preserved —
   * a "Refresh" that silently wiped the user's filters would be a surprise; clearing them
   * is what the "Clear filters" chip button is for.
   */
  onRefresh(): void {
    this.closeViewer();
    this.load();
  }

  // ── Display helpers ─────────────────────────────────────────────────────────

  fmtAmount(value: number | null | undefined, currency: string): string {
    if (value == null) return '—';
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return `${currency ? currency + ' ' : ''}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  /**
   * Per-line code lists (Internal Order / Account) shown in one cell.
   *
   * Rendered as "first +N" rather than the whole list: an invoice can carry many lines, and
   * a fully expanded list would blow the column width out. The complete set goes in the
   * cell's title attribute — see cellTitle.
   */
  fmtCodes(values: string[] | null | undefined): string {
    const list = (values ?? []).filter(v => !!v);
    if (list.length === 0) return '—';
    return list.length === 1 ? list[0] : `${list[0]} +${list.length - 1}`;
  }

  /** Full stop-separated list for the tooltip, so nothing is actually hidden. */
  cellTitle(values: string[] | null | undefined): string {
    const list = (values ?? []).filter(v => !!v);
    return list.length ? list.join(', ') : '';
  }

  /** FX rate — trimmed to 4dp, which is the precision the Upload screen accepts. */
  fmtRate(value: number | null | undefined): string {
    if (value == null) return '—';
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return String(Number(n.toFixed(4)));
  }

  fmtDate(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  trackById(_index: number, row: InvoiceListItem): number { return row.id; }
  trackByIndex(index: number): number { return index; }
}
