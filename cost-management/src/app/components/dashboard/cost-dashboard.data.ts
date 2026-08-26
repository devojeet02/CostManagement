export type FilterKey = 'region' | 'country' | 'entity' | 'department' | 'vendor' | 'scenario';
export type DimensionType = 'region' | 'country' | 'entity' | 'department' | 'vendor' | 'costTower' | 'category' | 'rechargeCenter';

export interface DashboardFilterOption {
  label: string;
  value: string;
}

export interface BusinessDimension {
  id: string;
  type: DimensionType;
  label: string;
  parentId?: string;
  subtitle?: string;
  color?: string;
}

export interface ScenarioRecord {
  id: string;
  label: string;
  type: 'budget' | 'forecast';
  revisionLabel: string;
  revisionMonth?: string;
  isActive?: boolean;
}

export interface MonthlyCostRecord {
  id: string;
  month: string;
  regionId: string;
  countryId: string;
  entityId: string;
  departmentId: string;
  vendorId: string;
  costTowerId: string;
  categoryId: string;
  scenarioId: string;
  actualAmount: number;
  forecastAmount: number;
  budgetAmount: number;
  unbudgetedAmount: number;
}

export interface InvoiceRecord {
  id: string;
  month: string;
  regionId: string;
  countryId: string;
  entityId: string;
  departmentId: string;
  vendorId: string;
  costTowerId: string;
  categoryId: string;
  amount: number;
  status: 'processed' | 'pending' | 'blocked' | 'approved';
  processingDays: number;
  isCredit: boolean;
  isRecharged: boolean;
  isBudgeted: boolean;
}

export interface AlertRecord {
  id: string;
  title: string;
  valueType: 'money' | 'count' | 'text';
  amount?: number;
  count?: number;
  text?: string;
  severity: 'risk' | 'attention' | 'healthy';
  regionId?: string;
  countryId?: string;
  entityId?: string;
  departmentId?: string;
  vendorId?: string;
  scenarioId?: string;
}

export interface RechargeAllocationRecord {
  id: string;
  rechargeCenterId: string;
  regionId: string;
  entityId: string;
  departmentId: string;
  amount: number;
}

export interface CostManagementDatabase {
  company: {
    id: string;
    name: string;
    currency: 'USD';
    fiscalYear: number;
    asOfDate: string;
  };
  dimensions: {
    regions: BusinessDimension[];
    countries: BusinessDimension[];
    entities: BusinessDimension[];
    departments: BusinessDimension[];
    vendors: BusinessDimension[];
    costTowers: BusinessDimension[];
    categories: BusinessDimension[];
    rechargeCenters: BusinessDimension[];
  };
  scenarios: ScenarioRecord[];
  monthlyCosts: MonthlyCostRecord[];
  invoices: InvoiceRecord[];
  alerts: AlertRecord[];
  rechargeAllocations: RechargeAllocationRecord[];
}

export interface RechargeSlice {
  label: string;
  value: number;
  color: string;
}

export interface SpendCategory {
  label: string;
  percent: number;
  baseAmount: number;
  amount: string;
  color: string;
}

export interface DashboardKpi {
  label: string;
  period: string;
  baseValue: number;
  unit: 'money' | 'count' | 'percent';
  budgetValue?: number;
  riskThreshold?: number;
  value: string;
  status: string;
  trend: 'good' | 'bad' | 'neutral';
  statusIcon: 'up' | 'down' | 'flat';
  statusColor: string;
  icon: string;
  iconColor: string;
}

export interface ForecastPoint {
  month: string;
  monthKey: string;
  actual: number | null;
  forecast: number;
  marker?: 'rev1' | 'rev2' | 'rev3';
  revisionLabel?: string;
}

export interface VendorSpend {
  name: string;
  /**
   * Share of the vendors DISPLAYED, not of total spend — the list is capped, so these add to
   * 100% of what is shown, not of the year. Shown in the hover tooltip; the row itself shows
   * `currentSpend` (F2-AC1).
   */
  percent: number;
  /** Actual ÷ approved budget × 100, capped at 100 for the bar width. */
  utilization: number;
  status: 'within' | 'over' | 'watch';
  budgetContext: string;
  approvedBudget: string;
  currentSpend: string;
}

export interface FinancialAlert {
  title: string;
  value: string;
  severity: string;
  color: string;
}

export interface AlertLegendItem {
  label: string;
  description: string;
  color: string;
}

export interface DepartmentTower {
  name: string;
  subtitle: string;
  forecast: number;
  actual: number;
  remainder: number;
  variancePercent: number;
  fiscalLabel: string;
  drillLabel: string;
  actualColor: string;
  remainderColor: string;
  baselineColor: string;
  positiveColor: string;
  negativeColor: string;
}

export interface DepartmentLegendItem {
  label: string;
  color: string;
  style: 'line' | 'bar' | 'pill';
}

export interface CostCenterDashboardData {
  filters: Record<FilterKey, DashboardFilterOption[]>;
  kpis: DashboardKpi[];
  forecast: {
    activeRevision: string;
    actualsLoaded: string;
    revisionNote: string;
    points: ForecastPoint[];
  };
  vendors: VendorSpend[];
  alertLegend: AlertLegendItem[];
  alerts: FinancialAlert[];
  departmentLegend: DepartmentLegendItem[];
  departments: DepartmentTower[];
  departmentTitle: string;
  departmentName: string;
  departmentSubtitle: string;
  departmentDescription: string;
  recharge: {
    totalAllocated: string;
    slices: RechargeSlice[];
  };
  categories: SpendCategory[];
  invoiceActivity: DashboardFilterOption[];
}
