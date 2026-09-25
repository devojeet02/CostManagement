# Cost Management — Project Guide

## Stack
- Angular 14, NgModule (not standalone)
- Node 16.20.2 (pinned via Volta) locally; Vercel builds on Node 22
- Dev server: `npx ng serve`
- Production build: `npx ng build` — **run this before every push**
- SCSS with nested syntax

---

## Read First

Three things that have each broken this project once, all of which built cleanly at the time:

1. **`ng serve` passing does not mean the deploy will pass.** Budgets and other
   production-only checks run on the production configuration, which only `ng build` uses.
   Run `npx ng build` before pushing → see "Vercel Deployment".
2. **A green build proves nothing about what renders.** Mock rows are cast, so a wrong field
   name compiles perfectly and paints a blank screen — and a wrong field *value* (a code where
   the options hold names) empties a dropdown just as silently. Open the page → see "Showcase
   Build".
3. **A wrong route silently lands on the Dashboard** rather than 404-ing, so broken links look
   like working buttons. Click them → see "Routes".

The pattern is the same in all three: *the compiler is not the thing that validates this.*

---

## Folder Structure

```
src/app/
├── features/          ← global/shared components (persist across all routes)
│   ├── side-nav/      ← the app rail — always visible, owns the theme toggle
│   ├── theme-toggle/  ← light/dark toggle button (lives inside SideNav)
│   ├── tooltip/       ← [cmTooltip] directive + GLOBAL tooltip.css (see below)
│   ├── pdf-loupe/     ← hover magnifier for the invoice preview (see "Invoice document zoom")
│   ├── cm-*/          ← components ported from the production repo (see "Showcase Build")
│   ├── app-header/    ← RETIRED from the shell, kept in the tree
│   └── top-nav/       ← RETIRED, replaced by side-nav; kept in the tree
├── components/        ← page-level components (one per route)
│   ├── dashboard/     ← the landing route
│   ├── invoice-view/ invoice-upload/ invoice-edit/
│   ├── forecast/ headcount/ budget-planner/ scenario-management/
│   ├── admin-cost-management/ period-management/ audit-log/
│   └── home/          ← RETIRED, unrouted, kept in the tree
└── services/          ← ALL MOCK — no HttpClient anywhere (see "Showcase Build")
```

**Retired ≠ deleted.** `home/`, `top-nav/` and `app-header/` are still declared in
`app.module.ts` and still compile. They were left in place so that nothing referencing them
breaks, and so the pre-showcase shell can be diffed against. Do not wire them back into
`app.component.html`.

**Rule:** `features/` = shared UI that appears on every page. `components/` = full pages tied to a route.

---

## App Shell Layout

`app.component.html` owns the persistent shell:

```html
<div class="app-shell">
  <app-side-nav></app-side-nav>
  <main class="app-content">
    <router-outlet></router-outlet>
  </main>
</div>
<app-snackbar></app-snackbar>
```

The shell is now a **horizontal** flex (rail + content), not the old vertical
header/top-nav/outlet stack. `<app-header>` is no longer rendered — the blue gradient bar
duplicated the rail's branding and cost vertical space the dashboard needed.

`<app-snackbar>` sits OUTSIDE `.app-shell` on purpose: it is fixed-positioned, and nesting
it inside a flex/overflow container would clip it.

**Rule:** Never put `<app-side-nav>` inside a page component. It belongs in the app shell.

---

## Adding a New Page

