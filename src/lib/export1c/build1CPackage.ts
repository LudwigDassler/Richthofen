import {
  cleanNomenclatureName1C,
  extractCharterCapitalInfo1C,
  isGenericPlaceholderNomenclature1C,
  normalizeLegalEntityName1C,
  normalizeRussianFioToNominative1C,
} from '@/lib/engine/entityNormalizer1C';
import {
  buildVirtual1CStateTimeline,
  computeRpbEndDateFromTermMonths1C,
  normalizeCounterpartyKey1C,
  normalizePersonIdentityKey1C,
  normalizeSimpleEntityKey1C,
} from '@/lib/engine/virtual1CState';
import {
  CalculationProfile1C,
  Database1CSnapshot,
  DEFAULT_REPORTING_YEAR,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  QueuedOperation,
  Virtual1CStateSnapshot,
} from '@/types/accounting';

export type MetaType1CBP30 =
  | 'ПоступлениеТоваровУслуг'
  | 'ПоступлениеДопРасходов'
  | 'РеализацияТоваровУслуг'
  | 'ВозвратТоваровПоставщику'
  | 'ВозвратТоваровОтПокупателя'
  | 'КорректировкаДолга'
  | 'ПоступлениеНаРасчетныйСчет'
  | 'СписаниеСРасчетногоСчета'
  | 'ПоступлениеНаличных'
  | 'ВыдачаНаличных'
  | 'АвансовыйОтчет'
  | 'ТребованиеНакладная'
  | 'СписаниеТоваров'
  | 'ПередачаМатериаловВЭксплуатацию'
  | 'ОтчетПроизводстваЗаСмену'
  | 'ПринятиеКУчетуОС'
  | 'ПередачаОС'
  | 'СписаниеОС'
  | 'СчетНаОплатуПокупателю'
  | 'ПриемНаРаботу'
  | 'КадровыйПеревод'
  | 'Увольнение'
  | 'ИсполнительныйЛист'
  | 'ИнвентаризацияНЗП'
  | 'НачислениеЗарплаты'
  | 'ЗакрытиеМесяца'
  | 'ОперацияБух';

export type ExecutionStrategy1C = 'native' | 'manual_operation' | 'run_native_in_1c';

export type NomenclatureKind1CPackage =
  | 'Товары'
  | 'Материалы'
  | 'Продукция'
  | 'Услуги'
  | 'Оборудование'
  | 'Спецодежда'
  | 'Инвентарь';

export type UnitCode1COkei = '796' | '166' | '055' | '112' | '113';

export type InvoiceSFKind1CPackage = 'received' | 'issued_sale' | 'issued_advance' | 'none';

export type DynamicBalanceMode1C = 'taxes_all' | 'payroll_balance';

export interface PackageMeta1C {
  schemaVersion: '1.0';
  generatedAt: string;
  reportingYear: number;
  periodFrom: string;
  periodTo: string;
  totalDocuments: number;
  usesLegacyPayrollAccounts?: boolean;
}

export interface PackageOrganization1C {
  name: string;
  fullName: string;
  inn: string;
  kpp: string;
  bik: string;
  bankName: string;
  accountNumber: string;
}

export interface PackageCounterparty1C {
  key: string;
  name: string;
  fullName: string;
  inn: string;
  kpp: string;
  kind: 'ЮридическоеЛицо' | 'ФизическоеЛицо';
}

export interface PackageContract1C {
  key: string;
  counterpartyKey: string;
  name: string;
  number: string;
  date: string;
  kind: 'СПоставщиком' | 'СПокупателем' | 'Прочее';
}

export interface PackageWarehouse1C {
  name: string;
}

export interface PackageNomenclature1C {
  key: string;
  name: string;
  kind: NomenclatureKind1CPackage;
  unitCode: UnitCode1COkei;
  unitName: string;
  isService: boolean;
  account: string;
  vatRate: number;
}

export interface PackageFixedAsset1C {
  key: string;
  name: string;
  usefulLifeMonths: number;
  depreciationGroup: string;
  costAccount: string;
  expenseItem: string;
}

export interface PackageDeferredExpense1C {
  key: string;
  name: string;
  totalAmount: number;
  startDate: string;
  endDate: string;
  termMonths: number;
  writeOffMethod: 'monthly' | 'calendar_days';
  costAccount: string;
  expenseItem: string;
}

export interface PackageEmployee1C {
  key: string;
  fullName: string;
  fio?: string;
  position: string;
  hireDate: string;
  salary: number;
  costAccount: string;
  childCount: number;
  isSingleParent: boolean;
  propertyDeductionAmount: number;
  propertyDeductionDate: string;
}

export interface PackageDocumentHeader1C {
  counterpartyKey: string;
  contractKey: string;
  warehouseName: string;
  employeeKey: string;
  employeeName?: string;
  employeePosition?: string;
  monthlySalary?: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
  vatIncluded: boolean;
  cashFlowItem: string;
  creditAccount: string;
  debitAccount: string;
  operationKind1C: string;
  incomingNumber: string;
  incomingDate: string;
  registerInvoiceSF: boolean;
  invoiceSFKind: InvoiceSFKind1CPackage;
  isPaidImmediately: boolean;
  paidAccount: string;
  dynamicBalanceMode?: DynamicBalanceMode1C;
  writStartDate?: string;
  writEndDate?: string;
  alimonyFixedAmount?: number;
  alimonyRatePercent?: number;
  alimonyShare?: string;
  usefulLifeMonths?: number;
}

export interface PackageDocumentRow1C {
  nomenclatureKey: string;
  nomenclatureName: string;
  isService: boolean;
  quantity: number;
  price: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
  account: string;
  vatAccount: string;
  costAccount: string;
  nomenclatureGroup: string;
  expenseItem: string;
  fixedAssetKey: string;
  employeeKey: string;
  deferredExpenseKey: string;
  usefulLifeMonths?: number;
}

export interface PackageAccountingEntry1C {
  debit: string;
  credit: string;
  amount: number;
  debitSubconto: string;
  creditSubconto: string;
  description: string;
  nonDeductibleForProfitTax: boolean;
}

export interface PackageDocument1C {
  documentId: string;
  date: string;
  docNumber: string;
  comment: string;
  quarter: 1 | 2 | 3 | 4;
  metaType1C: MetaType1CBP30;
  executionStrategy: ExecutionStrategy1C;
  dynamicBalanceMode?: DynamicBalanceMode1C;
  header: PackageDocumentHeader1C;
  rows: PackageDocumentRow1C[];
  entries: PackageAccountingEntry1C[];
}

export interface TransferPackage1C {
  meta: PackageMeta1C;
  organization: PackageOrganization1C;
  catalogs: {
    counterparties: PackageCounterparty1C[];
    contracts: PackageContract1C[];
    warehouses: PackageWarehouse1C[];
    nomenclature: PackageNomenclature1C[];
    nomenclatureGroups: string[];
    fixedAssets: PackageFixedAsset1C[];
    deferredExpenses: PackageDeferredExpense1C[];
    employees: PackageEmployee1C[];
  };
  documents: PackageDocument1C[];
}

