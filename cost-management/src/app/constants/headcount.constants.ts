// ─────────────────────────────────────────────────────────────────────────────
// HEADCOUNT CONSTANTS
// All application data and API configuration for the Headcount screen lives here.
// TODO: When the backend is ready, replace each MOCK_ export with an HTTP
//       call using the matching HC_API_ENDPOINTS entry.
//
// Domain rule: headcount is tracked as a BINARY value per employee per month
// (1 = present, 0 = absent) — never fractional. It follows the same Budget / RFC
// cycle as the financial forecast.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Type Definitions ────────────────────────────────────────────────────────

export type HcScenarioType = 'primary' | 'other';

export interface HcScenarioRow {
  type: HcScenarioType;
  /** Display label, e.g. 'RFC3 2026' or 'Budget 2026' */
  label: string;
  /** Binary presence per month (0 | 1 | null). */
  values: (number | null)[];
}

export interface HeadcountRow {
  id: number;
  region: string;
  country: string;
  site: string;
  /** Employee type: Full Time, Part Time, VIE, TBA */
  category: string;
  employee: string;
  /** Only meaningful for TBA (placeholder) rows — the role they will fill. */
  functionForTba: string;
  /** Free-text note shown in the Comments column. */
  comment: string;
  scenarioRows: HcScenarioRow[];
  isHovered?: boolean;
}

export interface HeadcountFilters {
  region:   string;
  country:  string;
  site:     string;
  category: string;
  scenario: string;
}

export interface HeadcountToggles {
  showOtherScenario: boolean;
}

// ─── API Configuration ────────────────────────────────────────────────────────
// TODO: Set HC_API_BASE_URL to your real base URL when the backend is ready.
export const HC_API_BASE_URL = '';   // e.g. 'https://api.yourapp.com'

export const HC_API_ENDPOINTS = {
  headcount: {
    /** GET    /api/v1/headcount         → HeadcountRow[]  */
    getAll:   () => `${HC_API_BASE_URL}/api/v1/headcount`,
    /** GET    /api/v1/headcount/:id     → HeadcountRow    */
    getById:  (id: number) => `${HC_API_BASE_URL}/api/v1/headcount/${id}`,
    /** POST   /api/v1/headcount         ← HeadcountRow (new row) */
    create:   () => `${HC_API_BASE_URL}/api/v1/headcount`,
    /** PUT    /api/v1/headcount/:id     ← HeadcountRow   */
    update:   (id: number) => `${HC_API_BASE_URL}/api/v1/headcount/${id}`,
    /** DELETE /api/v1/headcount/:id                      */
    delete:   (id: number) => `${HC_API_BASE_URL}/api/v1/headcount/${id}`,
    /** POST   /api/v1/headcount/bulk    ← HeadcountRow[] (save all at once) */
    bulkSave: () => `${HC_API_BASE_URL}/api/v1/headcount/bulk`,
  },
  master: {
    /** GET /api/v1/master/regions    → string[] */
    regions:   () => `${HC_API_BASE_URL}/api/v1/master/regions`,
    /** GET /api/v1/master/countries  → string[] */
    countries: () => `${HC_API_BASE_URL}/api/v1/master/countries`,
    /** GET /api/v1/master/hc-sites   → string[] */
    sites:     () => `${HC_API_BASE_URL}/api/v1/master/hc-sites`,
    /** GET /api/v1/master/employees  → string[] */
    employees: () => `${HC_API_BASE_URL}/api/v1/master/employees`,
    /** GET /api/v1/master/hc-scenarios → string[] */
    scenarios: () => `${HC_API_BASE_URL}/api/v1/master/hc-scenarios`,
  }
};

// ─── Master / Reference Data ──────────────────────────────────────────────────
// TODO: Load each from its HC_API_ENDPOINTS.master.* endpoint when ready.

