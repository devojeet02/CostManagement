import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

/** Row shape returned by every /master/* lookup endpoint (Site/Team/Supplier/Scenario/SpendLayer/SpendType/System/Category/Currency/Account/InternalOrder). */
export interface LookupItemDto {
  id: number;
  code?: string | null;
  name: string;
  currencyId?: number | null;
  currencyCode?: string | null;
  /** Scenarios only. */
  year?: number | null;
  isReadOnly?: boolean | null;
  /** Categories only: which Spend Layer the category rolls up into. */
  spendLayerId?: number | null;
}

/** Row shape returned by GET /api/v1/master/accounts (kept for the Invoice Upload dropdown's grouped display). */
export interface AccountDto {
  id: number;
  code: string;
  name: string;
  group: string | null;
}

/** Payload for POST/PUT on Site/Team/Supplier/Scenario/SpendLayer/SpendType/System/Currency/Account/InternalOrder. */
export interface LookupItemPayload {
  code?: string;
  name: string;
  /** Login of the user saving the record — audit standard (LastUpdatedBy). */
  lastUpdatedBy: string;
}

/** Payload for POST/PUT on Category — needs the parent Spend Layer, not a free-text code. */
export interface CategoryPayload {
  spendLayerId: number;
  name: string;
  lastUpdatedBy: string;
}

/** Backwards-compat aliases (previously distinct interfaces, now identical shape). */
export type SiteDto = LookupItemDto;
export type SupplierDto = LookupItemDto;

/**
 * Talks to the Master (reference) Data backend.
 * SHOWCASE BUILD: served from memory, not HTTP - see the transport section at the bottom.
 */
@Injectable({ providedIn: 'root' })
export class MasterDataService {

  // ---- reads ----
  getSites(): Observable<LookupItemDto[]> { return this.list('sites'); }
  getTeams(): Observable<LookupItemDto[]> { return this.list('teams'); }
  getSuppliers(): Observable<LookupItemDto[]> { return this.list('suppliers'); }
  getCurrencies(): Observable<LookupItemDto[]> { return this.list('currencies'); }
  getScenarios(): Observable<LookupItemDto[]> { return this.list('scenarios'); }
  getSpendLayers(): Observable<LookupItemDto[]> { return this.list('spend-layers'); }
  getSpendTypes(): Observable<LookupItemDto[]> { return this.list('spend-types'); }
  getSystems(): Observable<LookupItemDto[]> { return this.list('systems'); }
  /** CCM-061 — Cost-Management business roles (Accounting Department, Dept Head, etc.). */
  getRoles(): Observable<LookupItemDto[]> { return this.list('roles'); }
  /** "All categories" read — no SpendLayerId filter. */
  getCategories(): Observable<LookupItemDto[]> { return this.list('categories'); }
  /** Grouped shape used by the Invoice Upload dropdown. */
  getAccounts(): Observable<AccountDto[]> {
    // Showcase: grouped accounts come from the same in-memory store as the flat list.
    return of(this.rows('accounts').map(a => ({ ...a, group: null } as unknown as AccountDto)))
      .pipe(delay(120));
  }
  /** Flat { id, code, name } shape used by the Admin CRUD screen. */
  getAccountsFlat(): Observable<LookupItemDto[]> { return this.list('accounts'); }
  /** Flat list used by the Admin CRUD screen — distinct from the grouped hierarchy-select search. */
  getInternalOrdersFlat(): Observable<LookupItemDto[]> { return this.list('internal-orders/all'); }

  // ---- writes: Site ----
  addSite(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('sites', payload); }
  updateSite(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('sites', id, payload); }
  deleteSite(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('sites', id, lastUpdatedBy); }

  // ---- writes: Team ----
  addTeam(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('teams', payload); }
  updateTeam(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('teams', id, payload); }
  deleteTeam(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('teams', id, lastUpdatedBy); }

  // ---- writes: Supplier ----
  addSupplier(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('suppliers', payload); }
  updateSupplier(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('suppliers', id, payload); }
  deleteSupplier(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('suppliers', id, lastUpdatedBy); }

  // ---- writes: Scenario ----
  addScenario(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('scenarios', payload); }
  updateScenario(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('scenarios', id, payload); }
  deleteScenario(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('scenarios', id, lastUpdatedBy); }

