import {
  BusinessDimension,
  CostManagementDatabase,
  InvoiceRecord,
  MonthlyCostRecord,
  ScenarioRecord,
} from './cost-dashboard.data';

const regions: BusinessDimension[] = [
  { id: 'americas', type: 'region', label: 'Americas' },
  { id: 'emea', type: 'region', label: 'EMEA' },
  { id: 'apac', type: 'region', label: 'APAC' },
];

const countries: BusinessDimension[] = [
  { id: 'us', type: 'country', label: 'United States', parentId: 'americas' },
  { id: 'germany', type: 'country', label: 'Germany', parentId: 'emea' },
  { id: 'india', type: 'country', label: 'India', parentId: 'apac' },
];

const entities: BusinessDimension[] = [
  { id: 'manufacturing', type: 'entity', label: 'Crown Manufacturing' },
  { id: 'packaging', type: 'entity', label: 'Crown Packaging' },
  { id: 'digital', type: 'entity', label: 'Crown Digital' },
];

const departments: BusinessDimension[] = [
  { id: 'eiss', type: 'department', label: 'EISS', subtitle: 'European Information Systems and Services.' },
  { id: 'finance', type: 'department', label: 'Finance', subtitle: 'Finance platforms and controls.' },
  { id: 'operations', type: 'department', label: 'Operations', subtitle: 'Plant productivity and support.' },
  { id: 'supply-chain', type: 'department', label: 'Supply Chain', subtitle: 'Planning, logistics, and procurement systems.' },
];

const vendors: BusinessDimension[] = [
  { id: 'azure-hosting', type: 'vendor', label: 'Azure Hosting' },
  { id: 'workday', type: 'vendor', label: 'Workday' },
  { id: 'infosys-advisory', type: 'vendor', label: 'Infosys Advisory' },
  { id: 'servicenow', type: 'vendor', label: 'ServiceNow' },
  { id: 'snowflake', type: 'vendor', label: 'Snowflake' },
];

const costTowers: BusinessDimension[] = [
  { id: 'employee-platforms', type: 'costTower', label: 'Employee Platforms', subtitle: 'HR and identity', color: '#6559ee' },
  { id: 'data-services', type: 'costTower', label: 'Data Services', subtitle: 'Analytics workloads', color: '#ff6477' },
  { id: 'plant-connectivity', type: 'costTower', label: 'Plant Connectivity', subtitle: 'WAN and edge', color: '#6559ee' },
  { id: 'business-apps', type: 'costTower', label: 'Business Apps', subtitle: 'Workflow and support', color: '#ff6477' },
];

const categories: BusinessDimension[] = [
  { id: 'core-platforms', type: 'category', label: 'Core Platforms', color: '#234a87' },
  { id: 'data-ai', type: 'category', label: 'Data & AI', color: '#493081' },
  { id: 'managed-services', type: 'category', label: 'Managed Services', color: '#0f6b54' },
  { id: 'security', type: 'category', label: 'Security', color: '#2f3646' },
  { id: 'other-run', type: 'category', label: 'Other Run', color: '#252c3a' },
];

const rechargeCenters: BusinessDimension[] = [
  { id: 'shared-it', type: 'rechargeCenter', label: 'Shared IT', color: '#347cff' },
  { id: 'manufacturing', type: 'rechargeCenter', label: 'Manufacturing', color: '#855dff' },
  { id: 'corporate', type: 'rechargeCenter', label: 'Corporate', color: '#22c79a' },
];

const scenarios: ScenarioRecord[] = [
  { id: 'budget', label: 'Budget', type: 'budget', revisionLabel: 'Budget' },
  { id: 'rolling-forecast', label: 'Rolling Forecast', type: 'forecast', revisionLabel: 'Jul RFC', isActive: true },
  { id: 'rfc2', label: 'RFC2', type: 'forecast', revisionLabel: 'RFC2 Jun', revisionMonth: '2026-06' },
  { id: 'rfc3', label: 'RFC3', type: 'forecast', revisionLabel: 'RFC3 Sept', revisionMonth: '2026-09' },
];

const monthKeys = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
const actualLoadedThrough = '2026-06';

const costPatterns = [
  { costTowerId: 'employee-platforms', categoryId: 'core-platforms', vendorId: 'workday', base: 190000, budgetFactor: 1.05, forecastFactor: 1.01 },
  { costTowerId: 'data-services', categoryId: 'data-ai', vendorId: 'snowflake', base: 235000, budgetFactor: 0.94, forecastFactor: 1.12 },
  { costTowerId: 'plant-connectivity', categoryId: 'managed-services', vendorId: 'azure-hosting', base: 145000, budgetFactor: 1.08, forecastFactor: 0.98 },
  { costTowerId: 'business-apps', categoryId: 'security', vendorId: 'servicenow', base: 210000, budgetFactor: 0.97, forecastFactor: 1.08 },
  { costTowerId: 'business-apps', categoryId: 'other-run', vendorId: 'infosys-advisory', base: 96000, budgetFactor: 0.88, forecastFactor: 1.2 },
];

const businessSlices = countries.flatMap((country, countryIndex) =>
  entities.flatMap((entity, entityIndex) =>
    departments.map((department, departmentIndex) => ({
      regionId: country.parentId ?? 'americas',
      countryId: country.id,
      entityId: entity.id,
      departmentId: department.id,
      weight: 0.012 + countryIndex * 0.003 + entityIndex * 0.002 + departmentIndex * 0.001,
    })),
  ),
);

