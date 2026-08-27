import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/**
 * One outbound recharge instruction — "this site owes this much of this invoice line".
 *
 * Flattened server-side from tblCMInvoiceRecharge + its line + that line's invoice, because one
 * invoice can produce many instructions (one per receiving site, per line) and each is a row.
 */
export interface RechargeInstructionDto {
  id: number;

  /** Receiving site — the entity being recharged. */
  site: string;

  /** 'pct' | 'amount' | 'direct'. 'direct' is a whole line assigned to one site. */
  mode: string;

  /** Share of the source line, 0-100. Always 100 for a direct recharge. */
  percentage: number;

  /**
   * Money in the PROCESSING site's currency, never the receiving site's. Derived server-side
   * when only a percentage was entered, so the client never recomputes it.
   */
  amount: number;
  currency?: string | null;

  periodStart?: string | null;
  periodEnd?: string | null;

  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  supplier?: string | null;

  /** The entity that received the invoice and is recharging out. */
  processingSite?: string | null;

  invoiceDataId: number;
  lineNumber?: number | null;
  lineDescription?: string | null;

  /** Internal order the source line posted against — the key a Forecast row matches on. */
  internalOrder?: string | null;

  /**
   * Posting month/year of the source LINE, which is what the Forecast grid buckets
   * recharge-actual by — not the invoice date. An April invoice can post to March.
   */
  postingMonth: number;
  postingYear: number;
}

export interface PagedResultDto<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface RechargeFilters {
  site?: string | null;
  processingSite?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  fromDate?: string | null;
  toDate?: string | null;

  /**
   * Forecast drill-down — the same grain the grid derives recharge-actual on
   * (internal order + posting year, optionally one month), so a drill-down adds up to the
   * figure that was clicked.
   */
  internalOrder?: string | null;
  postingYear?: number | null;
  postingMonth?: number | null;
}

export interface RechargeFilterOptions {
  sites: string[];
  processingSites: string[];
  suppliers: string[];
}

/** Recharge instructions - SHOWCASE BUILD. No backend; see the other services. */
@Injectable({ providedIn: 'root' })
export class RechargeService {

  private readonly instructions: RechargeInstructionDto[] = [
    this.item(1, 'Amsterdam', 5, 2400, 'INV-1005', 'IO1', 'percentage', 40),
    this.item(2, 'France', 5, 1100, 'INV-1005', 'IO1', 'percentage', 20),
    this.item(3, 'USA', 6, 700, 'INV-1012', 'IO2', 'direct', null),
    this.item(4, 'Amsterdam', 7, 1500, 'INV-1020', 'IO3', 'direct', null),
  ];

  private item(id: number, site: string, month: number, amount: number, invoiceNumber: string,
               internalOrder: string, mode: string, percentage: number | null): RechargeInstructionDto {
    return {
      id, site, month, amount, currency: 'GBP',
      invoiceId: id, invoiceNumber, invoiceDate: '2026-0' + month + '-15',
      internalOrder, lineNumber: 1, rechargeMode: mode, rechargePercentage: percentage,
    } as unknown as RechargeInstructionDto;
  }

  list(page: number, pageSize: number,
       filters: RechargeFilters): Observable<PagedResultDto<RechargeInstructionDto>> {
    let rows = this.instructions.slice();
    const f = filters as any;
    if (f && f.internalOrder) rows = rows.filter(r => (r as any).internalOrder === f.internalOrder);
    if (f && f.site) rows = rows.filter(r => (r as any).site === f.site);

    const start = (page - 1) * pageSize;
    return of({
      items: rows.slice(start, start + pageSize),
      total: rows.length, page, pageSize,
    } as unknown as PagedResultDto<RechargeInstructionDto>).pipe(delay(180));
  }

  getFilterOptions(): Observable<RechargeFilterOptions> {
    return of({
      sites: ['Amsterdam', 'France', 'USA'],
      internalOrders: ['IO1', 'IO2', 'IO3'],
    } as unknown as RechargeFilterOptions).pipe(delay(180));
  }
}
