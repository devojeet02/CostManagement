import { Component, OnDestroy } from '@angular/core';
import { NgModel } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { SelectGroup } from '../../features/hierarchy-select/hierarchy-select.component';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { InternalOrderService } from '../../services/internal-order.service';

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
  selector: 'app-invoice-upload',
  templateUrl: './invoice-upload.component.html',
  styleUrls: ['./invoice-upload.component.scss']
})
export class InvoiceUploadComponent implements OnDestroy {
  months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  selectedSite = '';

  accountGroups: SelectGroup[] = [
    {
      group: 'OpEx',
      items: [
        { value: 'gl-6100', label: 'GL 6100 – Software Licences' },
        { value: 'gl-6200', label: 'GL 6200 – Cloud Services' },
        { value: 'gl-6300', label: 'GL 6300 – Professional Services' },
        { value: 'gl-6400', label: 'GL 6400 – Maintenance & Support' },
        { value: 'gl-6500', label: 'GL 6500 – Telecoms & Connectivity' }
      ]
    },
    {
      group: 'CapEx',
      items: [
        { value: 'gl-7100', label: 'GL 7100 – Hardware' },
        { value: 'gl-7200', label: 'GL 7200 – Infrastructure Investment' },
        { value: 'gl-7300', label: 'GL 7300 – Software Development' }
      ]
    }
  ];

  /** Standard spend categories — consistent across all four EISS teams. */
  spendCategories = [
    'IT Subscriptions',
    'IT Outsource Services',
    'Software Maintenance',
    'Software Licensing',
    'IT Consultancy',
    'Project Costs'
  ];

  selectedSupplier = '';

  supplierGroups: SelectGroup[] = [
    {
      group: 'Cloud & Infrastructure',
      items: [
        { value: 'aws', label: 'AWS' },
        { value: 'google-cloud', label: 'Google Cloud' },
        { value: 'msft-azure', label: 'MSFT Azure' }
      ]
    },
    {
      group: 'Software & Licensing',
      items: [
        { value: 'microsoft', label: 'Microsoft' },
        { value: 'oracle', label: 'Oracle' },
        { value: 'sap', label: 'SAP' }
      ]
    },
    {
      group: 'Consulting & Services',
      items: [
        { value: 'deloitte', label: 'Deloitte' },
        { value: 'accenture', label: 'Accenture' }
      ]
    }
  ];

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

  selectedCurrency = '';

  currencyGroups: SelectGroup[] = [
    {
      group: 'Primary',
      items: [
        { value: 'GBP', label: 'GBP – British Pound' },
        { value: 'USD', label: 'USD – US Dollar' }
      ]
    },
    {
      group: 'Common',
      items: [
        { value: 'EUR', label: 'EUR – Euro' },
        { value: 'AUD', label: 'AUD – Australian Dollar' },
        { value: 'CAD', label: 'CAD – Canadian Dollar' },
        { value: 'CHF', label: 'CHF – Swiss Franc' },
        { value: 'JPY', label: 'JPY – Japanese Yen' },
        { value: 'SEK', label: 'SEK – Swedish Krona' },
        { value: 'NOK', label: 'NOK – Norwegian Krone' },
        { value: 'DKK', label: 'DKK – Danish Krone' }
      ]
    }
  ];

  selectedTeam = '';

  teamGroups: SelectGroup[] = [
    {
      group: 'EISS',
      items: [
        { value: 'infrastructure', label: 'Infrastructure' },
        { value: 'applications', label: 'Applications' },
        { value: 'governance-vendor', label: 'Governance & Vendor' },
        { value: 'model-processes', label: 'Model & Processes' }
      ]
    }
  ];

  siteGroups: SelectGroup[] = [
    {
      group: 'Europe',
      items: [
        { value: 'uk', label: 'UK' },
        { value: 'netherlands', label: 'the Netherlands' },
        { value: 'france', label: 'France' }
      ]
    },
    {
      group: 'Americas',
      items: [
        { value: 'usa', label: 'USA' }
      ]
    }
  ];

