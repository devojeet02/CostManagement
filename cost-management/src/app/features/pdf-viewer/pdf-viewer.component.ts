import {
  Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges, HostListener
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { InvoiceService } from '../../services/invoice.service';

/**
 * Shared invoice-PDF preview overlay.
 *
 * Opened by click (never hover) from any screen that can name an invoice id — currently the
 * Invoice View list. Kept in `features/` alongside cm-modal / cm-snackbar because it is
 * screen-agnostic: it takes an id and renders whatever the backend has filed under it.
 *
 * It deliberately does NOT reuse cm-modal. A PDF needs a near-full-viewport frame with the
 * body owning its own height, whereas cm-modal sizes itself to its projected content and
 * scrolls it — an iframe inside that collapses to nothing. The overlay/close/Escape/backdrop
 * behaviour is mirrored so it still feels like the rest of the module.
 *
 * The PDF is fetched as a Blob and shown through an object URL, so the three states
 * (loading / loaded / unavailable) are all observable. Every object URL is revoked before the
 * next one is created and on destroy — otherwise each open would leak the whole file.
 */
@Component({
  selector: 'cm-pdf-viewer',
  templateUrl: './pdf-viewer.component.html',
  styleUrls: ['./pdf-viewer.component.scss']
})
export class PdfViewerComponent implements OnChanges, OnDestroy {
  /** Drives visibility. The parent owns this flag. */
  @Input() isOpen = false;

  /** Invoice whose PDF to show. Null renders the "nothing attached" state. */
  @Input() invoiceId: number | null = null;

  /** Shown in the header — the invoice number reads better than a bare id. */
  @Input() invoiceLabel = '';

  /** File name from the list row, shown as a subtitle when present. */
  @Input() fileName: string | null = null;

  @Output() closed = new EventEmitter<void>();

  loading = false;
  /** Set when the fetch fails or no invoice was supplied — drives the empty state. */
  errorMessage: string | null = null;
  pdfUrl: SafeResourceUrl | null = null;

  /** Raw object URL kept for revocation; the sanitized one can't be passed to revokeObjectURL. */
  private objectUrl: string | null = null;

  constructor(
    private invoiceService: InvoiceService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Load on the transition into "open", and whenever the target invoice changes while open.
    const opened  = changes['isOpen'] && this.isOpen;
    const swapped = changes['invoiceId'] && this.isOpen && !changes['invoiceId'].firstChange;

    if (opened || swapped) {
      this.load();
    } else if (changes['isOpen'] && !this.isOpen) {
      this.release();
    }
  }

  private load(): void {
    this.release();

    if (this.invoiceId == null) {
      this.errorMessage = 'No invoice attached';
      return;
    }

    this.loading = true;
    this.invoiceService.getPdf(this.invoiceId).subscribe({
      next: blob => {
        this.loading = false;
        // A zero-byte body would render as a blank frame that looks like a hung load.
        if (!blob || blob.size === 0) {
          this.errorMessage = 'No invoice attached';
          return;
        }
        this.objectUrl = URL.createObjectURL(blob);
        this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
      },
      error: err => {
        this.loading = false;
        this.errorMessage = err?.status === 404
          ? 'No invoice attached'
          : 'The invoice PDF could not be loaded.';
        console.error('Failed to load invoice PDF', err);
      }
    });
  }

  /** Drop the current object URL and reset the view state. */
  private release(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.pdfUrl = null;
    this.errorMessage = null;
    this.loading = false;
  }

  /** Backdrop click, close button and Escape all route here. */
  close(): void {
    this.release();
    this.closed.emit();
  }

  /** Matches cm-modal's dismiss behaviour so the module's overlays feel identical. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }

  /** Opens the PDF in a new browser tab, for anyone who wants the full-page reader. */
  openInNewTab(): void {
    if (this.objectUrl) window.open(this.objectUrl, '_blank');
  }

  ngOnDestroy(): void {
    this.release();
  }
}
