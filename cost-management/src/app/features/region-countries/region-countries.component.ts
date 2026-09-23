import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { LookupItemDto, MasterDataService } from '../../services/master-data.service';
import { SnackbarService } from '../snackbar/snackbar.service';

/** Moves countries into one region, and deletes the region itself once nothing is left in it. ⚠️ A moved country also re-points every SITE bound to it — tblCMSite.RegionId is a denormalised copy of the country's region — so the server does both in one transaction and reports `sitesResynced`, which is surfaced here. */
@Component({
  selector: 'cm-region-countries',
  templateUrl: './region-countries.component.html',
  styleUrls: ['./region-countries.component.scss']
})
export class RegionCountriesComponent implements OnChanges {
  @Input() isOpen = false;

  /** The region countries are moved INTO. */
  @Input() regionId: number | null = null;
  @Input() regionName = '';

  /** Sites bound to this region, from the host's grid. Only the delete warning uses it, so it stays a plain number rather than another fetch of its own. */
  @Input() siteCount = 0;

  @Output() closed = new EventEmitter<void>();

  /** The region itself was deleted, so the host has to drop it from its lists and its form. */
  @Output() deleted = new EventEmitter<void>();

  /** Fires only when something actually moved, so the host refetches just once and only if needed. */
  @Output() changed = new EventEmitter<void>();

  regions: LookupItemDto[] = [];
  countries: LookupItemDto[] = [];

  search = '';

  /** Which list is on screen: this region's countries, or everything filed elsewhere. */
  tab: 'here' | 'other' = 'here';

  picked: number[] = [];
  loading = false;
  saving = false;
  error = '';

  constructor(
    private masterDataService: MasterDataService,
    private snackbar: SnackbarService
  ) {}

