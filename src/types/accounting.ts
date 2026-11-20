export type AccountType = 'active' | 'passive' | 'active-passive';

export interface AccountInfo {
  code: string;
  name: string;
  parentCode?: string;
  type: AccountType;
  subconto: string[];
  category: string;
  isGroup?: boolean;
  isOffBalance?: boolean;
}

export type TaxSystem1C =
  | 'ОСНО'
  | 'УСН (доходы)'
  | 'УСН (доходы минус расходы)';

export interface Organization1C {
  name: string;
  fullName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  taxSystem: TaxSystem1C;
  vatRateDefault: number;
  bankAccount: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  address: string;
  director: string;
  chiefAccountant: string;
  code1C?: string;
  guid1C?: string;
}

export interface AccountingPolicy1C {
  taxSystem: TaxSystem1C;
  vatRate: number;
  directCosting26To9008: boolean;
  inventoryValuationMethod: string;
  rawRegisters: Record<string, unknown>;
}

export interface DirectoryCounterparty1C {
  id: string;
  code1C?: string;
  guid1C?: string;
  name: string;
  fullName?: string;
  inn: string;
  kpp: string;
  kind?: 'ЮридическоеЛицо' | 'ФизическоеЛицо' | 'ИндивидуальныйПредприниматель' | string;
  defaultContract?: string;
  bankAccount?: string;
  bik?: string;
  bankName?: string;
  isNewFor1C?: boolean;
}

export interface DirectoryContract1C {
  id: string;
  code1C?: string;
  guid1C?: string;
  name: string;
  number: string;
  date: string;
  counterpartyName: string;
  counterpartyInn?: string;
  contractKind:
    | 'СПоставщиком'
    | 'СПокупателем'
    | 'Прочее'
    | 'СКомиссионером'
    | 'СКомитентом'
    | string;
  currency?: string;
  isNewFor1C?: boolean;
}

export interface DirectoryNomenclature1C {
  id: string;
  code1C?: string;
  guid1C?: string;
  name: string;
  fullName?: string;
  article?: string;
  unit: string;
  itemKind: 'Товар' | 'Материал' | 'Услуга' | 'Продукция' | string;
  vatRate: string;
  defaultAccount?: string;
  nomenclatureGroup?: string;
  isNewFor1C?: boolean;
}

export interface DirectoryWarehouse1C {
  id: string;
  code1C?: string;
  name: string;
  warehouseType?: string;
  isNewFor1C?: boolean;
}

export interface DirectorySimpleItem1C {
  id: string;
  code1C?: string;
  name: string;
  kind?: string;
  extra?: Record<string, string>;
  isNewFor1C?: boolean;
}

export interface DirectoryAutocompleteOption1C {
  id: string;
  name: string;
  fullName?: string;
  inn: string;
  kpp: string;
  code1C?: string;
  source: 'Контрагенты' | 'ФизическиеЛица';
  kind: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо';
  defaultContract?: string;
}

export interface BankAccount1C {
  id: string;
  code1C?: string;
  name: string;
  accountNumber: string;
  bik: string;
  bankName: string;
  corrAccount?: string;
  ownerName?: string;
}

export interface BalanceRow1C {
  id: string;
  account: string;
  accountName?: string;
  subconto?: string;
  startDebit: number;
  startCredit: number;
  turnoverDebit: number;
  turnoverCredit: number;
  endDebit: number;
  endCredit: number;
  rawDebit: number;
  rawCredit: number;
  hasExplicitStart: boolean;
  hasExplicitEnd: boolean;
  quantity?: number;
}

export interface Posting1C {
  id: string;
  date: string;
  debit: string;
  credit: string;
  amount: number;
  debitSubconto: string[];
  creditSubconto: string[];
  documentType: string;
  documentNumber: string;
  documentLabel: string;
  description: string;
  counterpartyName?: string;
  contractName?: string;
  quantityDebit?: number;
  quantityCredit?: number;
}

