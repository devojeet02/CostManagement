import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CostDashboardComponent } from './components/dashboard/cost-dashboard.component';
import { InvoiceUploadComponent } from './components/invoice-upload/invoice-upload.component';
import { ForecastComponent } from './components/forecast/forecast.component';
import { HeadcountComponent } from './components/headcount/headcount.component';

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
  { path: 'invoice-upload', component: InvoiceUploadComponent },
  { path: 'forecast', component: ForecastComponent },
  { path: 'headcount', component: HeadcountComponent },
  // Scenario Management, Budget Planner and the Admin screens land here next; until then an
  // unknown path returns to the dashboard rather than a blank outlet.
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule { }
