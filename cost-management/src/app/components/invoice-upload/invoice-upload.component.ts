import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NgModel } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { map, switchMap, catchError, debounceTime } from 'rxjs/operators';
import { SelectGroup } from '../../features/hierarchy-select/hierarchy-select.component';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { InternalOrderService } from '../../services/internal-order.service';
import { InvoiceService, InvoicePayload, InvoiceDetail } from '../../services/invoice.service';
import { MasterDataService, LookupItemDto, AccountDto } from '../../services/master-data.service';
import { RelatedDataPanelComponent } from '../../features/related-data-panel/related-data-panel.component';

interface FieldChange { field: string; from: string; to: string; }
interface ChangeRecord { timestamp: Date; user: string; changes: FieldChange[]; }
interface RechargeAllocation {
  site: string;
  /** Which value the user entered — the other is derived for totals/delta. */
  mode: 'pct' | 'amount';
  pct: number | null;
  amount: number | null;
}

@Component({
  selector: 'cm-invoice-upload',
  templateUrl: './invoice-upload.component.html',
  styleUrls: ['./invoice-upload.component.scss']
})
export class InvoiceUploadComponent implements OnInit, OnDestroy {
  months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  selectedSite = '';

  /** Populated from GET /api/v1/master/accounts in ngOnInit — was hardcoded. */
  accountGroups: SelectGroup[] = [];

  /** Populated from GET /api/v1/master/categories in ngOnInit — was hardcoded. */
  spendCategories: string[] = [];

  /** Populated from GET /api/v1/master/spend-types in ngOnInit. */
  spendTypeOptions: string[] = [];

  /** Populated from GET /api/v1/master/spend-layers in ngOnInit. */
  spendLayerOptions: string[] = [];

  /** Populated from GET /api/v1/master/systems in ngOnInit. */
  systemOptions: string[] = [];

  selectedSupplier = '';

  /** Populated from GET /api/v1/master/suppliers in ngOnInit — was hardcoded. */
  supplierGroups: SelectGroup[] = [];

  selectedCurrency = '';

  /** Populated from GET /api/v1/master/currencies in ngOnInit — was hardcoded. */
  currencyGroups: SelectGroup[] = [];

  selectedTeam = '';

  /** Populated from GET /api/v1/master/teams in ngOnInit — was hardcoded. */
  teamGroups: SelectGroup[] = [];

  /** Sites with a currency assigned — these are the invoice-processing sites. Populated in ngOnInit. */
  siteGroups: SelectGroup[] = [];

  /**
   * Full site catalogue for recharge — *any* site in the system can be a recharge
   * target, not just the current invoice's site. Populated in ngOnInit.
   */
  rechargeSiteGroups: SelectGroup[] = [];

  /** Raw site master data, retained so `siteCurrency` can resolve a code to its currency. */
  protected sites: LookupItemDto[] = [];

