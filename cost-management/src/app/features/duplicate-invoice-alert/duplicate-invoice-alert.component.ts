import { Component, EventEmitter, Input, Output } from '@angular/core';
import { InvoiceDetail } from '../../services/invoice.service';

/**
 * Duplicate-invoice banner, shown at the top of the invoice form when the entered
 * Invoice Number + Supplier already exists.
 *
 * Deliberately **non-blocking**: it informs and offers two choices, but never prevents the
 * user from carrying on and saving a new record. It owns no data fetching — the host screen
 * detects the duplicate and passes it in, so this stays a pure presentation component and can
 * be dropped onto any screen that knows about an invoice.
 */
@Component({
  selector: 'cm-duplicate-invoice-alert',
  templateUrl: './duplicate-invoice-alert.component.html',
  styleUrls: ['./duplicate-invoice-alert.component.scss']
})
export class DuplicateInvoiceAlertComponent {
  /** The existing invoice this entry duplicates. Null hides the banner entirely. */
  @Input() duplicate: InvoiceDetail | null = null;

  /** True once the user has chosen to overwrite, so the banner can reflect that state. */
  @Input() overwriteSelected = false;

  /**
   * Whether to offer "Update existing record". False on the Edit screen, which is already
   * updating a record — there the banner is purely a heads-up that another invoice shares
   * this number + supplier.
   */
  @Input() allowOverwrite = true;

  /** User chose to update the existing record instead of creating a new one. */
  @Output() useExisting = new EventEmitter<InvoiceDetail>();

  /** User dismissed the banner — carry on creating a separate record. */
  @Output() dismissed = new EventEmitter<void>();

  /** Field-by-field detail is collapsed by default to keep the banner compact. */
  expanded = false;

  toggle(): void {
    this.expanded = !this.expanded;
  }

  onUseExisting(): void {
    if (this.duplicate) this.useExisting.emit(this.duplicate);
  }

  onDismiss(): void {
    this.dismissed.emit();
  }

  /** "Line 1, 2, 3" — which lines the existing record holds. */
  get lineNumbers(): string {
    const lines = this.duplicate?.lineItems ?? [];
    if (lines.length === 0) return '—';
    return lines.map(l => l.line).join(', ');
  }

  get lineCount(): number {
    return this.duplicate?.lineItems?.length ?? 0;
  }

  fmtAmount(value: number | null | undefined, currency?: string): string {
    if (value == null) return '—';
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return `${currency ? currency + ' ' : ''}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  fmtDate(value: string | null | undefined): string {
    if (!value) return '—';
    const s = String(value).slice(0, 10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  fmt(value: string | null | undefined): string {
    return value && String(value).trim() ? String(value) : '—';
  }

  trackByIndex(index: number): number { return index; }
}