1. Create component in `components/<name>/`
2. Add route in `app-routing.module.ts`
3. Declare in `app.module.ts`
4. Add an entry to the `groups` array in `side-nav.component.ts` (not to the template —
   the rail renders itself from that array):
   `{ label: 'My Screen', route: '/my-screen', icon: 'chart' }`
   `icon` must be a key the rail's icon `<svg>` switch already knows; add a new `<ng-container
   *ngSwitchCase>` in `side-nav.component.html` if you need a new mark. Optional `tag: 'new'`
   renders the small badge.

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
- **Server-side pagination** (`listPaged()` on both mock services): the grid asks for ONE page
  and the service returns `{ items, total, page, pageSize, totals }`. Two rules make this work
  on an *editable* grid, and both are load-bearing:
  1. **Filtering happens in the service, over the whole set** — never over the rows that
     happen to be loaded, which would silently ignore every other page. The mock filters are
     null-lenient (`!filter || !row.value || row.value === filter`), matching the production
     repo query: a half-coded row is kept rather than vanishing the moment a filter is used.
  2. **Totals are for the whole filtered set**, not the page, so the footer never disagrees
     with the figures above it.
  Edits survive page changes because the component keeps a `loadedRows` cache keyed by id, and
  the save payload covers every page visited — which is why `bulkSave` must honour
  `pruneAbsent: false` and never delete rows merely absent from the payload.
- Constants/types/mock-data/API-endpoint stubs live in `constants/<screen>.constants.ts`
  (e.g. `forecast.constants.ts`, `headcount.constants.ts`), ready to swap mock arrays for
  HTTP calls.

**Rule:** when adding another grid screen, copy this structure but give every CSS class a
**unique per-screen prefix** (Forecast uses `lc-`/`rc-`/`.filter-*`; Headcount uses `hc-`).
Angular scopes styles per component, but distinct prefixes keep the screens independently
greppable and prevent confusion when copying markup between them.

### Headcount specifics
- Left columns: Region, Country, Site, **Team**, **Employment Type**, Employee, Function for TBA.
  The column is labelled *Employment Type*, not Category: it holds Full Time / Part Time / VIE /
  TBA, **not** the spend categories behind `/master/categories`. Binding it to those would
  mislabel the column *and* break the screen — Function for TBA is enabled only while the value
  is exactly `'TBA'`, which no spend category will ever equal. It stays on `HC_EMPLOYEE_TYPES`.
- **Employee is a typeahead, not a `<select>`** — a `cm-hierarchy-select` with `allowCustom`,
  over the active users from `UserService` (User & Access Management). `displayName` is nullable
  in production and the option label falls back to the email, so two seeded users deliberately
  have none to keep that path exercised.
- **Master data is the source of truth** for Site and Team, which persist the lookup **code**
  (see "codes vs names"). Region, Country, Employee and employment type are **not** bound on
  purpose: there is no master table for any of them — the reasoning is recorded in
  `headcount.constants.ts` so it does not read as laziness.
- **Empty / loading / error states** (`.hc-state-block`): an empty response renders an empty
  grid with the Add Row button, never invented rows. Substituting mock rows for a valid empty
  response is what made the screen look broken while the wiring was correct.
- `HC_SCENARIO_YEARS` is the fixed list `[2027, 2026, 2025, 2024]`. A year present in the list
  but absent from a row is a crash, not a blank — the template indexes
  `sub.valuesByYear[yearFor(sub)][mi]` with no null-checking — so `ensureYearCoverage()` fills
  any gap with twelve zeros after a load, after the years arrive, and after `addRow()`.
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
- **Period locks (RFP §8.2)** — a month closed on Period Management is amber down the whole
  column, padlocked in the header and disabled in the cells, exactly as on Forecast.
  ⚠️ Keyed by YEAR, unlike Forecast's flat array, because this grid shows two years at once: a
  month closed in 2025 must not grey out the 2026 band sitting above it. `loadPeriods()` runs on
  init and on every `applyFilters()`, so both year chips keep their own state. Presentation only
  — production's API is what actually refuses the save.
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
- **Show Source Currency toggle** adds the two blue contract-currency lines to *every* row,
  not just the totals block. A row that is not flagged **Different Currency** has no contract
  figures of its own, so the grid derives them as `local x exchangeRate` (rate `1` when none is
  recorded) — and the mock's `buildTotals()` mirrors that derivation exactly. Diverge and the
  footer reads 0 under a column of visible numbers. Seeded coverage: row 3 carries its own EUR
  contract lines at rate 1.17; the rest derive at 1.
- **Forecast after Recharge** — a green, **non-editable** line spliced in directly above Actual,
  and only on rows where the Recharge checkbox is ticked. It reads the `recharge-actual`
  sub-row, falling back to `0` for every month with nothing recorded (row 8 in the seed is
  exactly that case: ticked, nothing recorded, a flat 0). It has its own tooltip message rather
  than inheriting Actual's. **TODO, pending confirmation:** it should become forecast *minus*
  recharge; today it shows the recharge amount itself.
- **Drop direction rule (shared with Headcount)**: `onRowDrop` uses `splice(toIdx, 0,
  moved)` (no `-1` adjustment). This makes a downward drag drop AFTER the target row and
  an upward drag drop BEFORE — a previous version with `fromIdx < toIdx ? toIdx - 1 :
  toIdx` collapsed adjacent downward drags into a no-op.

---

## Ported Screens

All copied from production unmodified; only their services differ (see "Showcase Build").

### Dashboard (`components/dashboard/`) — the landing route
Replaces the old `HomeComponent`, which was a grid of buttons whose only job was linking
onward — work the side-nav now does. Carries the Power BI requirements from the domain rules:
spend by cost type, by vendor, across teams, and the Actuals-vs-Budget trend.

Notable pieces:
- **Filter grid** — period, site (all 19 master-data sites), team, account, category, and a
  **currency multi-select** (not a GBP/USD toggle — the toggle needed an FX rate table that
  does not exist).
- **Draggable "today" marker** — a dotted line whose date pill is the drag handle. Dragging
  it moves the date and reveals the hover snapshot at each data point. Any date other than
  today shows *"Go back to Today"*.
  ⚠️ A `mousemove` fires between mousedown and mouseup on virtually **every** click, so the
  drag threshold (`DRAG_THRESHOLD_PX = 3`) must be greater than zero or the click handler
  never fires.
- **Vendor drill-down** — opened by a small magnifier button inside the vendor-name cell
  (not a whole-row hover, and not its own column).
- **Source of Change report** — opened by a button on the dashboard toolbar, deliberately
  *not* a side-nav entry.

### Budget Trend (`features/budget-trend/`)
Actuals vs Budget with a variance strip and a cumulative view, plus its own copy of the
today-marker picker.

⚠️ **The x-axis maths is deliberately NOT shared with the dashboard chart.** The dashboard
places a month at the centre of a 1/12 slot; this chart spaces 12 points across 11 intervals.
They look interchangeable and are not — unifying them shifts every point on one of the two.

### Budget Planner (`components/budget-planner/`)
Enter an annual total, spread it evenly across the 12 months, then adjust any month by hand.
Repeatable until approved; approval hard-locks the year. Attempting to edit a locked year
prompts *"this is fully approved — do you still want to edit it?"* and reopening restores
editing. Reopening **keeps** `approvedBy` / `approvedDate` — the record of who signed the
budget off must survive.

The remainder from an uneven division lands on **December**, in both the screen and the mock
seed, so the two agree on open.

### Scenario Management (`components/scenario-management/`)
The Actual/RFC comparison grid. Budget rows are labelled with their team name and each team's
budget is booked to its own busiest account — otherwise identical line descriptions collapse
into one row and totals silently under-report.

Four pieces of the RFP's "Cost Centre Comparison View" live here, and all four are demoable:

- **Columns picker (CCM-047)** — tick which scenario columns are shown. At least one must stay
  visible: every `*ngFor` colspan in the template assumes the list is non-empty.
- **Variance builder (CCM-048)** — add a comparison between *any* two financial columns
  (`Column A − Column B`), remove any of them, and each carries its own labelled header. The
  pairs are not fixed and not derived; the two seeded ones are only an out-of-the-box default.
- **Saved layout (CCM-049)** — visible columns, their drag order, the variance pairs and the
  Site/Team filters are saved per user and restored on return, with **Reset to Default** to go
  back. Backed by `UserPreferenceService`, which in this build writes `localStorage` rather than
  memory: a layout that forgot itself on reload would demo as broken. `configJson` is opaque to
  the service exactly as it is to the API — the screen owns the shape.
- **Cumulative Variance row (CCM-051)** — twelve month badges under each Forecast/Budget column,
  `CumVar(M) = CumVar(M-1) + (Forecast(M) − Actual(M))`, restarting every January. Red = running
  ahead of forecast. **Actual columns carry none** and render blank: they have nothing to compare
  themselves against, and inventing a series would read as real data.

⚠️ The mock must supply **every dimension the grid can group by** — account, spend type, spend
layer, category, system, supplier, internal order. The earlier seed carried only account and item
description, so the other columns were dashes and grouping by any of them collapsed every row
into one "—" bucket.

### Invoice View / Upload / Edit (`components/invoice-*/`)
List, entry and edit, with duplicate detection (invoice number + supplier), the related-data
panel, and the recharge drill. Fetching a *stored* PDF is the one unavailable feature — see
"Showcase Build" — but a PDF picked in the browser previews and zooms for real, because the
object URL never leaves the page.

**Invoice Change History** loads a page at a time (`historyPaged()`) and appends as you reach
the bottom, showing "Loading more…" with a spinner rather than a button.

#### Invoice document zoom (drag rail, focus mode, hover magnifier)

Three features on the document panel, all ported from production and all driven from
`InvoiceUploadComponent`. **Edit gets them for free**: it extends Upload and already lists the
Upload stylesheet in its `styleUrls`, so only its own template needed the markup and its
constructor the one new dependency (`ElementRef`). Anything added to Upload's class from here
lands on Edit — which is the whole reason the two screens cannot drift.

1. **Drag rail** (`.split-rail`) between the form and the preview, rendered only while a PDF is
   loaded (`isRailActive`) — a handle that resizes an empty panel reads as broken. It writes
   `previewWidth` onto the column, clamped to 400px … 60% of the row. Four things that each cost
   a debugging pass in production and are preserved here:
   - measure from the ROW's right edge (`rect.right - clientX`), not the viewport's;
   - `.preview-column { min-width: 0 }`, or the flex item refuses to shrink below its own
     min-content width (~395px) and silently ignores the dragged value;
   - `.content-layout.rail-dragging .preview-column { transition: none }`, or the column's
     0.35s collapse transition restarts on every pointer move and trails the cursor;
   - `pointer-events: none` on the iframe during a drag, or it swallows the pointer and the
     drag dies the moment the cursor crosses the preview.
2. **Focus mode** — the crosshair in the Invoice Document header folds **Invoice Change
   History** and **User & Processed Date** into square chips on the right, moving the document
   up by ~220px. `isHistoryChipped` / `isStampChipped` are separate: the crosshair moves both, a
   chip restores only its own. Both panels keep their markup behind an `*ngIf`, so the history
   modal and the stamp values behave exactly as before once back. Removing the file resets it.
3. **Hover to zoom** — the star beside the remove cross turns on a mode: pointing at the
   document reflects the area under the pointer, enlarged, in `features/pdf-loupe/`.
   ⚠️ It renders a SECOND copy of the PDF rather than magnifying the first. The preview is a
   browser PDF viewer inside an iframe: the page cannot read its pixels and never sees a pointer
   event over it, so a canvas loupe is not available. The loupe sizes a second iframe to
   `frame × zoom` (2.2) behind a clipping window, and a transparent `.pdf-hover-catcher` over
   the frame supplies the coordinates — which is also why this is a MODE: while the catcher is
   up, the viewer's own scroll and text selection are unreachable.

The frame carries `aspect-ratio: 1 / 1.414` with the iframe on `position: absolute; inset: 0`
(a percentage height will not re-resolve against a parent sized by `aspect-ratio`), and the URL
carries `#view=FitH` so the page fits the frame's width. Both URLs are built in one place,
`setPdfPreviewUrls()`.

