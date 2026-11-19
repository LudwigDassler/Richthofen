export type AccountType = 'active' | 'passive' | 'active-passive';

export interface AccountInfo {
  code: string;
  name: string;
  parentCode?: string;
  type: AccountType;
  subconto: string[];
  category: string;
  isGroup?: boolean;
}

export interface OrganizationCard {
  name: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn?: string;
  bankAccount: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  address?: string;
  taxSystem: 'OSNO' | 'USN_15' | 'USN_6';
  defaultVatRate: number;
  directorName: string;
  chiefAccountantName: string;
  studentName: string;
  substituteStudentInOrgName: boolean;
  substituteStudentAsAccountant: boolean;
  costingMethod: 'direct-costing' | 'full-absorption';
  periodLabel: string;
  periodStartDate: string;
}

export interface OpeningBalanceEntry {
  id: string;
  accountCode: string;
  subconto1?: string;
  subconto2?: string;
  subconto3?: string;
  debit: number;
  credit: number;
  comment?: string;
}

export interface SmartLinkRule {
  accountCode: string;
  side: 'debit' | 'credit' | 'net';
  matchSubconto1?: string;
  matchContract?: string;
  description: string;
}

export interface JournalPosting {
  id: string;
  debitAccount: string;
  debitSubconto: string[];
  creditAccount: string;
  creditSubconto: string[];
  amount: number;
  comment: string;
  formulaHint?: string;
  proportionOfTotal?: 'full' | 'net_without_vat' | 'vat_only' | 'custom';
}

export interface DocumentField1C {
  label: string;
  value: string;
  copyable?: boolean;
  highlight?: boolean;
}

export interface VatMathBreakdown {
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalWithVat: number;
  vatRate: number;
  vatMode: 'included' | 'on_top' | 'none';
  vatAmount: number;
  amountWithoutVat: number;
  steps: string[];
}

export interface PitfallWarning {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  checkType?:
    | 'cash_balance'
    | 'bank_balance'
    | 'advance_offset'
    | 'penalty_split'
    | 'closing_subconto'
    | 'general';
}

export type OperationStatus = 'pending' | 'in_progress' | 'done' | 'needs_data';

export type Operation1CSyncStatus = 'done_in_1c' | 'needs_fix_in_1c' | 'missing_in_1c';

export interface DocumentTableRowGuide {
  name: string;
  quantity?: string;
  price?: string;
  amount: string;
  vat: string;
  account: string;
  subconto?: string;
}

export interface Synced1CDocumentLine {
  nomenclature?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  vatRate?: string;
  vatAmount?: number;
  accountCode?: string;
  vatAccountCode?: string;
  subconto?: string;
}

export interface Synced1CDocument {
  id: string;
  docType: string;
  section1C: string;
  number: string;
  date: string;
  posted: boolean;
  deletionMark?: boolean;
  operationKind?: string;
  counterparty?: string;
  contract?: string;
  amount: number;
  vatAmount?: number;
  settlementAccount?: string;
  advanceAccount?: string;
  hasSfOrUpd?: boolean;
  sfNumber?: string;
  sfDate?: string;
  comment?: string;
  lines: Synced1CDocumentLine[];
}

export interface Synced1CEmployeeRecord {
  id: string;
  fullName: string;
  position?: string;
  department?: string;
  salary?: number;
  hireDate?: string;
  inn?: string;
  snils?: string;
  personnelNumber?: string;
}

export interface Synced1CNomenclatureRecord {
  id: string;
  name: string;
  kind?: string;
  unit?: string;
  vatRate?: string;
  code?: string;
}

export interface Synced1CResponsiblePersons {
  directorName?: string;
  directorPosition?: string;
  chiefAccountantName?: string;
  cashierName?: string;
}

export interface Synced1CAccountingPolicy {
  taxSystem?: string;
  valuationMethod?: string;
  mainCostAccount?: string;
  directCosting?: boolean;
  rawSummary?: string;
}

export interface Synced1CContract {
  number: string;
  date?: string;
  kind?: string;
  name?: string;
}

export interface Synced1CCounterparty {
  name: string;
  fullName?: string;
  inn?: string;
  kpp?: string;
  bankAccount?: string;
  bik?: string;
  bankName?: string;
  contracts: Synced1CContract[];
}