  /**
   * Full org-hierarchy site catalogue for recharge — *any* site in the system can be
   * a recharge target, not just the current invoice's site.
   */
  rechargeSiteGroups: SelectGroup[] = [
    {
      group: 'UK & Ireland',
      items: [
        { value: 'london-hq', label: 'London HQ' },
        { value: 'shipley', label: 'Shipley' },
        { value: 'bradford', label: 'Bradford' },
        { value: 'manchester', label: 'Manchester' },
        { value: 'dublin', label: 'Dublin' }
      ]
    },
    {
      group: 'Europe',
      items: [
        { value: 'amsterdam', label: 'Amsterdam' },
        { value: 'paris', label: 'Paris' },
        { value: 'madrid', label: 'Madrid' },
        { value: 'barcelona', label: 'Barcelona' },
        { value: 'istanbul', label: 'Istanbul' }
      ]
    },
    {
      group: 'Americas',
      items: [
        { value: 'new-york', label: 'New York' },
        { value: 'connecticut', label: 'Connecticut (CT)' },
        { value: 'toronto', label: 'Toronto' }
      ]
    },
    {
      group: 'APAC',
      items: [
        { value: 'singapore', label: 'Singapore' },
        { value: 'sydney', label: 'Sydney' }
      ]
    }
  ];

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
  private objectUrl: string | null = null;

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

  get siteCurrency(): string {
    const map: Record<string, string> = {
      'UK': 'GBP',
      'the Netherlands': 'EUR',
      'France': 'EUR',
      'USA': 'USD'
    };
    return map[this.selectedSite] || '';
  }

  get sortedHistory(): ChangeRecord[] {
    return [...this.changeHistory].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private static defaultPeriodStart(): string {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  private static defaultPeriodEnd(): string {
    const d = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private blankLineItem(line: number) {
    return {
      line,
      account: '',
      periodStart: InvoiceUploadComponent.defaultPeriodStart(),
      periodEnd: InvoiceUploadComponent.defaultPeriodEnd(),
      internalOrder: '', spendType: '', speedType: '',
      category: '', system: '', lineData: '', description: '',
      amountCurrency: null, rechargeTo: '', recharge: false, amountSiteCurrency: null,
      rechargeSites: [] as RechargeAllocation[], rechargeSitePicker: '', sitePickerOpen: false
    };
  }

  /** Next line number for this invoice: one above the highest existing line. */
  private nextLineNumber(): number {
    if (this.lineItems.length === 0) return 1;
    return Math.max(...this.lineItems.map(i => Number(i.line) || 0)) + 1;
  }

  // First line of every invoice starts at 1; numbering is scoped to this invoice only.
  lineItems = [this.blankLineItem(1)];

  isBudgeted = true;

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
   */
  searchInternalOrders = (query: string): Observable<SelectGroup[]> =>
    this.ioService.search(query);

  constructor(
    private sanitizer: DomSanitizer,
    private snackbar: SnackbarService,
    private ioService: InternalOrderService
  ) {}

  onBudgetedChange(checked: boolean): void {
    if (!checked) {
      this.snackbar.show(
        'Line flagged as unbudgeted — will appear separately in actuals & forecast tables.',
        'warning'
      );
    }
  }

  addNewLineItem(): void {
    this.lineItems.push(this.blankLineItem(this.nextLineNumber()));
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

  /** The line amount being distributed (site currency). */
  private rechargeLineTotal(item: ReturnType<InvoiceUploadComponent['blankLineItem']>): number {
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
  private missingMandatoryFields(): string[] {
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
    const missing = this.missingMandatoryFields();
    if (missing.length > 0) {
      this.snackbar.show(
        `Cannot save — please fill the required field(s): ${missing.join(', ')}.`,
        'error',
        8000
      );
      return;
    }

    const unbalanced = this.lineItems.filter(i => i.recharge && !this.rechargeIsBalanced(i));
    if (unbalanced.length > 0) {
      const lines = unbalanced.map(i => `Line ${i.line}`).join(', ');
      this.snackbar.show(
        `Cannot save — recharge must total 100% (delta = 0). Adjust ${lines}.`,
        'error'
      );
      return;
    }
    this.snackbar.show('Invoice saved.', 'success');
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

  private handleFile(file: File): void {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      this.revokeUrl();
      this.uploadedFileName = file.name;
      this.objectUrl = URL.createObjectURL(file);
      this.uploadedFileUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
    } else {
      alert('Only PDF files are accepted.');
    }
  }

  removeFile(): void {
    this.uploadedFileName = null;
    this.uploadedFileUrl = null;
    this.revokeUrl();
  }

  private revokeUrl(): void {
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
  }
}