### Forecast Audit (`components/forecast-audit/`) — `/forecast-audit`
The forecast change log, reached from the **Audit Log** button on the Forecast toolbar (not from
the side-nav — same as production). Read-only: filters for year, scenario, internal order and
user, and one card per SAVE showing every field that save altered, before → after.

⚠️ One event carries MANY changes. The backend stores a row per changed field and regroups them
on read, so an edit touching four months is one event with four `changes` — not four events.
`ForecastService.history()` filters over the whole set and pages server-side, like the grids.

### Related Data panel (`features/related-data-panel/`)
Shared by Invoice Upload and Edit — `InvoiceEditComponent extends InvoiceUploadComponent`, so
**anything changed here lands on both screens at once**. It sits OUTSIDE the form/preview
columns and spans the full page width, so hiding the preview column does not move it.

- **Parameters** — a collapsible block restating what the panel is reporting on: Site, Team and
  Supplier (invoice-level), then Account, Internal Order, Spend Type, Spend Layer, Category,
  System and Item Description per line. Added as a *sibling* of the header and the state blocks;
  no existing div was modified.
- **Internal-order auto-fill** — nothing new is stored for this: **a forecast line IS the
  combination**. The panel indexes `ForecastService.list(year)` by internal order, and a cell
  shows the line's own value when it has one, otherwise the coding that internal order's
  forecast line was saved with — *dimmed and italic* (`.rdp-pp-from-io`) behind a legend,
  because it is emphatically not data on this invoice. A typed value always wins, and
  **nothing is written back to the form**. Lines matching the invoice's site+team are folded in
  first, per field rather than per row.
