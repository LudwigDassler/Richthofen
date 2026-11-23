import { z } from 'zod';
import {
  DocType1CBP30,
  OperationCategory,
  Virtual1CStateSnapshot,
} from './accounting';
import {
  ALL_DOC_TYPES_1C,
  DOCUMENT_SPECS,
  OPERATION_CATEGORIES_LIST,
} from '@/lib/engine/documentSpecs1C';
import {
  cleanNomenclatureName1C,
  normalizeEmployeeOrFounderName1C,
  normalizeLegalEntityName1C,
} from '@/lib/engine/entityNormalizer1C';
import {
  extractKeywordStems1C,
  normalizeCounterpartyKey1C,
  stemsMatch1C,
} from '@/lib/engine/virtual1CState';

export const SEMANTIC_NOMENCLATURE_ACCOUNTS = [
  '10.01',
  '10.03',
  '10.08',
  '10.09',
  '10.10',
  '41.01',
  '43',
  '08.04.1',
  '97.21',
  'service',
] as const;

export type SemanticNomenclatureAccount = (typeof SEMANTIC_NOMENCLATURE_ACCOUNTS)[number];

export const SEMANTIC_AMOUNT_MODES = [
  'explicit_column',
  'qty_times_price',
  'settle_open_debt',
  'advance_percent',
  'full_stock_writeoff',
  'payroll_from_staff',
  'closing_auto',
  'non_posting',
] as const;

export type SemanticAmountMode = (typeof SEMANTIC_AMOUNT_MODES)[number];

export interface ParsedOperationIntent {
  rowIndex: number;
  category: OperationCategory;
  docType1C: DocType1CBP30;
  isNonPostingEvent: boolean;

  // Собственная организация и учредители (строго отделять от внешних контрагентов!)
  ownOrganization?: {
    canonicalName: string;
    inn?: string;
    kpp?: string;
  };
  founderShares?: Array<{
    founderName: string;
    sharePercent?: number;
    amount?: number;
  }>;

  // Внешний контрагент (в именительном падеже: ООО «Стабильность», Банк «Санкт-Петербург»)
  counterparty?: {
    canonicalName: string;
    inn?: string;
    kpp?: string;
    kind: 'legal' | 'individual' | 'tax_authority' | 'bank';
    role: 'supplier' | 'buyer' | 'founder' | 'lender' | 'other';
  };

  // Сотрудник / подотчётник / кадры / вычеты / алименты
  employee?: {
    fullName: string;
    position?: string;
    monthlySalary?: number;
    hireStartDate?: string;
    costAccount?: '20.01' | '26' | '44.01';
    nomenclatureGroup?: string;
    childDeductionCount?: number;
    isSingleParent?: boolean;
    propertyDeductionAmount?: number;
    alimony?: {
      recipientName: string;
      recipientInn?: string;
      sharePercent?: number;
      fixedAmount?: number;
      startDate?: string;
    };
  };

  // Номенклатура / объект ОС / работы / услуги (в именительном падеже без предлогов и контрагентов)
  nomenclature?: {
    canonicalName: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    account: SemanticNomenclatureAccount;
    nomenclatureGroup?: string;
  };

  // Намерение по сумме (БЕЗ вычисления сложных остатков самой LLM!)
  amountIntent: {
    mode: SemanticAmountMode;
    advancePercent?: number;
    orderTotalAmount?: number;
  };

  // Намерение по НДС
  vatIntent: {
    rule: 'included' | 'on_top' | 'exempt' | 'not_applicable';
    rate: 20 | 10 | 0;
  };

  // Расходы будущих периодов (счёт 97.21 — СРО, лицензии, ПО, страховки)
  rpbIntent?: {
    assetName: string;
    termMonths: number;
    costAccount: '26' | '20.01';
    settlementAccount: '76.09' | '60.01';
  };

  // Основные средства (08.04.1 -> 01.01 -> 01.09)
  osIntent?: {
    assetName: string;
    spiMonths?: number;
    costAccount: '20.01' | '26';
    isAdditionalCostToLastOs?: boolean;
  };

  // Финансовые вложения и векселя (58.02 / 76.09)
  billIntent?: {
    action: 'buy' | 'pay' | 'accrue_interest' | 'endorse_to_supplier';
    bills?: Array<{
      nominal: number;
      annualRatePercent: number;
    }>;
    interestDays?: number;
  };

