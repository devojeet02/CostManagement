import { Component, HostListener } from '@angular/core';
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

  // ── Save / Cancel ──────────────────────────────────────────────────────────
  saveChanges(): void {
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
