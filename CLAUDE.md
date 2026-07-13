# Cost Management — Project Guide

## Stack
- Angular 14, NgModule (not standalone)
- Node 16.20.2 (pinned via Volta)
- Dev server: `npx ng serve`
- SCSS with nested syntax

---

## Folder Structure

```
src/app/
├── features/          ← global/shared components (persist across all routes)
│   ├── app-header/    ← constant top bar — DO NOT MODIFY
│   ├── top-nav/       ← navigation bar, always visible on all pages
│   └── theme-toggle/  ← light/dark toggle button (lives inside TopNav)
├── components/        ← page-level components (one per route)
│   ├── home/
│   └── invoice-upload/
└── services/
    └── theme.service.ts
```

**Rule:** `features/` = shared UI that appears on every page. `components/` = full pages tied to a route.

---

## App Shell Layout

`app.component.html` owns the persistent shell — always in this order:

```html
<div class="app-container">
  <app-header></app-header>      <!-- never changes -->
  <app-top-nav></app-top-nav>    <!-- always visible, owns theme toggle -->
  <router-outlet></router-outlet>
</div>
```

`app.component.scss`:
```scss
.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

**Rule:** Never put `<app-top-nav>` inside a page component. It belongs in the app shell.

---

## Adding a New Page

1. Create component in `components/<name>/`
2. Add route in `app-routing.module.ts`
3. Declare in `app.module.ts`
4. Add `<a class="nav-item" routerLink="/<path>" routerLinkActive="active">` in `top-nav.component.html`

---

## Data-Grid Screens (Forecast & Headcount)

The **Forecast** screen (`components/forecast/`) is the canonical template for any
month-by-month editable data grid. The **Headcount** screen (`components/headcount/`)
was built from it and follows the same anatomy:

- **Two-table sticky layout**: a left `*-left-table` (identity/lookup columns) pinned
  with `position: sticky; left: 0`, and a right `*-right-table` (12 month columns +
  Total + …) that scrolls horizontally inside a shared `*-tables-container`.
- **Right-edge sticky columns**: trailing columns can be pinned to the right with
  `position: sticky; right: <offset>`. Headcount pins **both** Comments (`right: 44px`)
  and the action/remove column (`right: 0`) so they stay visible while months scroll;
  Forecast pins just the action column. Sticky cells must keep an opaque per-row
  background (zebra/hover/footer states all set it on `td`) so scrolling cells pass under.
- **Sub-rows per record**: each logical row expands into several sub-rows
  (Forecast: local/contract/actual/other-scenario/recharge; Headcount: RFC3 + Budget).
  A `*-row-last-sub` 6px bottom border (page-bg colour) creates the card gap between blocks.
  Make it span the **whole width** by NOT letting placeholder `*-sub-empty` cells override
  the last-sub border — scope their transparent `border-bottom` to
  `tr:not(.*-row-last-sub)` only (applies in both Forecast and Headcount left tables).
- **Filter chips + toggles** at the top, an **Add Row** toolbar (+ Save/Cancel), and a
  `tfoot` **totals block** that re-aggregates the visible sub-rows.
- **Internal vertical scroll (optional, per-screen)**: when row counts grow, give the
  shared `*-tables-container` a `max-height` + `overflow: auto` and add
  `position: sticky; top: 0; z-index: 6` (above the right-edge sticky columns at z:5)
  to `.*-thead th` so column headers stay pinned while the body scrolls. The page-level
  scroll-area keeps working — both scrollbars coexist. Headcount uses
  `max-height: calc(100vh - 340px); min-height: 240px;`.
- Constants/types/mock-data/API-endpoint stubs live in `constants/<screen>.constants.ts`
  (e.g. `forecast.constants.ts`, `headcount.constants.ts`), ready to swap mock arrays for
  HTTP calls.

**Rule:** when adding another grid screen, copy this structure but give every CSS class a
**unique per-screen prefix** (Forecast uses `lc-`/`rc-`/`.filter-*`; Headcount uses `hc-`).
Angular scopes styles per component, but distinct prefixes keep the screens independently
greppable and prevent confusion when copying markup between them.

### Headcount specifics
- Left columns: Region, Country, Site, Category (employee type), Employee, Function for TBA.
- **Filter bar = 3 chips on the left** (Site / OneStream Code, Team, Scenario Year) plus the
  scenario **toggle pinned to the right** (`.hc-filter-row` is space-between; `.hc-toggles`
  uses `margin-left: auto`). There is **no year-nav** in the toolbar — the year is driven
  entirely by the Scenario Year chip.
- **Per-year data**: each scenario sub-row stores `valuesByYear[2026 | 2025 | 2024]`
  (12 binary entries each). `HC_SCENARIO_YEARS` lists the selectable years. Switching the
  Scenario Year chip swaps which year the grid shows/edits.
- **Two independent years**: `filters.scenarioYear` drives the primary (RFC3) row;
  `filters.otherScenarioYear` drives the Budget comparison row. `yearFor(sub)` picks the
  right one, and `vals(sub)` / `scenarioLabel(sub.type)` follow it — so RFC3 of one year can
  be compared against Budget of any year. The **Budget year dropdown** sits next to the
  toggle (`.hc-compare-chip`, dims when the toggle is off).
- Month cells: the domain rule is **binary** (1 = present, 0 = absent), and the
  `normalizeBinary()` method is still defined for that purpose, but the cell `<input>` no
  longer calls it on `(change)` and the `max="1" step="1"` HTML attributes were removed —
  so the UI currently accepts arbitrary non-negative numbers (`min="0"` stays). Totals
  sum these as-is. The method is left as inactive code so the binary clamp can be
  re-enabled with a single `(change)` binding if the rule is re-tightened.
- The "other scenario" (Budget) row is revealed by the **Show Other Scenario** toggle, whose
  "on" tone is the green (`rgb(68,217,68)` + glow) borrowed from the invoice-upload switch.
- **Per-row Comments column** (sticky right): a small comment-button + badge sits next to
  a **"Click to add Comments"** text link; clicking either opens an `<app-modal>` with 12
  monthly textareas for the current Scenario Year (mirrors Forecast). Saved in
  `localStorage` under `headcount-row-comments` as `{ [rowId]: { [year]: string[12] } }`.
  The hardcoded `row.comment` seed is **still in the model and mock data** (kept intact —
  no behavior depends on it being absent), but it is **no longer rendered** in the cell or
  inside the modal — the previous "Reference note" line at the top of the modal was
  removed at the user's request. Switching the Scenario Year chip swaps the comment set
  the modal reads/writes.
- **Row reordering via detached drag rail** (visually separated from the data tables):
  the rail is its own bordered, scrolling container — a sibling of `.hc-tables-container`
  inside a `.hc-grid-with-rail` flex wrapper, separated by a 10px gap. Both containers
  share the same `max-height` / `min-height`; vertical scroll is kept in lockstep via
  `(scroll)="onRailScroll()/onTableScroll()"` handlers using `@ViewChild` refs and a
  `syncingScroll` guard flag to prevent feedback loops. The rail's own scrollbar is
  hidden (it follows the table's scrollbar). The data tables (`.hc-left-table` /
  `.hc-right-table`) and their wraps stay byte-for-byte unchanged — `.hc-left-wrap` sits
  back at `left: 0` since the rail is no longer inside the container. Each rail body row
  has a 9-dot `<button [draggable]="true">` (first sub-row only); `(dragstart)` records
  the source row id **and** builds a visible drag-preview card (employee · site · team)
  via `document.createElement` + `event.dataTransfer.setDragImage(...)` — inline styles
  on the preview because component CSS doesn't reach `document.body`. `(dragover)` /
  `(drop)` on the rail trs reorder the shared `headcountRows` array so the **whole
  logical row** (left + right halves) moves as one unit. Heights auto-align because the
  rail reuses the global unscoped row-height / sub-row rules. Order is persisted to
  `localStorage` under `headcount-row-order` in `saveChanges()`; `applySavedOrder()` is
  called in the constructor (after field initializers) and at the end of
  `cancelChanges()` so cancel reverts to the *last saved* layout, not the factory-mock
  order.
- **TOTAL HEADCOUNT** footer sums presence per month/scenario, with inline variance colour
  on the primary row vs Budget (red = over budget, green = on/under).
- **Toolbar layout**: the in-page header has **no Back button** (commented out), the
  "+ Add New Row" button is right-aligned on its own toolbar row, and **Cancel / Save**
  live in a separate `.hc-table-actions` row directly below the table (not in the
  toolbar). Save Changes triggers persistence of the row order alongside the data POST.

### Forecast specifics
- **Filter chips use `<app-hierarchy-select>`** (the shared global hierarchical dropdown
  — see "Global Form Components" below) instead of native `<select>`s. The Forecast
  component declares four `SelectGroup[]` catalogues (`siteFilterGroups`,
  `teamFilterGroups`, `accountFilterGroups`, `scenarioFilterGroups`) — values stored are
  the same flat labels the rows compare against, so `filteredForecastRows` keeps working
  unchanged. `DEFAULT_FILTERS` are all empty strings so the page opens with **no filter
  applied — every row is visible** until the user picks something. The legacy
  `.chip-arrow` span was removed from each chip (the hierarchy-select brings its own
  chevron), and `.filter-chip` was made less round (`border-radius: 8px-10px`,
  `min-width: 180px`) to better hold the dropdown. Inside `.filter-chip`, a scoped
  `::ng-deep app-hierarchy-select` block strips the component's own background / border /
  padding so its input sits flush in the chip — **scope is important**: the same
  component on Invoice Upload still renders with its default boxed appearance.
- **Actual rows are editable.** `SubRow.readOnly` is still set to `true` on every
  `actual` / `recharge-actual` entry in the mock data, but the cell `<input>` no longer
  binds `[disabled]="!!sub.readOnly"` — so every month cell, including Actual, accepts
  input. The flag is intentionally preserved in the data so the API can re-enable the
  lock for posted actuals later by re-introducing the binding.
- **Row reordering via detached drag rail** — same pattern as Headcount but **simpler**:
  Forecast has no internal vertical table scroll, so the rail and `.tables-container`
  both live inside `.fc-grid-with-rail` (flex, 10px gap) and share the page's scroll
  context. No `@ViewChild` scroll-sync is needed. Rail classes are `fc-`-prefixed
  (`.fc-drag-rail-outer`, `.fc-drag-rail-table`, `.fc-drag-col`, `.fc-drag-handle`,
  `.fc-row-drop-over`, `.fc-row-dragging`). Custom drag preview shows
  *internalOrder · supplier · team*. Order is persisted to `localStorage` under
  `forecast-row-order` in `saveChanges()`; `applySavedOrder()` runs in the constructor
  and at the end of `cancelChanges()`. The data tables (`.left-table` / `.right-table`)
  and their wraps are byte-for-byte unchanged.
- **Drop direction rule (shared with Headcount)**: `onRowDrop` uses `splice(toIdx, 0,
  moved)` (no `-1` adjustment). This makes a downward drag drop AFTER the target row and
  an upward drag drop BEFORE — a previous version with `fromIdx < toIdx ? toIdx - 1 :
  toIdx` collapsed adjacent downward drags into a no-op.

---

## Global Form Components

### `<app-hierarchy-select>`
`features/hierarchy-select/` — searchable dropdown with grouped options. Implements
`ControlValueAccessor`, so it works with `[(ngModel)]`. Inputs:

- `[groups]: SelectGroup[]` — `{ group: string; items: { value: string; label: string }[] }[]`
  for local filtering. Or `[searchFn]: (q: string) => Observable<SelectGroup[]>` for async
  (e.g., SAP Internal Order lookup).
- `bindValue: 'label' | 'value'` — what to emit on select (default `'label'`).
- `placeholder`, `disabled`, `minChars`.

Notable behavior:
- Dropdown uses `position: fixed` with dynamic coordinates so it escapes any scroll/overflow
  ancestor (works inside scrollable containers without clipping).
- An in-dropdown **"Clear selection"** row appears whenever a value is set, emitting `''`.

Currently used on **Invoice Upload** (supplier, site, team, currency, account, internal
order, recharge sites) and on **Forecast** filter chips. When embedding inside a styled
host (like the Forecast chip), wrap the override in a parent class + `::ng-deep` so other
usages aren't affected.

---

## Top Navigation (`features/top-nav/`)

Always visible above each route. Holds:
- Internal `<a routerLink>` items: Home, Invoice Upload, Forecast, Headcount.
- Two **external `<a href>` items** to sister deployments:
  - "Scenario Management" → `https://cost-center-theta.vercel.app/`
  - "Admin Screens" → `https://cost-management-admin.vercel.app/`