  // Комбинированная операция в одной строке (например: «куплено и оплачено», «получено через подотчётника»)
  paidImmediately?: {
    enabled: boolean;
    via: 'bank_51' | 'cash_50' | 'accountable_71';
  };

  // Явные проводки из условия или подсказки преподавателя (если прямо указаны Дт/Кт)
  explicitEntries?: Array<{
    debit: string;
    credit: string;
    amount?: number;
    comment?: string;
  }>;

  // Краткое понятное пояснение для карточки студента (1-2 предложения)
  studentExplanation: string;
}

const VALID_CATEGORIES_SET = new Set<string>(OPERATION_CATEGORIES_LIST);
const VALID_DOC_TYPES_SET = new Set<string>(ALL_DOC_TYPES_1C);

export const ParsedOperationIntentSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  category: z.string().refine((val) => VALID_CATEGORIES_SET.has(val), {
    message: 'category must be a valid OperationCategory from DOCUMENT_SPECS',
  }) as z.ZodType<OperationCategory>,
  docType1C: z.string().refine((val) => VALID_DOC_TYPES_SET.has(val), {
    message: 'docType1C must be a valid DocType1CBP30 from ALL_DOC_TYPES_1C',
  }) as z.ZodType<DocType1CBP30>,
  isNonPostingEvent: z.boolean(),

  ownOrganization: z
    .object({
      canonicalName: z.string().min(1),
      inn: z.string().optional(),
      kpp: z.string().optional(),
    })
    .optional(),

  founderShares: z
    .array(
      z.object({
        founderName: z.string().min(1),
        sharePercent: z.number().nonnegative().max(100).optional(),
        amount: z.number().nonnegative().optional(),
      })
    )
    .optional(),

  counterparty: z
    .object({
      canonicalName: z.string().min(1),
      inn: z.string().optional(),
      kpp: z.string().optional(),
      kind: z.enum(['legal', 'individual', 'tax_authority', 'bank']),
      role: z.enum(['supplier', 'buyer', 'founder', 'lender', 'other']),
    })
    .optional(),

  employee: z
    .object({
      fullName: z.string().min(1),
      position: z.string().optional(),
      monthlySalary: z.number().nonnegative().optional(),
      hireStartDate: z.string().optional(),
      costAccount: z.enum(['20.01', '26', '44.01']).optional(),
      nomenclatureGroup: z.string().optional(),
      childDeductionCount: z.number().int().nonnegative().max(20).optional(),
      isSingleParent: z.boolean().optional(),
      propertyDeductionAmount: z.number().nonnegative().optional(),
      alimony: z
        .object({
          recipientName: z.string().min(1),
          recipientInn: z.string().optional(),
          sharePercent: z.number().nonnegative().max(100).optional(),
          fixedAmount: z.number().nonnegative().optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    })
    .optional(),

  nomenclature: z
    .object({
      canonicalName: z.string().min(1),
      quantity: z.number().nonnegative().optional(),
      unit: z.string().optional(),
      unitPrice: z.number().nonnegative().optional(),
      account: z.enum(SEMANTIC_NOMENCLATURE_ACCOUNTS),
      nomenclatureGroup: z.string().optional(),
    })
    .optional(),

  amountIntent: z.object({
    mode: z.enum(SEMANTIC_AMOUNT_MODES),
    advancePercent: z.number().min(0).max(100).optional(),
    orderTotalAmount: z.number().nonnegative().optional(),
  }),

  vatIntent: z.object({
    rule: z.enum(['included', 'on_top', 'exempt', 'not_applicable']),
    rate: z.union([z.literal(20), z.literal(10), z.literal(0)]),
  }),

  rpbIntent: z
    .object({
      assetName: z.string().min(1),
      termMonths: z.number().int().min(1).max(240),
      costAccount: z.enum(['26', '20.01']),
      settlementAccount: z.enum(['76.09', '60.01']),
    })
    .optional(),

  osIntent: z
    .object({
      assetName: z.string().min(1),
      spiMonths: z.number().int().min(1).max(1200).optional(),
      costAccount: z.enum(['20.01', '26']),
      isAdditionalCostToLastOs: z.boolean().optional(),
    })
    .optional(),

  billIntent: z
    .object({
      action: z.enum(['buy', 'pay', 'accrue_interest', 'endorse_to_supplier']),
      bills: z
        .array(
          z.object({
            nominal: z.number().positive(),
            annualRatePercent: z.number().min(0).max(100),
          })
        )
        .optional(),
      interestDays: z.number().int().min(1).max(3660).optional(),
    })
    .optional(),

  paidImmediately: z
    .object({
      enabled: z.boolean(),
      via: z.enum(['bank_51', 'cash_50', 'accountable_71']),
    })
    .optional(),

  explicitEntries: z
    .array(
      z.object({
        debit: z.string(),
        credit: z.string(),
        amount: z.number().nonnegative().optional(),
        comment: z.string().optional(),
      })
    )
    .optional(),

  studentExplanation: z.string().min(3),
});

