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
  /**
   * Position in the grid, as the server holds it.
   *
   * Round-tripped rather than re-derived from the array index at save time. That worked while the
   * grid held the whole table, but under paging the index restarts at 0 on every page, so page 2
   * would renumber itself over the top of page 1.
   */
  sortOrder?: number;
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

// ─── What is master data and what is not ──────────────────────────────────────
// Site, Team and the scenario years load from /api/v1/master/* in
// HeadcountComponent.loadDropdownData(), so the Admin > Cost Management screen is their single
// source of truth. The lists below are NOT lazy leftovers — each one is here because the Admin
// screen has no section for it:
//
//   Region / Country   The master data has no org hierarchy at all. tblCMSite holds only
//                      SiteId/SiteCode/SiteName/CurrencyId — no country, no region. Adding
//                      these needs a schema decision plus master data (backend todo #19).
//   Employee           No master table. A person list is HR data and does not belong to the
//                      cost-management lookups.
//   Function for TBA   No master table.
//   Employee type      Deliberately not master data. This is the person's EMPLOYMENT type,
//                      NOT the spend categories behind /master/categories (which return
//                      'IT Consultancy', 'IT Outsource Services' and the like). It also drives
//                      screen logic: Function for TBA is enabled only while the value is
//                      exactly 'TBA', so binding it to the spend categories would both mislabel
//                      the column and silently disable that field for every row.
export const HC_REGIONS        = ['EMEA','APAC','Americas'];
export const HC_COUNTRIES      = ['UK','Turkey','Spain','France','Germany'];
export const HC_EMPLOYEE_TYPES = ['Full Time','Part Time','VIE','TBA'];
export const HC_EMPLOYEES      = ['A. Whitmore','B. Castellano','C. Okafor','D. Lindholm','E. Marchetti','New Analyst (unassigned)'];
export const HC_FUNCTIONS      = ['Analyst','Engineer','Consultant','Manager','Coordinator'];

/**
 * Selectable scenario years — drives which year's monthly values the grid shows, and the set of
 * keys `blankYearMap()` builds for every new scenario band.
 *
 * Fixed on purpose, and NOT read from /master/scenarios: planning needs a stable window that
 * includes years no scenario has been created for yet (you cannot plan 2027 if 2027 is only
 * offered once someone has already made a 2027 scenario). Newest first, to match the dropdown.
 */
export const HC_SCENARIO_YEARS = [2027, 2026, 2025, 2024];

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
// DEAD as far as the live screen is concerned. HeadcountComponent loads the grid from
// SHOWCASE: these rows ARE the roster. There is no backend here, so HeadcountService seeds its
// in-memory store from them and every page, filter and save in the demo runs against this array.
//
// Site and Team must hold master-data CODES ('london-hq', 'infrastructure'), never display names.
// A <select> whose model matches no option value renders BLANK, which is exactly how this file
// broke the screen before: it carried 'Montego-UKCP' / 'Infrastructure' and both dropdowns looked
// unbound when the wiring was correct. Add a row only with a code from MasterDataService.

export const MOCK_HEADCOUNT_ROWS: HeadcountRow[] = [
  {
    id: 1,
    region: 'EMEA',
    country: 'UK',
    site: 'london-hq',
    category: 'Full Time',
    employee: 'A. Whitmore',
    functionForTba: '',
    team: 'infrastructure',
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
    site: 'london-hq',
    category: 'Part Time',
    employee: 'B. Castellano',
    functionForTba: '',
    team: 'applications',
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
    site: 'london-hq',
    category: 'Full Time',
    employee: 'C. Okafor',
    functionForTba: '',
    team: 'infrastructure',
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
    site: 'manchester',
    category: 'VIE',
    employee: 'D. Lindholm',
    functionForTba: '',
    team: 'model-processes',
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
    site: 'london-hq',
    category: 'TBA',
    employee: 'New Analyst (unassigned)',
    functionForTba: 'Analyst',
    team: 'governance-vendor',
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
  {
    id: 6,
    region: 'EMEA',
    country: 'UK',
    site: 'manchester',
    category: 'Full Time',
    employee: 'Fred Mitchell',
    functionForTba: '',
    team: 'applications',
    comment: 'Moved from Bradford in Q2',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
      },
    ]
  },
  {
    id: 7,
    region: 'EMEA',
    country: 'Netherlands',
    site: 'amsterdam',
    category: 'Full Time',
    employee: 'CHATERJII, Amarthya',
    functionForTba: '',
    team: 'infrastructure',
    comment: 'Cloud platform lead',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
        }
      },
    ]
  },
  {
    id: 8,
    region: 'EMEA',
    country: 'France',
    site: 'france',
    category: 'VIE',
    employee: 'jennifer.douglas@eur.crowncork.com',
    functionForTba: '',
    team: 'model-processes',
    comment: 'VIE contract ends Nov 2026',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
          2025: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          2025: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
    ]
  },
  {
    id: 9,
    region: 'AMER',
    country: 'USA',
    site: 'usa',
    category: 'Part Time',
    employee: 'vanshika.verma@acumant.com',
    functionForTba: '',
    team: 'governance-vendor',
    comment: '0.5 FTE shared with Procurement',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2025: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
    ]
  },
  {
    id: 10,
    region: 'EMEA',
    country: 'Ireland',
    site: 'dublin',
    category: 'TBA',
    employee: 'Data Engineer (open req)',
    functionForTba: 'Data Engineer',
    team: 'applications',
    comment: 'Requisition approved, start date TBC',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
          2025: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
      {
        type: 'other',
        valuesByYear: {
          2026: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
          2025: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }
      },
    ]
  },
  {
    id: 11,
    region: 'EMEA',
    country: 'UK',
    site: 'bradford',
    category: 'Full Time',
    employee: 'Devojeet Modak',
    functionForTba: '',
    team: 'infrastructure',
    comment: 'Backfill for site network role',
    scenarioRows: [
      {
        type: 'primary',
        valuesByYear: {
          2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
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
];