- Both use `target="_blank" rel="noopener noreferrer"`. No `routerLinkActive` on external
  links (inert there). The same two links also appear as buttons in the home page's
  `.dashboard-actions` row.

The shared `.nav-item` rule has `text-decoration: none`, so `<a>`-flavored entries look
identical to internal nav links.

---

## Vercel Deployment

- `vercel.json` at the repo root uses the **modern config** (no legacy `builds`):
  `installCommand` + `buildCommand` (`cd cost-management && npm run build`) +
  `outputDirectory` (`cost-management/dist/cost-management`) + `framework: null` +
  `rewrites` (SPA fallback). `rewrites` checks the filesystem first, then falls back to
  `/index.html` for SPA routes — don't go back to the legacy `routes` form unless you
  also add `{ "handle": "filesystem" }` first.
- `engines.node` in `cost-management/package.json` is set to `"22.x"` (Vercel dropped
  Node 16; Angular 14 builds fine on 22 with `>=16.10.0`). The **Volta pin and `.nvmrc`
  stay at 16.20.2** for local development — only the cloud build runtime was bumped.
- Project Settings in the Vercel dashboard should be left empty — `vercel.json`
  overrides them when present.

---

## Page Component Layout Pattern

Every page component must follow this shell so scrolling works correctly:

```html
<div class="page-name-page">

  <div class="scroll-area">          <!-- title + content scroll together -->
    <div class="page-header">
      <h2 class="page-title">Page Name</h2>
    </div>

    <!-- main content here -->

  </div><!-- /scroll-area -->

  <div class="action-footer">        <!-- always pinned to bottom -->
    <button class="btn-cancel">Cancel</button>
    <button class="btn-save">Save</button>
  </div>

</div>
```

Required SCSS on every page component:

```scss
:host {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.page-name-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
  transition: background-color var(--transition-speed);
}

.scroll-area {
  flex: 1;
  overflow-y: auto;       /* scrollbar starts here, below the TopNav */
}

.action-footer {
  flex-shrink: 0;         /* stays pinned at the bottom */
}
```

**Key rules:**
- `overflow: hidden` on `:host` and the page wrapper — never on the scroll-area
- `overflow-y: auto` only on `.scroll-area`, never on `.content-layout`
- The page title (`page-header`) goes **inside** `.scroll-area` so it scrolls away — it is not sticky
- The action footer goes **outside** `.scroll-area` so it stays pinned

---

## Theming System

### How it works
- `ThemeService` (providedIn: root) reads `localStorage` key `'theme'` on startup, falls back to system preference
- On init / toggle it sets `data-theme="light"` or `data-theme="dark"` on `<html>`
- `AppComponent.ngOnInit()` calls `themeService.init()`

