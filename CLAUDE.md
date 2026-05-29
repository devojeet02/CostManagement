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
- Month cells are **binary** (1 = present, 0 = absent) — enforced via `normalizeBinary()`;
  no fractional values (see Business Domain Rules → Headcount).
- The "other scenario" (Budget) row is revealed by the **Show Other Scenario** toggle, whose
  "on" tone is the green (`rgb(68,217,68)` + glow) borrowed from the invoice-upload switch.
- Per-row free-text **Comments** column (sticky, see above).
- **TOTAL HEADCOUNT** footer sums presence per month/scenario, with inline variance colour
  on the primary row vs Budget (red = over budget, green = on/under).

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