export interface DocumentJournalRow1C {
  id: string;
  documentKind: string;
  number: string;
  date: string;
  posted: boolean;
  amount: number;
  vatAmount?: number;
  counterparty: string;
  counterpartyInn?: string;
  contract: string;
  warehouse?: string;
  operationKind?: string;
  comment: string;
  rawFields?: Record<string, unknown>;
}

export type BalanceInterpretationMode =
  | 'explicit_start_end'
  | 'end_balances_reconstructed_start'
  | 'start_balances_forward_end'
  | 'balances_only'
  | 'postings_only';

export type BalanceAnchorOverride =
  | 'auto'
  | 'treat_raw_as_end'
  | 'treat_raw_as_start';

export interface ReconstructedAccountBalance {
  account: string;
  subconto?: string;
  startDebit: number;
  startCredit: number;
  dbTurnoverDebit: number;
  dbTurnoverCredit: number;
  dbEndDebit: number;
  dbEndCredit: number;
}

export interface Database1CSnapshot {
  loadedAt: string;
  exportedAt: string;
  sourceFileName: string;
  configurationName: string;
  periodStart: string;
  periodEnd: string;
  balanceDate?: string;
  organization: Organization1C;
  accountingPolicy: AccountingPolicy1C;
  rawBalances: BalanceRow1C[];
  detectedBalanceMode: BalanceInterpretationMode;
  balanceModeReason: string;
  postings: Posting1C[];
  documents: DocumentJournalRow1C[];
  counterparties: DirectoryCounterparty1C[];
  contracts: DirectoryContract1C[];
  nomenclature: DirectoryNomenclature1C[];
  warehouses: DirectoryWarehouse1C[];
  expenseItems: DirectorySimpleItem1C[];
  cashFlowItems: DirectorySimpleItem1C[];
  employees: DirectorySimpleItem1C[];
  individuals: DirectorySimpleItem1C[];
  nomenclatureGroups: DirectorySimpleItem1C[];
  subdivisions: DirectorySimpleItem1C[];
  bankAccounts: BankAccount1C[];
  rawDirectories: Record<string, Record<string, unknown>[]>;
  rawRegisters: Record<string, unknown>;
}

export type DocType1CBP30 =
  | 'СписаниеСРасчетногоСчета'
  | 'ПоступлениеНаРасчетныйСчет'
  | 'ПоступлениеТоваровУслуг'
  | 'РеализацияТоваровУслуг'
  | 'РасходМатериалов'
  | 'ПередачаМатериаловВЭксплуатацию'
  | 'ПринятиеКУчетуОС'
  | 'ВыпускПродукции'
  | 'ПеремещениеТоваров'
  | 'СчетФактураПолученный'
  | 'СчетФактураВыданный'
  | 'ВыдачаНаличных'
  | 'ПоступлениеНаличных'
  | 'НачислениеЗарплаты'
  | 'ПриемНаРаботу'
  | 'ВедомостьВБанк'
  | 'ВедомостьВКассу'
  | 'АвансовыйОтчет'
  | 'КорректировкаДолга'
  | 'ОперацияБух'
  | 'ЗакрытиеМесяца'
  | 'ВводОстатков';

export type OperationCategory =
  | 'bank_out'
  | 'bank_in'
  | 'purchase_goods'
  | 'purchase_materials'
  | 'purchase_equipment'
  | 'purchase_services'
  | 'sale_goods'
  | 'sale_services'
  | 'materials_writeoff'
  | 'workwear_issue'
  | 'os_commissioning'
  | 'production_output'
  | 'warehouse_transfer'
  | 'cash_bank_internal'
  | 'accountable_issue'
  | 'expense_report'
  | 'accountable_return'
  | 'loan_received'
  | 'loan_repaid'
  | 'depreciation_accrual'
  | 'insurance_accrual'
  | 'cash_out'
  | 'cash_in'
  | 'hr_hire'
  | 'payroll_accrual'
  | 'payroll_payout'
  | 'tax_payment'
  | 'bank_fee'
  | 'founder_contribution'
  | 'penalty_claim'
  | 'advance_offset'
  | 'advance_vat'
  | 'closing'
  | 'manual';

