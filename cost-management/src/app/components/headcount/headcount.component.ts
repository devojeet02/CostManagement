import { Component, HostListener, ViewChild, ElementRef } from '@angular/core';
import {
  HC_MONTHS, HC_REGIONS, HC_COUNTRIES, HC_SITES, HC_TEAMS, HC_EMPLOYEE_TYPES,
  HC_EMPLOYEES, HC_FUNCTIONS, HC_SCENARIO_YEARS,
  HC_DEFAULT_FILTERS, HC_DEFAULT_TOGGLES,
  HeadcountRow, HeadcountFilters, HeadcountToggles, HcScenarioRow, HcScenarioType,
  MOCK_HEADCOUNT_ROWS, buildDefaultScenarioRows, HC_API_ENDPOINTS
} from '../../constants/headcount.constants';

@Component({
  selector: 'app-headcount',
  templateUrl: './headcount.component.html',
  styleUrls: ['./headcount.component.scss']
})
export class HeadcountComponent {

  constructor() {
    this.applySavedOrder();
  }

  isMobileView = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;

  @HostListener('window:resize', ['$event'])
  onResize(): void {
    this.isMobileView = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
  }

  // ── Reference data (from constants; swap for HTTP calls when API is ready) ──
  readonly months        = HC_MONTHS;
  readonly regions       = HC_REGIONS;
  readonly countries     = HC_COUNTRIES;
  readonly sites         = HC_SITES;
  readonly teams         = HC_TEAMS;
  readonly employeeTypes = HC_EMPLOYEE_TYPES;
  readonly employees     = HC_EMPLOYEES;
  readonly functions     = HC_FUNCTIONS;
  readonly scenarioYears = HC_SCENARIO_YEARS;
  readonly apiEndpoints  = HC_API_ENDPOINTS; // kept for future wiring

  // ── State ──────────────────────────────────────────────────────────────────
  filters: HeadcountFilters = { ...HC_DEFAULT_FILTERS };
  toggles: HeadcountToggles = { ...HC_DEFAULT_TOGGLES };

  // TODO: Replace with:
  //   this.http.get<HeadcountRow[]>(HC_API_ENDPOINTS.headcount.getAll())
  //     .subscribe(rows => this.headcountRows = rows);
  headcountRows: HeadcountRow[] = JSON.parse(JSON.stringify(MOCK_HEADCOUNT_ROWS));

  get filteredHeadcountRows(): HeadcountRow[] {
    return this.headcountRows.filter(row => {
      if (this.filters.site && row.site !== this.filters.site) return false;
      if (this.filters.team && row.team !== this.filters.team) return false;
      return true;
    });
  }

  /** Which year a given sub-row reads: primary → scenarioYear, other → otherScenarioYear. */
  yearFor(sub: HcScenarioRow): number {
    return sub.type === 'other' ? this.filters.otherScenarioYear : this.filters.scenarioYear;
  }

  /** The monthly values for the year that applies to this sub-row. */
  vals(sub: HcScenarioRow): (number | null)[] {
    return sub.valuesByYear[this.yearFor(sub)] ?? [];
  }

  // ── Visible scenario sub-rows ───────────────────────────────────────────────

  /** Scenario types currently shown — 'other' (Budget) only when the toggle is on. */
  get visibleScenarioTypes(): HcScenarioType[] {
    const t: HcScenarioType[] = ['primary'];
    if (this.toggles.showOtherScenario) t.push('other');
    return t;
  }

  visibleScenarioRows(row: HeadcountRow): HcScenarioRow[] {
    return row.scenarioRows.filter(s => s.type === 'primary' || this.toggles.showOtherScenario);
  }

