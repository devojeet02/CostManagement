import { Component, Input } from '@angular/core';
import { SafeResourceUrl } from '@angular/platform-browser';

/** Hover magnifier for a PDF preview: the area under the pointer, enlarged beside it. ⚠️ It renders a SECOND copy rather than magnifying the first - the preview is a browser PDF viewer whose pixels cannot be read and whose pointer events never reach the page, so a canvas loupe is not available over it. Sizing a second iframe to `frame × zoom` behind a clipping window re-renders the page at that scale instead. Presentational only: source, point and zoom in, no state of its own. */
@Component({
  selector: 'cm-pdf-loupe',
  templateUrl: './pdf-loupe.component.html',
  styleUrls: ['./pdf-loupe.component.scss']
})
export class PdfLoupeComponent {

  /** Same URL the preview uses. */
  @Input() src: SafeResourceUrl | null = null;

  /** Whether the panel is on screen at all — the host owns the toggle. */
  @Input() active = false;

  /** Where the pointer is over the source frame, normalised 0..1. Null hides the panel. */
  @Input() point: { x: number; y: number } | null = null;

  /** The source frame's on-screen size, so the magnified copy keeps the page's proportions. */
  @Input() frame: { w: number; h: number } | null = null;

  @Input() zoom = 2.2;

  /** Panel size in px - tall, because context above and below a line is what makes a figure readable. */
  @Input() panelWidth = 360;
  @Input() panelHeight = 460;

  get visible(): boolean {
    return this.active && !!this.src && !!this.point && !!this.frame;
  }

  /** The magnified copy's size — the source frame scaled up. */
  get innerWidth(): number {
    return Math.round((this.frame?.w ?? 0) * this.zoom);
  }

  get innerHeight(): number {
    return Math.round((this.frame?.h ?? 0) * this.zoom);
  }

  /** Puts the hovered point in the middle of the window, clamped so the panel never slides past the page - an invoice's margins are empty, and the loupe would look broken exactly when the pointer reaches a corner. */
  get offsetX(): number {
    const centred = (this.point?.x ?? 0) * this.innerWidth - this.panelWidth / 2;
    return -Math.round(Math.min(Math.max(centred, 0), Math.max(this.innerWidth - this.panelWidth, 0)));
  }

  get offsetY(): number {
    const centred = (this.point?.y ?? 0) * this.innerHeight - this.panelHeight / 2;
    return -Math.round(Math.min(Math.max(centred, 0), Math.max(this.innerHeight - this.panelHeight, 0)));
  }
}
