import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RechargeInstructionDto } from '../../services/recharge.service';

/**
 * The recharge drill-down list — the instructions behind a Forecast row's Recharge Actual.
 *
 * The grid's `recharge-actual` figure is already derived from invoice recharges
 * (`ForecastRepo.GetInvoiceActualsAsync`); this shows WHICH recharges make it up. Opened from
 * the Recharge button in the Forecast grid's row actions.
 *
 * Read-only, like the Recharge View screen it mirrors — recharges are created on the invoice.
 */
@Component({
  selector: 'cm-recharge-drill',
  templateUrl: './recharge-drill.component.html',
  styleUrls: ['./recharge-drill.component.scss']
})
export class RechargeDrillComponent {
  @Input() isOpen = false;

  /** e.g. "IO2 – Cloud Hosting · 2026" or "… · Jun 2026" when drilled to one month. */
  @Input() title = 'Recharges';

  /** What the grid was showing for this row/cell, so the list can be checked against it. */
  @Input() expected: number | null = null;
  @Input() currency = '';

  @Input() rows: RechargeInstructionDto[] = [];
  @Input() loading = false;
  @Input() loadError = false;

  @Output() closed = new EventEmitter<void>();

  get total(): number {
    return this.rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }

  /**
   * Whether the listed instructions add up to the figure the grid showed.
   *
   * The whole point of the prototype: if these disagree, the drill-down is matching on a
   * different grain than `GetInvoiceActualsAsync` and the number would mislead. Surfaced
   * rather than hidden so the mismatch is obvious during the comparison.
   */
  get reconciles(): boolean {
    if (this.expected == null) return true;
    return Math.abs(this.total - this.expected) < 0.005;
  }

  isDirect(r: RechargeInstructionDto): boolean {
    return (r.mode || '').toLowerCase() === 'direct';
  }

  allocationLabel(r: RechargeInstructionDto): string {
    if (this.isDirect(r)) return 'Full line';
    return `${Number(r.percentage ?? 0).toFixed(2).replace(/\.00$/, '')}%`;
  }

  monthLabel(r: RechargeInstructionDto): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const idx = (r.postingMonth ?? 0) - 1;
    return idx >= 0 && idx < 12 ? `${months[idx]} ${r.postingYear}` : '—';
  }

  fmtDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [y, m, d] = String(value).slice(0, 10).split('-');
    return y && m && d ? `${d}/${m}/${y}` : '—';
  }

  trackByRow(_i: number, r: RechargeInstructionDto): number { return r.id; }
}
