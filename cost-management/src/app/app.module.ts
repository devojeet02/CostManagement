import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { AppHeaderComponent } from './features/app-header/app-header.component';
import { TopNavComponent } from './features/top-nav/top-nav.component';
import { HomeComponent } from './components/home/home.component';
import { ThemeToggleComponent } from './features/theme-toggle/theme-toggle.component';
import { InvoiceUploadComponent } from './components/invoice-upload/invoice-upload.component';
import { ForecastComponent } from './components/forecast/forecast.component';
import { HeadcountComponent } from './components/headcount/headcount.component';
import { DatePickerComponent } from './features/date-picker/date-picker.component';
import { HierarchySelectComponent } from './features/hierarchy-select/hierarchy-select.component';
import { ModalComponent } from './features/modal/modal.component';
import { SnackbarComponent } from './features/snackbar/snackbar.component';
import { NumberFormatDirective } from './features/number-format/number-format.directive';
import { SideNavComponent } from './features/side-nav/side-nav.component';
import { CostDashboardComponent } from './components/dashboard/cost-dashboard.component';
import { BudgetTrendComponent } from './features/budget-trend/budget-trend.component';
import { VendorDrillComponent } from './features/vendor-drill/vendor-drill.component';
import { PeriodRangeComponent } from './features/period-range/period-range.component';
import { SourceOfChangeComponent } from './features/source-of-change/source-of-change.component';
import { LoaderComponent } from './features/loader/loader.component';
import { TooltipDirective } from './features/tooltip/tooltip.directive';
import { CmModalComponent } from './features/cm-modal/cm-modal.component';
import { ScenarioManagementComponent } from './components/scenario-management/scenario-management.component';
import { AdminCostManagementComponent } from './components/admin-cost-management/admin-cost-management.component';
import { PeriodManagementComponent } from './components/period-management/period-management.component';
import { AuditLogComponent } from './components/audit-log/audit-log.component';
import { BudgetPlannerComponent } from './components/budget-planner/budget-planner.component';
import { ConfirmDialogComponent } from './features/confirm-dialog/confirm-dialog.component';
import { CmHierarchySelectComponent } from './features/cm-hierarchy-select/cm-hierarchy-select.component';
import { ForecastCellCommentComponent } from './features/forecast-cell-comment/forecast-cell-comment.component';
import { ForecastCommentsModalComponent } from './features/forecast-comments-modal/forecast-comments-modal.component';
import { RechargeDrillComponent } from './features/recharge-drill/recharge-drill.component';
import { CmDatePickerComponent } from './features/cm-date-picker/cm-date-picker.component';
import { PdfViewerComponent } from './features/pdf-viewer/pdf-viewer.component';
import { RelatedDataPanelComponent } from './features/related-data-panel/related-data-panel.component';
import { DuplicateInvoiceAlertComponent } from './features/duplicate-invoice-alert/duplicate-invoice-alert.component';
import { InvoiceViewComponent } from './components/invoice-view/invoice-view.component';
import { InvoiceEditComponent } from './components/invoice-edit/invoice-edit.component';


@NgModule({
  declarations: [
    AppComponent,
    AppHeaderComponent,
    TopNavComponent,
    HomeComponent,
    ThemeToggleComponent,
    InvoiceUploadComponent,
    ForecastComponent,
    HeadcountComponent,
    DatePickerComponent,
    HierarchySelectComponent,
    ModalComponent,
    SnackbarComponent,
    NumberFormatDirective,
    SideNavComponent,
    CostDashboardComponent,
    BudgetTrendComponent,
    VendorDrillComponent,
    PeriodRangeComponent,
    SourceOfChangeComponent,
    LoaderComponent,
    TooltipDirective,
    CmModalComponent,
    ScenarioManagementComponent,
    AdminCostManagementComponent,
    PeriodManagementComponent,
    AuditLogComponent,
    BudgetPlannerComponent,
    ConfirmDialogComponent,
    CmHierarchySelectComponent,
    ForecastCellCommentComponent,
    ForecastCommentsModalComponent,
    RechargeDrillComponent,
    CmDatePickerComponent,
    PdfViewerComponent,
    RelatedDataPanelComponent,
    DuplicateInvoiceAlertComponent,
    InvoiceViewComponent,
    InvoiceEditComponent
  ],
  imports: [
    BrowserModule,
    FormsModule,
    AppRoutingModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
