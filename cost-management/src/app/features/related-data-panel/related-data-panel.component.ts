import { Component, DoCheck, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators';
import {
  InvoiceService, RelatedActualDetail, RelatedDataPanel
} from '../../services/invoice.service';
import { ForecastService } from '../../services/forecast.service';
import { MasterDataService } from '../../services/master-data.service';

/**
 * The bits of one invoice line that decide which actuals/forecast it relates to.
 * Site and Team come from the header, so they are separate inputs.
 *
 * Everything below `internalOrder` is DISPLAY ONLY — it feeds the parameters section and is
 * deliberately absent from `currentSignature()`, so editing a description or a spend type
 * never triggers a refetch. They are optional because they play no part in the query, and both
 * host screens already satisfy them by structural typing: `lineItems` carries these exact
 * property names, so `[lines]="lineItems"` supplies them with no change at the call site.
 */
export interface RelatedDataLineRef {
  line: number;
  account: string;
  internalOrder: string;
  spendType?: string;
  spendLayer?: string;
  category?: string;
  system?: string;
  description?: string;
}

/**
 * One (Account, Internal Order) combination the panel can report on. An invoice's lines often
 * repeat a combination, so contexts are de-duplicated and remember which line numbers they came
 * from — the selector reads "Lines 1, 3" rather than listing the same figures twice.
 */
interface PanelContext {
  key: string;
  account: string;
  internalOrder: string;
  lines: number[];
  label: string;
}

/**
 * The coding an internal order was last saved with, lifted off its forecast line. Every field is
 * a plain stored value except `account` and `supplier`, which are master-data codes.
 */
export interface ForecastCombination {
  account: string;
  spendType: string;
  spendLayer: string;
  category: string;
  system: string;
  supplier: string;
  description: string;
}

/** Where a hover card sits, plus what it is showing. */
interface DetailPopover {
  month: number;
  rows: RelatedActualDetail[];
  /** Total contributing rows, so the card can say "+3 more" when the list is capped. */
  totalRows: number;
  top: number;
  left: number;
  /** Card is placed above the cell when there isn't room below. */
  above: boolean;
}

/**
 * Epic 2 — "Related Forecast and Actual Data" on the Invoice Handling screen.
 *
 * Three rows for the current invoice's parameters: Actuals from already-posted invoices,
 * Forecast/Budget for the same parameters, and the cumulative variance between them. Always
 * visible; it fetches on its own as the form is filled in and never blocks or gates a save.
 *
 * Everything it shows is derived server-side from existing records — the panel writes nothing,
 * so it cannot affect the upload/edit flow it sits under.
 */
@Component({
  selector: 'cm-related-data-panel',
  templateUrl: './related-data-panel.component.html',
  styleUrls: ['./related-data-panel.component.scss']
})
export class RelatedDataPanelComponent implements OnInit, DoCheck, OnDestroy {
  /**
   * The invoice's own posting year — the DEFAULT the panel reports on. Cumulative variance
   * restarts at zero in its January.
   *
   * Read through `effectiveYear`, never directly: the user can point the panel at an earlier
   * year from the header without touching the invoice.
   */
  @Input() year: number = new Date().getFullYear();
  @Input() site = '';
  @Input() team = '';
  @Input() lines: RelatedDataLineRef[] = [];

  /** Forecast scenario to read. Blank lets the server pick the year's default. */
  @Input() scenario = '';

  /** The record being edited, excluded from Actuals so the row means "already posted". */
  @Input() excludeInvoiceId?: number;

  /**
   * Invoice-level supplier, for the parameters section. Display only — it is not a dimension
   * the related-data query reads, so it is out of the signature and never causes a refetch.
   */
  @Input() supplier = '';

  /**
   * Lookup of master-data CODE → display name, used only to render the parameters section.
   *
   * Site, Team, Supplier and Account are all stored as codes ('netherlands',
   * 'governance-vendor', 'gl-6100'), while Spend Type, Layer, Category and System are already
   * stored as names. Rather than teach this panel to fetch four catalogues it has no other use
   * for, the host screen — which already holds them for its own dropdowns — passes the mapping
   * down. Unresolved codes fall back to themselves, so a missing map degrades to raw codes
   * rather than blanks.
   */
  @Input() labels: { [code: string]: string } = {};

  readonly months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Contexts derived from `lines`, plus the combined view when there is more than one. */
  contexts: PanelContext[] = [];
  /** '' = the combined "All lines" view. */
  selectedKey = '';

  isLoading = false;
  loadError = false;

  /** Whichever context is on screen, already combined if that's the selection. */
  panel: RelatedDataPanel | null = null;

  popover: DetailPopover | null = null;

  /** The panel's detail rows bucketed by month index (0-11) — see applySelection. */
  detailsByMonth: RelatedActualDetail[][] = Array.from({ length: 12 }, () => []);

  /** Most rows a hover card lists before it starts counting the rest. */
  private readonly maxPopoverRows = 6;

  /** Results keyed by context, so switching the selector is instant and makes no request. */
  private results = new Map<string, RelatedDataPanel>();

  /**
   * Signature of everything the panel queries on, from the last time it reloaded.
   *
   * The parent MUTATES its line array in place (`item.account = …`, splice on remove) rather
   * than replacing it, so ngOnChanges never fires for the edits that matter most. ngDoCheck
   * with a value signature catches those; comparing strings keeps it from re-fetching on every
   * change-detection pass, which a fresh-array input would have caused.
   */
  private signature = '';

  private readonly reload$ = new Subject<void>();
  private readonly sub = new Subscription();

  constructor(
    private invoiceService: InvoiceService,
    private forecastService: ForecastService,
    private masterDataService: MasterDataService
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.reload$.pipe(
        // The panel re-fetches while the user types into the form, so collapse the burst.
        debounceTime(450),
        switchMap(() => {
          // Captured here, and carried through with the response. Reading this.contexts
          // again on arrival would risk pairing results with a DIFFERENT list: ngDoCheck can
          // rebuild the contexts while a batch is still in the debounce window, and the
          // results are matched to keys by position.
          const keys = this.contexts.filter(c => c.key !== '');
          if (!this.site || !this.team || keys.length === 0) return of(null);

          this.isLoading = true;
          this.loadError = false;

          // One request per distinct combination, all in flight together. switchMap drops
          // an in-flight batch when the form changes again, so a slow response can never
          // land on top of a newer one.
          return forkJoin(
            keys.map(c => this.invoiceService.getRelatedData({
              year: this.effectiveYear,
              site: this.site,
              team: this.team,
              account: c.account || undefined,
              internalOrder: c.internalOrder || undefined,
              scenario: this.scenario || undefined,
              excludeInvoiceId: this.excludeInvoiceId
            }))
          ).pipe(
            map(panels => ({ keys, panels })),
            // catchError sits INSIDE the switchMap so one failed batch doesn't kill the
            // stream and leave the panel permanently dead.
            catchError(() => of('error' as const))
          );
        })
      ).subscribe(res => {
        this.isLoading = false;
        this.results.clear();

        if (res === null) { this.applySelection(); return; }
        if (res === 'error') { this.loadError = true; this.applySelection(); return; }

        res.keys.forEach((c, i) => this.results.set(c.key, res.panels[i]));
        this.applySelection();
      })
    );

    this.lastInputYear = this.year;
    this.rebuildYearOptions();
    this.loadYearOptions();

    this.signature = this.currentSignature();
    this.rebuildContexts();
    this.reload$.next();
    this.loadCombinations();
  }

  ngDoCheck(): void {
    // Both are cheap guards that return immediately unless the year actually moved.
    this.syncYearOptions();
    this.loadCombinations();

    const next = this.currentSignature();
    if (next === this.signature) return;
    this.signature = next;
    this.rebuildContexts();
    this.reload$.next();
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.comboSub.unsubscribe();
  }

  /** Force a fresh fetch — the retry button, and after a save adds new actuals. */
  refresh(): void {
    this.rebuildContexts();
    this.reload$.next();
  }

  /** Everything a query depends on, flattened so ngDoCheck can spot an in-place edit. */
  private currentSignature(): string {
    const lines = (this.lines ?? [])
      .map(l => `${l.line}:${l.account ?? ''}:${l.internalOrder ?? ''}`)
      .join('|');
    return `${this.effectiveYear}~${this.site}~${this.team}~${this.scenario}~${this.excludeInvoiceId ?? ''}~${lines}`;
  }

  selectContext(key: string): void {
    this.selectedKey = key;
    this.applySelection();
  }

  // ── Contexts ───────────────────────────────────────────────────────────────

  /**
   * Turns the current line grid into the list of combinations worth reporting on.
   *
   * A line with neither Account nor Internal Order is skipped: it would widen the query to
   * "every account and order for this site+team", and summing that alongside a specific line
   * would count the same spend twice. When no line has either yet, one deliberately wide
   * context stands in so the panel still shows the site/team picture while the form is empty.
   */
  private rebuildContexts(): void {
    const byKey = new Map<string, PanelContext>();

    for (const l of this.lines ?? []) {
      const account = (l.account ?? '').trim();
      const internalOrder = (l.internalOrder ?? '').trim();
      if (!account && !internalOrder) continue;

      const key = `${account}||${internalOrder}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.lines.includes(l.line)) existing.lines.push(l.line);
      } else {
        byKey.set(key, { key, account, internalOrder, lines: [l.line], label: '' });
      }
    }

    let contexts = [...byKey.values()];
    if (contexts.length === 0) {
      contexts = [{ key: 'any', account: '', internalOrder: '', lines: [], label: '' }];
    }
    contexts.forEach(c => (c.label = this.labelFor(c)));

    // The combined view only earns a place when there is actually more than one thing to combine.
    this.contexts = contexts.length > 1
      ? [{ key: '', account: '', internalOrder: '', lines: [], label: 'All lines' }, ...contexts]
      : contexts;

    // Keep the current selection if it still exists, otherwise fall back to the first entry.
    if (!this.contexts.some(c => c.key === this.selectedKey)) {
      this.selectedKey = this.contexts[0].key;
    }
  }

  private labelFor(c: PanelContext): string {
    if (!c.account && !c.internalOrder) return 'All accounts & internal orders';
    const parts = [c.internalOrder || 'Any internal order', c.account || 'Any account'];
    const lineNote = c.lines.length > 0
      ? ` (Line${c.lines.length > 1 ? 's' : ''} ${c.lines.join(', ')})`
      : '';
    return `${parts.join(' · ')}${lineNote}`;
  }

  // ── Selection / combination ────────────────────────────────────────────────

  private applySelection(): void {
    this.popover = null;
    this.panel = this.results.size === 0
      ? null
      : (this.selectedKey !== '' ? this.results.get(this.selectedKey) ?? null : this.combineAll());

    // Bucketed once per selection rather than filtered from the template: `hasDetail(m)` is
    // bound on all twelve cells, so a getter would rescan the whole detail list on every
    // change-detection pass.
    this.detailsByMonth = Array.from({ length: 12 }, () => [] as RelatedActualDetail[]);
    for (const d of this.panel?.details ?? []) {
      if (d.month >= 1 && d.month <= 12) this.detailsByMonth[d.month - 1].push(d);
    }
  }

  /**
   * "All lines": adds the per-context months together, then re-derives the cumulative
   * variance from the combined rows. The cumulative figure has to be recomputed rather than
   * summed — adding running totals would work out the same here, but only by luck, and it
   * would stop being true the moment a context is filtered out.
   */
  private combineAll(): RelatedDataPanel | null {
    const parts = [...this.results.values()];
    if (parts.length === 0) return null;

    const actuals: (number | null)[] = new Array(12).fill(null);
    const forecast: (number | null)[] = new Array(12).fill(null);

    for (const p of parts) {
      for (let i = 0; i < 12; i++) {
        // A month stays null until some context actually reports a figure for it, so an
        // untouched month still renders "—" instead of a synthetic 0.00.
        if (p.actuals[i] != null) actuals[i] = (actuals[i] ?? 0) + (p.actuals[i] as number);
        if (p.forecast[i] != null) forecast[i] = (forecast[i] ?? 0) + (p.forecast[i] as number);
      }
    }

    const cumulativeVariance: number[] = [];
    let running = 0;
    for (let i = 0; i < 12; i++) {
      running += (forecast[i] ?? 0) - (actuals[i] ?? 0);
      cumulativeVariance.push(running);
    }

    return {
      year: parts[0].year,
      scenario: parts[0].scenario,
      currency: parts[0].currency,
      actuals,
      forecast,
      cumulativeVariance,
      actualTotal: actuals.reduce<number>((s, v) => s + (v ?? 0), 0),
      forecastTotal: forecast.reduce<number>((s, v) => s + (v ?? 0), 0),
      varianceTotal: running,
      // De-duplicated: the same invoice line can only belong to one context, but a widened
      // "any" context would otherwise repeat rows a specific context already listed.
      details: this.dedupeDetails(parts.flatMap(p => p.details)),
      matched: parts.some(p => p.matched)
    };
  }

  private dedupeDetails(rows: RelatedActualDetail[]): RelatedActualDetail[] {
    const seen = new Set<string>();
    const out: RelatedActualDetail[] = [];
    for (const r of rows) {
      const key = `${r.invoiceId}|${r.line}|${r.month}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  // ── Year selection ─────────────────────────────────────────────────────────
  //
  // The panel defaults to the invoice's own posting year, which is what it always did. This lets
  // it be pointed at an earlier year to see what was spent and planned then, WITHOUT touching the
  // invoice: `year` is still the input, and `yearOverride` is a view-only shift on top of it.

  /** User's pick, or null while the panel is following the invoice. */
  private yearOverride: number | null = null;

  /** Last input year seen, so an actual change to the invoice date can clear the override. */
  private lastInputYear: number | null = null;

  /** Years offered in the header. Always contains `year`, even if nothing is recorded for it. */
  availableYears: number[] = [];

  /** The year every query, the combination map and the popover header actually use. */
  get effectiveYear(): number {
    return this.yearOverride ?? this.year;
  }

  /** True while looking at anything other than the invoice's own year — drives the hint. */
  get isViewingOtherYear(): boolean {
    return this.yearOverride != null && this.yearOverride !== this.year;
  }

  /**
   * Switches the year the panel reports on.
   *
   * Selecting the invoice's own year clears the override rather than pinning it, so the panel
   * goes back to following the invoice date instead of freezing on a year that merely happens to
   * match today.
   */
  onYearChange(value: string | number): void {
    const picked = Number(value);
    if (!Number.isFinite(picked)) return;
    this.yearOverride = picked === this.year ? null : picked;
    this.rebuildContexts();
    this.reload$.next();
    this.loadCombinations();
  }

  /**
   * Keeps the offered years honest, and drops a stale override.
   *
   * Called from ngDoCheck, so it must stay cheap — it returns immediately unless the INPUT year
   * moved. When it has (the user edited the invoice date), any override is cleared: the invoice
   * has moved to a different year and the panel should follow it rather than silently keep
   * reporting on the year the user peeked at earlier.
   */
  private syncYearOptions(): void {
    if (this.lastInputYear === this.year) return;
    this.lastInputYear = this.year;
    this.yearOverride = null;
    this.rebuildYearOptions();
  }

  /** Merges the invoice's year into whatever years master data knows about, newest first. */
  private rebuildYearOptions(): void {
    const years = new Set<number>(this.scenarioYears);
    years.add(this.year);
    this.availableYears = [...years].sort((a, b) => b - a);
  }

  /** Distinct years that actually have a scenario — "if present", rather than a guessed range. */
  private scenarioYears: number[] = [];

  private loadYearOptions(): void {
    this.comboSub.add(
      this.masterDataService.getScenarios().pipe(catchError(() => of([] as any[]))).subscribe(rows => {
        this.scenarioYears = [...new Set((rows ?? [])
          .map(r => r.year)
          .filter((y: unknown): y is number => typeof y === 'number' && y > 1900))];
        this.rebuildYearOptions();
      })
    );
  }

  // ── Parameters section (collapsible) ───────────────────────────────────────
  // Purely presentational: it restates what the panel is reporting on, so the figures can be
  // read without scrolling back up the form. Nothing here touches the query, the states or the
  // grid — it is a sibling block, so every existing div is untouched.

  /** Open by default: the point of the section is to be seen, and it collapses when in the way. */
  paramsOpen = true;

  toggleParams(): void {
    this.paramsOpen = !this.paramsOpen;
  }

  /**
   * The lines the parameters section lists, following whatever the "Showing" selector has.
   *
   * Picking one (Account, Internal Order) combination narrows this to the lines that produced
   * it, so the parameters describe the very figures on screen. "All lines" — and the synthetic
   * wide context used before any line has an account or order — fall back to every line, which
   * is exactly what those views report on.
   */
  get paramLines(): RelatedDataLineRef[] {
    const all = this.lines ?? [];
    const ctx = this.contexts.find(c => c.key === this.selectedKey);
    if (!ctx || ctx.lines.length === 0) return all;
    return all.filter(l => ctx.lines.includes(l.line));
  }

  // ── Internal-order combinations ────────────────────────────────────────────
  //
  // "Where do the saved combinations live?" — in the forecast. A forecast line already carries
  // account, spend type, spend layer, category, system, supplier and description against an
  // internal order, which IS the combination, so nothing new needs storing: the planning line
  // for an internal order is the canonical coding for it.
  //
  // This is a SEPARATE stream from reload$ on purpose. It must never delay, cancel or fail the
  // figures the panel exists to show, and it is deliberately absent from currentSignature(), so
  // typing an internal order does not re-fetch related data — it only fills the blanks below.

  /** internal order (upper-cased) → the coding its forecast line was saved with. */
  private combos = new Map<string, ForecastCombination>();

  /** Year the map was built for; the forecast is fetched per year, once. */
  private combosYear: number | null = null;

  private readonly comboSub = new Subscription();

  /**
   * Loads the year's forecast lines and indexes them by internal order.
   *
   * Fires once per year and never blocks anything: a failure just leaves the map empty, and the
   * parameters section then shows exactly what it showed before this feature existed.
   */
  private loadCombinations(): void {
    const year = this.effectiveYear;
    if (this.combosYear === year) return;
    this.combosYear = year;

    this.comboSub.add(
      this.forecastService.list(year).pipe(catchError(() => of([] as any[]))).subscribe(rows => {
        // Only rebuild if the year is still the one we asked for — a fast year change would
        // otherwise let a stale response overwrite a newer map.
        if (this.combosYear !== year) return;
        this.combos = this.indexCombinations(rows ?? []);
      })
    );
  }

  /**
   * Builds the lookup, preferring lines from this invoice's own site and team.
   *
   * One internal order can appear on several forecast lines (other sites, other scenarios), so
   * order matters: matching site+team lines are folded in first and a later line never
   * overwrites a value already found. Per FIELD rather than per row, because a row that matches
   * on site+team may still leave a field blank that another row fills.
   */
  private indexCombinations(rows: any[]): Map<string, ForecastCombination> {
    const mine = (r: any) =>
      (!this.site || (r.site ?? '') === this.site) && (!this.team || (r.team ?? '') === this.team);
    const ordered = [...rows.filter(mine), ...rows.filter(r => !mine(r))];

    const map = new Map<string, ForecastCombination>();
    for (const r of ordered) {
      const io = (r.internalOrder ?? '').trim().toUpperCase();
      if (!io) continue;

      const combo = map.get(io) ?? { account: '', spendType: '', spendLayer: '', category: '', system: '', supplier: '', description: '' };
      const fill = (key: keyof ForecastCombination, value: unknown) => {
        if (!combo[key]) combo[key] = ((value ?? '') as string).toString().trim();
      };
      fill('account', r.account);
      fill('spendType', r.spendType);
      fill('spendLayer', r.spendLayer);
      fill('category', r.category);
      fill('system', r.system);
      fill('supplier', r.supplier);
      fill('description', r.description);
      map.set(io, combo);
    }
    return map;
  }

  /** The saved coding for a line's internal order, or null when there is none. */
  comboFor(line: RelatedDataLineRef): ForecastCombination | null {
    const io = (line.internalOrder ?? '').trim().toUpperCase();
    return io ? this.combos.get(io) ?? null : null;
  }

  /**
   * What one parameter cell shows: the line's own value when it has one, otherwise whatever the
   * internal order's forecast line was saved with.
   *
   * NOTHING is written back. The invoice keeps whatever the user typed — this only stops the
   * panel reporting a blank when the coding for that internal order is already known.
   */
  paramCell(line: RelatedDataLineRef, field: keyof ForecastCombination): string {
    const own = ((line as any)[field] ?? '').toString().trim();
    if (own) return own;
    return this.comboFor(line)?.[field] || '';
  }

  /**
   * Tooltip on the Internal Order cell, explaining where the dimmed values came from.
   *
   * Built here rather than inline in the template: the sentence contains an apostrophe, and
   * Angular's expression parser has no escape for one inside a quoted template string.
   * Empty when this internal order has no saved coding, which suppresses the tooltip entirely.
   */
  internalOrderHint(line: RelatedDataLineRef): string {
    return this.comboFor(line)
      ? 'Blank fields on this row are filled from the forecast line saved for this internal order.'
      : '';
  }

  /** True when the cell is showing the internal order's coding rather than the line's own. */
  isInherited(line: RelatedDataLineRef, field: keyof ForecastCombination): boolean {
    const own = ((line as any)[field] ?? '').toString().trim();
    return !own && !!this.comboFor(line)?.[field];
  }

  /** Drives the one-line explanation under the table. */
  get hasInheritedValues(): boolean {
    const fields: (keyof ForecastCombination)[] =
      ['account', 'spendType', 'spendLayer', 'category', 'system', 'description'];
    return this.paramLines.some(l => fields.some(f => this.isInherited(l, f)));
  }

  /** Resolves a master-data code to its display name; falls back to the code, then an em dash. */
  paramLabel(code: string | null | undefined): string {
    const raw = (code ?? '').trim();
    if (!raw) return '—';
    return this.labels?.[raw] ?? raw;
  }

  /** Plain stored values (spend type, category, description …) — shown as-is, never resolved. */
  paramText(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    return raw || '—';
  }

  trackParamLine(_index: number, l: RelatedDataLineRef): number { return l.line; }

  // ── Template helpers ───────────────────────────────────────────────────────

  get hasParameters(): boolean {
    return !!this.site && !!this.team;
  }

  /**
   * True when the response came back but holds no figures at all.
   *
   * Distinct from `!panel`, which means the query never ran. A year with nothing recorded still
   * returns a well-formed panel — twelve nulls and zero totals — which would otherwise render as
   * a full grid of em-dashes and 0.00s and read as data. Checked against the months rather than
   * the totals: actuals and forecast that genuinely cancel to zero are still figures worth
   * showing, and a null month is the API's way of saying "nothing here".
   */
  get hasNoFigures(): boolean {
    const p = this.panel;
    if (!p) return false;
    const empty = (a: (number | null)[] | undefined) => !(a ?? []).some(v => v != null);
    return empty(p.actuals) && empty(p.forecast) && (p.details?.length ?? 0) === 0;
  }

  get selectedLabel(): string {
    return this.contexts.find(c => c.key === this.selectedKey)?.label ?? '';
  }

  /** Rows behind one Actuals cell (month index 0-11), newest first. */
  detailsFor(month: number): RelatedActualDetail[] {
    return this.detailsByMonth[month] ?? [];
  }

  hasDetail(month: number): boolean {
    return this.detailsFor(month).length > 0;
  }

  /**
   * Opens the hover card against the cell's viewport rect.
   *
   * `position: fixed` coordinates rather than an absolutely-positioned child: the panel sits
   * inside the page's scrolling body, and an absolute card would be clipped by it.
   */
  showDetail(month: number, event: MouseEvent): void {
    const rows = this.detailsFor(month);
    if (rows.length === 0) { this.popover = null; return; }

    const cell = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const estHeight = 60 + Math.min(rows.length, this.maxPopoverRows) * 74;
    const above = cell.bottom + estHeight > window.innerHeight && cell.top > estHeight;

    // Keep the card on screen horizontally — a December cell sits at the right edge.
    const width = 320;
    const left = Math.min(Math.max(8, cell.left), window.innerWidth - width - 8);

    this.popover = {
      month,
      rows: rows.slice(0, this.maxPopoverRows),
      totalRows: rows.length,
      top: above ? cell.top - estHeight - 6 : cell.bottom + 6,
      left,
      above
    };
  }

  hideDetail(): void {
    this.popover = null;
  }

  /** Red when spending more than planned, green when less, neutral at zero. */
  varianceClass(value: number | null | undefined): string {
    if (value == null || value === 0) return 'rdp-neutral';
    // Positive cumulative variance = forecast still exceeds actuals = underspend so far.
    return value > 0 ? 'rdp-under' : 'rdp-over';
  }

  trackMonth(index: number): number { return index; }
  trackContext(_index: number, c: PanelContext): string { return c.key; }
  trackDetail(_index: number, d: RelatedActualDetail): string {
    return `${d.invoiceId}|${d.line}|${d.month}`;
  }
}
