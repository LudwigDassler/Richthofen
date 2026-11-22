import {
  Database1CSnapshot,
  OperationAmountMode,
  OperationCategory,
  QueuedOperation,
  ResolverSourceLink1C,
  Step01CalculationBreakdown1C,
  Virtual1CStateSnapshot,
  VirtualFinancialInvestment1C,
} from '@/types/accounting';
import {
  createInitialVirtual1CState,
  advanceVirtual1CStateWithOperation,
  extractFinancialNotesFromText1C,
  extractKeywordStems1C,
  extractRecurringContractTerms1C,
  formatRuDateShort,
  matchTargetActiveFinancialNote1C,
  normalizeCounterpartyKey1C,
  normalizePersonIdentityKey1C,
  resolveAlimonyPayable7641,
  resolveUnpaidSupplier6001ByKeywords,
  stemsMatch1C,
} from './virtual1CState';
import { calculateOsvReport } from './osvCalculator';
import { sanitizeBreakdown1C } from './textHygiene1C';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmtMoney(n: number): string {
  return `${round2(n).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const d1 = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const d2 = new Date(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 30;
  const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 30;
}

export interface UniversalAmountLinkResolutionInput {
  opId?: string;
  date: string;
  description: string;
  category: OperationCategory;
  explicitColumnAmount: number;
  textDerivedAmount?: number;
  quantity?: number;
  unitPrice?: number;
  vatRate: number;
  vatRule: 'included' | 'on_top' | 'none';
  counterpartyName?: string;
  counterpartyInn?: string;
  counterpartyKpp?: string;
  contractName?: string;
  nomenclatureName?: string;
  employeeName?: string;
  usefulLifeMonths?: number;
  db1C: Database1CSnapshot | null;
  priorOperations: QueuedOperation[];
  futureOperations?: QueuedOperation[];
  currentOpNumber?: number;
  virtualStateBefore?: Virtual1CStateSnapshot;
}

export interface PromissoryNoteInterestCalcItem {
  note: VirtualFinancialInvestment1C;
  principal: number;
  ratePercent: number;
  days: number;
  interestAmount: number;
  formulaLabel: string;
}

export interface UniversalAmountLinkResolutionResult {
  resolvedAmount: number;
  amountMode: OperationAmountMode;
  counterpartyName?: string;
  counterpartyInn?: string;
  counterpartyKpp?: string;
  contractName?: string;
  vatRate?: number;
  vatRule?: 'included' | 'on_top' | 'none';
  noteInterestItems?: PromissoryNoteInterestCalcItem[];
  disposedNote?: VirtualFinancialInvestment1C;
  disposedRemainingInterest?: number;
  step01Breakdown: Step01CalculationBreakdown1C;
}

const LEVEL_NAMES: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, string> = {
  1: 'Уровень 1 — Явная сумма из колонки Excel',
  2: 'Уровень 2 — Математический вывод из текста строки',
  3: 'Уровень 3 — Семантическая привязка к открытому долгу / авансу (60 / 62)',
  4: 'Уровень 4 — Рекуррентные / периодические договоры и операции',
  5: 'Уровень 5 — Погашение остатка по счёту учёта (68 / 69 / 70 / 76.41 / 08 / 10 / 41 / 43)',
  6: 'Уровень 6 — Расчёт по регистрам живой модели 1С (ФОТ, амортизация, % по векселям/займам)',
  7: 'Уровень 7 — Исторические аналоги из выгрузки базы 1С',
  8: 'Уровень 8 — Требуется уточнение внешней суммы (проверены все 7 источников контура)',
};

export function buildVirtualStateBeforeFromPriorOps(
  db1C: Database1CSnapshot | null,
  priorOperations: QueuedOperation[]
): Virtual1CStateSnapshot {
  let state = createInitialVirtual1CState(db1C);
  priorOperations.forEach((p, idx) => {
    state = advanceVirtual1CStateWithOperation(state, p, idx + 1);
  });
  return state;
}

/**
 * Universal 8-Level Amount & Link Resolver («Замкнутый контур учебного задания»).
 * Never gives up on an operation until all 7 derivation levels across Excel text,
 * chronological prior operations, Virtual 1C registers, and 1C database history are checked.
 */
export function resolveOperationAmountAndLinks(
  input: UniversalAmountLinkResolutionInput
): UniversalAmountLinkResolutionResult {
  const rawRes = resolveOperationAmountAndLinksCore(input);
  return {
    ...rawRes,
    step01Breakdown: sanitizeBreakdown1C(rawRes.step01Breakdown) ?? rawRes.step01Breakdown,
  };
}

function resolveOperationAmountAndLinksCore(
  input: UniversalAmountLinkResolutionInput
): UniversalAmountLinkResolutionResult {
  const stateBefore =
    input.virtualStateBefore ??
    buildVirtualStateBeforeFromPriorOps(input.db1C, input.priorOperations);
  const futureOps = (input.futureOperations ?? []).filter((f) => f.includeInProcessing !== false);
  const baseOpNumber = input.currentOpNumber ?? input.priorOperations.length + 1;

  const nonPostingCategories: OperationCategory[] = [
    'contract_event',
    'policy_event',
    'hr_hire',
    'writ_of_execution',
  ];
  if (nonPostingCategories.includes(input.category)) {
    return {
      resolvedAmount: round2(input.explicitColumnAmount || 0),
      amountMode: 'calculated_by_1c',
      step01Breakdown: {
        resolverLevel: 6,
        resolverLevelName:
          'Управленческое / кадровое / договорное событие (регистрация правил в базе 1С)',
        summaryFormula:
          '0,00 ₽ бухгалтерских проводок в момент регистрации (формирует нормативную базу для последующих операций)',
        steps: [
          'Событие регистрирует параметры договора, кадрового приказа, исполнительного листа или учётной политики в регистрах сведений 1С:БП 3.0.',
          'Бухгалтерские проводки (Дт/Кт) сформируются автоматически в дату фактического начисления, отгрузки или оплаты.',
        ],
        sourceLinks: [],
      },
    };
  }

  // Also resolve missing counterparty / contract link from Level 3 / Level 4 even when amount IS explicit!
  let linkedCpName = (input.counterpartyName || '').trim();
  let linkedCpInn = (input.counterpartyInn || '').trim();
  let linkedCpKpp = (input.counterpartyKpp || '').trim();
  let linkedContract = (input.contractName || '').trim();
  const extraLinks: ResolverSourceLink1C[] = [];

  if (!linkedCpName && (input.category === 'bank_out' || input.category === 'cash_out')) {
    const res6001 = resolveUnpaidSupplier6001ByKeywords(
      stateBefore,
      input.description,
      undefined,
      input.explicitColumnAmount > 0 ? input.explicitColumnAmount : undefined
    );
    if (res6001 && res6001.counterpartyName) {
      linkedCpName = res6001.counterpartyName;
      linkedCpInn = res6001.counterpartyInn || linkedCpInn;
      linkedCpKpp = res6001.counterpartyKpp || linkedCpKpp;
      linkedContract = res6001.contractName || linkedContract;
      for (const s of res6001.matchedSettlements) {
        extraLinks.push({
          opId: s.originOpId,
          opNumber: s.originOpNumber,
          date: s.originDate,
          label: s.originOpNumber
            ? `Операция #${s.originOpNumber} от ${formatRuDateShort(s.originDate)} (${s.counterpartyName})`
            : `Входящий остаток базы 1С (${s.counterpartyName})`,
        });
      }
    }
  }

  // Check buyer open advance 62.02 / receivable 62.01 when counterparty is missing on sale or bank_in
  if (
    !linkedCpName &&
    (input.category === 'sale_goods' ||
      input.category === 'sale_services' ||
      input.category === 'bank_in')
  ) {
    const targetAcc = input.category === 'bank_in' ? '62.01' : '62.02';
    const openBuyer = stateBefore.openSettlements.filter(
      (s) => s.account === targetAcc && s.remainingAmount >= 0.01 && s.counterpartyName
    );
    const qStems = extractKeywordStems1C(`${input.nomenclatureName || ''} ${input.description}`);
    const stemMatched = openBuyer.filter((s) =>
      s.keywordStems.some((ks) => qStems.some((qs) => stemsMatch1C(ks, qs)))
    );
    const chosen =
      stemMatched[0] || (openBuyer.length === 1 ? openBuyer[0] : undefined);
    if (chosen) {
      linkedCpName = chosen.counterpartyName;
      linkedCpInn = chosen.counterpartyInn || linkedCpInn;
      linkedCpKpp = chosen.counterpartyKpp || linkedCpKpp;
      linkedContract = chosen.contractName || linkedContract;
      extraLinks.push({
        opId: chosen.originOpId,
        opNumber: chosen.originOpNumber,
        date: chosen.originDate,
        label: chosen.originOpNumber
          ? `Операция #${chosen.originOpNumber} от ${formatRuDateShort(chosen.originDate)} (счёт ${targetAcc}, ${chosen.counterpartyName})`
          : `База 1С (счёт ${targetAcc}, ${chosen.counterpartyName})`,
      });
    }
  }

  // Forward counterparty lookahead (Invariant 4): if a receipt/shipment lacks counterparty on its own row,
  // check subsequent payment/closing operations in the closed task contour matching by substantive subject stems!
  if (
    !linkedCpName &&
    futureOps.length > 0 &&
    (input.category.startsWith('purchase_') ||
      input.category === 'intangible_acquisition' ||
      input.category === 'sale_goods' ||
      input.category === 'sale_services' ||
      input.category === 'bank_out' ||
      input.category === 'cash_out' ||
      input.category === 'bank_in' ||
      input.category === 'cash_in')
  ) {
    const isSupplierSide =
      input.category.startsWith('purchase_') ||
      input.category === 'intangible_acquisition' ||
      input.category === 'bank_out' ||
      input.category === 'cash_out';
    const GENERIC_FORWARD_STEMS = new Set([
      'производств',
      'работ',
      'услуг',
      'материал',
      'товар',
      'продукц',
      'основн',
      'средств',
      'передач',
      'оплат',
      'расчет',
      'объект',
      'ремонт',
      'строительн',
      'строительств',
      'помещен',
      'заказчик',
      'покупател',
      'поставщик',
      'начислен',
      'получен',
      'выполнен',
      'реализован',
      'отгружен',
      'поставлен',
      'готов',
      'накладн',
      'поступил',
      'передан',
      'списан',
      'приобретен',
      'оказан',
    ]);
    const qStemsForward = extractKeywordStems1C(
      `${input.nomenclatureName || ''} ${input.description}`
    ).filter((st) => !GENERIC_FORWARD_STEMS.has(st));

    if (qStemsForward.length > 0 || input.explicitColumnAmount >= 0.01) {
      for (let fIdx = 0; fIdx < futureOps.length; fIdx++) {
        const fut = futureOps[fIdx];
        if (!fut.counterpartyName) continue;
        const futCompatible = isSupplierSide
          ? fut.category === 'bank_out' ||
            fut.category === 'cash_out' ||
            fut.category.startsWith('purchase_') ||
            fut.category === 'advance_offset' ||
            fut.category === 'contract_event'
          : fut.category === 'bank_in' ||
            fut.category === 'cash_in' ||
            fut.category === 'sale_goods' ||
            fut.category === 'sale_services' ||
            fut.category === 'advance_offset' ||
            fut.category === 'contract_event';
        if (!futCompatible) continue;

        const futStems = extractKeywordStems1C(
          `${fut.nomenclatureName || ''} ${fut.description}`
        );
        const shared = qStemsForward.filter((qs) =>
          futStems.some((fs) => stemsMatch1C(qs, fs))
        );
        const exactAmountMatch =
          input.explicitColumnAmount >= 0.01 &&
          fut.amount >= 0.01 &&
          Math.abs(fut.amount - input.explicitColumnAmount) < 0.05;

        if (shared.length >= 1 || (exactAmountMatch && qStemsForward.length === 0)) {
          linkedCpName = fut.counterpartyName;
          linkedCpInn = fut.counterpartyInn || linkedCpInn;
          linkedCpKpp = fut.counterpartyKpp || linkedCpKpp;
          linkedContract = fut.contractName || linkedContract;
          const futOpNum = baseOpNumber + fIdx + 1;
          extraLinks.push({
            opId: fut.id,
            opNumber: futOpNum,
            date: fut.date,
            label: `Последующая операция #${futOpNum} от ${formatRuDateShort(fut.date)} (${fut.counterpartyName})`,
          });
          break;
        }
      }
    }
  }

  // ============================================================================
  // LEVEL 2 vs LEVEL 1 CHECK:
  // If quantity * unitPrice or multi-note sum or "+20% VAT on_top" derived the amount from text
  // while raw Excel column was empty (or equal to net before VAT on_top)
  // ============================================================================
  const parsedNotes = extractFinancialNotesFromText1C(input.description);
  if (
    input.category === 'financial_investment' &&
    parsedNotes.length >= 2 &&
    input.explicitColumnAmount < 0.01
  ) {
    const sumNotes = round2(parsedNotes.reduce((s, n) => s + n.principal, 0));
    const partsLabel = parsedNotes
      .map((n) => `${fmtMoney(n.principal)} (под ${n.ratePercent}%)`)
      .join(' + ');
    return {
      resolvedAmount: sumNotes,
      amountMode: 'explicit',
      counterpartyName: linkedCpName || undefined,
      counterpartyInn: linkedCpInn || undefined,
      counterpartyKpp: linkedCpKpp || undefined,
      contractName: linkedContract || undefined,
      vatRate: 0,
      vatRule: 'none',
      step01Breakdown: {
        resolverLevel: 2,
        resolverLevelName: LEVEL_NAMES[2],
        summaryFormula: `${partsLabel} = ${fmtMoney(sumNotes)} (без НДС, пп. 12 п. 2 ст. 149 НК РФ)`,
        steps: [
          `Из текста операции извлечены номиналы приобретённых ценных бумаг: ${partsLabel}.`,
          `Итоговая сумма финансовых вложений на счёте 58.02 = ${fmtMoney(sumNotes)}.`,
          'Операции с ценными бумагами (векселями, облигациями) не облагаются НДС согласно пп. 12 п. 2 ст. 149 НК РФ.',
        ],
        sourceLinks: extraLinks,
      },
    };
  }

  if (
    input.quantity &&
    input.quantity > 0 &&
    input.unitPrice &&
    input.unitPrice > 0 &&
    (input.explicitColumnAmount < 0.01 || input.vatRule === 'on_top')
  ) {
    const net = round2(input.quantity * input.unitPrice);
    const vat =
      input.vatRule === 'on_top' && input.vatRate > 0
        ? round2((net * input.vatRate) / 100)
        : input.vatRule === 'included' && input.vatRate > 0
          ? round2((net * input.vatRate) / (100 + input.vatRate))
          : 0;
    const total = input.vatRule === 'on_top' ? round2(net + vat) : net;
    const formula =
      input.vatRule === 'on_top' && input.vatRate > 0
        ? `${input.quantity} ед. × ${fmtMoney(input.unitPrice)} = ${fmtMoney(net)} (без НДС) + НДС ${input.vatRate}% (${fmtMoney(vat)}) = ${fmtMoney(total)}`
        : `${input.quantity} ед. × ${fmtMoney(input.unitPrice)} = ${fmtMoney(total)}${vat > 0 ? ` (в т.ч. НДС ${input.vatRate}%: ${fmtMoney(vat)})` : ' (без НДС)'}`;
    return {
      resolvedAmount: total,
      amountMode: 'explicit',
      counterpartyName: linkedCpName || undefined,
      counterpartyInn: linkedCpInn || undefined,
      counterpartyKpp: linkedCpKpp || undefined,
      contractName: linkedContract || undefined,
      step01Breakdown: {
        resolverLevel: 2,
        resolverLevelName: LEVEL_NAMES[2],
        summaryFormula: formula,
        steps: [
          `Количество из условия задачи: ${input.quantity}. Цена за единицу: ${fmtMoney(input.unitPrice)}.`,
          input.vatRule === 'on_top' && input.vatRate > 0
            ? `По правилу «по цене без НДС / +НДС сверху» (п. 1 ст. 168 НК РФ) НДС ${input.vatRate}% (${fmtMoney(vat)}) начисляется сверх стоимости партии (${fmtMoney(net)}).`
            : vat > 0
              ? `Расчётная ставка НДС ${input.vatRate}/${100 + input.vatRate}: ${fmtMoney(total)} × ${input.vatRate} / ${100 + input.vatRate} = ${fmtMoney(vat)}.`
              : 'Операция отражается без НДС.',
        ],
        sourceLinks: extraLinks,
      },
    };
  }

  // ============================================================================
  // LEVEL 1: Explicit amount from Excel column (or inline amount in text)
  // ============================================================================
  const explicitOrText =
    input.explicitColumnAmount >= 0.01
      ? input.explicitColumnAmount
      : (input.textDerivedAmount ?? 0) >= 0.01
        ? input.textDerivedAmount!
        : 0;

  if (explicitOrText >= 0.01) {
    const isLevel1 = input.explicitColumnAmount >= 0.01;
    const netOrTotal = round2(explicitOrText);
    const vat =
      input.vatRule === 'on_top' && input.vatRate > 0
        ? round2((netOrTotal * input.vatRate) / 100)
        : input.vatRule === 'included' && input.vatRate > 0
          ? round2((netOrTotal * input.vatRate) / (100 + input.vatRate))
          : 0;
    const finalTotal = input.vatRule === 'on_top' ? round2(netOrTotal + vat) : netOrTotal;
    const summaryFormula =
      input.vatRule === 'on_top' && vat > 0
        ? `${fmtMoney(netOrTotal)} (база без НДС) + ${fmtMoney(vat)} (НДС ${input.vatRate}%) = ${fmtMoney(finalTotal)}`
        : input.vatRule === 'included' && vat > 0
          ? `${fmtMoney(finalTotal)} (в т.ч. НДС ${input.vatRate}% = ${fmtMoney(finalTotal)} × ${input.vatRate}/${100 + input.vatRate} = ${fmtMoney(vat)}; база без НДС = ${fmtMoney(finalTotal - vat)})`
          : `${fmtMoney(finalTotal)} (без НДС)`;

    return {
      resolvedAmount: finalTotal,
      amountMode: 'explicit',
      counterpartyName: linkedCpName || undefined,
      counterpartyInn: linkedCpInn || undefined,
      counterpartyKpp: linkedCpKpp || undefined,
      contractName: linkedContract || undefined,
      step01Breakdown: {
        resolverLevel: isLevel1 ? 1 : 2,
        resolverLevelName: isLevel1 ? LEVEL_NAMES[1] : LEVEL_NAMES[2],
        summaryFormula,
        steps: [
          isLevel1
            ? `Сумма ${fmtMoney(netOrTotal)} прямо указана в колонке «Сумма» исходного файла задания.`
            : `Сумма ${fmtMoney(netOrTotal)} извлечена непосредственно из текста формулировки хозяйственной операции.`,
          vat > 0
            ? `Выделен / начислен НДС (${input.vatRate}%): ${fmtMoney(vat)}, чистая стоимость без НДС: ${fmtMoney(finalTotal - vat)}.`
            : 'Операция не облагается НДС (ставка Без НДС).',
        ],
        sourceLinks: extraLinks,
      },
    };
  }

  // ============================================================================
  // LEVEL 6 SPECIALIZED FORMULAS BEFORE GENERIC SETTLEMENT LOOKUP:
  // Financial interest accrual, Financial note disposal/endorsement, OS depreciation, OS commissioning
  // ============================================================================
  if (input.category === 'financial_interest_accrual') {
    const activeNotes = stateBefore.financialInvestments.filter(
      (f) => f.account === '58.02' && f.status !== 'disposed' && (f.interestRatePercent ?? 0) > 0
    );
    if (activeNotes.length > 0) {
      const mMonths = input.description.match(/за\s+(\d{1,2})\s*мес/iu);
      const explicitMonths = mMonths
        ? Number(mMonths[1])
        : /за\s+месяц|ежемесячн/iu.test(input.description)
          ? 1
          : /за\s+квартал/iu.test(input.description)
            ? 3
            : 0;
      const items: PromissoryNoteInterestCalcItem[] = activeNotes.map((note) => {
        const principal = note.principalAmount ?? note.totalAmount;
        const rate = note.interestRatePercent ?? 0;
        const fromDate = note.lastInterestDate || note.acquisitionDate || input.date;
        const days = daysBetweenIsoDates(fromDate, input.date);
        const useMonthsFormula = explicitMonths > 0;
        const interestAmount = useMonthsFormula
          ? round2((principal * (rate / 100) * explicitMonths) / 12)
          : round2((principal * (rate / 100) * days) / 365);
        const formulaLabel = useMonthsFormula
          ? `${note.name}: ${fmtMoney(principal)} × ${rate}% × ${explicitMonths} / 12 мес. = ${fmtMoney(interestAmount)}`
          : `${note.name}: ${fmtMoney(principal)} × ${rate}% × ${days} дн. / 365 = ${fmtMoney(interestAmount)}`;
        return {
          note,
          principal,
          ratePercent: rate,
          days,
          interestAmount,
          formulaLabel,
        };
      });
      const totalInterest = round2(items.reduce((s, it) => s + it.interestAmount, 0));
      const links: ResolverSourceLink1C[] = activeNotes.map((n) => ({
        opId: n.firstSeenOpId,
        opNumber: n.firstSeenOpNumber,
        date: n.firstSeenDate || n.acquisitionDate,
        label: n.firstSeenOpNumber
          ? `Операция #${n.firstSeenOpNumber} от ${formatRuDateShort(n.acquisitionDate)} (${n.name})`
          : n.name,
      }));
      return {
        resolvedAmount: totalInterest,
        amountMode: 'calculated_by_1c',
        vatRate: 0,
        vatRule: 'none',
        noteInterestItems: items,
        step01Breakdown: {
          resolverLevel: 6,
          resolverLevelName: LEVEL_NAMES[6],
          summaryFormula: `${items.map((i) => i.formulaLabel).join(' + ')} = ${fmtMoney(totalInterest)}`,
          steps: [
            ...items.map((i) => i.formulaLabel),
            `Учтены только действующие (не выбывшие на ${formatRuDateShort(input.date)}) ценные бумаги на счёте 58.02.`,
          ],
          sourceLinks: links,
        },
      };
    }
  }

  if (input.category === 'loan_interest_accrual') {
    const mMonths = input.description.match(/за\s+(\d{1,2})\s*мес/iu);
    const explicitMonths = mMonths
      ? Number(mMonths[1])
      : /за\s+месяц|ежемесячн/iu.test(input.description)
        ? 1
        : /за\s+квартал/iu.test(input.description)
          ? 3
          : 0;
    const cpNormLoan = normalizeCounterpartyKey1C(linkedCpName);

    // 1. Issued loans on 58.03 in Virtual 1C State (or prior loan_issued / loan_received operations)
    const activeLoans5803 = stateBefore.financialInvestments.filter(
      (f) =>
        f.account === '58.03' &&
        f.status !== 'disposed' &&
        (f.interestRatePercent ?? 0) > 0 &&
        (!cpNormLoan ||
          !f.counterpartyName ||
          normalizeCounterpartyKey1C(f.counterpartyName) === cpNormLoan)
    );

    if (activeLoans5803.length > 0) {
      const loan = activeLoans5803[activeLoans5803.length - 1];
      const principal = loan.principalAmount ?? loan.totalAmount;
      const rate = loan.interestRatePercent ?? 0;
      const fromDate = loan.lastInterestDate || loan.acquisitionDate || input.date;
      const days = daysBetweenIsoDates(fromDate, input.date);
      const interestAmt =
        explicitMonths > 0
          ? round2((principal * (rate / 100) * explicitMonths) / 12)
          : round2((principal * (rate / 100) * days) / 365);
      const formulaStr =
        explicitMonths > 0
          ? `${fmtMoney(principal)} × ${rate}% × ${explicitMonths} / 12 мес. = ${fmtMoney(interestAmt)}`
          : `${fmtMoney(principal)} × ${rate}% × ${days} дн. / 365 = ${fmtMoney(interestAmt)}`;

      return {
        resolvedAmount: interestAmt,
        amountMode: 'calculated_by_1c',
        counterpartyName: linkedCpName || loan.counterpartyName,
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 6,
          resolverLevelName: LEVEL_NAMES[6],
          summaryFormula: formulaStr,
          steps: [
            `Расчёт процентного дохода по предоставленному займу (счёт 58.03, ПБУ 19/02 и ПБУ 9/99): ${formulaStr}.`,
          ],
          sourceLinks: loan.firstSeenOpNumber
            ? [
                {
                  opId: loan.firstSeenOpId,
                  opNumber: loan.firstSeenOpNumber,
                  date: loan.firstSeenDate || loan.acquisitionDate,
                  label: `Выдача займа #${loan.firstSeenOpNumber} от ${formatRuDateShort(loan.acquisitionDate)} (${fmtMoney(principal)} под ${rate}%)`,
                },
              ]
            : [],
        },
      };
    }

    // 2. Fallback: scan prior loan_issued / loan_received operations for principal + rate
    for (let idx = input.priorOperations.length - 1; idx >= 0; idx--) {
      const prev = input.priorOperations[idx];
      if (
        (prev.category === 'loan_issued' || prev.category === 'loan_received') &&
        prev.amount >= 0.01 &&
        (prev.interestRatePercent ?? 0) > 0
      ) {
        if (cpNormLoan && normalizeCounterpartyKey1C(prev.counterpartyName) !== cpNormLoan) {
          continue;
        }
        const rate = prev.interestRatePercent!;
        // Incremental interest period: start from the last prior loan_interest_accrual for this loan (or loan receipt date)
        let startInterestDate = prev.date || input.date;
        for (let k = idx + 1; k < input.priorOperations.length; k++) {
          const mid = input.priorOperations[k];
          if (
            mid.includeInProcessing !== false &&
            mid.category === 'loan_interest_accrual' &&
            mid.date > startInterestDate &&
            mid.date < input.date
          ) {
            if (
              !cpNormLoan ||
              !mid.counterpartyName ||
              normalizeCounterpartyKey1C(mid.counterpartyName) === cpNormLoan
            ) {
              startInterestDate = mid.date;
            }
          }
        }
        const days = daysBetweenIsoDates(startInterestDate, input.date);
        const interestAmt =
          explicitMonths > 0
            ? round2((prev.amount * (rate / 100) * explicitMonths) / 12)
            : round2((prev.amount * (rate / 100) * days) / 365);
        const formulaStr =
          explicitMonths > 0
            ? `${fmtMoney(prev.amount)} × ${rate}% × ${explicitMonths} / 12 мес. = ${fmtMoney(interestAmt)}`
            : `${fmtMoney(prev.amount)} × ${rate}% × ${days} дн. / 365 = ${fmtMoney(interestAmt)}`;
        return {
          resolvedAmount: interestAmt,
          amountMode: 'calculated_by_1c',
          counterpartyName: linkedCpName || prev.counterpartyName,
          vatRate: 0,
          vatRule: 'none',
          step01Breakdown: {
            resolverLevel: 6,
            resolverLevelName: LEVEL_NAMES[6],
            summaryFormula: formulaStr,
            steps: [
              `Расчёт процентов по договору кредита / займа за период ${formatRuDateShort(startInterestDate)} — ${formatRuDateShort(input.date)} (${days} дн.): ${formulaStr}.`,
            ],
            sourceLinks: [
              {
                opId: prev.id,
                opNumber: idx + 1,
                date: prev.date,
                label: `Договор кредита / займа #${idx + 1} от ${formatRuDateShort(prev.date)} (${fmtMoney(prev.amount)} под ${rate}%)`,
              },
            ],
          },
        };
      }
    }
  }

  if (input.category === 'financial_disposal') {
    const targetNote = matchTargetActiveFinancialNote1C(stateBefore, input.description);
    if (targetNote) {
      const principal = targetNote.principalAmount ?? targetNote.totalAmount;
      const accruedAlready = targetNote.accruedInterestAmount || 0;
      const rate = targetNote.interestRatePercent || 0;
      const lastDate = targetNote.lastInterestDate || targetNote.acquisitionDate || input.date;
      const extraDays = lastDate < input.date ? daysBetweenIsoDates(lastDate, input.date) : 0;
      const mentionsInterestAccrual =
        /начислен\p{L}*.*(?:%%|процент|доход)|с\s+учетом\s+(?:%%|процент)|включая\s+(?:%%|процент)/iu.test(
          input.description
        );
      const extraInterest =
        rate > 0 && extraDays > 0 && mentionsInterestAccrual
          ? round2((principal * (rate / 100) * extraDays) / 365)
          : 0;
      const includeInterestInEndorsement =
        /с\s+учетом\s+(?:%%|процент)|включая\s+(?:%%|процент)/iu.test(input.description);
      // Check if endorsed to pay a specific supplier's open 60.01 debt
      const supplierDebt = linkedCpName
        ? resolveUnpaidSupplier6001ByKeywords(stateBefore, input.description, linkedCpName)
        : resolveUnpaidSupplier6001ByKeywords(stateBefore, input.description);
      const transferValue = includeInterestInEndorsement
        ? round2(principal + accruedAlready + extraInterest)
        : round2(principal);
      const links: ResolverSourceLink1C[] = [
        {
          opId: targetNote.firstSeenOpId,
          opNumber: targetNote.firstSeenOpNumber,
          date: targetNote.acquisitionDate,
          label: targetNote.firstSeenOpNumber
            ? `Покупка ценной бумаги #${targetNote.firstSeenOpNumber} (${targetNote.name})`
            : targetNote.name,
        },
      ];
      if (supplierDebt?.matchedSettlements[0]?.originOpNumber) {
        const ms = supplierDebt.matchedSettlements[0];
        links.push({
          opId: ms.originOpId,
          opNumber: ms.originOpNumber,
          date: ms.originDate,
          label: `Задолженность поставщику #${ms.originOpNumber} (${ms.counterpartyName})`,
        });
      }
      return {
        resolvedAmount: transferValue,
        amountMode: 'calculated_by_1c',
        counterpartyName: linkedCpName || supplierDebt?.counterpartyName || targetNote.counterpartyName,
        counterpartyInn: linkedCpInn || supplierDebt?.counterpartyInn,
        counterpartyKpp: linkedCpKpp || supplierDebt?.counterpartyKpp,
        vatRate: 0,
        vatRule: 'none',
        disposedNote: targetNote,
        disposedRemainingInterest: extraInterest,
        step01Breakdown: {
          resolverLevel: 6,
          resolverLevelName: LEVEL_NAMES[6],
          summaryFormula:
            extraInterest > 0
              ? `Номинал векселя ${fmtMoney(principal)}; доначислены %% за ${extraDays} дн. = ${fmtMoney(extraInterest)}`
              : `Учётная стоимость передаваемой ценной бумаги (${targetNote.name}) = ${fmtMoney(principal)}`,
          steps: [
            `Выбывает активная ценная бумага: ${targetNote.name} (номинал на счёте 58.02: ${fmtMoney(principal)}).`,
            extraInterest > 0
              ? `На дату выбытия начислен процентный доход за ${extraDays} дн.: ${fmtMoney(principal)} × ${rate}% × ${extraDays} / 365 = ${fmtMoney(extraInterest)} (Дт 76.09 Кт 91.01).`
              : accruedAlready > 0
                ? `Ранее накопленные проценты по бумаге на счёте 76.09: ${fmtMoney(accruedAlready)}.`
                : 'Дополнительных накопленных процентов на дату выбытия нет — зачёт по номиналу.',
            'После выбытия данная ценная бумага помечается закрытой в модели 1С и исключается из последующих начислений процентов.',
          ],
          sourceLinks: links,
        },
      };
    }
  }

  if (input.category === 'founder_contribution') {
    const founderKey = normalizePersonIdentityKey1C(
      linkedCpName || input.employeeName || input.description
    );
    const founderSurname = founderKey.split(/\s+/)[0] || '';
    let open7501 = 0;
    const links7501: ResolverSourceLink1C[] = [];

    input.priorOperations.forEach((p, idx) => {
      if (p.includeInProcessing === false) return;
      for (const e of p.entries) {
        const dtSubNorm = normalizePersonIdentityKey1C(
          e.debitSubconto || p.counterpartyName || p.employeeName || ''
        );
        const ktSubNorm = normalizePersonIdentityKey1C(
          e.creditSubconto || p.counterpartyName || p.employeeName || ''
        );
        if (e.debit === '75.01') {
          if (
            !founderSurname ||
            !dtSubNorm ||
            dtSubNorm.includes('учредител') ||
            dtSubNorm.includes(founderSurname)
          ) {
            open7501 = round2(open7501 + e.amount);
            links7501.push({
              opId: p.id,
              opNumber: idx + 1,
              date: p.date,
              label: `Формирование доли в УК #${idx + 1} от ${formatRuDateShort(p.date)} (+${fmtMoney(e.amount)})`,
            });
          }
        }
        if (e.credit === '75.01') {
          if (
            !founderSurname ||
            !ktSubNorm ||
            ktSubNorm.includes('учредител') ||
            ktSubNorm.includes(founderSurname)
          ) {
            open7501 = round2(open7501 - e.amount);
          }
        }
      }
    });

    if (open7501 < 0.01) {
      const osv75 = calculateOsvReport({
        db1C: input.db1C,
        operations: input.priorOperations,
        dateTo: input.date || undefined,
        includeQueuedOperations: true,
      });
      const row7501 = osv75.leafRows.find((r) => r.code === '75.01' && r.endDebit >= 0.01);
      if (row7501) {
        open7501 = round2(row7501.endDebit);
      }
    }

    if (open7501 >= 0.01) {
      return {
        resolvedAmount: open7501,
        amountMode: 'from_account_balance',
        counterpartyName: linkedCpName || input.employeeName || undefined,
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 5,
          resolverLevelName: LEVEL_NAMES[5],
          summaryFormula: `Задолженность учредителя по вкладу в уставный капитал (Дт 75.01) = ${fmtMoney(open7501)}`,
          steps: [
            `Сумма вклада учредителя определена по открытому дебетовому сальдо счёта 75.01 «Расчёты по вкладам в уставный (складочный) капитал» (${fmtMoney(open7501)}).`,
          ],
          sourceLinks: links7501,
        },
      };
    }
  }

  // ============================================================================
  // LEVEL 3: Semantic binding to open debt / advance from prior days (60 / 62)
  // ============================================================================
  if (
    input.category === 'bank_out' ||
    input.category === 'cash_out' ||
    input.category.startsWith('purchase_')
  ) {
    if (input.category === 'bank_out' || input.category === 'cash_out') {
      // Check payment for acquired promissory notes / securities (Дт 76.09 Кт 51)
      if (/за\s+(?:приобретен\p{L}*\s+|получен\p{L}*\s+)?(?:вексел|ценн\p{L}*\s+бумаг)/iu.test(input.description)) {
        for (let idx = input.priorOperations.length - 1; idx >= 0; idx--) {
          const prev = input.priorOperations[idx];
          if (
            prev.includeInProcessing !== false &&
            prev.category === 'financial_investment' &&
            prev.amount >= 0.01 &&
            prev.entries.some((e) => e.credit === '76.09')
          ) {
            return {
              resolvedAmount: round2(prev.amount),
              amountMode: 'from_related_doc',
              counterpartyName: linkedCpName || prev.counterpartyName,
              counterpartyInn: linkedCpInn || prev.counterpartyInn,
              counterpartyKpp: linkedCpKpp || prev.counterpartyKpp,
              contractName: linkedContract || prev.contractName,
              vatRate: 0,
              vatRule: 'none',
              step01Breakdown: {
                resolverLevel: 3,
                resolverLevelName: LEVEL_NAMES[3],
                summaryFormula: `Кредиторская задолженность за приобретённые ценные бумаги (Кт 76.09) = ${fmtMoney(prev.amount)}`,
                steps: [
                  `Найдена предшествующая операция приобретения ценных бумаг #${idx + 1} от ${formatRuDateShort(prev.date)} у «${prev.counterpartyName || 'продавца ЦБ'}» на сумму ${fmtMoney(prev.amount)} (счёт 76.09).`,
                ],
                sourceLinks: [
                  {
                    opId: prev.id,
                    opNumber: idx + 1,
                    date: prev.date,
                    label: `Приобретение ЦБ #${idx + 1} от ${formatRuDateShort(prev.date)} (${fmtMoney(prev.amount)})`,
                  },
                ],
              },
            };
          }
        }
      }

      // Check buyer advance refund ("возврат аванса покупателю / заказчику") from open 62.02!
      if (/возврат\p{L}*.*(?:аванс|предоплат)|возвращ\p{L}*.*(?:аванс|предоплат)/iu.test(input.description)) {
        const cpNormRef = normalizeCounterpartyKey1C(linkedCpName);
        const open6202 = stateBefore.openSettlements.filter(
          (s) =>
            s.account === '62.02' &&
            s.remainingAmount >= 0.01 &&
            (!cpNormRef || normalizeCounterpartyKey1C(s.counterpartyName) === cpNormRef)
        );
        if (open6202.length > 0) {
          const total6202 = round2(open6202.reduce((acc, s) => acc + s.remainingAmount, 0));
          const first = open6202[0];
          return {
            resolvedAmount: total6202,
            amountMode: 'from_related_doc',
            counterpartyName: linkedCpName || first.counterpartyName,
            counterpartyInn: linkedCpInn || first.counterpartyInn,
            counterpartyKpp: linkedCpKpp || first.counterpartyKpp,
            contractName: linkedContract || first.contractName,
            step01Breakdown: {
              resolverLevel: 3,
              resolverLevelName: LEVEL_NAMES[3],
              summaryFormula: `Незачтённый остаток аванса покупателя по Кт 62.02 = ${fmtMoney(total6202)}`,
              steps: [
                `Возврат остатка предоплаты покупателю «${first.counterpartyName}» по кредитовому сальдо счёта 62.02 (${fmtMoney(total6202)}).`,
              ],
              sourceLinks: open6202.map((s) => ({
                opId: s.originOpId,
                opNumber: s.originOpNumber,
                date: s.originDate,
                label: s.originOpNumber
                  ? `Аванс покупателя #${s.originOpNumber} от ${formatRuDateShort(s.originDate)} (${fmtMoney(s.remainingAmount)})`
                  : `База 1С (${s.counterpartyName})`,
              })),
            },
          };
        }
      }

      const unpaid = resolveUnpaidSupplier6001ByKeywords(
        stateBefore,
        input.description,
        linkedCpName || undefined
      );
      if (unpaid && unpaid.totalUnpaidAmount >= 0.01) {
        const links: ResolverSourceLink1C[] = unpaid.matchedSettlements.map((s) => ({
          opId: s.originOpId,
          opNumber: s.originOpNumber,
          date: s.originDate,
          label: s.originOpNumber
            ? `Операция #${s.originOpNumber} от ${formatRuDateShort(s.originDate)} (${s.counterpartyName}: ${fmtMoney(s.remainingAmount)})`
            : `Входящее сальдо 60.01 (${s.counterpartyName}: ${fmtMoney(s.remainingAmount)})`,
        }));
        return {
          resolvedAmount: unpaid.totalUnpaidAmount,
          amountMode: 'from_related_doc',
          counterpartyName: linkedCpName || unpaid.counterpartyName,
          counterpartyInn: linkedCpInn || unpaid.counterpartyInn,
          counterpartyKpp: linkedCpKpp || unpaid.counterpartyKpp,
          contractName: linkedContract || unpaid.contractName,
          step01Breakdown: {
            resolverLevel: 3,
            resolverLevelName: LEVEL_NAMES[3],
            summaryFormula:
              unpaid.matchedSettlements.length > 1
                ? `${unpaid.matchedSettlements.map((s) => fmtMoney(s.remainingAmount)).join(' + ')} = ${fmtMoney(unpaid.totalUnpaidAmount)} (остаток Кт 60.01)`
                : `Неоплаченный остаток по Кт 60.01 = ${fmtMoney(unpaid.totalUnpaidAmount)}`,
            steps: [
              unpaid.provenanceNote,
              `Платёж полностью закрывает кредиторскую задолженность перед «${linkedCpName || unpaid.counterpartyName}» по счёту 60.01.`,
            ],
            sourceLinks: links,
          },
        };
      }
    } else {
      // Purchase receipt after 100% supplier advance on 60.02!
      const cpNorm = normalizeCounterpartyKey1C(linkedCpName);
      const qStems = extractKeywordStems1C(`${input.nomenclatureName || ''} ${input.description}`);
      const open6002 = stateBefore.openSettlements.filter(
        (s) =>
          s.account === '60.02' &&
          s.remainingAmount >= 0.01 &&
          ((cpNorm && normalizeCounterpartyKey1C(s.counterpartyName) === cpNorm) ||
            (!cpNorm &&
              s.keywordStems.some((ks) => qStems.some((qs) => stemsMatch1C(ks, qs)))))
      );
      if (open6002.length > 0) {
        const chosen = open6002[0];
        return {
          resolvedAmount: chosen.remainingAmount,
          amountMode: 'from_related_doc',
          counterpartyName: linkedCpName || chosen.counterpartyName,
          counterpartyInn: linkedCpInn || chosen.counterpartyInn,
          counterpartyKpp: linkedCpKpp || chosen.counterpartyKpp,
          contractName: linkedContract || chosen.contractName,
          step01Breakdown: {
            resolverLevel: 3,
            resolverLevelName: LEVEL_NAMES[3],
            summaryFormula: `Сумма поступления = ранее выданный аванс по Дт 60.02 = ${fmtMoney(chosen.remainingAmount)}`,
            steps: [
              `Найдена предшествующая предоплата поставщику «${chosen.counterpartyName}» на счёте 60.02 (${fmtMoney(chosen.remainingAmount)}).`,
              'При проведении поступления 1С автоматически зачтёт аванс проводкой Дт 60.01 Кт 60.02.',
            ],
            sourceLinks: [
              {
                opId: chosen.originOpId,
                opNumber: chosen.originOpNumber,
                date: chosen.originDate,
                label: chosen.originOpNumber
                  ? `Аванс поставщику #${chosen.originOpNumber} от ${formatRuDateShort(chosen.originDate)}`
                  : `Входящий аванс 60.02 (${chosen.counterpartyName})`,
              },
            ],
          },
        };
      }
    }
  }

  if (input.category === 'employee_settlement_73' && /подар[ока]/iu.test(input.description)) {
    const osv41 = calculateOsvReport({
      db1C: input.db1C,
      operations: input.priorOperations,
      dateTo: input.date || undefined,
      includeQueuedOperations: true,
    });
    const row41 = osv41.leafRows.find((r) => r.code.startsWith('41.') && r.endDebit >= 0.01);
    if (row41) {
      return {
        resolvedAmount: round2(row41.endDebit),
        amountMode: 'from_stock_balance',
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 4,
          resolverLevelName: LEVEL_NAMES[4],
          summaryFormula: `Себестоимость подарков на счёте ${row41.code} (без НДС) = ${fmtMoney(row41.endDebit)}`,
          steps: [
            `Сумма списания подарков определена по остатку счёта ${row41.code} на дату вручения (${fmtMoney(row41.endDebit)}).`,
          ],
          sourceLinks: [],
        },
      };
    }
  }

  if (
    input.category === 'bank_in' ||
    input.category === 'cash_in' ||
    input.category === 'sale_goods' ||
    input.category === 'sale_services'
  ) {
    // Check receipt of accrued promissory-note / bank interest receivable on 76.09!
    if (
      input.category === 'bank_in' &&
      (/(?:%%|процент\p{L}*).*(?:от\s+банк|вексел|ценн\p{L}*\s+бумаг)/iu.test(input.description) ||
        /(?:от\s+банк\p{L}*|вексел|ценн\p{L}*\s+бумаг).*(?:%%|процент\p{L}*)/iu.test(input.description))
    ) {
      const osv7609 = calculateOsvReport({
        db1C: input.db1C,
        operations: input.priorOperations,
        dateTo: input.date || undefined,
        includeQueuedOperations: true,
      });
      const row7609 = osv7609.leafRows.find((r) => r.code === '76.09');
      const netDebit7609 = row7609 ? round2(row7609.endDebit - row7609.endCredit) : 0;
      const lastNoteOp = [...input.priorOperations]
        .reverse()
        .find((p) => p.category === 'financial_investment' && p.counterpartyName);
      if (netDebit7609 >= 0.01) {
        return {
          resolvedAmount: netDebit7609,
          amountMode: 'from_account_balance',
          counterpartyName: linkedCpName || lastNoteOp?.counterpartyName || 'Банк-эмитент',
          counterpartyInn: linkedCpInn || lastNoteOp?.counterpartyInn,
          counterpartyKpp: linkedCpKpp || lastNoteOp?.counterpartyKpp,
          vatRate: 0,
          vatRule: 'none',
          step01Breakdown: {
            resolverLevel: 5,
            resolverLevelName: LEVEL_NAMES[5],
            summaryFormula: `Дебиторская задолженность по начисленным процентам (Дт 76.09) = ${fmtMoney(netDebit7609)}`,
            steps: [
              `Поступление начисленных ранее процентов по векселям закрывает открытое дебетовое сальдо счёта 76.09 (${fmtMoney(netDebit7609)}).`,
            ],
            sourceLinks: [],
          },
        };
      }
    }

    // If bank_in is a 100% advance ("получена 100% предоплата / аванс") referencing a prior invoice/contract_event!
    if (
      (input.category === 'bank_in' || input.category === 'cash_in') &&
      /аванс|предоплат/iu.test(input.description)
    ) {
      const cpNormAdv = normalizeCounterpartyKey1C(linkedCpName);
      for (let idx = input.priorOperations.length - 1; idx >= 0; idx--) {
        const prev = input.priorOperations[idx];
        if (prev.includeInProcessing === false || prev.amount < 0.01) continue;
        if (
          prev.category === 'contract_event' &&
          cpNormAdv &&
          normalizeCounterpartyKey1C(prev.counterpartyName) === cpNormAdv
        ) {
          return {
            resolvedAmount: round2(prev.amount),
            amountMode: 'from_related_doc',
            counterpartyName: linkedCpName || prev.counterpartyName,
            counterpartyInn: linkedCpInn || prev.counterpartyInn,
            counterpartyKpp: linkedCpKpp || prev.counterpartyKpp,
            contractName: linkedContract || prev.contractName,
            step01Breakdown: {
              resolverLevel: 3,
              resolverLevelName: LEVEL_NAMES[3],
              summaryFormula: `100% предоплата по счёту / договору #${idx + 1} от ${formatRuDateShort(prev.date)} = ${fmtMoney(prev.amount)}`,
              steps: [
                `Найдена предшествующая запись о выставленном счёте / договоре с «${prev.counterpartyName}» на сумму ${fmtMoney(prev.amount)}.`,
              ],
              sourceLinks: [
                {
                  opId: prev.id,
                  opNumber: idx + 1,
                  date: prev.date,
                  label: `Счёт / договор #${idx + 1} от ${formatRuDateShort(prev.date)} (${fmtMoney(prev.amount)})`,
                },
              ],
            },
          };
        }
      }
    }

    const targetAcc =
      input.category === 'bank_in' || input.category === 'cash_in' ? '62.01' : '62.02';
    const cpNorm = normalizeCounterpartyKey1C(linkedCpName);
    const qStems = extractKeywordStems1C(`${input.nomenclatureName || ''} ${input.description}`);
    const openBuyer = stateBefore.openSettlements.filter(
      (s) =>
        s.account === targetAcc &&
        s.remainingAmount >= 0.01 &&
        ((cpNorm && normalizeCounterpartyKey1C(s.counterpartyName) === cpNorm) ||
          (!cpNorm &&
            s.keywordStems.some((ks) => qStems.some((qs) => stemsMatch1C(ks, qs)))))
    );
    if (openBuyer.length > 0) {
      const total = round2(openBuyer.reduce((acc, s) => acc + s.remainingAmount, 0));
      const first = openBuyer[0];
      return {
        resolvedAmount: total,
        amountMode: 'from_related_doc',
        counterpartyName: linkedCpName || first.counterpartyName,
        counterpartyInn: linkedCpInn || first.counterpartyInn,
        counterpartyKpp: linkedCpKpp || first.counterpartyKpp,
        contractName: linkedContract || first.contractName,
        step01Breakdown: {
          resolverLevel: 3,
          resolverLevelName: LEVEL_NAMES[3],
          summaryFormula: `Сумма по открытому расчёту с покупателем (счёт ${targetAcc}) = ${fmtMoney(total)}`,
          steps: [
            targetAcc === '62.01'
              ? `Покупатель «${first.counterpartyName}» погашает дебиторскую задолженность за ранее отгруженную продукцию / ОС / услуги по счёту 62.01 (${fmtMoney(total)}).`
              : `Отгрузка выполняется в счёт полученной ранее предоплаты от «${first.counterpartyName}» на счёте 62.02 (${fmtMoney(total)}).`,
          ],
          sourceLinks: openBuyer.map((s) => ({
            opId: s.originOpId,
            opNumber: s.originOpNumber,
            date: s.originDate,
            label: s.originOpNumber
              ? `Операция #${s.originOpNumber} от ${formatRuDateShort(s.originDate)} (${s.counterpartyName})`
              : `База 1С (${s.counterpartyName})`,
          })),
        },
      };
    }
  }

  // ============================================================================
  // LEVEL 3B (Bidirectional Forward Lookahead — Invariant 4):
  // Unpriced receipt / shipment / advance resolved from subsequent post-payment or closing act!
  // ============================================================================
  if (
    futureOps.length > 0 &&
    (input.category.startsWith('purchase_') ||
      input.category === 'intangible_acquisition' ||
      input.category === 'sale_goods' ||
      input.category === 'sale_services' ||
      input.category === 'bank_out' ||
      input.category === 'cash_out' ||
      input.category === 'bank_in' ||
      input.category === 'cash_in')
  ) {
    const isSupplierFlow =
      input.category.startsWith('purchase_') ||
      input.category === 'intangible_acquisition' ||
      input.category === 'bank_out' ||
      input.category === 'cash_out';
    const isPaymentLookingForFutureAct =
      input.category === 'bank_out' ||
      input.category === 'cash_out' ||
      input.category === 'bank_in' ||
      input.category === 'cash_in';

    const GENERIC_FWD_3B = new Set([
      'производств',
      'работ',
      'услуг',
      'материал',
      'товар',
      'продукц',
      'основн',
      'средств',
      'передач',
      'оплат',
      'расчет',
      'объект',
      'ремонт',
      'строительн',
      'строительств',
      'помещен',
      'заказчик',
      'покупател',
      'поставщик',
    ]);
    const cpNormFwd = normalizeCounterpartyKey1C(linkedCpName);
    const qStemsFwd = extractKeywordStems1C(
      `${input.nomenclatureName || ''} ${input.description}`
    ).filter((st) => !GENERIC_FWD_3B.has(st));

    const candidateFutureMatches: Array<{ fut: QueuedOperation; futNum: number; sharedCount: number }> = [];
    for (let fIdx = 0; fIdx < futureOps.length; fIdx++) {
      const fut = futureOps[fIdx];
      if (fut.amount < 0.01) continue;

      const validOppositeKind = isPaymentLookingForFutureAct
        ? isSupplierFlow
          ? fut.category.startsWith('purchase_') || fut.category === 'intangible_acquisition'
          : fut.category === 'sale_goods' || fut.category === 'sale_services'
        : isSupplierFlow
          ? fut.category === 'bank_out' || fut.category === 'cash_out'
          : fut.category === 'bank_in' || fut.category === 'cash_in';
      if (!validOppositeKind) continue;

      const futCpNorm = normalizeCounterpartyKey1C(fut.counterpartyName);
      if (cpNormFwd && futCpNorm && cpNormFwd !== futCpNorm) continue;

      const futStems = extractKeywordStems1C(
        `${fut.nomenclatureName || ''} ${fut.description}`
      );
      const shared = qStemsFwd.filter((qs) => futStems.some((fs) => stemsMatch1C(qs, fs)));

      if ((cpNormFwd && cpNormFwd === futCpNorm) || shared.length >= 1) {
        candidateFutureMatches.push({
          fut,
          futNum: baseOpNumber + fIdx + 1,
          sharedCount: shared.length,
        });
      }
    }

    if (candidateFutureMatches.length > 0) {
      // Prefer candidate with strongest stem overlap, then earliest chronological settlement
      candidateFutureMatches.sort((a, b) =>
        b.sharedCount !== a.sharedCount ? b.sharedCount - a.sharedCount : a.futNum - b.futNum
      );
      const best = candidateFutureMatches[0];
      const fut = best.fut;
      return {
        resolvedAmount: round2(fut.amount),
        amountMode: 'from_related_doc',
        counterpartyName: linkedCpName || fut.counterpartyName || undefined,
        counterpartyInn: linkedCpInn || fut.counterpartyInn || undefined,
        counterpartyKpp: linkedCpKpp || fut.counterpartyKpp || undefined,
        contractName: linkedContract || fut.contractName || undefined,
        step01Breakdown: {
          resolverLevel: 3,
          resolverLevelName: `${LEVEL_NAMES[3]} (двунаправленная увязка с последующей оплатой)`,
          summaryFormula: `Сумма определена по связанной последующей операции #${best.futNum} от ${formatRuDateShort(fut.date)} = ${fmtMoney(fut.amount)}`,
          steps: [
            `В текущей строке сумма не была указана явно, но в рамках замкнутого контура найдена закрывающая операция #${best.futNum} от ${formatRuDateShort(fut.date)} («${fut.description}») на сумму ${fmtMoney(fut.amount)}.`,
            `Контрагент и сумма синхронизированы для полного закрытия расчётов на счёте ${isSupplierFlow ? '60' : '62'}.`,
          ],
          sourceLinks: [
            {
              opId: fut.id,
              opNumber: best.futNum,
              date: fut.date,
              label: `Последующая операция #${best.futNum} от ${formatRuDateShort(fut.date)} (${fmtMoney(fut.amount)})`,
            },
          ],
        },
      };
    }
  }

  // ============================================================================
  // LEVEL 4: Recurring / periodic operations (lease/rent, telecom, registered contracts)
  // ============================================================================
  const isRecurringEligibleCategory = [
    'purchase_services',
    'sale_services',
    'bank_out',
    'cash_out',
    'bank_in',
    'cash_in',
    'bank_fee',
  ].includes(input.category);

  if (isRecurringEligibleCategory) {
    const cpNormForRec = normalizeCounterpartyKey1C(linkedCpName);
    const qStemsRec = extractKeywordStems1C(input.description);
    const recurringContracts = stateBefore.contracts.filter(
      (c) => (c.periodicAmount ?? 0) >= 0.01
    );
    const matchedRecContract =
      recurringContracts.find(
        (c) => cpNormForRec && normalizeCounterpartyKey1C(c.counterpartyName) === cpNormForRec
      ) ||
      recurringContracts.find((c) =>
        (c.keywordStems ?? []).some((ks) => qStemsRec.some((qs) => stemsMatch1C(ks, qs)))
      );

    if (matchedRecContract && (matchedRecContract.periodicAmount ?? 0) >= 0.01) {
      const recAmt = round2(matchedRecContract.periodicAmount!);
      return {
        resolvedAmount: recAmt,
        amountMode: 'from_related_doc',
        counterpartyName: linkedCpName || matchedRecContract.counterpartyName,
        contractName: linkedContract || matchedRecContract.name,
        vatRate: matchedRecContract.vatRate ?? input.vatRate,
        vatRule: matchedRecContract.vatRule ?? input.vatRule,
        step01Breakdown: {
          resolverLevel: 4,
          resolverLevelName: LEVEL_NAMES[4],
          summaryFormula: `Периодический платёж по договору «${matchedRecContract.name}» (${matchedRecContract.counterpartyName}) = ${fmtMoney(recAmt)}`,
          steps: [
            `В базе зарегистрирован договор с контрагентом «${matchedRecContract.counterpartyName}» с регулярной ставкой ${fmtMoney(recAmt)}.`,
            `Сумма и ставка НДС подтянуты автоматически из условий договора.`,
          ],
          sourceLinks: [
            {
              opId: matchedRecContract.firstSeenOpId,
              opNumber: matchedRecContract.firstSeenOpNumber,
              date: matchedRecContract.firstSeenDate || matchedRecContract.date,
              label: matchedRecContract.firstSeenOpNumber
                ? `Договор из операции #${matchedRecContract.firstSeenOpNumber} (${matchedRecContract.counterpartyName})`
                : `Договор базы 1С (${matchedRecContract.counterpartyName})`,
            },
          ],
        },
      };
    }

    // Forward contract scan (when an act/accrual row precedes the contract registration row in the task table)
    for (let fIdx = 0; fIdx < futureOps.length; fIdx++) {
      const fut = futureOps[fIdx];
      if (fut.includeInProcessing === false) continue;
      const isContractRow =
        fut.category === 'contract_event' || /заключен\p{L}*\s+договор/iu.test(fut.description);
      if (!isContractRow) continue;
      const recTerms = extractRecurringContractTerms1C(fut.description);
      const futPeriodicAmt = round2(fut.periodicPaymentAmount ?? recTerms?.periodicAmount ?? 0);
      if (futPeriodicAmt < 0.01) continue;
      const futCpNorm = normalizeCounterpartyKey1C(fut.counterpartyName);
      const sameCp = cpNormForRec && futCpNorm && cpNormForRec === futCpNorm;
      const futStems = extractKeywordStems1C(fut.description);
      const sharedStems = qStemsRec.filter((qs) => futStems.some((fs) => stemsMatch1C(fs, qs)));
      if (sameCp || sharedStems.length >= 2) {
        const futNum = input.priorOperations.length + 2 + fIdx;
        return {
          resolvedAmount: futPeriodicAmt,
          amountMode: 'from_related_doc',
          counterpartyName: linkedCpName || fut.counterpartyName,
          counterpartyInn: linkedCpInn || fut.counterpartyInn,
          counterpartyKpp: linkedCpKpp || fut.counterpartyKpp,
          contractName: linkedContract || fut.contractName,
          vatRate: recTerms?.vatRate ?? fut.vatRate ?? input.vatRate,
          vatRule: recTerms?.vatRule ?? fut.vatRule ?? input.vatRule,
          step01Breakdown: {
            resolverLevel: 4,
            resolverLevelName: LEVEL_NAMES[4],
            summaryFormula: `Периодический платёж по условиям договора (${fut.counterpartyName || linkedCpName}) = ${fmtMoney(futPeriodicAmt)}`,
            steps: [
              `В контуре задания найдена запись о договоре #${futNum} от ${formatRuDateShort(fut.date)} («${fut.description}») с регулярной платой ${fmtMoney(futPeriodicAmt)}.`,
              `Сумма и параметры НДС подтянуты автоматически из условий договора.`,
            ],
            sourceLinks: [
              {
                opId: fut.id,
                opNumber: futNum,
                date: fut.date,
                label: `Договор из операции #${futNum} от ${formatRuDateShort(fut.date)} (${fmtMoney(futPeriodicAmt)})`,
              },
            ],
          },
        };
      }
    }

    // Also check prior periodic operations in priorOperations (e.g. rent / internet / RKO in previous month)
    if (/аренд|связ|интернет|обслуживан|рко|охрана|подписк|абонент/iu.test(input.description)) {
      for (let idx = input.priorOperations.length - 1; idx >= 0; idx--) {
        const prev = input.priorOperations[idx];
        if (prev.amount < 0.01 || prev.includeInProcessing === false) continue;
        const prevCpNorm = normalizeCounterpartyKey1C(prev.counterpartyName);
        const sameCp = cpNormForRec && prevCpNorm === cpNormForRec;
        const prevStems = extractKeywordStems1C(prev.description);
        const sharedStems = qStemsRec.filter((qs) =>
          prevStems.some((ps) => stemsMatch1C(ps, qs))
        );
        if (sameCp || sharedStems.length >= 2) {
          return {
            resolvedAmount: prev.amount,
            amountMode: 'from_related_doc',
            counterpartyName: linkedCpName || prev.counterpartyName,
            counterpartyInn: linkedCpInn || prev.counterpartyInn,
            counterpartyKpp: linkedCpKpp || prev.counterpartyKpp,
            contractName: linkedContract || prev.contractName,
            vatRate: prev.vatRate,
            vatRule: prev.vatRule,
            step01Breakdown: {
              resolverLevel: 4,
              resolverLevelName: LEVEL_NAMES[4],
              summaryFormula: `Регулярная операция по аналогии с периодом ${formatRuDateShort(prev.date)} = ${fmtMoney(prev.amount)}`,
              steps: [
                `Найдена аналогичная периодическая операция #${idx + 1} от ${formatRuDateShort(prev.date)} («${prev.description}») на сумму ${fmtMoney(prev.amount)}.`,
              ],
              sourceLinks: [
                {
                  opId: prev.id,
                  opNumber: idx + 1,
                  date: prev.date,
                  label: `Операция #${idx + 1} от ${formatRuDateShort(prev.date)} (${fmtMoney(prev.amount)})`,
                },
              ],
            },
          };
        }
      }
    }
  }

  // ============================================================================
  // LEVEL 5: Account balance payoff on operation date (76.41, 08.04.1, etc.)
  // (Note: 68/69/70/10/41/43 exact subaccount balances are also finalized in postingEngine with full ledger precision)
  // ============================================================================
  if (input.category === 'alimony_payout') {
    const isMultiRecipientAlimony =
      /\sи\s+супруг|по\s+исполнительн\p{L}*\s+листам|всем\s+получател/iu.test(input.description);
    if (isMultiRecipientAlimony) {
      const open7641All = stateBefore.openSettlements.filter(
        (s) => s.account === '76.41' && s.remainingAmount >= 0.01
      );
      const sumAll = round2(open7641All.reduce((acc, s) => acc + s.remainingAmount, 0));
      if (sumAll >= 0.01) {
        const recipientsList = Array.from(
          new Set(open7641All.map((s) => s.counterpartyName).filter(Boolean))
        ).join('; ');
        return {
          resolvedAmount: sumAll,
          amountMode: 'from_account_balance',
          counterpartyName: recipientsList || input.counterpartyName,
          vatRate: 0,
          vatRule: 'none',
          step01Breakdown: {
            resolverLevel: 5,
            resolverLevelName: LEVEL_NAMES[5],
            summaryFormula: `Суммарное кредитовое сальдо счёта 76.41 на ${formatRuDateShort(input.date)} = ${fmtMoney(sumAll)}`,
            steps: [
              `Перечисление удержанных алиментов по всем открытым исполнительным листам на счёте 76.41 (${recipientsList}): ${fmtMoney(sumAll)}.`,
            ],
            sourceLinks: open7641All.map((s) => ({
              opId: s.originOpId,
              opNumber: s.originOpNumber,
              date: s.originDate,
              label: `Удержание алиментов #${s.originOpNumber ?? '?'} (${s.counterpartyName}: ${fmtMoney(s.remainingAmount)})`,
            })),
          },
        };
      }
    }

    const alim = resolveAlimonyPayable7641(
      stateBefore,
      input.counterpartyName,
      input.counterpartyInn
    );
    if (alim && alim.accumulatedBalance >= 0.01) {
      return {
        resolvedAmount: alim.accumulatedBalance,
        amountMode: 'from_account_balance',
        counterpartyName: alim.recipientName,
        counterpartyInn: alim.recipientInn || linkedCpInn,
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 5,
          resolverLevelName: LEVEL_NAMES[5],
          summaryFormula: `Кредитовое сальдо счёта 76.41 на ${formatRuDateShort(input.date)} = ${fmtMoney(alim.accumulatedBalance)}`,
          steps: [alim.provenanceNote],
          sourceLinks: alim.writ?.firstSeenOpNumber
            ? [
                {
                  opId: alim.writ.firstSeenOpId,
                  opNumber: alim.writ.firstSeenOpNumber,
                  date: alim.writ.firstSeenDate,
                  label: `Исполнительный лист #${alim.writ.firstSeenOpNumber} (${alim.recipientName})`,
                },
              ]
            : [],
        },
      };
    }
  }

  if (input.category === 'accountable_return') {
    const targetPersonKey = normalizePersonIdentityKey1C(input.employeeName || '');
    const targetSurname = targetPersonKey.split(/\s+/)[0] || '';

    let issued7101 = 0;
    let spent7101 = 0;
    const links7101: ResolverSourceLink1C[] = [];

    if (input.db1C?.rawBalances) {
      for (const b of input.db1C.rawBalances) {
        if (b.account === '71.01' || b.account === '71') {
          const subNorm = normalizePersonIdentityKey1C(b.subconto || '');
          if (
            !targetSurname ||
            !subNorm ||
            subNorm === targetPersonKey ||
            subNorm.startsWith(targetSurname)
          ) {
            const openDr = round2((b.startDebit || b.rawDebit || 0) - (b.startCredit || b.rawCredit || 0));
            if (openDr > 0.01) {
              issued7101 = round2(issued7101 + openDr);
              links7101.push({
                label: `Входящее сальдо Дт 71.01 (${fmtMoney(openDr)})`,
              });
            }
          }
        }
      }
    }

    input.priorOperations.forEach((p, idx) => {
      if (p.includeInProcessing === false) return;
      const pPersonKey = normalizePersonIdentityKey1C(p.employeeName || p.counterpartyName || '');
      const personMatches =
        !targetSurname ||
        !pPersonKey ||
        pPersonKey === targetPersonKey ||
        pPersonKey.startsWith(targetSurname);
      if (!personMatches) return;

      for (const e of p.entries) {
        if (e.debit === '71.01' || e.debit === '71') {
          issued7101 = round2(issued7101 + e.amount);
          links7101.push({
            opId: p.id,
            opNumber: idx + 1,
            date: p.date,
            label: `Выдача под отчёт #${idx + 1} от ${formatRuDateShort(p.date)} (+${fmtMoney(e.amount)})`,
          });
        }
        if (e.credit === '71.01' || e.credit === '71') {
          spent7101 = round2(spent7101 + e.amount);
          links7101.push({
            opId: p.id,
            opNumber: idx + 1,
            date: p.date,
            label: `Списание с 71.01 #${idx + 1} от ${formatRuDateShort(p.date)} (−${fmtMoney(e.amount)})`,
          });
        }
      }
    });

    const unspent7101 = round2(issued7101 - spent7101);
    if (unspent7101 >= 0.01) {
      return {
        resolvedAmount: unspent7101,
        amountMode: 'from_account_balance',
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 5,
          resolverLevelName: LEVEL_NAMES[5],
          summaryFormula:
            spent7101 >= 0.01
              ? `${fmtMoney(issued7101)} (выдано Дт 71.01) − ${fmtMoney(spent7101)} (израсходовано Кт 71.01) = ${fmtMoney(unspent7101)}`
              : `Остаток подотчётной суммы по Дт 71.01 = ${fmtMoney(unspent7101)}`,
          steps: [
            `По счёту 71.01 «Расчёты с подотчётными лицами» выдано ${fmtMoney(issued7101)}, отчитано по авансовым отчётам ${fmtMoney(spent7101)}.`,
            `Неиспользованный остаток к возврату в кассу (в банк): ${fmtMoney(unspent7101)}.`,
          ],
          sourceLinks: links7101,
        },
      };
    }
  }

  if (input.category === 'os_commissioning') {
    const targetStems = extractKeywordStems1C(
      `${input.nomenclatureName || ''} ${input.description}`
    );
    const pendingOs =
      stateBefore.fixedAssets.find(
        (a) =>
          a.status === 'На счёте 08.04.1 (к вводу)' &&
          targetStems.some((ts) =>
            extractKeywordStems1C(a.name).some((as) => stemsMatch1C(ts, as))
          )
      ) ||
      stateBefore.fixedAssets.find((a) => a.status === 'На счёте 08.04.1 (к вводу)');
    if (pendingOs && pendingOs.initialCost >= 0.01) {
      return {
        resolvedAmount: pendingOs.initialCost,
        amountMode: 'from_account_balance',
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 5,
          resolverLevelName: LEVEL_NAMES[5],
          summaryFormula: `Первоначальная стоимость ОС (накопленный дебетовый остаток 08.04.1 без НДС) = ${fmtMoney(pendingOs.initialCost)}`,
          steps: [
            `Сформирована первоначальная стоимость объекта «${pendingOs.name}» по ФСБУ 26/2020 и ФСБУ 6/2020 из капитальных вложений на счёте 08.04.1 (включая покупку, доставку и монтаж без НДС).`,
          ],
          sourceLinks: pendingOs.usages.map((u) => ({
            opId: u.opId,
            opNumber: u.opNumber,
            date: u.date,
            label: `Капитальные вложения 08.04.1 — операция #${u.opNumber} от ${formatRuDateShort(u.date)}`,
          })),
        },
      };
    }
  }

  if (input.category === 'intangible_commissioning') {
    let balance0805 = 0;
    const links0805: ResolverSourceLink1C[] = [];
    if (input.db1C?.rawBalances) {
      for (const b of input.db1C.rawBalances) {
        if (b.account === '08.05') {
          const dr = round2((b.startDebit || b.rawDebit || 0) - (b.startCredit || b.rawCredit || 0));
          if (dr > 0.01) {
            balance0805 = round2(balance0805 + dr);
            links0805.push({ label: `Входящее сальдо 08.05 (${fmtMoney(dr)})` });
          }
        }
      }
    }
    input.priorOperations.forEach((p, idx) => {
      if (p.includeInProcessing === false) return;
      for (const e of p.entries) {
        if (e.debit === '08.05') {
          balance0805 = round2(balance0805 + e.amount);
          links0805.push({
            opId: p.id,
            opNumber: idx + 1,
            date: p.date,
            label: `Поступление НМА #${idx + 1} от ${formatRuDateShort(p.date)} (+${fmtMoney(e.amount)})`,
          });
        }
        if (e.credit === '08.05') {
          balance0805 = round2(balance0805 - e.amount);
        }
      }
    });
    if (balance0805 >= 0.01) {
      return {
        resolvedAmount: balance0805,
        amountMode: 'from_account_balance',
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 5,
          resolverLevelName: LEVEL_NAMES[5],
          summaryFormula: `Первоначальная стоимость НМА (дебетовый остаток счёта 08.05) = ${fmtMoney(balance0805)}`,
          steps: [
            `По ФСБУ 14/2022 и ФСБУ 26/2020 сформированная на счёте 08.05 стоимость нематериального актива (${fmtMoney(balance0805)}) переносится в дебет счёта 04.01.`,
          ],
          sourceLinks: links0805,
        },
      };
    }
  }

  if (input.category === 'intangible_amortization') {
    let cost0401 = 0;
    let spiMonths = input.usefulLifeMonths || 0;
    const links0401: ResolverSourceLink1C[] = [];
    input.priorOperations.forEach((p, idx) => {
      if (p.includeInProcessing === false) return;
      for (const e of p.entries) {
        if (e.debit === '04.01' || e.debit === '04') {
          cost0401 = round2(cost0401 + e.amount);
          if (!spiMonths && p.usefulLifeMonths && p.usefulLifeMonths > 0) {
            spiMonths = p.usefulLifeMonths;
          }
          links0401.push({
            opId: p.id,
            opNumber: idx + 1,
            date: p.date,
            label: `Принятие к учёту НМА #${idx + 1} от ${formatRuDateShort(p.date)} (${fmtMoney(e.amount)})`,
          });
        }
      }
    });
    if (cost0401 >= 0.01) {
      const effSpi = spiMonths > 0 ? spiMonths : 36;
      const monthlyAmort = round2(cost0401 / effSpi);
      return {
        resolvedAmount: monthlyAmort,
        amountMode: 'calculated_by_1c',
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 6,
          resolverLevelName: LEVEL_NAMES[6],
          summaryFormula: `${fmtMoney(cost0401)} ÷ ${effSpi} мес. = ${fmtMoney(monthlyAmort)}`,
          steps: [
            `Линейная амортизация НМА на счёте 05 (ФСБУ 14/2022): первоначальная стоимость ${fmtMoney(cost0401)} ÷ СПИ ${effSpi} мес. = ${fmtMoney(monthlyAmort)}.`,
          ],
          sourceLinks: links0401,
        },
      };
    }
  }

  // ============================================================================
  // LEVEL 6: Formula calculation from Virtual 1C registers (OS depreciation, loan interest)
  // ============================================================================
  if (input.category === 'depreciation_accrual') {
    const activeOs = stateBefore.fixedAssets.filter(
      (a) => a.status === 'Введено в эксплуатацию (счёт 01.01)' && a.monthlyDepreciation > 0
    );
    if (activeOs.length > 0) {
      const totalDep = round2(activeOs.reduce((s, a) => s + a.monthlyDepreciation, 0));
      return {
        resolvedAmount: totalDep,
        amountMode: 'calculated_by_1c',
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 6,
          resolverLevelName: LEVEL_NAMES[6],
          summaryFormula: activeOs
            .map(
              (a) =>
                `${a.name}: ${fmtMoney(a.initialCost)} / ${a.usefulLifeMonths} мес. = ${fmtMoney(a.monthlyDepreciation)}`
            )
            .join(' + '),
          steps: activeOs.map(
            (a) =>
              `Линейная норма амортизации по объекту «${a.name}» (ФСБУ 6/2020, ст. 259.1 НК РФ): первоначальная стоимость ${fmtMoney(a.initialCost)} ÷ СПИ ${a.usefulLifeMonths} мес. = ${fmtMoney(a.monthlyDepreciation)} / мес.`
          ),
          sourceLinks: activeOs
            .filter((a) => a.firstSeenOpNumber)
            .map((a) => ({
              opId: a.firstSeenOpId,
              opNumber: a.firstSeenOpNumber,
              date: a.commissioningDate || a.firstSeenDate,
              label: `Ввод ОС в эксплуатацию #${a.firstSeenOpNumber} (${a.name})`,
            })),
        },
      };
    }
  }

  if (input.category === 'os_disposal') {
    const activeOs = stateBefore.fixedAssets.find(
      (a) => a.status === 'Введено в эксплуатацию (счёт 01.01)'
    );
    if (activeOs && activeOs.initialCost >= 0.01) {
      return {
        resolvedAmount: activeOs.initialCost,
        amountMode: 'calculated_by_1c',
        step01Breakdown: {
          resolverLevel: 6,
          resolverLevelName: LEVEL_NAMES[6],
          summaryFormula: `Первоначальная стоимость ${fmtMoney(activeOs.initialCost)} − накопленная амортизация ${fmtMoney(activeOs.accumulatedDepreciation || 0)} = остаточная стоимость ${fmtMoney(activeOs.initialCost - (activeOs.accumulatedDepreciation || 0))}`,
          steps: [
            `Списание объекта «${activeOs.name}» через субсчёт 01.09 «Выбытие основных средств» (п. 40–44 ФСБУ 6/2020).`,
          ],
          sourceLinks: activeOs.firstSeenOpNumber
            ? [
                {
                  opId: activeOs.firstSeenOpId,
                  opNumber: activeOs.firstSeenOpNumber,
                  date: activeOs.firstSeenDate,
                  label: `Объект ОС #${activeOs.firstSeenOpNumber} (${activeOs.name})`,
                },
              ]
            : [],
        },
      };
    }
  }

  if (input.category === 'penalty_claim') {
    const inlineMatches = Array.from(
      input.description.matchAll(
        /(?:неуй?стойк\p{L}*|штраф\p{L}*|пен[ияей])\s*(?:в\s+размере\s*|составил\p{L}*\s*|=|:|—|-)\s*(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/giu
      )
    );
    let penaltySum = 0;
    const parts: string[] = [];
    for (const m of inlineMatches) {
      const val = round2(Number(m[1].replace(/[\s\u00A0]/g, '').replace(',', '.')) || 0);
      if (val > 0) {
        penaltySum = round2(penaltySum + val);
        parts.push(fmtMoney(val));
      }
    }
    let principalDebt = 0;
    if (
      /списан\p{L}*.*(?:в\s+размере\s+задолженност|задолженност)/iu.test(input.description) &&
      linkedCpName
    ) {
      const unpaid = resolveUnpaidSupplier6001ByKeywords(
        stateBefore,
        input.description,
        linkedCpName
      );
      if (unpaid && unpaid.totalUnpaidAmount >= 0.01) {
        principalDebt = unpaid.totalUnpaidAmount;
        parts.push(`долг по договору ${fmtMoney(principalDebt)}`);
      }
    }
    const totalClaim = round2(penaltySum + principalDebt);
    if (totalClaim >= 0.01) {
      return {
        resolvedAmount: totalClaim,
        amountMode: 'from_related_doc',
        counterpartyName: linkedCpName || undefined,
        counterpartyInn: linkedCpInn || undefined,
        counterpartyKpp: linkedCpKpp || undefined,
        vatRate: 0,
        vatRule: 'none',
        step01Breakdown: {
          resolverLevel: 3,
          resolverLevelName: LEVEL_NAMES[3],
          summaryFormula: `${parts.join(' + ')} = ${fmtMoney(totalClaim)}`,
          steps: [
            `Из условия исполнительного листа / претензии определены санкции (${fmtMoney(penaltySum)})${principalDebt > 0 ? ` и основной долг поставщику по счёту 60.01 (${fmtMoney(principalDebt)})` : ''}.`,
          ],
          sourceLinks: extraLinks,
        },
      };
    }
  }

  // ============================================================================
  // LEVEL 7: Historical analogues in loaded 1C Database (documents & postings)
  // ============================================================================
  if (input.db1C) {
    const cpNorm7 = normalizeCounterpartyKey1C(linkedCpName);
    const qStems7 = extractKeywordStems1C(input.description);

    if (cpNorm7) {
      const matchingDocs = input.db1C.documents.filter(
        (d) =>
          d.amount >= 0.01 &&
          normalizeCounterpartyKey1C(d.counterparty) === cpNorm7 &&
          (qStems7.length === 0 ||
            extractKeywordStems1C(d.comment).some((ds) =>
              qStems7.some((qs) => stemsMatch1C(ds, qs))
            ))
      );
      if (matchingDocs.length > 0) {
        const lastDoc = matchingDocs[matchingDocs.length - 1];
        return {
          resolvedAmount: round2(lastDoc.amount),
          amountMode: 'from_related_doc',
          counterpartyName: linkedCpName || lastDoc.counterparty,
          contractName: linkedContract || lastDoc.contract,
          step01Breakdown: {
            resolverLevel: 7,
            resolverLevelName: LEVEL_NAMES[7],
            summaryFormula: `По историческому документу базы 1С (${lastDoc.documentKind} №${lastDoc.number} от ${formatRuDateShort(lastDoc.date)}) = ${fmtMoney(lastDoc.amount)}`,
            steps: [
              `В журнале документов исходной выгрузки 1С найден типовой документ по контрагенту «${lastDoc.counterparty}» на сумму ${fmtMoney(lastDoc.amount)}.`,
            ],
            sourceLinks: [
              {
                date: lastDoc.date,
                label: `Документ базы 1С: ${lastDoc.documentKind} №${lastDoc.number} (${fmtMoney(lastDoc.amount)})`,
              },
            ],
          },
        };
      }
    }
  }

  // ============================================================================
  // LEVEL 8: Controlled Diagnostic (all 7 levels checked — NO "ст. 9 402-ФЗ" blame!)
  // ============================================================================
  const checkedSources = [
    '1. Колонка «Сумма» исходного файла Excel — ячейка пуста (0,00 ₽).',
    '2. Математические формулы в тексте строки (количество × цена, сложение позиций, доля/%) — числовых множителей не обнаружено.',
    '3. Открытые расчёты и авансы за предыдущие дни (счета 60.01, 60.02, 62.01, 62.02) — подходящего неоплаченного остатка не найдено.',
    '4. Зарегистрированные периодические договоры и регулярные платежи прошлых месяцев — совпадений нет.',
    '5. Остатки по счетам учёта на дату операции (68, 69, 70, 76.41, 08.04, 10, 41, 43) — автоматическое сальдо не применимо или равно нулю.',
    '6. Расчётные регистры модели 1С (штатные оклады ФОТ, СПИ основных средств, активные процентные векселя/займы) — база для формулы отсутствует.',
    '7. Исторические документы и проводки исходной выгрузки 1С — аналогичных операций по данному предмету нет.',
  ];

  return {
    resolvedAmount: 0,
    amountMode: 'required_missing',
    counterpartyName: linkedCpName || undefined,
    counterpartyInn: linkedCpInn || undefined,
    counterpartyKpp: linkedCpKpp || undefined,
    contractName: linkedContract || undefined,
    step01Breakdown: {
      resolverLevel: 8,
      resolverLevelName: LEVEL_NAMES[8],
      summaryFormula: 'Внешняя сумма не указана в условии задачи и не выводится из предыдущих операций',
      steps: [
        'Проверены все 7 уровней замкнутого контура задания (файл Excel, текст строки, открытые долги/авансы, договоры, сальдо счетов, расчётные регистры и архив 1С).',
        'Введите сумму прямо в карточке операции или в блоке диагностики — проводки и ОСВ пересчитаются мгновенно.',
      ],
      sourceLinks: extraLinks,
      checkedSourcesWhenMissing: checkedSources,
    },
  };
}