export const ParsedBatchResponseSchema = z.object({
  intents: z.array(ParsedOperationIntentSchema),
});

export interface AiRawBatchRowInput {
  rowIndex: number;
  date: string;
  docNumber?: string;
  description: string;
  rawExcelAmount: number;
  actionSequenceHint?: string;
  counterpartyCell?: string;
}

export interface RollingAccountingContext1C {
  ownOrganization?: {
    name: string;
    inn: string;
    kpp?: string;
  };
  counterparties: Array<{
    canonicalName: string;
    inn: string;
    kpp?: string;
    roleHint?: string;
  }>;
  employees: Array<{
    fullName: string;
    position: string;
    monthlySalary: number;
    costAccount: '20.01' | '26' | '44.01';
    hireDate?: string;
  }>;
  openOrders: Array<{
    direction: 'buyer' | 'supplier';
    counterpartyName: string;
    subjectSummary: string;
    totalAmount: number;
    remainingAmount: number;
  }>;
  openSettlements: Array<{
    account: string;
    counterpartyName: string;
    subjectSummary: string;
    remainingAmount: number;
  }>;
  fixedAssets: Array<{
    name: string;
    status: string;
    initialCost: number;
    spiMonths: number;
  }>;
  financialBills: Array<{
    name: string;
    nominal: number;
    ratePercent?: number;
    status?: string;
  }>;
  deferredExpenses: Array<{
    name: string;
    totalAmount: number;
    remainingAmount: number;
    termMonths: number;
  }>;
  stockItems: string[];
}

export function buildRollingContextFromVirtualState(
  state: Virtual1CStateSnapshot
): RollingAccountingContext1C {
  return {
    ownOrganization: state.ownOrganization
      ? {
          name: state.ownOrganization.name,
          inn: state.ownOrganization.inn,
          kpp: state.ownOrganization.kpp,
        }
      : undefined,
    counterparties: state.counterparties.slice(-40).map((c) => ({
      canonicalName: c.name,
      inn: c.inn,
      kpp: c.kpp || undefined,
      roleHint: c.roleHint,
    })),
    employees: state.employees
      .filter((e) => e.isStaffEmployee || e.monthlySalary > 0)
      .map((e) => ({
        fullName: e.fullName,
        position: e.position,
        monthlySalary: e.monthlySalary,
        costAccount: e.costAccount || '26',
        hireDate: e.hireDate,
      })),
    openOrders: state.openOrders
      .filter((o) => o.status === 'open' && o.remainingAmount >= 0.01)
      .slice(-25)
      .map((o) => ({
        direction: o.direction,
        counterpartyName: o.counterpartyName,
        subjectSummary: o.subjectSummary.slice(0, 90),
        totalAmount: o.totalAmount,
        remainingAmount: o.remainingAmount,
      })),
    openSettlements: state.openSettlements
      .filter((s) => s.remainingAmount >= 0.01)
      .slice(-30)
      .map((s) => ({
        account: s.account,
        counterpartyName: s.counterpartyName,
        subjectSummary: s.subjectSummary.slice(0, 90),
        remainingAmount: s.remainingAmount,
      })),
    fixedAssets: state.fixedAssets.slice(-15).map((fa) => ({
      name: fa.name,
      status: fa.status,
      initialCost: fa.initialCost,
      spiMonths: fa.usefulLifeMonths,
    })),
    financialBills: state.financialInvestments
      .filter((f) => f.status !== 'disposed')
      .slice(-15)
      .map((f) => ({
        name: f.name,
        nominal: f.principalAmount ?? f.totalAmount,
        ratePercent: f.interestRatePercent,
        status: f.status,
      })),
    deferredExpenses: (state.deferredExpenses ?? []).slice(-10).map((d) => ({
      name: d.name,
      totalAmount: d.totalAmount,
      remainingAmount: d.remainingAmount,
      termMonths: d.termMonths,
    })),
    stockItems: state.nomenclature
      .filter((n) => n.itemKind !== 'Услуги')
      .slice(-35)
      .map((n) => n.name),
  };
}

