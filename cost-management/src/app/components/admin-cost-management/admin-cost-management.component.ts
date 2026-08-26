import { Component, OnInit } from '@angular/core';
import { MasterDataService, LookupItemDto, LookupItemPayload, CategoryPayload } from '../../services/master-data.service';
import { Observable } from 'rxjs';
import { SnackbarService } from '../../features/snackbar/snackbar.service';

interface AdminItem {
  id: number;
  name: string;
  code: string;
  currencyId?: number | null;
  spendLayerId?: number | null;
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
export class AdminCostManagementComponent implements OnInit {

  sections: AdminSection[] = [
    { key: 'supplier',      title: 'Supplier Values', hasCode: true,  codeLabel: 'Code',     items: [] },
    { key: 'site',          title: 'Site',            hasCode: true,  codeLabel: 'Location', items: [], hasCurrency: true },
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

  // No real auth wired up yet — mirrors invoice-upload.component.ts's autoStamp.user mock.
  private readonly currentUser = 'Devojeet Modak';

  constructor(
    private masterDataService: MasterDataService,
    private snackbar: SnackbarService
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
        section.items = rows.map(r => ({ id: r.id, name: r.name, code: r.code ?? '', currencyId: r.currencyId, spendLayerId: r.spendLayerId }));
      },
      error: err => console.error(`Failed to load ${key} from master data API`, err)
    });
  }

  openAdd(section: AdminSection): void {
    if (section.readOnly) return;
    this.activeSection = section;
    this.panelMode = 'add';
    this.editItem = { id: 0, name: '', code: '', currencyId: null, spendLayerId: null };
    this.nameError = false;
    this.spendLayerError = false;
    this.panelOpen = true;
  }

  openEdit(section: AdminSection, item: AdminItem): void {
    if (section.readOnly) return;
    this.activeSection = section;
    this.panelMode = 'edit';
    this.editItem = { ...item };
    this.nameError = false;
    this.spendLayerError = false;
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

    const payload: LookupItemPayload | CategoryPayload = section.hasSpendLayer
      ? { spendLayerId: this.editItem.spendLayerId!, name: this.editItem.name, lastUpdatedBy: this.currentUser }
      : { code: this.editItem.code, name: this.editItem.name, lastUpdatedBy: this.currentUser };

    this.saving = true;
    if (this.panelMode === 'add') {
      sectionApi.add(payload).subscribe({
        next: created => {
          section.items.push({ id: created.id, name: created.name, code: created.code ?? '', currencyId: created.currencyId, spendLayerId: created.spendLayerId });
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
            if (idx > -1) section.items[idx] = { ...this.editItem };
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
        // A delete can now be legitimately REFUSED — e.g. a scenario that forecast rows still
        // reference, which the backend rejects with 400 + an explanatory message. Logging that
        // to the console only would look like the button did nothing, so show it.
        const detail = err?.error?.error ?? err?.error?.message ?? err?.message;
        this.snackbar.show(
          detail ? `Cannot delete — ${detail}` : `Could not delete this ${section.title || section.key}.`,
          'error',
          8000
        );
      }
    });
  }

  closePanel(): void {
    this.panelOpen = false;
    this.activeSection = null;
    this.editItem = { id: 0, name: '', code: '', currencyId: null, spendLayerId: null };
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

  get spendLayerOptions(): AdminItem[] {
    return this.sections.find(s => s.key === 'spendLayer')?.items ?? [];
  }

  spendLayerName(spendLayerId: number | null | undefined): string {
    const layer = this.spendLayerOptions.find(l => l.id === spendLayerId);
    return layer ? layer.name : '—';
  }
}
