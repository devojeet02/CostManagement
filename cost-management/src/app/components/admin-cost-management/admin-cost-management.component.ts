import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MasterDataService, LookupItemDto, LookupItemPayload, CategoryPayload, SitePayload } from '../../services/master-data.service';
import { Observable } from 'rxjs';
import { SnackbarService } from '../../features/snackbar/snackbar.service';
import { CmHierarchySelectComponent, SelectGroup } from '../../features/cm-hierarchy-select/cm-hierarchy-select.component';

interface AdminItem {
  id: number;
  name: string;
  code: string;
  currencyId?: number | null;
  spendLayerId?: number | null;
  /** Sites only: the org hierarchy the site belongs to. Names are carried for the grid. */
  regionId?: number | null;
  regionName?: string | null;
  countryId?: number | null;
  countryName?: string | null;
}

interface AdminSection {
  key: string;
  title: string;
  hasCode: boolean;
  codeLabel: string;
  items: AdminItem[];
  readOnly?: boolean;
  hasCurrency?: boolean;
  /** Category only: the row needs a parent Spend Layer instead of a free-text code. */
  hasSpendLayer?: boolean;
  /** Site only: two extra columns and two cascading dropdowns for Region -> Country. */
  hasHierarchy?: boolean;
  /** Collapsible card state — defaults to expanded. */
  expanded?: boolean;
}

/** One writable section's backend calls — every key in `writable` below must have an entry here. */
interface SectionApi {
  load: () => Observable<LookupItemDto[]>;
  add: (payload: LookupItemPayload | CategoryPayload) => Observable<LookupItemDto>;
  update: (id: number, payload: LookupItemPayload | CategoryPayload) => Observable<boolean>;
  remove: (id: number, lastUpdatedBy: string) => Observable<boolean>;
}

@Component({
  selector: 'app-admin-cost-management',
  templateUrl: './admin-cost-management.component.html',
  styleUrls: ['./admin-cost-management.component.scss']
})
export class AdminCostManagementComponent implements OnInit, OnDestroy {

  /** Theme custom properties the overlay's styles read. Copied on at move time: moving the node to <body> severs the inheritance from `.cm-root` and the card renders transparent. */
  private static readonly THEME_VARS = [
    '--bg-secondary', '--bg-hover', '--bg-primary', '--border-color',
    '--text-heading', '--text-primary', '--text-muted',
    '--accent-color', '--transition-speed',
  ];

  /** The overlay once moved, so it can be returned before Angular removes it. */
  private movedOverlay: HTMLElement | null = null;

  /** Portals the overlay to <body> so it dims the WHOLE window, sidenav and top bar included. ⚠️ NOT a z-index problem — see cm-modal's `attachToBody` for why raising one cannot work. */
  @ViewChild('panelOverlay')
  set panelOverlay(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (el && el.parentElement !== document.body) {
      // Read the inherited custom properties BEFORE the move - afterwards they are gone.
      const inherited = getComputedStyle(this.host.nativeElement);
      for (const name of AdminCostManagementComponent.THEME_VARS) {
        const value = inherited.getPropertyValue(name).trim();
        if (value) el.style.setProperty(name, value);
      }
      document.body.appendChild(el);
      this.movedOverlay = el;
    } else if (!el) {
      this.movedOverlay = null;
    }
  }

  /** ⚠️ Put the node back before *ngIf drops it (Angular asks the RECORDED parent), and on destroy, or it is stranded on <body>. */
  private restoreOverlay(): void {
    const el = this.movedOverlay;
    if (el && el.parentElement === document.body) {
      this.host.nativeElement.appendChild(el);
    }
    this.movedOverlay = null;
  }

  ngOnDestroy(): void {
    this.restoreOverlay();
  }

