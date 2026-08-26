import { Component, EventEmitter, Input, Output } from '@angular/core';
import { VendorInvoiceLineDto } from '../../services/cost-dashboard.service';

/**
 * The invoice lines behind one vendor's spend figure (Dashboard & Analytics epic, F2-AC5).
 *
 * Answers "what did we actually buy from this supplier?" — the evidence for a number on the
 * dashboard, with enough context to find each invoice in Invoice View.
 *
 * Follows `cm-recharge-drill`: a `cm-modal` shell, presentational only, with the parent owning
 * the fetch. It also copies that component's most useful habit — **stating outright whether the
 * listed lines add up to the figure that was clicked**. If they ever disagree, the two are
 * matching on different grains and the drill is quietly misleading; better to say so on screen
 * than leave it to be noticed.
 */
@Component({
  selector: 'cm-vendor-drill',
  templateUrl: './vendor-drill.component.html',
  styleUrls: ['./vendor-drill.component.scss'],
})
export class VendorDrillComponent {
  private static readonly MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  @Input() isOpen = false;
  @Input() vendor = '';
  @Input() year = new Date().getFullYear();

  @Input() rows: VendorInvoiceLineDto[] = [];
  @Input() loading = false;
  @Input() loadError = false;

  /** Server total for these lines, credits negated. */
  @Input() total = 0;
  /** What the dashboard's vendor bar showed, for the reconciliation check. */
  @Input() expected: number | null = null;
  @Input() currencyMix: string[] = [];

  @Output() closed = new EventEmitter<void>();

  get title(): string {
    return `${this.vendor || 'Vendor'} — invoice lines ${this.year}`;
  }

  /** Blank when the lines span several currencies; the total is then a mixed sum. */
  get currency(): string {
    return this.currencyMix.length === 1 ? this.currencyMix[0] : '';
  }

  get isMixedCurrency(): boolean {
    return this.currencyMix.length > 1;
  }

  /** Half a penny of slack — these are two sums of the same decimals, not a fuzzy comparison. */
  get reconciles(): boolean {
    return this.expected == null || Math.abs(this.total - this.expected) < 0.005;
  }

  monthLabel(row: VendorInvoiceLineDto): string {
    return VendorDrillComponent.MONTHS[row.postingMonth - 1] ?? String(row.postingMonth);
  }

  fmtDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Credits are stored positive and count negatively — shown signed so the total makes sense. */
  signedAmount(row: VendorInvoiceLineDto): number {
    return row.isCredit ? -row.amount : row.amount;
  }

  trackByRow(_index: number, row: VendorInvoiceLineDto): number {
    return row.invoiceDataId;
  }
}