export interface PackageSectionsSummary1C {
  purchases: number;
  sales: number;
  bankCash: number;
  warehouse: number;
  osNma: number;
  hrPayroll: number;
  manualOps: number;
  reglamentIn1C: number;
}

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function shortDeterministicHash(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function deriveQuarterFromIsoDate(isoDate: string): 1 | 2 | 3 | 4 {
  const m = (isoDate || '').match(/^\d{4}-(\d{2})/);
  if (!m) return 1;
  const month = Math.min(12, Math.max(1, Number(m[1])));
  return Math.ceil(month / 3) as 1 | 2 | 3 | 4;
}

function buildDeterministicSettlementAccount(inn: string, bik: string): string {
  const digits = `${inn}${bik}`.replace(/\D/g, '');
  let tail = '';
  for (let i = 0; i < 11; i++) {
    const ch = digits.charCodeAt(i % Math.max(1, digits.length)) || 48 + i;
    tail += String((ch + i * 7) % 10);
  }
  return `407028109${tail}`;
}

const GARBAGE_NOMENCLATURE_RE =
  /(?:^|[^\p{L}])(?:вексел\p{L}*|долговы[ех]\s+ценн\p{L}*\s+бумаг\p{L}*|кредит\p{L}*|процент\p{L}*|%%|задолженност\p{L}*|на\s+основани\p{L}*|займ\p{L}*|заём\p{L}*|уставн\p{L}*\s+капитал|исполнительн\p{L}*\s+лист|алимент\p{L}*|штраф\p{L}*|неустойк\p{L}*|пен[ия]\b|госпошлин\p{L}*|налог\s+на\s+прибыл|ндфл|страховы[ех]\s+взнос)/iu;

export function sanitizePackageNomenclatureName(
  rawName?: string,
  descriptionCtx?: string
): string {
  if (!rawName) return '';
  if (rawName.includes(',')) return '';
  const cleaned = (cleanNomenclatureName1C(rawName, descriptionCtx) || rawName).trim();
  if (!cleaned || cleaned.length < 2 || cleaned.includes(',')) return '';
  if (isGenericPlaceholderNomenclature1C(cleaned)) return '';
  if (GARBAGE_NOMENCLATURE_RE.test(cleaned)) return '';
  if (/^(?:основн\p{L}*\s+производств\p{L}*|общехозяйственн\p{L}*|расходы\s+будущ\p{L}*)/iu.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function mapUnitToOkei(rawUnit?: string, itemName?: string, isService?: boolean): {
  unitCode: UnitCode1COkei;
  unitName: string;
} {
  if (isService) {
    return { unitCode: '796', unitName: 'шт' };
  }
  const u = `${rawUnit ?? ''} ${itemName ?? ''}`.toLowerCase().trim();
  if (/^(?:кг|килограмм|т|тонн)/iu.test(rawUnit ?? '') || /(?:цемент|песок|щебен|краск|клей|смазк|шпатлевк)/iu.test(itemName ?? '')) {
    if (/^(?:л|литр)/iu.test(rawUnit ?? '')) {
      return { unitCode: '112', unitName: 'л' };
    }
    if (/^(?:кг|т)/iu.test(rawUnit ?? '')) {
      return { unitCode: '166', unitName: 'кг' };
    }
  }
  if (/^(?:м2|кв\.?\s*м)/iu.test(rawUnit ?? '')) {
    return { unitCode: '055', unitName: 'м2' };
  }
  if (/^(?:л|литр)/iu.test(rawUnit ?? '') || /(?:бензин|дизельн|топлив)/iu.test(u)) {
    return { unitCode: '112', unitName: 'л' };
  }
  if (/^(?:м3|куб\.?\s*м)/iu.test(rawUnit ?? '') || /(?:бетон|раствор|пиломатериал)/iu.test(itemName ?? '')) {
    if (/^(?:м3|куб)/iu.test(rawUnit ?? '')) {
      return { unitCode: '113', unitName: 'м3' };
    }
  }
  if (/^(?:кг|килограмм)/iu.test(rawUnit ?? '')) {
    return { unitCode: '166', unitName: 'кг' };
  }
  return { unitCode: '796', unitName: 'шт' };
}

function inferPackageNomenclatureKind(params: {
  name: string;
  account?: string;
  isService?: boolean;
  virtualKind?: string;
}): { kind: NomenclatureKind1CPackage; account: string; isService: boolean } {
  const { name, account = '', isService = false, virtualKind = '' } = params;
  const lower = `${name} ${virtualKind}`.toLowerCase();

  if (isService || account === '26' || account === '44.01' || account === '20.01' || /услуг/iu.test(virtualKind)) {
    if (
      !account.startsWith('10') &&
      !account.startsWith('41') &&
      !account.startsWith('43') &&
      !account.startsWith('08')
    ) {
      return { kind: 'Услуги', account: '26', isService: true };
    }
  }

  if (account === '10.10' || account === '10.11' || /спецодежд|костюм|каск|перчатк|ботинк|халат|куртк|жилет/iu.test(lower)) {
    return { kind: 'Спецодежда', account: '10.10', isService: false };
  }
  if (account === '10.09' || /инвентар|инструмент|шпател|дрель|перфоратор|молоток/iu.test(lower)) {
    return { kind: 'Инвентарь', account: '10.09', isService: false };
  }
  if (account.startsWith('08.04') || account === '07' || /оборудован|станок|плоттер|бетоносмесител|бытовк|компрессор|сервер/iu.test(lower)) {
    if (account.startsWith('08') || account === '07' || /оборудован/iu.test(virtualKind)) {
      return { kind: 'Оборудование', account: '08.04.1', isService: false };
    }
  }
  if (account === '43' || /продукци/iu.test(virtualKind)) {
    return { kind: 'Продукция', account: '43', isService: false };
  }
  if (account.startsWith('41') || /^товар/iu.test(virtualKind)) {
    return { kind: 'Товары', account: '41.01', isService: false };
  }
  const matAcc = account.startsWith('10.') ? account : '10.01';
  return { kind: 'Материалы', account: matAcc, isService: false };
}

function inferDepreciationGroup(usefulLifeMonths: number): string {
  const m = usefulLifeMonths > 0 ? usefulLifeMonths : 36;
  if (m <= 24) return 'Первая группа (от 1 года до 2 лет включительно)';
  if (m <= 36) return 'Вторая группа (свыше 2 до 3 лет включительно)';
  if (m <= 60) return 'Третья группа (свыше 3 до 5 лет включительно)';
  if (m <= 84) return 'Четвертая группа (свыше 5 до 7 лет включительно)';
  if (m <= 120) return 'Пятая группа (свыше 7 до 10 лет включительно)';
  return 'Шестая группа (свыше 10 до 15 лет включительно)';
}

function resolvePackageOrganization(
  db1C: Database1CSnapshot | null | undefined,
  virtualState: Virtual1CStateSnapshot,
  operations: QueuedOperation[]
): PackageOrganization1C {
  const dbOrg = db1C?.organization;
  if (dbOrg && (dbOrg.name?.trim() || dbOrg.inn?.trim())) {
    const name = (dbOrg.name || dbOrg.fullName || 'ООО «Организация»').trim();
    const fullName = (dbOrg.fullName || name).trim();
    const inn = (dbOrg.inn || '').replace(/\D/g, '') || '7810119529';
    const kpp =
      (dbOrg.kpp || '').replace(/\D/g, '') ||
      (inn.length === 10 ? `${inn.slice(0, 4)}01001` : '');
    const bik = (dbOrg.bik || '').replace(/\D/g, '') || DEFAULT_SBERBANK_BIK;
    const bankName = (dbOrg.bankName || '').trim() || DEFAULT_SBERBANK_NAME;
    const accountNumber =
      (dbOrg.bankAccount || '').replace(/\D/g, '') ||
      buildDeterministicSettlementAccount(inn, bik);
    return { name, fullName, inn, kpp, bik, bankName, accountNumber };
  }

  let ownName = virtualState.ownOrganization?.name?.trim() || '';
  let ownInn = (virtualState.ownOrganization?.inn || '').replace(/\D/g, '');
  let ownKpp = (virtualState.ownOrganization?.kpp || '').replace(/\D/g, '');
  let ownBik = '';
  let ownBankName = '';
  let ownBankAcc = '';

  for (const op of operations) {
    const cand = op.ownOrganization ?? extractCharterCapitalInfo1C(op.description).ownOrganization;
    if (!ownName && cand?.name?.trim()) ownName = cand.name.trim();
    if (!ownInn && cand?.inn) ownInn = cand.inn.replace(/\D/g, '');
    if (!ownKpp && cand?.kpp) ownKpp = cand.kpp.replace(/\D/g, '');
    if (!ownBik && op.organizationBik) ownBik = op.organizationBik.replace(/\D/g, '');
    if (!ownBankName && op.organizationBankName) ownBankName = op.organizationBankName.trim();
    if (!ownBankAcc && op.organizationBankAccount) ownBankAcc = op.organizationBankAccount.replace(/\D/g, '');
  }

  const finalName = ownName || 'ООО «Завод»';
  const finalInn = ownInn || '7810119529';
  const finalKpp = ownKpp || (finalInn.length === 10 ? `${finalInn.slice(0, 4)}01001` : '');
  const finalBik = ownBik || DEFAULT_SBERBANK_BIK;
  const finalBankName = ownBankName || DEFAULT_SBERBANK_NAME;
  const finalAcc = ownBankAcc || buildDeterministicSettlementAccount(finalInn, finalBik);

  return {
    name: finalName,
    fullName: finalName,
    inn: finalInn,
    kpp: finalKpp,
    bik: finalBik,
    bankName: finalBankName,
    accountNumber: finalAcc,
  };
}

function getIntraDaySortPhase(op: QueuedOperation): number {
  if (
    op.category === 'charter_capital' ||
    op.category === 'founder_contribution' ||
    op.category === 'policy_event' ||
    op.category === 'contract_event' ||
    op.category === 'hr_hire' ||
    op.docType1C === 'ПриемНаРаботу' ||
    op.docType1C === 'КадровыйПеревод' ||
    op.category === 'writ_of_execution' ||
    op.docType1C === 'ИсполнительныйЛист' ||
    op.category === 'customer_invoice' ||
    op.category === 'supplier_invoice'
  ) {
    return 10;
  }

  const hasAdvanceEntry = op.entries.some(
    (e) => e.debit === '60.02' || e.credit === '62.02'
  );
  if (
    hasAdvanceEntry ||
    op.category === 'bank_in' ||
    op.category === 'cash_in' ||
    op.category === 'loan_received' ||
    op.category === 'accountable_issue'
  ) {
    return 20;
  }

  if (
    op.category === 'purchase_materials' ||
    op.category === 'purchase_goods' ||
    op.category === 'purchase_equipment' ||
    op.category === 'purchase_services' ||
    op.category === 'intangible_acquisition' ||
    op.category === 'deferred_expense_97' ||
    op.category === 'expense_report'
  ) {
    return isAdditionalPurchaseExpenseOp(op) ? 31 : 30;
  }

  if (op.category === 'os_commissioning' || op.category === 'intangible_commissioning') {
    return 33;
  }

  if (
    op.category === 'materials_writeoff' ||
    op.category === 'workwear_issue' ||
    op.category === 'warehouse_transfer'
  ) {
    return 38;
  }

  if (op.category === 'production_output') {
    return 42;
  }

  if (
    op.category === 'sale_goods' ||
    op.category === 'sale_services' ||
    op.category === 'os_disposal'
  ) {
    return 45;
  }

  if (
    op.category === 'payroll_accrual' ||
    op.docType1C === 'НачислениеЗарплаты' ||
    op.category === 'depreciation_accrual' ||
    op.category === 'intangible_amortization' ||
    op.category === 'insurance_accrual'
  ) {
    return 60;
  }

  if (
    op.category === 'wip_inventory' ||
    op.docType1C === 'ИнвентаризацияНЗП'
  ) {
    return 65;
  }

  if (
    op.category === 'vat_deduction' ||
    op.category === 'advance_offset' ||
    op.category === 'advance_vat' ||
    op.category === 'closing' ||
    op.docType1C === 'ЗакрытиеМесяца' ||
    Boolean(op.autoGeneratedKind)
  ) {
    return 70;
  }

  return 50;
}

function resolveMetaTypeAndStrategy(op: QueuedOperation): {
  metaType1C: MetaType1CBP30;
  executionStrategy: ExecutionStrategy1C;
  operationKind1C: string;
} {
  // 1. Reglament / informational events executed natively inside 1C
  if (
    op.category === 'closing' ||
    op.docType1C === 'ЗакрытиеМесяца' ||
    op.autoGeneratedKind === 'closing_26' ||
    op.autoGeneratedKind === 'closing_90_91' ||
    op.autoGeneratedKind === 'profit_tax_99'
  ) {
    return {
      metaType1C: 'ЗакрытиеМесяца',
      executionStrategy: 'run_native_in_1c',
      operationKind1C: 'ЗакрытиеМесяца',
    };
  }

  if (
    op.category === 'vat_deduction' ||
    op.autoGeneratedKind === 'advance_offset' ||
    op.autoGeneratedKind === 'advance_vat' ||
    op.category === 'policy_event' ||
    op.category === 'contract_event' ||
    op.category === 'supplier_invoice' ||
    op.docType1C === 'СчетОтПоставщика'
  ) {
    return {
      metaType1C: 'ЗакрытиеМесяца',
      executionStrategy: 'run_native_in_1c',
      operationKind1C:
        op.category === 'vat_deduction'
          ? 'ФормированиеЗаписейКнигиПокупок'
          : op.autoGeneratedKind
            ? 'АвтоЗачетИЛИАвансовыйНДС'
            : 'РегистрацияДоговораИлиСчета',
    };
  }

  // 2. Complex / non-standard RSBU operations routed strictly to ОперацияБух (manual_operation)
  const hasSanctionOrClaim = op.entries.some(
    (e) =>
      e.debit === '99.02.3' ||
      e.debit === '76.02' ||
      e.credit === '76.02' ||
      e.debit === '63' ||
      e.credit === '63'
  );
  const hasFinancialNotes = op.entries.some(
    (e) => e.debit.startsWith('58.') || e.credit.startsWith('58.') || e.debit === '76.03' || e.credit === '76.03'
  );
  const hasCharterCapital75 = op.entries.some(
    (e) =>
      (e.debit.startsWith('75.') && e.credit.startsWith('80.')) ||
      ((e.debit.startsWith('08.') || e.debit.startsWith('10.') || e.debit.startsWith('41.')) &&
        e.credit.startsWith('75.'))
  );
  const hasGiftOrMatAid73 =
    op.category === 'employee_settlement_73' ||
    op.entries.some((e) => e.debit === '73.03' || e.credit === '73.03');

  const isExplicitNativeSpecialDoc = [
    'КорректировкаДолга',
    'ВозвратТоваровПоставщику',
    'ВозвратТоваровОтПокупателя',
    'СписаниеТоваров',
    'СписаниеОС',
    'Увольнение',
  ].includes(String(op.docType1C || ''));

  if (
    !isExplicitNativeSpecialDoc &&
    (op.category === 'charter_capital' ||
      hasCharterCapital75 ||
      op.category === 'financial_investment' ||
      op.category === 'financial_interest_accrual' ||
      op.category === 'financial_disposal' ||
      hasFinancialNotes ||
      op.category === 'loan_interest_accrual' ||
      hasGiftOrMatAid73 ||
      op.category === 'penalty_claim' ||
      hasSanctionOrClaim ||
      op.category === 'reserve_doubtful_63' ||
      op.category === 'off_balance_op' ||
      op.category === 'dividends_accrual' ||
      op.category === 'inventory_result' ||
      op.isOsModernization ||
      op.category === 'manual' ||
      op.docType1C === 'ОперацияБух')
  ) {
    return {
      metaType1C: 'ОперацияБух',
      executionStrategy: 'manual_operation',
      operationKind1C: 'ОперацияВведеннаяВручную',
    };
  }

  // 3. Native 1C:BP 3.0 documents
  const rawDocHint = String(op.docType1C || '');
  if (
    rawDocHint === 'Увольнение' ||
    rawDocHint === 'УвольнениеИзОрганизации' ||
    (op.category === 'hr_hire' && /уволен|увольнен|расторгнут\p{L}*\s+трудов/iu.test(op.description || ''))
  ) {
    return {
      metaType1C: 'Увольнение',
      executionStrategy: 'native',
      operationKind1C: 'Увольнение',
    };
  }
  if (op.docType1C === 'КадровыйПеревод') {
    return {
      metaType1C: 'КадровыйПеревод',
      executionStrategy: 'native',
      operationKind1C: 'КадровыйПеревод',
    };
  }
  if (op.category === 'hr_hire' || op.docType1C === 'ПриемНаРаботу') {
    return {
      metaType1C: 'ПриемНаРаботу',
      executionStrategy: 'native',
      operationKind1C: 'ПриемНаРаботу',
    };
  }
  if (op.category === 'writ_of_execution' || op.docType1C === 'ИсполнительныйЛист') {
    return {
      metaType1C: 'ИсполнительныйЛист',
      executionStrategy: 'native',
      operationKind1C: 'ИсполнительныйЛист',
    };
  }
  if (
    rawDocHint === 'СписаниеОС' ||
    (op.category === 'os_disposal' &&
      !op.entries.some((e) => e.debit.startsWith('62') || e.debit.startsWith('76')) &&
      /списан|ликвидац|физическ\p{L}*\s+износ/iu.test(op.description || ''))
  ) {
    return {
      metaType1C: 'СписаниеОС',
      executionStrategy: 'native',
      operationKind1C: 'СписаниеОС',
    };
  }
  if (rawDocHint === 'ВозвратТоваровПоставщику') {
    return {
      metaType1C: 'ВозвратТоваровПоставщику',
      executionStrategy: 'native',
      operationKind1C: 'ПокупкаКомиссия',
    };
  }
  if (rawDocHint === 'ВозвратТоваровОтПокупателя') {
    return {
      metaType1C: 'ВозвратТоваровОтПокупателя',
      executionStrategy: 'native',
      operationKind1C: 'ПродажаКомиссия',
    };
  }
  if (rawDocHint === 'КорректировкаДолга') {
    return {
      metaType1C: 'КорректировкаДолга',
      executionStrategy: 'native',
      operationKind1C: 'ПрочиеКорректировки',
    };
  }
  if (rawDocHint === 'СписаниеТоваров') {
    return {
      metaType1C: 'СписаниеТоваров',
      executionStrategy: 'native',
      operationKind1C: 'Товары',
    };
  }
  if (op.category === 'wip_inventory' || op.docType1C === 'ИнвентаризацияНЗП') {
    return {
      metaType1C: 'ИнвентаризацияНЗП',
      executionStrategy: 'native',
      operationKind1C: 'ИнвентаризацияНЗП',
    };
  }
  if (op.category === 'customer_invoice' || op.docType1C === 'СчетПокупателю') {
    return {
      metaType1C: 'СчетНаОплатуПокупателю',
      executionStrategy: 'native',
      operationKind1C: 'СчетНаОплатуПокупателю',
    };
  }
  if (op.category === 'payroll_accrual' || op.docType1C === 'НачислениеЗарплаты') {
    return {
      metaType1C: 'НачислениеЗарплаты',
      executionStrategy: 'native',
      operationKind1C: 'НачислениеЗарплаты',
    };
  }
  if (op.category === 'os_commissioning' || op.docType1C === 'ПринятиеКУчетуОС') {
    return {
      metaType1C: 'ПринятиеКУчетуОС',
      executionStrategy: 'native',
      operationKind1C: 'Оборудование',
    };
  }
  if (op.category === 'os_disposal' || op.docType1C === 'ПередачаОС') {
    return {
      metaType1C: 'ПередачаОС',
      executionStrategy: 'native',
      operationKind1C: 'ПередачаОС',
    };
  }
  if (op.category === 'workwear_issue' || op.docType1C === 'ПередачаМатериаловВЭксплуатацию') {
    return {
      metaType1C: 'ПередачаМатериаловВЭксплуатацию',
      executionStrategy: 'native',
      operationKind1C: 'Спецодежда',
    };
  }
  if (op.category === 'materials_writeoff' || op.docType1C === 'РасходМатериалов') {
    return {
      metaType1C: 'ТребованиеНакладная',
      executionStrategy: 'native',
      operationKind1C: 'ИспользованиеМатериалов',
    };
  }
  if (op.category === 'production_output' || op.docType1C === 'ВыпускПродукции') {
    return {
      metaType1C: 'ОтчетПроизводстваЗаСмену',
      executionStrategy: 'native',
      operationKind1C: 'ПродукцияУслуги',
    };
  }
  if (op.category === 'expense_report' || op.docType1C === 'АвансовыйОтчет') {
    return {
      metaType1C: 'АвансовыйОтчет',
      executionStrategy: 'native',
      operationKind1C: 'АвансовыйОтчет',
    };
  }
  if (
    op.docType1C === 'ПоступлениеНаличных' ||
    op.category === 'cash_in' ||
    op.category === 'accountable_return' ||
    (op.category === 'founder_contribution' && op.entries.some((e) => e.debit === '50.01'))
  ) {
    const opKind =
      op.category === 'accountable_return'
        ? 'ВозвратПодотчетнымЛицом'
        : op.entries.some((e) => e.credit === '51')
          ? 'ПолучениеНаличныхВБанке'
          : op.entries.some((e) => e.credit.startsWith('62'))
            ? 'ОплатаПокупателя'
            : 'ПрочийПриход';
    return {
      metaType1C: 'ПоступлениеНаличных',
      executionStrategy: 'native',
      operationKind1C: opKind,
    };
  }
  if (
    op.docType1C === 'ВыдачаНаличных' ||
    op.category === 'cash_out' ||
    (op.category === 'accountable_issue' && op.entries.some((e) => e.credit === '50.01')) ||
    (op.category === 'cash_bank_internal' && op.entries.some((e) => e.credit === '50.01'))
  ) {
    const opKind =
      op.category === 'accountable_issue'
        ? 'ВыдачаПодотчетномуЛицу'
        : op.entries.some((e) => e.debit === '51')
          ? 'ВзносНаличнымиВБанк'
          : op.entries.some((e) => e.debit === '70')
            ? 'ВыплатаЗаработнойПлатыПоВедомостям'
            : op.entries.some((e) => e.debit.startsWith('60'))
              ? 'ОплатаПоставщику'
              : 'ПрочийРасход';
    return {
      metaType1C: 'ВыдачаНаличных',
      executionStrategy: 'native',
      operationKind1C: opKind,
    };
  }

  // Bank incoming
  if (
    op.docType1C === 'ПоступлениеНаРасчетныйСчет' ||
    op.category === 'bank_in' ||
    op.category === 'loan_received' ||
    op.category === 'acquiring_receipt' ||
    (op.category === 'founder_contribution' && op.entries.some((e) => e.debit === '51'))
  ) {
    const opKind =
      op.category === 'loan_received' || op.entries.some((e) => e.credit.startsWith('66') || e.credit.startsWith('67'))
        ? 'ПолучениеКредитаВБанке'
        : op.entries.some((e) => e.credit.startsWith('62'))
          ? 'ОплатаПокупателя'
          : 'ПрочееПоступление';
    return {
      metaType1C: 'ПоступлениеНаРасчетныйСчет',
      executionStrategy: 'native',
      operationKind1C: opKind,
    };
  }

  // Bank outgoing
  if (
    op.docType1C === 'СписаниеСРасчетногоСчета' ||
    op.category === 'bank_out' ||
    op.category === 'tax_payment' ||
    op.category === 'payroll_payout' ||
    op.category === 'alimony_payout' ||
    op.category === 'loan_repaid' ||
    op.category === 'loan_issued' ||
    op.category === 'bank_fee' ||
    op.category === 'dividends_payout' ||
    (op.category === 'accountable_issue' && op.entries.some((e) => e.credit === '51'))
  ) {
    let opKind = 'ОплатаПоставщику';
    if (op.entries.some((e) => e.debit.startsWith('62') && e.credit === '51')) {
      opKind = 'ВозвратПокупателю';
    } else if (
      op.category === 'tax_payment' ||
      op.entries.some((e) => (e.debit.startsWith('68') || e.debit.startsWith('69')) && e.credit === '51')
    ) {
      opKind = 'ПеречислениеНалога';
    } else if (op.category === 'payroll_payout' || op.entries.some((e) => e.debit === '70')) {
      opKind = 'ПеречислениеЗаработнойПлатыРаботнику';
    } else if (
      op.category === 'bank_fee' ||
      op.category === 'alimony_payout' ||
      op.category === 'loan_repaid' ||
      op.category === 'loan_issued' ||
      op.category === 'accountable_issue' ||
      op.category === 'dividends_payout' ||
      !op.entries.some((e) => e.debit.startsWith('60'))
    ) {
      opKind = 'ПрочееСписание';
    }
    return {
      metaType1C: 'СписаниеСРасчетногоСчета',
      executionStrategy: 'native',
      operationKind1C: opKind,
    };
  }

  // Sales (РТУ)
  if (
    op.docType1C === 'РеализацияТоваровУслуг' ||
    op.category === 'sale_goods' ||
    op.category === 'sale_services'
  ) {
    const hasStock43or41 = op.entries.some(
      (e) => e.credit === '43' || e.credit.startsWith('41') || e.credit.startsWith('10')
    );
    const opKind =
      op.category === 'sale_services' && !hasStock43or41 ? 'Услуги' : hasStock43or41 ? 'Товары' : 'Услуги';
    return {
      metaType1C: 'РеализацияТоваровУслуг',
      executionStrategy: 'native',
      operationKind1C: opKind,
    };
  }

  // Purchases (ПТУ / ДопРасходы)
  if (
    op.docType1C === 'ПоступлениеТоваровУслуг' ||
    op.category === 'purchase_materials' ||
    op.category === 'purchase_goods' ||
    op.category === 'purchase_equipment' ||
    op.category === 'purchase_services' ||
    op.category === 'deferred_expense_97' ||
    op.category === 'intangible_acquisition'
  ) {
    if (isAdditionalPurchaseExpenseOp(op)) {
      return {
        metaType1C: 'ПоступлениеДопРасходов',
        executionStrategy: 'native',
        operationKind1C: 'ПоступлениеДопРасходов',
      };
    }
    if (
      op.category === 'purchase_equipment' ||
      op.docType1C === ('ПоступлениеОС' as unknown as QueuedOperation['docType1C']) ||
      op.entries.some((e) => e.debit.startsWith('08.04'))
    ) {
      return {
        metaType1C: 'ПоступлениеТоваровУслуг',
        executionStrategy: 'native',
        operationKind1C: 'Оборудование',
      };
    }
    const hasStockReceipt10or41 = op.entries.some(
      (e) => e.debit.startsWith('10.') || e.debit.startsWith('41.')
    );
    if (
      !hasStockReceipt10or41 &&
      (op.category === 'purchase_services' ||
        op.category === 'deferred_expense_97' ||
        op.entries.some(
          (e) =>
            (e.debit === '26' || e.debit === '20.01' || e.debit === '44.01' || e.debit === '97.21') &&
            (e.credit.startsWith('60') || e.credit.startsWith('76'))
        ))
    ) {
      return {
        metaType1C: 'ПоступлениеТоваровУслуг',
        executionStrategy: 'native',
        operationKind1C: 'Услуги',
      };
    }
    return {
      metaType1C: 'ПоступлениеТоваровУслуг',
      executionStrategy: 'native',
      operationKind1C: 'Товары',
    };
  }

  // Fallback to manual_operation if any remaining special document
  return {
    metaType1C: 'ОперацияБух',
    executionStrategy: 'manual_operation',
    operationKind1C: 'ОперацияВведеннаяВручную',
  };
}

function resolveDynamicBalanceMode(
  op: QueuedOperation,
  metaType1C: MetaType1CBP30,
  operationKind1C: string
): DynamicBalanceMode1C | undefined {
  const desc = (op.description || '').toLowerCase();

  // 1. Full tax & social contribution debt settlement ('taxes_all')
  const isTaxOut =
    metaType1C === 'СписаниеСРасчетногоСчета' &&
    (op.category === 'tax_payment' ||
      operationKind1C === 'ПеречислениеНалога' ||
      op.entries.some((e) => (e.debit.startsWith('68.') || e.debit.startsWith('69.')) && e.credit === '51'));

  if (isTaxOut) {
    const distinctTaxDebits = new Set(
      op.entries
        .filter((e) => e.debit.startsWith('68.') || e.debit.startsWith('69.'))
        .map((e) => e.debit)
    );
    const mentionsAllTaxesOrDebt =
      /налог\p{L}*\s+и\s+(?:страхов\p{L}*\s+)?взнос|задолженност\p{L}*\s+по\s+налог|в\s+бюджет\s+задолженност|все\p{L}*\s+налог|налог\p{L}*\s+и\s+сбор/iu.test(
        desc
      );
    const noHardcodedRawExcelAmount = (op.rawExcelAmount ?? 0) < 0.01 && op.amountMode !== 'explicit';

    if (distinctTaxDebits.size >= 2 || mentionsAllTaxesOrDebt || noHardcodedRawExcelAmount) {
      return 'taxes_all';
    }
  }

  // 2. Final / prior-month payroll debt payout from account 70 ('payroll_balance')
  const isPayrollOut =
    (metaType1C === 'СписаниеСРасчетногоСчета' || metaType1C === 'ВыдачаНаличных') &&
    (op.category === 'payroll_payout' ||
      operationKind1C === 'ПеречислениеЗаработнойПлатыРаботнику' ||
      operationKind1C === 'ВыплатаЗаработнойПлатыПоВедомостям' ||
      op.entries.some((e) => e.debit === '70' && (e.credit === '51' || e.credit.startsWith('50'))));

  if (isPayrollOut) {
    const isMidMonthAdvance = /аванс|перв\p{L}+\s+половин/iu.test(desc);
    if (!isMidMonthAdvance) {
      const mentionsMonthlySettlement =
        /окончательн|за\s+прошл|за\s+отработан|за\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)|задолженност\p{L}*\s+по\s+(?:заработн|оплат)|перечислен\p{L}*\s+(?:с\s+расчетн\p{L}*\s+счет\p{L}*\s+)?заработн\p{L}*\s+плат|выплачен\p{L}*\s+заработн\p{L}*\s+плат/iu.test(
          desc
        );
      const noHardcodedRawExcelAmount = (op.rawExcelAmount ?? 0) < 0.01 && op.amountMode !== 'explicit';

      if (mentionsMonthlySettlement || noHardcodedRawExcelAmount) {
        return 'payroll_balance';
      }
    }
  }

  return undefined;
}

function isAdditionalPurchaseExpenseOp(op: QueuedOperation): boolean {
  const desc = op.description || '';
  if (op.docType1C === ('ПоступлениеДопРасходов' as unknown as QueuedOperation['docType1C'])) {
    return true;
  }
  if (op.documentSubKind1C === 'ПоступлениеДопРасходов') {
    return true;
  }
  if (
    op.category === 'purchase_equipment' &&
    /доставк|перевозк|транспортн|монтаж|пусконалад|подключен|настройк|включен\p{L}*\s+в\s+стоимост|поступление\s+доп\.?\s*расход/iu.test(
      desc
    )
  ) {
    return true;
  }
  if (
    (op.category === 'purchase_materials' || op.category === 'purchase_goods') &&
    /включен\p{L}*\s+в\s+стоимост|поступление\s+доп\.?\s*расход|(?:доставк|перевозк|транспортн)\p{L}*\s+(?:приобретенн\p{L}*\s+|поступивш\p{L}*\s+)?(?:материал|товар|сырь)/iu.test(
      desc
    )
  ) {
    return true;
  }
  return false;
}

export function build1CTransferPackage(
  operations: QueuedOperation[],
  db1C?: Database1CSnapshot | null,
  virtualState?: Virtual1CStateSnapshot | null,
  options?: { calculationProfile?: CalculationProfile1C; monthlyProfitTax?: boolean }
): TransferPackage1C {
  const activeOps = operations.filter(
    (op) => op.includeInProcessing !== false && !op.isDuplicateIn1C
  );

  const resolvedVirtualState =
    virtualState ?? buildVirtual1CStateTimeline(db1C ?? null, activeOps).finalState;

  const organization = resolvePackageOrganization(db1C, resolvedVirtualState, activeOps);

  const dates = activeOps
    .map((o) => o.date)
    .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d)))
    .sort();
  const reportingYear = dates[0]
    ? Number(dates[0].slice(0, 4))
    : db1C?.periodStart
      ? Number(db1C.periodStart.slice(0, 4))
      : DEFAULT_REPORTING_YEAR;
  const periodFrom = dates[0] || `${reportingYear}-01-01`;
  const periodTo = dates[dates.length - 1] || `${reportingYear}-12-31`;

  // =========================================================================
  // 1. Build Deduplicated Catalogs
  // =========================================================================
  const cpMap = new Map<string, PackageCounterparty1C>();
  const cpLookupByNormName = new Map<string, string>();
  const cpLookupByInn = new Map<string, string>();

  const registerCounterparty = (params: {
    name?: string;
    fullName?: string;
    inn?: string;
    kpp?: string;
    kind?: string;
  }): string => {
    const rawName = (params.name || '').trim();
    if (!rawName || rawName.length < 2) return '';
    const cleanName = normalizeLegalEntityName1C(rawName) || rawName;
    const cleanInn = (params.inn || '').replace(/\D/g, '');
    if (cleanInn && cleanInn === organization.inn) return '';
    if (
      !cleanInn &&
      normalizeCounterpartyKey1C(cleanName) === normalizeCounterpartyKey1C(organization.name)
    ) {
      return '';
    }

    if (cleanInn && cpLookupByInn.has(cleanInn)) {
      return cpLookupByInn.get(cleanInn)!;
    }
    const normName = normalizeCounterpartyKey1C(cleanName);
    if (!normName) return '';
    if (cpLookupByNormName.has(normName)) {
      const existingKey = cpLookupByNormName.get(normName)!;
      const existing = cpMap.get(existingKey)!;
      if (cleanInn && !existing.inn) {
        existing.inn = cleanInn;
        cpLookupByInn.set(cleanInn, existingKey);
      }
      if (params.kpp && !existing.kpp) {
        existing.kpp = params.kpp.replace(/\D/g, '');
      }
      return existingKey;
    }

    const mappedKind: 'ЮридическоеЛицо' | 'ФизическоеЛицо' =
      params.kind === 'ФизическоеЛицо' ||
      params.kind === 'ИндивидуальныйПредприниматель' ||
      cleanInn.length === 12 ||
      /^ип\b/iu.test(cleanName)
        ? 'ФизическоеЛицо'
        : 'ЮридическоеЛицо';

    const cleanKpp =
      mappedKind === 'ФизическоеЛицо'
        ? ''
        : (params.kpp || '').replace(/\D/g, '') ||
          (cleanInn.length === 10 ? `${cleanInn.slice(0, 4)}01001` : '');

    const key = cleanInn ? `cp_${cleanInn}` : `cp_${shortDeterministicHash(normName)}`;
    const record: PackageCounterparty1C = {
      key,
      name: cleanName,
      fullName: (params.fullName || cleanName).trim(),
      inn: cleanInn,
      kpp: cleanKpp,
      kind: mappedKind,
    };
    cpMap.set(key, record);
    cpLookupByNormName.set(normName, key);
    if (cleanInn) cpLookupByInn.set(cleanInn, key);
    return key;
  };

  for (const cp of resolvedVirtualState.counterparties) {
    registerCounterparty({
      name: cp.name,
      fullName: cp.fullName,
      inn: cp.inn,
      kpp: cp.kpp,
      kind: cp.kind,
    });
  }
  for (const op of activeOps) {
    if (op.counterpartyName && op.counterpartyName.trim().length >= 2) {
      registerCounterparty({
        name: op.counterpartyName,
        inn: op.counterpartyInn,
        kpp: op.counterpartyKpp,
        kind: op.counterpartyKind,
      });
    }
  }

  // Contracts
  const ctrMap = new Map<string, PackageContract1C>();
  const registerContract = (params: {
    counterpartyKey: string;
    name?: string;
    number?: string;
    date?: string;
    kind?: 'СПоставщиком' | 'СПокупателем' | 'Прочее';
  }): string => {
    if (!params.counterpartyKey) return '';
    const rawName = (params.name || '').trim();
    const num = (params.number || '').trim();
    const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : periodFrom;
    const kind = params.kind || 'СПоставщиком';
    const finalName = rawName || (num ? `Договор № ${num}` : 'Основной договор');
    const dedupId = `${params.counterpartyKey}|${kind}|${normalizeSimpleEntityKey1C(finalName)}`;
    for (const [k, existing] of ctrMap.entries()) {
      const existingDedup = `${existing.counterpartyKey}|${existing.kind}|${normalizeSimpleEntityKey1C(existing.name)}`;
      if (existingDedup === dedupId) return k;
    }
    const key = `ctr_${shortDeterministicHash(dedupId)}`;
    ctrMap.set(key, {
      key,
      counterpartyKey: params.counterpartyKey,
      name: finalName,
      number: num,
      date,
      kind,
    });
    return key;
  };

  for (const vCtr of resolvedVirtualState.contracts) {
    const cpKey = registerCounterparty({ name: vCtr.counterpartyName });
    if (cpKey) {
      registerContract({
        counterpartyKey: cpKey,
        name: vCtr.name,
        number: vCtr.number,
        date: vCtr.date || periodFrom,
        kind: vCtr.contractKind,
      });
    }
  }

  // Warehouses
  const warehouseSet = new Set<string>(['Основной склад']);
  if (db1C) {
    for (const w of db1C.warehouses) {
      if (w.name?.trim()) warehouseSet.add(w.name.trim());
    }
  }
  for (const op of activeOps) {
    if (op.warehouseName?.trim()) warehouseSet.add(op.warehouseName.trim());
    if (op.warehouseToName?.trim()) warehouseSet.add(op.warehouseToName.trim());
  }

  // Nomenclature (strictly clean, zero comma-concatenations, zero credits/interest/notes)
  const nomMap = new Map<string, PackageNomenclature1C>();
  const nomKeyByNorm = new Map<string, string>();

  const registerNomenclature = (params: {
    rawName?: string;
    descriptionCtx?: string;
    unit?: string;
    account?: string;
    isService?: boolean;
    vatRate?: number;
    virtualKind?: string;
  }): string => {
    const cleanName = sanitizePackageNomenclatureName(params.rawName, params.descriptionCtx);
    if (!cleanName) return '';
    const norm = normalizeSimpleEntityKey1C(cleanName);
    if (!norm) return '';
    if (nomKeyByNorm.has(norm)) {
      return nomKeyByNorm.get(norm)!;
    }
    const kindMeta = inferPackageNomenclatureKind({
      name: cleanName,
      account: params.account,
      isService: params.isService,
      virtualKind: params.virtualKind,
    });
    const unitMeta = mapUnitToOkei(params.unit, cleanName, kindMeta.isService);
    const key = `nom_${shortDeterministicHash(norm)}`;
    nomMap.set(key, {
      key,
      name: cleanName,
      kind: kindMeta.kind,
      unitCode: unitMeta.unitCode,
      unitName: unitMeta.unitName,
      isService: kindMeta.isService,
      account: kindMeta.account,
      vatRate: typeof params.vatRate === 'number' && params.vatRate >= 0 ? params.vatRate : 20,
    });
    nomKeyByNorm.set(norm, key);
    return key;
  };

  for (const vNom of resolvedVirtualState.nomenclature) {
    const parsedVat = parseInt(vNom.vatRateLabel || '20', 10);
    registerNomenclature({
      rawName: vNom.name,
      unit: vNom.unit,
      account: vNom.defaultAccount,
      isService: vNom.itemKind === 'Услуги',
      vatRate: Number.isFinite(parsedVat) ? parsedVat : 20,
      virtualKind: vNom.itemKind,
    });
  }

  // Nomenclature Groups (from 20.01, 90.*, op.nomenclatureGroupName, db1C)
  const nomGroupsSet = new Set<string>(['Основная номенклатурная группа']);
  const addNomGroup = (rawGroup?: string) => {
    if (!rawGroup) return;
    const head = rawGroup.split(/\s+\/\s+/)[0].trim();
    if (
      !head ||
      head.length < 2 ||
      /^без\s+аналитик/iu.test(head) ||
      /^(?:основное\s+подразделение|оплата\s+труда|материальные\s+расходы|амортизация|прочие\s+расходы)$/iu.test(head)
    ) {
      return;
    }
    nomGroupsSet.add(head);
  };
  if (db1C) {
    for (const ng of db1C.nomenclatureGroups) addNomGroup(ng.name);
  }
  for (const op of activeOps) {
    if (op.nomenclatureGroupName) addNomGroup(op.nomenclatureGroupName);
    for (const e of op.entries) {
      if (e.debit === '20.01') addNomGroup(e.debitSubconto);
      if (e.credit === '20.01') addNomGroup(e.creditSubconto);
      if (e.debit.startsWith('90.') && e.debit !== '90.09') addNomGroup(e.debitSubconto);
      if (e.credit.startsWith('90.') && e.credit !== '90.09') addNomGroup(e.creditSubconto);
    }
  }

  // Fixed Assets (ОС)
  const osMap = new Map<string, PackageFixedAsset1C>();
  const osKeyByNorm = new Map<string, string>();
  const registerFixedAsset = (params: {
    name?: string;
    usefulLifeMonths?: number;
    costAccount?: string;
    expenseItem?: string;
  }): string => {
    const clean = (params.name || '').trim();
    if (!clean || clean.length < 2) return '';
    const norm = normalizeSimpleEntityKey1C(clean);
    if (!norm) return '';
    if (osKeyByNorm.has(norm)) {
      const existingKey = osKeyByNorm.get(norm)!;
      const ex = osMap.get(existingKey)!;
      if (params.usefulLifeMonths && params.usefulLifeMonths > 0) {
        ex.usefulLifeMonths = params.usefulLifeMonths;
        ex.depreciationGroup = inferDepreciationGroup(params.usefulLifeMonths);
      }
      return existingKey;
    }
    const spi = params.usefulLifeMonths && params.usefulLifeMonths > 0 ? params.usefulLifeMonths : 36;
    const key = `os_${shortDeterministicHash(norm)}`;
    osMap.set(key, {
      key,
      name: clean,
      usefulLifeMonths: spi,
      depreciationGroup: inferDepreciationGroup(spi),
      costAccount: params.costAccount || '20.01',
      expenseItem: params.expenseItem || 'Амортизация',
    });
    osKeyByNorm.set(norm, key);
    return key;
  };

  if (db1C && Array.isArray(db1C.rawDirectories?.['ОсновныеСредства'])) {
    for (const rawOs of db1C.rawDirectories['ОсновныеСредства']) {
      if (rawOs && typeof rawOs === 'object') {
        const rec = rawOs as Record<string, unknown>;
        const osName = String(rec['Наименование'] ?? rec['name'] ?? '').trim();
        const spi = Number(rec['СрокПолезногоИспользования'] ?? rec['usefulLifeMonths'] ?? 0);
        if (osName) {
          registerFixedAsset({
            name: osName,
            usefulLifeMonths: spi > 0 ? spi : undefined,
          });
        }
      }
    }
  }
  for (const vOs of resolvedVirtualState.fixedAssets) {
    registerFixedAsset({
      name: vOs.name,
      usefulLifeMonths: vOs.usefulLifeMonths,
      costAccount: '20.01',
      expenseItem: 'Амортизация',
    });
  }
  for (const op of activeOps) {
    if (op.category === 'os_commissioning' || op.category === 'os_disposal') {
      registerFixedAsset({
        name: op.nomenclatureName,
        usefulLifeMonths: op.usefulLifeMonths,
        costAccount: op.costAccount || '20.01',
        expenseItem: op.expenseItemName || 'Амортизация',
      });
    }
  }

  // Deferred Expenses (РБП 97.21)
  const rpbMap = new Map<string, PackageDeferredExpense1C>();
  const rpbKeyByNorm = new Map<string, string>();
  const registerDeferredExpense = (params: {
    name?: string;
    totalAmount?: number;
    startDate?: string;
    endDate?: string;
    termMonths?: number;
    writeOffMethod?: 'monthly' | 'calendar_days';
    costAccount?: string;
    expenseItem?: string;
  }): string => {
    const clean = (params.name || '').trim();
    if (!clean || clean.length < 2) return '';
    const norm = normalizeSimpleEntityKey1C(clean);
    if (!norm) return '';
    if (rpbKeyByNorm.has(norm)) return rpbKeyByNorm.get(norm)!;

    const start = params.startDate && /^\d{4}-\d{2}-\d{2}$/.test(params.startDate) ? params.startDate : periodFrom;
    const term = params.termMonths && params.termMonths > 0 ? params.termMonths : 12;
    const end =
      params.endDate && /^\d{4}-\d{2}-\d{2}$/.test(params.endDate)
        ? params.endDate
        : computeRpbEndDateFromTermMonths1C(start, term);
    const key = `rpb_${shortDeterministicHash(norm)}`;
    rpbMap.set(key, {
      key,
      name: clean,
      totalAmount: round2(params.totalAmount || 0),
      startDate: start,
      endDate: end,
      termMonths: term,
      writeOffMethod: params.writeOffMethod === 'calendar_days' ? 'calendar_days' : 'monthly',
      costAccount: params.costAccount || '26',
      expenseItem: params.expenseItem || 'Прочие расходы',
    });
    rpbKeyByNorm.set(norm, key);
    return key;
  };

  for (const vRpb of resolvedVirtualState.deferredExpenses ?? []) {
    registerDeferredExpense({
      name: vRpb.name,
      totalAmount: vRpb.totalAmount,
      startDate: vRpb.startDate || vRpb.originDate,
      endDate: vRpb.endDate,
      termMonths: vRpb.termMonths,
      writeOffMethod: vRpb.writeOffMethod,
      costAccount: vRpb.writeOffAccount || '26',
      expenseItem: 'Прочие расходы',
    });
  }

  // Employees
  const isRolePlaceholderNotFio = (val?: string): boolean => {
    const s = (val || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return true;
    if (/фио\s+студент/iu.test(val || '')) return true;
    if (
      /^(?:главн\p{L}*\s+бухгалтер|бухгалтер|генеральн\p{L}*\s+директор|директор|руководител\p{L}*|кассир|менеджер|специалист|сотрудник(?:\s+штата|\s+организац\p{L}*)?|работник)$/iu.test(
        s
      )
    ) {
      return true;
    }
    return false;
  };

  const extractPositionFromPlaceholder = (val?: string): string => {
    const cleaned = (val || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (/главн\p{L}*\s+бухгалтер/iu.test(cleaned)) return 'Главный бухгалтер';
    if (/генеральн\p{L}*\s+директор/iu.test(cleaned)) return 'Генеральный директор';
    if (/^директор$/iu.test(cleaned)) return 'Директор';
    if (/^бухгалтер$/iu.test(cleaned)) return 'Бухгалтер';
    return '';
  };

  const resolveChiefAccountantFioFromDb1C = (snap?: Database1CSnapshot | null): string => {
    if (!snap) return '';
    const orgAny = snap.organization as unknown as Record<string, unknown> | undefined;
    const directChief = String(
      orgAny?.['chiefAccountant'] ?? orgAny?.['ГлавныйБухгалтер'] ?? ''
    ).trim();
    if (directChief && !isRolePlaceholderNotFio(directChief)) {
      return normalizeRussianFioToNominative1C(directChief) || directChief;
    }
    const respRows = snap.rawDirectories?.['ОтветственныеЛица'];
    if (Array.isArray(respRows)) {
      for (const r of respRows) {
        if (r && typeof r === 'object') {
          const rec = r as Record<string, unknown>;
          const role = String(rec['ОтветственноеЛицо'] ?? rec['Роль'] ?? rec['Должность'] ?? '');
          const fio = String(rec['ФизическоеЛицо'] ?? rec['ФИО'] ?? rec['Наименование'] ?? '').trim();
          if (/бухгалтер/iu.test(role) && fio && !isRolePlaceholderNotFio(fio)) {
            return normalizeRussianFioToNominative1C(fio) || fio;
          }
        }
      }
    }
    const rawEmpRows = snap.rawDirectories?.['Сотрудники'];
    if (Array.isArray(rawEmpRows)) {
      for (const r of rawEmpRows) {
        if (r && typeof r === 'object') {
          const rec = r as Record<string, unknown>;
          const pos = String(rec['Должность'] ?? rec['position'] ?? '');
          const fio = String(rec['ФИО'] ?? rec['Наименование'] ?? rec['fullName'] ?? rec['name'] ?? '').trim();
          if (/главн\p{L}*\s+бухгалтер/iu.test(pos) && fio && !isRolePlaceholderNotFio(fio)) {
            return normalizeRussianFioToNominative1C(fio) || fio;
          }
        }
      }
      // Also check if Base 0 has a 5th student employee in Сотрудники beyond the 4 standard Q1 staff
      for (const r of rawEmpRows) {
        if (r && typeof r === 'object') {
          const rec = r as Record<string, unknown>;
          const fio = String(rec['ФИО'] ?? rec['Наименование'] ?? rec['fullName'] ?? rec['name'] ?? '').trim();
          if (
            fio &&
            !isRolePlaceholderNotFio(fio) &&
            !/валеев|фадеев|баранкин|федоров|фёдоров/iu.test(fio)
          ) {
            return normalizeRussianFioToNominative1C(fio) || fio;
          }
        }
      }
    }
    for (const emp of snap.employees || []) {
      const fio = (emp.name || '').trim();
      const pos = String(emp.extra?.Должность ?? emp.extra?.должность ?? '');
      if (/главн\p{L}*\s+бухгалтер/iu.test(pos) && fio && !isRolePlaceholderNotFio(fio)) {
        return normalizeRussianFioToNominative1C(fio) || fio;
      }
    }
    for (const emp of snap.employees || []) {
      const fio = (emp.name || '').trim();
      if (
        fio &&
        !isRolePlaceholderNotFio(fio) &&
        !/валеев|фадеев|баранкин|федоров|фёдоров/iu.test(fio)
      ) {
        return normalizeRussianFioToNominative1C(fio) || fio;
      }
    }
    return '';
  };

  const resolvedChiefAccountantFio =
    resolveChiefAccountantFioFromDb1C(db1C) || 'Иванова Мария Сергеевна';

  const empMap = new Map<string, PackageEmployee1C>();
  const empKeyByPersonNorm = new Map<string, string>();
  const registerEmployee = (params: {
    fullName?: string;
    position?: string;
    hireDate?: string;
    salary?: number;
    costAccount?: string;
    childCount?: number;
    isSingleParent?: boolean;
    propertyDeductionAmount?: number;
    propertyDeductionDate?: string;
  }): string => {
    let rawName = (params.fullName || '').trim();
    let inferredPos = (params.position || '').trim();
    if (!rawName || /сотрудник\p{L}*\s+организац/iu.test(rawName)) return '';
    if (isRolePlaceholderNotFio(rawName)) {
      if (!inferredPos) {
        inferredPos = extractPositionFromPlaceholder(rawName);
      }
      if (/бухгалтер/iu.test(rawName) && resolvedChiefAccountantFio) {
        rawName = resolvedChiefAccountantFio;
      } else {
        return '';
      }
    }
    const cleanFio = normalizeRussianFioToNominative1C(rawName) || rawName;
    if (isRolePlaceholderNotFio(cleanFio)) return '';
    const pNorm = normalizePersonIdentityKey1C(cleanFio);
    if (!pNorm) return '';
    if (empKeyByPersonNorm.has(pNorm)) {
      const existingKey = empKeyByPersonNorm.get(pNorm)!;
      const ex = empMap.get(existingKey)!;
      if (params.salary && params.salary > 0) ex.salary = round2(params.salary);
      if (inferredPos && inferredPos !== 'Сотрудник штата') ex.position = inferredPos;
      if (params.costAccount) ex.costAccount = params.costAccount;
      if (typeof params.childCount === 'number' && params.childCount > ex.childCount) {
        ex.childCount = params.childCount;
      }
      if (params.isSingleParent) ex.isSingleParent = true;
      if (params.propertyDeductionAmount && params.propertyDeductionAmount > 0) {
        ex.propertyDeductionAmount = round2(params.propertyDeductionAmount);
        if (params.propertyDeductionDate) ex.propertyDeductionDate = params.propertyDeductionDate;
      }
      return existingKey;
    }

    const key = `emp_${shortDeterministicHash(pNorm)}`;
    empMap.set(key, {
      key,
      fullName: cleanFio,
      fio: cleanFio,
      position: inferredPos || 'Специалист',
      hireDate: params.hireDate || periodFrom,
      salary: round2(params.salary || 0),
      costAccount: params.costAccount || '26',
      childCount: params.childCount ?? 0,
      isSingleParent: Boolean(params.isSingleParent),
      propertyDeductionAmount: round2(params.propertyDeductionAmount || 0),
      propertyDeductionDate: params.propertyDeductionDate || '',
    });
    empKeyByPersonNorm.set(pNorm, key);
    return key;
  };

  if (db1C) {
    for (const dbEmp of db1C.employees) {
      registerEmployee({
        fullName: dbEmp.name,
      });
    }
    if (Array.isArray(db1C.rawDirectories?.['Сотрудники'])) {
      for (const rawEmp of db1C.rawDirectories['Сотрудники']) {
        if (rawEmp && typeof rawEmp === 'object') {
          const rec = rawEmp as Record<string, unknown>;
          const empName = String(
            rec['ФИО'] ?? rec['Наименование'] ?? rec['fullName'] ?? rec['name'] ?? ''
          ).trim();
          const pos = String(rec['Должность'] ?? rec['position'] ?? '').trim();
          const sal = Number(rec['Оклад'] ?? rec['salary'] ?? 0);
          if (empName) {
            registerEmployee({
              fullName: empName,
              position: pos || undefined,
              salary: sal > 0 ? sal : undefined,
            });
          }
        }
      }
    }
  }
  for (const vEmp of resolvedVirtualState.employees) {
    registerEmployee({
      fullName: vEmp.fullName,
      position: vEmp.position,
      hireDate: vEmp.hireDate,
      salary: vEmp.monthlySalary,
      costAccount: vEmp.costAccount || '26',
      childCount: vEmp.childCount ?? 0,
      isSingleParent: Boolean(vEmp.isSingleParent),
      propertyDeductionAmount: vEmp.propertyTaxDeduction ?? 0,
      propertyDeductionDate: vEmp.propertyTaxDeductionStartDate || '',
    });
  }

  // =========================================================================
  // 2. Chronological Document Sorting & Row/Entry Assembly
  // =========================================================================
  const indexedOps = activeOps.map((op, originalIndex) => ({
    op,
    originalIndex,
    phase: getIntraDaySortPhase(op),
  }));

  indexedOps.sort((a, b) => {
    const dateCmp = (a.op.date || '').localeCompare(b.op.date || '');
    if (dateCmp !== 0) return dateCmp;
    if (a.phase !== b.phase) return a.phase - b.phase;
    return a.originalIndex - b.originalIndex;
  });

  const documents: PackageDocument1C[] = [];

  // Running ledgers for 20.01 WIP by НоменклатурнаяГруппа and 10.* material stock by nomenclatureKey
  const wip20BalanceByGroup = new Map<string, { displayName: string; balance: number }>();
  const adjustWip20Balance = (rawGroup: string, delta: number) => {
    const cleanGrp = (rawGroup || '').split(/\s+\/\s+/)[0].trim() || 'Основная номенклатурная группа';
    const normGrp = normalizeSimpleEntityKey1C(cleanGrp) || 'основнаяноменклатурнаягруппа';
    const prev = wip20BalanceByGroup.get(normGrp) || { displayName: cleanGrp, balance: 0 };
    if (cleanGrp !== 'Основная номенклатурная группа') {
      prev.displayName = cleanGrp;
    }
    prev.balance = round2(Math.max(0, prev.balance + delta));
    wip20BalanceByGroup.set(normGrp, prev);
  };
  if (db1C?.rawBalances) {
    for (const bRow of db1C.rawBalances) {
      if (bRow.account === '20.01') {
        const dt = bRow.endDebit > 0 ? bRow.endDebit : bRow.rawDebit > 0 ? bRow.rawDebit : bRow.startDebit;
        const kt = bRow.endCredit > 0 ? bRow.endCredit : bRow.rawCredit > 0 ? bRow.rawCredit : bRow.startCredit;
        if (dt - kt > 0.005) {
          adjustWip20Balance(bRow.subconto || 'Основная номенклатурная группа', dt - kt);
        }
      }
    }
  }

  const stock10ByNomKey = new Map<
    string,
    { account: string; qty: number; netAmount: number; name: string }
  >();
  const recordStock10Receipt = (nomKey: string, name: string, account: string, qty: number, netAmt: number) => {
    if (!nomKey || !account.startsWith('10.')) return;
    const prev = stock10ByNomKey.get(nomKey) || {
      account,
      qty: 0,
      netAmount: 0,
      name,
    };
    prev.account = account;
    prev.qty = round2(prev.qty + (qty > 0 ? qty : 1));
    prev.netAmount = round2(prev.netAmount + Math.max(0, netAmt));
    stock10ByNomKey.set(nomKey, prev);
  };
  const recordStock10WriteOff = (nomKey: string, qty: number, netAmt: number) => {
    if (!nomKey) return;
    const prev = stock10ByNomKey.get(nomKey);
    if (!prev) return;
    prev.qty = round2(Math.max(0, prev.qty - (qty > 0 ? qty : 0)));
    prev.netAmount = round2(Math.max(0, prev.netAmount - Math.max(0, netAmt)));
  };

  const sanitizeClean1CComment = (raw: string): string =>
    (raw || '')
      .replace(/\[[A-Za-zА-Яа-яЁё0-9_-]+ID:[^\]]*\]/giu, '')
      .replace(/https?:\/\/\S+/giu, '')
      .replace(/\s+/g, ' ')
      .trim();

  indexedOps.forEach(({ op }, seqIdx) => {
    const { metaType1C, executionStrategy, operationKind1C } = resolveMetaTypeAndStrategy(op);
    const opDate = op.date || periodFrom;
    const quarter = deriveQuarterFromIsoDate(opDate);
    const documentId = `DOC-${reportingYear}-${String(seqIdx + 1).padStart(4, '0')}-${shortDeterministicHash(
      `${op.rowKey || op.id}|${opDate}|${op.category}|${op.description.slice(0, 80)}`
    )}`;

    let counterpartyKey =
      op.counterpartyName && op.counterpartyName.trim().length >= 2
        ? registerCounterparty({
            name: op.counterpartyName,
            inn: op.counterpartyInn,
            kpp: op.counterpartyKpp,
            kind: op.counterpartyKind,
          })
        : '';
    if (metaType1C === 'ИсполнительныйЛист' && !counterpartyKey && op.alimonyRecipientName) {
      counterpartyKey = registerCounterparty({
        name: op.alimonyRecipientName,
        inn: op.alimonyRecipientInn || '',
        kind: 'ФизическоеЛицо',
      });
    }
    if (!counterpartyKey && metaType1C === 'ОперацияБух') {
      const settlementPrefixes = ['76.', '60.', '62.', '58.', '66.', '67.'];
      for (const e of op.entries) {
        const dtTouches = settlementPrefixes.some((p) => e.debit === p.slice(0, -1) || e.debit.startsWith(p));
        const ktTouches = settlementPrefixes.some((p) => e.credit === p.slice(0, -1) || e.credit.startsWith(p));
        const rawSubCandidate = (dtTouches ? e.debitSubconto : ktTouches ? e.creditSubconto : '') || '';
        const firstPart = rawSubCandidate.split(/\s+\/\s+/)[0].trim();
        if (
          firstPart.length >= 3 &&
          !isGenericPlaceholderNomenclature1C(firstPart) &&
          !/^(прочи|расчет|процент|вексел|ценн|резерв|налог|штраф)/iu.test(firstPart)
        ) {
          counterpartyKey = registerCounterparty({ name: firstPart });
          if (counterpartyKey) break;
        }
      }
      if (
        !counterpartyKey &&
        resolvedVirtualState.financialInvestments &&
        resolvedVirtualState.financialInvestments.length > 0 &&
        op.entries.some(
          (e) =>
            e.debit.startsWith('58.') ||
            e.credit.startsWith('58.') ||
            ((e.debit === '76.09' || e.credit === '76.09' || e.debit === '76.03' || e.credit === '76.03') &&
              /вексел|процент|ценн\p{L}*\s+бумаг/iu.test(`${op.description || ''} ${e.description || ''}`))
        )
      ) {
        const secIssuer = (
          resolvedVirtualState.financialInvestments.find((fi) => (fi.counterpartyName || '').trim().length >= 3)
            ?.counterpartyName || ''
        ).trim();
        if (secIssuer.length >= 3) {
          counterpartyKey = registerCounterparty({ name: secIssuer });
        }
      }
    }

    const has60 = op.entries.some((e) => e.debit.startsWith('60') || e.credit.startsWith('60'));
    const has62 = op.entries.some((e) => e.debit.startsWith('62') || e.credit.startsWith('62'));
    const hasOtherSettlement = op.entries.some(
      (e) =>
        e.debit.startsWith('76.') ||
        e.credit.startsWith('76.') ||
        e.debit.startsWith('58.') ||
        e.credit.startsWith('58.') ||
        e.debit.startsWith('66.') ||
        e.credit.startsWith('66.') ||
        e.debit.startsWith('67.') ||
        e.credit.startsWith('67.')
    );

    const inferredCtrKind: 'СПоставщиком' | 'СПокупателем' | 'Прочее' =
      metaType1C === 'РеализацияТоваровУслуг' ||
      metaType1C === 'ПередачаОС' ||
      metaType1C === 'ВозвратТоваровОтПокупателя' ||
      metaType1C === 'СчетНаОплатуПокупателю' ||
      operationKind1C === 'ОплатаПокупателя' ||
      operationKind1C === 'ВозвратПокупателю' ||
      has62
        ? 'СПокупателем'
        : op.category === 'loan_received' ||
            op.category === 'loan_repaid' ||
            op.category === 'loan_issued' ||
            op.category === 'alimony_payout' ||
            (!has60 && hasOtherSettlement)
          ? 'Прочее'
          : 'СПоставщиком';

    const needsContractForManualOp =
      metaType1C === 'ОперацияБух' && (has60 || has62 || hasOtherSettlement);

    const contractKey =
      counterpartyKey &&
      (op.contractName || op.contractNumber || metaType1C !== 'ОперацияБух' || needsContractForManualOp)
        ? registerContract({
            counterpartyKey,
            name: op.contractName,
            number: op.contractNumber,
            date: op.contractDate || opDate,
            kind: inferredCtrKind,
          })
        : '';

    const isHrHireOrTransfer =
      metaType1C === 'ПриемНаРаботу' ||
      metaType1C === 'КадровыйПеревод' ||
      metaType1C === 'Увольнение';
    const rawEmpCandidate = (op.employeeName || '').trim();
    const effectiveEmployeePosition = (
      op.employeePosition ||
      extractPositionFromPlaceholder(rawEmpCandidate) ||
      (isHrHireOrTransfer && /главн\p{L}*\s+бухгалтер/iu.test(op.description || '')
        ? 'Главный бухгалтер'
        : '')
    ).trim();

    let effectiveEmployeeFio = '';
    if (rawEmpCandidate && !isRolePlaceholderNotFio(rawEmpCandidate)) {
      effectiveEmployeeFio = normalizeRussianFioToNominative1C(rawEmpCandidate) || rawEmpCandidate;
    } else if (
      (isHrHireOrTransfer ||
        metaType1C === 'АвансовыйОтчет' ||
        /бухгалтер/iu.test(rawEmpCandidate)) &&
      (metaType1C === 'АвансовыйОтчет' ||
        /бухгалтер/iu.test(`${rawEmpCandidate} ${effectiveEmployeePosition} ${op.description || ''}`)) &&
      resolvedChiefAccountantFio
    ) {
      effectiveEmployeeFio = resolvedChiefAccountantFio;
    }

    let effectiveMonthlySalary = round2(op.monthlySalary || 0);
    if (isHrHireOrTransfer && effectiveMonthlySalary <= 0) {
      const mSal = (op.description || '').match(/(?:оклад\p{L}*|зарплат\p{L}*|ставк\p{L}*)[^\d]{0,25}(\d[\d\s\u00A0]{2,10})/iu);
      if (mSal) {
        const parsedSal = Number(mSal[1].replace(/[\s\u00A0]/g, ''));
        if (Number.isFinite(parsedSal) && parsedSal > 0) {
          effectiveMonthlySalary = round2(parsedSal);
        }
      }
    }

    const employeeKey = effectiveEmployeeFio
      ? registerEmployee({
          fullName: effectiveEmployeeFio,
          position: effectiveEmployeePosition || op.employeePosition,
          hireDate: op.employeeHireStartDate || opDate,
          salary: effectiveMonthlySalary > 0 ? effectiveMonthlySalary : op.monthlySalary,
          costAccount: op.costAccount,
          childCount: op.employeeChildCount,
          isSingleParent: op.employeeIsSingleParent,
          propertyDeductionAmount: op.employeePropertyDeduction,
          propertyDeductionDate: op.employeePropertyDeduction ? opDate : '',
        })
      : '';

    if (isHrHireOrTransfer && effectiveMonthlySalary <= 0 && employeeKey) {
      effectiveMonthlySalary = round2(empMap.get(employeeKey)?.salary || 0);
    }

    const primaryEntry =
      metaType1C === 'ПередачаОС'
        ? op.entries.find((e) => e.debit.startsWith('62') || e.debit.startsWith('76')) || op.entries[0]
        : op.entries[0];
    const debitAccount =
      metaType1C === 'ПередачаОС'
        ? primaryEntry && (primaryEntry.debit.startsWith('62') || primaryEntry.debit.startsWith('76'))
          ? primaryEntry.debit
          : '62.01'
        : primaryEntry?.debit || op.costAccount || op.materialAccount || '';
    const creditAccount =
      metaType1C === 'ПередачаОС'
        ? primaryEntry && (primaryEntry.debit.startsWith('62') || primaryEntry.debit.startsWith('76'))
          ? primaryEntry.credit || '91.01'
          : '91.01'
        : primaryEntry?.credit || '';

    const isBuyerAdvanceReceipt =
      metaType1C === 'ПоступлениеНаРасчетныйСчет' &&
      op.entries.some((e) => e.credit === '62.02') &&
      (op.vatAmount > 0 || op.entries.some((e) => e.debit === '76.АВ' && e.credit === '68.02'));

    let invoiceSFKind: InvoiceSFKind1CPackage = 'none';
    if (isBuyerAdvanceReceipt) {
      invoiceSFKind = 'issued_advance';
    } else if (
      (metaType1C === 'РеализацияТоваровУслуг' || metaType1C === 'ПередачаОС') &&
      (op.hasInvoiceSF || op.vatAmount > 0)
    ) {
      invoiceSFKind = 'issued_sale';
    } else if (
      (metaType1C === 'ПоступлениеТоваровУслуг' || metaType1C === 'ПоступлениеДопРасходов') &&
      (op.hasInvoiceSF || op.vatAmount > 0)
    ) {
      invoiceSFKind = 'received';
    }

    const advanceVatEntry = op.entries.find((e) => e.debit === '76.АВ' && e.credit === '68.02');
    const docVatAmount = round2(
      op.vatAmount > 0 ? op.vatAmount : advanceVatEntry ? advanceVatEntry.amount : 0
    );
    const docVatRate = op.vatRate > 0 ? op.vatRate : docVatAmount > 0 ? 20 : 0;
    const vatIncluded = op.vatRule !== 'on_top';

    const isPaidImmediately = Boolean(
      (metaType1C === 'ПоступлениеТоваровУслуг' || metaType1C === 'ПоступлениеДопРасходов') &&
        (op.paidImmediatelyVia === 'bank_51' ||
          op.entries.some(
            (e) => (e.debit.startsWith('60') || e.debit.startsWith('76')) && e.credit === '51'
          ))
    );

    const dynamicBalanceMode = resolveDynamicBalanceMode(op, metaType1C, operationKind1C);
    const resolveWritPeriodDates = (): { start: string; end: string } => {
      const yr = opDate.slice(0, 4) || String(reportingYear);
      const desc = op.description || '';
      let start = op.writStartDate || '';
      if (!start) {
        const mFrom = desc.match(/(?:период\s+)?с\s+(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?=$|[^\d])/iu);
        if (mFrom) {
          const dd = String(Number(mFrom[1])).padStart(2, '0');
          const mm = String(Number(mFrom[2])).padStart(2, '0');
          const rawY = mFrom[3] ? (mFrom[3].length === 2 ? `20${mFrom[3]}` : mFrom[3]) : yr;
          start = `${rawY}-${mm}-${dd}`;
        }
      }
      let end = '';
      const mTo = desc.match(/(?:по|до)\s+(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?=$|[^\d])/iu);
      if (mTo) {
        const dd = String(Number(mTo[1])).padStart(2, '0');
        const mm = String(Number(mTo[2])).padStart(2, '0');
        const rawY = mTo[3] ? (mTo[3].length === 2 ? `20${mTo[3]}` : mTo[3]) : yr;
        end = `${rawY}-${mm}-${dd}`;
      } else if (/до\s+конца\s+года/iu.test(desc)) {
        end = `${yr}-12-31`;
      }
      const safeStart = !start || start < opDate ? opDate : start;
      const safeEnd = end && end < safeStart ? '' : end;
      return { start: safeStart, end: safeEnd };
    };
    const writPeriod = metaType1C === 'ИсполнительныйЛист' ? resolveWritPeriodDates() : null;
    const mShare =
      metaType1C === 'ИсполнительныйЛист'
        ? (op.description || '').match(/(?:^|[^\d/])(1\/4|1\/3|1\/2|1\/6|2\/3|3\/10)(?=$|[^\d/])/u)
        : null;
    const writFields =
      metaType1C === 'ИсполнительныйЛист' && writPeriod
        ? {
            writStartDate: writPeriod.start,
            writEndDate: writPeriod.end,
            alimonyFixedAmount: round2(op.alimonyFixedAmount || 0),
            alimonyRatePercent: round2(op.alimonyRatePercent || 0),
            ...(mShare ? { alimonyShare: mShare[1] } : {}),
          }
        : {};

    const header: PackageDocumentHeader1C = {
      counterpartyKey,
      contractKey,
      warehouseName: op.warehouseName?.trim() || 'Основной склад',
      employeeKey,
      ...(effectiveEmployeeFio ? { employeeName: effectiveEmployeeFio } : {}),
      ...(effectiveEmployeePosition ? { employeePosition: effectiveEmployeePosition } : {}),
      ...(effectiveMonthlySalary > 0 ? { monthlySalary: effectiveMonthlySalary } : {}),
      amount: round2(op.amount || primaryEntry?.amount || 0),
      vatRate: docVatRate,
      vatAmount: docVatAmount,
      vatIncluded,
      cashFlowItem: op.cashFlowItemName || '',
      creditAccount,
      debitAccount,
      operationKind1C,
      incomingNumber: op.incomingDocNumber || op.docNumber || '',
      incomingDate: op.incomingDocDate || opDate,
      registerInvoiceSF: invoiceSFKind !== 'none',
      invoiceSFKind,
      isPaidImmediately,
      paidAccount: isPaidImmediately ? '51' : '',
      ...(dynamicBalanceMode ? { dynamicBalanceMode } : {}),
      ...(metaType1C === 'ПринятиеКУчетуОС' && op.usefulLifeMonths && op.usefulLifeMonths > 0
        ? { usefulLifeMonths: op.usefulLifeMonths }
        : {}),
      ...writFields,
    };

    // Build rows for multi-item and single-item tabular documents
    const rows: PackageDocumentRow1C[] = [];
    const defaultNomGroup =
      (op.nomenclatureGroupName && op.nomenclatureGroupName.trim()) ||
      'Основная номенклатурная группа';
    const defaultExpenseItem = op.expenseItemName || 'Материальные расходы';

    if (metaType1C === 'НачислениеЗарплаты' && op.payrollStaffSummary && op.payrollStaffSummary.length > 0) {
      for (const staff of op.payrollStaffSummary) {
        if (staff.salary <= 0) continue;
        const rowEmpKey = registerEmployee({
          fullName: staff.name,
          position: staff.position,
          salary: staff.fullMonthlySalary ?? staff.salary,
          costAccount: staff.costAccount || '26',
        });
        rows.push({
          nomenclatureKey: '',
          nomenclatureName: 'Начисление по окладу',
          isService: false,
          quantity: 1,
          price: round2(staff.salary),
          amount: round2(staff.salary),
          vatRate: 0,
          vatAmount: 0,
          account: '70',
          vatAccount: '',
          costAccount: staff.costAccount || '26',
          nomenclatureGroup: staff.nomenclatureGroup || defaultNomGroup,
          expenseItem: 'Оплата труда',
          fixedAssetKey: '',
          employeeKey: rowEmpKey,
          deferredExpenseKey: '',
        });
      }
    } else if (metaType1C === 'ИнвентаризацияНЗП') {
      const mQuotedProj = (op.description || '').match(/объект\p{L}*\s+[«"']([^»"']+)[»"']/iu);
      let wipGroupName =
        (op.nomenclatureGroupName &&
        op.nomenclatureGroupName.trim() &&
        op.nomenclatureGroupName.trim() !== 'Основная номенклатурная группа'
          ? op.nomenclatureGroupName.trim()
          : '') ||
        (mQuotedProj ? mQuotedProj[1].trim() : '');
      if (!wipGroupName) {
        let bestGrp = '';
        let bestBal = 0;
        for (const gVal of wip20BalanceByGroup.values()) {
          if (gVal.balance > bestBal && gVal.displayName !== 'Основная номенклатурная группа') {
            bestBal = gVal.balance;
            bestGrp = gVal.displayName;
          }
        }
        if (!bestGrp) {
          for (const gVal of wip20BalanceByGroup.values()) {
            if (gVal.balance > bestBal) {
              bestBal = gVal.balance;
              bestGrp = gVal.displayName;
            }
          }
        }
        wipGroupName = bestGrp || defaultNomGroup;
      }
      const normTargetGrp = normalizeSimpleEntityKey1C(wipGroupName);
      const trackedWip = normTargetGrp ? wip20BalanceByGroup.get(normTargetGrp)?.balance ?? 0 : 0;
      let wipAmount = round2(op.amount && op.amount > 0 ? op.amount : trackedWip);
      if (wipAmount <= 0) {
        for (const gVal of wip20BalanceByGroup.values()) {
          if (gVal.balance > wipAmount) {
            wipAmount = round2(gVal.balance);
          }
        }
      }
      header.amount = wipAmount;
      header.debitAccount = '20.01';
      rows.push({
        nomenclatureKey: '',
        nomenclatureName: wipGroupName,
        isService: false,
        quantity: 1,
        price: wipAmount,
        amount: wipAmount,
        vatRate: 0,
        vatAmount: 0,
        account: '20.01',
        vatAccount: '',
        costAccount: '20.01',
        nomenclatureGroup: wipGroupName,
        expenseItem: 'Материальные расходы',
        fixedAssetKey: '',
        employeeKey: '',
        deferredExpenseKey: '',
      });
    } else if (
      metaType1C === 'ПринятиеКУчетуОС' ||
      metaType1C === 'ПередачаОС' ||
      metaType1C === 'СписаниеОС'
    ) {
      const osKey = registerFixedAsset({
        name: op.nomenclatureName || 'Основное средство',
        usefulLifeMonths: op.usefulLifeMonths,
        costAccount: op.costAccount || '20.01',
        expenseItem: op.expenseItemName || 'Амортизация',
      });
      const resolvedSpi =
        osMap.get(osKey)?.usefulLifeMonths ||
        (op.usefulLifeMonths && op.usefulLifeMonths > 0 ? op.usefulLifeMonths : 60);
      if (metaType1C === 'ПринятиеКУчетуОС' && !header.usefulLifeMonths) {
        header.usefulLifeMonths = resolvedSpi;
      }
      const osAmt = round2(op.depreciationBaseAmount || op.amount || primaryEntry?.amount || 0);
      rows.push({
        nomenclatureKey: '',
        nomenclatureName: op.nomenclatureName || 'Основное средство',
        isService: false,
        quantity: 1,
        price: osAmt,
        amount: osAmt,
        vatRate: metaType1C === 'ПередачаОС' ? docVatRate : 0,
        vatAmount: metaType1C === 'ПередачаОС' ? docVatAmount : 0,
        account: metaType1C === 'ПринятиеКУчетуОС' ? '01.01' : '01.09',
        vatAccount: metaType1C === 'ПередачаОС' ? '91.02' : '',
        costAccount:
          metaType1C === 'ПередачаОС' || metaType1C === 'СписаниеОС'
            ? '91.02'
            : op.costAccount || '20.01',
        nomenclatureGroup: defaultNomGroup,
        expenseItem: 'Амортизация',
        fixedAssetKey: osKey,
        employeeKey: '',
        deferredExpenseKey: '',
        ...(metaType1C === 'ПринятиеКУчетуОС' ? { usefulLifeMonths: resolvedSpi } : {}),
      });
    } else if (metaType1C === 'ПоступлениеДопРасходов') {
      const wantsEquipment08 =
        op.category === 'purchase_equipment' ||
        op.entries.some((e) => e.debit.startsWith('08.'));
      let matchedBatchDoc: PackageDocument1C | undefined;
      for (let dIdx = documents.length - 1; dIdx >= 0; dIdx--) {
        const prevDoc = documents[dIdx];
        if (prevDoc.metaType1C !== 'ПоступлениеТоваровУслуг' || prevDoc.rows.length === 0) {
          continue;
        }
        if (wantsEquipment08 && prevDoc.header.operationKind1C === 'Оборудование') {
          matchedBatchDoc = prevDoc;
          break;
        }
        if (!wantsEquipment08 && prevDoc.header.operationKind1C === 'Товары') {
          matchedBatchDoc = prevDoc;
          break;
        }
      }
      if (matchedBatchDoc) {
        for (const bRow of matchedBatchDoc.rows) {
          rows.push({
            nomenclatureKey: bRow.nomenclatureKey,
            nomenclatureName: bRow.nomenclatureName,
            isService: false,
            quantity: bRow.quantity > 0 ? bRow.quantity : 1,
            price: bRow.price,
            amount: bRow.amount,
            vatRate: docVatRate,
            vatAmount: 0,
            account: bRow.account || (wantsEquipment08 ? '08.04.1' : '10.01'),
            vatAccount: '19.04',
            costAccount: bRow.costAccount || '20.01',
            nomenclatureGroup: bRow.nomenclatureGroup || defaultNomGroup,
            expenseItem: defaultExpenseItem,
            fixedAssetKey: '',
            employeeKey: '',
            deferredExpenseKey: '',
          });
        }
      } else {
        const capEntries = op.entries.filter(
          (e) => e.debit.startsWith('08.') || e.debit.startsWith('10.') || e.debit.startsWith('41.')
        );
        for (const ce of capEntries) {
          const subClean = cleanNomenclatureName1C(
            (ce.debitSubconto || '').split(/\s+\/\s+/)[0].trim()
          );
          if (!subClean || isGenericPlaceholderNomenclature1C(subClean)) continue;
          const nomKey = registerNomenclature({
            rawName: subClean,
            descriptionCtx: op.description,
            account: ce.debit,
            isService: false,
            vatRate: docVatRate || 20,
          });
          if (!nomKey) continue;
          rows.push({
            nomenclatureKey: nomKey,
            nomenclatureName: nomMap.get(nomKey)?.name || subClean,
            isService: false,
            quantity: 1,
            price: round2(ce.amount),
            amount: round2(ce.amount),
            vatRate: docVatRate,
            vatAmount: 0,
            account: ce.debit,
            vatAccount: '19.04',
            costAccount: op.costAccount || '20.01',
            nomenclatureGroup: defaultNomGroup,
            expenseItem: defaultExpenseItem,
            fixedAssetKey: '',
            employeeKey: '',
            deferredExpenseKey: '',
          });
        }
      }
    } else if (metaType1C === 'ПередачаМатериаловВЭксплуатацию') {
      const mcEntries = op.entries.filter((e) => e.debit === 'МЦ.02' || e.debit === 'МЦ.04');
      const rawNomName = op.items?.[0]?.cleanName || op.nomenclatureName || 'Спецодежда';
      const nomKey = registerNomenclature({
        rawName: rawNomName,
        descriptionCtx: op.description,
        account: '10.10',
        vatRate: 20,
      });
      if (mcEntries.length > 0) {
        const totalQty = op.quantity && op.quantity >= mcEntries.length ? op.quantity : mcEntries.length;
        const perRowQty = Math.max(1, Math.round(totalQty / mcEntries.length));
        for (const mc of mcEntries) {
          const empSub = (mc.debitSubconto || '').split(/\s+\/\s+/)[0].trim();
          const rowEmpKey = registerEmployee({ fullName: empSub || op.employeeName });
          rows.push({
            nomenclatureKey: nomKey,
            nomenclatureName: nomMap.get(nomKey)?.name || rawNomName,
            isService: false,
            quantity: perRowQty,
            price: round2(mc.amount / perRowQty),
            amount: round2(mc.amount),
            vatRate: 0,
            vatAmount: 0,
            account: '10.10',
            vatAccount: '',
            costAccount: op.costAccount || '20.01',
            nomenclatureGroup: defaultNomGroup,
            expenseItem: defaultExpenseItem,
            fixedAssetKey: '',
            employeeKey: rowEmpKey,
            deferredExpenseKey: '',
          });
        }
      } else if (nomKey) {
        const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
        const amt = round2(op.amount || primaryEntry?.amount || 0);
        rows.push({
          nomenclatureKey: nomKey,
          nomenclatureName: nomMap.get(nomKey)?.name || rawNomName,
          isService: false,
          quantity: qty,
          price: round2(amt / qty),
          amount: amt,
          vatRate: 0,
          vatAmount: 0,
          account: '10.10',
          vatAccount: '',
          costAccount: op.costAccount || '20.01',
          nomenclatureGroup: defaultNomGroup,
          expenseItem: defaultExpenseItem,
          fixedAssetKey: '',
          employeeKey,
          deferredExpenseKey: '',
        });
      }
    } else if (
      executionStrategy === 'native' &&
      ((op.items && op.items.length > 0) ||
        ((metaType1C === 'ПоступлениеТоваровУслуг' ||
          metaType1C === 'ТребованиеНакладная' ||
          metaType1C === 'ОтчетПроизводстваЗаСмену') &&
          (op.entries.filter(
            (e) =>
              (metaType1C === 'ТребованиеНакладная' && e.credit.startsWith('10.')) ||
              (metaType1C === 'ПоступлениеТоваровУслуг' &&
                (e.debit.startsWith('10.') || e.debit.startsWith('41.') || e.debit.startsWith('08.'))) ||
              (metaType1C === 'ОтчетПроизводстваЗаСмену' && e.debit === '43')
          ).length >= 2 ||
            Boolean(
              operationKind1C !== 'Услуги' &&
                op.nomenclatureName &&
                op.nomenclatureName.includes(',')
            ))))
    ) {
      // Multi-item purchase, write-off, production output, or sale!
      const stockEntries = op.entries.filter(
        (e) =>
          (metaType1C === 'ТребованиеНакладная' && e.credit.startsWith('10.')) ||
          (metaType1C === 'ПоступлениеТоваровУслуг' &&
            (e.debit.startsWith('10.') || e.debit.startsWith('41.') || e.debit.startsWith('08.'))) ||
          (metaType1C === 'ОтчетПроизводстваЗаСмену' && e.debit === '43')
      );

      type EffectiveRowSeed = {
        cleanName: string;
        unit?: string;
        account?: string;
        quantity?: number;
        unitPrice?: number;
        netEntryAmount?: number;
      };

      let effectiveItems: EffectiveRowSeed[] = [];
      if (op.items && op.items.length > 0) {
        effectiveItems = op.items.map((it) => ({
          cleanName: it.cleanName,
          unit: it.unit,
          account: it.account,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        }));
      } else if (stockEntries.length >= 2) {
        effectiveItems = stockEntries
          .map((se) => {
            const rawSub = (
              metaType1C === 'ТребованиеНакладная' ? se.creditSubconto : se.debitSubconto
            )
              .split(/\s+\/\s+/)[0]
              .trim();
            const cleaned = cleanNomenclatureName1C(rawSub);
            const acc = metaType1C === 'ТребованиеНакладная' ? se.credit : se.debit;
            return {
              cleanName: cleaned || rawSub,
              account: acc,
              quantity: 1,
              netEntryAmount: se.amount,
            };
          })
          .filter((it) => it.cleanName && !isGenericPlaceholderNomenclature1C(it.cleanName));
      }

      if (effectiveItems.length === 0 && op.nomenclatureName && op.nomenclatureName.includes(',')) {
        const commaParts = op.nomenclatureName
          .split(',')
          .map((p) => cleanNomenclatureName1C(p.trim()))
          .filter((nm) => nm && !nm.includes(',') && !isGenericPlaceholderNomenclature1C(nm));
        if (commaParts.length >= 2) {
          effectiveItems = commaParts.map((nm) => ({
            cleanName: nm,
            account: op.materialAccount,
            quantity: 1,
          }));
        }
      }

      const useEqualSplitReconciliation =
        effectiveItems.length >= 2 &&
        effectiveItems.every((it) => !it.unitPrice && typeof it.netEntryAmount !== 'number');
      let remainingDocAmount = round2(op.amount || primaryEntry?.amount || 0);
      let remainingDocVat = docVatAmount;

      effectiveItems.forEach((it, idx) => {
        const isLastSeed = idx === effectiveItems.length - 1;
        const itemAcc =
          it.account ||
          (metaType1C === 'ТребованиеНакладная'
            ? stockEntries[idx]?.credit || op.materialAccount || '10.01'
            : metaType1C === 'ОтчетПроизводстваЗаСмену'
              ? '43'
              : stockEntries[idx]?.debit || op.materialAccount || '10.01');

        const nomKey = registerNomenclature({
          rawName: it.cleanName,
          descriptionCtx: op.description,
          unit: it.unit,
          account: itemAcc,
          isService: false,
          vatRate: docVatRate || 20,
        });
        if (!nomKey) return;

        // Match amount from corresponding entry by name or index
        const matchedEntry =
          typeof it.netEntryAmount === 'number'
            ? { amount: it.netEntryAmount }
            : (stockEntries.length === effectiveItems.length
                ? stockEntries.find((se) => {
                    const sub = `${se.debitSubconto} ${se.creditSubconto} ${se.description}`.toLowerCase();
                    return sub.includes(it.cleanName.toLowerCase());
                  }) ?? stockEntries[idx]
                : undefined);

        let qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
        let resolvedItemAcc = itemAcc;
        if (metaType1C === 'ТребованиеНакладная') {
          const trackedStock = stock10ByNomKey.get(nomKey);
          if (trackedStock && trackedStock.qty > 0) {
            if (trackedStock.account.startsWith('10.')) {
              resolvedItemAcc = trackedStock.account;
            }
            const targetNet = matchedEntry ? matchedEntry.amount : (op.amount || 0) / Math.max(1, effectiveItems.length);
            if (Math.abs(trackedStock.netAmount - targetNet) <= 5 || qty > trackedStock.qty) {
              qty = trackedStock.qty;
            } else if (!it.quantity && trackedStock.netAmount > 0 && trackedStock.qty > 1 && targetNet > 0) {
              qty = Math.max(1, Math.round((targetNet / trackedStock.netAmount) * trackedStock.qty));
            }
          }
        }
        let lineAmount = 0;
        let lineVat = 0;

        if (useEqualSplitReconciliation) {
          lineAmount = isLastSeed
            ? round2(Math.max(0, remainingDocAmount))
            : round2((op.amount || 0) / effectiveItems.length);
          remainingDocAmount = round2(remainingDocAmount - lineAmount);

          if (metaType1C === 'ПоступлениеТоваровУслуг' && docVatRate > 0) {
            lineVat = isLastSeed
              ? round2(Math.max(0, remainingDocVat))
              : vatIncluded
                ? round2((lineAmount * docVatRate) / (100 + docVatRate))
                : round2((lineAmount * docVatRate) / 100);
            remainingDocVat = round2(remainingDocVat - lineVat);
          }
        } else {
          const netOrGrossLine =
            it.unitPrice && it.unitPrice > 0
              ? round2(qty * it.unitPrice)
              : matchedEntry
                ? round2(matchedEntry.amount)
                : round2((op.amount || 0) / Math.max(1, effectiveItems.length));

          lineAmount = netOrGrossLine;
          if (metaType1C === 'ПоступлениеТоваровУслуг' && docVatRate > 0) {
            if (matchedEntry && !it.unitPrice && vatIncluded) {
              // matchedEntry on 10.* is net of VAT; reconstruct gross line when vatIncluded
              lineVat = round2((matchedEntry.amount * docVatRate) / 100);
              lineAmount = round2(matchedEntry.amount + lineVat);
            } else if (vatIncluded) {
              lineVat = round2((lineAmount * docVatRate) / (100 + docVatRate));
            } else {
              lineVat = round2((lineAmount * docVatRate) / 100);
            }
          }
        }

        const price = qty > 0 ? round2(lineAmount / qty) : lineAmount;
        const vatAcc =
          metaType1C === 'ПоступлениеТоваровУслуг'
            ? resolvedItemAcc.startsWith('08.')
              ? '19.01'
              : '19.03'
            : '';

        rows.push({
          nomenclatureKey: nomKey,
          nomenclatureName: nomMap.get(nomKey)?.name || it.cleanName,
          isService: false,
          quantity: qty,
          price,
          amount: lineAmount,
          vatRate: metaType1C === 'ПоступлениеТоваровУслуг' ? docVatRate : 0,
          vatAmount: lineVat,
          account: resolvedItemAcc,
          vatAccount: vatAcc,
          costAccount: op.costAccount || '20.01',
          nomenclatureGroup: defaultNomGroup,
          expenseItem: defaultExpenseItem,
          fixedAssetKey: '',
          employeeKey: '',
          deferredExpenseKey: '',
        });
      });
    }

    if (
      rows.length === 0 &&
      executionStrategy === 'native' &&
      (metaType1C === 'ПоступлениеТоваровУслуг' ||
        metaType1C === 'ПоступлениеДопРасходов' ||
        metaType1C === 'РеализацияТоваровУслуг' ||
        metaType1C === 'ТребованиеНакладная' ||
        metaType1C === 'ОтчетПроизводстваЗаСмену' ||
        metaType1C === 'АвансовыйОтчет' ||
        metaType1C === 'СчетНаОплатуПокупателю' ||
        metaType1C === 'ВозвратТоваровПоставщику' ||
        metaType1C === 'ВозвратТоваровОтПокупателя' ||
        metaType1C === 'СписаниеТоваров')
    ) {
      const isRpbPurchase =
        op.category === 'deferred_expense_97' || op.entries.some((e) => e.debit === '97.21');
      const isBuyerInvoiceSvc =
        metaType1C === 'СчетНаОплатуПокупателю' &&
        /(?:ремонт|работ|услуг|аренд|монтаж|отделк|строительн|благоустройств|устройств|кладк|покрыт)/iu.test(
          op.description || ''
        );
      const isSvcRow =
        operationKind1C === 'Услуги' ||
        metaType1C === 'ПоступлениеДопРасходов' ||
        (metaType1C === 'РеализацияТоваровУслуг' && operationKind1C === 'Услуги') ||
        isBuyerInvoiceSvc;

      const entrySubcontoItemHint = (() => {
        if (metaType1C === 'ТребованиеНакладная' || metaType1C === 'СписаниеТоваров' || metaType1C === 'ВозвратТоваровПоставщику') {
          const cr10 = op.entries.find((e) => e.credit.startsWith('10.') || e.credit.startsWith('41.'));
          const sub = (cr10?.creditSubconto || '').split(/\s+\/\s+/)[0].trim();
          return sanitizePackageNomenclatureName(sub, op.description);
        }
        if (metaType1C === 'АвансовыйОтчет' || metaType1C === 'ВозвратТоваровОтПокупателя') {
          const dt10 = op.entries.find((e) => e.debit.startsWith('10.') || e.debit.startsWith('41.'));
          const sub = (dt10?.debitSubconto || '').split(/\s+\/\s+/)[0].trim();
          return sanitizePackageNomenclatureName(sub, op.description);
        }
        return '';
      })();

      const lineAmt = round2(op.amount || primaryEntry?.amount || 0);
      let stockMatchedSeed: { key: string; account: string; qty: number; netAmount: number; name: string } | null = null;
      if (metaType1C === 'ТребованиеНакладная' && !op.nomenclatureName && !entrySubcontoItemHint) {
        const descLow = (op.description || '').toLowerCase();
        for (const [sKey, sVal] of stock10ByNomKey.entries()) {
          if (sVal.qty <= 0) continue;
          const stem = sVal.name.toLowerCase().slice(0, Math.max(4, Math.min(6, sVal.name.length)));
          if ((stem && descLow.includes(stem)) || (lineAmt > 0 && Math.abs(sVal.netAmount - lineAmt) <= 5)) {
            stockMatchedSeed = { key: sKey, ...sVal };
            break;
          }
        }
      }

      const fallbackItemLabel = isRpbPurchase
        ? op.nomenclatureName || 'Расходы будущих периодов'
        : isSvcRow
          ? sanitizePackageNomenclatureName(op.nomenclatureName, op.description) ||
            (metaType1C === 'СчетНаОплатуПокупателю' &&
            op.nomenclatureGroupName &&
            op.nomenclatureGroupName.trim() &&
            op.nomenclatureGroupName.trim() !== 'Основная номенклатурная группа'
              ? op.nomenclatureGroupName.trim()
              : metaType1C === 'РеализацияТоваровУслуг' || metaType1C === 'СчетНаОплатуПокупателю'
                ? 'Выполнение строительно-монтажных работ'
                : 'Услуги сторонних организаций')
          : sanitizePackageNomenclatureName(op.nomenclatureName, op.description) ||
            entrySubcontoItemHint ||
            stockMatchedSeed?.name ||
            (metaType1C === 'ТребованиеНакладная' || metaType1C === 'СписаниеТоваров'
              ? 'Основные материалы'
              : metaType1C === 'АвансовыйОтчет'
                ? 'Хозяйственные материалы'
                : metaType1C === 'СчетНаОплатуПокупателю' ||
                    metaType1C === 'ВозвратТоваровПоставщику' ||
                    metaType1C === 'ВозвратТоваровОтПокупателя'
                  ? 'Товары'
                  : '');

      let rowAccount = isRpbPurchase
        ? '97.21'
        : metaType1C === 'ОтчетПроизводстваЗаСмену'
          ? '43'
          : metaType1C === 'ТребованиеНакладная' || metaType1C === 'СписаниеТоваров'
            ? stockMatchedSeed?.account ||
              op.entries.find((e) => e.credit.startsWith('10.') || e.credit.startsWith('41.'))?.credit ||
              op.materialAccount ||
              '10.01'
            : metaType1C === 'ВозвратТоваровПоставщику' || metaType1C === 'ВозвратТоваровОтПокупателя'
              ? op.entries.find((e) => e.credit.startsWith('10.') || e.credit.startsWith('41.') || e.debit.startsWith('41.') || e.debit.startsWith('10.'))?.credit ||
                op.materialAccount ||
                '41.01'
              : metaType1C === 'РеализацияТоваровУслуг'
                ? isSvcRow
                  ? '90.01.1'
                  : op.entries.find((e) => e.credit === '43' || e.credit.startsWith('41'))?.credit || '43'
                : operationKind1C === 'Оборудование'
                  ? '08.04.1'
                  : isSvcRow
                    ? op.costAccount || op.entries.find((e) => ['20.01', '26', '44.01'].includes(e.debit))?.debit || '26'
                    : op.entries.find((e) => e.debit.startsWith('10.') || e.debit.startsWith('41.'))?.debit ||
                      op.materialAccount ||
                      '10.01';

      const nomKey =
        !isRpbPurchase && fallbackItemLabel
          ? stockMatchedSeed?.key ||
            registerNomenclature({
              rawName: fallbackItemLabel,
              descriptionCtx: op.description,
              account: rowAccount,
              isService: isSvcRow,
              vatRate: docVatRate,
            })
          : '';

      const rpbKey = isRpbPurchase
        ? registerDeferredExpense({
            name: fallbackItemLabel,
            totalAmount: round2((op.amount || 0) - docVatAmount),
            startDate: op.rpbStartDate || opDate,
            endDate: op.rpbEndDate,
            termMonths: op.rpbTermMonths || 12,
            writeOffMethod: op.rpbWriteOffMethod,
            costAccount: op.costAccount || '26',
            expenseItem: op.expenseItemName || 'Прочие расходы',
          })
        : '';

      let qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      if (metaType1C === 'ТребованиеНакладная' && nomKey) {
        const trackedStock = stock10ByNomKey.get(nomKey);
        if (trackedStock && trackedStock.qty > 0) {
          if (trackedStock.account.startsWith('10.')) {
            rowAccount = trackedStock.account;
          }
          if (Math.abs(trackedStock.netAmount - lineAmt) <= 5 || qty > trackedStock.qty) {
            qty = trackedStock.qty;
          }
        }
      }
      const price = qty > 0 ? round2(lineAmt / qty) : lineAmt;
      const vatAcc =
        metaType1C === 'ПоступлениеТоваровУслуг' || metaType1C === 'ПоступлениеДопРасходов' || metaType1C === 'АвансовыйОтчет'
          ? operationKind1C === 'Оборудование'
            ? '19.01'
            : isSvcRow
              ? '19.04'
              : '19.03'
          : metaType1C === 'РеализацияТоваровУслуг'
            ? '90.03'
            : '';

      rows.push({
        nomenclatureKey: nomKey,
        nomenclatureName: nomKey ? nomMap.get(nomKey)?.name || fallbackItemLabel : fallbackItemLabel,
        isService: isSvcRow,
        quantity: qty,
        price,
        amount: lineAmt,
        vatRate: docVatRate,
        vatAmount: docVatAmount,
        account: rowAccount,
        vatAccount: vatAcc,
        costAccount:
          metaType1C === 'РеализацияТоваровУслуг'
            ? '90.02.1'
            : isRpbPurchase
              ? '97.21'
              : op.costAccount || (isSvcRow ? rowAccount : '20.01'),
        nomenclatureGroup: defaultNomGroup,
        expenseItem: defaultExpenseItem,
        fixedAssetKey: '',
        employeeKey: metaType1C === 'АвансовыйОтчет' ? employeeKey : '',
        deferredExpenseKey: rpbKey,
      });
    }

    const entries: PackageAccountingEntry1C[] = op.entries.map((e) => ({
      debit: e.debit,
      credit: e.credit,
      amount: round2(e.amount),
      debitSubconto: e.debitSubconto || '',
      creditSubconto: e.creditSubconto || '',
      description: sanitizeClean1CComment(e.description || op.description || ''),
      nonDeductibleForProfitTax: Boolean(e.nonDeductibleForProfitTax),
    }));

    documents.push({
      documentId,
      date: opDate,
      docNumber: op.docNumber || String(seqIdx + 1),
      comment: sanitizeClean1CComment(op.description || ''),
      quarter,
      metaType1C,
      executionStrategy,
      ...(dynamicBalanceMode ? { dynamicBalanceMode } : {}),
      header,
      rows,
      entries,
    });

    // If a material purchase (ПоступлениеТоваровУслуг: Товары) also immediately transfers materials
    // into production/landscaping (Дт 20.01 / 26 / 44.01 Кт 10.*) in the same row (e.g. 02.09 lawn grass),
    // emit a paired native ТребованиеНакладная document on the same date so 1C posts both movements!
    const inlineWriteOffEntries =
      metaType1C === 'ПоступлениеТоваровУслуг' &&
      operationKind1C === 'Товары' &&
      !op.entries.some((e) => e.debit === 'МЦ.02' || e.debit === 'МЦ.04')
        ? op.entries.filter(
            (e) =>
              (e.debit === '20.01' || e.debit === '26' || e.debit === '44.01') &&
              e.credit.startsWith('10.')
          )
        : [];
    if (inlineWriteOffEntries.length > 0 && rows.length > 0) {
      const woPrimary = inlineWriteOffEntries[0];
      const woNomGroup =
        (woPrimary.debitSubconto || '').split(/\s+\/\s+/)[0].trim() || defaultNomGroup;
      const woTotalAmt = round2(inlineWriteOffEntries.reduce((s, e) => s + e.amount, 0));
      const woRows: PackageDocumentRow1C[] = rows.map((r) => {
        const netAmt = round2(r.amount - r.vatAmount > 0 ? r.amount - r.vatAmount : woTotalAmt);
        const qty = r.quantity > 0 ? r.quantity : 1;
        return {
          ...r,
          price: round2(netAmt / qty),
          amount: netAmt,
          vatRate: 0,
          vatAmount: 0,
          vatAccount: '',
          account: r.account.startsWith('10.') ? r.account : woPrimary.credit || '10.08',
          costAccount: woPrimary.debit || '20.01',
          nomenclatureGroup: woNomGroup,
        };
      });
      documents.push({
        documentId: `${documentId}_wo`,
        date: opDate,
        docNumber: `${op.docNumber || String(seqIdx + 1)}-С`,
        comment: sanitizeClean1CComment(woPrimary.description || op.description || ''),
        quarter,
        metaType1C: 'ТребованиеНакладная',
        executionStrategy: 'native',
        header: {
          counterpartyKey: '',
          contractKey: '',
          warehouseName: header.warehouseName,
          employeeKey: '',
          amount: woTotalAmt,
          vatRate: 0,
          vatAmount: 0,
          vatIncluded: false,
          cashFlowItem: '',
          creditAccount: woPrimary.credit || '10.08',
          debitAccount: woPrimary.debit || '20.01',
          operationKind1C: 'ИспользованиеМатериалов',
          incomingNumber: '',
          incomingDate: opDate,
          registerInvoiceSF: false,
          invoiceSFKind: 'none',
          isPaidImmediately: false,
          paidAccount: '',
        },
        rows: woRows,
        entries: inlineWriteOffEntries.map((e) => ({
          debit: e.debit,
          credit: e.credit,
          amount: round2(e.amount),
          debitSubconto: e.debitSubconto || '',
          creditSubconto: e.creditSubconto || '',
          description: sanitizeClean1CComment(e.description || op.description || ''),
          nonDeductibleForProfitTax: Boolean(e.nonDeductibleForProfitTax),
        })),
      });
      for (const wr of woRows) {
        recordStock10WriteOff(wr.nomenclatureKey, wr.quantity, wr.amount);
      }
    }

    // Update running 10.* stock and 20.01 WIP ledgers after emitting the document
    if (
      (metaType1C === 'ПоступлениеТоваровУслуг' && operationKind1C === 'Товары') ||
      metaType1C === 'АвансовыйОтчет'
    ) {
      for (const r of rows) {
        if (!r.isService && r.account.startsWith('10.')) {
          const net = round2(vatIncluded ? r.amount - r.vatAmount : r.amount);
          recordStock10Receipt(r.nomenclatureKey, r.nomenclatureName, r.account, r.quantity, net);
        }
      }
    } else if (metaType1C === 'ПоступлениеДопРасходов') {
      const addNet = round2(vatIncluded ? header.amount - header.vatAmount : header.amount);
      const baseSum = rows.reduce((s, r) => s + (r.amount || 0), 0);
      for (const r of rows) {
        if (r.account.startsWith('10.') && r.nomenclatureKey) {
          const share = baseSum > 0 ? round2((addNet * r.amount) / baseSum) : addNet;
          const prev = stock10ByNomKey.get(r.nomenclatureKey);
          if (prev) {
            prev.netAmount = round2(prev.netAmount + share);
          }
        }
      }
    } else if (metaType1C === 'ТребованиеНакладная' || metaType1C === 'СписаниеТоваров') {
      for (const r of rows) {
        recordStock10WriteOff(r.nomenclatureKey, r.quantity, r.amount);
      }
    }

    for (const e of op.entries) {
      if (e.debit === '20.01') {
        adjustWip20Balance(e.debitSubconto || defaultNomGroup, e.amount);
      }
      if (e.credit === '20.01') {
        adjustWip20Balance(e.creditSubconto || defaultNomGroup, -e.amount);
      }
    }
  });

  const effectiveLegacyPayroll =
    options?.calculationProfile === 'bp30_legacy_pre2023'
      ? true
      : options?.calculationProfile === 'rf_2026'
        ? Boolean(db1C?.usesLegacyPayrollAccounts)
        : Boolean(db1C?.usesLegacyPayrollAccounts);

  return {
    meta: {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      reportingYear,
      periodFrom,
      periodTo,
      totalDocuments: documents.length,
      ...(effectiveLegacyPayroll || typeof db1C?.usesLegacyPayrollAccounts === 'boolean'
        ? { usesLegacyPayrollAccounts: effectiveLegacyPayroll }
        : {}),
    },
    organization,
    catalogs: {
      counterparties: Array.from(cpMap.values()),
      contracts: Array.from(ctrMap.values()),
      warehouses: Array.from(warehouseSet).map((name) => ({ name })),
      nomenclature: Array.from(nomMap.values()),
      nomenclatureGroups: Array.from(nomGroupsSet),
      fixedAssets: Array.from(osMap.values()),
      deferredExpenses: Array.from(rpbMap.values()),
      employees: Array.from(empMap.values()),
    },
    documents,
  };
}

