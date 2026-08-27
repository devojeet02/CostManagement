import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CostDashboardComponent } from './components/dashboard/cost-dashboard.component';
import { InvoiceUploadComponent } from './components/invoice-upload/invoice-upload.component';
import { ForecastComponent } from './components/forecast/forecast.component';
import { HeadcountComponent } from './components/headcount/headcount.component';
import { ScenarioManagementComponent } from './components/scenario-management/scenario-management.component';
import { AdminCostManagementComponent } from './components/admin-cost-management/admin-cost-management.component';
import { PeriodManagementComponent } from './components/period-management/period-management.component';
import { AuditLogComponent } from './components/audit-log/audit-log.component';
import { BudgetPlannerComponent } from './components/budget-planner/budget-planner.component';
import { InvoiceViewComponent } from './components/invoice-view/invoice-view.component';
import { InvoiceEditComponent } from './components/invoice-edit/invoice-edit.component';

/**
 * ROOT IS THE DASHBOARD.
 *
 * It used to be a button grid (`HomeComponent`) whose only job was linking onward - the
 * sidenav does that now, so the landing page can be the thing people actually came to see.
 * HomeComponent is left in the tree unrouted rather than deleted, so nothing else that
 * references it breaks; it is simply unreachable.
 */
const routes: Routes = [
  { path: '', component: CostDashboardComponent },
  { path: 'invoice-view', component: InvoiceViewComponent },
  { path: 'invoice-upload', component: InvoiceUploadComponent },
  { path: 'invoice-edit/:id', component: InvoiceEditComponent },
  { path: 'forecast', component: ForecastComponent },
  { path: 'headcount', component: HeadcountComponent },
  { path: 'budget-planner', component: BudgetPlannerComponent },
  { path: 'scenario-management', component: ScenarioManagementComponent },
  // Admin is a small section rather than a single screen, so it gets its own child routes.
  { path: 'admin', redirectTo: 'admin/master-data', pathMatch: 'full' },
  { path: 'admin/master-data', component: AdminCostManagementComponent },
  { path: 'admin/periods', component: PeriodManagementComponent },
  { path: 'admin/audit-log', component: AuditLogComponent },
  // An unknown path returns to the dashboard rather than leaving a blank outlet.
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule { }
