// ─────────────────────────────────────────────────────────────────────────────
// FORECAST CONSTANTS
// All application data and API configuration lives here.
// TODO: When the backend is ready, replace each MOCK_ export with an HTTP
//       call using the matching API_ENDPOINTS entry.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Type Definitions ────────────────────────────────────────────────────────

export type SubRowType =
  | 'contract'
  | 'contract-actual'
  | 'local'
  | 'actual'
  | 'other-scenario'
  | 'recharge'
  | 'recharge-actual'
  | 'recharge-other-scenario';

export interface SubRow {
  type: SubRowType;
  label: string;
  currency: string;
  values: (number | null)[];
  /** true for 'actual' / 'recharge-actual' rows – populated by the backend, not user-editable */
  readOnly?: boolean;
}

export interface ForecastRow {
  id: number;
  internalOrder: string;
  par: string;              // Project Authorization Request reference
  spendType: string;
  spendLayer: string;
  system: string;
  team: string;
  type: string;             // 'OPEX' | 'CAPEX'
  category: string;
  supplier: string;
  description: string;       // "Item Desc" column
  currency: string;         // site / local currency code
  contractCurrency: string; // currency of the underlying contract
  differentCurrency: boolean;
  rechargeRequired: boolean;
  subRows: SubRow[];
  site?: string;
  account?: string;
  isHovered?: boolean;
}

export interface ForecastFilters {
  site:     string;
  team:     string;
  account:  string;
  scenario: string;
  type:     string;
  category: string;
  supplier: string;
  currency: string;
}

export interface ForecastToggles {
  showActual:         boolean;
  showOtherScenario:  boolean;
  showSourceCurrency: boolean;
}

// ─── API Configuration ────────────────────────────────────────────────────────
// TODO: Set API_BASE_URL to your real base URL when the backend is ready.
export const API_BASE_URL = '';   // e.g. 'https://api.yourapp.com'

export const API_ENDPOINTS = {
  forecast: {
    /** GET    /api/v1/forecast         → ForecastRow[]  */
    getAll:   () => `${API_BASE_URL}/api/v1/forecast`,
    /** GET    /api/v1/forecast/:id     → ForecastRow    */
    getById:  (id: number) => `${API_BASE_URL}/api/v1/forecast/${id}`,
    /** POST   /api/v1/forecast         ← ForecastRow (new row) */
    create:   () => `${API_BASE_URL}/api/v1/forecast`,
    /** PUT    /api/v1/forecast/:id     ← ForecastRow   */
    update:   (id: number) => `${API_BASE_URL}/api/v1/forecast/${id}`,
    /** DELETE /api/v1/forecast/:id                     */
    delete:   (id: number) => `${API_BASE_URL}/api/v1/forecast/${id}`,
    /** POST   /api/v1/forecast/bulk    ← ForecastRow[] (save all at once) */
    bulkSave: () => `${API_BASE_URL}/api/v1/forecast/bulk`,
  },
  master: {
    /** GET /api/v1/master/sites      → string[]           */
    sites:     () => `${API_BASE_URL}/api/v1/master/sites`,
    /** GET /api/v1/master/teams      → string[]           */
    teams:     () => `${API_BASE_URL}/api/v1/master/teams`,
    /** GET /api/v1/master/accounts   → { id, name }[]    */
    accounts:  () => `${API_BASE_URL}/api/v1/master/accounts`,
    /** GET /api/v1/master/scenarios  → string[]           */
    scenarios: () => `${API_BASE_URL}/api/v1/master/scenarios`,
    /** GET /api/v1/master/suppliers  → string[]           */
    suppliers: () => `${API_BASE_URL}/api/v1/master/suppliers`,
  }
};

// ─── Master / Reference Data ──────────────────────────────────────────────────
// TODO: Load each from its API_ENDPOINTS.master.* endpoint when ready.

export const MONTHS       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const SITES        = ['EMEA Operations','APAC Operations','US Operations','Global'];
export const TEAMS        = ['Digital','Operations','Finance','Projects','Logistics Hub A','Procurement'];
export const TYPES        = ['OPEX','CAPEX'];
export const CATEGORIES   = ['Software','Infrastructure','Consulting','Services','Hardware','Licensing'];
export const SUPPLIERS    = ['Microsoft','AWS','Deloitte','Accenture','Oracle','SAP','IBM'];
export const SPEND_TYPES  = ['Run','Grow','Transform'];
export const SPEND_LAYERS = ['Infrastructure','Platform','Application','End User'];
export const SYSTEMS       = ['SAP','Salesforce','Workday','ServiceNow','Azure','AWS','Oracle ERP'];
export const CURRENCIES   = ['AUD','USD','EUR','GBP'];
export const ACCOUNTS     = ['62000 - IT Services','61000 - Operations','63000 - Finance','64000 - Projects','65000 - Procurement'];
export const SCENARIOS    = ['Q3 Forecast 2025','Q4 Forecast 2025','Budget 2025','Actuals YTD'];

// ─── Default State ────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS: ForecastFilters = {
  // Empty by default → `filteredForecastRows` returns every row (no filter
  // is applied unless the user actively picks a value from the chip dropdowns).
  site:     '',
  team:     '',
  account:  '',
  scenario: '',
  type:     '',
  category: '',
  supplier: '',
  currency: '',
};

export const DEFAULT_TOGGLES: ForecastToggles = {
  showActual:         true,
  showOtherScenario:  false,
  showSourceCurrency: false,
};

// ─── Helper: build blank sub-rows for a new row ───────────────────────────────

export function buildDefaultSubRows(currency: string, contractCurrency = 'USD'): SubRow[] {
  return [
    { type: 'local',                   label: 'Forecast',                       currency,                   values: Array(12).fill(null) },
    { type: 'contract',                label: 'Forecasted in Contract Currency',  currency: contractCurrency, values: Array(12).fill(null) },
    { type: 'actual',                  label: 'Actual',                         currency,                   values: Array(12).fill(null), readOnly: true },
    { type: 'contract-actual',         label: 'Actual in Contract Currency',    currency: contractCurrency, values: Array(12).fill(null), readOnly: true },
    { type: 'other-scenario',          label: 'Other Scenario',             currency,              values: Array(12).fill(null) },
    { type: 'recharge',                label: 'Recharge',                  currency,              values: Array(12).fill(null) },
    { type: 'recharge-actual',         label: 'Actual',                    currency,              values: Array(12).fill(null), readOnly: true },
    { type: 'recharge-other-scenario', label: 'Other Scenario',            currency,              values: Array(12).fill(null) },
  ];
}

// ─── Mock / Hardcoded Data ────────────────────────────────────────────────────
// TODO: Replace with → this.http.get<ForecastRow[]>(API_ENDPOINTS.forecast.getAll())
//       Map the API response to the ForecastRow[] shape and assign to forecastRows.