  sections: AdminSection[] = [
    { key: 'supplier',      title: 'Supplier Values', hasCode: true,  codeLabel: 'Code',     items: [] },
    { key: 'site',          title: 'Site',            hasCode: true,  codeLabel: 'Location', items: [], hasCurrency: true, hasHierarchy: true },
    { key: 'team',          title: 'Team',            hasCode: false, codeLabel: '',         items: [] },
    { key: 'category',      title: 'Category',        hasCode: false, codeLabel: '',         items: [], hasSpendLayer: true },
    { key: 'currency',      title: 'Currency',        hasCode: true,  codeLabel: 'Code',     items: [] },
    { key: 'account',       title: 'Account',         hasCode: true,  codeLabel: 'Code',     items: [] },
    { key: 'spendType',     title: 'Spend Type',      hasCode: false, codeLabel: '',         items: [] },
    { key: 'spendLayer',    title: 'Spend Layer',     hasCode: false, codeLabel: '',         items: [] },
    { key: 'scenario',      title: 'Scenario',        hasCode: false, codeLabel: '',         items: [] },
    { key: 'system',        title: 'System',          hasCode: false, codeLabel: '',         items: [] },
    { key: 'internalOrder', title: 'Internal Order',  hasCode: true,  codeLabel: 'Code',     items: [] },
  ];

  panelOpen = false;
  panelMode: 'add' | 'edit' = 'add';
  activeSection: AdminSection | null = null;
  editItem: AdminItem = { id: 0, name: '', code: '' };
  nameError = false;
  spendLayerError = false;
  saving = false;

  /** Site org hierarchy. Countries are seeded reference data, and regions are maintained from the Region control itself (add / rename / delete), so unlike every other dropdown here they are NOT sections — they are two plain lists loaded once. The full country list is held client-side and filtered by `countryOptions`, rather than calling /countries/by-region/{id} on each Region change. 37 countries is nothing to hold, and a request per change would make the cascade feel laggy for no benefit. The by-region endpoint exists and is the right call if this list ever grows. */
  regionOptions: LookupItemDto[] = [];
  private allCountries: LookupItemDto[] = [];

  // No real auth wired up yet — mirrors invoice-upload.component.ts's autoStamp.user mock.
  private readonly currentUser = 'Devojeet Modak';

  constructor(
    private masterDataService: MasterDataService,
    private snackbar: SnackbarService,
    private host: ElementRef<HTMLElement>
  ) {}

  /** Backend calls for every section that has real Add/Update/Delete wired up. */
  private readonly api: Record<string, SectionApi> = {
    site: {
      load: () => this.masterDataService.getSites(),
      add: p => this.masterDataService.addSite(p),
      update: (id, p) => this.masterDataService.updateSite(id, p),
      remove: (id, u) => this.masterDataService.deleteSite(id, u),
    },
    team: {
      load: () => this.masterDataService.getTeams(),
      add: p => this.masterDataService.addTeam(p),
      update: (id, p) => this.masterDataService.updateTeam(id, p),
      remove: (id, u) => this.masterDataService.deleteTeam(id, u),
    },
    supplier: {
      load: () => this.masterDataService.getSuppliers(),
      add: p => this.masterDataService.addSupplier(p),
      update: (id, p) => this.masterDataService.updateSupplier(id, p),
      remove: (id, u) => this.masterDataService.deleteSupplier(id, u),
    },
    scenario: {
      load: () => this.masterDataService.getScenarios(),
      add: p => this.masterDataService.addScenario(p),
      update: (id, p) => this.masterDataService.updateScenario(id, p),
      remove: (id, u) => this.masterDataService.deleteScenario(id, u),
    },
    spendLayer: {
      load: () => this.masterDataService.getSpendLayers(),
      add: p => this.masterDataService.addSpendLayer(p),
      update: (id, p) => this.masterDataService.updateSpendLayer(id, p),
      remove: (id, u) => this.masterDataService.deleteSpendLayer(id, u),
    },
    spendType: {
      load: () => this.masterDataService.getSpendTypes(),
      add: p => this.masterDataService.addSpendType(p),
      update: (id, p) => this.masterDataService.updateSpendType(id, p),
      remove: (id, u) => this.masterDataService.deleteSpendType(id, u),
    },
    system: {
      load: () => this.masterDataService.getSystems(),
      add: p => this.masterDataService.addSystem(p),
      update: (id, p) => this.masterDataService.updateSystem(id, p),
      remove: (id, u) => this.masterDataService.deleteSystem(id, u),
    },
    currency: {
      load: () => this.masterDataService.getCurrencies(),
      add: p => this.masterDataService.addCurrency(p as LookupItemPayload),
      update: (id, p) => this.masterDataService.updateCurrency(id, p as LookupItemPayload),
      remove: (id, u) => this.masterDataService.deleteCurrency(id, u),
    },
    account: {
      load: () => this.masterDataService.getAccountsFlat(),
      add: p => this.masterDataService.addAccount(p as LookupItemPayload),
      update: (id, p) => this.masterDataService.updateAccount(id, p as LookupItemPayload),
      remove: (id, u) => this.masterDataService.deleteAccount(id, u),
    },
    internalOrder: {
      load: () => this.masterDataService.getInternalOrdersFlat(),
      add: p => this.masterDataService.addInternalOrder(p as LookupItemPayload),
      update: (id, p) => this.masterDataService.updateInternalOrder(id, p as LookupItemPayload),
      remove: (id, u) => this.masterDataService.deleteInternalOrder(id, u),
    },
    category: {
      load: () => this.masterDataService.getCategories(),
      add: p => this.masterDataService.addCategory(p as CategoryPayload),
      update: (id, p) => this.masterDataService.updateCategory(id, p as CategoryPayload),
      remove: (id, u) => this.masterDataService.deleteCategory(id, u),
    },
  };