export interface Synced1CPosting {
  id: string;
  date: string;
  documentType?: string;
  documentNumber?: string;
  debitAccount: string;
  debitSubconto: string[];
  creditAccount: string;
  creditSubconto: string[];
  amount: number;
  comment?: string;
}

export interface RequisiteFieldGap {
  fieldKey: string;
  fieldLabel: string;
  expectedValue: string;
  actualValueIn1C?: string;
  reason: 'empty' | 'mismatch';
}

export interface Operation1CMatchInfo {
  syncStatus: Operation1CSyncStatus;
  matchedDocs: Synced1CDocument[];
  matchedPostings: Synced1CPosting[];
  issues: string[];
  missingCounterpartyFields: RequisiteFieldGap[];
  tableRowsGuide: DocumentTableRowGuide[];
  plainExplanation: string;
}

export interface BusinessOperation {
  id: string;
  number: number | string;
  date: string;
  shortTitle?: string;
  rawDescription: string;
  explicitAmount: number | null;
  resolvedAmount: number;
  isMonthEndClosing?: boolean;
  status: OperationStatus;
  missingDataReason?: string;
  smartLink?: SmartLinkRule;
  menuPath1C: string[];
  documentType1C: string;
  operationKind1C: string;
  hasUpdOrSf: boolean;
  updLabel?: string;
  documentFields: DocumentField1C[];
  vatBreakdown?: VatMathBreakdown;
  postings: JournalPosting[];
  pitfalls: PitfallWarning[];
  match1C?: Operation1CMatchInfo;
}

export interface CounterpartyCard1C {
  id: string;
  name: string;
  fullName: string;
  inn: string;
  kpp: string;
  bankAccount: string;
  bankName: string;
  bik: string;
  contractKind: 'С поставщиком' | 'С покупателем' | 'Прочее';
  contractNumber: string;
  contractDate: string;
  createdIn1C?: boolean;
}

export interface NomenclatureCard1C {
  id: string;
  name: string;
  kind: 'Товары' | 'Материалы' | 'Услуги / Субподрядные работы' | 'Продукция / СМР';
  unit: string;
  accountCode: string;
  vatAccountCode: string;
  nomenclatureGroup?: string;
  expenseItem?: string;
  defaultVatRate: number;
  createdIn1C?: boolean;
}

export interface EmployeeCard1C {
  id: string;
  fullName: string;
  position: string;
  department: string;
  salary: number;
  hireDate: string;
  costAccount: string;
  nomenclatureGroup?: string;
  createdIn1C?: boolean;
}

export interface ExtractedDirectories1C {
  counterparties: CounterpartyCard1C[];
  nomenclature: NomenclatureCard1C[];
  nomenclatureGroups: string[];
  expenseItems: string[];
  cashFlowItems: string[];
  employees: EmployeeCard1C[];
}

export interface OsvAccountCardMovement {
  operationId: string;
  operationNumber: number | string;
  date: string;
  description: string;
  correspondentAccount: string;
  subconto: string;
  debit: number;
  credit: number;
}

export interface OsvRow {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  isGroup: boolean;
  parentCode?: string;
  startDebit: number;
  startCredit: number;
  turnoverDebit: number;
  turnoverCredit: number;
  endDebit: number;
  endCredit: number;
  hasRedBalance: boolean;
  redBalanceHint?: string;
  movements: OsvAccountCardMovement[];
}

export interface OsvReport {
  rows: OsvRow[];
  totalStartDebit: number;
  totalStartCredit: number;
  totalTurnoverDebit: number;
  totalTurnoverCredit: number;
  totalEndDebit: number;
  totalEndCredit: number;
  isStartBalanced: boolean;
  isEndBalanced: boolean;
}

export interface UserOsvInputRow {
  accountCode: string;
  turnoverDebit?: number | null;
  turnoverCredit?: number | null;
  endDebit?: number | null;
  endCredit?: number | null;
}

export interface OsvDiscrepancy {
  id: string;
  severity: 'error' | 'warning';
  accountsAffected: string[];
  diffAmount: number;
  title: string;
  probableCause: string;
  howToFixIn1C: string;
  relatedOperationId?: string;
}