export const HC_MONTHS         = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const HC_REGIONS        = ['EMEA','APAC','Americas'];
export const HC_COUNTRIES      = ['UK','Turkey','Spain','France','Germany'];
export const HC_SITES          = ['Montego-UKCP','Ankara-TR','Madrid-ES','Paris-FR','Global'];
export const HC_EMPLOYEE_TYPES = ['Full Time','Part Time','VIE','TBA'];
export const HC_EMPLOYEES      = ['A. Whitmore','B. Castellano','C. Okafor','D. Lindholm','E. Marchetti','New Analyst (unassigned)'];
export const HC_FUNCTIONS      = ['Analyst','Engineer','Consultant','Manager','Coordinator'];
export const HC_SCENARIOS      = ['RFC1 2026','RFC2 2026','RFC3 2026','Budget 2026'];

/** The scenario the "Show Other Scenario" toggle compares the primary against. */
export const HC_OTHER_SCENARIO = 'Budget 2026';

// ─── Default State ────────────────────────────────────────────────────────────

export const HC_DEFAULT_FILTERS: HeadcountFilters = {
  region:   'EMEA',
  country:  'UK',
  site:     'Montego-UKCP',
  category: '',
  scenario: 'RFC3 2026',
};

export const HC_DEFAULT_TOGGLES: HeadcountToggles = {
  showOtherScenario: true,
};

// ─── Helper: build blank scenario rows for a new headcount row ────────────────

export function buildDefaultScenarioRows(primaryLabel: string): HcScenarioRow[] {
  return [
    { type: 'primary', label: primaryLabel,        values: Array(12).fill(0) },
    { type: 'other',   label: HC_OTHER_SCENARIO,   values: Array(12).fill(0) },
  ];
}

// ─── Mock / Hardcoded Data ────────────────────────────────────────────────────
// TODO: Replace with → this.http.get<HeadcountRow[]>(HC_API_ENDPOINTS.headcount.getAll())
//       Map the API response to the HeadcountRow[] shape and assign to headcountRows.

export const MOCK_HEADCOUNT_ROWS: HeadcountRow[] = [
  {
    id: 1,
    region: 'EMEA',
    country: 'UK',
    site: 'Montego-UKCP',
    category: 'Full Time',
    employee: 'A. Whitmore',
    functionForTba: '',
    comment: 'Started in March 2026',
    scenarioRows: [
      { type: 'primary', label: 'RFC3 2026',   values: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { type: 'other',   label: 'Budget 2026', values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    ]
  },
  {
    id: 2,
    region: 'EMEA',
    country: 'UK',
    site: 'Montego-UKCP',
    category: 'Part Time',
    employee: 'B. Castellano',
    functionForTba: '',
    comment: '50% claim back from JV',
    scenarioRows: [
      { type: 'primary', label: 'RFC3 2026',   values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { type: 'other',   label: 'Budget 2026', values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    ]
  },
  {
    id: 3,
    region: 'EMEA',
    country: 'UK',
    site: 'Montego-UKCP',
    category: 'Full Time',
    employee: 'C. Okafor',
    functionForTba: '',
    comment: 'Recharged to Operations',
    scenarioRows: [
      { type: 'primary', label: 'RFC3 2026',   values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0] },
      { type: 'other',   label: 'Budget 2026', values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    ]
  },
  {
    id: 4,
    region: 'EMEA',
    country: 'Turkey',
    site: 'Ankara-TR',
    category: 'VIE',
    employee: 'D. Lindholm',
    functionForTba: '',
    comment: '',
    scenarioRows: [
      { type: 'primary', label: 'RFC3 2026',   values: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0] },
      { type: 'other',   label: 'Budget 2026', values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    ]
  },
  {
    id: 5,
    region: 'EMEA',
    country: 'UK',
    site: 'Montego-UKCP',
    category: 'TBA',
    employee: 'New Analyst (unassigned)',
    functionForTba: 'Analyst',
    comment: 'Replacement for Rob',
    scenarioRows: [
      { type: 'primary', label: 'RFC3 2026',   values: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1] },
      { type: 'other',   label: 'Budget 2026', values: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    ]
  },
];