export type OperationCardProfile =
  | 'trade_services'
  | 'warehouse_production'
  | 'hr_payroll'
  | 'accountable_71'
  | 'os_regulatory'
  | 'taxes_bank_founders';

export type OsvSourceMode = 'combined' | 'queued_only' | 'db_only';

export type OperationAmountMode =
  | 'explicit'
  | 'from_stock_balance'
  | 'from_account_balance'
  | 'from_related_doc'
  | 'calculated_by_1c'
  | 'required_missing';

export type OperationReadinessStatus =
  | 'ready'
  | 'calculated_1c'
  | 'needs_clarification'
  | 'critical_error';

export interface OperationMentorGuide1C {
  accountingMeaning: string;
  whyAmountOrVatRule: string;
  navigationPath1C: string;
  documentOperationKind1C: string;
  headerFieldsSteps: Array<{
    field: string;
    value: string;
    hint?: string;
  }>;
  tabularAndTabsSteps: Array<{
    tabName: string;
    instruction: string;
  }>;
  referencePostings: Array<{
    debit: string;
    credit: string;
    amountRule: string;
    purpose: string;
    isOffBalance?: boolean;
  }>;
  selfCheckOsv: string[];
  commonStudentMistakes: string[];
}

export interface EntityBindingStatus {
  status: 'matched_1c' | 'new_for_1c' | 'not_required' | 'missing';
  matchedName?: string;
  matchedCode1C?: string;
  matchedInn?: string;
  note?: string;
}

export interface AccountingEntry {
  id: string;
  debit: string;
  credit: string;
  debitSubconto: string;
  creditSubconto: string;
  amount: number;
  description: string;
  amountRuleNote?: string;
  isOffBalance?: boolean;
}

export type VatRule = 'included' | 'on_top' | 'none' | ' zero';

export const DEFAULT_REPORTING_YEAR = 2026;
export const DEFAULT_SBERBANK_BIK = '044030653';
export const DEFAULT_SBERBANK_NAME = 'СЕВЕРО-ЗАПАДНЫЙ БАНК ПАО СБЕРБАНК';
export const DEFAULT_SBERBANK_CORR = '30101810500000000653';

export interface EgrulCandidate {
  inn: string;
  kpp: string;
  ogrn: string;
  name: string;
  fullName: string;
  address?: string;
  leaderName?: string;
  kind: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель';
  region?: string;
  isActive: boolean;
  source: 'egrul_fns' | 'dadata';
}

export type CounterpartyResolutionSource =
  | 'excel_explicit'
  | 'db_1c'
  | 'egrul_verified'
  | 'educational_generated'
  | 'educational_unverified'
  | 'manual'
  | 'unresolved';