export const MOCK_FORECAST_ROWS: ForecastRow[] = [
  {
    id: 1,
    internalOrder: 'IO-4001',
    par: 'PAR-1001',
    spendType: 'Run',
    spendLayer: 'Infrastructure',
    system: 'Azure',
    team: 'Digital',
    type: 'OPEX',
    category: 'Software',
    supplier: 'Microsoft',
    description: 'Azure Cloud Services',
    currency: 'GBP',
    contractCurrency: 'USD',
    differentCurrency: true,
    rechargeRequired: true,
    site: 'EMEA Operations',
    account: '62000 - IT Services',
    subRows: [
      { type: 'local',                   label: 'Forecast',                 currency: 'GBP', values: [8.5,  8.5,  8.5,  8.5,  8.5,  8.5,  8.5,  8.5,  8.5,  8.5,  8.5,  8.5 ] },
      { type: 'contract',                label: 'Forecasted in Contract Currency', currency: 'USD', values: [10,   10,   10,   10,   10,   10,   10,   10,   10,   10,   10,   10  ] },
      { type: 'actual',                  label: 'Actual',                   currency: 'GBP', values: [8.4,  8.4,  6.5,  8.6,  null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'contract-actual',         label: 'Actual in Contract Currency', currency: 'USD', values: [9.9,  9.9,  7.6,  10.1, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'other-scenario',          label: 'Other Scenario',            currency: 'GBP', values: Array(12).fill(null) },
      { type: 'recharge',                label: 'Recharge',                 currency: 'GBP', values: [7.5,  7.5,  7.5,  7.5,  7.5,  7.5,  7.5,  7.5,  7.5,  7.5,  7.5,  7.5 ] },
      { type: 'recharge-actual',         label: 'Actual',                   currency: 'GBP', values: [2.00, 2.00, 1.90, 1.80, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'recharge-other-scenario', label: 'Other Scenario',           currency: 'GBP', values: Array(12).fill(null) },
    ]
  },
  {
    id: 2,
    internalOrder: 'IO-4002',
    par: 'PAR-1002',
    spendType: 'Grow',
    spendLayer: 'Infrastructure',
    system: 'AWS',
    team: 'Operations',
    type: 'CAPEX',
    category: 'Infrastructure',
    supplier: 'AWS',
    description: 'Server Hardware Upgrade',
    currency: 'GBP',
    contractCurrency: 'USD',
    differentCurrency: true,
    rechargeRequired: false,
    site: 'EMEA Operations',
    account: '62000 - IT Services',
    subRows: [
      { type: 'local',                   label: 'Forecast',                 currency: 'GBP', values: [12,   12,   12,   15,   15,   15,   18,   18,   18,   20,   20,   20  ] },
      { type: 'contract',                label: 'Forecasted in Contract Currency', currency: 'USD', values: [15,   15,   15,   15,   15,   15,   15,   15,   15,   15,   15,   15  ] },
      { type: 'actual',                  label: 'Actual',                   currency: 'GBP', values: [11.8, 12.1, 12.0, 14.8, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'contract-actual',         label: 'Actual in Contract Currency', currency: 'USD', values: [14.8, 15.1, 15.0, 18.5, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'other-scenario',          label: 'Other Scenario',            currency: 'GBP', values: Array(12).fill(null) },
      { type: 'recharge',                label: 'Recharge',                 currency: 'GBP', values: [11.5, 11.5, 11.5, 14.5, 14.5, 14.5, 17.5, 17.5, 17.5, 19.5, 19.5, 19.5] },
      { type: 'recharge-actual',         label: 'Actual',                   currency: 'GBP', values: [null, null, null, null, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'recharge-other-scenario', label: 'Other Scenario',           currency: 'GBP', values: Array(12).fill(null) },
    ]
  },
  {
    id: 3,
    internalOrder: 'IO-4003',
    par: 'PAR-1003',
    spendType: 'Transform',
    spendLayer: 'Application',
    system: 'SAP',
    team: 'Finance',
    type: 'OPEX',
    category: 'Consulting',
    supplier: 'Deloitte',
    description: 'ERP Implementation Support',
    currency: 'GBP',
    contractCurrency: 'GBP',
    differentCurrency: false,
    rechargeRequired: false,
    site: 'EMEA Operations',
    account: '63000 - Finance',
    subRows: [
      { type: 'local',                   label: 'Forecast',                 currency: 'GBP', values: [25,   25,   30,   30,   35,   35,   28,   28,   32,   32,   27,   27  ] },
      { type: 'contract',                label: 'Forecasted in Contract Currency', currency: 'GBP', values: [25,   25,   30,   30,   35,   35,   28,   28,   32,   32,   27,   27  ] },
      { type: 'actual',                  label: 'Actual',                   currency: 'GBP', values: [24.5, 25.2, 29.8, 30.1, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'contract-actual',         label: 'Actual in Contract Currency', currency: 'GBP', values: [24.5, 25.2, 29.8, 30.1, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'other-scenario',          label: 'Other Scenario',            currency: 'GBP', values: [5,    null, null, null, null, null, null, null, null, null, null, 5   ] },
      { type: 'recharge',                label: 'Recharge',                 currency: 'GBP', values: [24,   24,   29,   29,   34,   34,   27,   27,   31,   31,   26,   26  ] },
      { type: 'recharge-actual',         label: 'Actual',                   currency: 'GBP', values: [null, null, null, null, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'recharge-other-scenario', label: 'Other Scenario',           currency: 'GBP', values: Array(12).fill(null) },
    ]
  },
  {
    id: 4,
    internalOrder: 'IO-4004',
    par: 'PAR-1004',
    spendType: 'Run',
    spendLayer: 'Platform',
    system: 'ServiceNow',
    team: 'Projects',
    type: 'CAPEX',
    category: 'Services',
    supplier: 'Accenture',
    description: 'Entitlement Support',
    currency: 'GBP',
    contractCurrency: 'USD',
    differentCurrency: true,
    rechargeRequired: true,
    site: 'APAC Operations',
    account: '64000 - Projects',
    subRows: [
      { type: 'local',                   label: 'Forecast',                 currency: 'GBP', values: [8,    8,    9.5,  9.5,  11,   11,   10,   10,   12,   12,   9,    9   ] },
      { type: 'contract',                label: 'Forecasted in Contract Currency', currency: 'USD', values: [10,   10,   12,   12,   14,   14,   12,   12,   15,   15,   11,   11  ] },
      { type: 'actual',                  label: 'Actual',                   currency: 'GBP', values: [7.9,  8.1,  9.3,  9.6,  null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'contract-actual',         label: 'Actual in Contract Currency', currency: 'USD', values: [9.9,  10.1, 11.7, 12.1, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'other-scenario',          label: 'Other Scenario',            currency: 'GBP', values: Array(12).fill(null) },
      { type: 'recharge',                label: 'Recharge',                 currency: 'GBP', values: [7.7,  7.7,  9.2,  9.2,  10.7, 10.7, 9.7,  9.7,  11.7, 11.7, 8.7,  8.7 ] },
      { type: 'recharge-actual',         label: 'Actual',                   currency: 'GBP', values: [null, null, null, null, null, null, null, null, null, null, null, null], readOnly: true },
      { type: 'recharge-other-scenario', label: 'Other Scenario',           currency: 'GBP', values: Array(12).fill(null) },
    ]
  },
];