- The forecast fetch is a **separate stream from `reload$`** — it must never delay, cancel or
  fail the figures the panel exists to show — and is guarded on the year, not the keystroke.
- A **year selector** (2026/2025) with its own empty state for a year that has no figures.

---

## Site Org Hierarchy (Admin → Master Data)

The **Site** section carries **Region** and **Country**, both searchable `cm-hierarchy-select`
dropdowns over the seeded ISO 3166-1 list (196 countries, 3 regions). Country cascades off
Region, and the Site grid prints both names.

Regions are **user-maintainable** from the Region control itself; countries are not, because a
fixed ISO list is exactly what prevents spelling drift:

- **Add** — typing a region that does not exist offers *"+ Add this as a new region"* in the
  dropdown's empty state, which opens the form with the name prefilled.
- **Rename** — for typos.
- **Manage countries** (`features/region-countries/`) — a dialog with two tabs, *In this region*
  and *Other regions*, so the countries filed elsewhere can be BROWSED rather than guessed at.
  Tick and move them across.
- **Delete** — inside that same dialog, always behind `cm-confirm-dialog`. A region still holding
  countries or sites cannot go: the dialog says what is in the way and offers to open the country
  list instead.

⚠️ **The country decides the region.** `applyHierarchy()` in the mock derives a site's `regionId`
from its chosen country and ignores whatever `regionId` was sent — the same rule the API enforces,
so the denormalised copy cannot drift. Moving a country therefore also **re-points every site
bound to it**, which `reassignCountries()` reports as `sitesResynced` and the dialog surfaces.

The mock enforces the rest of the rules too, because they are the demo: a duplicate region code
is refused, and so is deleting a region still in use — both shaped like the API's error body
(`{ error: { error: '…' } }`), which is what the screens read for their message.

## Global Form Components

### `<app-hierarchy-select>`
`features/hierarchy-select/` — searchable dropdown with grouped options. Implements
`ControlValueAccessor`, so it works with `[(ngModel)]`. Inputs:

- `[groups]: SelectGroup[]` — `{ group: string; items: { value: string; label: string }[] }[]`
  for local filtering. Or `[searchFn]: (q: string) => Observable<SelectGroup[]>` for async
  (e.g., SAP Internal Order lookup).
- `bindValue: 'label' | 'value'` — what to emit on select (default `'label'`).
- `placeholder`, `disabled`, `minChars`.
- `emptyActionLabel` + `(emptyAction)` — offers an action when a search matches nothing and emits
  the text that found it nothing, so the host can prefill a form with it. Used for
  *"+ Add this as a new region"*; left empty the empty state stays plain text, which is right for
  a closed catalogue like Country.

Notable behavior:
- Dropdown uses `position: fixed` with dynamic coordinates so it escapes any scroll/overflow
  ancestor (works inside scrollable containers without clipping).
- An in-dropdown **"Clear selection"** row appears whenever a value is set, emitting `''`.
- ⚠️ Outside-click detection checks the HOST **and the panel**: the dropdown is re-parented to
  `<body>` while open, so testing the host alone counts a click on an option as "outside" and
  closes the list before the selection lands.

Currently used on **Invoice Upload** (supplier, site, team, currency, account, internal
order, recharge sites) and on **Forecast** filter chips. When embedding inside a styled
host (like the Forecast chip), wrap the override in a parent class + `::ng-deep` so other
usages aren't affected.

---

## Side Navigation (`features/side-nav/`)

Replaces the old top-nav. Always visible, left of the router outlet, and it owns
`<app-theme-toggle>`.

Renders from a **data array**, not hardcoded markup — `groups: { title, items }[]` in
`side-nav.component.ts`, in three sections:

| Group | Items |
|---|---|
| Overview | Dashboard (`/`) |
| Cost Management | Invoice View, Invoice Upload, Forecast, Headcount, Budget Planner *(new)* |
| Administration | Scenario Management, **Scenario Mgmt v1**, Master Data, Period Management, Audit Log |

- **Collapsible** via `collapsed` — collapsed shows icons only, labels hidden.
- Icons are **inline SVG** selected by an `*ngSwitch` on `item.icon`, so there are no asset
  requests and they inherit `currentColor` for theming. Invoice View uses `receipt` (not
  `list`, which Audit Log already uses — two identical marks in one rail is unreadable).
- Colours come from the app's own CSS variables, so it themes with everything else.

**All links are real `routerLink`s.** The previous nav pointed Scenario Management and Admin
at two *external* Vercel deployments (`cost-center-theta`, `cost-management-admin`) via
`<a href target="_blank">`. Those screens now live in this app, so the external links and the
matching buttons on the old home page are gone.

---

## Frozen reference screens (`*-legacy`)

`components/scenario-management-legacy/` is a verbatim copy of Scenario Management as it stood
before the CCM-047/048/049/051 port, routed at `/scenario-management-legacy` and listed in the
rail as **Scenario Mgmt v1**. It exists so the current screen can be compared against what it
replaced — no Columns picker, no variance builder, no saved layout, no Cumulative Variance row.