export interface OsvReconciliationResult {
  isPerfectMatch: boolean;
  checkedAccountsCount: number;
  mismatchedAccountsCount: number;
  rowDiffs: Record<
    string,
    {
      turnoverDebitDiff: number;
      turnoverCreditDiff: number;
      endDebitDiff: number;
      endCreditDiff: number;
      hasMismatch: boolean;
    }
  >;
  diagnostics: OsvDiscrepancy[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  relatedOperationNumber?: number | string;
}

export interface AiProviderConfig {
  provider: 'demo-local' | 'gemini' | 'openai-compatible';
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export type WorkspaceTab =
  | 'navigator'
  | 'database1c'
  | 'audit_osv'
  | 'balances'
  | 'directories'
  | 'osv'
  | 'audit';

export interface DemoScenarioPreset {
  id: string;
  title: string;
  subtitle: string;
  organization: OrganizationCard;
  openingBalances: OpeningBalanceEntry[];
  operations: BusinessOperation[];
  directories: ExtractedDirectories1C;
}

export interface Synced1CSnapshot {
  revision: string;
  syncedAt: string;
  source: 'http-post' | 'downloads-file' | 'file-upload' | 'demo-simulation';
  isNormalizedSnapshot?: boolean;
  organization?: Partial<OrganizationCard>;
  counterparties: Synced1CCounterparty[];
  openingBalances: OpeningBalanceEntry[];
  endBalances?: Record<string, { debit: number; credit: number }>;
  aprilPostings: Synced1CPosting[];
  hasMonthEndClosing?: boolean;
  allDocuments: Synced1CDocument[];
  directories1C: {
    counterparties: Synced1CCounterparty[];
    nomenclature: Synced1CNomenclatureRecord[];
    employees: Synced1CEmployeeRecord[];
    bankAccountsCount?: number;
    contractsCount?: number;
  };
  registers1C: {
    responsiblePersons?: Synced1CResponsiblePersons;
    accountingPolicy?: Synced1CAccountingPolicy;
    hrHistory?: Synced1CEmployeeRecord[];
  };
}

export interface EntityRequisiteCheck {
  entityId: string;
  entityType: 'organization' | 'counterparty';
  name: string;
  innExpected: string;
  status: 'complete' | 'incomplete_in_1c' | 'missing_in_1c';
  totalRequired: number;
  filledCount: number;
  missingFields: RequisiteFieldGap[];
}

export interface RequisiteCheckReport {
  has1CSnapshot: boolean;
  organizationCheck: EntityRequisiteCheck;
  counterpartyChecks: EntityRequisiteCheck[];
  incompleteCount: number;
}

export type AuditIssueCategory =
  | 'advance_unoffset'
  | 'missing_sf_upd'
  | 'incomplete_requisites'
  | 'unclosed_month'
  | 'posting_mismatch'
  | 'missing_operation';

export interface AuditPostingComparisonRow {
  label: string;
  in1CDebit: string;
  in1CCredit: string;
  in1CSubconto: string;
  in1CAmount: number | null;
  expectedDebit: string;
  expectedCredit: string;
  expectedSubconto: string;
  expectedAmount: number;
  diffAmount: number;
}

export interface AuditIssue {
  id: string;
  category: AuditIssueCategory;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  howToFixIn1C: string;
  relatedOperationId?: string;
  relatedOperationNumber?: number | string;
  affectedAccounts?: string[];
  missingRequisites?: RequisiteFieldGap[];
  comparisonRows?: AuditPostingComparisonRow[];
}

export interface Full1CAuditReport {
  has1CData: boolean;
  totalIssuesCount: number;
  criticalCount: number;
  warningCount: number;
  matchedOperationsCount: number;
  totalOperationsCount: number;
  issuesByCategory: Record<AuditIssueCategory, AuditIssue[]>;
  allIssues: AuditIssue[];
}

export interface ApplyImported1CPayload {
  openingBalances?: OpeningBalanceEntry[];
  mergeMode?: 'replace' | 'merge';
  organizationPatch?: Partial<OrganizationCard>;
  counterparties?: CounterpartyCard1C[];
  employees?: EmployeeCard1C[];
  synced1CPatch?: Partial<Synced1CSnapshot>;
}