  // ---- writes: Spend Layer ----
  addSpendLayer(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('spend-layers', payload); }
  updateSpendLayer(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('spend-layers', id, payload); }
  deleteSpendLayer(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('spend-layers', id, lastUpdatedBy); }

  // ---- writes: Spend Type ----
  addSpendType(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('spend-types', payload); }
  updateSpendType(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('spend-types', id, payload); }
  deleteSpendType(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('spend-types', id, lastUpdatedBy); }

  // ---- writes: System ----
  addSystem(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('systems', payload); }
  updateSystem(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('systems', id, payload); }
  deleteSystem(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('systems', id, lastUpdatedBy); }

  // ---- writes: Role (CCM-061) ----
  addRole(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('roles', payload); }
  updateRole(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('roles', id, payload); }
  deleteRole(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('roles', id, lastUpdatedBy); }

  // ---- writes: Currency ----
  addCurrency(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('currencies', payload); }
  updateCurrency(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('currencies', id, payload); }
  deleteCurrency(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('currencies', id, lastUpdatedBy); }

  // ---- writes: Account ----
  addAccount(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('accounts', payload); }
  updateAccount(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('accounts', id, payload); }
  deleteAccount(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('accounts', id, lastUpdatedBy); }

  // ---- writes: Internal Order ----
  addInternalOrder(payload: LookupItemPayload): Observable<LookupItemDto> { return this.add('internal-orders', payload); }
  updateInternalOrder(id: number, payload: LookupItemPayload): Observable<boolean> { return this.update('internal-orders', id, payload); }
  deleteInternalOrder(id: number, lastUpdatedBy: string): Observable<boolean> { return this.remove('internal-orders', id, lastUpdatedBy); }

  // ---- writes: Category (needs SpendLayerId, not a free-text code) ----
  // Showcase: these three carry a SpendLayerId rather than a free-text code, so they do not go
  // through the generic helpers - but they hit the same in-memory store.
  addCategory(payload: CategoryPayload): Observable<LookupItemDto> {
    return this.add('categories', { code: payload.name, name: payload.name } as LookupItemPayload);
  }
  updateCategory(id: number, payload: CategoryPayload): Observable<boolean> {
    return this.update('categories', id, { code: payload.name, name: payload.name } as LookupItemPayload);
  }
  deleteCategory(id: number, lastUpdatedBy: string): Observable<boolean> {
    return this.remove('categories', id, lastUpdatedBy);
  }

  // ---- shared HTTP helpers (every /master/* lookup endpoint follows the same shape) ----
  // ── SHOWCASE TRANSPORT ────────────────────────────────────────────────────────────
  //
  // WARNING: no backend in this build. Only these four helpers differ from production; every
  // public method above is untouched, so the Admin screens are unmodified copies of the real
  // ones and behave identically - including add / edit / delete.
  //
  // The store is in memory, so edits persist for the session and vanish on reload. That is the
  // right behaviour for a demo: people can try the CRUD without leaving a mess behind.