export function summarize1CPackageSections(pkg: TransferPackage1C): PackageSectionsSummary1C {
  const summary: PackageSectionsSummary1C = {
    purchases: 0,
    sales: 0,
    bankCash: 0,
    warehouse: 0,
    osNma: 0,
    hrPayroll: 0,
    manualOps: 0,
    reglamentIn1C: 0,
  };

  for (const doc of pkg.documents) {
    if (doc.executionStrategy === 'run_native_in_1c') {
      summary.reglamentIn1C += 1;
      continue;
    }
    if (doc.executionStrategy === 'manual_operation' || doc.metaType1C === 'ОперацияБух') {
      summary.manualOps += 1;
      continue;
    }
    switch (doc.metaType1C) {
      case 'ПоступлениеТоваровУслуг':
      case 'ПоступлениеДопРасходов':
      case 'ВозвратТоваровПоставщику':
      case 'АвансовыйОтчет':
        summary.purchases += 1;
        break;
      case 'РеализацияТоваровУслуг':
      case 'ВозвратТоваровОтПокупателя':
      case 'КорректировкаДолга':
      case 'СчетНаОплатуПокупателю':
        summary.sales += 1;
        break;
      case 'ПоступлениеНаРасчетныйСчет':
      case 'СписаниеСРасчетногоСчета':
      case 'ПоступлениеНаличных':
      case 'ВыдачаНаличных':
        summary.bankCash += 1;
        break;
      case 'ТребованиеНакладная':
      case 'СписаниеТоваров':
      case 'ПередачаМатериаловВЭксплуатацию':
      case 'ОтчетПроизводстваЗаСмену':
      case 'ИнвентаризацияНЗП':
        summary.warehouse += 1;
        break;
      case 'ПринятиеКУчетуОС':
      case 'ПередачаОС':
      case 'СписаниеОС':
        summary.osNma += 1;
        break;
      case 'ПриемНаРаботу':
      case 'КадровыйПеревод':
      case 'Увольнение':
      case 'ИсполнительныйЛист':
      case 'НачислениеЗарплаты':
        summary.hrPayroll += 1;
        break;
      default:
        summary.manualOps += 1;
        break;
    }
  }

  return summary;
}