const scenarioForecastFactor: Record<string, number> = {
  budget: 0.92,
  'rolling-forecast': 1,
  rfc2: 1.06,
  rfc3: 1.16,
};

export const COST_CENTER_FACT_RECORDS: MonthlyCostRecord[] = scenarios.flatMap((scenario) =>
  monthKeys.flatMap((month, monthIndex) =>
    businessSlices.flatMap((slice) =>
      costPatterns.map((pattern, patternIndex) => {
        const seasonality = 0.92 + monthIndex * 0.018 + (monthIndex % 3) * 0.035;
        const sliceAmount = pattern.base * slice.weight * seasonality;
        const budgetAmount = sliceAmount * pattern.budgetFactor;
        const forecastAmount = sliceAmount * pattern.forecastFactor * scenarioForecastFactor[scenario.id];
        const hasActual = month <= actualLoadedThrough;
        const actualPressure = patternIndex % 2 === 0 ? 0.97 : 1.08;
        const actualAmount = hasActual ? forecastAmount * actualPressure * (monthIndex >= 4 ? 1.04 : 0.98) : 0;

        return {
          id: `${scenario.id}-${month}-${slice.countryId}-${slice.entityId}-${slice.departmentId}-${pattern.costTowerId}-${pattern.vendorId}`,
          month,
          regionId: slice.regionId,
          countryId: slice.countryId,
          entityId: slice.entityId,
          departmentId: slice.departmentId,
          vendorId: pattern.vendorId,
          costTowerId: pattern.costTowerId,
          categoryId: pattern.categoryId,
          scenarioId: scenario.id,
          actualAmount: Math.round(actualAmount),
          forecastAmount: Math.round(forecastAmount),
          budgetAmount: Math.round(budgetAmount),
          unbudgetedAmount: Math.round(forecastAmount * (pattern.vendorId === 'infosys-advisory' ? 0.055 : 0.014)),
        };
      }),
    ),
  ),
);

export const INVOICE_FACT_RECORDS: InvoiceRecord[] = COST_CENTER_FACT_RECORDS.filter((row) => row.scenarioId === 'rolling-forecast')
  .flatMap((row, index) =>
    Array.from({ length: 3 + (index % 3) }, (_, invoiceIndex) => ({
      id: `inv-${row.id}-${invoiceIndex + 1}`,
      month: row.month,
      regionId: row.regionId,
      countryId: row.countryId,
      entityId: row.entityId,
      departmentId: row.departmentId,
      vendorId: row.vendorId,
      costTowerId: row.costTowerId,
      categoryId: row.categoryId,
      amount: Math.round((row.actualAmount || row.forecastAmount) / (4 + invoiceIndex)),
      status: invoiceIndex === 0 && row.vendorId === 'infosys-advisory' ? 'pending' : invoiceIndex === 2 ? 'approved' : 'processed',
      processingDays: 1.4 + (invoiceIndex % 4) * 0.7,
      isCredit: invoiceIndex === 2 && row.categoryId === 'security',
      isRecharged: row.departmentId === 'eiss' || row.departmentId === 'operations',
      isBudgeted: row.vendorId !== 'infosys-advisory' || invoiceIndex !== 0,
    })),
  );

export const COST_MANAGEMENT_DATABASE: CostManagementDatabase = {
  company: {
    id: 'crown-global-manufacturing',
    name: 'Crown Global Manufacturing',
    currency: 'USD',
    fiscalYear: 2026,
    asOfDate: '2026-07-09',
  },
  dimensions: {
    regions,
    countries,
    entities,
    departments,
    vendors,
    costTowers,
    categories,
    rechargeCenters,
  },
  scenarios,
  monthlyCosts: COST_CENTER_FACT_RECORDS,
  invoices: INVOICE_FACT_RECORDS,
  alerts: [
    { id: 'alert-accruals', title: 'Accruals Awaiting Owner Review', valueType: 'money', amount: 210000, severity: 'risk', departmentId: 'eiss' },
    { id: 'alert-contract', title: 'Contract Uplift Without PO', valueType: 'count', count: 3, severity: 'risk', vendorId: 'infosys-advisory' },
    { id: 'alert-coding', title: 'Invoices Pending Coding', valueType: 'count', count: 19, severity: 'attention' },
    { id: 'alert-recharge', title: 'Recharge Batch Cleared', valueType: 'money', amount: 860000, severity: 'healthy', departmentId: 'eiss' },
    { id: 'alert-forecast', title: 'Forecast Package Prepared', valueType: 'text', text: 'RFC3', severity: 'attention', scenarioId: 'rfc3' },
  ],
  rechargeAllocations: [
    { id: 'recharge-shared-eiss', rechargeCenterId: 'shared-it', regionId: 'emea', entityId: 'packaging', departmentId: 'eiss', amount: 1363000 },
    { id: 'recharge-mfg-ops', rechargeCenterId: 'manufacturing', regionId: 'americas', entityId: 'manufacturing', departmentId: 'operations', amount: 986000 },
    { id: 'recharge-corp-fin', rechargeCenterId: 'corporate', regionId: 'americas', entityId: 'digital', departmentId: 'finance', amount: 551000 },
  ],
};