export interface QueuedOperation {
  id: string;
  rowKey?: string;
  createdAt: string;
  sourceFileName: string;
  date: string;
  docNumber: string;
  incomingDocNumber?: string;
  incomingDocDate?: string;
  description: string;
  category: OperationCategory;
  docType1C: DocType1CBP30;
  documentSubKind1C?: string;
  amount: number;
  amountMode?: OperationAmountMode;
  readinessStatus?: OperationReadinessStatus;
  readinessNote?: string;
  needsAmount?: boolean;
  amountCalculationNote?: string;
  calculationProvenance?: string;
  stockSourceNote?: string;
  monthlySalary?: number;
  employeePosition?: string;
  injuryInsuranceRate?: number;
  payrollStaffSummary?: Array<{
    name: string;
    position?: string;
    salary: number;
    source: string;
  }>;
  usefulLifeMonths?: number;
  depreciationBaseAmount?: number;
  vatRate: number;
  vatRule: 'included' | 'on_top' | 'none';
  vatAmount: number;
  quantity?: number;
  unitPrice?: number;
  hasInvoiceSF: boolean;
  counterpartyName: string;
  counterpartyInn: string;
  counterpartyKpp: string;
  counterpartyOgrn?: string;
  counterpartyBankAccount?: string;
  counterpartyBik?: string;
  counterpartyBankName?: string;
  counterpartyCorrAccount?: string;
  counterpartySource?: CounterpartyResolutionSource;
  egrulCandidates?: EgrulCandidate[];
  organizationBik?: string;
  organizationBankName?: string;
  organizationBankAccount?: string;
  counterpartyKind: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо';
  contractName: string;
  contractNumber: string;
  contractDate: string;
  nomenclatureName: string;
  warehouseName: string;
  warehouseToName?: string;
  costAccount?: string;
  materialAccount?: string;
  offBalanceAccount?: string;
  expenseItemName: string;
  cashFlowItemName: string;
  employeeName: string;
  nomenclatureGroupName: string;
  isDuplicateIn1C: boolean;
  includeInProcessing: boolean;
  duplicateReason?: string;
  autoGeneratedKind?: 'advance_offset' | 'advance_vat' | 'closing_26' | 'closing_90_91' | 'profit_tax_99';
  mentorGuide1C?: OperationMentorGuide1C;
  bindings: {
    counterparty: EntityBindingStatus;
    contract: EntityBindingStatus;
    nomenclature: EntityBindingStatus;
    warehouse: EntityBindingStatus;
    expenseItem: EntityBindingStatus;
    cashFlowItem: EntityBindingStatus;
  };
  entries: AccountingEntry[];
}

export interface SkippedExcelRowReason {
  fileName: string;
  sheetName?: string;
  rowNumber: number;
  rawPreview: string;
  reason: string;
}

export interface BatchImportCompletenessStats {
  filesUploaded: number;
  excelOperationRowsTotal: number;
  importedOperationsCount: number;
  generatedPostingsCount: number;
  skippedRowsCount: number;
  skippedReasons: SkippedExcelRowReason[];
  sheetDefaults: {
    defaultBik: string;
    defaultBankName: string;
    defaultCorrAccount: string;
    reportingYear: number;
    rawHeaderNotes: string[];
  };
}

export interface AccompanyingAction1C {
  id: string;
  kind:
    | 'create_bank_account'
    | 'create_counterparty'
    | 'create_contract'
    | 'register_sf_incoming'
    | 'register_sf_outgoing'
    | 'offset_advance'
    | 'month_closing';
  title: string;
  details: string;
  bik?: string;
  bankName?: string;
  accountNumber?: string;
  counterpartyName?: string;
  docType1C: string;
  menuPath1C: string;
}

export interface AutoFixChangeRecord {
  id: string;
  whatWas: string;
  whatBecame: string;
  basis: string;
  category:
    | 'doc_reclassification'
    | 'date_year'
    | 'bank_bik'
    | 'counterparty_requisites'
    | 'amount_calc'
    | 'vat_calc'
    | 'advance_offset'
    | 'founder_75'
    | 'closing'
    | 'directory_binding'
    | 'duplicate_guard';
  operationId?: string;
}

export interface AuditGuide1CBP30 {
  menuPath: string;
  documentKind: string;
  checkPoints: string[];
  repostInstruction: string;
  verifyInOsv: string;
}

export interface OsvAccountRow {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
  isGroup: boolean;
  isCollapsedSynthetic?: boolean;
  startDebit: number;
  startCredit: number;
  turnoverDebit: number;
  turnoverCredit: number;
  endDebit: number;
  endCredit: number;
  hasRedStart: boolean;
  hasRedEnd: boolean;
  dbTurnoverDebit: number;
  dbTurnoverCredit: number;
  queuedTurnoverDebit: number;
  queuedTurnoverCredit: number;
}

export interface OsvSubcontoRow {
  subcontoKey: string;
  subcontoLabel: string;
  startDebit: number;
  startCredit: number;
  turnoverDebit: number;
  turnoverCredit: number;
  endDebit: number;
  endCredit: number;
  hasRedEnd: boolean;
}