  /** Scenario label, year-aware: e.g. 'RFC3 2026' / 'Budget 2025'. */
  scenarioLabel(type: HcScenarioType): string {
    const base = type === 'primary' ? 'RFC3' : 'Budget';
    const year = type === 'other' ? this.filters.otherScenarioYear : this.filters.scenarioYear;
    return `${base} ${year}`;
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  /** Row total = number of months the employee is present in that scenario/year. */
  getRowTotal(values: (number | null)[]): number {
    return values.reduce((s: number, v) => s + (v ?? 0), 0);
  }

  /** Total headcount for a scenario in a given month, across the filtered rows. */
  getColTotal(type: HcScenarioType, mi: number): number {
    return this.filteredHeadcountRows.reduce((t, row) => {
      const sub = row.scenarioRows.find(s => s.type === type);
      return t + (sub ? (this.vals(sub)[mi] ?? 0) : 0);
    }, 0);
  }

  getScenarioTotal(type: HcScenarioType): number {
    return this.months.reduce((t, _, i) => t + this.getColTotal(type, i), 0);
  }

  /**
   * Variance class for the primary total against Budget for a given month.
   * red = over budget headcount, green = on/under budget. Only meaningful when
   * the Budget (other) scenario is visible.
   */
  varianceClass(mi: number): string {
    if (!this.toggles.showOtherScenario) return '';
    const primary = this.getColTotal('primary', mi);
    const other   = this.getColTotal('other', mi);
    if (primary > other) return 'hc-over';
    if (primary < other) return 'hc-under';
    return '';
  }

  // ── Binary enforcement (domain rule: 1 = present, 0 = absent, no fractions) ─
  normalizeBinary(sub: HcScenarioRow, mi: number): void {
    const arr = this.vals(sub);
    const v = arr[mi];
    arr[mi] = v && Number(v) >= 1 ? 1 : 0;
  }

  // ── Row management ─────────────────────────────────────────────────────────
  addRow(): void {
    // TODO: After save, call HC_API_ENDPOINTS.headcount.create() to persist the new row.
    this.headcountRows.push({
      id:             Date.now(),
      region:         '',
      country:        '',
      site:           this.filters.site || '',
      category:       'Full Time',
      employee:       '',
      functionForTba: '',
      team:           this.filters.team || '',
      comment:        '',
      scenarioRows:   buildDefaultScenarioRows()
    });
  }

  removeRow(id: number): void {
    // TODO: Also call HC_API_ENDPOINTS.headcount.delete(id) when API is ready.
    this.headcountRows = this.headcountRows.filter(r => r.id !== id);
  }

  // ── Row reordering (drag & drop, persisted via Save) ────────────────────────
  // The drag handle lives in a rail OUTSIDE the data tables. Dragging reorders
  // the shared `headcountRows` array — both left and right tables iterate it,
  // so the whole logical row (left + right) moves as a unit. The order is
  // written to localStorage in saveChanges() and re-applied on init / cancel.
  private readonly ORDER_KEY = 'headcount-row-order';

  draggedRowId: number | null = null;
  dragOverRowId: number | null = null;
  /** Transient DOM node used as the drag ghost; cleaned up in dragend. */
  private dragImageEl: HTMLElement | null = null;

  // Scroll-sync between the detached drag rail and the data tables container.
  @ViewChild('railScroll')  railScrollEl?:  ElementRef<HTMLElement>;
  @ViewChild('tableScroll') tableScrollEl?: ElementRef<HTMLElement>;
  private syncingScroll = false;

  onRailScroll(): void {
    if (this.syncingScroll || !this.railScrollEl || !this.tableScrollEl) return;
    const src = this.railScrollEl.nativeElement;
    const dst = this.tableScrollEl.nativeElement;
    if (dst.scrollTop !== src.scrollTop) {
      this.syncingScroll = true;
      dst.scrollTop = src.scrollTop;
      requestAnimationFrame(() => this.syncingScroll = false);
    }
  }

  onTableScroll(): void {
    if (this.syncingScroll || !this.railScrollEl || !this.tableScrollEl) return;
    const src = this.tableScrollEl.nativeElement;
    const dst = this.railScrollEl.nativeElement;
    if (dst.scrollTop !== src.scrollTop) {
      this.syncingScroll = true;
      dst.scrollTop = src.scrollTop;
      requestAnimationFrame(() => this.syncingScroll = false);
    }
  }

  onRowDragStart(event: DragEvent, row: HeadcountRow): void {
    this.draggedRowId = row.id;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to actually initiate the drag.
    event.dataTransfer.setData('text/plain', String(row.id));

    // Build a visible drag preview card so the user sees the row moving with
    // the cursor. The browser snapshots this DOM node at setDragImage time, so
    // inline styles are required (component-scoped CSS doesn't reach body).
    const preview = document.createElement('div');
    preview.textContent = this.dragPreviewLabel(row);
    preview.style.cssText = [
      'position: absolute',
      'top: -1000px',
      'left: -1000px',
      'background: #1e293b',
      'color: #e2e8f0',
      'border: 1px solid #38bdf8',
      'border-radius: 6px',
      'padding: 7px 14px',
      'font: 600 12px system-ui, sans-serif',
      'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45)',
      'pointer-events: none',
      'white-space: nowrap',
      'z-index: 2147483647'
    ].join(';');
    document.body.appendChild(preview);
    this.dragImageEl = preview;
    event.dataTransfer.setDragImage(preview, 14, 14);
  }

  private dragPreviewLabel(row: HeadcountRow): string {
    const parts = [row.employee, row.site, row.team].filter(p => !!p && String(p).trim().length > 0);
    return parts.length ? parts.join(' · ') : 'Headcount row';
  }

  onRowDragOver(event: DragEvent, row: HeadcountRow): void {
    if (this.draggedRowId == null || this.draggedRowId === row.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverRowId = row.id;
  }

  onRowDragLeave(row: HeadcountRow): void {
    if (this.dragOverRowId === row.id) this.dragOverRowId = null;
  }

  onRowDrop(event: DragEvent, target: HeadcountRow): void {
    event.preventDefault();
    const srcId = this.draggedRowId;
    this.draggedRowId = null;
    this.dragOverRowId = null;
    if (srcId == null || srcId === target.id) return;

    const fromIdx = this.headcountRows.findIndex(r => r.id === srcId);
    const toIdx   = this.headcountRows.findIndex(r => r.id === target.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    // Direction-aware insertion so the source always moves in the direction
    // the user dragged:
    //   - dragging DOWN (fromIdx < toIdx): drop AFTER the target. After we
    //     splice the source out, the target's index has shifted left by 1,
    //     so inserting at `toIdx` in the post-splice array places the source
    //     just after the target.
    //   - dragging UP (fromIdx > toIdx): drop BEFORE the target. The target's
    //     index is unchanged (the splice happened after it), so inserting at
    //     `toIdx` places the source just before the target.
    // A previous version subtracted 1 in the downward case, which made
    // adjacent downward drags collapse into a no-op.
    const [moved] = this.headcountRows.splice(fromIdx, 1);
    this.headcountRows.splice(toIdx, 0, moved);
  }

  onRowDragEnd(): void {
    this.draggedRowId = null;
    this.dragOverRowId = null;
    if (this.dragImageEl) {
      this.dragImageEl.remove();
      this.dragImageEl = null;
    }
  }

  private loadSavedOrder(): number[] | null {
    try {
      const raw = localStorage.getItem(this.ORDER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeSavedOrder(ids: number[]): void {
    localStorage.setItem(this.ORDER_KEY, JSON.stringify(ids));
  }

  /** Re-sort headcountRows in-place to match the last saved order, if any. */
  private applySavedOrder(): void {
    const ids = this.loadSavedOrder();
    if (!ids || !ids.length) return;
    const indexOf = new Map<number, number>();
    ids.forEach((id, i) => indexOf.set(id, i));
    this.headcountRows.sort((a, b) => {
      const ai = indexOf.has(a.id) ? indexOf.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = indexOf.has(b.id) ? indexOf.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  // ── Monthly comments (per row, per scenario year) ───────────────────────────
  // Mirrors the Forecast screen: a per-row button opens a modal with 12 monthly
  // comment fields for the year selected in the Scenario Year dropdown, persisted
  // to localStorage. The hardcoded row.comment seed stays as a read-only reference.
  private readonly COMMENTS_KEY = 'headcount-row-comments';

  commentModalOpen = false;
  commentRow: HeadcountRow | null = null;
  /** Working copy of the 12 month comments while the modal is open. */
  commentDraft: string[] = [];

  /** The year the comment modal reads/writes — driven by the Scenario Year chip. */
  get currentYear(): number {
    return this.filters.scenarioYear;
  }

  /** Shape in localStorage: { [rowId]: { [year]: string[12] } } */
  private loadCommentStore(): Record<string, Record<string, string[]>> {
    try {
      const raw = localStorage.getItem(this.COMMENTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeCommentStore(store: Record<string, Record<string, string[]>>): void {
    localStorage.setItem(this.COMMENTS_KEY, JSON.stringify(store));
  }

  get commentModalTitle(): string {
    const label = this.commentRow?.employee || 'Row';
    return `Monthly Comments — ${label} (${this.currentYear})`;
  }

  /** Number of months with a saved comment for this row in the current year (badge). */
  commentCount(row: HeadcountRow): number {
    const saved = this.loadCommentStore()[row.id]?.[this.currentYear] ?? [];
    return saved.filter(c => !!c && c.trim().length > 0).length;
  }

  openComments(row: HeadcountRow): void {
    this.commentRow = row;
    const saved = this.loadCommentStore()[row.id]?.[this.currentYear] ?? [];
    // Always 12 slots, pre-filled with whatever was saved for this row+year.
    this.commentDraft = this.months.map((_, i) => saved[i] ?? '');
    this.commentModalOpen = true;
  }

  saveComments(): void {
    if (!this.commentRow) return;
    const store = this.loadCommentStore();
    const rowKey = String(this.commentRow.id);
    if (!store[rowKey]) store[rowKey] = {};
    store[rowKey][this.currentYear] = [...this.commentDraft];
    this.writeCommentStore(store);
    this.closeComments();
  }

  closeComments(): void {
    this.commentModalOpen = false;
    this.commentRow = null;
    this.commentDraft = [];
  }

  // ── Save / Cancel ──────────────────────────────────────────────────────────
  saveChanges(): void {
    // Persist the current row order locally so it survives reloads.
    this.writeSavedOrder(this.headcountRows.map(r => r.id));
    // TODO: Replace with:
    //   this.http.post(HC_API_ENDPOINTS.headcount.bulkSave(), this.headcountRows)
    //     .subscribe(() => { /* success toast */ });
    console.log('[HeadcountComponent] Saving rows:', this.headcountRows);
  }

  cancelChanges(): void {
    // TODO: Replace with a fresh GET from HC_API_ENDPOINTS.headcount.getAll()
    this.headcountRows = JSON.parse(JSON.stringify(MOCK_HEADCOUNT_ROWS));
    this.filters       = { ...HC_DEFAULT_FILTERS };
    this.toggles       = { ...HC_DEFAULT_TOGGLES };
    // Re-apply the last saved row order so cancel reverts to the saved state,
    // not back to the factory-mock order.
    this.applySavedOrder();
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  fmtTotal(v: number): string {
    return v ? v.toLocaleString() : '—';
  }

  // ── TrackBy helpers to prevent focus loss & DOM recreation ─────────────────
  trackByRow(index: number, row: HeadcountRow): number {
    return row.id;
  }

  trackByScenario(index: number, sub: HcScenarioRow): string {
    return sub.type;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