Both screens read the **same mock service**, so the figures are identical and only the UI differs,
which is the whole point of keeping it.

**Rules for a frozen copy:** it is a snapshot, not a maintained screen — never "fix" it, and never
let it import from the live screen. It renames its component class, selector, template and style
paths, drops `export` from its interfaces (the live copy exports the same names), and inlines any
constant that has since been removed from the shared files, so the two can drift apart safely.
Delete the whole folder, its route, its declaration and its rail entry when the comparison is done.

## Forecast actuals are DERIVED from the invoice mock

The one place two mock services talk to each other, and the only cross-screen causality in the
build: **saving an invoice moves the Actual line on the Forecast grid.**

`ForecastService.applyDerivedActuals()` runs on every read and mirrors
`ForecastService.ApplyDerivedActualsAsync` server-side:

- The join is **internal order + year, and nothing else.** Site, team and account live on the
  forecast *header* and only decide which rows are on screen — so one internal order used by
  three rows shows the same actuals on all three. That is production's behaviour, not a shortcut
  here; do not "fix" it.
- A row with **no internal order can never show actuals**, which is why the grid's Internal Order
  cell is a master-data lookup and not a text box.
- The posting month is the line's **Period Start**, falling back to the invoice date.
- Credits count **negative**; the local figure is `amount × FX`, the contract figure is the raw
  amount, and `recharge-actual` follows the line's recharge allocations.

**Seeded Actual figures stand for invoices posted before the demo's invoice list begins.** There
is no invoice behind the May–July numbers and there is not meant to be. Each pass restores them
and lays the derived months on top, so editing or removing an invoice takes its figure back off
the grid instead of leaving a stale one behind.

### Unbudgeted invoices raise their own row

An invoice saved with **Budgeted OFF** is spend that was never forecast. Since actuals only ever
derive onto rows that already exist, production creates a forecast line for it while saving
(`EnsureUnbudgetedForecastLinesAsync`) — empty of monthly values, there purely to give the
figures somewhere to land, and badged **UB** in the grid.

`ensureUnbudgetedLines()` reproduces it, matched on site + team + account + internal order
(production's header key plus the line's order). **INV-1063 is seeded unbudgeted against IO7**,
an internal order with no forecast line of its own, so the badge and the auto-raised row are
visible without anyone keying an invoice first.

Two things to know before touching it:

- **The dependency runs one way: Forecast reads Invoice, never the reverse.** Production raises
  the row while saving the invoice; doing that here would need the invoice mock to call the
  forecast mock, and Angular would refuse the circular injection. The rows are materialised on
  read instead — same rows, same badge, raised a moment later.
- ⚠️ **Auto-raised rows use high positive ids (9001+), never negative ones.** The grid reads
  `id < 0` as "added here and never saved" (`isNewRow`) and pins such rows to the top of every
  page — a negative id put the row on screen twice, once riding along as unsaved and once in the
  page it belongs to.

---

## Showcase Build — the Mock Data Layer

**This app has no backend.** It is the public-facing demo of the Cost Management module that
lives in the production repo (`CrownFrontendCostCenter/ControlTowerAngular`). Non-team
viewers see this deployment only.

### The porting rule: mock the SERVICE, never the component

Every screen was copied from production **unmodified**. Only the services were rewritten:
the interfaces, method names and return types are byte-for-byte production's — just `of(...)`
+ `delay(...)` instead of `HttpClient`.

```
production:  Component ── unchanged ──> Service ──> HttpClient ──> API
showcase:    Component ── unchanged ──> Service ──> in-memory array
```

This is what keeps the demo honest and the port cheap: when a screen changes upstream, the
component file can be copied straight across again with no re-editing.

**There is no `HttpClient` in `services/` — verify with a grep before adding one.** The
`GET /api/v1/...` lines in those files are *documentation* of the real endpoint each mock
stands in for; they are not live calls.

### State is real, in memory

Mocks mutate their own arrays, so the demo behaves like the product for the length of a
session: saving an invoice really adds it to the list, editing a forecast really persists,
approving a budget really locks it. It resets on reload — the right amount of permanence for
a demo.

The **business rules are enforced in the mocks too**, not skipped:
- `BudgetService.save()` refuses an approved year with the API's own message — the lock is
  the feature, and "why can't I edit this?" is the first thing a viewer tries.
- `InvoiceService.findDuplicate()` is genuinely implemented (invoice number + supplier), so
  the duplicate alert really fires.
- `RechargeService` keeps the allocation shape, so the 100% rule stays demonstrable.

### The one thing that cannot be faked

`InvoiceService.getPdf()` **deliberately throws**. There is no storage, so a fabricated blob
would render as a broken viewer; an explicit failure at least reads as "not available in the
demo". `uploadPdf()` accepts the file and discards it.

### ⚠️ Field names are the whole game

Mock rows are cast (`as unknown as SomeDto`), so **a wrong field name compiles perfectly and
renders blank**. This bit three times during the port:

| Screen | Invented name | Real name | Symptom |
|---|---|---|---|
| Invoice View | `invoiceNumber` / `invoiceAmount` | `invNumber` / `invAmount` | a column of dashes |
| Invoice Edit | `lines` | `lineItems` | blank form, 0.00 amount |
| Audit Log | `entityName` / `changedBy` / … | `timestamp` / `user` / `actionType` / `module` / `recordAffected` / `oldValue` / `newValue` | 8 rows of empty cells |
| Forecast | `itemDescription` | `description` | empty Item Desc column — **and** the Related Data panel had no description to inherit |
| Internal-order type-ahead | `{ label, options }` | `SelectGroup` = `{ group, items }` | six matches returned, dropdown rendered empty, so the panel's internal-order auto-fill had nothing to fill from |
| Forecast Audit | `actionTaken` / `oldStatus` / `newStatus` / `changedBy` / `changedDate` | `ForecastChangeLog` = `timestamp` / `user` / `internalOrder` / `description` / `scenario` / `site` / `team` / `account` / `year` / `changes[]` | every card rendered as dashes the moment the screen was ported — the mock had been written for a shape nothing read |