/**
 * Extracts all contiguous 9..20 digit codes (INN, KPP, BIK, OGRN, bank accounts) from text
 * so Sanity Guard can block any hallucinated monetary field that equals a tax/bank code.
 */
function collectForbiddenRequisiteNumbers(row: AiRawBatchRowInput): Set<number> {
  const combined = `${row.description || ''} ${row.actionSequenceHint || ''} ${row.counterpartyCell || ''}`;
  const set = new Set<number>();
  for (const m of combined.matchAll(/(?<!\d)(\d{9,20})(?!\d)/g)) {
    const num = Number(m[1]);
    if (Number.isFinite(num) && num > 0) {
      set.add(num);
    }
  }
  return set;
}

function isSuspiciousRequisiteAsMoney(
  val: number | undefined,
  forbiddenCodes: Set<number>,
  rawExcelAmount: number
): boolean {
  if (val === undefined || val === null || val <= 0) return false;
  if (rawExcelAmount > 0 && Math.abs(val - rawExcelAmount) < 0.05) return false;
  const roundedInt = Math.round(val);
  if (forbiddenCodes.has(roundedInt)) return true;
  // Continuous 9..12 digit unspaced integer >= 100,000,000 not divisible by 1000 is virtually always INN/KPP/BIK
  if (
    Number.isInteger(val) &&
    val >= 100_000_000 &&
    val <= 999_999_999_999 &&
    val % 10_000 !== 0
  ) {
    return true;
  }
  return false;
}

function isCounterpartyGroundedInRowOrContext(
  cpName: string,
  row: AiRawBatchRowInput,
  rollingContext: RollingAccountingContext1C
): boolean {
  const normCp = normalizeCounterpartyKey1C(cpName);
  if (!normCp || normCp.length < 2) return false;

  const rowTextNorm = normalizeCounterpartyKey1C(
    `${row.description || ''} ${row.actionSequenceHint || ''} ${row.counterpartyCell || ''}`
  );
  if (rowTextNorm.includes(normCp)) return true;

  const cpStems = extractKeywordStems1C(cpName);
  const rowStems = extractKeywordStems1C(
    `${row.description || ''} ${row.actionSequenceHint || ''} ${row.counterpartyCell || ''}`
  );
  if (
    cpStems.length > 0 &&
    cpStems.some((cs) => rowStems.some((rs) => stemsMatch1C(cs, rs)))
  ) {
    return true;
  }

  // Generic institutional names grounded by keywords in text (ФНС / Банк / СРО)
  const descLower = `${row.description || ''} ${row.actionSequenceHint || ''}`.toLowerCase();
  if (/налог|бюджет|фнс|ифнс/u.test(descLower) && /фнс|налог/u.test(cpName.toLowerCase())) {
    return true;
  }
  if (/банк|вексел|кредит/u.test(descLower) && /банк/u.test(cpName.toLowerCase())) {
    return true;
  }

  // Grounded in rollingContext (known counterparties, open orders, or open settlements)
  const knownKeys = [
    ...rollingContext.counterparties.map((c) => normalizeCounterpartyKey1C(c.canonicalName)),
    ...rollingContext.openOrders.map((o) => normalizeCounterpartyKey1C(o.counterpartyName)),
    ...rollingContext.openSettlements.map((s) => normalizeCounterpartyKey1C(s.counterpartyName)),
  ].filter(Boolean);

  if (knownKeys.some((k) => k === normCp || k.includes(normCp) || normCp.includes(k))) {
    return true;
  }

  return false;
}

export interface SanityGuardValidationResult {
  ok: boolean;
  intent?: ParsedOperationIntent;
  warnings: string[];
  error?: string;
}

/**
 * Deterministic Sanity Guard on a single LLM-returned ParsedOperationIntent:
 * 1) Validates strict Zod schema (`category`, `docType1C`, nested structures).
 * 2) Blocks any 9..20-digit INN/KPP/BIK/account numbers from leaking into monetary fields.
 * 3) Blocks hallucinated counterparties not grounded in row text or `rollingContext` (Zero Fabrication).
 * 4) Prevents `ownOrganization` from being duplicated as external `counterparty`.
 * 5) Canonicalizes legal entity names, FIOs, and nomenclature names.
 */
