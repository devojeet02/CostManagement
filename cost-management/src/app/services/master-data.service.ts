import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
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
  /** Sites: the region the site sits in. Countries: the parent region the Admin screen cascades on. */
  regionId?: number | null;
  regionName?: string | null;
  countryId?: number | null;
  countryName?: string | null;
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

/** Payload for POST/PUT on Site - the only lookup carrying a currency and an org hierarchy. ⚠️ regionId is ignored whenever countryId is set: the country's own region is stored, so the two can never disagree. */
export interface SitePayload extends LookupItemPayload {
  currencyId?: number | null;
  regionId?: number | null;
  countryId?: number | null;
}

/** What a country move actually did. sitesResynced is the number worth showing: it is the silent half of the operation. */
export interface ReassignResult {
  countriesMoved: number;
  sitesResynced: number;
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
  getSites(): Observable<LookupItemDto[]> {
    // The grid prints the region/country NAMES, which the API denormalises onto the row.
    return of(this.rows('sites').map(r => ({
      ...r,
      regionName: this.rows('regions').filter(x => x.id === r.regionId).map(x => x.name)[0] ?? null,
      countryName: this.rows('countries').filter(x => x.id === r.countryId).map(x => x.name)[0] ?? null,
    }))).pipe(delay(120));
  }

  getRegions(): Observable<LookupItemDto[]> { return this.list('regions'); }
  getCountries(): Observable<LookupItemDto[]> { return this.list('countries'); }
  getCountriesByRegion(regionId: number): Observable<LookupItemDto[]> {
    return of(this.rows('countries').filter(c => c.regionId === regionId).map(c => ({ ...c }))).pipe(delay(120));
  }
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
  addSite(payload: SitePayload): Observable<LookupItemDto> {
    const created: LookupItemDto = { id: this.nextId++, code: payload.code, name: payload.name, currencyId: payload.currencyId ?? null };
    this.applyHierarchy(created, payload);
    this.rows('sites').push(created);
    return of({ ...created }).pipe(delay(120));
  }

  updateSite(id: number, payload: SitePayload): Observable<boolean> {
    const row = this.rows('sites').filter(r => r.id === id)[0];
    if (row) {
      row.code = payload.code;
      row.name = payload.name;
      row.currencyId = payload.currencyId ?? null;
      this.applyHierarchy(row, payload);
    }
    return of(!!row).pipe(delay(120));
  }

  // ---- writes: Region (countries are a seeded ISO list and stay read-only) ----
  addRegion(payload: LookupItemPayload): Observable<LookupItemDto> {
    if (this.regionCodeTaken(payload.code, null)) return this.conflict(`A region with the code '${payload.code}' already exists.`);
    const created: LookupItemDto = { id: this.nextId++, code: payload.code, name: payload.name };
    this.rows('regions').push(created);
    return of({ ...created }).pipe(delay(120));
  }

  updateRegion(id: number, payload: LookupItemPayload): Observable<boolean> {
    if (this.regionCodeTaken(payload.code, id)) return this.conflict(`The code '${payload.code}' is already used by another region.`);
    const row = this.rows('regions').filter(r => r.id === id)[0];
    if (row) { row.code = payload.code; row.name = payload.name; }
    return of(!!row).pipe(delay(120));
  }