export interface OsvAccountMovement {
  id: string;
  date: string;
  source: 'db' | 'queued';
  operationId?: string;
  docLabel: string;
  description: string;
  corrAccount: string;
  subconto: string;
  debitAmount: number;
  creditAmount: number;
  runningNet: number;
  runningDebit: number;
  runningCredit: number;
  isRedRunning: boolean;
}

export interface OsvAuditorHint {
  id: string;
  checkType:
    | 'double_entry_balance'
    | 'red_balance'
    | 'unclosed_accounts'
    | 'unoffset_advances'
    | 'stuck_vat_or_capex';
  severity: 'ok' | 'warning' | 'error';
  title: string;
  explanation: string;
  howToFix1C?: string;
  accountCode?: string;
  operationId?: string;
  quickAction?: 'run_autofix' | 'jump_operation';
  quickActionLabel?: string;
}

export interface OsvReport {
  dateFrom: string;
  dateTo: string;
  includeQueuedOperations: boolean;
  sourceMode?: OsvSourceMode;
  balanceMode: BalanceInterpretationMode;
  balanceModeDescription: string;
  rows: OsvAccountRow[];
  leafRows: OsvAccountRow[];
  subcontoRowsByAccount?: Record<string, OsvSubcontoRow[]>;
  movementsByAccount?: Record<string, OsvAccountMovement[]>;
  auditorHints?: OsvAuditorHint[];
  totals: {
    startDebit: number;
    startCredit: number;
    turnoverDebit: number;
    turnoverCredit: number;
    endDebit: number;
    endCredit: number;
    startDiff: number;
    turnoverDiff: number;
    endDiff: number;
    isStartBalanced: boolean;
    isTurnoverBalanced: boolean;
    isEndBalanced: boolean;
  };
}

export type AuditSeverity = 'error' | 'warning' | 'info';

export type InlineFieldTarget =
  | {
      kind: 'operation_field';
      operationId: string;
      field:
        | 'amount'
        | 'counterpartyInn'
        | 'counterpartyKpp'
        | 'counterpartyName'
        | 'contractName'
        | 'nomenclatureName'
        | 'warehouseName'
        | 'expenseItemName'
        | 'cashFlowItemName'
        | 'docNumber';
      label: string;
      placeholder: string;
      currentValue: string;
    }
  | {
      kind: 'entry_account';
      operationId: string;
      entryId: string;
      side: 'debit' | 'credit';
      label: string;
      placeholder: string;
      currentValue: string;
    };

export interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  category:
    | 'missing_requisite'
    | 'missing_amount'
    | 'unbalanced_entry'
    | 'red_balance'
    | 'unclosed_period'
    | 'unoffset_advance'
    | 'duplicate_doc'
    | 'vat_discrepancy'
    | 'osv_disbalance';
  title: string;
  description: string;
  accountingReason?: string;
  quickFixLabel?: string;
  guide1C?: AuditGuide1CBP30;
  accountCode?: string;
  operationId?: string;
  canAutoFixBy1C: boolean;
  autoFixActionLabel?: string;
  inlineTarget?: InlineFieldTarget;
}

export type ExportMode1C = 'incremental' | 'clean_db';

export type ExportFormat1C = 'bsl' | 'xml_edo' | 'json';

export type WorkspaceTab =
  | 'db_osv'
  | 'import_postings'
  | 'audit_autofix'
  | 'export_1c';

export interface PersistedWorkbenchStateV2 {
  version: 2;
  activeTab: WorkspaceTab;
  reportingYear?: number;
  db1C: Database1CSnapshot | null;
  balanceAnchorOverride: BalanceAnchorOverride;
  includeQueuedInOsv: boolean;
  osvSourceMode?: OsvSourceMode;
  periodFilter: {
    dateFrom: string;
    dateTo: string;
  };
  operations: QueuedOperation[];
  resolvedInlineNotes: Record<string, string>;
  exportMode: ExportMode1C;
  lastImportStats?: BatchImportCompletenessStats | null;
  autoFixChanges?: AutoFixChangeRecord[];
}