  private store: { [path: string]: LookupItemDto[] } = {
    sites: [
      { id: 1, code: 'uk', name: 'UK' },
      { id: 2, code: 'amsterdam', name: 'Amsterdam' },
      { id: 3, code: 'france', name: 'France' },
      { id: 4, code: 'usa', name: 'USA' },
      { id: 5, code: 'bradford', name: 'Bradford' },
      { id: 6, code: 'london-hq', name: 'London HQ' },
      { id: 7, code: 'manchester', name: 'Manchester' },
      { id: 8, code: 'dublin', name: 'Dublin' },
    ],
    teams: [
      { id: 1, code: 'infrastructure', name: 'Infrastructure' },
      { id: 2, code: 'applications', name: 'Applications' },
      { id: 3, code: 'governance-vendor', name: 'Governance & Vendor' },
      { id: 4, code: 'model-processes', name: 'Model & Processes' },
    ],
    suppliers: [
      { id: 1, code: 'sap', name: 'SAP' },
      { id: 2, code: 'acumant', name: 'Acumant05' },
      { id: 3, code: 'google', name: 'Google Cloud' },
      { id: 4, code: 'accenture1', name: 'Accenture1' },
      { id: 5, code: 'msft-azure', name: 'MSFT Azure' },
      { id: 6, code: 'abb', name: 'ABB' },
    ],
    currencies: [
      { id: 1, code: 'GBP', name: 'British Pound' },
      { id: 2, code: 'EUR', name: 'Euro' },
      { id: 3, code: 'USD', name: 'US Dollar' },
    ],
    scenarios: [
      { id: 1, code: 'BUD', name: 'Budget', year: 2026, isReadOnly: true },
      { id: 2, code: 'FC', name: 'Forecast', year: 2026, isReadOnly: false },
      { id: 3, code: 'ACT', name: 'Actual', year: 2026, isReadOnly: true },
      { id: 4, code: 'RFC1', name: 'Forecast', year: 2026, isReadOnly: true },
      { id: 5, code: 'RFC3', name: 'Forecast', year: 2025, isReadOnly: true },
    ],
    'spend-layers': [
      { id: 1, code: 'run', name: 'Run' },
      { id: 2, code: 'grow', name: 'Grow' },
      { id: 3, code: 'transform', name: 'Transform' },
    ],
    'spend-types': [
      { id: 1, code: 'subscription', name: 'Subscription' },
      { id: 2, code: 'service', name: 'Service' },
      { id: 3, code: 'maintenance', name: 'Maintenance' },
      { id: 4, code: 'capex', name: 'CapEx' },
    ],
    systems: [
      { id: 1, code: 'sap', name: 'SAP' },
      { id: 2, code: 'azure', name: 'Azure' },
      { id: 3, code: 'servicenow', name: 'ServiceNow' },
      { id: 4, code: 'salesforce', name: 'Salesforce' },
    ],
    roles: [
      { id: 1, code: 'admin', name: 'Admin' },
      { id: 2, code: 'accounting', name: 'Accounting Department' },
      { id: 3, code: 'dept-head', name: 'Department Head' },
      { id: 4, code: 'viewer', name: 'Viewer' },
    ],
    categories: [
      { id: 1, code: 'it-subscriptions', name: 'IT Subscriptions' },
      { id: 2, code: 'it-outsource', name: 'IT Outsource' },
      { id: 3, code: 'software-licensing', name: 'Software Licensing' },
      { id: 4, code: 'cloud-services', name: 'Cloud Services' },
    ],
    accounts: [
      { id: 1, code: 'gl-6100', name: 'GL 6100 - Software Licences' },
      { id: 2, code: 'gl-6200', name: 'GL 6200 - Cloud Services' },
      { id: 3, code: 'gl-6300', name: 'GL 6300 - Professional Services' },
      { id: 4, code: 'gl-7200', name: 'GL 7200 - Infrastructure Investment' },
    ],
    'internal-orders/all': [
      { id: 1, code: 'IO1', name: 'IO1 - Core Platform' },
      { id: 2, code: 'IO2', name: 'IO2 - Data Services' },
      { id: 3, code: 'IO3', name: 'IO3 - Integrations' },
      { id: 4, code: 'IO5', name: 'IO5 - Reporting' },
    ],
  };

  private nextId = 100;

  private rows(path: string): LookupItemDto[] {
    if (!this.store[path]) this.store[path] = [];
    return this.store[path];
  }

  private list(path: string): Observable<LookupItemDto[]> {
    // A copy, so a caller mutating what it renders cannot corrupt the store.
    return of(this.rows(path).map(r => ({ ...r }))).pipe(delay(120));
  }

  private add(path: string, payload: LookupItemPayload): Observable<LookupItemDto> {
    const created: LookupItemDto = {
      id: this.nextId++,
      code: payload.code,
      name: payload.name,
    } as LookupItemDto;
    this.rows(path).push(created);
    return of({ ...created }).pipe(delay(120));
  }

  private update(path: string, id: number, payload: LookupItemPayload): Observable<boolean> {
    const row = this.rows(path).filter(r => r.id === id)[0];
    if (row) {
      row.code = payload.code;
      row.name = payload.name;
    }
    return of(!!row).pipe(delay(120));
  }

  private remove(path: string, id: number, lastUpdatedBy: string): Observable<boolean> {
    const rows = this.rows(path);
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) rows.splice(idx, 1);
    return of(idx >= 0).pipe(delay(120));
  }
}