  ngOnInit(): void {
    this.sections.forEach(s => s.expanded = true);
    Object.keys(this.api).forEach(key => this.loadSection(key));
    this.loadHierarchyOptions();
  }

  /** Each list gets its own error handler, matching loadSection: one dead endpoint must not blank the other, and neither must stop the rest of the Admin screen loading. */
  private loadHierarchyOptions(): void {
    this.masterDataService.getRegions().subscribe({
      next: rows => { this.regionOptions = rows; this.rebuildRegionGroups(); },
      error: err => console.error('Failed to load regions from master data API', err)
    });
    this.masterDataService.getCountries().subscribe({
      next: rows => { this.allCountries = rows; this.rebuildCountryGroups(); },
      error: err => console.error('Failed to load countries from master data API', err)
    });
  }

  toggleSection(section: AdminSection): void {
    section.expanded = !section.expanded;
  }

  private loadSection(key: string): void {
    const section = this.sections.find(s => s.key === key);
    const sectionApi = this.api[key];
    if (!section || !sectionApi) return;

    sectionApi.load().subscribe({
      next: rows => {
        section.items = rows.map(r => this.toAdminItem(r));
      },
      error: err => console.error(`Failed to load ${key} from master data API`, err)
    });
  }

  openAdd(section: AdminSection): void {
    if (section.readOnly) return;
    this.activeSection = section;
    this.panelMode = 'add';
    this.editItem = { id: 0, name: '', code: '', currencyId: null, spendLayerId: null, regionId: null, countryId: null };
    this.nameError = false;
    this.spendLayerError = false;
    this.syncHierarchyControls();
    this.panelOpen = true;
  }

  openEdit(section: AdminSection, item: AdminItem): void {
    if (section.readOnly) return;
    this.activeSection = section;
    this.panelMode = 'edit';
    this.editItem = { ...item };
    this.nameError = false;
    this.spendLayerError = false;
    this.syncHierarchyControls();
    this.panelOpen = true;
  }

