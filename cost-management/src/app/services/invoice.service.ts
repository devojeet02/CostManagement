import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';

/** Per-site recharge allocation sent to the backend (mirrors TBL_InvoiceRecharge). */
export interface RechargeAllocationPayload {
  site: string;
  mode: 'pct' | 'amount';
  pct: number | null;
  amount: number | null;
}

/** One invoice line (mirrors TBL_InvoiceData). */
export interface InvoiceLinePayload {
  line: number;
  account: string;
  periodStart: string | null;
  periodEnd: string | null;
  internalOrder: string;
  spendType: string;
  speedType: string;
  spendLayer: string;
  category: string;
  system: string;
  description: string;
  amountCurrency: number | null;
  rechargeTo: string;
  recharge: boolean;
  rechargeSites: RechargeAllocationPayload[];
}

/** Full invoice payload (mirrors the backend InvoiceDto → TBL_Invoice). */
export interface InvoicePayload {
  supplier: string;
  par: string;
  po: string;
  invNumber: string;
  site: string;
  team: string;
  currency: string;
  exchangeRate: number | null;
  invAmount: number | null;
  invoiceDate: string;
  accountingDate: string;
  isBudgeted: boolean;
  /** Credit note — the backend counts its amounts negatively towards Forecast actuals. */
  isCredit: boolean;
  /**
   * This cost repeats on a schedule. On save the backend projects the remaining periods of
   * the invoice's year onto the forecast — see `EnsureRecurringForecastLinesAsync`.
   */
  isRecurring: boolean;
  /** 'Monthly' | 'Quarterly' | 'Semi-annually' | 'Annually'. Null when not recurring. */
  recurrencePeriodicity: string | null;
  fileName: string | null;
  /** Login of the user saving the record — audit standard (LastUpdatedBy). */
  lastUpdatedBy: string;
  lineItems: InvoiceLinePayload[];
}

/** Response echoed back by the backend (with the new server id). */
export interface InvoiceSaveResult extends InvoicePayload {
  id: number;
}

/**
 * One line as returned by GET /invoices/{id} — the read shape carries a couple of fields the
 * write payload doesn't (the server line id, the derived site-currency amount).
 */
export interface InvoiceDetailLine extends InvoiceLinePayload {
  id: number;
  amountSiteCurrency: number | null;
}

/** Full invoice as returned by GET /invoices/{id}, used to prefill the Edit screen. */
export interface InvoiceDetail extends Omit<InvoicePayload, 'lineItems'> {
  id: number;
  lineItems: InvoiceDetailLine[];
}

/** Response from POST /api/v1/invoices/{id}/upload. */
export interface InvoiceUploadResult {
  fileName: string;
  storagePath: string;
}

/** Row shape from the invoice list endpoint. */
export interface InvoiceListItem {
  id: number;
  supplier: string;
  invNumber: string;
  site: string;
  team: string;
  currency: string;
  invAmount: number;
  invoiceDate: string;
  createdUtc: string;
  /** Display name of the attached PDF, null when nothing was uploaded. */
  fileName?: string | null;
  /**
   * True when GET /invoices/{id}/file can serve a PDF. Optional so an older backend
   * (which omits the field) is read as "no PDF" rather than throwing — the Invoice View
   * then shows its "No invoice attached" state instead of opening an empty viewer.
   */
  hasPdf?: boolean;

  // Additional header fields shown on the Invoice View grid. Optional so an older backend
  // (which omits them) simply renders "—" instead of throwing.
  par?: string | null;
  po?: string | null;
  exchangeRate?: number | null;
  accountingDate?: string | null;
  isBudgeted?: boolean;
  isCredit?: boolean;
  lineCount?: number;
  /** Distinct Internal Order codes across the invoice's lines (per-line, so a list). */
  internalOrders?: string[];
  /** Distinct Account codes across the invoice's lines. */
  accounts?: string[];
}