  /** Loads on OPEN rather than on init: the lists must be current each time, and this sits inside a panel that may never be opened. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.search = '';
      this.tab = 'here';
      this.picked = [];
      this.error = '';
      this.load();
    }
  }

  private load(): void {
    this.loading = true;
    this.masterDataService.getRegions().subscribe({
      next: rows => this.regions = rows,
      error: () => { /* names degrade to an em dash; not worth failing the panel over */ }
    });
    this.masterDataService.getCountries().subscribe({
      next: rows => { this.countries = rows; this.loading = false; },
      error: () => { this.loading = false; this.error = 'Could not load the countries.'; }
    });
  }

  /** Already in the target region — the count in the header, so an empty new region is obvious. */
  get inThisRegion(): LookupItemDto[] {
    return this.countries.filter(c => c.regionId === this.regionId);
  }

  /** Everything filed under a different region — the pool this region can draw from. */
  get elsewhere(): LookupItemDto[] {
    return this.countries.filter(c => c.regionId !== this.regionId);
  }

  /** The active tab's list, narrowed by the search box. Uncapped on purpose: browsing the countries filed elsewhere is the point of the second tab, and the list already scrolls inside a fixed height. */
  get results(): LookupItemDto[] {
    const q = this.search.trim().toLowerCase();
    const base = this.tab === 'here' ? this.inThisRegion : this.elsewhere;
    return q ? base.filter(c => c.name.toLowerCase().includes(q)) : base;
  }

  get searchPlaceholder(): string {
    return this.tab === 'here'
      ? `Search the ${this.inThisRegion.length} countries here…`
      : `Search the ${this.elsewhere.length} countries filed elsewhere…`;
  }

  /** The search is per-tab: carrying it across would show an empty list and look like a bug. */
  setTab(tab: 'here' | 'other'): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.search = '';
  }

  regionNameById(id: number | null | undefined): string {
    return this.regions.find(r => r.id === id)?.name ?? '—';
  }

  isHere(c: LookupItemDto): boolean { return c.regionId === this.regionId; }
  isPicked(id: number): boolean { return this.picked.includes(id); }

  toggle(id: number): void {
    this.picked = this.isPicked(id) ? this.picked.filter(x => x !== id) : [...this.picked, id];
  }

  trackById(_i: number, c: LookupItemDto): number { return c.id; }

  move(): void {
    if (!this.regionId || !this.picked.length) return;

    this.saving = true;
    this.error = '';
    this.masterDataService.reassignCountries(this.regionId, this.picked, 'Devojeet Modak').subscribe({
      next: result => {
        const sites = result.sitesResynced
          ? ` ${result.sitesResynced} site${result.sitesResynced === 1 ? '' : 's'} moved with them.`
          : '';
        this.snackbar.show(
          `${result.countriesMoved} countr${result.countriesMoved === 1 ? 'y' : 'ies'} moved to “${this.regionName}”.${sites}`,
          'success');
        this.picked = [];
        this.saving = false;
        // Land on the tab the countries just moved INTO, which is where the user looks to confirm it.
        this.tab = 'here';
        this.search = '';
        this.changed.emit();
        this.load();
      },
      error: err => {
        this.saving = false;
        this.error = err?.error?.error ?? 'Could not move the countries.';
      }
    });
  }

  // -- Delete this region ----------------------------------------------------

  deleteOpen = false;
  deleteTitle = '';
  deleteMessage = '';
  deleteDetail = '';
  deleteConfirmLabel = 'Yes, continue';
  deleteCancelLabel = 'No, cancel';

  /** True when something still belongs to the region, so the dialog explains instead of deleting. */
  deleteBlocked = false;

  /** Opens the delete confirmation. The counts are the ones already on screen; the API re-checks them before it deletes anything and refuses with the real numbers, so these only have to be right enough to word the warning. */
  openDelete(): void {
    const countries = this.inThisRegion.length;
    const sites = this.siteCount;
    this.deleteBlocked = countries > 0 || sites > 0;

    if (this.deleteBlocked) {
      const parts: string[] = [];
      if (countries) parts.push(`${countries} countr${countries === 1 ? 'y' : 'ies'}`);
      if (sites) parts.push(`${sites} site${sites === 1 ? '' : 's'}`);
      this.deleteTitle = `“${this.regionName}” is still in use`;
      this.deleteMessage = `${parts.join(' and ')} still belong to this region, so it cannot be deleted yet.`;
      this.deleteDetail = countries
        ? 'Deleting it anyway would leave them pointing at a region that no longer exists — their Region would read as a dash on the Admin grid, and the Dashboard would stop counting their spend under any region. Move the countries into another region first: open that region here and search for them. Any site using them moves across too.'
        : 'Deleting it anyway would leave those sites pointing at a region that no longer exists — their Region would read as a dash on the Admin grid, and the Dashboard would stop counting their spend under any region. Change the Region on those sites first.';
      this.deleteConfirmLabel = 'Got it';
      this.deleteCancelLabel = 'Close';
    } else {
      this.deleteTitle = `Delete “${this.regionName}”?`;
      this.deleteMessage = 'Nothing is filed under this region at the moment, so removing it affects no existing site.';
      this.deleteDetail = 'It disappears from the Region dropdown across the application straight away, and no site can be filed under it again. This is saved immediately — closing the panel will not bring it back, and it would have to be added again by hand.';
      this.deleteConfirmLabel = 'Yes, continue';
      this.deleteCancelLabel = 'No, cancel';
    }

    this.deleteOpen = true;
  }

  /** On a blocked region both buttons only dismiss: the fix is the list behind this dialog. */
  confirmDelete(): void {
    this.deleteOpen = false;
    if (this.deleteBlocked || !this.regionId) return;

    this.masterDataService.deleteRegion(this.regionId, 'Devojeet Modak').subscribe({
      next: ok => {
        if (!ok) {
          this.error = 'Could not delete the region — it may already have been removed.';
          return;
        }
        this.deleted.emit();
        this.close();
      },
      // A refusal here means this panel's counts were stale — the API checked against the table and says what is actually still using it, so show that rather than a generic failure.
      error: err => this.error = err?.error?.error ?? 'Could not delete the region.'
    });
  }

  close(): void {
    this.closed.emit();
  }
}
