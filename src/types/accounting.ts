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
  | 'ПринятиеКУчетуНМА'
  | 'ПередачаОС'
  | 'СписаниеОС'
  | 'ВыпускПродукции'
  | 'ПеремещениеТоваров'
  | 'ИнвентаризацияТоваров'
  | 'ОперацияПоПлатежнойКарте'
  | 'СчетФактураПолученный'
  | 'СчетФактураВыданный'
  | 'ВыдачаНаличных'
  | 'ПоступлениеНаличных'
  | 'НачислениеЗарплаты'
  | 'ПриемНаРаботу'
  | 'ИсполнительныйЛист'
  | 'ВедомостьВБанк'
  | 'ВедомостьВКассу'
  | 'АвансовыйОтчет'
  | 'КорректировкаДолга'
  | 'ФинансовыеВложения'
  | 'ОперацияБух'
  | 'ЗакрытиеМесяца'
  | 'ВводОстатков';

export type OperationCategory =
  | 'contract_event'
  | 'policy_event'
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
  | 'os_disposal'
  | 'intangible_acquisition'
  | 'intangible_commissioning'
  | 'intangible_amortization'
  | 'production_output'
  | 'warehouse_transfer'
  | 'inventory_result'
  | 'cash_bank_internal'
  | 'acquiring_receipt'
  | 'special_bank_55'
  | 'accountable_issue'
  | 'expense_report'
  | 'accountable_return'
  | 'employee_settlement_73'
  | 'loan_received'
  | 'loan_repaid'
  | 'loan_issued'
  | 'loan_interest_accrual'
  | 'depreciation_accrual'
  | 'insurance_accrual'
  | 'cash_out'
  | 'cash_in'
  | 'hr_hire'
  | 'writ_of_execution'
  | 'alimony_payout'
  | 'payroll_accrual'
  | 'payroll_payout'
  | 'tax_payment'
  | 'bank_fee'
  | 'charter_capital'
  | 'founder_contribution'
  | 'dividends_accrual'
  | 'dividends_payout'
  | 'financial_investment'
  | 'financial_interest_accrual'
  | 'financial_disposal'
  | 'deferred_expense_97'
  | 'reserve_doubtful_63'
  | 'off_balance_op'
  | 'vat_deduction'
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

export type DirectoryPrepEntityKind1C =
  | 'counterparty'
  | 'contract'
  | 'nomenclature'
  | 'employee'
  | 'fixed_asset'
  | 'writ_of_execution'
  | 'financial_investment';

export interface DirectoryPrepStep1C {
  id: string;
  entityKind: DirectoryPrepEntityKind1C;
  entityLabel: string;
  entityName: string;
  status: 'create_new' | 'already_exists';
  originSummary: string;
  firstSeenOpNumber?: number;
  firstSeenOpId?: string;
  firstSeenDate?: string;
  menuPath1C: string;
  fieldsToFill: Array<{
    field: string;
    value: string;
  }>;
  isFormalAutoFilled?: boolean;
  formalAutoFillNote?: string;
  note?: string;
}

export interface ResolverSourceLink1C {
  opId?: string;
  opNumber?: number;
  date?: string;
  label: string;
}

export interface Step01CalculationBreakdown1C {
  resolverLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  resolverLevelName: string;
  summaryFormula: string;
  steps: string[];
  sourceLinks: ResolverSourceLink1C[];
  checkedSourcesWhenMissing?: string[];
}

export interface Step02AccountingLogic1C {
  plainExplanation: string;
  regulatoryNorms: string[];
  subcontoArchitecture: string;
}