  /** ⚠️ Refused while any country or site still belongs to the region - deleting it anyway would leave them pointing at a region that no longer resolves. */
  deleteRegion(id: number, lastUpdatedBy: string): Observable<boolean> {
    const countries = this.rows('countries').filter(c => c.regionId === id).length;
    const sites = this.rows('sites').filter(x => x.regionId === id).length;
    if (countries || sites) {
      const parts: string[] = [];
      if (countries) parts.push(`${countries} countr${countries === 1 ? 'y' : 'ies'}`);
      if (sites) parts.push(`${sites} site${sites === 1 ? '' : 's'}`);
      return this.conflict(`This region cannot be deleted - ${parts.join(' and ')} still belong to it. Move them to another region first, then delete it.`);
    }
    const rows = this.rows('regions');
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) rows.splice(idx, 1);
    return of(idx >= 0).pipe(delay(120));
  }

  /** Moves countries into a region AND re-points every site bound to them, because a site's region is a denormalised copy of its country's. */
  reassignCountries(regionId: number, countryIds: number[], lastUpdatedBy: string): Observable<ReassignResult> {
    const moving = this.rows('countries').filter(c => countryIds.indexOf(c.id) >= 0);
    const moved = moving.filter(c => c.regionId !== regionId);
    moved.forEach(c => c.regionId = regionId);

    const movedIds = moving.map(c => c.id);
    const sites = this.rows('sites').filter(x => x.countryId != null && movedIds.indexOf(x.countryId) >= 0 && x.regionId !== regionId);
    sites.forEach(x => x.regionId = regionId);

    return of({ countriesMoved: moved.length, sitesResynced: sites.length }).pipe(delay(140));
  }
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
    // Regions are user-maintainable (add / rename / delete from the Admin Site panel); countries
    // are the seeded ISO 3166-1 list and have no write path, because editing them invites exactly
    // the spelling drift their codes exist to prevent.
    regions: [
      { id: 1, code: 'AMER', name: 'Americas' },
      { id: 2, code: 'EMEA', name: 'EMEA' },
      { id: 3, code: 'APAC', name: 'APAC' },
    ],
    countries: [
    { id: 1, code: 'AL', name: 'Albania', regionId: 2 },
    { id: 2, code: 'AD', name: 'Andorra', regionId: 2 },
    { id: 3, code: 'AT', name: 'Austria', regionId: 2 },
    { id: 4, code: 'BY', name: 'Belarus', regionId: 2 },
    { id: 5, code: 'BE', name: 'Belgium', regionId: 2 },
    { id: 6, code: 'BA', name: 'Bosnia and Herzegovina', regionId: 2 },
    { id: 7, code: 'BG', name: 'Bulgaria', regionId: 2 },
    { id: 8, code: 'HR', name: 'Croatia', regionId: 2 },
    { id: 9, code: 'CY', name: 'Cyprus', regionId: 2 },
    { id: 10, code: 'CZ', name: 'Czechia', regionId: 2 },
    { id: 11, code: 'DK', name: 'Denmark', regionId: 2 },
    { id: 12, code: 'EE', name: 'Estonia', regionId: 2 },
    { id: 13, code: 'FI', name: 'Finland', regionId: 2 },
    { id: 14, code: 'FR', name: 'France', regionId: 2 },
    { id: 15, code: 'DE', name: 'Germany', regionId: 2 },
    { id: 16, code: 'GR', name: 'Greece', regionId: 2 },
    { id: 17, code: 'HU', name: 'Hungary', regionId: 2 },
    { id: 18, code: 'IS', name: 'Iceland', regionId: 2 },
    { id: 19, code: 'IE', name: 'Ireland', regionId: 2 },
    { id: 20, code: 'IT', name: 'Italy', regionId: 2 },
    { id: 21, code: 'XK', name: 'Kosovo', regionId: 2 },
    { id: 22, code: 'LV', name: 'Latvia', regionId: 2 },
    { id: 23, code: 'LI', name: 'Liechtenstein', regionId: 2 },
    { id: 24, code: 'LT', name: 'Lithuania', regionId: 2 },
    { id: 25, code: 'LU', name: 'Luxembourg', regionId: 2 },
    { id: 26, code: 'MT', name: 'Malta', regionId: 2 },
    { id: 27, code: 'MD', name: 'Moldova', regionId: 2 },
    { id: 28, code: 'MC', name: 'Monaco', regionId: 2 },
    { id: 29, code: 'ME', name: 'Montenegro', regionId: 2 },
    { id: 30, code: 'NL', name: 'Netherlands', regionId: 2 },
    { id: 31, code: 'MK', name: 'North Macedonia', regionId: 2 },
    { id: 32, code: 'NO', name: 'Norway', regionId: 2 },
    { id: 33, code: 'PL', name: 'Poland', regionId: 2 },
    { id: 34, code: 'PT', name: 'Portugal', regionId: 2 },
    { id: 35, code: 'RO', name: 'Romania', regionId: 2 },
    { id: 36, code: 'RU', name: 'Russia', regionId: 2 },
    { id: 37, code: 'SM', name: 'San Marino', regionId: 2 },
    { id: 38, code: 'RS', name: 'Serbia', regionId: 2 },
    { id: 39, code: 'SK', name: 'Slovakia', regionId: 2 },
    { id: 40, code: 'SI', name: 'Slovenia', regionId: 2 },
    { id: 41, code: 'ES', name: 'Spain', regionId: 2 },
    { id: 42, code: 'SE', name: 'Sweden', regionId: 2 },
    { id: 43, code: 'CH', name: 'Switzerland', regionId: 2 },
    { id: 44, code: 'UA', name: 'Ukraine', regionId: 2 },
    { id: 45, code: 'GB', name: 'United Kingdom', regionId: 2 },
    { id: 46, code: 'VA', name: 'Vatican City', regionId: 2 },
    { id: 47, code: 'AM', name: 'Armenia', regionId: 2 },
    { id: 48, code: 'AZ', name: 'Azerbaijan', regionId: 2 },
    { id: 49, code: 'BH', name: 'Bahrain', regionId: 2 },
    { id: 50, code: 'GE', name: 'Georgia', regionId: 2 },
    { id: 51, code: 'IR', name: 'Iran', regionId: 2 },
    { id: 52, code: 'IQ', name: 'Iraq', regionId: 2 },
    { id: 53, code: 'IL', name: 'Israel', regionId: 2 },
    { id: 54, code: 'JO', name: 'Jordan', regionId: 2 },
    { id: 55, code: 'KW', name: 'Kuwait', regionId: 2 },
    { id: 56, code: 'LB', name: 'Lebanon', regionId: 2 },
    { id: 57, code: 'OM', name: 'Oman', regionId: 2 },
    { id: 58, code: 'PS', name: 'Palestine', regionId: 2 },
    { id: 59, code: 'QA', name: 'Qatar', regionId: 2 },
    { id: 60, code: 'SA', name: 'Saudi Arabia', regionId: 2 },
    { id: 61, code: 'SY', name: 'Syria', regionId: 2 },
    { id: 62, code: 'TR', name: 'Turkiye', regionId: 2 },
    { id: 63, code: 'AE', name: 'United Arab Emirates', regionId: 2 },
    { id: 64, code: 'YE', name: 'Yemen', regionId: 2 },
    { id: 65, code: 'DZ', name: 'Algeria', regionId: 2 },
    { id: 66, code: 'AO', name: 'Angola', regionId: 2 },
    { id: 67, code: 'BJ', name: 'Benin', regionId: 2 },
    { id: 68, code: 'BW', name: 'Botswana', regionId: 2 },
    { id: 69, code: 'BF', name: 'Burkina Faso', regionId: 2 },
    { id: 70, code: 'BI', name: 'Burundi', regionId: 2 },
    { id: 71, code: 'CV', name: 'Cabo Verde', regionId: 2 },
    { id: 72, code: 'CM', name: 'Cameroon', regionId: 2 },
    { id: 73, code: 'CF', name: 'Central African Republic', regionId: 2 },
    { id: 74, code: 'TD', name: 'Chad', regionId: 2 },
    { id: 75, code: 'KM', name: 'Comoros', regionId: 2 },
    { id: 76, code: 'CG', name: 'Congo', regionId: 2 },
    { id: 77, code: 'CD', name: 'Congo (DRC)', regionId: 2 },
    { id: 78, code: 'CI', name: 'Cote d’Ivoire', regionId: 2 },
    { id: 79, code: 'DJ', name: 'Djibouti', regionId: 2 },
    { id: 80, code: 'EG', name: 'Egypt', regionId: 2 },
    { id: 81, code: 'GQ', name: 'Equatorial Guinea', regionId: 2 },
    { id: 82, code: 'ER', name: 'Eritrea', regionId: 2 },
    { id: 83, code: 'SZ', name: 'Eswatini', regionId: 2 },
    { id: 84, code: 'ET', name: 'Ethiopia', regionId: 2 },
    { id: 85, code: 'GA', name: 'Gabon', regionId: 2 },
    { id: 86, code: 'GM', name: 'Gambia', regionId: 2 },
    { id: 87, code: 'GH', name: 'Ghana', regionId: 2 },
    { id: 88, code: 'GN', name: 'Guinea', regionId: 2 },
    { id: 89, code: 'GW', name: 'Guinea-Bissau', regionId: 2 },
    { id: 90, code: 'KE', name: 'Kenya', regionId: 2 },
    { id: 91, code: 'LS', name: 'Lesotho', regionId: 2 },
    { id: 92, code: 'LR', name: 'Liberia', regionId: 2 },
    { id: 93, code: 'LY', name: 'Libya', regionId: 2 },
    { id: 94, code: 'MG', name: 'Madagascar', regionId: 2 },
    { id: 95, code: 'MW', name: 'Malawi', regionId: 2 },
    { id: 96, code: 'ML', name: 'Mali', regionId: 2 },
    { id: 97, code: 'MR', name: 'Mauritania', regionId: 2 },
    { id: 98, code: 'MU', name: 'Mauritius', regionId: 2 },
    { id: 99, code: 'MA', name: 'Morocco', regionId: 2 },
    { id: 100, code: 'MZ', name: 'Mozambique', regionId: 2 },
    { id: 101, code: 'NA', name: 'Namibia', regionId: 2 },
    { id: 102, code: 'NE', name: 'Niger', regionId: 2 },
    { id: 103, code: 'NG', name: 'Nigeria', regionId: 2 },
    { id: 104, code: 'RW', name: 'Rwanda', regionId: 2 },
    { id: 105, code: 'ST', name: 'Sao Tome and Principe', regionId: 2 },
    { id: 106, code: 'SN', name: 'Senegal', regionId: 2 },
    { id: 107, code: 'SC', name: 'Seychelles', regionId: 2 },
    { id: 108, code: 'SL', name: 'Sierra Leone', regionId: 2 },
    { id: 109, code: 'SO', name: 'Somalia', regionId: 2 },
    { id: 110, code: 'ZA', name: 'South Africa', regionId: 2 },
    { id: 111, code: 'SS', name: 'South Sudan', regionId: 2 },
    { id: 112, code: 'SD', name: 'Sudan', regionId: 2 },
    { id: 113, code: 'TZ', name: 'Tanzania', regionId: 2 },
    { id: 114, code: 'TG', name: 'Togo', regionId: 2 },
    { id: 115, code: 'TN', name: 'Tunisia', regionId: 2 },
    { id: 116, code: 'UG', name: 'Uganda', regionId: 2 },
    { id: 117, code: 'ZM', name: 'Zambia', regionId: 2 },
    { id: 118, code: 'ZW', name: 'Zimbabwe', regionId: 2 },
    { id: 119, code: 'AG', name: 'Antigua and Barbuda', regionId: 1 },
    { id: 120, code: 'AR', name: 'Argentina', regionId: 1 },
    { id: 121, code: 'BS', name: 'Bahamas', regionId: 1 },
    { id: 122, code: 'BB', name: 'Barbados', regionId: 1 },
    { id: 123, code: 'BZ', name: 'Belize', regionId: 1 },
    { id: 124, code: 'BO', name: 'Bolivia', regionId: 1 },
    { id: 125, code: 'BR', name: 'Brazil', regionId: 1 },
    { id: 126, code: 'CA', name: 'Canada', regionId: 1 },
    { id: 127, code: 'CL', name: 'Chile', regionId: 1 },
    { id: 128, code: 'CO', name: 'Colombia', regionId: 1 },
    { id: 129, code: 'CR', name: 'Costa Rica', regionId: 1 },
    { id: 130, code: 'CU', name: 'Cuba', regionId: 1 },
    { id: 131, code: 'DM', name: 'Dominica', regionId: 1 },
    { id: 132, code: 'DO', name: 'Dominican Republic', regionId: 1 },
    { id: 133, code: 'EC', name: 'Ecuador', regionId: 1 },
    { id: 134, code: 'SV', name: 'El Salvador', regionId: 1 },
    { id: 135, code: 'GD', name: 'Grenada', regionId: 1 },
    { id: 136, code: 'GT', name: 'Guatemala', regionId: 1 },
    { id: 137, code: 'GY', name: 'Guyana', regionId: 1 },
    { id: 138, code: 'HT', name: 'Haiti', regionId: 1 },
    { id: 139, code: 'HN', name: 'Honduras', regionId: 1 },
    { id: 140, code: 'JM', name: 'Jamaica', regionId: 1 },
    { id: 141, code: 'MX', name: 'Mexico', regionId: 1 },
    { id: 142, code: 'NI', name: 'Nicaragua', regionId: 1 },
    { id: 143, code: 'PA', name: 'Panama', regionId: 1 },
    { id: 144, code: 'PY', name: 'Paraguay', regionId: 1 },
    { id: 145, code: 'PE', name: 'Peru', regionId: 1 },
    { id: 146, code: 'KN', name: 'Saint Kitts and Nevis', regionId: 1 },
    { id: 147, code: 'LC', name: 'Saint Lucia', regionId: 1 },
    { id: 148, code: 'VC', name: 'Saint Vincent and the Grenadines', regionId: 1 },
    { id: 149, code: 'SR', name: 'Suriname', regionId: 1 },
    { id: 150, code: 'TT', name: 'Trinidad and Tobago', regionId: 1 },
    { id: 151, code: 'US', name: 'United States', regionId: 1 },
    { id: 152, code: 'UY', name: 'Uruguay', regionId: 1 },
    { id: 153, code: 'VE', name: 'Venezuela', regionId: 1 },
    { id: 154, code: 'AF', name: 'Afghanistan', regionId: 3 },
    { id: 155, code: 'BD', name: 'Bangladesh', regionId: 3 },
    { id: 156, code: 'BT', name: 'Bhutan', regionId: 3 },
    { id: 157, code: 'BN', name: 'Brunei', regionId: 3 },
    { id: 158, code: 'KH', name: 'Cambodia', regionId: 3 },
    { id: 159, code: 'CN', name: 'China', regionId: 3 },
    { id: 160, code: 'IN', name: 'India', regionId: 3 },
    { id: 161, code: 'ID', name: 'Indonesia', regionId: 3 },
    { id: 162, code: 'JP', name: 'Japan', regionId: 3 },
    { id: 163, code: 'KZ', name: 'Kazakhstan', regionId: 3 },
    { id: 164, code: 'KP', name: 'North Korea', regionId: 3 },
    { id: 165, code: 'KR', name: 'South Korea', regionId: 3 },
    { id: 166, code: 'KG', name: 'Kyrgyzstan', regionId: 3 },
    { id: 167, code: 'LA', name: 'Laos', regionId: 3 },
    { id: 168, code: 'MY', name: 'Malaysia', regionId: 3 },
    { id: 169, code: 'MV', name: 'Maldives', regionId: 3 },
    { id: 170, code: 'MN', name: 'Mongolia', regionId: 3 },
    { id: 171, code: 'MM', name: 'Myanmar', regionId: 3 },
    { id: 172, code: 'NP', name: 'Nepal', regionId: 3 },
    { id: 173, code: 'PK', name: 'Pakistan', regionId: 3 },
    { id: 174, code: 'PH', name: 'Philippines', regionId: 3 },
    { id: 175, code: 'SG', name: 'Singapore', regionId: 3 },
    { id: 176, code: 'LK', name: 'Sri Lanka', regionId: 3 },
    { id: 177, code: 'TJ', name: 'Tajikistan', regionId: 3 },
    { id: 178, code: 'TH', name: 'Thailand', regionId: 3 },
    { id: 179, code: 'TL', name: 'Timor-Leste', regionId: 3 },
    { id: 180, code: 'TM', name: 'Turkmenistan', regionId: 3 },
    { id: 181, code: 'UZ', name: 'Uzbekistan', regionId: 3 },
    { id: 182, code: 'VN', name: 'Vietnam', regionId: 3 },
    { id: 183, code: 'AU', name: 'Australia', regionId: 3 },
    { id: 184, code: 'FJ', name: 'Fiji', regionId: 3 },
    { id: 185, code: 'KI', name: 'Kiribati', regionId: 3 },
    { id: 186, code: 'MH', name: 'Marshall Islands', regionId: 3 },
    { id: 187, code: 'FM', name: 'Micronesia', regionId: 3 },
    { id: 188, code: 'NR', name: 'Nauru', regionId: 3 },
    { id: 189, code: 'NZ', name: 'New Zealand', regionId: 3 },
    { id: 190, code: 'PW', name: 'Palau', regionId: 3 },
    { id: 191, code: 'PG', name: 'Papua New Guinea', regionId: 3 },
    { id: 192, code: 'WS', name: 'Samoa', regionId: 3 },
    { id: 193, code: 'SB', name: 'Solomon Islands', regionId: 3 },
    { id: 194, code: 'TO', name: 'Tonga', regionId: 3 },
    { id: 195, code: 'TV', name: 'Tuvalu', regionId: 3 },
    { id: 196, code: 'VU', name: 'Vanuatu', regionId: 3 },
    ],
    sites: [
      // currencyId is NOT decoration: Invoice Upload offers only sites that have one, because a
      // site with no currency cannot price an invoice (it also drives the Site Currency AUTO
      // field). Leave it off and the Site lookup renders empty with no error anywhere.
      // Dublin deliberately has none — it is a recharge target only, which is what keeps the
      // 'All Sites' recharge list distinguishable from the processing-site list.
      { id: 1, code: 'uk', name: 'UK', currencyId: 1, regionId: 2, countryId: 45 },
      { id: 2, code: 'amsterdam', name: 'Amsterdam', currencyId: 2, regionId: 2, countryId: 30 },
      { id: 3, code: 'france', name: 'France', currencyId: 2, regionId: 2, countryId: 14 },
      { id: 4, code: 'usa', name: 'USA', currencyId: 3, regionId: 1, countryId: 151 },
      { id: 5, code: 'bradford', name: 'Bradford', currencyId: 1, regionId: 2, countryId: 45 },
      { id: 6, code: 'london-hq', name: 'London HQ', currencyId: 1, regionId: 2, countryId: 45 },
      { id: 7, code: 'manchester', name: 'Manchester', currencyId: 1, regionId: 2, countryId: 45 },
      { id: 8, code: 'dublin', name: 'Dublin', regionId: 2, countryId: 19 },
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

  private nextId = 300;

  /** The COUNTRY wins: a site's region is derived from it, so the denormalised copy cannot drift. */
  private applyHierarchy(row: LookupItemDto, payload: SitePayload): void {
    const country = this.rows('countries').filter(c => c.id === payload.countryId)[0];
    row.countryId = country ? country.id : null;
    row.regionId = country ? country.regionId ?? null : (payload.regionId ?? null);
  }

  private regionCodeTaken(code: string | undefined, excludeId: number | null): boolean {
    const wanted = (code || '').trim().toLowerCase();
    return this.rows('regions').some(r => r.id !== excludeId && (r.code || '').toLowerCase() === wanted);
  }

  /** Shaped like the API's 409/400 body, because that is what the screens read for their message. */
  private conflict<T>(message: string): Observable<T> {
    return throwError(() => ({ error: { error: message } })).pipe(delay(120)) as Observable<T>;
  }

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
