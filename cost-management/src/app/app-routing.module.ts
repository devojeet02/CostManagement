import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { InvoiceUploadComponent } from './components/invoice-upload/invoice-upload.component';
import { ForecastComponent } from './components/forecast/forecast.component';
import { HeadcountComponent } from './components/headcount/headcount.component';

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'invoice-upload', component: InvoiceUploadComponent },
  { path: 'forecast', component: ForecastComponent },
  { path: 'headcount', component: HeadcountComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