  saveItem(): void {
    if (!this.editItem.name.trim()) {
      this.nameError = true;
      return;
    }
    const section = this.activeSection;
    if (!section) return;

    if (section.hasSpendLayer && !this.editItem.spendLayerId) {
      this.spendLayerError = true;
      return;
    }

    const sectionApi = this.api[section.key];
    if (!sectionApi) {
      console.error(`No backend wiring for section "${section.key}" yet — cannot save.`);
      return;
    }

    // Site is the only section carrying a currency and an org hierarchy, so it gets its own payload. ⚠️ currencyId is included deliberately: before this, the Site panel's Currency dropdown was never put in the body and the API never accepted one, so picking a currency appeared to work and silently reverted on the next load.
    const payload: LookupItemPayload | CategoryPayload | SitePayload = section.hasSpendLayer
      ? { spendLayerId: this.editItem.spendLayerId!, name: this.editItem.name, lastUpdatedBy: this.currentUser }
      : section.hasHierarchy
        ? {
            code: this.editItem.code,
            name: this.editItem.name,
            currencyId: this.editItem.currencyId ?? null,
            regionId: this.editItem.regionId ?? null,
            countryId: this.editItem.countryId ?? null,
            lastUpdatedBy: this.currentUser
          }
        : { code: this.editItem.code, name: this.editItem.name, lastUpdatedBy: this.currentUser };

    this.saving = true;
    if (this.panelMode === 'add') {
      sectionApi.add(payload).subscribe({
        next: created => {
          // Built from the RESPONSE, not from editItem: the server derives RegionId from the chosen country, so its answer is the one that matches what was actually stored.
          section.items.push(this.toAdminItem(created));
          this.saving = false;
          this.closePanel();
        },
        error: err => { console.error(`Failed to add ${section.key}`, err); this.saving = false; }
      });
    } else {
      const id = this.editItem.id;
      sectionApi.update(id, payload).subscribe({
        next: ok => {
          if (ok) {
            const idx = section.items.findIndex(i => i.id === id);
            // PUT answers a bare boolean, so the row is rebuilt locally. resolveHierarchy() reapplies the server's rule (country decides the region) and fills in the display names — without it the grid would show whatever Region was on screen, which can differ from what was saved.
            if (idx > -1) section.items[idx] = this.resolveHierarchy({ ...this.editItem });
          }
          this.saving = false;
          this.closePanel();
        },
        error: err => { console.error(`Failed to update ${section.key}/${id}`, err); this.saving = false; }
      });
    }
  }

  deleteItem(section: AdminSection, item: AdminItem, event: Event): void {
    event.stopPropagation();
    if (section.readOnly) return;

    const sectionApi = this.api[section.key];
    if (!sectionApi) {
      console.error(`No backend wiring for section "${section.key}" yet — cannot delete.`);
      return;
    }

    sectionApi.remove(item.id, this.currentUser).subscribe({
      next: ok => {
        if (ok) {
          section.items = section.items.filter(i => i.id !== item.id);
          if (this.activeSection?.key === section.key && this.editItem.id === item.id) {
            this.closePanel();
          }
        }
      },
      error: err => {
        console.error(`Failed to delete ${section.key}/${item.id}`, err);
        // A delete can now be legitimately REFUSED — e.g. a scenario that forecast rows still reference, which the backend rejects with 400 + an explanatory message. Logging that to the console only would look like the button did nothing, so show it.
        const detail = err?.error?.error ?? err?.error?.message ?? err?.message;
        this.snackbar.show(
          detail ? `Cannot delete — ${detail}` : `Could not delete this ${section.title || section.key}.`,
          'error',
          8000
        );
      }
    });
  }