  invoiceDate: string = (() => {
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    const y = prev.getFullYear();
    const m = String(prev.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  })();

  accountingDate: string = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  isDragging = false;
  uploadedFileName: string | null = null;
  uploadedFileUrl: SafeResourceUrl | null = null;
  /** The picked PDF itself, held until Save can POST it against the new invoice id. */
  protected selectedFile: File | null = null;
  protected objectUrl: string | null = null;

  isPreviewCollapsed = false;
  isPdfPreviewCollapsed = false;
  isHistoryOpen = false;

  autoStamp = {
    user: 'Devojeet Modak',
    processedAt: new Date(),
    uploadedAt: new Date()
  };

  changeHistory: ChangeRecord[] = [
    {
      timestamp: new Date('2026-05-22T14:32:00'),
      user: 'ankita.singh',
      changes: [
        { field: 'Inv Amount', from: '£5,000.00', to: '£6,200.00' },
        { field: 'Accounting Date', from: '01/04/2026', to: '01/05/2026' }
      ]
    },
    {
      timestamp: new Date('2026-05-20T09:15:00'),
      user: 'john.doe',
      changes: [
        { field: 'Supplier', from: 'AWS', to: 'Microsoft' }
      ]
    },
    {
      timestamp: new Date('2026-05-18T11:04:00'),
      user: 'ankita.singh',
      changes: [
        { field: 'Currency', from: 'USD', to: 'GBP' },
        { field: 'Team', from: 'Applications', to: 'Infrastructure' },
        { field: 'PAR', from: 'PAR-001', to: 'PAR-045' }
      ]
    }
  ];

  /**
   * The PROCESSING site's currency — the one every recharge is denominated in, whatever the
   * invoice currency or the receiving site's own currency (Wantage recharges in GBP, always).
   *
   * Resolved from master data, keyed on the site CODE the dropdown persists. It used to be a
   * hardcoded `{ 'UK': 'GBP', 'France': 'EUR', … }` map, which matched nothing once sites came
   * from `/master/*`: the real codes are lowercase (`france`, `bradford`), so every lookup
   * missed and this returned '' for every site — leaving the header's Site Currency blank.
   *
   * Falls back to matching on name, since `toSingleGroup` uses `code ?? name` as the stored
   * value and a site with no code would therefore be held by name.
   */
  get siteCurrency(): string {
    const key = (this.selectedSite || '').trim().toLowerCase();
    if (!key) return '';
    const match = this.sites.find(s =>
      (s.code ?? '').trim().toLowerCase() === key || s.name.trim().toLowerCase() === key);
    return match?.currencyCode ?? '';
  }

  get sortedHistory(): ChangeRecord[] {
    return [...this.changeHistory].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  protected static defaultPeriodStart(): string {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  protected static defaultPeriodEnd(): string {
    const d = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  protected blankLineItem(line: number) {
    return {
      line,
      account: '',
      periodStart: InvoiceUploadComponent.defaultPeriodStart(),
      periodEnd: InvoiceUploadComponent.defaultPeriodEnd(),
      internalOrder: '', spendType: '', speedType: '', spendLayer: '',
      category: '', system: '', lineData: '', description: '',
      // Annotated rather than left as a bare `null`, which TS would infer as the literal
      // type `null` — the template writes numbers into these via ngModel, and
      // InvoiceEditComponent assigns fetched amounts when prefilling.
      amountCurrency: null as number | null,
      /**
       * True while this line's amount was filled FOR the user from the header total, rather
       * than typed. A single-line invoice is the whole invoice, so the header amount is the
       * only sensible value — but the moment a second line exists that assumption is wrong,
       * and an auto-filled amount has to be cleared rather than silently double-counted.
       */
      amountAutoFilled: false,
      rechargeTo: '', recharge: false,
      amountSiteCurrency: null as number | null,
      rechargeSites: [] as RechargeAllocation[], rechargeSitePicker: '', sitePickerOpen: false
    };
  }

  /** Next line number for this invoice: one above the highest existing line. */
  protected nextLineNumber(): number {
    if (this.lineItems.length === 0) return 1;
    return Math.max(...this.lineItems.map(i => Number(i.line) || 0)) + 1;
  }

  // First line of every invoice starts at 1; numbering is scoped to this invoice only.
  lineItems = [this.blankLineItem(1)];

  isBudgeted = true;

  /**
   * Credit note. OFF by default — a plain invoice is the normal case. When on, the backend
   * counts this invoice's amounts negatively towards Forecast actuals, so a credit and the
   * invoice it offsets net out on the same cost line.
   *
   * The amount itself is still entered and stored POSITIVE; only the sign applied to actuals
   * changes. Entering a negative amount as well would cancel the two out.
   */
  isCredit = false;

  // ─── Recurring invoice ──────────────────────────────────────────────────────
  //
  // A licence, support contract or rent bills on a schedule, so once the first invoice is
  // entered the rest of the year is already known. Saving projects those future periods onto
  // the forecast (backend: EnsureRecurringForecastLinesAsync) instead of waiting for each
  // invoice to arrive.

  /** Bound to the Yes/No radios. */
  isRecurring = false;

  /** One of RECURRENCE_OPTIONS. Empty until Yes is chosen. */
  recurrencePeriodicity = '';

  /** The cadences the backend understands — kept in step with its PeriodicityMonths map. */
  readonly recurrenceOptions = [
    { value: 'Monthly',       label: 'Monthly',       hint: 'every month' },
    { value: 'Quarterly',     label: 'Quarterly',     hint: 'every 3 months' },
    { value: 'Semi-annually', label: 'Semi-annually', hint: 'every 6 months' },
    { value: 'Annually',      label: 'Annually',      hint: 'once a year' }
  ];

  /**
   * Turning Recurring off clears the cadence — leaving a stale one would send a periodicity
   * the backend then has to ignore, and it would reappear if the toggle were flipped back.
   */
  onRecurringChange(): void {
    if (!this.isRecurring) this.recurrencePeriodicity = '';
  }

  /** Recurring with no cadence chosen — the save guard blocks on this. */
  get recurrenceIncomplete(): boolean {
    return this.isRecurring && !this.recurrencePeriodicity;
  }

  /**
   * Plain-English summary of what saving will project, shown under the options.
   *
   * Reads from the invoice date because that is where the projection starts — a December
   * invoice has nothing left to project regardless of cadence, and saying so up front beats
   * the user wondering why the forecast did not change.
   */
  get recurrencePreview(): string {
    if (!this.isRecurring || !this.recurrencePeriodicity) return '';

    const step = { 'Monthly': 1, 'Quarterly': 3, 'Semi-annually': 6, 'Annually': 12 }
      [this.recurrencePeriodicity] ?? 0;
    if (!step) return '';

    const date = this.invoiceDate ? new Date(this.invoiceDate) : null;
    if (!date || isNaN(date.getTime())) {
      return 'Set the Invoice Date to see which months will be forecast.';
    }

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const year = date.getFullYear();
    const hits: string[] = [];
    for (let m = date.getMonth() + 1 + step; m <= 12; m += step) hits.push(months[m - 1]);

    return hits.length === 0
      ? `No further periods fall in ${year}, so nothing will be added to the forecast.`
      : `On save, ${hits.join(', ')} ${year} will be forecast at this line's amount `
        + `(only months not already forecast are filled).`;
  }

  /**
   * NEW REQUIREMENT: PAR is now a typable/searchable hierarchy-select with dummy data
   * so it can be auto-populated from existing Purchase Approval Requests.
   * The value selected/typed is written back into `par` (so the existing PAR validation
   * keeps working unchanged). The old free-text input is commented out in the template.
   */
  parGroups: SelectGroup[] = [
    {
      group: 'Infrastructure',
      items: [
        { value: 'PAR-2026-0001', label: 'PAR-2026-0001 — Cloud Hosting' },
        { value: 'PAR-2026-0002', label: 'PAR-2026-0002 — Network Refresh' },
        { value: 'PAR-2026-0003', label: 'PAR-2026-0003 — Data Centre' }
      ]
    },
    {
      group: 'Applications',
      items: [
        { value: 'PAR-2026-0101', label: 'PAR-2026-0101 — ERP Licensing' },
        { value: 'PAR-2026-0102', label: 'PAR-2026-0102 — SaaS Subscriptions' }
      ]
    },
    {
      group: 'Governance & Vendor',
      items: [
        { value: 'PAR-2026-0201', label: 'PAR-2026-0201 — Audit Services' },
        { value: 'PAR-2026-0202', label: 'PAR-2026-0202 — Vendor Management' }
      ]
    },
    {
      group: 'Model & Processes',
      items: [
        { value: 'PAR-2026-0301', label: 'PAR-2026-0301 — Process Consultancy' }
      ]
    }
  ];

  // Mandatory General fields that were previously unbound inputs.
  par = '';
  po = '';
  invNumber = '';

  /** Header-level FX rate (General section) applied to every line's amount. */
  exchangeRate: number | null = 1;

  /** Header invoice amount in the original invoice currency. */
  invAmount: number | null = null;

  /** Read-only header conversion: Inv Amount × FX Rate. Null until both present. */
  get invAmountSiteCurrency(): number | null {
    const amount = Number(this.invAmount);
    const fx = Number(this.exchangeRate);
    if (this.invAmount == null || isNaN(amount) || isNaN(fx)) return null;
    return amount * fx;
  }

  /**
   * Read-only line conversion: Amount (Inv Currency) × Header FX Rate.
   * Returns null until both inputs are present, so the field shows "—".
   * Recomputes automatically whenever the amount or the FX rate changes.
   */
  siteCurrencyAmount(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): number | null {
    const amount = Number(item.amountCurrency);
    const fx = Number(this.exchangeRate);
    if (item.amountCurrency == null || isNaN(amount) || isNaN(fx)) return null;
    return amount * fx;
  }

  /**
   * Live SAP Internal Order lookup, passed to the hierarchy-select. Arrow fn so
   * `this` stays bound when the child invokes it on each keystroke.
systemOptions: any;
   */
  searchInternalOrders = (query: string): Observable<SelectGroup[]> =>
    this.ioService.search(query);

  /** Set while a save request is in flight, to disable the Save button / show progress. */
  isSaving = false;

  // ─── Duplicate detection (Invoice Number + Supplier) ────────────────────────
  /**
   * The existing invoice matching the entered Invoice Number + Supplier, or null.
   * Purely advisory — nothing here blocks saving.
   */
  duplicateInvoice: InvoiceDetail | null = null;

  /**
   * True once the user picks "Update existing record": Save then PUTs over
   * `duplicateInvoice.id` instead of POSTing a new invoice.
   */
  overwriteExisting = false;

  /**
   * Visibility only — the detected duplicate itself stays in `duplicateInvoice` so Save can
   * bring the warning back. Reset whenever the key changes, and by Save.
   */
  duplicateDismissed = false;

  /**
   * Set once Save has shown the user a duplicate warning, so a second Save proceeds instead
   * of warning forever. Cleared whenever either half of the key changes.
   */
  private duplicateAcknowledged = false;

  /** What the banner actually renders: the duplicate unless the user has hidden it. */
  get visibleDuplicate(): InvoiceDetail | null {
    return this.duplicateDismissed ? null : this.duplicateInvoice;
  }

  /** Debounces the key so typing an invoice number doesn't fire a request per keystroke. */
  private readonly duplicateCheck$ = new Subject<void>();
  private readonly duplicateSub = new Subscription();

  /** Overridden by the Edit screen so it never flags the record it is editing. */
  protected get duplicateExcludeId(): number | undefined { return undefined; }

  /**
   * Save-time duplicate gate. Asks the server **at the moment Save is pressed** rather than
   * trusting the debounced background check, which closes the race where Save is clicked
   * inside the debounce window (or while the lookup is still in flight) and the record slips
   * through unwarned.
   *
   * On a hit it re-shows the banner and abandons this attempt; pressing Save again proceeds,
   * so the warning stays a confirmation and never a hard block. Skipped in overwrite mode,
   * where choosing "Update existing record" is already an acknowledgement.
   *
   * A failed lookup lets the save through — duplicate detection is an aid and must never
   * strand someone who needs to record an invoice.
   */
  protected guardDuplicateThen(proceed: () => void): void {
    const invNumber = (this.invNumber || '').trim();
    const supplier = (this.selectedSupplier || '').trim();

    if (this.overwriteExisting || this.duplicateAcknowledged || !invNumber || !supplier) {
      proceed();
      return;
    }

    this.isSaving = true;   // disables Save while the check runs
    this.invoiceService.findDuplicate(invNumber, supplier, this.duplicateExcludeId).subscribe({
      next: match => {
        this.isSaving = false;
        this.duplicateInvoice = match;

        if (!match) { proceed(); return; }

        this.duplicateDismissed = false;    // banner comes back even if it was dismissed
        this.duplicateAcknowledged = true;  // the next Save goes through
        this.snackbar.show(
          `Invoice ${match.invNumber} from ${match.supplier} already exists (ref #${match.id}). ` +
          `Review the warning above, then press Save again to continue.`,
          'warning',
          9000
        );
      },
      error: err => {
        this.isSaving = false;
        console.warn('Duplicate check before save failed', err);
        proceed();
      }
    });
  }

  /** Wired to the Invoice Number and Supplier fields in the template. */
  onDuplicateKeyChange(): void {
    // Editing either half of the key re-arms both the banner and the Save-time warning — a
    // dismissal or acknowledgement only ever applies to the pair that was on screen.
    this.duplicateDismissed = false;
    this.duplicateAcknowledged = false;
    this.duplicateCheck$.next();
  }

  /**
   * Looks for an existing invoice with the same number + supplier. Both halves are needed
   * before asking, and a failure is swallowed to a console warning — duplicate detection is
   * an aid, so a flaky lookup must never stop someone entering an invoice.
   */
  protected runDuplicateCheck(): void {
    const invNumber = (this.invNumber || '').trim();
    const supplier = (this.selectedSupplier || '').trim();

    if (!invNumber || !supplier) {
      this.duplicateInvoice = null;
      this.overwriteExisting = false;
      return;
    }

    this.invoiceService.findDuplicate(invNumber, supplier, this.duplicateExcludeId).subscribe({
      next: match => {
        this.duplicateInvoice = match;
        // A vanished duplicate must not leave the form pointed at a record to overwrite.
        if (!match) this.overwriteExisting = false;
      },
      error: err => {
        this.duplicateInvoice = null;
        this.overwriteExisting = false;
        console.warn('Duplicate invoice check failed', err);
      }
    });
  }

  /** Banner action: overwrite the existing record rather than create a second one. */
  onUseExistingInvoice(): void {
    if (!this.duplicateInvoice) return;
    this.overwriteExisting = true;
    this.snackbar.show(
      `Save will now update invoice ref #${this.duplicateInvoice.id} instead of creating a new one.`,
      'info'
    );
  }

  /**
   * Banner action. While overwriting, this backs out to normal create; otherwise it just
   * hides the banner. The duplicate itself is kept so pressing Save can surface it again.
   */
  onDismissDuplicate(): void {
    if (this.overwriteExisting) {
      this.overwriteExisting = false;
      return;
    }
    this.duplicateDismissed = true;
  }

  // ── Related Data panel (bottom of the screen) ────────────────────────────
  // Read-only context: actuals, forecast and cumulative variance for this invoice's
  // parameters. It fetches on its own from these inputs and writes nothing, so it cannot
  // affect the form, its validation or the save.

  @ViewChild(RelatedDataPanelComponent) protected relatedDataPanel?: RelatedDataPanelComponent;

  /**
   * Calendar year the panel reports on — the invoice's own posting year, since that is the
   * year the lines will post into. Sliced out of the ISO string rather than parsed through
   * `Date`, which would shift a day (and possibly a year, on 1 January) off UTC.
   */
  get relatedDataYear(): number {
    const year = Number((this.invoiceDate || '').slice(0, 4));
    return Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
  }

  /**
   * Invoice to keep OUT of the panel's Actuals row. Nothing on Upload — the record isn't
   * saved yet, so it cannot be in the actuals anyway. Edit overrides it with its own id so
   * both screens mean the same thing by "already posted".
   */
  get relatedDataExcludeId(): number | undefined { return undefined; }

  // `protected` (not private) so InvoiceEditComponent can extend this class and reuse the
  // whole form — validations, recharge maths, line handling — without duplicating it.
  constructor(
    protected sanitizer: DomSanitizer,
    protected snackbar: SnackbarService,
    protected ioService: InternalOrderService,
    protected invoiceService: InvoiceService,
    protected masterDataService: MasterDataService
  ) {}

  ngOnInit(): void {
    // Populate the change-history panel with invoices already saved in the backend.
    this.loadSavedHistory();
    this.loadDropdownData();
    this.startDuplicateWatch();
  }

  /** Subscribes the debounced duplicate lookup. Also used by the Edit screen. */
  protected startDuplicateWatch(): void {
    this.duplicateSub.add(
      this.duplicateCheck$.pipe(debounceTime(400)).subscribe(() => this.runDuplicateCheck())
    );
  }

  /** Turns a flat LookupItemDto[] into a single-group SelectGroup[], value = code (falls back to name). */
  protected static toSingleGroup(label: string, rows: LookupItemDto[], withCode = false): SelectGroup[] {
    if (rows.length === 0) return [];
    return [{
      group: label,
      items: rows.map(r => ({
        value: r.code ?? r.name,
        label: withCode && r.code ? `${r.code} – ${r.name}` : r.name
      }))
    }];
  }

  /** Loads every master-data-driven dropdown on this screen from the backend. */
  protected loadDropdownData(): void {
    this.masterDataService.getSuppliers().subscribe({
      next: rows => this.supplierGroups = InvoiceUploadComponent.toSingleGroup('Suppliers', rows),
      error: err => console.error('Failed to load suppliers', err)
    });

    this.masterDataService.getSites().subscribe({
      next: rows => {
        // Kept in full: `siteCurrency` resolves the processing site's currency code out of
        // this, and the grouped forms below throw everything except label + value away.
        this.sites = rows ?? [];
        // Only sites with a currency assigned can process an invoice (drives Site Currency AUTO).
        const processingSites = this.sites.filter(r => r.currencyId != null);
        this.siteGroups = InvoiceUploadComponent.toSingleGroup('Sites', processingSites);
        // Any site at all can be a recharge target.
        this.rechargeSiteGroups = InvoiceUploadComponent.toSingleGroup('All Sites', this.sites);
      },
      error: err => console.error('Failed to load sites', err)
    });

    this.masterDataService.getTeams().subscribe({
      next: rows => this.teamGroups = InvoiceUploadComponent.toSingleGroup('Teams', rows),
      error: err => console.error('Failed to load teams', err)
    });

    this.masterDataService.getCurrencies().subscribe({
      next: rows => this.currencyGroups = InvoiceUploadComponent.toSingleGroup('Currencies', rows, true),
      error: err => console.error('Failed to load currencies', err)
    });

    this.masterDataService.getAccounts().subscribe({
      next: (rows: AccountDto[]) => {
        this.accountGroups = rows.length === 0 ? [] : [{
          group: 'Accounts',
          items: rows.map(r => ({ value: r.code, label: `${r.code} – ${r.name}` }))
        }];
      },
      error: err => console.error('Failed to load accounts', err)
    });

    this.masterDataService.getCategories().subscribe({
      next: rows => this.spendCategories = rows.map(r => r.name),
      error: err => console.error('Failed to load categories', err)
    });

    this.masterDataService.getSpendTypes().subscribe({
      next: rows => this.spendTypeOptions = rows.map(r => r.name),
      error: err => console.error('Failed to load spend types', err)
    });

    this.masterDataService.getSpendLayers().subscribe({
      next: rows => this.spendLayerOptions = rows.map(r => r.name),
      error: err => console.error('Failed to load spend layers', err)
    });

    this.masterDataService.getSystems().subscribe({
      next: rows => this.systemOptions = rows.map(r => r.name),
      error: err => console.error('Failed to load systems', err)
    });
  }

  /**
   * Loads every saved invoice and its history from the backend and renders them
   * in the Invoice Change History panel. Called on init and after each save.
   * @param openWhenDone when true (after a save), pops the history panel open.
   */
  protected loadSavedHistory(openWhenDone = false): void {
    this.invoiceService.list().subscribe({
      next: res => {
        const items = res?.items ?? [];
        if (items.length === 0) {
          this.changeHistory = [];
          if (openWhenDone) { this.isHistoryOpen = true; }
          return;
        }
        forkJoin(
          items.map(it => this.invoiceService.getHistory(it.id).pipe(map(logs => ({ it, logs }))))
        ).subscribe({
          next: results => {
            const records: ChangeRecord[] = [];
            for (const { it, logs } of results) {
              const amount = Number(it.invAmount).toLocaleString(undefined, { minimumFractionDigits: 2 });
              const summary = `${(it.supplier || '').toUpperCase()} · ${it.currency} ${amount} · ${it.site}`;
              const events = (logs && logs.length)
                ? logs
                : [{ timestamp: it.createdUtc, user: 'system', changes: [{ field: 'Created', from: null, to: null }] }];
              for (const log of events) {
                records.push({
                  timestamp: new Date(log.timestamp),
                  user: log.user || 'system',
                  changes: [{
                    field: `Invoice ${it.invNumber}`,
                    from: (log.changes && log.changes[0]?.field) || 'Created',
                    to: summary
                  }]
                });
              }
            }
            this.changeHistory = records;
            if (openWhenDone) { this.isHistoryOpen = true; }
          },
          error: () => { if (openWhenDone) { this.isHistoryOpen = true; } }
        });
      },
      error: () => { /* backend unreachable — keep whatever is already shown */ }
    });
  }

  onBudgetedChange(checked: boolean): void {
    if (!checked) {
      this.snackbar.show(
        'Line flagged as unbudgeted — will appear separately in actuals & forecast tables.',
        'warning'
      );
    }
  }

  /**
   * Credit is easy to tick by accident and silently flips the sign of everything this
   * invoice contributes to actuals, so say so plainly when it goes on.
   */
  onCreditChange(checked: boolean): void {
    if (checked) {
      this.snackbar.show(
        'Marked as a credit note — enter the amount as a positive figure. It will be subtracted from actuals on the Forecast screen.',
        'warning',
        7000
      );
    }
  }

  /** Open while the "add another line" confirmation is showing. */
  addLineDialogOpen = false;

  get addLineDialogMessage(): string {
    // Without a header total there is no figure to quote — lines can be added before it is
    // filled, and "must add up to 0.00" would be nonsense.
    return this.invAmount == null
      ? 'The amounts across your line items must add up to the total invoice amount — not less.'
      : 'The amounts across your line items must add up to the total invoice amount of '
        + `${InvoiceUploadComponent.fmtMoney(Number(this.invAmount) || 0)} — not less.`;
  }

  /** True when adding a line would change the meaning of, or discard, an amount already entered. */
  private get addLineAffectsAmounts(): boolean {
    return this.invAmount != null || this.lineItems.some(i => i.amountCurrency != null);
  }

  /**
   * Asks before adding a line, because adding one changes what the EXISTING amounts mean:
   * a single line carries the whole invoice, several lines have to be split between them.
   *
   * Skipped while nothing is at stake — no header total and no line amount anywhere. Lines can
   * legitimately be laid out before any figures are entered, and confirming each one of those
   * would be friction warning about a split that does not exist yet.
   */
  askAddLineItem(): void {
    if (!this.addLineAffectsAmounts) {
      this.addNewLineItem();
      return;
    }
    this.addLineDialogOpen = true;
  }

  cancelAddLineItem(): void {
    this.addLineDialogOpen = false;
  }

  confirmAddLineItem(): void {
    this.addLineDialogOpen = false;
    this.addNewLineItem();
  }

  addNewLineItem(): void {
    // Clear an amount that was filled from the header rather than typed. It was only ever
    // right because there was one line; with two it would claim the whole invoice for the
    // first and leave the tracker permanently over-allocated. A typed amount is left alone —
    // that is the user's number, not ours.
    for (const item of this.lineItems) {
      if (item.amountAutoFilled) {
        item.amountCurrency = null;
        item.amountAutoFilled = false;
      }
    }
    this.lineItems.push(this.blankLineItem(this.nextLineNumber()));
  }

  /**
   * Header total changed. With exactly one line, that line IS the invoice, so mirror the
   * amount into it — otherwise the user types the same figure twice on every single-line
   * invoice, which is most of them.
   *
   * Only ever overwrites a blank or previously auto-filled amount; a figure the user typed
   * themselves is never touched.
   */
  onInvAmountChange(): void {
    if (this.lineItems.length !== 1) return;

    const only = this.lineItems[0];
    if (only.amountCurrency != null && !only.amountAutoFilled) return;

    if (this.invAmount == null) {
      // Header cleared — take the mirrored value back with it, but leave a typed one.
      if (only.amountAutoFilled) {
        only.amountCurrency = null;
        only.amountAutoFilled = false;
      }
      return;
    }

    only.amountCurrency = Number(this.invAmount);
    only.amountAutoFilled = true;
  }

  /** Typing in a line's amount makes it the user's own, so it stops being auto-managed. */
  onLineAmountChange(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): void {
    item.amountAutoFilled = false;
  }

  /**
   * Line amounts can't be entered before the header total exists — there would be nothing to
   * allocate against, and the tracker would have no denominator.
   */
  get lineAmountsLocked(): boolean {
    return this.invAmount == null;
  }

  get lineAmountLockReason(): string {
    return this.lineAmountsLocked
      ? 'Fill the Total Invoice Amount in the General section first.'
      : '';
  }

  /**
   * Recharge % and Direct Recharge To are mutually exclusive *on the same line*.
   * Turning the toggle on clears any Direct Recharge target for that line.
   * (Different lines of the same invoice may each use either method.)
   */
  onRechargeToggleChange(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): void {
    if (item.recharge) {
      item.rechargeTo = '';
    }
  }

  /** Selecting a Direct Recharge target switches off Recharge % for that line. */
  onDirectRechargeChange(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): void {
    if (item.rechargeTo) {
      item.recharge = false;
    }
  }

  /** Lines flagged with Recharge % ON — each gets its own independent recharge panel. */
  get rechargeLines(): ReturnType<InvoiceUploadComponent['blankLineItem']>[] {
    return this.lineItems.filter(i => i.recharge);
  }

  /**
   * Add a recharge target site to a line. Any site from the org hierarchy is allowed.
   * Called on dropdown selection; resets the picker and redistributes evenly.
   */
  addRechargeSite(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, site: string): void {
    const label = (site || '').trim();
    if (!label) return;
    if (item.rechargeSites.some(a => a.site === label)) {
      this.snackbar.show(`${label} is already in this line's recharge.`, 'warning');
    } else {
      item.rechargeSites.push({ site: label, mode: 'pct', pct: 0, amount: null });
      this.spreadRechargeEvenly(item);
    }
    item.rechargeSitePicker = '';
    item.sitePickerOpen = false;
  }

  removeRechargeSite(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, index: number): void {
    item.rechargeSites.splice(index, 1);
    this.spreadRechargeEvenly(item);
  }

  /** Even-split the allocation across all selected sites as percentages, exact to 100%. */
  spreadRechargeEvenly(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): void {
    const n = item.rechargeSites.length;
    if (n === 0) return;
    const base = Math.floor((100 / n) * 100) / 100;
    let running = 0;
    item.rechargeSites.forEach((a, idx) => {
      a.mode = 'pct';
      a.amount = null;
      if (idx === n - 1) {
        a.pct = +(100 - running).toFixed(2);
      } else {
        a.pct = base;
        running += base;
      }
    });
  }

  // ─── Per-row entry: either an amount OR a percentage (not both) ───
  onAmountEntry(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, alloc: RechargeAllocation, value: any): void {
    alloc.amount = value === '' || value === null || value === undefined ? null : Number(value);
    alloc.mode = 'amount';
  }

  onPctEntry(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, alloc: RechargeAllocation, value: any, model?: NgModel): void {
    let num = value === '' || value === null || value === undefined ? null : Number(value);
    let clamped = false;
    if (num !== null) {
      if (num > 100) {
        num = 100;
        clamped = true;
        this.snackbar.show('Recharge percentage cannot exceed 100%.', 'warning');
      } else if (num < 0) {
        num = 0;
        clamped = true;
      }
    }
    alloc.pct = num;
    alloc.mode = 'pct';
    // Force the input to reflect the clamped value even if the model value is unchanged.
    if (clamped && model) {
      model.control.setValue(num);
    }
  }

  // ─── Header total vs line items ────────────────────────────────────────────
  //
  // "Inv Amount" (General) is the total on the invoice document; each line's "Amount Inv
  // Currency" is that line's share of it. Nothing reconciled the two, so an invoice could be
  // saved with money allocated nowhere — the header said 12,000, the lines added to 10,500,
  // and the 1,500 difference simply vanished. Forecast actuals and recharges are all computed
  // from the LINE amounts, so the shortfall never showed up anywhere downstream either.

  /**
   * Whether a mismatch BLOCKS the save or only warns.
   *
   * **Blocks** — the same rule the recharge panel enforces one level down, and for the same
   * reason: there is no account absorbing a delta, so an unbalanced invoice leaves spend
   * allocated nowhere. The allocation tracker makes the shortfall visible while typing, so
   * being stopped at Save should never be a surprise.
   *
   * ⚠️ This makes an invoice whose header includes VAT against net lines unsaveable. If that
   * turns out to be a real Crown case, set this back to `false` — `passesSaveValidation`
   * still implements both paths — rather than weakening the check.
   */
  private static readonly BLOCK_ON_UNRECONCILED = true;

  /** Rounding tolerance, matching the recharge balance guard. */
  private static readonly RECONCILE_EPSILON = 0.005;

  /** Σ of every line's Amount (Inv Currency). */
  get lineItemsTotal(): number {
    return this.lineItems.reduce((sum, i) => sum + (Number(i.amountCurrency) || 0), 0);
  }

  /** Header total − Σ lines. Positive = under-allocated, negative = over-allocated. */
  get invoiceReconcileDelta(): number {
    return (Number(this.invAmount) || 0) - this.lineItemsTotal;
  }

  /**
   * True once the lines account for the header exactly.
   *
   * False while the header is empty — there is nothing to reconcile against yet, and the
   * indicator stays hidden in that case rather than shouting at a half-filled form.
   */
  get isInvoiceReconciled(): boolean {
    if (this.invAmount == null) return false;
    return Math.abs(this.invoiceReconcileDelta) < InvoiceUploadComponent.RECONCILE_EPSILON;
  }

  /** Only worth showing once there is a header amount to measure against. */
  get showReconcileIndicator(): boolean {
    return this.invAmount != null && this.lineItems.length > 0;
  }

  /**
   * Share of the header total the lines account for. Mirrors the recharge panel's
   * "Total Allocation 98.62% · 22.68" readout so the two trackers read the same way.
   *
   * Zero header means zero allocated rather than a division by zero — with no total to
   * allocate against, no percentage of it is meaningful.
   */
  get lineAllocationPct(): number {
    const total = Number(this.invAmount) || 0;
    return total === 0 ? 0 : (this.lineItemsTotal / total) * 100;
  }

  /** The line amount being distributed (site currency). */
  protected rechargeLineTotal(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): number {
    return this.siteCurrencyAmount(item) ?? 0;
  }

  /** Effective money for a site: entered amount, or % of the line total. */
  effectiveAmount(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, alloc: RechargeAllocation): number {
    if (alloc.mode === 'amount') return Number(alloc.amount) || 0;
    return this.rechargeLineTotal(item) * (Number(alloc.pct) || 0) / 100;
  }

  /** Effective percentage for a site: entered %, or amount ÷ line total. */
  effectivePct(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, alloc: RechargeAllocation): number {
    if (alloc.mode === 'pct') return Number(alloc.pct) || 0;
    const total = this.rechargeLineTotal(item);
    return total > 0 ? (Number(alloc.amount) || 0) / total * 100 : 0;
  }

  /** Value shown in the amount cell — raw when entered, derived (2dp) otherwise. */
  displayAmount(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, alloc: RechargeAllocation): number | null {
    if (alloc.mode === 'amount') return alloc.amount;
    return +this.effectiveAmount(item, alloc).toFixed(2);
  }

  /** Value shown in the % cell — raw when entered, derived (2dp) otherwise. */
  displayPct(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, alloc: RechargeAllocation): number | null {
    if (alloc.mode === 'pct') return alloc.pct;
    return +this.effectivePct(item, alloc).toFixed(2);
  }

  rechargeAllocatedAmount(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): number {
    return item.rechargeSites.reduce((sum, a) => sum + this.effectiveAmount(item, a), 0);
  }

  /**
   * Percentage for a message: 2dp at most, with trailing zeros dropped — "85", not "85.00",
   * and "33.33" kept. Re-parsing the fixed string is what strips them.
   */
  private static fmtPct(value: number): string {
    return String(Number(value.toFixed(2)));
  }

  rechargeTotalPct(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): number {
    return item.rechargeSites.reduce((sum, a) => sum + this.effectivePct(item, a), 0);
  }

  /** Delta = line amount − Σ site recharge amounts. Must be 0 to save. */
  rechargeDelta(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): number {
    return this.rechargeLineTotal(item) - this.rechargeAllocatedAmount(item);
  }

  /** At least one site must carry a value (amount or %). */
  rechargeHasValue(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): boolean {
    return item.rechargeSites.some(a =>
      a.mode === 'amount' ? (Number(a.amount) || 0) > 0 : (Number(a.pct) || 0) > 0
    );
  }

  rechargeIsBalanced(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): boolean {
    if (item.rechargeSites.length === 0 || !this.rechargeHasValue(item)) return false;
    return Math.abs(this.rechargeDelta(item)) < 0.005;
  }

  /** Collects the labels of all mandatory (*) fields the user hasn't filled. */
  protected missingMandatoryFields(): string[] {
    const missing: string[] = [];

    if (!this.selectedSupplier) missing.push('Supplier');
    if (!this.par.trim()) missing.push('PAR');
    if (!this.po.trim()) missing.push('PO');
    if (!this.selectedSite) missing.push('Site');
    if (!this.selectedTeam) missing.push('Team');
    if (!this.selectedCurrency) missing.push('Currency');
    if (!this.accountingDate) missing.push('Accounting Date');
    if (this.invAmount === null || this.invAmount === undefined) missing.push('Inv Amount');
    if (!this.invNumber.trim()) missing.push('Inv Number');
    if (!this.invoiceDate) missing.push('Invoice Date');

    this.lineItems.forEach(item => {
      const label = `Line ${item.line}`;
      if (!item.account) missing.push(`${label}: Account`);
      if (!item.internalOrder) missing.push(`${label}: Internal Order`);
      if (item.amountCurrency === null || item.amountCurrency === undefined) {
        missing.push(`${label}: Amount Inv Currency`);
      }
    });

    return missing;
  }

  /** Save guard — blocks on missing mandatory fields, then on recharge delta ≠ 0. */
  onSave(): void {
    if (!this.passesSaveValidation()) return;
    this.guardDuplicateThen(() => this.persistSave());
  }

  /** The mandatory-field and recharge-balance guards, shared with the Edit screen. */
  protected passesSaveValidation(): boolean {
    const missing = this.missingMandatoryFields();
    if (missing.length > 0) {
      this.snackbar.show(
        `Cannot save — please fill the required field(s): ${missing.join(', ')}.`,
        'error',
        8000
      );
      return false;
    }

    // Jennifer, Discovery: an invoice must not save while any line's recharge is short of
    // 100% — there is no Recharge Account absorbing the delta, so an unbalanced line would
    // leave part of the cost allocated nowhere.
    const unbalanced = this.lineItems.filter(i => i.recharge && !this.rechargeIsBalanced(i));
    if (unbalanced.length > 0) {
      // States the percentage actually reached, per line. "Adjust Line 2" alone left the user
      // to work out how far off they were, which is the one number they need.
      const detail = unbalanced
        .map(i => `Line ${i.line} is at ${InvoiceUploadComponent.fmtPct(this.rechargeTotalPct(i))}%`)
        .join(', ');
      this.snackbar.show(
        `Cannot save — recharge allocation: ${detail}. Must be 100% before saving.`,
        'error',
        8000
      );
      return false;
    }

    // "Recurring: Yes" with no cadence would store a recurrence the projection can't act on,
    // so it is caught here rather than silently doing nothing at save time.
    if (this.recurrenceIncomplete) {
      this.snackbar.show(
        'Cannot save — choose how often this invoice recurs, or set Recurring to No.',
        'error',
        8000
      );
      return false;
    }

    // Header total vs the sum of its lines. Advisory by default — see BLOCK_ON_UNRECONCILED.
    if (this.showReconcileIndicator && !this.isInvoiceReconciled) {
      const delta = this.invoiceReconcileDelta;
      const word = delta > 0 ? 'unallocated' : 'over-allocated by';
      const message =
        `Line items total ${InvoiceUploadComponent.fmtMoney(this.lineItemsTotal)} against an `
        + `invoice amount of ${InvoiceUploadComponent.fmtMoney(Number(this.invAmount) || 0)} — `
        + `${InvoiceUploadComponent.fmtMoney(Math.abs(delta))} ${word}.`;

      if (InvoiceUploadComponent.BLOCK_ON_UNRECONCILED) {
        this.snackbar.show(`Cannot save — ${message}`, 'error', 8000);
        return false;
      }
      // Warning, and the save continues: the caller ignores this branch's return value.
      this.snackbar.show(message, 'warning', 8000);
    }

    return true;
  }

  /** Thousands-separated, 2dp — for messages, where the `number` pipe isn't available. */
  private static fmtMoney(value: number): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private persistSave(): void {
    // Persist to the Cost Center backend, then attach the PDF against the new invoice id.
    // A failed upload does NOT fail the save — the invoice is already stored, so report it
    // separately rather than making the user re-enter everything.
    this.isSaving = true;
    const file = this.selectedFile;
    // Overwrite mode (chosen from the duplicate banner) PUTs over the existing record;
    // otherwise this is an ordinary create. Default behaviour is unchanged.
    const overwriteId = this.overwriteExisting ? this.duplicateInvoice?.id : undefined;
    const request$ = overwriteId != null
      ? this.invoiceService.update(overwriteId, this.buildPayload())
      : this.invoiceService.save(this.buildPayload());

    request$.pipe(
      switchMap(result => {
        if (!file) return of({ result, uploadError: null as string | null });
        return this.invoiceService.uploadPdf(result.id, file).pipe(
          map(() => ({ result, uploadError: null as string | null })),
          catchError(err => of({
            result,
            uploadError: err?.error?.error ?? err?.error ?? err?.message ?? 'Unknown error'
          }))
        );
      })
    ).subscribe({
      next: ({ result, uploadError }) => {
        this.isSaving = false;
        const verb = overwriteId != null ? 'updated' : 'saved';
        if (uploadError) {
          this.snackbar.show(
            `Invoice ${verb} (ref #${result.id}) but the PDF failed to upload — ${uploadError}`,
            'warning',
            8000
          );
        } else {
          const suffix = file ? ' with PDF attached' : '';
          this.snackbar.show(`Invoice ${verb} (ref #${result.id})${suffix}.`, 'success');
        }
        // The record now matches what's on screen, so the overwrite offer is spent.
        this.overwriteExisting = false;
        this.loadSavedHistory(true);   // refresh + open the change-history panel
        // The invoice just posted, so it now belongs in the panel's Actuals row.
        this.relatedDataPanel?.refresh();
      },
      error: err => {
        this.isSaving = false;
        const detail = err?.error?.error ?? err?.message ?? 'Unknown error';
        this.snackbar.show(`Save failed — ${detail}`, 'error', 8000);
      }
    });
  }

  /** Assembles the current screen state into the backend invoice payload. */
  protected buildPayload(): InvoicePayload {
    return {
      supplier: this.selectedSupplier,
      par: this.par,
      po: this.po,
      invNumber: this.invNumber,
      site: this.selectedSite,
      team: this.selectedTeam,
      currency: this.selectedCurrency,
      exchangeRate: this.exchangeRate,
      invAmount: this.invAmount,
      invoiceDate: this.invoiceDate,
      accountingDate: this.accountingDate,
      isBudgeted: this.isBudgeted,
      isCredit: this.isCredit,
      isRecurring: this.isRecurring,
      // Null rather than '' when not recurring — the column is nullable and the backend
      // normalises anyway, but sending '' would store a meaningless empty periodicity.
      recurrencePeriodicity: this.isRecurring ? (this.recurrencePeriodicity || null) : null,
      fileName: this.uploadedFileName,
      lastUpdatedBy: this.autoStamp.user,   // audit standard — login of the user saving
      lineItems: this.lineItems.map(i => ({
        line: Number(i.line) || 0,
        account: i.account,
        periodStart: i.periodStart || null,
        periodEnd: i.periodEnd || null,
        internalOrder: i.internalOrder,
        spendType: i.spendType,
        speedType: i.speedType,
        spendLayer: i.spendLayer,
        category: i.category,
        system: i.system,
        description: i.description,
        amountCurrency: i.amountCurrency,
        rechargeTo: i.rechargeTo,
        recharge: i.recharge,
        rechargeSites: i.rechargeSites.map(a => ({
          site: a.site,
          mode: a.mode,
          pct: a.pct,
          amount: a.amount
        }))
      }))
    };
  }

  /** Warn if a user-overridden line number collides with another line in this invoice. */
  onLineNumberChange(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): void {
    const duplicate = this.lineItems.some(other => other !== item && Number(other.line) === Number(item.line));
    if (duplicate) {
      this.snackbar.show(`Line ${item.line} is already used on this invoice — line numbers must be unique.`, 'warning');
    }
  }

  onPeriodEndChange(item: ReturnType<InvoiceUploadComponent['blankLineItem']>, endDate: string): void {
    if (endDate && item.periodStart && endDate < item.periodStart) {
      this.snackbar.show('Period End cannot be before Period Start.', 'warning');
    }
  }

  removeLineItem(index: number): void {
    if (this.lineItems.length > 1) {
      this.lineItems.splice(index, 1);
    }
  }


  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(): void {
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) {
      this.handleFile(file);
    }
  }

  onFileSelect(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.handleFile(file);
    }
  }

  protected handleFile(file: File): void {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      this.revokeUrl();
      this.uploadedFileName = file.name;
      // Keep the File itself, not just its name — onSave POSTs it to /invoices/{id}/upload
      // once the invoice has an id. The object URL below only drives the on-screen preview.
      this.selectedFile = file;
      this.objectUrl = URL.createObjectURL(file);
      this.uploadedFileUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
    } else {
      alert('Only PDF files are accepted.');
    }
  }

  removeFile(): void {
    this.uploadedFileName = null;
    this.uploadedFileUrl = null;
    this.selectedFile = null;
    this.revokeUrl();
  }

  protected revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  toggleSidebar(): void {
    this.isPreviewCollapsed = !this.isPreviewCollapsed;
  }

  togglePdfPreview(): void {
    this.isPdfPreviewCollapsed = !this.isPdfPreviewCollapsed;
  }

  ngOnDestroy(): void {
    this.revokeUrl();
    this.duplicateSub.unsubscribe();
  }
}