**Rule:** a green build proves nothing here. After touching a mock, *open the page*. If a
field shows as `-`, `0.00`, or blank, check the name against the interface before anything
else.

### ⚠️ …and so are field VALUES: codes vs names

A `<select>` whose model matches no option value renders **blank**, exactly like missing data.
That is a second, quieter version of the same bug, and it hit every grid at some point:

| Field | Stored as | Where the options come from |
|---|---|---|
| Site, Team, Supplier, Account, Currency | master-data **code** (`london-hq`, `gl-6100`) | `MasterDataService` lookups |
| Spend Type, Spend Layer, Category, System | master-data **name** (`Subscription`, `IT Subscriptions`) | the same lookups, mapped by name |

That split is production's, not the showcase's — do not "tidy" it. Headcount's mock rows once
carried `'Montego-UKCP'` / `'Infrastructure'` and both dropdowns looked unbound when the wiring
was correct all along.

Two related traps in the same family:

- **A missing field can empty a whole lookup.** `MasterDataService` sites need `currencyId`:
  Invoice Upload offers only sites that have one (a site with no currency cannot price an
  invoice), so seeding sites without it left the Site type-ahead with zero options and no error
  anywhere. Dublin is deliberately left without one — it is recharge-target-only, which is what
  keeps the "All Sites" recharge list distinguishable from the processing-site list.
- **A missing flag hides a whole feature.** No mock row had `rechargeRequired`, so the green
  "Forecast after Recharge" line could never appear on any row. See "Forecast specifics".

### Services and what they stand in for

| Service | Feeds |
|---|---|
| `cost-dashboard` | the dashboard — spend by cost type / vendor / team, budget trend |
| `source-of-change` | the Source of Change report |
| `cost-center-dashboard` | Scenario Management's Actual/RFC comparison grid, incl. CCM-051 cumulative variance |
| `budget` | Budget Planner (spread / save / approve / reopen) |
| `forecast` | Forecast grid + change history |
| `invoice` | Invoice View / Upload / Edit, duplicates, related data |
| `recharge` | recharge instructions drill |
| `internal-order` | the IO type-ahead |
| `headcount` | the Headcount grid — paged list, bulk save, year-aware totals |
| `user` | the Employee lookup on Headcount (stands in for User & Access Management) |
| `user-preference` | CCM-049 saved screen layouts — the only mock that writes `localStorage` rather than memory |
| `master-data` | sites, teams, accounts, suppliers, currencies, **regions + the 196-country ISO list** |
| `period` | Period Management |
| `audit-log` | Audit Log |
| `theme` | the only service that is NOT a mock — real behaviour |

---

## Ported Components (`features/cm-*`)

Several shared components exist **twice**, and that is intentional:

| Existing (pre-showcase) | Ported from production |
|---|---|
| `features/modal/` | `features/cm-modal/` |
| `features/hierarchy-select/` | `features/cm-hierarchy-select/` |
| `features/date-picker/` | `features/cm-date-picker/` |

The originals are used by Invoice Upload, Forecast filter chips and Headcount, and their
markup and styling had already diverged from production. Overwriting them would have silently
restyled screens that were already signed off. The ported copies are prefixed `cm-` and used
**only** by the newly ported screens.

**Rule:** building on a pre-existing screen → use the unprefixed component. Porting a new
screen from production → use the `cm-` one. Do not attempt to merge the pairs without
checking every existing usage first.

---

## ⚠️ Modals must dim the WHOLE window

Every `<cm-modal>` passes `[attachToBody]="true"`, and `confirm-dialog` / `pdf-viewer` portal
their own overlay to `<body>`.

This is **not** a z-index problem and raising one does not fix it: the app shell is a flex row
whose content column confines the routed screen, so an overlay rendered inside a page is compared
only with its siblings there — never with the side-nav. The rail stayed bright and clickable over
a full-viewport scrim, and the card looked see-through because the dim layer was painted under it.

Moving the node to `<body>` escapes every ancestor at once. The theme custom properties are copied
onto the element at move time, because `<body>` does not inherit them and the card would otherwise
render transparent.

**Rule:** a new modal gets `[attachToBody]="true"` when it is added, not when someone notices the
sidenav showing through.

## ⚠️ Global Tooltip (`features/tooltip/`)

`[cmTooltip]` appends its bubble to `document.body` so it escapes every `overflow: hidden`
and stacking context on the page.

**That means `tooltip.css` MUST be a global stylesheet, registered in `angular.json` →
`styles`.** It cannot be a component stylesheet: Angular's `_ngcontent` scoping never reaches
a node that has been moved to `<body>`.

This is easy to get wrong — during the port the directive was copied with a `*.ts` glob and
`tooltip.css` was left behind. The result was tooltips with *no bubble at all*: transparent
background, no border, no shadow, no padding, 16px inherited text floating on the page. It
compiled and ran fine.

Two consequences worth remembering:
- **Editing `angular.json` requires a dev-server restart**, not a rebuild. `ng serve` reads
  it once at startup, so the stylesheet silently stays missing until you restart.