### CSS Variables
All colours must use variables from `styles.scss` — never hardcode colours in page components.

| Variable | Light | Dark |
|---|---|---|
| `--bg-primary` | #f0f2f5 | #0f172a |
| `--bg-secondary` | #ffffff | #1e293b |
| `--bg-nav` | #ffffff | #1e293b |
| `--bg-hover` | #f7f9fc | #263248 |
| `--text-heading` | #1a3c5e | #e2e8f0 |
| `--text-primary` | #333 | #cbd5e1 |
| `--text-secondary` | #444 | #94a3b8 |
| `--text-label` | #666 | #94a3b8 |
| `--text-muted` | #888 | #64748b |
| `--accent-color` | #2e6da4 | #60a5fa |
| `--border-color` | #e0e0e0 | #334155 |
| `--card-shadow` | rgba(0,0,0,0.07) | rgba(0,0,0,0.3) |
| `--transition-speed` | 0.07s | 0.07s |

Badge variables: `--badge-paid-*`, `--badge-pending-*`, `--badge-overdue-*`

### Transitions
Every surface that changes colour on theme switch must have a transition:
```scss
transition: background-color var(--transition-speed), color var(--transition-speed), border-color var(--transition-speed);
```

### Toggle button
- Lives in `top-nav.component.html` as `<app-theme-toggle>`
- Light mode shows moon icon: `assets/icons/DarkThemeMoonIcon.svg`
- Dark mode shows inline SVG sun (stroke="currentColor" — inherits `var(--text-heading)`)

