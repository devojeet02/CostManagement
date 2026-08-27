import { Component, DoCheck, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators';
import {
  InvoiceService, RelatedActualDetail, RelatedDataPanel
} from '../../services/invoice.service';

/**
 * The bits of one invoice line that decide which actuals/forecast it relates to.
 * Site and Team come from the header, so they are separate inputs.
 */
export interface RelatedDataLineRef {
  line: number;
  account: string;
  internalOrder: string;
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
  /** Calendar year the panel reports on. Cumulative variance restarts at zero in its January. */
  @Input() year: number = new Date().getFullYear();
  @Input() site = '';
  @Input() team = '';
  @Input() lines: RelatedDataLineRef[] = [];

  /** Forecast scenario to read. Blank lets the server pick the year's default. */
  @Input() scenario = '';

  /** The record being edited, excluded from Actuals so the row means "already posted". */
  @Input() excludeInvoiceId?: number;

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

  constructor(private invoiceService: InvoiceService) {}

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
              year: this.year,
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

    this.signature = this.currentSignature();
    this.rebuildContexts();
    this.reload$.next();
  }

  ngDoCheck(): void {
    const next = this.currentSignature();
    if (next === this.signature) return;
    this.signature = next;
    this.rebuildContexts();
    this.reload$.next();
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
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
    return `${this.year}~${this.site}~${this.team}~${this.scenario}~${this.excludeInvoiceId ?? ''}~${lines}`;
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

  // ── Template helpers ───────────────────────────────────────────────────────

  get hasParameters(): boolean {
    return !!this.site && !!this.team;
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
