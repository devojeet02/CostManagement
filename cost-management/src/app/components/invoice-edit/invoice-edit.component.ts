import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';

import { InvoiceUploadComponent } from '../invoice-upload/invoice-upload.component';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { InternalOrderService } from '../../services/internal-order.service';
import { InvoiceService, InvoiceDetail } from '../../services/invoice.service';
import { MasterDataService } from '../../services/master-data.service';

/**
 * Edit Invoice — the Invoice Upload form, prefilled from an existing invoice and saved with
 * PUT instead of POST.
 *
 * It **extends** InvoiceUploadComponent rather than copying it. Every mandatory-field check,
 * recharge balance rule, line-number collision warning and period-date guard is literally the
 * same code, so the two screens cannot drift apart — a validation added to Upload is a
 * validation Edit gets for free. Only what genuinely differs is overridden here: loading the
 * invoice on init, and saving via update() then routing back to the list.
 *
 * The template is its own file (different header, load/error states); the styles are the
 * Upload screen's stylesheet plus a small edit-only sheet, so the two look identical.
 */
@Component({
  selector: 'cm-invoice-edit',
  templateUrl: './invoice-edit.component.html',
  styleUrls: [
    '../invoice-upload/invoice-upload.component.scss',
    './invoice-edit.component.scss'
  ]
})
export class InvoiceEditComponent extends InvoiceUploadComponent implements OnInit {

  /** Invoice being edited, from the :id route param. */
  invoiceId!: number;

  isLoading = true;
  /** Message when the invoice can't be fetched; null while things are fine. */
  loadError: string | null = null;

  /** Name of the PDF already attached server-side, so the UI can say so before any re-pick. */
  existingFileName: string | null = null;

  constructor(
    sanitizer: DomSanitizer,
    snackbar: SnackbarService,
    ioService: InternalOrderService,
    invoiceService: InvoiceService,
    masterDataService: MasterDataService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    super(sanitizer, snackbar, ioService, invoiceService, masterDataService);
  }

  /** Never flag the invoice this screen is editing as a duplicate of itself. */
  protected override get duplicateExcludeId(): number | undefined {
    return this.invoiceId;
  }

  /**
   * Keep this invoice out of the Related Data panel's Actuals row.
   *
   * The panel exists to show what has ALREADY been posted against these parameters, so that
   * the figures on screen can be judged against it. On Upload the record doesn't exist yet;
   * here it does, and counting it would make the panel partly a mirror of the form above.
   */
  override get relatedDataExcludeId(): number | undefined {
    return this.invoiceId;
  }

  override ngOnInit(): void {
    // Dropdown catalogues only. The parent's ngOnInit also calls loadSavedHistory(), which
    // pulls every invoice + its history to fill the Upload screen's panel — pointless here
    // and a lot of requests, so this deliberately does not call super.ngOnInit().
    this.loadDropdownData();
    this.startDuplicateWatch();

    this.route.paramMap.subscribe(params => {
      const raw = params.get('id');
      const id = Number(raw);
      if (!raw || !Number.isFinite(id) || id <= 0) {
        this.isLoading = false;
        this.loadError = 'No valid invoice was specified.';
        return;
      }
      this.invoiceId = id;
      this.reload();
    });
  }

  /** Fetch (or re-fetch) the invoice and populate the form. */
  reload(): void {
    this.isLoading = true;
    this.loadError = null;

    this.invoiceService.get(this.invoiceId).subscribe({
      next: invoice => {
        this.applyInvoice(invoice);
        this.isLoading = false;
      },
      error: err => {
        this.isLoading = false;
        this.loadError = err?.status === 404
          ? `Invoice ${this.invoiceId} no longer exists.`
          : 'Could not load this invoice.';
        console.error('Failed to load invoice', err);
      }
    });
  }

