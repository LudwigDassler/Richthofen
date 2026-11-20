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
  | 'СчетФактураПолученный'
  | 'СчетФактураВыданный'
  | 'ВыдачаНаличных'
  | 'ПоступлениеНаличных'
  | 'НачислениеЗарплаты'
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
  | 'purchase_services'
  | 'sale_goods'
  | 'sale_services'
  | 'cash_out'
  | 'cash_in'
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
}

export type VatRule = 'included' | 'on_top' | 'none' | ' zero';

export interface QueuedOperation {
  id: string;
  createdAt: string;
  sourceFileName: string;
  date: string;
  docNumber: string;
  incomingDocNumber?: string;
  incomingDocDate?: string;
  description: string;
  category: OperationCategory;
  docType1C: DocType1CBP30;
  amount: number;
  vatRate: number;
  vatRule: 'included' | 'on_top' | 'none';
  vatAmount: number;
  quantity?: number;
  unitPrice?: number;
  hasInvoiceSF: boolean;
  counterpartyName: string;
  counterpartyInn: string;
  counterpartyKpp: string;
  counterpartyKind: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо';
  contractName: string;
  contractNumber: string;
  contractDate: string;
  nomenclatureName: string;
  warehouseName: string;
  expenseItemName: string;
  cashFlowItemName: string;
  employeeName: string;
  nomenclatureGroupName: string;
  isDuplicateIn1C: boolean;
  includeInProcessing: boolean;
  duplicateReason?: string;
  autoGeneratedKind?: 'advance_offset' | 'advance_vat' | 'closing_26' | 'closing_90_91';
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

export interface OsvReport {
  dateFrom: string;
  dateTo: string;
  includeQueuedOperations: boolean;
  balanceMode: BalanceInterpretationMode;
  balanceModeDescription: string;
  rows: OsvAccountRow[];
  leafRows: OsvAccountRow[];
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
    | 'unbalanced_entry'
    | 'red_balance'
    | 'unclosed_period'
    | 'unoffset_advance'
    | 'duplicate_doc'
    | 'osv_disbalance';
  title: string;
  description: string;
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
  db1C: Database1CSnapshot | null;
  balanceAnchorOverride: BalanceAnchorOverride;
  includeQueuedInOsv: boolean;
  periodFilter: {
    dateFrom: string;
    dateTo: string;
  };
  operations: QueuedOperation[];
  resolvedInlineNotes: Record<string, string>;
  exportMode: ExportMode1C;
}