/**
 * Server-side filters for the invoice list (subset of the backend's InvoiceFilterDto).
 *
 * Filtering has to happen on the server: the list is paged, so filtering the ten rows the
 * client happens to hold would silently ignore every other page.
 *
 * `supplier` / `site` / `team` are matched **exactly against the lookup code**, which is why
 * the Invoice View feeds them from cm-hierarchy-select with bindValue="value". `invNumber`
 * is a contains-match, so free text works there.
 */
export interface InvoiceListFilters {
  supplier?: string;
  site?: string;
  team?: string;
  invNumber?: string;
  currency?: string;
  /** Line-level: matches invoices with at least one line on this internal order. */
  internalOrder?: string;
  /** Line-level: matches invoices with at least one line on this account. */
  account?: string;
}

/** Paged wrapper returned by GET /invoices. */
export interface PagedInvoices {
  total: number;
  page: number;
  pageSize: number;
  items: InvoiceListItem[];
}

/**
 * Parameters for the Invoice Handling screen's Related Data panel.
 *
 * Every dimension is sent as whatever string the screen's dropdowns hold — the backend
 * resolves code / name / "CODE – Name" alike — so no extra mapping is needed here.
 * `account` / `internalOrder` are optional: omitting one means "any", which is what a
 * part-filled line item means.
 */
export interface RelatedDataQuery {
  year: number;
  site: string;
  team: string;
  account?: string;
  internalOrder?: string;
  scenario?: string;
  /** The invoice being edited, kept out of the Actuals row (Upload has none to exclude). */
  excludeInvoiceId?: number;
}

/** One invoice line behind an Actuals cell — the panel's hover detail. */
export interface RelatedActualDetail {
  month: number;
  invoiceId: number;
  invNumber: string;
  line: number | null;
  description: string | null;
  /** As entered, in the invoice currency. */
  amount: number;
  /** Amount × FX — the site-currency figure that feeds the Actuals row (negative for credits). */
  amountSiteCurrency: number;
  currency: string | null;
  exchangeRate: number;
  invoiceDate: string;
  user: string | null;
  lastModified: string | null;
  isCredit: boolean;
}

/**
 * GET /api/v1/invoices/related-data response.
 *
 * `actuals` / `forecast` are null per month when nothing matched, so the panel can render "—"
 * rather than a 0.00 that reads as a real figure. `cumulativeVariance` is never null — it is a
 * running total that carries the previous month forward, and it restarts at zero each January
 * because the panel is scoped to one calendar year.
 */
export interface RelatedDataPanel {
  year: number;
  scenario: string | null;
  currency: string | null;
  actuals: (number | null)[];
  forecast: (number | null)[];
  cumulativeVariance: number[];
  actualTotal: number;
  forecastTotal: number;
  varianceTotal: number;
  details: RelatedActualDetail[];
  /** False when Site/Team couldn't be resolved — the panel shows a prompt, not empty figures. */
  matched: boolean;
}

/** A single field before/after change within a history event. */
export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** One change-history event for an invoice. */
export interface ChangeLog {
  timestamp: string;
  user: string;
  changes: FieldChange[];
}