  /**
   * Maps the fetched invoice onto the inherited form fields.
   *
   * Dates arrive as ISO date-times but cm-date-picker and the payload both work in
   * `yyyy-MM-dd`, so they are trimmed here rather than round-tripped through Date (which
   * would shift the day for anyone east/west of UTC).
   */
  private applyInvoice(invoice: InvoiceDetail): void {
    this.selectedSupplier = invoice.supplier ?? '';
    this.par = invoice.par ?? '';
    this.po = invoice.po ?? '';
    this.invNumber = invoice.invNumber ?? '';
    this.selectedSite = invoice.site ?? '';
    this.selectedTeam = invoice.team ?? '';
    this.selectedCurrency = invoice.currency ?? '';
    this.exchangeRate = invoice.exchangeRate ?? 1;
    this.invAmount = invoice.invAmount ?? null;
    this.invoiceDate = this.toDateInput(invoice.invoiceDate);
    this.accountingDate = this.toDateInput(invoice.accountingDate);
    this.isBudgeted = invoice.isBudgeted ?? true;
    // Defaults to false when the backend omits it, matching "Credit toggle OFF by default".
    this.isCredit = invoice.isCredit ?? false;
    this.isRecurring = invoice.isRecurring ?? false;
    // '' not null — the radios bind to a string, and null would leave none selected while
    // isRecurring said Yes.
    this.recurrencePeriodicity = invoice.recurrencePeriodicity ?? '';

    // The stored PDF stays attached unless the user picks a new one; only its name is known
    // here, so this is a label, not a File. uploadedFileName also feeds buildPayload().
    this.existingFileName = invoice.fileName ?? null;
    this.uploadedFileName = invoice.fileName ?? null;

    const lines = invoice.lineItems ?? [];
    this.lineItems = lines.length
      ? lines.map((l, idx) => {
          // Start from a blank line so every UI-only field (sitePickerOpen, rechargeSitePicker,
          // lineData) exists with the shape the template expects.
          const item = this.blankLineItem(l.line || idx + 1);
          item.account = l.account ?? '';
          item.periodStart = this.toDateInput(l.periodStart);
          item.periodEnd = this.toDateInput(l.periodEnd);
          item.internalOrder = l.internalOrder ?? '';
          item.spendType = l.spendType ?? '';
          item.speedType = l.speedType ?? '';
          item.spendLayer = l.spendLayer ?? '';
          item.category = l.category ?? '';
          item.system = l.system ?? '';
          item.description = l.description ?? '';
          item.amountCurrency = l.amountCurrency ?? null;
          item.rechargeTo = l.rechargeTo ?? '';
          item.recharge = !!l.recharge;
          item.rechargeSites = (l.rechargeSites ?? []).map(a => ({
            site: a.site,
            mode: (a.mode === 'amount' ? 'amount' : 'pct') as 'pct' | 'amount',
            pct: a.pct ?? null,
            amount: a.amount ?? null
          }));
          return item;
        })
      : [this.blankLineItem(1)];

    // Assigning the model in code does not emit ngModelChange, so the key fields being
    // populated here would otherwise never trigger a check. Run it once on load so a genuine
    // clash with a *different* invoice surfaces immediately (self is excluded by id).
    this.onDuplicateKeyChange();
  }

  /** ISO date / date-time → `yyyy-MM-dd`, timezone-safe (string slice, no Date parsing). */
  private toDateInput(value: string | null | undefined): string {
    if (!value) return '';
    const s = String(value);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  /**
   * Same guards as Upload (inherited), then PUT instead of POST, then back to the list.
   *
   * A newly picked PDF is uploaded after the update for the same reason it is on create: the
   * file is filed under the invoice id, and a failed upload must not fail the save.
   */
  override onSave(): void {
    // Both guards are the parent's, so Upload and Edit can never diverge. The duplicate gate
    // matters here too: changing the invoice number or supplier can make this record clash
    // with a different existing one (its own id is excluded).
    if (!this.passesSaveValidation()) return;
    this.guardDuplicateThen(() => this.persistUpdate());
  }

  private persistUpdate(): void {
    this.isSaving = true;
    const file = this.selectedFile;

    this.invoiceService.update(this.invoiceId, this.buildPayload()).pipe(
      switchMap(result => {
        if (!file) return of({ result, uploadError: null as string | null });
        return this.invoiceService.uploadPdf(this.invoiceId, file).pipe(
          map(() => ({ result, uploadError: null as string | null })),
          catchError(err => of({
            result,
            uploadError: err?.error?.error ?? err?.error ?? err?.message ?? 'Unknown error'
          }))
        );
      })
    ).subscribe({
      next: ({ uploadError }) => {
        this.isSaving = false;
        if (uploadError) {
          this.snackbar.show(
            `Invoice ${this.invNumber} updated, but the PDF failed to upload — ${uploadError}`,
            'warning',
            8000
          );
        } else {
          this.snackbar.show(`Invoice ${this.invNumber} updated.`, 'success');
        }
        this.goToList();
      },
      error: err => {
        this.isSaving = false;
        const detail = err?.error?.error ?? err?.message ?? 'Unknown error';
        this.snackbar.show(`Update failed — ${detail}`, 'error', 8000);
      }
    });
  }

  /** Abandon the edit. Nothing is written, so this is just navigation. */
  onCancel(): void {
    this.goToList();
  }

  private goToList(): void {
    this.router.navigate(['/invoice-view']);
  }
}