---

## Scrollbar
Defined globally in `styles.scss`. Width 5px, track transparent, thumb uses `var(--border-color)`. Applies automatically to any `overflow-y: auto` element — no per-component work needed.

---

## App Header
`features/app-header/` — blue gradient, hardcoded, intentionally exempt from dark mode.  
**Do not modify this component.**

---

## Form Section Pattern (for data-entry pages)

```scss
.form-section {
  background: var(--bg-secondary);
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 2px 8px var(--card-shadow);
  transition: background-color var(--transition-speed), box-shadow var(--transition-speed);
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--accent-color);
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}
```

Inputs / selects must always use:
```scss
background: var(--bg-primary);
border: 1px solid var(--border-color);
color: var(--text-primary);
```

---

## Business Domain Rules

These rules govern how the application must behave. Always refer to them when building or extending any feature.

### Process & Budget
- Budget is the starting point of the entire application — set every September–October for the following year across all four EISS teams: **Infrastructure, Applications, Governance & Vendor, Model & Processes**
- Budget is not an approval to spend — a separate **PAR (Purchase Approval Request)** must be raised before any costs are committed; the application only stores the PAR number
- All figures are in **GBP** as the primary currency, with a **USD conversion column** displayed alongside

### Invoice Handling
- Invoice upload (PDF) is mandatory — JPEG is not required
- Invoice number has no fixed format or length
- **Duplicate detection** is based on the combination of **invoice number + vendor** (not invoice number alone); on detection, show the existing entry before allowing an update
- Multi-month invoice spreading is always an **even split** across the invoice period
- **Credit notes**: both the original invoice and the credit must be visible on the same cost line so the full path is traceable; credit is recorded as a **negative amount** against actuals

### Accruals
- When an invoice is delayed, the system must allow flagging of that line so the finance team can be instructed to make an accrual for that month
- A report must be generated showing **Supplier, Spend Type, and Amount to accrue per month** — sent to the finance team
- Each invoice line must have a **paid / unpaid flag** to indicate whether the invoice has physically left Crown's accounts

### Recharge
- **Block save** if recharge allocations do not sum to 100% — no delta posting; it must balance exactly
- Recharge lines must **not** appear in a cost centre manager's RFC — a separate dedicated view is needed for recharge instructions to the business

### Forecast & RFC
- There are exactly **three RFC cycles per year**: RFC1 (Jan–Mar locked), RFC2 (Jan–Jun locked), RFC3 (Jul–Sep forecast)
- If overspend exceeds the PAR, a **new budget line with a new PAR** must be added — the existing line cannot be increased
- Recharge lines are excluded from the RFC copy — they belong to a separate view

### Cost Centre Comparison View
- Fully dynamic: user selects a scenario, then freely picks which data columns to display (Actual 2024, Actual 2025, RFC1, Budget, etc.) by ticking/unticking from a dropdown
- User can add **variance comparison columns** by selecting any two financial columns (e.g. Budget minus RFC1, Actuals minus Budget) — comparisons are fully flexible, not fixed
- Inline colour-coded variance: **red = overspend, green = on/under budget**
- Column configuration and comparisons are **saved per user** and restored exactly when they return to the screen

### Headcount
- Tracked as **binary per employee per month** (1 = present, 0 = absent) — no fractional values
- Employee types: **Full Time, Part Time, VIE, TBA** (placeholder for unfilled roles)
- Must track people across multiple locations: **UK, Turkey, Spain**, and other Crown sites
- Follows the same Budget / RFC cycle as financial forecasting

### Power BI Dashboards (confirmed requirements)
- Spend by cost type
- Spend by vendor
- Spend across teams
- Actuals vs. Budget trend (graph format for leadership)
- Source of Change report