export function sanitizeAndValidateOperationIntent(
  rawCandidate: unknown,
  row: AiRawBatchRowInput,
  rollingContext: RollingAccountingContext1C
): SanityGuardValidationResult {
  const parsed = ParsedOperationIntentSchema.safeParse(rawCandidate);
  if (!parsed.success) {
    const issueMsg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      warnings: [],
      error: issueMsg,
    };
  }

  const intent: ParsedOperationIntent = structuredClone(parsed.data);
  const warnings: string[] = [];
  const forbiddenNumbers = collectForbiddenRequisiteNumbers(row);

  // 1. Align docType1C if incompatible with DOCUMENT_SPECS[category]
  const spec = DOCUMENT_SPECS[intent.category];
  if (!spec) {
    return {
      ok: false,
      warnings,
      error: `Unknown category "${intent.category}"`,
    };
  }
  const allowedSpecialPairs =
    (intent.category === 'payroll_payout' &&
      (intent.docType1C === 'СписаниеСРасчетногоСчета' || intent.docType1C === 'ВыдачаНаличных')) ||
    (intent.category === 'accountable_issue' &&
      (intent.docType1C === 'ВыдачаНаличных' || intent.docType1C === 'СписаниеСРасчетногоСчета')) ||
    (intent.category === 'penalty_claim' &&
      (intent.docType1C === 'СписаниеСРасчетногоСчета' ||
        intent.docType1C === 'КорректировкаДолга' ||
        intent.docType1C === 'ОперацияБух')) ||
    (intent.category === 'deferred_expense_97' &&
      (intent.docType1C === 'ПоступлениеТоваровУслуг' ||
        intent.docType1C === 'СписаниеСРасчетногоСчета' ||
        intent.docType1C === 'ОперацияБух'));

  if (!allowedSpecialPairs && intent.docType1C !== spec.docType) {
    warnings.push(
      `docType1C aligned from ${intent.docType1C} to ${spec.docType} for category ${intent.category}`
    );
    intent.docType1C = spec.docType;
  }

  intent.isNonPostingEvent = Boolean(spec.allowsZeroPostings && intent.amountIntent.mode === 'non_posting') ||
    ['hr_hire', 'writ_of_execution', 'contract_event', 'policy_event', 'customer_invoice', 'supplier_invoice'].includes(
      intent.category
    );

  // 2. Numeric Sanity Guard against 9+ digit INN/KPP/BIK/OGRN/bank account numbers
  if (
    isSuspiciousRequisiteAsMoney(
      intent.amountIntent.orderTotalAmount,
      forbiddenNumbers,
      row.rawExcelAmount
    )
  ) {
    warnings.push(
      `Blocked suspicious 9+ digit requisite in orderTotalAmount (${intent.amountIntent.orderTotalAmount})`
    );
    intent.amountIntent.orderTotalAmount = undefined;
  }

  if (
    intent.nomenclature &&
    isSuspiciousRequisiteAsMoney(
      intent.nomenclature.unitPrice,
      forbiddenNumbers,
      row.rawExcelAmount
    )
  ) {
    warnings.push(
      `Blocked suspicious 9+ digit requisite in nomenclature.unitPrice (${intent.nomenclature.unitPrice})`
    );
    intent.nomenclature.unitPrice = undefined;
  }

  if (
    intent.employee &&
    isSuspiciousRequisiteAsMoney(
      intent.employee.monthlySalary,
      forbiddenNumbers,
      row.rawExcelAmount
    )
  ) {
    warnings.push(
      `Blocked suspicious 9+ digit requisite in employee.monthlySalary (${intent.employee.monthlySalary})`
    );
    intent.employee.monthlySalary = row.rawExcelAmount > 0 ? row.rawExcelAmount : undefined;
  }

  if (
    intent.employee &&
    isSuspiciousRequisiteAsMoney(
      intent.employee.propertyDeductionAmount,
      forbiddenNumbers,
      row.rawExcelAmount
    )
  ) {
    warnings.push(
      `Blocked suspicious 9+ digit requisite in employee.propertyDeductionAmount`
    );
    intent.employee.propertyDeductionAmount = undefined;
  }

  if (intent.billIntent?.bills) {
    const cleanBills = intent.billIntent.bills.filter(
      (b) => !isSuspiciousRequisiteAsMoney(b.nominal, forbiddenNumbers, row.rawExcelAmount)
    );
    if (cleanBills.length !== intent.billIntent.bills.length) {
      warnings.push('Stripped suspicious 9+ digit INN/KPP code from billIntent.bills nominal');
    }
    intent.billIntent.bills = cleanBills.length > 0 ? cleanBills : undefined;
  }

  if (intent.explicitEntries) {
    intent.explicitEntries = intent.explicitEntries.map((e) => {
      if (isSuspiciousRequisiteAsMoney(e.amount, forbiddenNumbers, row.rawExcelAmount)) {
        warnings.push(`Cleared suspicious 9+ digit requisite in explicitEntries amount (${e.amount})`);
        return { ...e, amount: undefined };
      }
      return e;
    });
  }

  // 3. Normalize ownOrganization & block ownOrganization from leaking into counterparty
  if (intent.ownOrganization) {
    intent.ownOrganization.canonicalName = normalizeLegalEntityName1C(
      intent.ownOrganization.canonicalName
    );
    if (intent.ownOrganization.inn) {
      intent.ownOrganization.inn = intent.ownOrganization.inn.replace(/\D/g, '');
    }
    if (intent.ownOrganization.kpp) {
      intent.ownOrganization.kpp = intent.ownOrganization.kpp.replace(/\D/g, '');
    }
  }

  const ownOrgKey = normalizeCounterpartyKey1C(
    intent.ownOrganization?.canonicalName || rollingContext.ownOrganization?.name || ''
  );

  if (intent.counterparty) {
    const rawCpName = intent.counterparty.canonicalName.trim();
    const normCp = normalizeCounterpartyKey1C(rawCpName);
    const isOwnOrg = Boolean(ownOrgKey && normCp && normCp === ownOrgKey);

    if (isOwnOrg || intent.category === 'charter_capital') {
      warnings.push(
        `Stripped ownOrganization "${rawCpName}" from external counterparty`
      );
      intent.counterparty = undefined;
    } else if (!isCounterpartyGroundedInRowOrContext(rawCpName, row, rollingContext)) {
      warnings.push(
        `Blocked ungrounded/fabricated counterparty "${rawCpName}" not present in row text or rollingContext`
      );
      intent.counterparty = undefined;
    } else {
      intent.counterparty.canonicalName =
        intent.counterparty.kind === 'individual'
          ? normalizeEmployeeOrFounderName1C(rawCpName)
          : normalizeLegalEntityName1C(rawCpName);
      if (intent.counterparty.inn) {
        const cleanInn = intent.counterparty.inn.replace(/\D/g, '');
        intent.counterparty.inn =
          cleanInn.length === 10 || cleanInn.length === 12 ? cleanInn : undefined;
      }
      if (intent.counterparty.kpp) {
        const cleanKpp = intent.counterparty.kpp.replace(/\D/g, '');
        intent.counterparty.kpp = cleanKpp.length === 9 ? cleanKpp : undefined;
      }
    }
  }

  // 4. Normalize employee & founders
  if (intent.employee) {
    intent.employee.fullName = normalizeEmployeeOrFounderName1C(intent.employee.fullName);
    if (intent.employee.alimony) {
      intent.employee.alimony.recipientName = normalizeEmployeeOrFounderName1C(
        intent.employee.alimony.recipientName
      );
      if (intent.employee.alimony.recipientInn) {
        const recInn = intent.employee.alimony.recipientInn.replace(/\D/g, '');
        intent.employee.alimony.recipientInn =
          recInn.length === 10 || recInn.length === 12 ? recInn : undefined;
      }
    }
  }

  if (intent.founderShares) {
    intent.founderShares = intent.founderShares.map((f) => ({
      ...f,
      founderName: normalizeEmployeeOrFounderName1C(f.founderName),
    }));
  }

  // 5. Normalize nomenclature
  if (intent.nomenclature) {
    const cleanedNom = cleanNomenclatureName1C(intent.nomenclature.canonicalName);
    intent.nomenclature.canonicalName = cleanedNom || intent.nomenclature.canonicalName.trim();
  }

  return {
    ok: true,
    intent,
    warnings,
  };
}