/**
 * Invoice data - SHOWCASE BUILD.
 *
 * WARNING: no backend. Interfaces above are production's; only the transport differs, so the
 * Invoice screens are unmodified copies.
 *
 * Invoices live in memory: saving one really does add it to the list, and editing really does
 * change it, for the session. PDF upload and retrieval are the one thing that cannot be
 * meaningfully faked - see uploadPdf / getPdf.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceService {

  private nextId = 1006;

  /**
   * WARNING: these follow InvoicePayload EXACTLY - invNumber / invAmount / lineItems, not
   * invoiceNumber / invoiceAmount / lines. An earlier version of this mock used the friendlier
   * names and the screens silently rendered blanks: the objects are cast, so nothing throws.
   * If a field ever shows as "-" or 0.00, check the name against the interface first.
   */
  private invoices: any[] = [
    this.seed(1001, 'INV-1005', 'sap', 'SAP', '2026-05-15', 12000, 'uk', 'infrastructure', 'gl-6100', 'IO1'),
    this.seed(1002, 'INV-1012', 'accenture1', 'Accenture1', '2026-06-15', 240, 'uk', 'infrastructure', 'gl-6300', 'IO2'),
    this.seed(1003, 'INV-1020', 'msft-azure', 'MSFT Azure', '2026-07-15', 10464, 'uk', 'applications', 'gl-6200', 'IO3'),
    this.seed(1004, 'INV-1031', 'google', 'Google Cloud', '2026-07-22', 3345, 'amsterdam', 'governance-vendor', 'gl-6200', 'IO5'),
    this.seed(1005, 'INV-1042', 'abb', 'ABB', '2026-07-28', 156, 'france', 'model-processes', 'gl-7200', 'IO1'),
  ];

  private seed(id: number, invNumber: string, supplier: string, supplierName: string,
               invoiceDate: string, invAmount: number, site: string, team: string,
               account: string, internalOrder: string): any {
    return {
      id,
      supplier,
      supplierName,
      par: 'PAR-' + id,
      po: 'PO-' + id,
      invNumber,
      site,
      team,
      currency: 'GBP',
      exchangeRate: 1,
      invAmount,
      invoiceDate,
      accountingDate: invoiceDate,
      isBudgeted: true,
      isCredit: false,
      isRecurring: id === 1001,                 // one recurring invoice, so that flow is demoable
      recurrencePeriodicity: id === 1001 ? 'Monthly' : null,
      fileName: null,
      lastUpdatedBy: 'Devojeet Modak',
      lineItems: [
        {
          id: id * 10 + 1,
          line: 1,
          account,
          periodStart: '2026-07-01',
          periodEnd: '2026-07-31',
          internalOrder,
          spendType: 'subscription',
          speedType: '',
          spendLayer: 'run',
          category: 'it-subscriptions',
          system: 'sap',
          description: 'Annual support and licensing',
          amountCurrency: invAmount,
          amountSiteCurrency: invAmount,
          rechargeTo: '',
          recharge: false,
          rechargeSites: [],
        },
      ],
    };
  }

  /**
   * WARNING: the LIST item is a different shape from the stored invoice - `invNumber` /
   * `invAmount`, not `invoiceNumber` / `invoiceAmount`, plus per-line rollups. An earlier
   * version of this mock returned the stored objects directly and the grid rendered a column of
   * dashes: those fields are optional, so nothing threw, it just silently showed nothing.
   */
  private toListItem(inv: any): InvoiceListItem {
    const lines = inv.lineItems || [];
    const uniq = (vals: any[]) => vals.filter((v, i, a) => v && a.indexOf(v) === i);

    return {
      id: inv.id,
      supplier: inv.supplierName || inv.supplier,
      invNumber: inv.invNumber,
      site: inv.site,
      team: inv.team,
      currency: inv.currency,
      invAmount: inv.invAmount,
      invoiceDate: inv.invoiceDate,
      createdUtc: inv.invoiceDate,
      fileName: null,
      hasPdf: false,          // no PDF storage in this build - see getPdf
      par: inv.par,
      po: inv.po,
      exchangeRate: inv.exchangeRate,
      accountingDate: inv.accountingDate,
      isBudgeted: inv.isBudgeted,
      isCredit: inv.isCredit,
      lineCount: lines.length,
      internalOrders: uniq(lines.map((l: any) => l.internalOrder)),
      accounts: uniq(lines.map((l: any) => l.account)),
    };
  }

  list(page = 1, pageSize = 25, filters?: InvoiceListFilters): Observable<PagedInvoices> {
    let rows = this.invoices.slice();
    const f = (filters || {}) as any;
    if (f.supplier) rows = rows.filter(r => r.supplier === f.supplier);
    if (f.site) rows = rows.filter(r => r.site === f.site);
    if (f.team) rows = rows.filter(r => r.team === f.team);
    if (f.currency) rows = rows.filter(r => r.currency === f.currency);
    if (f.invNumber) {
      const q = String(f.invNumber).toLowerCase();
      rows = rows.filter(r => r.invNumber.toLowerCase().indexOf(q) >= 0);
    }

    const start = (page - 1) * pageSize;
    return of({
      items: rows.slice(start, start + pageSize).map(r => this.toListItem(r)),
      total: rows.length, page, pageSize,
    } as unknown as PagedInvoices).pipe(delay(200));
  }

  get(id: number): Observable<InvoiceDetail> {
    const row = this.invoices.filter(i => i.id === id)[0];
    return of(JSON.parse(JSON.stringify(row || null)) as InvoiceDetail).pipe(delay(180));
  }

  save(payload: InvoicePayload): Observable<InvoiceSaveResult> {
    const created = JSON.parse(JSON.stringify(payload));
    created.id = this.nextId++;
    this.invoices.unshift(created);
    return of({ id: created.id, success: true } as unknown as InvoiceSaveResult).pipe(delay(320));
  }

  update(id: number, payload: InvoicePayload): Observable<InvoiceSaveResult> {
    const idx = this.invoices.findIndex(i => i.id === id);
    if (idx >= 0) {
      const updated = JSON.parse(JSON.stringify(payload));
      updated.id = id;
      this.invoices[idx] = updated;
    }
    return of({ id, success: idx >= 0 } as unknown as InvoiceSaveResult).pipe(delay(320));
  }

  /**
   * Duplicate detection, kept real: it is a genuine safeguard on the upload screen, so the demo
   * should show it firing rather than pretend every invoice number is new.
   */
  findDuplicate(invNumber: string, supplier: string, excludeId?: number): Observable<InvoiceDetail | null> {
    const hit = this.invoices.filter(i =>
      i.invNumber.toLowerCase() === String(invNumber || '').toLowerCase() &&
      i.supplier === supplier &&
      i.id !== excludeId)[0];
    return of((hit ? JSON.parse(JSON.stringify(hit)) : null) as InvoiceDetail | null).pipe(delay(160));
  }

  getHistory(id: number): Observable<ChangeLog[]> {
    return of([
      { id: 1, actionTaken: 'Created', oldStatus: null, newStatus: 'Draft',
        changedBy: 'Devojeet Modak', changedDate: '2026-07-15T09:00:00Z',
        remarks: 'Invoice entered' },
      { id: 2, actionTaken: 'Invoice Amount', oldStatus: '11,500', newStatus: '12,000',
        changedBy: 'Devojeet Modak', changedDate: '2026-07-15T09:12:00Z',
        remarks: 'Corrected against the supplier PDF' },
    ] as unknown as ChangeLog[]).pipe(delay(180));
  }

  getRelatedData(query: RelatedDataQuery): Observable<RelatedDataPanel> {
    return of({
      forecastLines: [
        { internalOrder: 'IO1', description: 'SAP Developer Support',
          scenario: 'FC', month: 'Jul', amount: 12500 },
      ],
      previousInvoices: this.invoices.slice(0, 3).map(i => ({
        invoiceNumber: i.invNumber, invoiceDate: i.invoiceDate, amount: i.invAmount,
      })),
    } as unknown as RelatedDataPanel).pipe(delay(200));
  }

  /**
   * WARNING: PDF handling is the one thing this build cannot honestly fake.
   *
   * There is no storage, so an upload is accepted and discarded, and getPdf fails rather than
   * returning a fabricated document. A blank or placeholder PDF would look like a broken viewer;
   * an explicit failure at least reads as "not available in the demo".
   */
  uploadPdf(id: number, file: File): Observable<InvoiceUploadResult> {
    return of({ id, fileName: file ? file.name : '', success: true } as unknown as InvoiceUploadResult)
      .pipe(delay(400));
  }

  getPdf(id: number): Observable<Blob> {
    return throwError(() => ({
      error: { error: 'PDF storage is not available in the showcase build.' },
    })).pipe(delay(200)) as Observable<Blob>;
  }
}