export interface OperationMentorGuide1C {
  accountingMeaning: string;
  whyAmountOrVatRule: string;
  navigationPath1C: string;
  documentOperationKind1C: string;
  directoryPrepSteps?: DirectoryPrepStep1C[];
  step00Prep?: DirectoryPrepStep1C[];
  step01CalculationBreakdown?: Step01CalculationBreakdown1C;
  step02AccountingLogic?: Step02AccountingLogic1C;
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

export type VatPolicy1C =
  | 'forbidden'
  | 'standard_included_20'
  | 'standard_on_top_20'
  | 'optional_by_text';

export interface DocumentSpec1C {
  docType: DocType1CBP30;
  category: OperationCategory;
  label: string;
  uiProfile: OperationCardProfile;
  menuPath1C: string;
  documentKind1C: string;
  requiresCommercialCounterparty: boolean;
  acceptsCounterpartySubconto: boolean;
  requiresIndividual: boolean;
  needsContract: boolean;
  needsWarehouse: boolean;
  needsExpenseItem: boolean;
  needsCashFlowItem: boolean;
  allowsZeroPostings: boolean;
  vatPolicy: VatPolicy1C;
  defaultSubaccounts: {
    debit: string;
    credit: string;
    vatAccount?: string;
    advanceAccount?: string;
  };
  auditGuidanceTemplate: {
    repostInstruction: string;
    verifyInOsv: string;
    defaultCheckPoints: string[];
  };
  masterDataRules: {
    createsCounterparty: boolean;
    createsContract: boolean;
    createsNomenclature: boolean;
    createsEmployee: boolean;
    createsFixedAsset: boolean;
  };
  exportBslKind:
    | 'bank_out'
    | 'bank_in'
    | 'purchase_ptu'
    | 'sale_rtu'
    | 'materials_writeoff'
    | 'workwear_issue'
    | 'os_commissioning'
    | 'production_output'
    | 'warehouse_transfer'
    | 'cash_out'
    | 'cash_in'
    | 'expense_report'
    | 'hr_hire'
    | 'payroll_accrual'
    | 'manual_operation';
}

export type VatRule = 'included' | 'on_top' | 'none' | 'zero';

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

export interface ParsedFinancialNoteItem1C {
  index: number;
  label?: string;
  principal: number;
  ratePercent: number;
}

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
  alimonyRecipientName?: string;
  alimonyRecipientInn?: string;
  alimonyRatePercent?: number;
  alimonyShareLabel?: string;
  financialNotesSummary?: string;
  financialNotesList?: ParsedFinancialNoteItem1C[];
  disposedFinancialNoteId?: string;
  periodicPaymentAmount?: number;
  interestRatePercent?: number;
  resolverTrace?: Step01CalculationBreakdown1C;
  linkedSourceOpIds?: string[];
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
  explicitCorrespondences?: Array<{
    debit: string;
    credit: string;
    amount?: number;
    description?: string;
    isOffBalance?: boolean;
    rawMatch?: string;
  }>;
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

export type VirtualEntityOriginSource1C = 'from_1c_base' | 'created_in_operation';

export interface VirtualEntityUsageRef1C {
  opId: string;
  opNumber: number;
  date: string;
}

export interface VirtualCounterparty1C {
  key: string;
  name: string;
  fullName?: string;
  kind: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо';
  roleHint?: string;
  inn: string;
  kpp: string;
  bik: string;
  bankName: string;
  bankAccount: string;
  isFormalAutoFilled?: boolean;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualContract1C {
  key: string;
  name: string;
  number: string;
  date: string;
  counterpartyName: string;
  contractKind: 'СПоставщиком' | 'СПокупателем' | 'Прочее';
  periodicAmount?: number;
  periodicity?: 'monthly' | 'quarterly' | 'once';
  subjectSummary?: string;
  keywordStems?: string[];
  vatRule?: 'included' | 'on_top' | 'none';
  vatRate?: number;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualNomenclature1C {
  key: string;
  name: string;
  itemKind:
    | 'Материалы'
    | 'Топливо и ГСМ'
    | 'Товары'
    | 'Продукция'
    | 'Услуги'
    | 'Спецодежда и инвентарь'
    | 'Оборудование (компоненты ОС)';
  unit: string;
  defaultAccount: string;
  vatRateLabel: string;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualEmployee1C {
  key: string;
  fullName: string;
  position: string;
  monthlySalary: number;
  subdivision: string;
  hireDate: string;
  inn?: string;
  isStaffEmployee: boolean;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualFixedAsset1C {
  key: string;
  name: string;
  initialCost: number;
  accumulatedDepreciation?: number;
  status:
    | 'На счёте 08.04.1 (к вводу)'
    | 'Введено в эксплуатацию (счёт 01.01)'
    | 'Выбыло / списано (счёт 01.09)';
  usefulLifeMonths: number;
  monthlyDepreciation: number;
  receiptDate?: string;
  commissioningDate?: string;
  disposalDate?: string;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualWritOfExecution1C {
  key: string;
  debtorEmployeeName: string;
  recipientName: string;
  recipientInn: string;
  ratePercent: number;
  shareLabel: string;
  fixedAmount?: number;
  startDate: string;
  accumulatedAccrued7641: number;
  accumulatedPaid7641: number;
  balance7641: number;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualFinancialInvestment1C {
  key: string;
  name: string;
  account: string;
  paperIndex?: number;
  principalAmount?: number;
  totalAmount: number;
  notesBreakdown: string;
  interestRatePercent?: number;
  status?: 'active' | 'disposed';
  accruedInterestAmount?: number;
  lastInterestDate?: string;
  disposedDate?: string;
  disposedOpId?: string;
  disposedOpNumber?: number;
  counterpartyName?: string;
  acquisitionDate: string;
  source: VirtualEntityOriginSource1C;
  firstSeenOpId?: string;
  firstSeenOpNumber?: number;
  firstSeenDate?: string;
  usages: VirtualEntityUsageRef1C[];
}

export interface VirtualOpenSettlement1C {
  id: string;
  account: '60.01' | '60.02' | '62.01' | '62.02' | '76.41' | '70' | '68' | '69';
  counterpartyName: string;
  counterpartyInn: string;
  counterpartyKpp: string;
  contractName: string;
  originalAmount: number;
  remainingAmount: number;
  subjectSummary: string;
  keywordStems: string[];
  source: VirtualEntityOriginSource1C;
  originOpId?: string;
  originOpNumber?: number;
  originDate: string;
}

export interface Virtual1CStateSnapshot {
  counterparties: VirtualCounterparty1C[];
  contracts: VirtualContract1C[];
  nomenclature: VirtualNomenclature1C[];
  employees: VirtualEmployee1C[];
  fixedAssets: VirtualFixedAsset1C[];
  writsOfExecution: VirtualWritOfExecution1C[];
  financialInvestments: VirtualFinancialInvestment1C[];
  openSettlements: VirtualOpenSettlement1C[];
}

export interface Virtual1CStateTimelineResult {
  finalState: Virtual1CStateSnapshot;
  stateBeforeByOpId: Record<string, Virtual1CStateSnapshot>;
  displayNumberByOpId: Record<string, number>;
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
  ruleId?: AutofixRuleId;
}

export type AutofixRuleId =
  | 'normalize_date_year'
  | 'disable_duplicate_doc'
  | 'reclassify_legacy_doc'
  | 'resolve_amount_and_links'
  | 'fill_formal_requisites'
  | 'replace_group_account'
  | 'flip_red_settlement_subaccount'
  | 'generate_cash_withdrawal_cover'
  | 'offset_advances_60_62'
  | 'accrue_advance_vat_76av'
  | 'close_period_accounts';

export interface AutofixExecutionSummary {
  passesExecuted: number;
  issuesBefore: number;
  issuesAfter: number;
  autofixableBefore: number;
  remainingAutofixableCount: number;
  criticalBefore: number;
  criticalAfter: number;
  isOsvBalanced: boolean;
  appliedRules: AutofixRuleId[];
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
  fixId?: AutofixRuleId;
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
  autoFixSummary?: AutofixExecutionSummary | null;
}