  /** Closes only when the BACKDROP itself was clicked. Replaces a stopPropagation() on the card, which kept clicks from reaching document and so left cm-hierarchy-select's dropdown open. */
  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closePanel();
  }

  closePanel(): void {
    this.restoreOverlay();
    this.panelOpen = false;
    this.activeSection = null;
    this.editItem = { id: 0, name: '', code: '', currencyId: null, spendLayerId: null, regionId: null, countryId: null };
    this.nameError = false;
    this.spendLayerError = false;
  }

  isActiveRow(section: AdminSection, item: AdminItem): boolean {
    return this.panelOpen
      && this.activeSection?.key === section.key
      && this.editItem.id === item.id;
  }

  get currencyOptions(): AdminItem[] {
    return this.sections.find(s => s.key === 'currency')?.items ?? [];
  }

  currencyName(currencyId: number | null | undefined): string {
    const currency = this.currencyOptions.find(c => c.id === currencyId);
    return currency ? currency.name : '—';
  }


  /** Maps an API row to a grid row. One place, so add/update/load cannot drift apart. */
  private toAdminItem(r: LookupItemDto): AdminItem {
    return {
      id: r.id,
      name: r.name,
      code: r.code ?? '',
      currencyId: r.currencyId,
      spendLayerId: r.spendLayerId,
      regionId: r.regionId,
      regionName: r.regionName,
      countryId: r.countryId,
      countryName: r.countryName
    };
  }

  /** Reapplies the backend's rule locally: a chosen country decides the region, and both display names are filled in from the loaded lists. Used after a PUT, which returns only a boolean. */
  private resolveHierarchy(item: AdminItem): AdminItem {
    const country = this.allCountries.find(c => c.id === item.countryId);
    if (country) {
      item.countryName = country.name;
      item.regionId = country.regionId ?? item.regionId;
    } else {
      item.countryId = null;
      item.countryName = null;
    }
    item.regionName = this.regionOptions.find(r => r.id === item.regionId)?.name ?? null;
    return item;
  }

  /** The cascade. Countries narrow to the chosen region; with no region chosen the full list shows, so the dropdown is never empty and a user can pick a country first if they prefer. */
  get countryOptions(): LookupItemDto[] {
    const regionId = this.editItem.regionId;
    if (!regionId) return this.allCountries;
    return this.allCountries.filter(c => c.regionId === regionId);
  }

  /** Region changed: drop a country that no longer belongs to it. ⚠️ Without this the select shows a blank box while the model still holds the old country id, and saving would send a country from the wrong region. The server would correct the region rather than store a contradiction, but the user would have saved something they could not see. */
  onRegionChange(): void {
    const stillValid = this.countryOptions.some(c => c.id === this.editItem.countryId);
    if (!stillValid) this.editItem.countryId = null;
  }

  /** Country chosen: adopt its region, so the Region box reflects what will actually be stored. */
  onCountryChange(): void {
    const country = this.allCountries.find(c => c.id === this.editItem.countryId);
    if (country?.regionId) this.editItem.regionId = country.regionId;
  }

  /** cm-hierarchy-select groups for Region and Country. ⚠️ FIELDS, not getters, and rebuilt only when the source list actually changes. The control memoises its filtering on the IDENTITY of `groups`; a getter hands it a new array every change-detection pass, which tears down and recreates every option - and an option recreated between mousedown and mouseup fires no click at all, so nothing can be selected. */
  /** The Region control itself, so a rename can refresh its DISPLAYED label directly. */
  @ViewChild('regionSelect') regionSelect?: CmHierarchySelectComponent;

  regionGroups: SelectGroup[] = [];
  countryGroups: SelectGroup[] = [];

  /** The control is a string-valued CVA, but regionId / countryId are numbers, so the panel binds to these string mirrors and writes the number back on change. Kept as a pair rather than changing AdminItem, because the payload and the API both speak numbers. */
  regionIdStr = '';
  countryIdStr = '';

  /** Country groups for the CURRENT region selection, grouped under the region's own name so the panel header says what you are looking at. Rebuilt only when the region changes. */
  private rebuildCountryGroups(): void {
    const opts = this.countryOptions;
    const regionName = this.regionOptions.find(r => r.id === this.editItem.regionId)?.name;
    this.countryGroups = opts.length
      ? [{ group: regionName ? `Countries — ${regionName}` : 'All countries',
           items: opts.map(c => ({ value: String(c.id), label: c.name })) }]
      : [];
  }

  private rebuildRegionGroups(): void {
    this.regionGroups = this.regionOptions.length
      ? [{ group: 'Regions', items: this.regionOptions.map(r => ({ value: String(r.id), label: r.name })) }]
      : [];
  }

  /** Region picked in the typeahead. Mirrors the string back to the numeric id, then reapplies the same cascade the native select used. */
  onRegionSelected(value: string): void {
    this.editItem.regionId = value ? Number(value) : null;
    this.onRegionChange();
    this.countryIdStr = this.editItem.countryId != null ? String(this.editItem.countryId) : '';
    this.rebuildCountryGroups();
  }

  /** Country picked. Adopting its region also re-points the Region box, so both agree with what the server will store. */
  onCountrySelected(value: string): void {
    this.editItem.countryId = value ? Number(value) : null;
    this.onCountryChange();
    this.regionIdStr = this.editItem.regionId != null ? String(this.editItem.regionId) : '';
    this.rebuildCountryGroups();
  }

  // ── Region add / rename Region is user-maintainable; Country is not. See the template for why.

  regionFormOpen = false;
  regionFormMode: 'add' | 'edit' = 'add';
  regionForm: { code: string; name: string } = { code: '', name: '' };
  regionError = '';
  regionSaving = false;

  /** Label for the rename button, so it names the region being changed rather than saying "Edit". */
  get selectedRegionName(): string {
    return this.regionOptions.find(r => r.id === this.editItem.regionId)?.name ?? '';
  }

  /** prefillName comes from the Region dropdown's empty state: what was searched for and not found is what the user is about to add, so it arrives already typed. */
  openRegionForm(mode: 'add' | 'edit', prefillName = ''): void {
    this.regionFormMode = mode;
    this.regionError = '';
    const current = this.regionOptions.find(r => r.id === this.editItem.regionId);
    this.regionForm = mode === 'edit' && current
      ? { code: current.code ?? '', name: current.name }
      : { code: '', name: prefillName };
    this.regionFormOpen = true;
  }

  cancelRegionForm(): void {
    this.regionFormOpen = false;
    this.regionError = '';
    this.regionForm = { code: '', name: '' };
  }

  /** Adds a region, or renames the selected one. ⚠️ The API owns the duplicate-code rule and answers 409; this does not try to second-guess it, because the check has to be atomic against the table rather than against a list this screen happens to be holding. On success the options are refetched rather than patched locally: the new row's id comes from the server, and the country cascade reads regionOptions to label its group header. */
  saveRegion(): void {
    const code = (this.regionForm.code || '').trim();
    const name = (this.regionForm.name || '').trim();
    if (!name) { this.regionError = 'Name is required.'; return; }
    if (!code) { this.regionError = 'Code is required.'; return; }

    this.regionSaving = true;
    this.regionError = '';
    const payload = { code, name, lastUpdatedBy: this.currentUser };

    const done = (selectId: number | null) => {
      this.masterDataService.getRegions().subscribe({
        next: rows => {
          this.regionOptions = rows;
          this.rebuildRegionGroups();
          if (selectId != null) {
            this.editItem.regionId = selectId;
            this.regionIdStr = String(selectId);
            // ⚠️ The control resolves its DISPLAYED label inside writeValue, against `groups`. After a RENAME the bound id has not changed, so Angular never calls writeValue and the box keeps the old name. Re-binding through the model does not help either: input order within a change-detection pass decides whether the new groups are visible yet. Push the new groups onto the control and re-run writeValue ourselves, which is deterministic and does not depend on that ordering at all.
            if (this.regionSelect) {
              // Push the rebuilt groups on FIRST: writeValue resolves the label against them, and the [groups] binding has not propagated yet this tick.
              this.regionSelect.groups = this.regionGroups;
              this.regionSelect.writeValue(String(selectId));
            }
          }
          this.rebuildCountryGroups();
          this.regionSaving = false;
          this.cancelRegionForm();
          this.snackbar.show(
            this.regionFormMode === 'add' ? `Region “${name}” added.` : `Region renamed to “${name}”.`,
            'success');
        },
        error: () => { this.regionSaving = false; this.cancelRegionForm(); }
      });
    };

    const fail = (err: any) => {
      this.regionSaving = false;
      // The 409 body carries the reason ("code already exists"), which is the whole point of showing it.
      this.regionError = err?.error?.error ?? 'Could not save the region.';
    };

    if (this.regionFormMode === 'add') {
      this.masterDataService.addRegion(payload).subscribe({
        next: created => done(created?.id ?? null),
        error: fail
      });
    } else {
      const id = this.editItem.regionId!;
      this.masterDataService.updateRegion(id, payload).subscribe({
        next: () => done(id),
        error: fail
      });
    }
  }

  /** Sites filed under the selected region. Passed to the Manage-countries dialog so its delete warning can name them; the API re-checks before it deletes anything. */
  get sitesInSelectedRegion(): number {
    const id = this.editItem.regionId;
    if (!id) return 0;
    return (this.sections.find(s => s.key === 'site')?.items ?? []).filter(i => i.regionId === id).length;
  }

  /** The Manage-countries dialog deleted the region it was managing. */
  onRegionDeleted(): void {
    const id = this.editItem.regionId;
    this.countryPickerOpen = false;
    if (id) this.afterRegionDeleted(id);
  }

  /** Clears the deleted region off the form and out of every list that was built from it. */
  private afterRegionDeleted(id: number): void {
    this.masterDataService.getRegions().subscribe({
      next: rows => {
        this.regionOptions = rows;
        this.rebuildRegionGroups();

        if (this.editItem.regionId === id) {
          this.editItem.regionId = null;
          this.editItem.countryId = null;
          this.regionIdStr = '';
          this.countryIdStr = '';
          // Same reason as the rename in saveRegion(): push the rebuilt groups on, then re-run writeValue.
          if (this.regionSelect) {
            this.regionSelect.groups = this.regionGroups;
            this.regionSelect.writeValue('');
          }
        }

        this.rebuildCountryGroups();
        this.snackbar.show('Region deleted.', 'success');
      },
      error: err => console.error('Region deleted, but the list could not be refreshed', err)
    });
  }

  /** Drives the Manage-countries dialog (cm-region-countries). */
  countryPickerOpen = false;

  /** Something moved: refresh the country cascade and the Site grid behind the panel, since a move re-points sites too. */
  onRegionCountriesChanged(): void {
    this.masterDataService.getCountries().subscribe({
      next: rows => { this.allCountries = rows; this.rebuildCountryGroups(); },
      error: err => console.error('Failed to refresh countries', err)
    });
    this.loadSection('site');
  }

  /** Seeds the string mirrors and both option lists whenever the panel opens. */
  private syncHierarchyControls(): void {
    this.cancelRegionForm();
    this.countryPickerOpen = false;
    this.regionIdStr = this.editItem.regionId != null ? String(this.editItem.regionId) : '';
    this.countryIdStr = this.editItem.countryId != null ? String(this.editItem.countryId) : '';
    this.rebuildRegionGroups();
    this.rebuildCountryGroups();
  }

  /** Grid cells. The name comes from the row itself (the API sends it), falling back to a lookup for a row rebuilt locally after an edit. */
  regionLabel(item: AdminItem): string {
    return item.regionName || this.regionOptions.find(r => r.id === item.regionId)?.name || '—';
  }

  countryLabel(item: AdminItem): string {
    return item.countryName || this.allCountries.find(c => c.id === item.countryId)?.name || '—';
  }

  get spendLayerOptions(): AdminItem[] {
    return this.sections.find(s => s.key === 'spendLayer')?.items ?? [];
  }

  spendLayerName(spendLayerId: number | null | undefined): string {
    const layer = this.spendLayerOptions.find(l => l.id === spendLayerId);
    return layer ? layer.name : '—';
  }
}
