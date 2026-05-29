// ─────────────────────────────────────────────────────────────────────────────
// HEADCOUNT CONSTANTS
// All application data and API configuration for the Headcount screen lives here.
// TODO: When the backend is ready, replace each MOCK_ export with an HTTP
//       call using the matching HC_API_ENDPOINTS entry.
//
// Domain rule: headcount is tracked as a BINARY value per employee per month
// (1 = present, 0 = absent) — never fractional. Each scenario stores a separate
// set of 12 monthly values per scenario year (2026 / 2025 / 2024); switching the
// "Scenario Year" filter swaps which year's values the grid shows/edits.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Type Definitions ────────────────────────────────────────────────────────

export type HcScenarioType = 'primary' | 'other';

export interface HcScenarioRow {
  type: HcScenarioType;
  /**
   * Binary presence per month (0 | 1 | null), keyed by scenario year.
   * e.g. valuesByYear[2026] = [0,0,1,1, …] (12 entries).
   */
  valuesByYear: { [year: number]: (number | null)[] };
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
  /** Owning EISS team — used by the Team filter (not shown as a column). */
  team: string;
  /** Free-text note shown in the Comments column. */
  comment: string;
  scenarioRows: HcScenarioRow[];
  isHovered?: boolean;
}

export interface HeadcountFilters {
  /** Site / OneStream cost-stream code. */
  site: string;
  team: string;
  /** Year for the primary (RFC3) scenario shown in the grid. */
  scenarioYear: number;
  /** Year for the comparison (Budget) scenario — lets you compare against any year. */
  otherScenarioYear: number;
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
    /** GET /api/v1/master/teams      → string[] */
    teams:     () => `${HC_API_BASE_URL}/api/v1/master/teams`,
    /** GET /api/v1/master/employees  → string[] */
    employees: () => `${HC_API_BASE_URL}/api/v1/master/employees`,
  }
};

// ─── Master / Reference Data ──────────────────────────────────────────────────
// TODO: Load each from its HC_API_ENDPOINTS.master.* endpoint when ready.

export const HC_MONTHS         = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const HC_REGIONS        = ['EMEA','APAC','Americas'];
export const HC_COUNTRIES      = ['UK','Turkey','Spain','France','Germany'];
export const HC_SITES          = ['Montego-UKCP','Ankara-TR','Madrid-ES','Paris-FR','Global'];
export const HC_TEAMS          = ['Infrastructure','Applications','Governance & Vendor','Model & Processes'];
export const HC_EMPLOYEE_TYPES = ['Full Time','Part Time','VIE','TBA'];
export const HC_EMPLOYEES      = ['A. Whitmore','B. Castellano','C. Okafor','D. Lindholm','E. Marchetti','New Analyst (unassigned)'];
export const HC_FUNCTIONS      = ['Analyst','Engineer','Consultant','Manager','Coordinator'];

/** Selectable scenario years — drives which year's monthly values the grid shows. */
export const HC_SCENARIO_YEARS = [2026, 2025, 2024];

// ─── Default State ────────────────────────────────────────────────────────────

export const HC_DEFAULT_FILTERS: HeadcountFilters = {
  site:              '',
  team:              '',
  scenarioYear:      2026,
  otherScenarioYear: 2026,
};

export const HC_DEFAULT_TOGGLES: HeadcountToggles = {
  showOtherScenario: true,
};

// ─── Helper: build blank scenario rows for a new headcount row ────────────────

function blankYearMap(): { [year: number]: (number | null)[] } {
  const map: { [year: number]: (number | null)[] } = {};
  for (const y of HC_SCENARIO_YEARS) {
    map[y] = Array(12).fill(0);
  }
  return map;
}

export function buildDefaultScenarioRows(): HcScenarioRow[] {
  return [
    { type: 'primary', valuesByYear: blankYearMap() },
    { type: 'other',   valuesByYear: blankYearMap() },
  ];
}

// ─── Mock / Hardcoded Data ────────────────────────────────────────────────────
// TODO: Replace with → this.http.get<HeadcountRow[]>(HC_API_ENDPOINTS.headcount.getAll())
//       Map the API response to the HeadcountRow[] shape and assign to headcountRows.
//       Each scenario row carries a distinct set of monthly values per year so the
//       Scenario Year dropdown visibly changes the grid.

export const MOCK_HEADCOUNT_ROWS: HeadcountRow[] = [
  {
    id: 1,
    region: 'EMEA',
    country: 'UK',
    site: 'Montego-UKCP',
    category: 'Full Time',
    employee: 'A. Whitmore',
    functionForTba: '',
    team: 'Infrastructure',
    comment: 'Started in March 2026',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
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
    team: 'Applications',
    comment: '50% claim back from JV',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
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
    team: 'Infrastructure',
    comment: 'Recharged to Operations',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
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
    team: 'Model & Processes',
    comment: '',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
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
    team: 'Governance & Vendor',
    comment: 'Replacement for Rob',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
    ]
  },
];
