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
   name compiles perfectly and paints a blank screen. Open the page → see "Showcase Build".
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

### Invoice View / Upload / Edit (`components/invoice-*/`)
List, entry and edit, with duplicate detection (invoice number + supplier), the related-data
panel, and the recharge drill. PDF viewing is the one unavailable feature — see "Showcase
Build".

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

## Side Navigation (`features/side-nav/`)

Replaces the old top-nav. Always visible, left of the router outlet, and it owns
`<app-theme-toggle>`.

Renders from a **data array**, not hardcoded markup — `groups: { title, items }[]` in
`side-nav.component.ts`, in three sections:

| Group | Items |
|---|---|
| Overview | Dashboard (`/`) |
| Cost Management | Invoice View, Invoice Upload, Forecast, Headcount, Budget Planner *(new)* |
| Administration | Scenario Management, Master Data, Period Management, Audit Log |

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

**Rule:** a green build proves nothing here. After touching a mock, *open the page*. If a
field shows as `-`, `0.00`, or blank, check the name against the interface before anything
else.

### Services and what they stand in for

| Service | Feeds |
|---|---|
| `cost-dashboard` | the dashboard — spend by cost type / vendor / team, budget trend |
| `source-of-change` | the Source of Change report |
| `cost-center-dashboard` | Scenario Management's Actual/RFC comparison grid |
| `budget` | Budget Planner (spread / save / approve / reopen) |
| `forecast` | Forecast grid + change history |
| `invoice` | Invoice View / Upload / Edit, duplicates, related data |
| `recharge` | recharge instructions drill |
| `internal-order` | the IO type-ahead |
| `master-data` | sites, teams, accounts, suppliers, currencies |
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

## Routes

Defined in `app-routing.module.ts`:

| Path | Screen |
|---|---|
| `''` | **Dashboard** (the landing route) |
| `invoice-view` · `invoice-upload` · `invoice-edit/:id` | Invoice screens |
| `forecast` · `headcount` · `budget-planner` · `scenario-management` | Cost Management |
| `admin` | redirects → `admin/master-data` |
| `admin/master-data` · `admin/periods` · `admin/audit-log` | Administration |
| `**` | redirects → `''` |

### ⚠️ The wildcard hides broken links

`**` → `''` means **any wrong route silently lands on the Dashboard** instead of 404-ing.

Ten links carried over from production still pointed at its route prefix
(`/Cost-Management/...`, which does not exist here) across 7 files. Every one of them looked
like a working button that "just went to the dashboard" — including *Upload Invoice* on the
Invoice View screen. They were only found by clicking through.

**Rule:** after porting a screen, grep it for `/Cost-Management` and click every navigation
control. A link that lands on the dashboard is a broken link until proven otherwise.

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
| `anyComponentStyle` | 25 kB | 40 kB |
| `initial` | 1 MB | 2 MB |

Raised from `10 kB / 25 kB` and `500 kB / 1 MB`. **Budgets are a lint guard, not a runtime
limit** — nothing about a 27 kB component stylesheet breaks the app, and the initial bundle
transfers at ~194 kB gzipped. Trimming CSS out of signed-off screens to satisfy an arbitrary
ceiling risks visual regressions for no real benefit.

Compiled sizes at the time of the raise — note how little headroom the old ceiling left:

| Component style | Compiled | vs the old 25 kB error |
|---|---|---|
| invoice-upload | 27.67 kB | over — the reported failure |
| **forecast** | **24.29 kB** | **under by only 0.71 kB** |
| dashboard | 19.00 kB | ok |
| headcount | 16.52 kB | ok |
| invoice-view | 12.48 kB | ok |

Forecast was 0.71 kB from the same failure. Restoring the old ceiling would break the build on
the next CSS tweak to that screen — so **do not lower these budgets back**. Warnings still
fire at the old-ish thresholds, so the signal is kept without failing the build.

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

## Known Gaps in the Showcase

Deliberate, and worth knowing before demoing:

- **User Access & Roles is not ported.** It depends on `ag-grid-community`, which is not a
  dependency of this project. Adding it for one screen is a real cost; the alternative is
  rebuilding that grid as a plain table. Undecided — do not assume the screen is simply
  missing by accident.
- **PDF view/download is unavailable** — no storage. `getPdf()` throws on purpose.
- **State resets on reload.** Everything is in memory.
- **No authentication.** Production sits behind the Performance Hub shell; there is no
  sign-in here and `lastUpdatedBy` values are seeded names.
- **Figures are illustrative.** Plausible, internally consistent, and not Crown's real spend.

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