- Visuals live on **`.ttp-content`**, not `.ttp-bubble`. `.ttp-bubble` is only the positioner
  (`position: fixed`, `z-index: 99999`, `pointer-events: none`) and is *correctly*
  transparent. If you inspect the wrong node it will look unstyled even when it is fine.
- The bubble is **light on Crown's dark UI** by design; a dark bubble on a dark screen reads
  poorly. A `ttp-dark` variant is kept for light contexts.

---

## ⚠️ Container queries are NOT scoped by the Angular 14 shim

The invoice form grid drops from three columns to two on the width of its **column**, not the
window — the column's width depends on the drag rail and the Hide Preview toggle as well as the
viewport, so a viewport breakpoint misses half the cases (it forced two columns at 917px, where
three fit comfortably).

`.form-column` is therefore `container-type: inline-size`, and the breakpoint is a
`@container invoice-form (max-width: 560px)` rule. **Angular 14's emulated-encapsulation shim
does not know `@container`**, so it leaves the selectors inside it unscoped while rewriting
everything outside:

```css
.form-grid.cols-3[_ngcontent-fen-c64] { grid-template-columns: repeat(3, 1fr); }   /* (0,3,0) */
@container invoice-form (max-width: 560px) {
  .form-grid.cols-3 { grid-template-columns: repeat(2, 1fr); }                     /* (0,2,0) */
}
```

The base rule wins on specificity and the breakpoint does nothing at all — it compiles, it ships,
and the fields just overlap. The declarations inside the `@container` block carry `!important`
for that reason. `@media` and `@supports` blocks ARE scoped normally; this is specific to
`@container`. Angular 15 (the production repo) scopes it correctly, which is why the same SCSS
needs no `!important` there.

**Rule:** after adding any `@container` rule, check the computed style in the browser rather than
trusting the build — `getComputedStyle(el).gridTemplateColumns` at a width that should have
triggered it.

---

## Routes

Defined in `app-routing.module.ts`:

| Path | Screen |
|---|---|
| `''` | **Dashboard** (the landing route) |
| `invoice-view` · `invoice-upload` · `invoice-edit/:id` | Invoice screens |
| `forecast` · `forecast-audit` · `headcount` · `budget-planner` · `scenario-management` | Cost Management |
| `scenario-management-legacy` | The Scenario Management screen as it was BEFORE the variance work — a frozen reference, see below |
| `admin` | redirects → `admin/master-data` |
| `admin/master-data` · `admin/periods` · `admin/audit-log` | Administration |
| `**` | redirects → `''` |

### ⚠️ The wildcard hides broken links

`**` → `''` means **any wrong route silently lands on the Dashboard** instead of 404-ing.

Ten links carried over from production still pointed at its route prefix
(`/Cost-Management/...`, which does not exist here) across 7 files. Every one of them looked
like a working button that "just went to the dashboard" — including *Upload Invoice* on the
Invoice View screen. They were only found by clicking through.

⚠️ **They came back.** The next sync re-copied those components from production and restored
all ten, *Upload Invoice* included. This is not a one-off mistake to be fixed once: a link is
re-imported with every component that carries it, so the sweep belongs in the sync itself.

**Rule:** after porting or re-syncing ANY screen, grep the whole tree for `/Cost-Management`
(it should return 0) and click every navigation control. A link that lands on the dashboard is
a broken link until proven otherwise.

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

### ⚠️ ALWAYS run `npx ng build` before pushing

**`ng serve` cannot tell you whether the deploy will succeed.** The dev server uses the
**development** configuration; budgets, and every other production-only check, are enforced
only on the **production** configuration that Vercel runs. A screen can serve perfectly for
weeks and still fail the deploy the moment it is pushed.

```bash
cd cost-management && npx ng build      # exactly what Vercel runs
```

Treat a clean local `ng build` as the gate for pushing. It takes ~25s and costs a great deal
less than a failed deploy round-trip.

### ⚠️ Budget failures stack — fixing the reported one is not enough

Angular reports the **first** budget error and stops. There can be more behind it.

This bit exactly once: Vercel reported `invoice-upload.component.scss` at 27.67 kB over a
25 kB limit. Raising that limit surfaced a *second*, previously invisible failure — the
initial bundle at 1.03 MB over a 1 MB limit — which would have been the next failed deploy.

**Rule:** after fixing a budget error, run the full build again and keep going until it exits
0. Never fix the named error and push.

### Current budgets and the headroom behind them

Set in `angular.json` → `projects.cost-management.architect.build.configurations.production.budgets`:

| Budget | Warning | Error |
|---|---|---|
| `anyComponentStyle` | 40 kB | 60 kB |
| `initial` | 1.5 MB | 2.5 MB |

Raised twice: from `10 kB / 25 kB` and `500 kB / 1 MB`, then again when the production screens
landed — `forecast.component.scss` alone compiles to 35.26 kB against what was a 40 kB error
ceiling, and four component stylesheets sat above the 25 kB warning. **Budgets are a lint guard, not a runtime
limit** — nothing about a 27 kB component stylesheet breaks the app, and the initial bundle
transfers at ~212 kB gzipped. Trimming CSS out of signed-off screens to satisfy an arbitrary
ceiling risks visual regressions for no real benefit.

The screens grow by CSS faster than by anything else — Forecast went 24.29 kB → 35.26 kB
compiled as the source-currency rows, the after-recharge line and the pager landed. Each raise
has been a response to a real failure, not pre-emptive headroom, so **do not lower these
budgets back**; the warning thresholds keep the signal without failing the build.

Current initial total: **1.18 MB raw / 211.62 kB transfer**.

### If the bundle keeps growing

The 1.03 MB initial bundle is real, not just a threshold problem — it grew as screens were
ported, and every route is currently eagerly loaded from a single `AppModule`.

**Raising the budget again is not the answer a second time.** The lever is **lazy-loading**
the admin and invoice routes via `loadChildren`, which takes them out of the initial chunk
entirely. Budgets exist to prompt exactly that conversation; treat a second `initial` failure
as the signal to do it.

### Deploy checklist

1. `cd cost-management && npx ng build` — must exit 0, warnings are fine
2. Click through the screens on `ng serve` (a green build proves nothing about rendering —
   see "Field names are the whole game")
3. Confirm no new hardcoded `/Cost-Management/...` links (see "Routes")
4. Push

### Editing `angular.json`

Changes are read **once at dev-server startup**. After editing it — adding a global
stylesheet, changing budgets — **restart `ng serve`**; a rebuild will not pick it up, and the
change silently appears to do nothing.

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
- `ThemeService` (providedIn: root) reads `localStorage` key `'theme'` on startup and
  **defaults to DARK** when nothing is saved — `saved ? saved === 'dark' : true`.
  It no longer falls back to system preference: the dashboard is designed dark, and a
  light-mode shell around a dark dashboard read as a half-finished theme in demos.
  A saved choice still wins, so the toggle sticks.
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
- Lives in `side-nav.component.html` as `<app-theme-toggle>`
- Light mode shows moon icon: `assets/icons/DarkThemeMoonIcon.svg`
- Dark mode shows inline SVG sun (stroke="currentColor" — inherits `var(--text-heading)`)

---

## Scrollbar
Defined globally in `styles.scss`. Width 5px, track transparent, thumb uses `var(--border-color)`. Applies automatically to any `overflow-y: auto` element — no per-component work needed.

---

## App Header (retired)
`features/app-header/` — blue gradient, hardcoded, intentionally exempt from dark mode.

**No longer rendered.** The side-nav carries the branding, and the gradient bar cost vertical
space the dashboard needed. The component is still declared and still compiles — left in the
tree deliberately. **Do not modify it, and do not re-add it to the shell.**

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

## Mobile / Responsive

Dashboard, Forecast and Headcount each carry a full small-screen implementation. It is **not**
CSS-only: two flags on the component decide which markup renders at all.

```ts
isMobileView = window.innerWidth <= 768;   // compact toolbar, condensed grid
isCardView   = window.innerWidth <= 480;   // the table is replaced by cards
@HostListener('window:resize') ...          // both recomputed, editors reconciled
```

- At **≤480px** the two-table grid is replaced by one card per record — a facts grid, a Comments
  button and the twelve month inputs, with a fixed Cancel/Save footer. `.hcm-facts` closes a
  dangling last item with `> div:last-child:nth-child(odd) { grid-column: 1 / -1 }`.
- Leaving card view **reconciles the open row editor** (`applyRowEditor()`) rather than
  discarding it, so a resize mid-edit does not lose typing.
- `scrollIntoView` uses **`block: 'start'` in card view** and `'nearest'` otherwise. `'nearest'`
  aligns the *bottom* of an element taller than the scrollport, so a newly added card scrolled
  to its far end and looked like the scroll had failed.
- Breakpoints in use: `1600px` (split panes), `768px` (mobile), `480px` / `420px` (cards).

**Verifying this is awkward** — the browser-automation harness renders at a fixed logical width,
so resizing the window does not reflow the page. Drive the flags directly instead:
`ng.getComponent(document.querySelector('cm-headcount'))`, set `isCardView = true`, then
`ng.applyChanges(c)`. The same harness cannot confirm IntersectionObserver, CSS transitions or
programmatic scrolling either — its tab is hidden with rAF suspended, so verify those by driving
the logic and counting the calls, not by watching the page.

---

## Known Gaps in the Showcase

Deliberate, and worth knowing before demoing:

- **User Access & Roles is not ported.** It depends on `ag-grid-community`, which is not a
  dependency of this project. Adding it for one screen is a real cost; the alternative is
  rebuilding that grid as a plain table. Undecided — do not assume the screen is simply
  missing by accident.
- **Stored PDFs are unavailable** — no storage. `getPdf()` throws on purpose, so opening an
  existing invoice shows the file-name chip and an empty panel. A PDF picked in the browser
  is fully live: it previews, drags, folds and magnifies, because its object URL never
  leaves the page. Demo the zoom features by picking a file on Upload, not by opening a row.
- **Recurring invoices do not project onto the forecast.** `isRecurring` is carried on the
  payload and documented, but production's `EnsureRecurringForecastLinesAsync` — which fills the
  remaining periods of the year, and only the months still empty — has no mock behind it. The
  invoice-derived actuals and the unbudgeted row DO work; see "Forecast actuals are DERIVED".
- **The Related Data panel is static.** `getRelatedData()` ignores its query and returns one
  hardcoded forecast line, so it shows the same thing whatever invoice is open.
- **State resets on reload.** Everything is in memory — except the three things a demo would look
  broken without: Headcount row order and comments, and the Scenario Management saved layout,
  which use `localStorage`.
- **No authentication.** Production sits behind the Performance Hub shell; there is no
  sign-in here and `lastUpdatedBy` values are seeded names.
- **Figures are illustrative.** Plausible, internally consistent, and not Crown's real spend.
- **Headcount row removal is local only.** `removeRow()` drops the row from the grid; there is
  no delete call behind it (the production repo carries the same TODO).
- **Scenario Management lists site and team CODES**, not names. That matches production —
  `this.sites = ['All Sites', ...rows.map(r => r.code ?? r.name)]` — so it is left alone here
  rather than fixed only in the showcase.

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
