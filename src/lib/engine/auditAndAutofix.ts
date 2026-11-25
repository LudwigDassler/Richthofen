import {
  getAccountInfo,
  isOffBalanceAccountCode,
  normalizeAccountToLeaf1C,
} from '@/data/chartOfAccounts';
import {
  AuditGuide1CBP30,
  AuditIssue,
  AutoFixChangeRecord,
  AutofixExecutionSummary,
  AutofixRuleId,
  CalculationProfile1C,
  CounterpartyResolutionSource,
  Database1CSnapshot,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  EgrulCandidate,
  OsvReport,
  QueuedOperation,
} from '@/types/accounting';
import {
  doesSpecAllowZeroPostings,
  getDocumentSpecByDocType,
  getDocumentSpecForOperation,
} from '@/lib/engine/documentSpecs1C';
import { calculateOsvReport } from '@/lib/engine/osvCalculator';
import {
  DOC_TYPE_LABELS_1C,
  buildOperationMentorGuide1C,
  doesOperationRequireCounterparty,
} from '@/lib/engine/mentorGuide1C';
import { sanitizeAuditIssue1C } from '@/lib/engine/textHygiene1C';
import {
  attachVirtualStateStep00ToOperations,
  BatchSequentialContext,
  bindAndGenerateOperation,
  detectOperationClassification,
  extractCanonicalProjectNomGroup1C,
  extractFounderFioFromDescription,
  findPersonMentionedInDescription1C,
  formatRuMoneyPlainSpace,
  isFounderContributionText,
  isMisclassifiedLegacyOperation,
  isNonDeductibleProfitTaxEntry1C,
  matchPersonOrCounterpartyIn1C,
  normalizeEntityKey,
  recalculateOperationsChronologically,
} from '@/lib/engine/postingEngine';
import {
  buildCanonicalCounterpartyRegistry1C,
  buildVirtual1CStateTimeline,
  computeMonthlyRpbWriteOff1C,
  extractKeywordStems1C,
  normalizeCounterpartyKey1C,
  resolveUnpaidSupplier6001ByKeywords,
  stemsMatch1C,
} from '@/lib/engine/virtual1CState';
import {
  extractRequisitesFromFreeText,
  normalizeOperationDateToReportingYear,
} from '@/lib/import1c/batchFileParser';
import {
  generateEducationalInnKpp,
  inferOrganizationRegionCode,
  KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES,
  selectBestEgrulCandidate,
  validateRussianInnChecksum,
} from '@/lib/egrul/egrulLookup';

export interface AutofixRegistryEntry {
  id: AutofixRuleId;
  label: string;
  description: string;
}

export const AUTOFIX_REGISTRY: Record<AutofixRuleId, AutofixRegistryEntry> = {
  normalize_date_year: {
    id: 'normalize_date_year',
    label: 'Приведение года даты к отчётному периоду',
    description: 'Нормализует шаблонные годы дат Excel к рабочему отчётному году базы 1С.',
  },
  disable_duplicate_doc: {
    id: 'disable_duplicate_doc',
    label: 'Исключение дубликата документа 1С',
    description: 'Отключает повторное проведение документа, уже присутствующего в базе 1С.',
  },
  reclassify_legacy_doc: {
    id: 'reclassify_legacy_doc',
    label: 'Переклассификация вида документа 1С:БП 3.0',
    description: 'Приводит ошибочный вид документа к профильному документу 1С:БП 3.0 и пересчитывает НДС.',
  },
  resolve_amount_and_links: {
    id: 'resolve_amount_and_links',
    label: 'Вывод суммы и привязка расчётов по 7 уровням контура',
    description: 'Рассчитывает суммы и связывает контрагентов/договоры по хронологической модели базы 1С.',
  },
  fill_formal_requisites: {
    id: 'fill_formal_requisites',
    label: 'Автозаполнение формальных реквизитов карточки 1С',
    description: 'Заполняет ИНН/КПП (с валидной контрольной суммой ФНС по региону организации), основной договор, склад и статью затрат.',
  },
  replace_group_account: {
    id: 'replace_group_account',
    label: 'Замена группового счёта на субсчёт Плана счетов 1С',
    description: 'Заменяет синтетический счёт-группу на рабочий конечный субсчёт 1С:БП 3.0.',
  },
  flip_red_settlement_subaccount: {
    id: 'flip_red_settlement_subaccount',
    label: 'Переклассификация расчётов и авансов (60.01↔60.02, 62.01↔62.02)',
    description: 'Устраняет отрицательное сальдо на счетах расчётов переносом предоплаты на субсчёт авансов.',
  },
  generate_cash_withdrawal_cover: {
    id: 'generate_cash_withdrawal_cover',
    label: 'Пополнение кассы с расчётного счёта (Дт 50.01 Кт 51)',
    description: 'Устраняет отрицательный остаток кассы 50.01 при достаточном остатке средств на счёте 51.',
  },
  offset_advances_60_62: {
    id: 'offset_advances_60_62',
    label: 'Автоматический зачёт взаимных авансов (60 / 62)',
    description: 'Сворачивает развёрнутое сальдо между счетами расчётов и авансов (60.01↔60.02, 62.02↔62.01).',
  },
  accrue_advance_vat_76av: {
    id: 'accrue_advance_vat_76av',
    label: 'Исчисление НДС с полученных авансов (Дт 76.АВ Кт 68.02)',
    description: 'Формирует счёт-фактуру на остаток полученного аванса покупателя по расчётной ставке НДС.',
  },
  close_period_accounts: {
    id: 'close_period_accounts',
    label: 'Регламентное закрытие месяца (20, 25, 26, 44, 90, 91, 99)',
    description: 'Закрывает затратные счета и формирует финансовый результат и налог на прибыль за период.',
  },
};

let autoFixIdSeq = 0;
function nextAutoFixId(prefix: string): string {
  autoFixIdSeq += 1;
  return `${prefix}-${Date.now()}-${autoFixIdSeq}`;
}

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function isValidRussianInnFormat(inn: string): boolean {
  const digits = inn.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 12;
}

export function getCounterpartyGroupKey(name: string): string {
  const trimmed = name.trim();
  const norm = normalizeEntityKey(trimmed);
  return norm || trimmed.toLowerCase();
}

function canResolveCounterpartyFrom1C(
  op: QueuedOperation,
  db1C: Database1CSnapshot | null
): boolean {
  if (!db1C) return false;
  const trimmed = op.counterpartyName.trim();
  if (trimmed.length >= 2 && matchPersonOrCounterpartyIn1C(trimmed, op.counterpartyInn, db1C)) {
    return true;
  }
  const norm = normalizeEntityKey(trimmed);
  if (!norm || norm.length < 2) return false;

  const inDir = db1C.counterparties.some((c) => {
    const cn = normalizeEntityKey(c.name);
    const fn = normalizeEntityKey(c.fullName ?? '');
    return (
      cn === norm ||
      (cn.length >= 4 && (cn.includes(norm) || norm.includes(cn))) ||
      (fn.length >= 4 && (fn.includes(norm) || norm.includes(fn)))
    );
  });
  if (inDir) return true;

  return db1C.documents.some((d) => {
    const dn = normalizeEntityKey(d.counterparty);
    return Boolean(d.counterpartyInn) && dn.length >= 4 && (dn.includes(norm) || norm.includes(dn));
  });
}

export interface PendingNewCounterpartyInfo {
  key: string;
  name: string;
  currentInn: string;
  currentKpp: string;
  bankAccount?: string;
  bik?: string;
  bankName?: string;
  source: CounterpartyResolutionSource;
  egrulCandidates: EgrulCandidate[];
  kind: QueuedOperation['counterpartyKind'];
  operationIds: string[];
  primaryOperationId: string;
  needsInn: boolean;
  needsKpp: boolean;
}

/**
 * Dynamically computes brand-new counterparties strictly from active operations
 * where the counterparty name has length >= 2 and is absent from 1C directories
 * (`Контрагенты` and `ФизическиеЛица`). Never stores sticky orphaned entries.
 */
export function computePendingNewCounterparties(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): PendingNewCounterpartyInfo[] {
  const map = new Map<string, PendingNewCounterpartyInfo>();

  for (const op of operations) {
    if (!op.includeInProcessing || op.autoGeneratedKind) continue;
    // Strictly commercial counterparties (suppliers & buyers) — never list tax authorities, founders, accountable employees, or internal ops
    if (!doesOperationRequireCounterparty(op.category)) continue;
    if (op.counterpartyKind === 'ФизическоеЛицо') continue;

    const trimmedName = op.counterpartyName.trim();
    if (trimmedName.length < 2 || trimmedName.includes(';')) continue;

    const isMatchedIn1C =
      op.bindings.counterparty.status === 'matched_1c' ||
      matchPersonOrCounterpartyIn1C(trimmedName, op.counterpartyInn, db1C) !== null;
    if (isMatchedIn1C) continue;

    if (canResolveCounterpartyFrom1C(op, db1C)) continue;

    const key = getCounterpartyGroupKey(trimmedName);
    const cleanInn = op.counterpartyInn.replace(/\D/g, '');
    const cleanKpp = op.counterpartyKpp.replace(/\D/g, '');
    const validInn =
      isValidRussianInnFormat(cleanInn) && validateRussianInnChecksum(cleanInn).valid;
    const needsInn = !validInn;
    const needsKpp =
      op.counterpartyKind === 'ЮридическоеЛицо' &&
      validInn &&
      cleanInn.length === 10 &&
      cleanKpp.length !== 9;

    const opSource: CounterpartyResolutionSource =
      op.counterpartySource ??
      (validInn ? 'excel_explicit' : 'unresolved');

    const existing = map.get(key);
    if (existing) {
      existing.operationIds.push(op.id);
      if (!existing.currentInn && cleanInn) existing.currentInn = cleanInn;
      if (!existing.currentKpp && cleanKpp) existing.currentKpp = cleanKpp;
      if (!existing.bankAccount && op.counterpartyBankAccount) {
        existing.bankAccount = op.counterpartyBankAccount;
      }
      if (!existing.bik && op.counterpartyBik) {
        existing.bik = op.counterpartyBik;
        existing.bankName = op.counterpartyBankName;
      }
      if (existing.egrulCandidates.length === 0 && op.egrulCandidates?.length) {
        existing.egrulCandidates = op.egrulCandidates;
      }
      if (existing.source === 'unresolved' && opSource !== 'unresolved') {
        existing.source = opSource;
      }
      if (needsInn) existing.needsInn = true;
      if (needsKpp) existing.needsKpp = true;
    } else {
      map.set(key, {
        key,
        name: trimmedName,
        currentInn: cleanInn,
        currentKpp: cleanKpp,
        bankAccount: op.counterpartyBankAccount,
        bik: op.counterpartyBik,
        bankName: op.counterpartyBankName,
        source: opSource,
        egrulCandidates: op.egrulCandidates ?? [],
        kind: op.counterpartyKind,
        operationIds: [op.id],
        primaryOperationId: op.id,
        needsInn,
        needsKpp,
      });
    }
  }

  return Array.from(map.values());
}

export interface ContextCounterpartySuggestion {
  name: string;
  inn: string;
  kpp: string;
  contractName?: string;
  provenanceLabel: string;
  sourceOperationId?: string;
}

function formatShortRuDate(iso?: string): string {
  if (!iso || iso.length < 10) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/**
 * Returns counterparty suggestions ONLY when proven by chronological context:
 * - Unpaid 60.01 supplier invoice matching payment subject stems or exact unpaid amount
 * - Buyer 62.02 advance matching shipment stems or advance balance
 * - Prior commercial operation with overlapping nomenclature/subject stems
 *
 * STRICT ANTI-HALLUCINATION RULE: Never falls back to random directory rows (`counterparties[0]`).
 * Returns `[]` if no contextual proof exists.
 */
export function computeContextCounterpartySuggestions(
  op: QueuedOperation,
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): ContextCounterpartySuggestion[] {
  if (!doesOperationRequireCounterparty(op.category)) {
    return [];
  }

  const timeline = buildVirtual1CStateTimeline(db1C, operations);
  const stateBefore = timeline.stateBeforeByOpId[op.id] ?? timeline.finalState;
  const displayNumMap = timeline.displayNumberByOpId;

  const seen = new Set<string>();
  const suggestions: ContextCounterpartySuggestion[] = [];

  const pushSuggestion = (item: ContextCounterpartySuggestion) => {
    const clean = item.name.trim();
    if (clean.length < 2) return;
    const key = getCounterpartyGroupKey(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    suggestions.push({ ...item, name: clean });
  };

  const isSaleSide =
    op.category === 'sale_goods' ||
    op.category === 'sale_services' ||
    op.category === 'bank_in' ||
    op.category === 'cash_in';

  // 1. Supplier payment (`bank_out` / `cash_out`): check unpaid 60.01 settlements by subject stems or exact amount
  if (!isSaleSide && (op.category === 'bank_out' || op.category === 'cash_out')) {
    const resolved6001 = resolveUnpaidSupplier6001ByKeywords(
      stateBefore,
      `${op.description} ${op.nomenclatureName ?? ''}`,
      undefined,
      op.amount >= 0.01 ? op.amount : undefined
    );
    if (resolved6001 && resolved6001.matchedSettlements.length > 0) {
      const bySupplier = new Map<
        string,
        {
          name: string;
          inn: string;
          kpp: string;
          contractName: string;
          amount: number;
          originOpNumber?: number;
          originDate?: string;
          originOpId?: string;
        }
      >();
      for (const s of resolved6001.matchedSettlements) {
        if (!s.counterpartyName.trim()) continue;
        const k = getCounterpartyGroupKey(s.counterpartyName);
        const existing = bySupplier.get(k);
        if (existing) {
          existing.amount = round2(existing.amount + s.remainingAmount);
        } else {
          bySupplier.set(k, {
            name: s.counterpartyName,
            inn: s.counterpartyInn,
            kpp: s.counterpartyKpp,
            contractName: s.contractName,
            amount: s.remainingAmount,
            originOpNumber: s.originOpNumber,
            originDate: s.originDate,
            originOpId: s.originOpId,
          });
        }
      }

      for (const part of Array.from(bySupplier.values())) {
        const opRef = part.originOpNumber ? `оп. #${part.originOpNumber}` : 'входящее сальдо 60.01';
        const datePart = part.originDate ? ` от ${formatShortRuDate(part.originDate)}` : '';
        pushSuggestion({
          name: part.name,
          inn: part.inn,
          kpp: part.kpp,
          contractName: part.contractName,
          provenanceLabel: `${opRef}${datePart} · долг 60.01: ${part.amount.toFixed(2)} ₽`,
          sourceOperationId: part.originOpId,
        });
      }
    }
  }

  // 2. Sale / shipment: check prior AND forward buyer payments / advances on 62.02 / 62.01
  if (isSaleSide && (op.category === 'sale_goods' || op.category === 'sale_services')) {
    for (const other of operations) {
      if (other.id === op.id || !other.includeInProcessing) continue;
      if (other.counterpartyName.trim().length < 2) continue;
      const has6202OrBankIn =
        other.category === 'bank_in' ||
        other.entries.some((e) => e.credit === '62.02' || e.credit === '62.01');
      if (has6202OrBankIn) {
        const isExactAmt = op.amount >= 0.01 && Math.abs(other.amount - op.amount) < 0.02;
        const isPrior = !op.date || !other.date || other.date <= op.date;
        if (isPrior || isExactAmt) {
          const num = displayNumMap[other.id];
          const datePart = other.date ? ` от ${formatShortRuDate(other.date)}` : '';
          pushSuggestion({
            name: other.counterpartyName,
            inn: other.counterpartyInn,
            kpp: other.counterpartyKpp,
            contractName: other.contractName,
            provenanceLabel: `${num ? `оп. #${num}${datePart}` : 'оплата покупателя'} · ${isPrior ? 'аванс 62.02' : 'последующая оплата'}`,
            sourceOperationId: other.id,
          });
        }
      }
    }
    if (suggestions.length === 0 && db1C) {
      const bal6202List = db1C.rawBalances.filter(
        (b) => b.account === '62.02' && b.subconto && (b.rawCredit > 0.01 || b.startCredit > 0.01)
      );
      if (bal6202List.length === 1 && bal6202List[0]?.subconto) {
        const subName = bal6202List[0].subconto.split('/')[0].trim();
        const m1c = matchPersonOrCounterpartyIn1C(subName, '', db1C);
        if (m1c) {
          pushSuggestion({
            name: m1c.name,
            inn: m1c.inn,
            kpp: m1c.kpp,
            contractName: m1c.defaultContract || '',
            provenanceLabel: 'БД 1С · сальдо 62.02',
          });
        }
      }
      if (suggestions.length === 0) {
        const buyerContracts = db1C.contracts.filter(
          (c) => /покупател/iu.test(c.contractKind ?? '') && c.counterpartyName.trim().length >= 2
        );
        const uniq = new Set(buyerContracts.map((c) => normalizeEntityKey(c.counterpartyName)));
        if (uniq.size === 1 && buyerContracts[0]) {
          const bc = buyerContracts[0];
          const m1c = matchPersonOrCounterpartyIn1C(bc.counterpartyName, bc.counterpartyInn ?? '', db1C);
          pushSuggestion({
            name: m1c?.name || bc.counterpartyName,
            inn: m1c?.inn || bc.counterpartyInn || '',
            kpp: m1c?.kpp || '',
            contractName: bc.name || '',
            provenanceLabel: 'БД 1С · договор с покупателем',
          });
        }
      }
    }
  }

  // 3. Stem or exact-amount overlap with prior OR forward operations on the same commercial side
  const opStems = extractKeywordStems1C(`${op.description} ${op.nomenclatureName ?? ''}`);
  for (const other of operations) {
    if (other.id === op.id || !other.includeInProcessing) continue;
    if (
      !doesOperationRequireCounterparty(other.category) &&
      other.category !== 'contract_event'
    ) {
      continue;
    }
    if (other.counterpartyKind === 'ФизическоеЛицо') continue;
    if (other.counterpartyName.trim().length < 2) continue;

    const otherIsSaleSide =
      other.category === 'sale_goods' ||
      other.category === 'sale_services' ||
      other.category === 'bank_in' ||
      other.category === 'cash_in' ||
      (other.category === 'contract_event' &&
        /покупател|заказчик|выставлен\p{L}*\s+счет/iu.test(other.description));
    if (otherIsSaleSide !== isSaleSide) continue;

    const otherStems = extractKeywordStems1C(
      `${other.description} ${other.nomenclatureName ?? ''}`
    );
    const matched =
      opStems.length > 0 &&
      opStems.filter((st) =>
        otherStems.some((ost) => ost.startsWith(st) || st.startsWith(ost))
      );
    const exactAmountMatch =
      op.amount >= 0.01 &&
      (Math.abs(other.amount - op.amount) < 0.02 ||
        (other.periodicPaymentAmount !== undefined &&
          Math.abs(other.periodicPaymentAmount - op.amount) < 0.02));
    if ((matched && matched.length > 0) || exactAmountMatch) {
      const num = displayNumMap[other.id];
      const datePart = other.date ? ` от ${formatShortRuDate(other.date)}` : '';
      pushSuggestion({
        name: other.counterpartyName,
        inn: other.counterpartyInn,
        kpp: other.counterpartyKpp,
        contractName: other.contractName,
        provenanceLabel: `${num ? `оп. #${num}${datePart}` : 'связь по контуру задания'}`,
        sourceOperationId: other.id,
      });
    }
  }

  return suggestions.slice(0, 4);
}

function buildRedBalanceGuide1C(code: string, name: string, val: number): {
  accountingReason: string;
  guide1C: AuditGuide1CBP30;
} {
  if (code === '50.01' || code === '51') {
    return {
      accountingReason: `По активному денежному счёту ${code} «${name}» расход превысил входящий остаток и поступления на ${Math.abs(val).toFixed(2)} ₽. По правилам кассовой и банковской дисциплины отрицательный остаток денег невозможен — не отражено поступление средств (выручка, заём, вклад учредителя 75.01) или нарушено время проведения документов внутри одного дня.`,
      guide1C: {
        menuPath:
          code === '51'
            ? 'Банк и касса → Банковские выписки'
            : 'Банк и касса → Кассовые документы',
        documentKind:
          code === '51'
            ? 'Поступление на расчетный счет / Списание с расчетного счета'
            : 'Поступление наличных (ПКО) / Выдача наличных (РКО)',
        checkPoints: [
          `Проверьте полноту загрузки всех выписок по счёту ${code} и входящее сальдо на начало периода`,
          'Проверьте время документов внутри одной даты: приходные документы должны стоять по времени раньше расходных (например, 09:00:00 vs 15:00:00)',
          'Убедитесь, что банковский счёт организации выбран одинаковый во всех документах',
        ],
        repostInstruction:
          'Операции → Закрытие месяца → Перепроведение документов за месяц → Выполнить операцию',
        verifyInOsv: `Отчеты → Карточка счета ${code} (с отбором по дням) и Оборотно-сальдовая ведомость по счету ${code}`,
      },
    };
  }

  if (code.startsWith('41') || code.startsWith('10') || code.startsWith('43')) {
    return {
      accountingReason: `По активному счёту учёта МПЗ ${code} «${name}» списано ТМЦ больше, чем числилось на складе (${val.toFixed(2)} ₽). Типичные причины в 1С БП 3.0: реализация проведена раньше поступления по времени, выбран другой «Склад» или дубликат карточки «Номенклатура».`,
      guide1C: {
        menuPath: 'Покупки → Поступление (акты, накладные, УПД) / Продажи → Реализация (акты, накладные, УПД)',
        documentKind: 'Поступление товаров (накладная, УПД) и Реализация товаров',
        checkPoints: [
          `Сверьте реквизит «Склад» и точную карточку «Номенклатура» в приходной и расходной накладных по счёту ${code}`,
          'Проверьте дату и время документов: Поступление должно быть проведено раньше Реализации / Требования-накладной',
          `Проверьте счёт учёта номенклатуры в табличной части (${code})`,
        ],
        repostInstruction:
          'Откройте документ поступления → Провести и закрыть, затем выполните Операции → Закрытие месяца → Перепроведение документов',
        verifyInOsv: `Отчеты → Оборотно-сальдовая ведомость по счету ${code} (группировка по Номенклатуре, Складам и Партиям)`,
      },
    };
  }

  if (code.startsWith('60') || code.startsWith('62')) {
    const isSupplier = code.startsWith('60');
    return {
      accountingReason: `По счёту расчётов ${code} «${name}» возник отрицательный остаток (${val.toFixed(2)} ₽) из-за отражения оплаты/аванса на счёте расчётов (${isSupplier ? '60.01 вместо 60.02' : '62.01 вместо 62.02'}) либо несоответствия субконто «Договор» между оплатой и накладной.`,
      guide1C: {
        menuPath: 'Банк и касса → Банковские выписки',
        documentKind: isSupplier
          ? 'Списание с расчетного счета (Оплата поставщику)'
          : 'Поступление на расчетный счет (Оплата от покупателя)',
        checkPoints: [
          `Установите в документе Счёт расчётов = ${isSupplier ? '60.01' : '62.01'}, Счёт авансов = ${isSupplier ? '60.02' : '62.02'}`,
          'Проверьте реквизит «Погашение задолженности: Автоматически»',
          'Убедитесь, что в оплате и в накладной/акте выбран строго один и тот же «Договор контрагента»',
        ],
        repostInstruction:
          'Перепроведите банковскую выписку и связанную накладную кнопкой «Провести и закрыть» в хронологическом порядке',
        verifyInOsv: `Отчеты → Оборотно-сальдовая ведомость по счету ${isSupplier ? '60' : '62'} (по субсчетам и субконто Контрагенты, Договоры)`,
      },
    };
  }

  return {
    accountingReason: `По счёту ${code} «${name}» сформировалось отрицательное конечное сальдо (${val.toFixed(2)} ₽), не характерное для его вида (активный/пассивный).`,
    guide1C: {
      menuPath: 'Операции → Операции, введенные вручную / Журнал операций',
      documentKind: 'Документы движения по счёту ' + code,
      checkPoints: [
        `Откройте Карточку счёта ${code} и найдите документ, после которого сальдо ушло в минус`,
        'Проверьте корректность корреспондирующего счёта и аналитики (субконто)',
      ],
      repostInstruction:
        'Исправьте счёт/сумму в первичном документе → Провести и закрыть → Операции → Закрытие месяца',
      verifyInOsv: `Отчеты → Оборотно-сальдовая ведомость по счету ${code}`,
    },
  };
}

export function runAuditDiagnostics(params: {
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  osv: OsvReport;
}): AuditIssue[] {
  const { db1C, operations, osv } = params;
  const issues: AuditIssue[] = [];

  const activeOps = operations.filter((op) => op.includeInProcessing);

  // 1. OSV Double-Entry Mathematical Control
  if (!osv.totals.isStartBalanced) {
    issues.push({
      id: 'osv-start-disbalance',
      severity: 'error',
      category: 'osv_disbalance',
      title: 'Нарушено равенство начального сальдо ОСВ',
      description: `Сальдо на начало по Дебету (${osv.totals.startDebit.toFixed(2)} ₽) не равно Кредиту (${osv.totals.startCredit.toFixed(2)} ₽). Разница: ${osv.totals.startDiff.toFixed(2)} ₽.`,
      accountingReason: `Нарушен базовый постулат двойной записи на дату начала периода: сумма дебетовых остатков отличается от кредитовых на ${osv.totals.startDiff.toFixed(2)} ₽. Обычно это означает незакрытый вспомогательный счёт 000 при вводе начальных остатков.`,
      quickFixLabel: 'Проверьте режим интерпретации остатков БД 1С во вкладке 1 (Начало / Конец периода)',
      guide1C: {
        menuPath: 'Главное → Помощник ввода остатков',
        documentKind: 'Ввод начальных остатков (в корреспонденции со счётом 000)',
        checkPoints: [
          'Проверьте, что по вспомогательному счёту 000 конечное сальдо на дату ввода остатков строго равно 0,00 ₽',
          'Сверьте остатки по расчётному счёту (51), уставному капиталу (80.09), расчётам с бюджетом (68, 69) и нераспределённой прибыли (84)',
        ],
        repostInstruction: 'Перепроведите документы «Ввод начальных остатков» на дату 31.12 предшествующего года',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость (общая по всем счетам, проверить отсутствие счёта 000)',
      },
      canAutoFixBy1C: false,
    });
  }

  if (!osv.totals.isTurnoverBalanced) {
    issues.push({
      id: 'osv-turnover-disbalance',
      severity: 'error',
      category: 'osv_disbalance',
      title: 'Нарушено равенство оборотов за период',
      description: `Обороты Дт (${osv.totals.turnoverDebit.toFixed(2)} ₽) не равны оборотам Кт (${osv.totals.turnoverCredit.toFixed(2)} ₽). Проверьте незаполненные счета проводок.`,
      accountingReason: `Обороты по Дебету и Кредиту за отчётный период расходятся на ${osv.totals.turnoverDiff.toFixed(2)} ₽ из-за односторонней проводки (не указан счёт Дт или Кт в ручной операции).`,
      quickFixLabel: 'Заполните пустой счёт проводки в карточке операции',
      guide1C: {
        menuPath: 'Операции → Операции, введенные вручную',
        documentKind: 'Операция (бухгалтерский и налоговый учет)',
        checkPoints: [
          'Проверьте каждую строку движений регистра бухгалтерии: должны быть заполнены оба счёта — Счет Дт и Счет Кт',
        ],
        repostInstruction: 'Запишите исправленную операцию кнопкой «Записать и закрыть»',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость за период',
      },
      canAutoFixBy1C: false,
    });
  }

  if (!osv.totals.isEndBalanced) {
    issues.push({
      id: 'osv-end-disbalance',
      severity: 'error',
      category: 'osv_disbalance',
      title: 'Нарушено равенство конечного сальдо ОСВ',
      description: `Сальдо на конец по Дебету (${osv.totals.endDebit.toFixed(2)} ₽) не равно Кредиту (${osv.totals.endCredit.toFixed(2)} ₽). Разница: ${osv.totals.endDiff.toFixed(2)} ₽.`,
      accountingReason: `Итоговый баланс активов и пассивов на конец периода нарушен на ${osv.totals.endDiff.toFixed(2)} ₽ вследствие дисбаланса входящих остатков или односторонних проводок.`,
      quickFixLabel: 'Устраните дисбаланс начального сальдо или незаполненных проводок',
      guide1C: {
        menuPath: 'Отчеты → Экспресс-проверка ведения учета',
        documentKind: 'Отчёт «Экспресс-проверка ведения учета»',
        checkPoints: [
          'Выполните проверку раздела «Положения учетной политики» и «Операции по кассе / банку / ведение книги покупок и продаж»',
          'Проверьте отсутствие остатка на счёте 000 и односторонних ручных проводок',
        ],
        repostInstruction: 'Операции → Закрытие месяца → Перепроведение документов за месяц',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость за отчётный период',
      },
      canAutoFixBy1C: false,
    });
  }

  // 2. Red balances ("краснота") on active / passive accounts
  const row51ForCover = osv.leafRows.find((r) => r.code === '51');
  for (const row of osv.leafRows) {
    if (row.hasRedEnd) {
      const val = row.type === 'active' ? row.endDebit : row.endCredit;
      const isSettlementReclassifiable =
        row.code === '60.01' ||
        row.code === '62.01' ||
        row.code === '60.02' ||
        row.code === '62.02';
      const isCashCoverableFromBank =
        row.code === '50.01' &&
        Boolean(row51ForCover && row51ForCover.endDebit >= Math.abs(val) + 0.01);
      const canFixRed = isSettlementReclassifiable || isCashCoverableFromBank;
      const redFixId: AutofixRuleId | undefined = isSettlementReclassifiable
        ? 'flip_red_settlement_subaccount'
        : isCashCoverableFromBank
          ? 'resolve_amount_and_links'
          : undefined;
      const redDetails = buildRedBalanceGuide1C(row.code, row.name, val);
      issues.push({
        id: `red-end-${row.code}`,
        fixId: redFixId,
        severity: 'error',
        category: 'red_balance',
        accountCode: row.code,
        title: `Отрицательный остаток («краснота») по счёту ${row.code}`,
        description: `Счёт ${row.code} «${row.name}» (${row.type === 'active' ? 'активный' : 'пассивный'}) имеет отрицательное конечное сальдо ${val.toFixed(2)} ₽.`,
        accountingReason: redDetails.accountingReason,
        quickFixLabel: isSettlementReclassifiable
          ? 'Нажмите «Исправить» для переклассификации и зачёта авансов'
          : isCashCoverableFromBank
            ? 'Нажмите «Исправить» для синхронизации пополнения кассы 50.01 с р/с 51'
            : 'Проверьте хронологию и полноту приходных документов по счёту ' + row.code,
        guide1C: redDetails.guide1C,
        canAutoFixBy1C: canFixRed,
        autoFixActionLabel: isSettlementReclassifiable
          ? 'Переклассифицировать расчёты / авансы (60.01↔60.02, 62.01↔62.02)'
          : isCashCoverableFromBank
            ? 'Синхронизировать пополнение кассы с р/с (Дт 50.01 Кт 51)'
            : undefined,
      });
    }
  }

  // 3. Unoffset advances: ONLY when the SAME counterparty simultaneously has open balances on 60.01 & 60.02 (or 62.01 & 62.02)
  const acc6001 = osv.leafRows.find((r) => r.code === '60.01');
  const acc6002 = osv.leafRows.find((r) => r.code === '60.02');
  if (acc6001 && acc6002 && acc6001.endCredit > 0.01 && acc6002.endDebit > 0.01) {
    const subs6001 = osv.subcontoRowsByAccount?.['60.01'] ?? [];
    const subs6002 = osv.subcontoRowsByAccount?.['60.02'] ?? [];
    let sameCpOffset60 = 0;
    const sameCpNames60: string[] = [];
    for (const s1 of subs6001) {
      if (s1.endCredit <= 0.01) continue;
      const k1 = normalizeEntityKey(s1.subcontoLabel.split('/')[0]);
      if (!k1) continue;
      const s2 = subs6002.find(
        (cand) => cand.endDebit > 0.01 && normalizeEntityKey(cand.subcontoLabel.split('/')[0]) === k1
      );
      if (s2) {
        sameCpOffset60 = round2(sameCpOffset60 + Math.min(s1.endCredit, s2.endDebit));
        sameCpNames60.push(s1.subcontoLabel.split('/')[0].trim());
      }
    }
    if (sameCpOffset60 > 0.01) {
      issues.push({
        id: 'unoffset-advance-60',
        fixId: 'offset_advances_60_62',
        severity: 'warning',
        category: 'unoffset_advance',
        accountCode: '60',
        title: 'Незачтённые авансы поставщикам (счета 60.01 и 60.02)',
        description: `По контрагенту(ам) ${sameCpNames60.join(', ')} одновременно числится кредиторская задолженность на 60.01 и выданный аванс на 60.02. Необходим зачёт на сумму ${sameCpOffset60.toFixed(2)} ₽.`,
        accountingReason: `Развёрнутое сальдо по одному и тому же поставщику на счёте 60 искажает строки бухгалтерского баланса. При поступлении ТМЦ/услуг после предоплаты должна формироваться проводка зачёта аванса Дт 60.01 Кт 60.02 на сумму ${sameCpOffset60.toFixed(2)} ₽.`,
        quickFixLabel: 'Автоматический зачёт Дт 60.01 Кт 60.02 кнопкой «Исправить»',
        guide1C: {
          menuPath: 'Покупки → Поступление (акты, накладные, УПД) (или Покупки → Корректировка долга)',
          documentKind: 'Поступление (акт, накладная, УПД)',
          checkPoints: [
            'В документе поступления проверьте ссылку «Расчеты»: Счет расчетов = 60.01, Счет авансов = 60.02, Зачет авансов = «Автоматически»',
            'Проверьте, что в Списании с р/с и в Поступлении выбран один и тот же элемент справочника «Договоры»',
            'Если договоры разные — оформите документ «Покупки → Корректировка долга» с видом операции «Зачет авансов»',
          ],
          repostInstruction: 'Перепроведите банковскую выписку и затем документ поступления («Провести и закрыть»)',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 60 (флаги «По субсчетам», «Контрагенты», «Договоры»)',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Сформировать зачёт авансов поставщикам (Дт 60.01 Кт 60.02)',
      });
    }
  }

  const acc6201 = osv.leafRows.find((r) => r.code === '62.01');
  const acc6202 = osv.leafRows.find((r) => r.code === '62.02');
  if (acc6201 && acc6202 && acc6201.endDebit > 0.01 && acc6202.endCredit > 0.01) {
    const subs6201 = osv.subcontoRowsByAccount?.['62.01'] ?? [];
    const subs6202 = osv.subcontoRowsByAccount?.['62.02'] ?? [];
    let sameCpOffset62 = 0;
    const sameCpNames62: string[] = [];
    for (const s1 of subs6201) {
      if (s1.endDebit <= 0.01) continue;
      const k1 = normalizeEntityKey(s1.subcontoLabel.split('/')[0]);
      if (!k1) continue;
      const s2 = subs6202.find(
        (cand) => cand.endCredit > 0.01 && normalizeEntityKey(cand.subcontoLabel.split('/')[0]) === k1
      );
      if (s2) {
        sameCpOffset62 = round2(sameCpOffset62 + Math.min(s1.endDebit, s2.endCredit));
        sameCpNames62.push(s1.subcontoLabel.split('/')[0].trim());
      }
    }
    if (sameCpOffset62 > 0.01) {
      issues.push({
        id: 'unoffset-advance-62',
        fixId: 'offset_advances_60_62',
        severity: 'warning',
        category: 'unoffset_advance',
        accountCode: '62',
        title: 'Незачтённые авансы покупателей (счета 62.01 и 62.02)',
        description: `По покупателю(ям) ${sameCpNames62.join(', ')} одновременно числится дебиторская задолженность на 62.01 и полученный аванс на 62.02. Необходим зачёт на сумму ${sameCpOffset62.toFixed(2)} ₽.`,
        accountingReason: `При отгрузке в счёт полученной предоплаты должен быть выполнен зачёт Дт 62.02 Кт 62.01 (${sameCpOffset62.toFixed(2)} ₽), иначе завышаются дебиторская и кредиторская задолженности и не применяется вычет НДС с аванса (Дт 68.02 Кт 76.АВ).`,
        quickFixLabel: 'Автоматический зачёт Дт 62.02 Кт 62.01 кнопкой «Исправить»',
        guide1C: {
          menuPath: 'Продажи → Реализация (акты, накладные, УПД) (или Продажи → Корректировка долга)',
          documentKind: 'Реализация (акт, накладная, УПД)',
          checkPoints: [
            'В документе реализации проверьте гиперссылку «Расчеты»: Счет расчетов = 62.01, Счет авансов = 62.02, Зачет авансов = «Автоматически»',
            'Сверьте «Договор» с документом «Поступление на расчетный счет»',
          ],
          repostInstruction: 'Перепроведите поступление оплаты и реализацию в хронологическом порядке, затем сформируйте «Формирование записей книги покупок»',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 62 и Анализ субконто «Контрагенты»',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Сформировать зачёт авансов покупателей (Дт 62.02 Кт 62.01)',
      });
    }
  }

  // Check unaccrued VAT on remaining buyer advances (62.02 > 0 in OSNO without sufficient 76.АВ) strictly per counterparty
  const isOsno = (db1C?.accountingPolicy.taxSystem ?? 'ОСНО') === 'ОСНО';
  const vatRate = db1C?.accountingPolicy.vatRate ?? 20;
  if (isOsno && vatRate > 0 && acc6202 && acc6202.endCredit > 0.01) {
    const subs6202 = (osv.subcontoRowsByAccount?.['62.02'] ?? []).filter(
      (s) => s.subcontoLabel !== 'Без аналитики (субконто)' && s.endCredit > 0.01
    );
    const subs76avByKey = new Map<string, number>();
    for (const sAv of osv.subcontoRowsByAccount?.['76.АВ'] ?? []) {
      if (sAv.endDebit > 0.01) {
        const k = normalizeEntityKey(sAv.subcontoLabel.split('/')[0] ?? '') || sAv.subcontoLabel;
        subs76avByKey.set(k, round2((subs76avByKey.get(k) ?? 0) + sAv.endDebit));
      }
    }
    let missing76AvTotal = 0;
    let totalExpected76AV = 0;
    let totalCurrent76AV = 0;
    if (subs6202.length > 0) {
      const adv6202ByKey = new Map<string, number>();
      for (const s62 of subs6202) {
        const k = normalizeEntityKey(s62.subcontoLabel.split('/')[0] ?? '') || s62.subcontoLabel;
        adv6202ByKey.set(k, round2((adv6202ByKey.get(k) ?? 0) + s62.endCredit));
      }
      for (const [k, remAdv] of adv6202ByKey.entries()) {
        const expAv = round2((remAdv * vatRate) / (100 + vatRate));
        const curAv = subs76avByKey.get(k) ?? 0;
        totalExpected76AV = round2(totalExpected76AV + expAv);
        totalCurrent76AV = round2(totalCurrent76AV + curAv);
        if (expAv - curAv > 1) {
          missing76AvTotal = round2(missing76AvTotal + (expAv - curAv));
        }
      }
    } else {
      totalExpected76AV = round2((acc6202.endCredit * vatRate) / (100 + vatRate));
      const acc76AV = osv.leafRows.find((r) => r.code === '76.АВ');
      totalCurrent76AV = acc76AV?.endDebit ?? 0;
      if (totalExpected76AV - totalCurrent76AV > 1) {
        missing76AvTotal = round2(totalExpected76AV - totalCurrent76AV);
      }
    }
    if (missing76AvTotal > 1) {
      issues.push({
        id: 'missing-advance-vat-76av',
        fixId: 'accrue_advance_vat_76av',
        severity: 'warning',
        category: 'vat_discrepancy',
        accountCode: '76.АВ',
        title: 'Не начислен НДС с полученных авансов покупателей (76.АВ — 68.02)',
        description: `По остатку авансов на счёте 62.02 (${acc6202.endCredit.toFixed(2)} ₽) расчётный НДС ${vatRate}/${100 + vatRate} составляет ${totalExpected76AV.toFixed(2)} ₽ (отражено на 76.АВ: ${totalCurrent76AV.toFixed(2)} ₽, не доначислено ${missing76AvTotal.toFixed(2)} ₽).`,
        accountingReason: `Согласно п. 1 ст. 167 НК РФ налогоплательщик на ОСНО обязан исчислить НДС по расчётной ставке ${vatRate}/${100 + vatRate} с суммы полученной предоплаты и выставить счёт-фактуру на аванс (Дт 76.АВ Кт 68.02).`,
        quickFixLabel: 'Сформировать СФ на аванс кнопкой «Исправить»',
        guide1C: {
          menuPath: 'Банк и касса → Регистрация счетов-фактур → Счета-фактуры на аванс',
          documentKind: 'Обработка «Регистрация счетов-фактур на аванс» → Счет-фактура выданный (на аванс)',
          checkPoints: [
            'Укажите период и нажмите кнопку «Заполнить», затем «Выполнить»',
            `Проверьте соответствие формулы: Сальдо Кт 62.02 × ${vatRate}/${100 + vatRate} = Сальдо Дт 76.АВ`,
          ],
          repostInstruction: 'Операции → Закрытие месяца / Помощник по учету НДС → перепроведите регламентные операции НДС',
          verifyInOsv: 'Отчеты → Экспресс-проверка ведения учета (раздел Ведение книги продаж) и Анализ счета 62.02 / 76.АВ',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Сформировать СФ на аванс (Дт 76.АВ Кт 68.02)',
      });
    }
  }

  // Check unaccepted input VAT sitting on 19.* (vat_discrepancy)
  if (isOsno) {
    const rows19 = osv.leafRows.filter((r) => r.code.startsWith('19.') && r.endDebit > 0.01);
    for (const r19 of rows19) {
      issues.push({
        id: `open-vat-${r19.code}`,
        severity: 'warning',
        category: 'vat_discrepancy',
        accountCode: r19.code,
        title: `Не принят к вычету входной НДС на счёте ${r19.code} (${r19.endDebit.toFixed(2)} ₽)`,
        description: `На конец периода на счёте ${r19.code} «${r19.name}» остался дебетовый остаток ${r19.endDebit.toFixed(2)} ₽ без вычета в Дт 68.02.`,
        accountingReason: `Входной НДС учтён при поступлении (Дт ${r19.code} Кт 60.01), но не списан в уменьшение налога к уплате (Дт 68.02 Кт ${r19.code}). Если оригинал счёта-фактуры или УПД со статусом «1» получен от поставщика, вычет применяется в текущем квартале (ст. 171–172 НК РФ).`,
        quickFixLabel: 'Отметьте наличие СФ/УПД в карточке операции во вкладке 2 или оставьте на 19 счёте при отсутствии оригинала СФ',
        guide1C: {
          menuPath: 'Покупки → Поступление (акты, накладные, УПД) / Операции → Помощник по учету НДС',
          documentKind: 'Счет-фактура полученный / Формирование записей книги покупок',
          checkPoints: [
            'В нижней части документа Поступление проверьте наличие номера и даты входящего СФ (или переключатель «УПД»)',
            'В документе «Счет-фактура полученный» проверьте установленный флажок «Отразить вычет НДС в книге покупок датой получения»',
            'Либо сформируйте документ «Операции → Регламентные операции НДС → Формирование записей книги покупок»',
          ],
          repostInstruction: 'Проведите «Счет-фактура полученный» или «Формирование записей книги покупок»',
          verifyInOsv: `Отчеты → Оборотно-сальдовая ведомость по счету ${r19.code} (в разрезе Контрагентов и Счетов-фактур полученных)`,
        },
        canAutoFixBy1C: false,
      });
    }
  }

  // 4. Unclosed month-end accounts (20.01, 25, 26, 44.01, 90, 91)
  const acc20 = osv.leafRows.find((r) => r.code === '20.01');
  if (acc20 && acc20.endDebit > 0.01) {
    // Check if the open 20.01 balance is legitimate Work-in-Progress (НЗП) on named projects without handover in the ending month
    const endMonthPrefix = (osv.dateTo ?? '').slice(0, 7);
    const hasClosingInEndMonth = operations.some(
      (o) =>
        o.includeInProcessing &&
        o.category === 'closing' &&
        (!endMonthPrefix || (o.date ?? '').startsWith(endMonthPrefix))
    );
    const hasExplicitWipPolicy = operations.some(
      (o) =>
        o.includeInProcessing &&
        (!endMonthPrefix || (o.date ?? '').startsWith(endMonthPrefix)) &&
        /незавер[шщ][её]нн\p{L}*\s+производств|(?:^|[^\p{L}])инвентаризаци\p{L}*\s+нзп/iu.test(
          o.description
        )
    );
    const subs20Open = (osv.subcontoRowsByAccount?.['20.01'] ?? []).filter((s) => s.endDebit >= 0.01);
    const allSubsAreNamedWipProjects =
      hasClosingInEndMonth &&
      subs20Open.length > 0 &&
      subs20Open.every((s) => {
        const head = s.subcontoLabel.split(' / ')[0].trim().toLowerCase();
        return (
          head !== '' &&
          head !== 'без аналитики (субконто)' &&
          head !== 'основная номенклатурная группа' &&
          head !== 'оплата труда' &&
          head !== 'страховые взносы' &&
          head !== 'материальные расходы' &&
          head !== 'амортизация'
        );
      });

    if (!hasExplicitWipPolicy && !allSubsAreNamedWipProjects) {
      issues.push({
        id: 'unclosed-20',
        fixId: 'close_period_accounts',
        severity: 'warning',
        category: 'unclosed_period',
        accountCode: '20.01',
        title: 'Остаток на счёте 20.01 «Основное производство»',
        description: `На конец периода на счёте 20.01 числится дебетовый остаток ${acc20.endDebit.toFixed(2)} ₽ (незавершённое производство или не выполнено закрытие счёта 20).`,
        accountingReason: `Если у организации нет незавершённого производства (НЗП), прямые производственные затраты по счёту 20.01 закрываются ежемесячно в Дт 90.02.1 (или 43/40) по завершённым номенклатурным группам.`,
        quickFixLabel: 'Нажмите «Исправить» для регламентного закрытия месяца',
        guide1C: {
          menuPath: 'Операции → Закрытие месяца',
          documentKind: 'Регламентная операция «Закрытие счетов 20, 23, 25, 26»',
          checkPoints: [
            'Проверьте совпадение субконто «Номенклатурная группа» на счёте 20.01 и выручки на счёте 90.01.1',
            'В «Главное → Учетная политика → Затраты» проверьте правила учёта прямых расходов и НЗП',
          ],
          repostInstruction: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 20.01 и Справка-расчет себестоимости',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Закрыть счёт 20.01 в Дт 90.02.1',
      });
    }
  }

  const acc25 = osv.leafRows.find((r) => r.code === '25');
  if (acc25 && acc25.endDebit > 0.01) {
    issues.push({
      id: 'unclosed-25',
      fixId: 'close_period_accounts',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '25',
      title: 'Не закрыт счёт 25 «Общепроизводственные расходы»',
      description: `На конец периода на счёте 25 числится остаток ${acc25.endDebit.toFixed(2)} ₽. По РСБУ счёт 25 не имеет конечного сальдо.`,
      accountingReason: `Общепроизводственные расходы ежемесячно распределяются со счёта 25 в дебет счёта 20.01 пропорционально базе распределения (Инструкция к Плану счетов РСБУ, ФСБУ 5/2019).`,
      quickFixLabel: 'Закрыть счёт 25 кнопкой «Исправить»',
      guide1C: {
        menuPath: 'Операции → Закрытие месяца',
        documentKind: 'Регламентная операция «Закрытие счетов 20, 23, 25, 26»',
        checkPoints: ['Проверьте подразделение и базу распределения косвенных расходов в Учётной политике'],
        repostInstruction: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 25 (сальдо = 0,00 ₽)',
      },
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Закрыть счёт 25 в основное производство',
    });
  }

  const acc26 = osv.leafRows.find((r) => r.code === '26');
  if (acc26 && acc26.endDebit > 0.01) {
    issues.push({
      id: 'unclosed-26',
      fixId: 'close_period_accounts',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '26',
      title: 'Не закрыт счёт 26 «Общехозяйственные расходы»',
      description: `На конец периода на счёте 26 числится остаток ${acc26.endDebit.toFixed(2)} ₽. По РСБУ счёт 26 закрывается ежемесячно.`,
      accountingReason: `Общехозяйственные (управленческие) расходы по ФСБУ 5/2019 и Инструкции к Плану счетов не формируют остаток НЗП и в полном объёме списываются в Дт 90.08.1 («Директ-костинг») на конец каждого месяца.`,
      quickFixLabel: 'Закрыть счёт 26 кнопкой «Исправить»',
      guide1C: {
        menuPath: 'Операции → Закрытие месяца',
        documentKind: 'Регламентная операция «Закрытие счетов 20, 23, 25, 26»',
        checkPoints: [
          'Проверьте заполнение субконто «Подразделения» и «Статьи затрат» во всех документах отнесения расходов на счёт 26',
          'В «Главное → Учетная политика» убедитесь, что управленческие расходы списываются на счёт 90.08.1 (директ-костинг)',
        ],
        repostInstruction: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 26 (конечное сальдо = 0,00 ₽)',
      },
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Закрыть счёт 26 регламентной операцией',
    });
  }

  const acc4401 = osv.leafRows.find((r) => r.code === '44.01');
  if (acc4401 && acc4401.endDebit > 0.01) {
    issues.push({
      id: 'unclosed-44',
      fixId: 'close_period_accounts',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '44.01',
      title: 'Не закрыт счёт 44.01 «Издержки обращения»',
      description: `На конец периода на счёте 44.01 числится остаток ${acc4401.endDebit.toFixed(2)} ₽.`,
      accountingReason: `Коммерческие расходы торговой организации (кроме транспортных расходов в доле остатка товаров) ежемесячно списываются со счёта 44.01 в дебет счёта 90.07.1 / 90.02.1.`,
      quickFixLabel: 'Закрыть счёт 44.01 кнопкой «Исправить»',
      guide1C: {
        menuPath: 'Операции → Закрытие месяца',
        documentKind: 'Регламентная операция «Закрытие счета 44 "Издержки обращения"»',
        checkPoints: [
          'Проверьте вид расхода в справочнике «Статьи затрат» (прочие расходы списываются полностью, транспортные — пропорционально остатку на 41 счёте)',
        ],
        repostInstruction: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 44.01 и Справка-расчет «Списание косвенных расходов»',
      },
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Списать расходы на продажу в Дт 90.02.1',
    });
  }

  const group90 = osv.rows.find((r) => r.code === '90' && r.isGroup);
  if (group90 && (group90.endDebit > 0.01 || group90.endCredit > 0.01)) {
    const residual = group90.endCredit > 0 ? group90.endCredit : -group90.endDebit;
    issues.push({
      id: 'unclosed-90',
      fixId: 'close_period_accounts',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '90',
      title: 'Не закрыт счёт 90 «Продажи» на финансовый результат (90.09 — 99.01.1)',
      description: `Синтетический счёт 90 имеет ненулевое свёрнутое сальдо на конец периода (${Math.abs(residual).toFixed(2)} ₽).`,
      accountingReason: `По Плану счетов РСБУ синтетический счёт 90 на конец каждого месяца не должен иметь сальдо (субсчета 90.01, 90.02, 90.03, 90.08 накапливают обороты в течение года, а финансовый результат месяца переносится проводкой 90.09 ↔ 99.01.1).`,
      quickFixLabel: 'Закрыть счёт 90 кнопкой «Исправить»',
      guide1C: {
        menuPath: 'Операции → Закрытие месяца',
        documentKind: 'Регламентная операция «Закрытие счетов 90, 91»',
        checkPoints: [
          'Убедитесь, что перед закрытием счёта 90 выполнены операции закрытия счетов 20, 26 и 44',
          'В декабре дополнительно выполняется операция «Реформация баланса» для закрытия субсчетов 90.01–90.09 и переноса 99 на 84',
        ],
        repostInstruction: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 90 (свёрнутое сальдо по счёту 90 в целом = 0,00 ₽)',
      },
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Сформировать закрытие счёта 90 (90.09 ↔ 99.01.1)',
    });
  }

  const group91 = osv.rows.find((r) => r.code === '91' && r.isGroup);
  if (group91 && (group91.endDebit > 0.01 || group91.endCredit > 0.01)) {
    const residual = group91.endCredit > 0 ? group91.endCredit : -group91.endDebit;
    issues.push({
      id: 'unclosed-91',
      fixId: 'close_period_accounts',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '91',
      title: 'Не закрыт счёт 91 «Прочие доходы и расходы» (91.09 — 99.01.1)',
      description: `Синтетический счёт 91 имеет ненулевое свёрнутое сальдо на конец периода (${Math.abs(residual).toFixed(2)} ₽).`,
      accountingReason: `Сопоставление оборотов по прочим доходам (91.01) и прочим расходам (91.02, включая РКО банка и проценты) ежемесячно списывается с субсчёта 91.09 на счёт 99.01.1.`,
      quickFixLabel: 'Закрыть счёт 91 кнопкой «Исправить»',
      guide1C: {
        menuPath: 'Операции → Закрытие месяца',
        documentKind: 'Регламентная операция «Закрытие счетов 90, 91»',
        checkPoints: [
          'Проверьте заполнение субконто «Прочие доходы и расходы» в документах по счетам 91.01 и 91.02',
        ],
        repostInstruction: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
        verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 91 (сальдо в целом по счёту 91 = 0,00 ₽)',
      },
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Сформировать закрытие счёта 91 (91.09 ↔ 99.01.1)',
    });
  }

  const hasDecemberActivity = operations.some(
    (o) => o.includeInProcessing && (o.date ?? '').slice(5, 7) === '12'
  );
  if ((osv.dateTo ?? '').endsWith('-12-31') && hasDecemberActivity) {
    const openRows99 = osv.leafRows.filter(
      (r) => (r.code.startsWith('99.') || r.code === '99') && (r.endCredit > 0.01 || r.endDebit > 0.01)
    );
    if (openRows99.length > 0) {
      const bal99 = openRows99.reduce((s, r) => s + (r.endCredit - r.endDebit), 0);
      issues.push({
        id: 'unclosed-99-reformation',
        fixId: 'close_period_accounts',
        severity: 'warning',
        category: 'unclosed_period',
        accountCode: openRows99[0].code,
        title: 'На 31 декабря не выполнена реформация баланса (счёт 99 не закрыт на счёт 84)',
        description: `По состоянию на 31.12 на субсчетах счёта 99 (${openRows99.map((r) => r.code).join(', ')}) сохраняется незакрытое сальдо (${Math.abs(bal99).toFixed(2)} ₽).`,
        accountingReason:
          'Заключительными записями декабря (регламентная операция «Реформация баланса») сальдо всех субсчетов счёта 99 (99.01.1, 99.02.1) списывается на счёт 84 «Нераспределённая прибыль (непокрытый убыток)», а внутренние субсчета 90 и 91 закрываются на 90.09 и 91.09.',
        quickFixLabel: 'Выполнить реформацию баланса кнопкой «Исправить»',
        guide1C: {
          menuPath: 'Операции → Закрытие месяца',
          documentKind: 'Регламентная операция декабря «Реформация баланса»',
          checkPoints: [
            'Откройте «Операции → Закрытие месяца» за декабрь отчётного года',
            'Убедитесь, что выполнена строка «Реформация баланса» и конечное сальдо счёта 99 равно 0,00 ₽',
          ],
          repostInstruction: 'Операции → Закрытие месяца → Декабрь → Выполнить закрытие месяца',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость за год (сальдо по счёту 99 и всем субсчетам 90.*, 91.* = 0,00 ₽)',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Выполнить реформацию баланса (99 → 84)',
      });
    }
  }

  // 5. Per-operation requisite, amount & posting checks
  for (const op of operations) {
    if (op.isDuplicateIn1C && op.includeInProcessing) {
      issues.push({
        id: `dup-enabled-${op.id}`,
        fixId: 'disable_duplicate_doc',
        severity: 'warning',
        category: 'duplicate_doc',
        operationId: op.id,
        title: `Включён дубликат документа: ${op.description.slice(0, 60)}`,
        description:
          op.duplicateReason ??
          'Операция совпадает с уже проведённым документом в БД 1С и может задвоить обороты.',
        accountingReason: `Повторное проведение первичного документа с той же датой, суммой и контрагентом задвоит обороты по счетам расчётов и налоговую базу по НДС / налогу на прибыль.`,
        quickFixLabel: 'Нажмите «Исправить» или снимите галочку включения документа во вкладке 2',
        guide1C: {
          menuPath: 'Администрирование → Обслуживание → Корректировка данных → Поиск и удаление дублей (или Журнал операций)',
          documentKind: op.docType1C,
          checkPoints: [
            'Откройте Карточку счёта 51 / 60 / 62 за дату документа и проверьте, не введён ли документ дважды',
            'Лишний экземпляр документа пометьте на удаление (Пометить на удаление → Удаление помеченных объектов)',
          ],
          repostInstruction: 'После помечания дубля на удаление перепроведите закрытие месяца',
          verifyInOsv: 'Отчеты → Акт сверки расчетов с контрагентом и Карточка счета 60 / 62',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Исключить дубликат из загрузки',
      });
    }
  }

  for (const op of activeOps) {
    if (op.autoGeneratedKind) continue;

    // Detect misclassified operations (e.g. cash withdrawal, accountable person, shipment, warehouse/HR/OS saved as ПоступлениеТоваровУслуг)
    const naturalCheck = detectOperationClassification({
      description: op.description,
      nomenclatureName: op.nomenclatureName,
      counterpartyName: op.counterpartyName,
    });
    const isReclassifiableLegacy = isMisclassifiedLegacyOperation(op);

    if (isReclassifiableLegacy) {
      const targetNeedsCp = doesOperationRequireCounterparty(naturalCheck.category);
      issues.push({
        id: `misclassified-doc-${op.id}`,
        fixId: 'reclassify_legacy_doc',
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Операция оформлена как «${op.docType1C}» вместо «${naturalCheck.docType1C}»`,
        description: targetNeedsCp
          ? `Операция «${op.description.slice(0, 70)}» по содержанию соответствует «${DOC_TYPE_LABELS_1C[naturalCheck.docType1C]}». Нажмите «Исправить» для переклассификации документа и пересчёта НДС/проводок.`
          : `Операция «${op.description.slice(0, 70)}» распознана как «${DOC_TYPE_LABELS_1C[naturalCheck.docType1C]}», не требует внешнего контрагента и НДС.`,
        accountingReason: `В 1С:Бухгалтерия 8.3 (ред. 3.0) кассово-банковские перемещения (50↔51), подотчётные суммы (71.01), отгрузки продукции (90.01.1), кадровые, договорные и складские документы проводятся профильными видами операций с корректным режимом НДС.`,
        quickFixLabel: 'Нажмите «Исправить» для переклассификации документа и пересчёта проводок',
        guide1C: {
          menuPath: 'Банк и касса / Продажи / Склад / Зарплата и кадры',
          documentKind: `${naturalCheck.docType1C} (${DOC_TYPE_LABELS_1C[naturalCheck.docType1C]})`,
          checkPoints: [
            `Замените вид документа на «${DOC_TYPE_LABELS_1C[naturalCheck.docType1C]}»`,
            targetNeedsCp
              ? 'Проверьте расчёт НДС («по цене без НДС» = +20% сверху) и привязку покупателя/поставщика'
              : 'Проверьте отсутствие лишнего счёта 60/62 и НДС 19/68.02',
          ],
          repostInstruction: 'Проведите документ и проверьте движения Дт/Кт',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: `Переклассифицировать в 1С: ${naturalCheck.docType1C}`,
      });
    }

    // Missing primary amount check ("Требуется сумма") — NEVER flag HR orders, writs, contract/policy events, valid calculated_by_1c (>0), neutral manual ops, or reclassifiable operations!
    const isCalculatedBy1C =
      ((op.amountMode === 'calculated_by_1c' ||
        op.category === 'payroll_accrual' ||
        op.category === 'insurance_accrual') &&
        (op.amount >= 0.01 || op.entries.length > 0)) ||
      doesSpecAllowZeroPostings(op.category) ||
      op.category === 'closing' ||
      op.category === 'manual' ||
      naturalCheck.category === 'manual' ||
      isReclassifiableLegacy;
    if (
      !isCalculatedBy1C &&
      (op.amountMode === 'required_missing' ||
        ((op.needsAmount || op.amount < 0.01) && !doesSpecAllowZeroPostings(op.category)))
    ) {
      const checkedSources = op.resolverTrace?.checkedSourcesWhenMissing;
      const checkedSummary =
        checkedSources && checkedSources.length > 0
          ? `Проверены все 7 уровней замкнутого контура задания: ${checkedSources.join('; ')}.`
          : 'Проверены все 7 уровней замкнутого контура задания (колонка суммы Excel, формулы в тексте строки, встречные расчёты 60/62, периодические договоры, остатки счетов 68/69/70/76.41/08/10/41/43, регистры ФОТ/ОС/НМА/векселей и история базы 1С) — числовое основание во входных файлах не найдено.';
      issues.push({
        id: `missing-amount-${op.id}`,
        severity: 'error',
        category: 'missing_amount',
        operationId: op.id,
        title: `Требуется уточнить сумму внешней операции: «${op.description.slice(0, 58)}»`,
        description: checkedSummary,
        accountingReason:
          'Для формирования проводок внешнего расчётного документа в контуре задания должно присутствовать числовое основание (сумма в колонке, количество × цена, условие договора, встречный документ контура или остаток счёта расчётов). Поскольку во входных данных сумма не задана, укажите её в поле ввода.',
        quickFixLabel: 'Введите сумму операции в поле ввода и нажмите «Применить»',
        guide1C: {
          menuPath: getDocumentSpecForOperation(op).menuPath1C,
          documentKind: op.docType1C,
          checkPoints: [
            'Проверьте условие учебного задания (таблицу исходных данных или примечание к хозяйственной операции)',
            'При оплате задолженности сверьте сальдо соответствующего счёта расчётов в ОСВ на дату операции',
          ],
          repostInstruction: 'Укажите сумму в документе → нажмите «Провести и закрыть»',
          verifyInOsv: 'Отчеты → Движения документа (кнопка Дт/Кт в шапке документа 1С)',
        },
        canAutoFixBy1C: false,
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'amount',
          label: `Сумма операции (${op.date}): ${op.description.slice(0, 40)}`,
          placeholder: 'Сумма в рублях, например: 120000',
          currentValue: op.amount > 0 ? String(op.amount) : '',
        },
      });
    }

    const needsCp = !isReclassifiableLegacy && doesOperationRequireCounterparty(op.category);

    const trimmedCpName = op.counterpartyName.trim();
    const isMatchedIn1C =
      trimmedCpName.length >= 2 &&
      (op.bindings.counterparty.status === 'matched_1c' ||
        matchPersonOrCounterpartyIn1C(trimmedCpName, op.counterpartyInn, db1C) !== null);

    if (needsCp && trimmedCpName.length < 2) {
      const canResolveFounder =
        isFounderContributionText(op.description) &&
        Boolean(
          extractFounderFioFromDescription(op.description) ||
            findPersonMentionedInDescription1C(op.description, db1C)
        );
      const contextCpMatches = computeContextCounterpartySuggestions(op, operations, db1C);
      // Provable Autofix Contract: mark canAutoFixBy1C === true ONLY when there is a UNIQUE deterministic match
      const canAutoLinkUniqueCp = contextCpMatches.length === 1;
      const canFixCpName = canResolveFounder || canAutoLinkUniqueCp;
      issues.push({
        id: `missing-cp-name-${op.id}`,
        fixId: canFixCpName ? 'resolve_amount_and_links' : undefined,
        severity: canAutoLinkUniqueCp ? 'warning' : 'error',
        category: 'missing_requisite',
        operationId: op.id,
        title: 'Не указано наименование контрагента',
        description: canAutoLinkUniqueCp
          ? `Документ «${op.description.slice(0, 70)}»: контрагент «${contextCpMatches[0].name}» однозначно определяется по связанным расчётам (${contextCpMatches[0].provenanceLabel}) — нажмите «Исправить».`
          : contextCpMatches.length > 1
            ? `Документ «${op.description.slice(0, 70)}»: найдено несколько кандидатов (${contextCpMatches
                .map((c) => c.name)
                .join(', ')}) — выберите нужного контрагента.`
            : `Документ «${op.description.slice(0, 70)}» (${op.amount.toFixed(2)} ₽): выберите контрагента из базы 1С или введите наименование (от 2 символов).`,
        accountingReason:
          'Субконто «Контрагенты» является обязательным аналитическим разрезом по счетам 60, 62 и 76 в 1С БП 3.0. Без указания контрагента невозможна сверка расчётов и заполнение книг покупок/продаж.',
        quickFixLabel: canFixCpName
          ? 'Нажмите «Исправить» для автопривязки контрагента по связанным расчётам'
          : 'Выберите контрагента из базы 1С или введите наименование и нажмите «Применить»',
        guide1C: {
          menuPath: getDocumentSpecForOperation(op).menuPath1C,
          documentKind: op.docType1C,
          checkPoints: [
            'В поле «Контрагент» документа выберите существующий элемент или создайте новую карточку по ИНН («Заполнить по ИНН»)',
          ],
          repostInstruction: 'Заполните поле «Контрагент» и «Договор» → «Провести и закрыть»',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 60 / 62 (проверить отсутствие пустого субконто «<...>»)',
        },
        canAutoFixBy1C: canFixCpName,
        autoFixActionLabel: canFixCpName ? 'Привязать контрагента автоматически' : undefined,
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'counterpartyName',
          label: 'Наименование контрагента',
          placeholder: 'Например: ООО «Комус»',
          currentValue: trimmedCpName.length >= 2 ? trimmedCpName : '',
        },
      });
    } else if (
      needsCp &&
      !isMatchedIn1C &&
      !trimmedCpName.includes(';') &&
      op.counterpartyKind !== 'ФизическоеЛицо' &&
      !isFounderContributionText(op.description) &&
      !isValidRussianInnFormat(op.counterpartyInn)
    ) {
      const resolvable = canResolveCounterpartyFrom1C(op, db1C);
      const isEducational = op.counterpartySource === 'educational_unverified';
      issues.push({
        id: `missing-inn-${op.id}`,
        fixId: 'fill_formal_requisites',
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: isEducational
          ? `Учебный контрагент: ${trimmedCpName} — ИНН/КПП готовы к автозаполнению`
          : `Не заполнен ИНН контрагента: ${trimmedCpName}`,
        description: resolvable
          ? `Контрагент найден в базе 1С — реквизиты подтянутся автоматически кнопкой «Исправить».`
          : `Формальный реквизит карточки «${trimmedCpName}» (на сальдо и обороты ОСВ не влияет): нажмите «Исправить» для подстановки ИНН/КПП по ЕГРЮЛ или генерации валидного учебного ИНН/КПП с контрольной цифрой ФНС.`,
        accountingReason: `По п. 5 ст. 169 НК РФ ИНН и КПП указываются в карточке контрагента и счёте-фактуре (ФЛК разделов 8 и 9 декларации по НДС). На бухгалтерские проводки и баланс ОСВ реквизит ИНН не влияет.`,
        quickFixLabel: 'Нажмите «Исправить» для автоматического заполнения ИНН/КПП или укажите вручную',
        guide1C: {
          menuPath: 'Справочники → Покупки и продажи → Контрагенты',
          documentKind: 'Справочник «Контрагенты» (карточка элемента)',
          checkPoints: [
            'Откройте карточку контрагента → заполните ИНН (10 цифр для ЮЛ / 12 для ИП) и КПП (9 цифр для ЮЛ)',
            'Для учебной организации используйте валидный ИНН региона организации с корректной контрольной цифрой ФНС',
          ],
          repostInstruction: 'Нажмите «Записать и закрыть» в карточке контрагента',
          verifyInOsv: 'Отчеты → Экспресс-проверка ведения учета (контроль ИНН/КПП контрагентов)',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: resolvable
          ? 'Подтянуть ИНН/КПП из базы 1С'
          : 'Заполнить ИНН/КПП автоматически',
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'counterpartyInn',
          label: `ИНН контрагента: ${trimmedCpName}`,
          placeholder: '10 или 12 цифр ИНН',
          currentValue: op.counterpartyInn,
        },
      });
    } else if (
      needsCp &&
      !isMatchedIn1C &&
      !trimmedCpName.includes(';') &&
      op.counterpartyKind !== 'ФизическоеЛицо' &&
      !isFounderContributionText(op.description) &&
      isValidRussianInnFormat(op.counterpartyInn) &&
      op.counterpartySource === 'manual'
    ) {
      const checkRes = validateRussianInnChecksum(op.counterpartyInn);
      if (!checkRes.valid) {
        issues.push({
          id: `invalid-inn-checksum-${op.id}`,
          fixId: 'fill_formal_requisites',
          severity: 'warning',
          category: 'missing_requisite',
          operationId: op.id,
          title: `Проверьте контрольную цифру ИНН у «${trimmedCpName}»`,
          description:
            checkRes.reason ||
            'Введённый ИНН не проходит проверку контрольного числа по алгоритму ФНС России — нажмите «Исправить» для коррекции контрольного разряда.',
          accountingReason:
            'В 1С:Бухгалтерия 8.3 встроен контроль ИНН по весовым коэффициентам ФНС (модуль 11). Опечатка в одной цифре приведёт к предупреждению ФЛК книги покупок/продаж.',
          quickFixLabel: 'Нажмите «Исправить» для подстановки валидного ИНН/КПП по контрольному числу ФНС',
          canAutoFixBy1C: true,
          autoFixActionLabel: 'Исправить контрольную цифру ИНН',
          inlineTarget: {
            kind: 'operation_field',
            operationId: op.id,
            field: 'counterpartyInn',
            label: `ИНН контрагента: ${trimmedCpName}`,
            placeholder: '10 или 12 цифр ИНН с верной контрольной суммой',
            currentValue: op.counterpartyInn,
          },
        });
      }
    }

    if (
      needsCp &&
      !isMatchedIn1C &&
      !trimmedCpName.includes(';') &&
      trimmedCpName.length >= 2 &&
      op.counterpartyKind === 'ЮридическоеЛицо' &&
      isValidRussianInnFormat(op.counterpartyInn) &&
      op.counterpartyInn.replace(/\D/g, '').length === 10 &&
      op.counterpartyKpp.replace(/\D/g, '').length !== 9
    ) {
      issues.push({
        id: `missing-kpp-${op.id}`,
        fixId: 'fill_formal_requisites',
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не указан КПП юрлица: ${trimmedCpName}`,
        description:
          'Для корректного формирования книги покупок/продаж и счёта-фактуры в 1С БП 3.0 требуется КПП (9 цифр).',
        accountingReason: `Для российской организации (10-значный ИНН) КПП состоит из 9 цифр (первые 4 — код ИФНС, далее «01001» для головной организации).`,
        quickFixLabel: 'Нажмите «Исправить» для автоматической подстановки КПП (9 цифр)',
        guide1C: {
          menuPath: 'Справочники → Контрагенты → Карточка контрагента',
          documentKind: 'Справочник «Контрагенты»',
          checkPoints: [
            'Проверьте поле «КПП» (9 знаков, для головного подразделения обычно первые 4 цифры ИНН + 01001)',
          ],
          repostInstruction: 'Запишите карточку контрагента («Записать и закрыть»)',
          verifyInOsv: 'Отчеты → Книга покупок / Книга продаж (колонка ИНН/КПП продавца/покупателя)',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Заполнить КПП автоматически',
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'counterpartyKpp',
          label: `КПП контрагента: ${trimmedCpName}`,
          placeholder: '9 цифр КПП',
          currentValue: op.counterpartyKpp,
        },
      });
    }

    if (op.bindings.contract.status === 'missing') {
      issues.push({
        id: `missing-contract-${op.id}`,
        fixId: 'fill_formal_requisites',
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не заполнен договор контрагента (${op.counterpartyName || 'без имени'})`,
        description:
          'Счета 60 и 62 в 1С БП 3.0 ведутся в разрезе субконто «Договоры». Автоисправление подберёт договор из БД 1С или создаст основной договор.',
        accountingReason: `Без субконто «Договоры» в 1С БП 3.0 не работает автоматический зачёт авансов между платёжным поручением и накладной/актом.`,
        quickFixLabel: 'Нажмите «Исправить» для привязки/создания основного договора',
        guide1C: {
          menuPath: 'Справочники → Контрагенты → Договоры',
          documentKind: `${op.docType1C} (реквизит «Договор»)`,
          checkPoints: [
            `Проверьте вид договора: «${['bank_in', 'sale_goods', 'sale_services'].includes(op.category) ? 'С покупателем' : 'С поставщиком'}»`,
            'Выберите один и тот же договор и в банковской выписке, и в товарной накладной / акте',
          ],
          repostInstruction: 'Заполните поле «Договор» → «Провести и закрыть»',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 60 / 62 с детализацией по субконто «Договоры»',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Подобрать / создать основной договор',
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'contractName',
          label: `Договор (${op.counterpartyName || op.docType1C})`,
          placeholder: 'Например: Основной договор / Договор № 12',
          currentValue: op.contractName,
        },
      });
    }

    if (op.bindings.warehouse.status === 'missing') {
      issues.push({
        id: `missing-warehouse-${op.id}`,
        fixId: 'fill_formal_requisites',
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не указан склад учёта МПЗ (${op.docType1C})`,
        description: 'Для проведения документа движения ТМЦ в 1С БП 3.0 требуется реквизит «Склад».',
        accountingReason: `Количественно-суммовой учёт на счетах 10, 41 и 43 ведётся в разрезе субконто «Склады». Несовпадение или отсутствие склада блокирует списание себестоимости при отгрузке.`,
        quickFixLabel: 'Нажмите «Исправить» для подстановки основного склада учёта',
        guide1C: {
          menuPath: 'Справочники → Товары и услуги → Склады',
          documentKind: op.docType1C,
          checkPoints: [
            'Укажите «Основной склад» (тип склада: Оптовый) в шапке накладной поступления/реализации',
          ],
          repostInstruction: 'Выберите склад → «Провести и закрыть»',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 41.01 / 10.01 с группировкой по Складам',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Проставить основной склад',
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'warehouseName',
          label: `Склад (${op.description.slice(0, 35)})`,
          placeholder: 'Например: Основной склад',
          currentValue: op.warehouseName,
        },
      });
    }

    if (op.bindings.expenseItem.status === 'missing') {
      issues.push({
        id: `missing-expense-${op.id}`,
        fixId: 'fill_formal_requisites',
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не выбрана статья затрат (${op.description.slice(0, 45)})`,
        description:
          'Для затратных счетов (20, 26, 44) необходимо заполнить аналитику «Статьи затрат».',
        accountingReason: `Аналитика «Статьи затрат» определяет порядок закрытия затратных счетов в бухгалтерском учёте и классификацию прямых/косвенных расходов в налоговом учёте (ст. 318 НК РФ).`,
        quickFixLabel: 'Нажмите «Исправить» для автоподбора статьи затрат',
        guide1C: {
          menuPath: 'Справочники → Доходы и расходы → Статьи затрат',
          documentKind: op.docType1C,
          checkPoints: [
            'В табличной части «Услуги» откройте колонку «Счет учета» и выберите подходящую Статью затрат (вид расхода НУ: Прочие расходы / Материальные / Аренда)',
          ],
          repostInstruction: 'Проведите документ и перезапустите «Операции → Закрытие месяца»',
          verifyInOsv: 'Отчеты → Анализ субконто «Статьи затрат» и ОСВ по счёту 26 / 20 / 44',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Подобрать статью затрат',
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'expenseItemName',
          label: `Статья затрат (${op.counterpartyName || op.docType1C})`,
          placeholder: 'Например: Прочие расходы / Аренда помещений',
          currentValue: op.expenseItemName,
        },
      });
    }

    if (
      op.entries.length === 0 &&
      !doesSpecAllowZeroPostings(op.category) &&
      op.category !== 'closing' &&
      !op.needsAmount &&
      op.amount >= 0.01
    ) {
      issues.push({
        id: `empty-entries-${op.id}`,
        fixId: 'resolve_amount_and_links',
        severity: 'error',
        category: 'unbalanced_entry',
        operationId: op.id,
        title: `Отсутствуют проводки у операции «${op.description.slice(0, 50)}»`,
        description: 'Операция включена в расчёт, но список проводок пуст.',
        accountingReason: `Непроведённый документ не отражается в регистре бухгалтерии и искажает ОСВ.`,
        quickFixLabel: 'Нажмите «Исправить» для генерации проводок РСБУ',
        guide1C: {
          menuPath: getDocumentSpecForOperation(op).menuPath1C,
          documentKind: op.docType1C,
          checkPoints: ['Откройте документ и нажмите «Провести» (проверьте движения по кнопке Дт/Кт)'],
          repostInstruction: 'Провести и закрыть',
          verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость за период',
        },
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Сформировать проводки РСБУ',
      });
    }

    for (const entry of op.entries) {
      // Unilateral off-balance entries (e.g. Дт МЦ.02, Дт МЦ.04) do not have a second balance-sheet account
      if (
        entry.isOffBalance ||
        isOffBalanceAccountCode(entry.debit) ||
        isOffBalanceAccountCode(entry.credit)
      ) {
        continue;
      }
      const dtOk = Boolean(entry.debit && entry.debit !== '000');
      const ktOk = Boolean(entry.credit && entry.credit !== '000');
      if (!dtOk || !ktOk) {
        issues.push({
          id: `missing-acc-${entry.id}`,
          severity: 'error',
          category: 'unbalanced_entry',
          operationId: op.id,
          title: `Не указан счёт ${!dtOk ? 'Дебета' : 'Кредита'} в проводке`,
          description: `Операция «${op.description.slice(0, 60)}» на сумму ${entry.amount.toFixed(2)} ₽ содержит незаполненный счёт.`,
          accountingReason: `Проводка без корреспондирующего счёта нарушает принцип двойной записи и разрывает баланс ОСВ.`,
          quickFixLabel: 'Укажите рабочий субсчёт Плана счетов в поле ввода',
          guide1C: {
            menuPath: getDocumentSpecForOperation(op).menuPath1C,
            documentKind: op.docType1C,
            checkPoints: ['Заполните Счет Дт и Счет Кт конечными субсчетами Плана счетов 1С БП 3.0'],
            repostInstruction: 'Записать и закрыть',
            verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость',
          },
          canAutoFixBy1C: false,
          inlineTarget: {
            kind: 'entry_account',
            operationId: op.id,
            entryId: entry.id,
            side: !dtOk ? 'debit' : 'credit',
            label: `Счёт ${!dtOk ? 'Дт' : 'Кт'} (${op.description.slice(0, 35)})`,
            placeholder: 'Например: 26 или 60.01',
            currentValue: !dtOk ? entry.debit : entry.credit,
          },
        });
      } else {
        const dtInfo = getAccountInfo(entry.debit);
        const ktInfo = getAccountInfo(entry.credit);
        if (dtInfo.isGroup) {
          issues.push({
            id: `group-dt-${entry.id}`,
            fixId: 'replace_group_account',
            severity: 'warning',
            category: 'missing_requisite',
            operationId: op.id,
            accountCode: entry.debit,
            title: `Указан групповой счёт Дт ${entry.debit} вместо субсчёта`,
            description: `В 1С БП 3.0 проводки формируются по конечным субсчетам (например, ${entry.debit}.01 вместо ${entry.debit}).`,
            accountingReason: `В Плане счетов 1С БП 3.0 у счёта-группы ${entry.debit} установлен признак «Запретить использование в проводках» — платформа не позволит записать движение без выбора субсчёта.`,
            quickFixLabel: 'Заменить на рабочий субсчёт кнопкой «Исправить»',
            guide1C: {
              menuPath: 'Главное → План счетов → Счет ' + entry.debit,
              documentKind: op.docType1C,
              checkPoints: [`Выберите открытый субсчёт (например, ${entry.debit}.01) вместо счёта-группы ${entry.debit}`],
              repostInstruction: 'Перепроведите документ после замены субсчёта',
              verifyInOsv: `Отчеты → Оборотно-сальдовая ведомость по счету ${entry.debit} (по субсчетам)`,
            },
            canAutoFixBy1C: true,
            autoFixActionLabel: `Заменить счёт ${entry.debit} на субсчёт`,
            inlineTarget: {
              kind: 'entry_account',
              operationId: op.id,
              entryId: entry.id,
              side: 'debit',
              label: `Уточните субсчёт Дт (вместо ${entry.debit})`,
              placeholder: `${entry.debit}.01`,
              currentValue: entry.debit,
            },
          });
        }
        if (ktInfo.isGroup) {
          issues.push({
            id: `group-kt-${entry.id}`,
            fixId: 'replace_group_account',
            severity: 'warning',
            category: 'missing_requisite',
            operationId: op.id,
            accountCode: entry.credit,
            title: `Указан групповой счёт Кт ${entry.credit} вместо субсчёта`,
            description: `В 1С БП 3.0 проводки формируются по конечным субсчетам (например, ${entry.credit}.01 вместо ${entry.credit}).`,
            accountingReason: `Счёт ${entry.credit} имеет подчинённые субсчета и в 1С БП 3.0 закрыт для прямого выбора в проводках.`,
            quickFixLabel: 'Заменить на рабочий субсчёт кнопкой «Исправить»',
            guide1C: {
              menuPath: 'Главное → План счетов → Счет ' + entry.credit,
              documentKind: op.docType1C,
              checkPoints: [`Выберите открытый субсчёт (например, ${entry.credit}.01) вместо счёта-группы ${entry.credit}`],
              repostInstruction: 'Перепроведите документ после замены субсчёта',
              verifyInOsv: `Отчеты → Оборотно-сальдовая ведомость по счету ${entry.credit} (по субсчетам)`,
            },
            canAutoFixBy1C: true,
            autoFixActionLabel: `Заменить счёт ${entry.credit} на субсчёт`,
            inlineTarget: {
              kind: 'entry_account',
              operationId: op.id,
              entryId: entry.id,
              side: 'credit',
              label: `Уточните субсчёт Кт (вместо ${entry.credit})`,
              placeholder: `${entry.credit}.01`,
              currentValue: entry.credit,
            },
          });
        }
      }
    }
  }

  const opMapById = new Map(operations.map((o) => [o.id, o]));
  return issues.map((issue) => {
    let nextIssue = issue;
    if (issue.operationId && issue.guide1C) {
      const linkedOp = opMapById.get(issue.operationId);
      if (linkedOp) {
        const canonicalMenuPath = issue.id.startsWith('misclassified-doc-')
          ? getDocumentSpecByDocType(
              detectOperationClassification({
                description: linkedOp.description,
                nomenclatureName: linkedOp.nomenclatureName,
                counterpartyName: linkedOp.counterpartyName,
                explicitCorrespondences: linkedOp.explicitCorrespondences,
              }).docType1C
            ).menuPath1C
          : getDocumentSpecForOperation(linkedOp).menuPath1C;
        nextIssue = {
          ...issue,
          guide1C: {
            ...issue.guide1C,
            menuPath: canonicalMenuPath,
          },
        };
      }
    }
    return sanitizeAuditIssue1C(nextIssue);
  });
}

const DEFAULT_SUBACCOUNT_MAP: Record<string, string> = {
  '01': '01.01',
  '02': '02.01',
  '04': '04.01',
  '08': '08.04.1',
  '10': '10.01',
  '19': '19.03',
  '20': '20.01',
  '41': '41.01',
  '44': '44.01',
  '50': '50.01',
  '55': '55.04',
  '57': '57.01',
  '58': '58.02',
  '60': '60.01',
  '62': '62.01',
  '66': '66.03',
  '67': '67.03',
  '68': '68.02',
  '69': '69.09',
  '71': '71.01',
  '75': '75.01',
  '76': '76.09',
  '80': '80.09',
  '84': '84.01',
  '90': '90.01.1',
  '91': '91.02',
  '99': '99.01.1',
};

export function generatePeriodClosingOperations(params: {
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  osv: OsvReport;
  periodEndDate: string;
  calculationProfile?: CalculationProfile1C;
  monthlyProfitTax?: boolean;
}): {
  newOperations: QueuedOperation[];
  log: string[];
  structuredChanges: AutoFixChangeRecord[];
} {
  const { db1C, operations, osv, periodEndDate, calculationProfile, monthlyProfitTax } = params;
  const rawCloseDate = periodEndDate || db1C?.periodEnd || new Date().toISOString().slice(0, 10);
  // Prevent premature Dec 31 Balance Reformation & phantom Q4 depreciation when UI passes reporting-year end
  // (e.g. '2026-12-31') while only Q1–Q3 operations (months 01–09) are loaded!
  const activeUserOps = operations.filter(
    (o) => o.includeInProcessing && !o.isDuplicateIn1C && !o.autoGeneratedKind && Boolean(o.date)
  );
  const maxUserOpDate = activeUserOps.reduce((mx, o) => (o.date > mx ? o.date : mx), '');
  const hasQ4DbPostings = (db1C?.postings ?? []).some((p) => Number((p.date || '').slice(5, 7)) >= 10);
  let closeDate = rawCloseDate;
  if (
    rawCloseDate.endsWith('-12-31') &&
    maxUserOpDate &&
    maxUserOpDate.slice(0, 4) === rawCloseDate.slice(0, 4) &&
    Number(maxUserOpDate.slice(5, 7)) < 10 &&
    !hasQ4DbPostings
  ) {
    const y = Number(maxUserOpDate.slice(0, 4));
    const m = Number(maxUserOpDate.slice(5, 7));
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    closeDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }
  const closeYearPrefix = (closeDate || '').slice(0, 4);
  const expectedYtdStart = closeYearPrefix ? `${closeYearPrefix}-01-01` : '';
  const effectiveOsv =
    osv.dateFrom === expectedYtdStart &&
    osv.dateTo === closeDate &&
    osv.sourceMode === 'combined'
      ? osv
      : calculateOsvReport({
          db1C,
          operations,
          dateFrom: expectedYtdStart || undefined,
          dateTo: closeDate,
          reportingYear: Number(closeYearPrefix) || undefined,
          balanceAnchorOverride:
            osv.balanceMode === 'end_balances_reconstructed_start'
              ? 'treat_raw_as_end'
              : osv.balanceMode === 'start_balances_forward_end'
                ? 'treat_raw_as_start'
                : 'auto',
          includeQueuedOperations: true,
          sourceMode: 'combined',
        });

  const log: string[] = [];
  const structuredChanges: AutoFixChangeRecord[] = [];
  const generated: QueuedOperation[] = [];

  const directCosting = db1C?.accountingPolicy.directCosting26To9008 ?? true;
  const nomGroup =
    db1C?.nomenclatureGroups[0]?.name || 'Основная номенклатурная группа';

  // 1. Advance Offset (Зачёт авансов 60.01—60.02 and 62.02—62.01 strictly per counterparty subconto!)
  const subs6001 = (effectiveOsv.subcontoRowsByAccount?.['60.01'] ?? []).filter(
    (s) => s.subcontoLabel !== 'Без аналитики (субконто)' && s.endCredit >= 0.01
  );
  const subs6002 = (effectiveOsv.subcontoRowsByAccount?.['60.02'] ?? []).filter(
    (s) => s.subcontoLabel !== 'Без аналитики (субконто)' && s.endDebit >= 0.01
  );
  const rem6002 = new Map(subs6002.map((s) => [s.subcontoLabel, round2(s.endDebit)]));
  const pairs60: Array<{ dtSub: string; ktSub: string; amount: number }> = [];

  for (const dSub of subs6001) {
    let remDebt = round2(dSub.endCredit);
    if (remDebt < 0.01) continue;
    const exactAdv = rem6002.get(dSub.subcontoLabel) ?? 0;
    if (exactAdv >= 0.01) {
      const off = round2(Math.min(remDebt, exactAdv));
      pairs60.push({ dtSub: dSub.subcontoLabel, ktSub: dSub.subcontoLabel, amount: off });
      remDebt = round2(remDebt - off);
      rem6002.set(dSub.subcontoLabel, round2(exactAdv - off));
    }
    if (remDebt >= 0.01) {
      const baseKey = normalizeEntityKey(dSub.subcontoLabel.split('/')[0] ?? '');
      if (baseKey) {
        for (const [advLabel, advVal] of rem6002.entries()) {
          if (advVal < 0.01 || remDebt < 0.01) continue;
          const advBase = normalizeEntityKey(advLabel.split('/')[0] ?? '');
          if (advBase === baseKey) {
            const off = round2(Math.min(remDebt, advVal));
            pairs60.push({ dtSub: dSub.subcontoLabel, ktSub: advLabel, amount: off });
            remDebt = round2(remDebt - off);
            rem6002.set(advLabel, round2(advVal - off));
          }
        }
      }
    }
  }

  const subs6201 = (effectiveOsv.subcontoRowsByAccount?.['62.01'] ?? []).filter(
    (s) => s.subcontoLabel !== 'Без аналитики (субконто)' && s.endDebit >= 0.01
  );
  const subs6202 = (effectiveOsv.subcontoRowsByAccount?.['62.02'] ?? []).filter(
    (s) => s.subcontoLabel !== 'Без аналитики (субконто)' && s.endCredit >= 0.01
  );
  const rem6202 = new Map(subs6202.map((s) => [s.subcontoLabel, round2(s.endCredit)]));
  const subs76AV = new Map<string, { label: string; rem: number }>();
  for (const sAv of effectiveOsv.subcontoRowsByAccount?.['76.АВ'] ?? []) {
    if (sAv.endDebit < 0.01) continue;
    const avKey = normalizeEntityKey(sAv.subcontoLabel.split('/')[0] ?? '') || sAv.subcontoLabel;
    const prevAv = subs76AV.get(avKey);
    subs76AV.set(avKey, {
      label: prevAv?.label || sAv.subcontoLabel,
      rem: round2((prevAv?.rem ?? 0) + sAv.endDebit),
    });
  }
  const pairs62: Array<{ dtSub: string; ktSub: string; amount: number; vatRestore?: { sub: string; amt: number } }> = [];

  for (const dSub of subs6201) {
    let remDebt = round2(dSub.endDebit);
    if (remDebt < 0.01) continue;
    const baseKey = normalizeEntityKey(dSub.subcontoLabel.split('/')[0] ?? '');
    const record62Offset = (advLabel: string, off: number, totalAdvForKeyAfter: number) => {
      let vatRestore: { sub: string; amt: number } | undefined;
      const avEntry = baseKey ? subs76AV.get(baseKey) : undefined;
      if (avEntry && avEntry.rem >= 0.01) {
        const rawVat = round2((off * 20) / 120);
        const calcVat =
          totalAdvForKeyAfter < 0.01 && Math.abs(avEntry.rem - rawVat) <= 0.05
            ? avEntry.rem
            : round2(Math.min(avEntry.rem, rawVat));
        if (calcVat >= 0.01) {
          vatRestore = { sub: avEntry.label, amt: calcVat };
          avEntry.rem = round2(avEntry.rem - calcVat);
        }
      }
      pairs62.push({ dtSub: advLabel, ktSub: dSub.subcontoLabel, amount: off, vatRestore });
    };

    const sumRem6202ForBaseKey = (k: string): number => {
      if (!k) return 0;
      let sum = 0;
      for (const [lbl, val] of rem6202.entries()) {
        if (val >= 0.01 && normalizeEntityKey(lbl.split('/')[0] ?? '') === k) {
          sum = round2(sum + val);
        }
      }
      return sum;
    };

    const exactAdv = rem6202.get(dSub.subcontoLabel) ?? 0;
    if (exactAdv >= 0.01) {
      const off = round2(Math.min(remDebt, exactAdv));
      rem6202.set(dSub.subcontoLabel, round2(exactAdv - off));
      remDebt = round2(remDebt - off);
      record62Offset(dSub.subcontoLabel, off, sumRem6202ForBaseKey(baseKey));
    }
    if (remDebt >= 0.01 && baseKey) {
      for (const [advLabel, advVal] of rem6202.entries()) {
        if (advVal < 0.01 || remDebt < 0.01) continue;
        const advBase = normalizeEntityKey(advLabel.split('/')[0] ?? '');
        if (advBase === baseKey) {
          const off = round2(Math.min(remDebt, advVal));
          rem6202.set(advLabel, round2(advVal - off));
          remDebt = round2(remDebt - off);
          record62Offset(advLabel, off, sumRem6202ForBaseKey(baseKey));
        }
      }
    }
  }

  const offset60 = round2(pairs60.reduce((s, p) => s + p.amount, 0));
  const offset62 = round2(pairs62.reduce((s, p) => s + p.amount, 0));

  if (offset60 > 0.01 || offset62 > 0.01) {
    const entries = [];
    for (const p60 of pairs60) {
      entries.push({
        id: nextAutoFixId('auto-offset-60'),
        debit: '60.01',
        credit: '60.02',
        debitSubconto: p60.dtSub,
        creditSubconto: p60.ktSub,
        amount: p60.amount,
        description: `Зачёт ранее выданного аванса поставщику (${p60.dtSub})`,
      });
    }
    if (offset60 > 0.01) {
      log.push(`Сформирован зачёт авансов поставщикам Дт 60.01 Кт 60.02 на ${offset60.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-offset-60'),
        whatWas: `Незачтённые авансы поставщикам на счетах 60.01 / 60.02 (${pairs60.length} субконто)`,
        whatBecame: `Проводки зачёта аванса Дт 60.01 Кт 60.02 на сумму ${offset60.toFixed(2)} ₽`,
        basis: 'Правила зачёта выданных авансов в разрезе контрагентов и договоров (1С БП 3.0)',
        category: 'advance_offset',
      });
    }
    for (const p62 of pairs62) {
      entries.push({
        id: nextAutoFixId('auto-offset-62'),
        debit: '62.02',
        credit: '62.01',
        debitSubconto: p62.dtSub,
        creditSubconto: p62.ktSub,
        amount: p62.amount,
        description: `Зачёт ранее полученного аванса покупателя (${p62.ktSub})`,
      });
      if (p62.vatRestore) {
        entries.push({
          id: nextAutoFixId('auto-offset-76av'),
          debit: '68.02',
          credit: '76.АВ',
          debitSubconto: 'Налог (взносы): начислено / уплачено',
          creditSubconto: p62.vatRestore.sub,
          amount: p62.vatRestore.amt,
          description: `Принят к вычету НДС с зачтённого аванса покупателя (${p62.vatRestore.sub})`,
        });
      }
    }
    if (offset62 > 0.01) {
      log.push(`Сформирован зачёт авансов покупателей Дт 62.02 Кт 62.01 на ${offset62.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-offset-62'),
        whatWas: `Незачтённые авансы покупателей на счетах 62.01 / 62.02 (${pairs62.length} субконто)`,
        whatBecame: `Проводки зачёта аванса Дт 62.02 Кт 62.01 на сумму ${offset62.toFixed(2)} ₽`,
        basis: 'Зачёт предоплаты покупателя в счёт выполненной реализации в разрезе договоров (1С БП 3.0)',
        category: 'advance_offset',
      });
    }

    const offsetOp: QueuedOperation = {
      id: nextAutoFixId('op-auto-offset'),
      createdAt: new Date().toISOString(),
      sourceFileName: 'Автоисправление 1С',
      date: closeDate,
      docNumber: 'АВТ-ЗАЧЕТ',
      description: 'Автоматический зачёт взаимных расчётов и авансов (60 / 62)',
      category: 'advance_offset',
      docType1C: 'КорректировкаДолга',
      documentSubKind1C: 'Зачет авансов',
      amount: round2(offset60 + offset62),
      amountMode: 'from_account_balance',
      readinessStatus: 'ready',
      readinessNote: 'Готово (автозачёт развёрнутого сальдо 60 / 62)',
      vatRate: 0,
      vatRule: 'none',
      vatAmount: 0,
      hasInvoiceSF: false,
      counterpartyName: '',
      counterpartyInn: '',
      counterpartyKpp: '',
      counterpartyKind: 'ЮридическоеЛицо',
      contractName: '',
      contractNumber: '',
      contractDate: '',
      nomenclatureName: '',
      warehouseName: '',
      expenseItemName: '',
      cashFlowItemName: '',
      employeeName: '',
      nomenclatureGroupName: nomGroup,
      isDuplicateIn1C: false,
      includeInProcessing: true,
      autoGeneratedKind: 'advance_offset',
      bindings: {
        counterparty: { status: 'not_required' },
        contract: { status: 'not_required' },
        nomenclature: { status: 'not_required' },
        warehouse: { status: 'not_required' },
        expenseItem: { status: 'not_required' },
        cashFlowItem: { status: 'not_required' },
      },
      entries,
    };
    offsetOp.mentorGuide1C = buildOperationMentorGuide1C(offsetOp, db1C);
    generated.push(offsetOp);
  }

  // 2. Advance VAT on remaining 62.02 balance (after offset62) — strictly per counterparty!
  const isOsno = (db1C?.accountingPolicy.taxSystem ?? 'ОСНО') === 'ОСНО';
  const vatRate = db1C?.accountingPolicy.vatRate ?? 20;
  const acc6202 = effectiveOsv.leafRows.find((r) => r.code === '62.02');
  const remaining6202 = round2((acc6202?.endCredit ?? 0) - offset62);
  if (isOsno && vatRate > 0 && remaining6202 > 0.01) {
    const remAdvByCpKey = new Map<string, { label: string; remAdv: number }>();
    for (const [advLbl, advRem] of rem6202.entries()) {
      if (advRem < 0.01) continue;
      const cpKey = normalizeEntityKey(advLbl.split('/')[0] ?? '') || advLbl;
      const prev = remAdvByCpKey.get(cpKey);
      remAdvByCpKey.set(cpKey, {
        label: prev?.label || advLbl,
        remAdv: round2((prev?.remAdv ?? 0) + advRem),
      });
    }

    // Fallback only when 62.02 came from aggregate rawBalances without subcontos
    if (remAdvByCpKey.size === 0 && subs6202.length === 0) {
      const restored76AV = round2(pairs62.reduce((s, p) => s + (p.vatRestore?.amt ?? 0), 0));
      const current76AV = round2(
        (effectiveOsv.leafRows.find((r) => r.code === '76.АВ')?.endDebit ?? 0) - restored76AV
      );
      const expected76AV = round2((remaining6202 * vatRate) / (100 + vatRate));
      const deltaVat = round2(expected76AV - current76AV);
      if (deltaVat > 1) {
        remAdvByCpKey.set('__aggregate__', { label: 'Покупатели по авансам', remAdv: remaining6202 });
      }
    }

    for (const [cpKey, cpAdvInfo] of remAdvByCpKey.entries()) {
      const expectedCp76AV = round2((cpAdvInfo.remAdv * vatRate) / (100 + vatRate));
      const curCp76AV =
        cpKey === '__aggregate__'
          ? round2(
              (effectiveOsv.leafRows.find((r) => r.code === '76.АВ')?.endDebit ?? 0) -
                round2(pairs62.reduce((s, p) => s + (p.vatRestore?.amt ?? 0), 0))
            )
          : round2(subs76AV.get(cpKey)?.rem ?? 0);
      const deltaVat = round2(expectedCp76AV - curCp76AV);
      if (deltaVat <= 1) continue;

      const matchingAdvOps = operations.filter(
        (o) =>
          o.includeInProcessing &&
          !o.isDuplicateIn1C &&
          (!closeDate || o.date <= closeDate) &&
          o.entries.some((e) => e.credit === '62.02') &&
          (cpKey === '__aggregate__' ||
            normalizeEntityKey(o.counterpartyName) === cpKey ||
            o.entries.some(
              (e) =>
                e.credit === '62.02' &&
                normalizeEntityKey((e.creditSubconto || '').split('/')[0] ?? '') === cpKey
            ))
      );
      const advOp = matchingAdvOps[matchingAdvOps.length - 1];
      const cpName =
        advOp?.counterpartyName || cpAdvInfo.label.split(' / ')[0].trim() || 'Покупатели по авансам';
      const advDate = advOp?.date || closeDate;

      const advVatOp: QueuedOperation = {
        id: nextAutoFixId('op-auto-76av'),
        createdAt: new Date().toISOString(),
        sourceFileName: 'Автоисправление 1С',
        date: advDate,
        docNumber: 'АВТ-СФА',
        description: `Регистрация счёта-фактуры на полученный аванс от ${cpName} (НДС ${vatRate}/${100 + vatRate})`,
        category: 'advance_vat',
        docType1C: 'СчетФактураВыданный',
        documentSubKind1C: 'На аванс',
        amount: deltaVat,
        amountMode: 'from_account_balance',
        readinessStatus: 'ready',
        readinessNote: 'Готово (исчислен НДС с аванса по счёту 62.02)',
        vatRate,
        vatRule: 'none',
        vatAmount: deltaVat,
        hasInvoiceSF: true,
        counterpartyName: cpName,
        counterpartyInn: advOp?.counterpartyInn ?? '',
        counterpartyKpp: advOp?.counterpartyKpp ?? '',
        counterpartyKind: 'ЮридическоеЛицо',
        contractName: advOp?.contractName ?? '',
        contractNumber: advOp?.contractNumber ?? '',
        contractDate: advOp?.contractDate ?? '',
        nomenclatureName: '',
        warehouseName: '',
        expenseItemName: '',
        cashFlowItemName: '',
        employeeName: '',
        nomenclatureGroupName: nomGroup,
        isDuplicateIn1C: false,
        includeInProcessing: true,
        autoGeneratedKind: 'advance_vat',
        bindings: {
          counterparty: { status: 'not_required' },
          contract: { status: 'not_required' },
          nomenclature: { status: 'not_required' },
          warehouse: { status: 'not_required' },
          expenseItem: { status: 'not_required' },
          cashFlowItem: { status: 'not_required' },
        },
        entries: [
          {
            id: nextAutoFixId('e-76av'),
            debit: '76.АВ',
            credit: '68.02',
            debitSubconto: cpName,
            creditSubconto: 'Налог (взносы): начислено / уплачено',
            amount: deltaVat,
            description: `Начислен НДС с полученного аванса покупателя (${cpName})`,
          },
        ],
      };
      advVatOp.mentorGuide1C = buildOperationMentorGuide1C(advVatOp, db1C);
      generated.push(advVatOp);
      log.push(`Начислен НДС с аванса покупателя «${cpName}» Дт 76.АВ Кт 68.02 на ${deltaVat.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-76av'),
        whatWas: `Остаток Кт 62.02 по «${cpName}» (${cpAdvInfo.remAdv.toFixed(2)} ₽) без полного исчисления НДС на 76.АВ`,
        whatBecame: `СФ на аванс (${advDate}): Дт 76.АВ Кт 68.02 на ${deltaVat.toFixed(2)} ₽ (${vatRate}/${100 + vatRate})`,
        basis: 'П. 1 ст. 167 и п. 4 ст. 164 НК РФ (исчисление НДС с предоплаты на ОСНО)',
        category: 'vat_calc',
      });
    }
  }

  // 3. Linear OS Depreciation (02.01) + Closing 20.01, 26, 44.01, 90, 91
  const closingEntries = [];
  let addedTo9008 = 0;
  let addedTo9002 = 0;
  let addedDeprTo20 = 0;
  let addedDeprTo26 = 0;

  // Check commissioned fixed assets (ПринятиеКУчетуОС) commissioned in a month strictly prior to closeDate
  const closeYm = (closeDate || '').slice(0, 7);
  const [closeYearStr, closeMonthStr] = closeYm.split('-');
  const closeTotalMonths =
    Number(closeYearStr) * 12 + (Number(closeMonthStr) || 0);

  let addedTo9007 = 0;
  let addedRpbTo44 = 0;
  const vTimelineForClosing = buildVirtual1CStateTimeline(
    db1C,
    operations.filter((o) => o.includeInProcessing && !o.isDuplicateIn1C && o.date <= closeDate)
  );
  const finalVState = vTimelineForClosing.finalState;

  if (closeTotalMonths > 0) {
    const activeAssets = Object.values(finalVState.fixedAssets).filter(
      (fa) =>
        fa.status === 'Введено в эксплуатацию (счёт 01.01)' &&
        fa.initialCost >= 0.01 &&
        (fa.accumulatedDepreciation ?? 0) < fa.initialCost - 0.01 &&
        Boolean(fa.commissioningDate) &&
        (fa.commissioningDate ?? '').slice(0, 7) < closeYm
    );

    for (const fa of activeAssets) {
      const faNormKey = normalizeEntityKey(fa.name || '');
      const alreadyDepreciatedAssetInCloseMonth = operations.some(
        (o) =>
          o.includeInProcessing &&
          !o.isDuplicateIn1C &&
          o.date.slice(0, 7) === closeYm &&
          o.entries.some((e) => {
            if (e.credit !== '02.01') return false;
            const eSubNorm = normalizeEntityKey((e.creditSubconto || '').split('/')[0] ?? '');
            if (faNormKey && eSubNorm) return eSubNorm === faNormKey;
            const descNorm = normalizeEntityKey(e.description || o.description || '');
            return Boolean(faNormKey && descNorm.includes(faNormKey));
          })
      );
      if (alreadyDepreciatedAssetInCloseMonth) continue;

      const spi = fa.usefulLifeMonths && fa.usefulLifeMonths > 0 ? fa.usefulLifeMonths : 60;
      const rawMDepr =
        fa.monthlyDepreciation > 0 ? fa.monthlyDepreciation : round2(fa.initialCost / spi);
      const deprAmount = round2(
        Math.min(rawMDepr, Math.max(0, fa.initialCost - (fa.accumulatedDepreciation ?? 0)))
      );
      if (deprAmount < 0.01) continue;

      const originOsOp = fa.firstSeenOpId
        ? operations.find((o) => o.id === fa.firstSeenOpId)
        : undefined;
      const deprCostAcc = originOsOp?.costAccount === '26' ? '26' : '20.01';
      const assetLabel = fa.name || 'Основное средство';
      closingEntries.push({
        id: nextAutoFixId(`close-depr-${fa.key}`),
        debit: deprCostAcc,
        credit: '02.01',
        debitSubconto:
          deprCostAcc === '20.01'
            ? [nomGroup, 'Амортизация'].filter(Boolean).join(' / ')
            : 'Амортизация',
        creditSubconto: assetLabel,
        amount: deprAmount,
        description: `Амортизация ОС «${assetLabel}» линейным способом (${fa.initialCost.toFixed(2)} ₽ / ${spi} мес.)`,
      });
      if (deprCostAcc === '26') {
        addedDeprTo26 = round2(addedDeprTo26 + deprAmount);
      } else {
        addedDeprTo20 = round2(addedDeprTo20 + deprAmount);
      }
      log.push(
        `Начислена линейная амортизация ОС «${assetLabel}»: Дт ${deprCostAcc} Кт 02.01 на ${deprAmount.toFixed(2)} ₽ (СПИ ${spi} мес.)`
      );
      structuredChanges.push({
        id: nextAutoFixId(`chg-depr-${fa.key}`),
        whatWas: `Объект ОС «${assetLabel}» введён в эксплуатацию (${fa.commissioningDate}), амортизация за ${closeYm} не начислена`,
        whatBecame: `Проводка Дт ${deprCostAcc} Кт 02.01 = ${deprAmount.toFixed(2)} ₽`,
        basis: 'ФСБУ 6/2020 и ст. 259 НК РФ — ежемесячное начисление амортизации по действующим объектам ОС',
        category: 'closing',
      });
    }
  }

  // 3b. Deferred Expenses (РБП 97.21) monthly catch-up if not yet written off in closeYm
  const alreadyHasRpbInCloseMonth = operations.some(
    (o) =>
      o.includeInProcessing &&
      !o.isDuplicateIn1C &&
      o.date.slice(0, 7) === closeYm &&
      o.entries.some((e) => e.credit === '97.21' || e.credit === '97')
  );
  if (!alreadyHasRpbInCloseMonth && closeYm) {
    for (const rpb of finalVState.deferredExpenses ?? []) {
      if (rpb.remainingAmount < 0.01) continue;
      if (rpb.startMonth && rpb.startMonth > closeYm) continue;
      const rpbAmt = computeMonthlyRpbWriteOff1C(rpb, closeDate);
      if (rpbAmt < 0.01) continue;
      closingEntries.push({
        id: nextAutoFixId(`close-rpb-${rpb.key}`),
        debit: rpb.writeOffAccount,
        credit: '97.21',
        debitSubconto:
          rpb.writeOffAccount === '20.01'
            ? [nomGroup, 'Расходы будущих периодов'].filter(Boolean).join(' / ')
            : 'Расходы будущих периодов',
        creditSubconto: rpb.name,
        amount: rpbAmt,
        description: `Регламентное списание РБП «${rpb.name}» за ${closeYm}`,
      });
      if (rpb.writeOffAccount === '26') addedDeprTo26 = round2(addedDeprTo26 + rpbAmt);
      else if (rpb.writeOffAccount === '44.01') addedRpbTo44 = round2(addedRpbTo44 + rpbAmt);
      else addedDeprTo20 = round2(addedDeprTo20 + rpbAmt);
      log.push(`Списана месячная доля РБП «${rpb.name}»: Дт ${rpb.writeOffAccount} Кт 97.21 на ${rpbAmt.toFixed(2)} ₽`);
    }
  }

  const acc25 = effectiveOsv.leafRows.find((r) => r.code === '25');
  const total25ToClose = round2(acc25?.endDebit ?? 0);
  if (total25ToClose > 0.01) {
    const subs25 = (effectiveOsv.subcontoRowsByAccount?.['25'] ?? []).filter((s) => s.endDebit >= 0.01);
    const sumSubs25 = round2(subs25.reduce((s, r) => s + r.endDebit, 0));
    if (subs25.length > 0 && Math.abs(sumSubs25 - total25ToClose) < 0.02) {
      for (const s25 of subs25) {
        closingEntries.push({
          id: nextAutoFixId('close-25'),
          debit: '20.01',
          credit: '25',
          debitSubconto: nomGroup,
          creditSubconto: s25.subcontoLabel === 'Без аналитики (субконто)' ? '' : s25.subcontoLabel,
          amount: s25.endDebit,
          description: `Распределение общепроизводственных расходов (счёт 25: ${s25.subcontoLabel}) в основное производство (20.01)`,
        });
      }
    } else {
      closingEntries.push({
        id: nextAutoFixId('close-25'),
        debit: '20.01',
        credit: '25',
        debitSubconto: nomGroup,
        creditSubconto: 'Общепроизводственные расходы',
        amount: total25ToClose,
        description: 'Распределение общепроизводственных расходов (счёт 25) в основное производство (20.01)',
      });
    }
    log.push(`Закрыт счёт 25 в Дт 20.01 на сумму ${total25ToClose.toFixed(2)} ₽`);
    structuredChanges.push({
      id: nextAutoFixId('chg-close-25'),
      whatWas: `Незакрытое сальдо Дт 25 = ${total25ToClose.toFixed(2)} ₽`,
      whatBecame: `Проводка Дт 20.01 Кт 25 = ${total25ToClose.toFixed(2)} ₽ (сальдо 25 = 0,00 ₽)`,
      basis: 'Ежемесячное распределение общепроизводственных расходов (Инструкция к Плану счетов РСБУ)',
      category: 'closing',
    });
  }

  const acc20 = effectiveOsv.leafRows.find((r) => r.code === '20.01');
  const base20EndDebit = round2(acc20?.endDebit ?? 0);
  const total20ToClose = round2(
    base20EndDebit +
      total25ToClose +
      addedDeprTo20 +
      (!directCosting
        ? (effectiveOsv.leafRows.find((r) => r.code === '26')?.endDebit ?? 0) + addedDeprTo26
        : 0)
  );
  const base26EndDebit = round2(effectiveOsv.leafRows.find((r) => r.code === '26')?.endDebit ?? 0);
  const total26ToClose = round2(base26EndDebit + addedDeprTo26);

  if (total26ToClose > 0.01) {
    const targetDt = directCosting ? '90.08.1' : '20.01';
    const subs26 = (effectiveOsv.subcontoRowsByAccount?.['26'] ?? []).filter((s) => s.endDebit >= 0.01);
    const sumSubs26 = round2(subs26.reduce((s, r) => s + r.endDebit, 0));
    if (subs26.length > 0 && Math.abs(sumSubs26 - base26EndDebit) < 0.02) {
      for (const s26 of subs26) {
        closingEntries.push({
          id: nextAutoFixId('close-26'),
          debit: targetDt,
          credit: '26',
          debitSubconto: nomGroup,
          creditSubconto: s26.subcontoLabel === 'Без аналитики (субконто)' ? '' : s26.subcontoLabel,
          amount: s26.endDebit,
          description: directCosting
            ? `Закрытие счёта 26 «Директ-костинг» (${s26.subcontoLabel}) в Дт 90.08.1`
            : `Закрытие счёта 26 (${s26.subcontoLabel}) в основное производство (20.01)`,
        });
      }
      if (addedDeprTo26 > 0.01) {
        closingEntries.push({
          id: nextAutoFixId('close-26-depr'),
          debit: targetDt,
          credit: '26',
          debitSubconto: nomGroup,
          creditSubconto: 'Амортизация',
          amount: addedDeprTo26,
          description: 'Закрытие амортизации со счёта 26',
        });
      }
    } else {
      closingEntries.push({
        id: nextAutoFixId('close-26'),
        debit: targetDt,
        credit: '26',
        debitSubconto: nomGroup,
        creditSubconto: 'Общехозяйственные расходы',
        amount: total26ToClose,
        description: directCosting
          ? 'Закрытие счёта 26 «Директ-костинг» в Дт 90.08.1'
          : 'Закрытие счёта 26 в основное производство (20.01)',
      });
    }
    if (directCosting) addedTo9008 = total26ToClose;
    log.push(`Закрыт счёт 26 в Дт ${targetDt} на сумму ${total26ToClose.toFixed(2)} ₽`);
    structuredChanges.push({
      id: nextAutoFixId('chg-close-26'),
      whatWas: `Незакрытое сальдо Дт 26 = ${total26ToClose.toFixed(2)} ₽`,
      whatBecame: `Проводка Дт ${targetDt} Кт 26 = ${total26ToClose.toFixed(2)} ₽ (сальдо 26 = 0,00 ₽)`,
      basis: 'Ежемесячное списание управленческих расходов (ФСБУ 5/2019, директ-костинг 1С БП 3.0)',
      category: 'closing',
    });
  }

  if (total20ToClose > 0.01) {
    const normalizeGroupKey = (g: string): string =>
      (g || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    const GENERIC_20_SUBCONTOS = new Set([
      '',
      'без аналитики (субконто)',
      'основная номенклатурная группа',
      'оплата труда',
      'страховые взносы',
      'материальные расходы',
      'амортизация',
      'амортизация нма',
      'расходы будущих периодов',
      'прочие расходы',
    ]);

    const completedGroupsInMonth = new Set<string>();
    let explicitAllWipInMonth = false;
    const explicitWipGroupsInMonth = new Set<string>();
    let monthHasHandover = false;

    const opsInCloseMonth = operations.filter(
      (o) => o.includeInProcessing && !o.isDuplicateIn1C && closeYm && (o.date ?? '').startsWith(closeYm)
    );
    for (const pOp of opsInCloseMonth) {
      if (/незавер[шщ][её]нн\p{L}*\s+производств|(?:^|[^\p{L}])инвентаризаци\p{L}*\s+нзп/iu.test(pOp.description)) {
        const wipProj =
          extractCanonicalProjectNomGroup1C(pOp.description) ||
          (pOp.nomenclatureGroupName &&
          !GENERIC_20_SUBCONTOS.has(normalizeGroupKey(pOp.nomenclatureGroupName))
            ? pOp.nomenclatureGroupName
            : undefined);
        if (wipProj) explicitWipGroupsInMonth.add(normalizeGroupKey(wipProj));
        else explicitAllWipInMonth = true;
      }
      const has9001Or43 = pOp.entries.some(
        (e) => e.credit === '90.01.1' || e.debit === '43' || e.debit === '40'
      );
      if (has9001Or43) {
        const isPureRent =
          /аренд\p{L}*\s+(?:лесов|помещен|оборудован)/iu.test(pOp.description) &&
          !extractCanonicalProjectNomGroup1C(pOp.description);
        if (!isPureRent) monthHasHandover = true;
        if (pOp.nomenclatureGroupName) completedGroupsInMonth.add(normalizeGroupKey(pOp.nomenclatureGroupName));
        const pProj = extractCanonicalProjectNomGroup1C(pOp.description);
        if (pProj) completedGroupsInMonth.add(normalizeGroupKey(pProj));
        for (const e of pOp.entries) {
          if (e.credit === '90.01.1' && e.creditSubconto) {
            const subHead = e.creditSubconto.split(' / ')[0].trim();
            if (subHead) completedGroupsInMonth.add(normalizeGroupKey(subHead));
          }
        }
      }
    }
    if (!monthHasHandover && !explicitAllWipInMonth && opsInCloseMonth.length === 0) {
      const rev9001 = effectiveOsv.leafRows.find((r) => r.code === '90.01.1')?.endCredit ?? 0;
      if (rev9001 > 0.01) monthHasHandover = true;
    }

    const shouldClose20Sub = (rawLabel: string): boolean => {
      const head = (rawLabel || '').split(' / ')[0].trim();
      const canonical = extractCanonicalProjectNomGroup1C(head);
      const effectiveKey = canonical ? normalizeGroupKey(canonical) : normalizeGroupKey(head);
      if (!GENERIC_20_SUBCONTOS.has(effectiveKey)) {
        if (completedGroupsInMonth.has(effectiveKey)) return true;
        const gStems = extractKeywordStems1C(effectiveKey);
        for (const compKey of completedGroupsInMonth) {
          if (GENERIC_20_SUBCONTOS.has(compKey)) continue;
          const cStems = extractKeywordStems1C(compKey);
          if (gStems.length > 0 && cStems.length > 0 && gStems.every((gs) => cStems.some((cs) => stemsMatch1C(gs, cs)))) {
            return true;
          }
        }
        return false; // Keep unfinished project as WIP (НЗП) on 20.01!
      }
      if (explicitAllWipInMonth && !monthHasHandover) return false;
      return monthHasHandover || (!explicitAllWipInMonth && explicitWipGroupsInMonth.size === 0);
    };

    const subs20 = (effectiveOsv.subcontoRowsByAccount?.['20.01'] ?? []).filter((s) => s.endDebit >= 0.01);
    const sumSubs20 = round2(subs20.reduce((s, r) => s + r.endDebit, 0));
    const extra20 = round2(
      total25ToClose + addedDeprTo20 + (!directCosting ? total26ToClose : 0)
    );
    let closed20Sum = 0;
    if (subs20.length > 0 && Math.abs(sumSubs20 - base20EndDebit) < 0.02) {
      for (const s20 of subs20) {
        if (!shouldClose20Sub(s20.subcontoLabel)) continue;
        const s20Head = s20.subcontoLabel.split(' / ')[0].trim();
        const targetGroup =
          extractCanonicalProjectNomGroup1C(s20Head) ||
          (!GENERIC_20_SUBCONTOS.has(normalizeGroupKey(s20Head)) ? s20Head : nomGroup);
        closingEntries.push({
          id: nextAutoFixId('close-20'),
          debit: '90.02.1',
          credit: '20.01',
          debitSubconto: targetGroup,
          creditSubconto: s20.subcontoLabel === 'Без аналитики (субконто)' ? '' : s20.subcontoLabel,
          amount: s20.endDebit,
          description: `Закрытие счёта 20.01 (${s20.subcontoLabel}) в себестоимость продаж (90.02.1)`,
        });
        closed20Sum = round2(closed20Sum + s20.endDebit);
      }
      if (extra20 > 0.01 && shouldClose20Sub(nomGroup)) {
        closingEntries.push({
          id: nextAutoFixId('close-20-extra'),
          debit: '90.02.1',
          credit: '20.01',
          debitSubconto: nomGroup,
          creditSubconto: nomGroup,
          amount: extra20,
          description: 'Закрытие регламентных расходов 20.01 в себестоимость продаж (90.02.1)',
        });
        closed20Sum = round2(closed20Sum + extra20);
      }
    } else if (shouldClose20Sub(nomGroup)) {
      closingEntries.push({
        id: nextAutoFixId('close-20'),
        debit: '90.02.1',
        credit: '20.01',
        debitSubconto: nomGroup,
        creditSubconto: nomGroup,
        amount: total20ToClose,
        description: 'Закрытие счёта 20.01 в себестоимость продаж (90.02.1)',
      });
      closed20Sum = round2(closed20Sum + total20ToClose);
    }
    if (closed20Sum > 0.01) {
      addedTo9002 = round2(addedTo9002 + closed20Sum);
      log.push(`Закрыт счёт 20.01 в Дт 90.02.1 на сумму ${closed20Sum.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-close-20'),
        whatWas: `Подлежащее закрытию сальдо Дт 20.01 = ${closed20Sum.toFixed(2)} ₽`,
        whatBecame: `Проводка Дт 90.02.1 Кт 20.01 = ${closed20Sum.toFixed(2)} ₽`,
        basis: 'Регламентная операция «Закрытие счетов 20, 23, 25, 26» 1С БП 3.0 (с сохранением НЗП по незавершённым объектам)',
        category: 'closing',
      });
    }
  }

  const acc4401 = effectiveOsv.leafRows.find((r) => r.code === '44.01');
  const total44ToClose = round2((acc4401?.endDebit ?? 0) + addedRpbTo44);
  if (total44ToClose > 0.01) {
    closingEntries.push({
      id: nextAutoFixId('close-44'),
      debit: '90.07.1',
      credit: '44.01',
      debitSubconto: nomGroup,
      creditSubconto: 'Издержки обращения',
      amount: total44ToClose,
      description: 'Списание расходов на продажу (44.01 → 90.07.1)',
    });
    addedTo9007 = round2(addedTo9007 + total44ToClose);
    log.push(`Закрыт счёт 44.01 в Дт 90.07.1 на сумму ${total44ToClose.toFixed(2)} ₽`);
    structuredChanges.push({
      id: nextAutoFixId('chg-close-44'),
      whatWas: `Незакрытое сальдо Дт 44.01 = ${total44ToClose.toFixed(2)} ₽`,
      whatBecame: `Проводка Дт 90.07.1 Кт 44.01 = ${total44ToClose.toFixed(2)} ₽ (сальдо 44.01 = 0,00 ₽)`,
      basis: 'Регламентная операция закрытия счёта 44 «Издержки обращения» в коммерческие расходы (90.07.1)',
      category: 'closing',
    });
  }

  // Net residual on 90 after closing 20.01, 26 and 44.01
  const children90 = effectiveOsv.leafRows.filter((r) => r.code.startsWith('90.'));
  const currentNet90DebitMinusCredit = round2(
    children90.reduce((s, r) => s + (r.endDebit - r.endCredit), 0) +
      addedTo9008 +
      addedTo9002 +
      addedTo9007
  );
  if (Math.abs(currentNet90DebitMinusCredit) > 0.01) {
    if (currentNet90DebitMinusCredit < 0) {
      const profit90 = round2(-currentNet90DebitMinusCredit);
      closingEntries.push({
        id: nextAutoFixId('close-90-profit'),
        debit: '90.09',
        credit: '99.01.1',
        debitSubconto: nomGroup,
        creditSubconto: 'Прибыль (убыток) от продаж',
        amount: profit90,
        description: 'Определён финансовый результат (прибыль от продаж) за период',
      });
      log.push(`Закрыт счёт 90 (прибыль от продаж): Дт 90.09 Кт 99.01.1 на ${profit90.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-close-90'),
        whatWas: `Свёрнутое сальдо Кт 90 = ${profit90.toFixed(2)} ₽`,
        whatBecame: `Дт 90.09 Кт 99.01.1 = ${profit90.toFixed(2)} ₽ (прибыль от продаж, сальдо 90 = 0,00 ₽)`,
        basis: 'Регламентное закрытие счёта 90 «Продажи» по итогам месяца (План счетов РСБУ)',
        category: 'closing',
      });
    } else {
      const loss90 = round2(currentNet90DebitMinusCredit);
      closingEntries.push({
        id: nextAutoFixId('close-90-loss'),
        debit: '99.01.1',
        credit: '90.09',
        debitSubconto: 'Прибыль (убыток) от продаж',
        creditSubconto: nomGroup,
        amount: loss90,
        description: 'Определён финансовый результат (убыток от продаж) за период',
      });
      log.push(`Закрыт счёт 90 (убыток от продаж): Дт 99.01.1 Кт 90.09 на ${loss90.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-close-90'),
        whatWas: `Свёрнутое сальдо Дт 90 = ${loss90.toFixed(2)} ₽`,
        whatBecame: `Дт 99.01.1 Кт 90.09 = ${loss90.toFixed(2)} ₽ (убыток от продаж, сальдо 90 = 0,00 ₽)`,
        basis: 'Регламентное закрытие счёта 90 «Продажи» по итогам месяца (План счетов РСБУ)',
        category: 'closing',
      });
    }
  }

  // Net residual on 91
  const children91 = effectiveOsv.leafRows.filter((r) => r.code.startsWith('91.'));
  const net91DebitMinusCredit = round2(
    children91.reduce((s, r) => s + (r.endDebit - r.endCredit), 0)
  );
  if (Math.abs(net91DebitMinusCredit) > 0.01) {
    if (net91DebitMinusCredit < 0) {
      const profit91 = round2(-net91DebitMinusCredit);
      closingEntries.push({
        id: nextAutoFixId('close-91-profit'),
        debit: '91.09',
        credit: '99.01.1',
        debitSubconto: '',
        creditSubconto: 'Прочие доходы и расходы',
        amount: profit91,
        description: 'Закрытие счёта 91 (превышение прочих доходов над расходами)',
      });
      log.push(`Закрыт счёт 91 (прибыль): Дт 91.09 Кт 99.01.1 на ${profit91.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-close-91'),
        whatWas: `Свёрнутое сальдо Кт 91 = ${profit91.toFixed(2)} ₽`,
        whatBecame: `Дт 91.09 Кт 99.01.1 = ${profit91.toFixed(2)} ₽ (сальдо 91 = 0,00 ₽)`,
        basis: 'Регламентное закрытие счёта 91 «Прочие доходы и расходы» (План счетов РСБУ)',
        category: 'closing',
      });
    } else {
      const loss91 = round2(net91DebitMinusCredit);
      closingEntries.push({
        id: nextAutoFixId('close-91-loss'),
        debit: '99.01.1',
        credit: '91.09',
        debitSubconto: 'Прочие доходы и расходы',
        creditSubconto: '',
        amount: loss91,
        description: 'Закрытие счёта 91 (превышение прочих расходов над доходами)',
      });
      log.push(`Закрыт счёт 91 (сальдо прочих расходов): Дт 99.01.1 Кт 91.09 на ${loss91.toFixed(2)} ₽`);
      structuredChanges.push({
        id: nextAutoFixId('chg-close-91'),
        whatWas: `Свёрнутое сальдо Дт 91 = ${loss91.toFixed(2)} ₽`,
        whatBecame: `Дт 99.01.1 Кт 91.09 = ${loss91.toFixed(2)} ₽ (сальдо 91 = 0,00 ₽)`,
        basis: 'Регламентное закрытие счёта 91 «Прочие доходы и расходы» (План счетов РСБУ)',
        category: 'closing',
      });
    }
  }

  // Quarter-end / Year-end cumulative YTD Corporate Profit Tax (99.02.1 <-> 68.04.1) on OSNO
  // Tax sanctions on 99.02.3 are excluded from 99.01.1 and never reduce taxable profit (ст. 270 п. 2 НК РФ).
  const closeMonthNum = Number((closeDate || '').slice(5, 7)) || 0;
  const isQuarterEnd = [3, 6, 9, 12].includes(closeMonthNum);
  const shouldAccrueMonthlyProfitTax =
    Boolean(monthlyProfitTax) ||
    calculationProfile === 'bp30_legacy_pre2023' ||
    Boolean(db1C?.usesLegacyPayrollAccounts && calculationProfile !== 'rf_2026');
  const profitTaxRate = db1C?.accountingPolicy.profitTaxRate ?? 20;
  if (isOsno && (isQuarterEnd || shouldAccrueMonthlyProfitTax) && profitTaxRate > 0) {
    const existing9901Row = effectiveOsv.leafRows.find((r) => r.code === '99.01.1' || r.code === '99');
    const existingNetCredit9901 = existing9901Row
      ? round2(existing9901Row.endCredit - existing9901Row.endDebit)
      : 0;
    const priorTaxEntries: Array<{
      debit: string;
      credit: string;
      amount: number;
      debitSubconto?: string;
      description?: string;
      nonDeductibleForProfitTax?: boolean;
    }> = [
      ...(db1C?.postings ?? [])
        .filter(
          (p) =>
            (!closeYearPrefix || (p.date ?? '').startsWith(closeYearPrefix)) &&
            (!closeDate || !p.date || p.date <= closeDate)
        )
        .map((p) => ({
          debit: p.debit,
          credit: p.credit,
          amount: p.amount,
          debitSubconto: (p.debitSubconto ?? []).join(' / '),
          description: p.description,
        })),
      ...operations
        .filter(
          (o) =>
            o.includeInProcessing &&
            !o.isDuplicateIn1C &&
            (!closeYearPrefix || !o.date || o.date.startsWith(closeYearPrefix)) &&
            o.date <= closeDate
        )
        .flatMap((o) => o.entries),
    ];
    const alreadyAccruedTax = round2(
      priorTaxEntries.reduce((s, e) => {
        if ((e.debit === '99.02.1' || e.debit === '99.01.1') && e.credit.startsWith('68.04')) {
          return s + e.amount;
        }
        if (e.debit.startsWith('68.04') && (e.credit === '99.02.1' || e.credit === '99.01.1')) {
          return s - e.amount;
        }
        return s;
      }, 0)
    );
    const legacyTaxOn9901 = round2(
      priorTaxEntries
        .filter((e) => e.debit === '99.01.1' && e.credit.startsWith('68.04'))
        .reduce((s, e) => s + e.amount, 0)
    );
    const reformedOutOf9901 = round2(
      priorTaxEntries.reduce((s, e) => {
        if (
          e.debit === '99.01.1' &&
          (e.credit.startsWith('84') || e.credit.startsWith('99.02'))
        ) {
          return s + e.amount;
        }
        if (
          (e.debit.startsWith('84') || e.debit.startsWith('99.02')) &&
          e.credit === '99.01.1'
        ) {
          return s - e.amount;
        }
        return s;
      }, 0)
    );
    const closingDeltaCredit9901 = round2(
      closingEntries.reduce((acc, e) => {
        if (e.credit === '99.01.1') return acc + e.amount;
        if (e.debit === '99.01.1') return acc - e.amount;
        return acc;
      }, 0)
    );
    const totalProfitBeforeTax = round2(
      existingNetCredit9901 + closingDeltaCredit9901 + legacyTaxOn9901 + reformedOutOf9901
    );
    const nonDeductibleYtd = round2(
      [...priorTaxEntries, ...closingEntries]
        .filter((e) => isNonDeductibleProfitTaxEntry1C(e))
        .reduce((s, e) => s + e.amount, 0)
    );
    const taxBaseYtd = Math.max(0, round2(totalProfitBeforeTax + nonDeductibleYtd));
    const targetTaxTotal =
      taxBaseYtd > 0.01 ? round2(taxBaseYtd * (profitTaxRate / 100)) : 0;
    const profitTaxDelta = round2(targetTaxTotal - alreadyAccruedTax);
    const taxBaseExplanation =
      nonDeductibleYtd >= 0.01
        ? `база НУ ${formatRuMoneyPlainSpace(taxBaseYtd)} ₽ = прибыль БУ (99.01.1) ${formatRuMoneyPlainSpace(totalProfitBeforeTax)} ₽ + постоянные разницы по ст. 270 НК РФ ${formatRuMoneyPlainSpace(nonDeductibleYtd)} ₽`
        : `база НУ ${formatRuMoneyPlainSpace(taxBaseYtd)} ₽ (прибыль БУ 99.01.1: ${formatRuMoneyPlainSpace(totalProfitBeforeTax)} ₽, постоянные разницы по ст. 270 НК РФ: 0,00 ₽)`;
    if (profitTaxDelta > 0.02) {
      closingEntries.push({
        id: nextAutoFixId('close-profit-tax'),
        debit: '99.02.1',
        credit: '68.04.1',
        debitSubconto: 'Текущий налог на прибыль',
        creditSubconto: 'Налог (взносы): начислено / уплачено',
        amount: profitTaxDelta,
        description: `Регламентный расчёт налога на прибыль организаций (${profitTaxRate}%): ${taxBaseExplanation}`,
      });
      log.push(
        `Начислен налог на прибыль ${profitTaxRate}%: Дт 99.02.1 Кт 68.04.1 на ${profitTaxDelta.toFixed(2)} ₽ (${taxBaseExplanation})`
      );
      structuredChanges.push({
        id: nextAutoFixId('chg-profit-tax'),
        whatWas: `Налоговая база прибыли: ${taxBaseExplanation}`,
        whatBecame: `Проводка Дт 99.02.1 Кт 68.04.1 = ${profitTaxDelta.toFixed(2)} ₽ (ставка ${profitTaxRate}% ОСНО)`,
        basis: 'Ст. 270, 284 НК РФ — регламентная операция «Расчёт налога на прибыль» 1С:БП 3.0',
        category: 'closing',
      });
    } else if (profitTaxDelta < -0.02) {
      const taxReduction = Math.abs(profitTaxDelta);
      closingEntries.push({
        id: nextAutoFixId('close-profit-tax-reduce'),
        debit: '68.04.1',
        credit: '99.02.1',
        debitSubconto: 'Налог (взносы): начислено / уплачено',
        creditSubconto: 'Текущий налог на прибыль',
        amount: taxReduction,
        description: `Уменьшение налога на прибыль организаций (${profitTaxRate}%) нарастающим итогом с начала года: ${taxBaseExplanation}`,
      });
      log.push(
        `Уменьшен налог на прибыль ${profitTaxRate}% (пересчёт с начала года): Дт 68.04.1 Кт 99.02.1 на ${taxReduction.toFixed(2)} ₽`
      );
      structuredChanges.push({
        id: nextAutoFixId('chg-profit-tax-reduce'),
        whatWas: `Начисленный ранее авансовый налог на прибыль (${alreadyAccruedTax.toFixed(2)} ₽) превышает налог с годовой базы (${targetTaxTotal.toFixed(2)} ₽)`,
        whatBecame: `Проводка Дт 68.04.1 Кт 99.02.1 = ${taxReduction.toFixed(2)} ₽`,
        basis: 'Ст. 270, 286–287 НК РФ — пересчёт налога на прибыль нарастающим итогом при снижении налоговой базы / убытке квартала',
        category: 'closing',
      });
    }
  }

  // Year-end Реформация баланса on December 31: close any remaining non-zero 90.* -> 90.09, 91.* -> 91.09, and ALL 99.* -> 84.01 / 84.02
  if (closeDate.endsWith('-12-31')) {
    const priorReformedNetTo84 = round2(
      operations
        .filter((o) => o.includeInProcessing && !o.isDuplicateIn1C && o.date === closeDate)
        .flatMap((o) => o.entries)
        .reduce((s, e) => {
          if (e.debit.startsWith('99') && e.credit.startsWith('84')) return s + e.amount;
          if (e.debit.startsWith('84') && e.credit.startsWith('99')) return s - e.amount;
          return s;
        }, 0)
    );
    {
      const codes90 = new Set<string>([
        ...effectiveOsv.leafRows.filter((r) => r.code.startsWith('90.') && r.code !== '90.09').map((r) => r.code),
        ...closingEntries
          .flatMap((e) => [e.debit, e.credit])
          .filter((c) => c.startsWith('90.') && c !== '90.09'),
      ]);
      for (const code90 of codes90) {
        const r90 = effectiveOsv.leafRows.find((r) => r.code === code90);
        const extraDt = closingEntries
          .filter((e) => e.debit === code90)
          .reduce((s, e) => s + e.amount, 0);
        const extraKt = closingEntries
          .filter((e) => e.credit === code90)
          .reduce((s, e) => s + e.amount, 0);
        const netCr = round2(((r90?.endCredit ?? 0) + extraKt) - ((r90?.endDebit ?? 0) + extraDt));
        if (netCr > 0.01) {
          closingEntries.push({
            id: nextAutoFixId('ref-90'),
            debit: code90,
            credit: '90.09',
            debitSubconto: nomGroup,
            creditSubconto: nomGroup,
            amount: netCr,
            description: `Реформация баланса: закрытие субсчёта ${code90} на 90.09`,
          });
        } else if (netCr < -0.01) {
          closingEntries.push({
            id: nextAutoFixId('ref-90'),
            debit: '90.09',
            credit: code90,
            debitSubconto: nomGroup,
            creditSubconto: nomGroup,
            amount: Math.abs(netCr),
            description: `Реформация баланса: закрытие субсчёта ${code90} на 90.09`,
          });
        }
      }

      const codes91 = new Set<string>([
        ...effectiveOsv.leafRows.filter((r) => r.code.startsWith('91.') && r.code !== '91.09').map((r) => r.code),
        ...closingEntries
          .flatMap((e) => [e.debit, e.credit])
          .filter((c) => c.startsWith('91.') && c !== '91.09'),
      ]);
      for (const code91 of codes91) {
        const r91 = effectiveOsv.leafRows.find((r) => r.code === code91);
        const extraDt = closingEntries
          .filter((e) => e.debit === code91)
          .reduce((s, e) => s + e.amount, 0);
        const extraKt = closingEntries
          .filter((e) => e.credit === code91)
          .reduce((s, e) => s + e.amount, 0);
        const netCr = round2(((r91?.endCredit ?? 0) + extraKt) - ((r91?.endDebit ?? 0) + extraDt));
        if (netCr > 0.01) {
          closingEntries.push({
            id: nextAutoFixId('ref-91'),
            debit: code91,
            credit: '91.09',
            debitSubconto: 'Прочие доходы и расходы',
            creditSubconto: 'Прочие доходы и расходы',
            amount: netCr,
            description: `Реформация баланса: закрытие субсчёта ${code91} на 91.09`,
          });
        } else if (netCr < -0.01) {
          closingEntries.push({
            id: nextAutoFixId('ref-91'),
            debit: '91.09',
            credit: code91,
            debitSubconto: 'Прочие доходы и расходы',
            creditSubconto: 'Прочие доходы и расходы',
            amount: Math.abs(netCr),
            description: `Реформация баланса: закрытие субсчёта ${code91} на 91.09`,
          });
        }
      }

      const children99 = effectiveOsv.leafRows.filter((r) => r.code.startsWith('99.') || r.code === '99');
      const codes99 = new Set<string>([
        ...children99.map((r) => r.code),
        ...closingEntries
          .flatMap((e) => [e.debit, e.credit])
          .filter((c) => c.startsWith('99.') || c === '99'),
      ]);
      const netByCode99 = new Map<string, number>();
      let totalNetCreditAll99 = 0;
      for (const code99 of codes99) {
        const baseRow = children99.find((r) => r.code === code99);
        const extraDt = closingEntries
          .filter((e) => e.debit === code99)
          .reduce((s, e) => s + e.amount, 0);
        const extraKt = closingEntries
          .filter((e) => e.credit === code99)
          .reduce((s, e) => s + e.amount, 0);
        const netCr = round2(
          ((baseRow?.endCredit ?? 0) + extraKt) - ((baseRow?.endDebit ?? 0) + extraDt)
        );
        if (Math.abs(netCr) > 0.01) {
          netByCode99.set(code99, netCr);
          totalNetCreditAll99 = round2(totalNetCreditAll99 + netCr);
        }
      }
      if (netByCode99.size > 0) {
        const target84 =
          round2(priorReformedNetTo84 + totalNetCreditAll99) >= 0 ? '84.01' : '84.02';
        const target84Sub =
          target84 === '84.01'
            ? 'Прибыль, подлежащая распределению'
            : 'Убыток, подлежащий покрытию';
        for (const [code99, netCr] of netByCode99.entries()) {
          const sub99 =
            code99 === '99.02.1'
              ? 'Текущий налог на прибыль'
              : code99 === '99.02.3'
                ? 'Налоговые санкции'
                : 'Прибыль (убыток) от продаж';
          if (netCr > 0.01) {
            closingEntries.push({
              id: nextAutoFixId(`ref-${code99}`),
              debit: code99,
              credit: target84,
              debitSubconto: sub99,
              creditSubconto: target84Sub,
              amount: netCr,
              description: `Реформация баланса: перенос кредитового сальдо ${code99} на счёт ${target84}`,
            });
          } else if (netCr < -0.01) {
            closingEntries.push({
              id: nextAutoFixId(`ref-${code99}`),
              debit: target84,
              credit: code99,
              debitSubconto: target84Sub,
              creditSubconto: sub99,
              amount: Math.abs(netCr),
              description: `Реформация баланса: списание дебетового сальдо ${code99} на счёт ${target84}`,
            });
          }
        }
        log.push(
          `Реформация баланса на ${closeDate}: финансовый результат (${totalNetCreditAll99.toFixed(2)} ₽) перенесён со счёта 99 на счёт ${target84}`
        );
        structuredChanges.push({
          id: nextAutoFixId('chg-reformation-84'),
          whatWas: `Незакрытые субсчета счёта 99 (${[...netByCode99.keys()].join(', ')}) на 31.12`,
          whatBecame: `Заключительные записи на счёт ${target84} на чистую сумму ${Math.abs(totalNetCreditAll99).toFixed(2)} ₽ (счета 90, 91, 99 закрыты в ноль)`,
          basis: 'Инструкция к Плану счетов РСБУ — заключительные записи декабря («Реформация баланса»)',
          category: 'closing',
          ruleId: 'close_period_accounts',
        });
      }
    }
  }

  if (closingEntries.length > 0) {
    const totalCloseAmt = round2(closingEntries.reduce((s, e) => s + e.amount, 0));
    const closeOp: QueuedOperation = {
      id: nextAutoFixId('op-auto-close'),
      createdAt: new Date().toISOString(),
      sourceFileName: '',
      date: closeDate,
      docNumber: 'РЕГЛ-ЗАКР',
      description: 'Регламентное закрытие счетов затрат и финансовых результатов (20, 26, 44, 90, 91, 99)',
      category: 'closing',
      docType1C: 'ЗакрытиеМесяца',
      documentSubKind1C: 'Закрытие счетов 20, 26, 44, 90, 91 и расчёт налога на прибыль',
      amount: totalCloseAmt,
      amountMode: 'from_account_balance',
      readinessStatus: 'ready',
      readinessNote: 'Готово (регламентная операция закрытия периода)',
      calculationProvenance: `Сформировано по фактическим остаткам счетов затрат и продаж на ${closeDate}`,
      vatRate: 0,
      vatRule: 'none',
      vatAmount: 0,
      hasInvoiceSF: false,
      counterpartyName: '',
      counterpartyInn: '',
      counterpartyKpp: '',
      counterpartyKind: 'ЮридическоеЛицо',
      contractName: '',
      contractNumber: '',
      contractDate: '',
      nomenclatureName: '',
      warehouseName: '',
      expenseItemName: '',
      cashFlowItemName: '',
      employeeName: '',
      nomenclatureGroupName: nomGroup,
      isDuplicateIn1C: false,
      includeInProcessing: true,
      autoGeneratedKind: 'closing_90_91',
      bindings: {
        counterparty: { status: 'not_required' },
        contract: { status: 'not_required' },
        nomenclature: { status: 'not_required' },
        warehouse: { status: 'not_required' },
        expenseItem: { status: 'not_required' },
        cashFlowItem: { status: 'not_required' },
      },
      entries: closingEntries,
    };
    closeOp.mentorGuide1C = buildOperationMentorGuide1C(closeOp, db1C);
    generated.push(closeOp);
  }

  return { newOperations: generated, log, structuredChanges };
}

export function autoFixAllBy1CDb(params: {
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  calculateCurrentOsv: (ops: QueuedOperation[], dateToOverride?: string) => OsvReport;
  periodEndDate: string;
  reportingYear?: number;
  defaultBik?: string;
  calculationProfile?: CalculationProfile1C;
  monthlyProfitTax?: boolean;
}): {
  operations: QueuedOperation[];
  fixedCount: number;
  log: string[];
  structuredChanges: AutoFixChangeRecord[];
  executionSummary: AutofixExecutionSummary;
} {
  const {
    db1C,
    operations,
    calculateCurrentOsv,
    periodEndDate,
    reportingYear,
    defaultBik = DEFAULT_SBERBANK_BIK,
    calculationProfile,
    monthlyProfitTax,
  } = params;
  let fixedCount = 0;
  const log: string[] = [];
  const structuredChanges: AutoFixChangeRecord[] = [];
  const appliedRuleSet = new Set<AutofixRuleId>();

  const osvBefore = calculateCurrentOsv(operations);
  const issuesBeforeList = runAuditDiagnostics({ db1C, operations, osv: osvBefore });
  const issuesBeforeCount = issuesBeforeList.length;
  const autofixableBeforeCount = issuesBeforeList.filter((i) => i.canAutoFixBy1C).length;
  const criticalBeforeCount = issuesBeforeList.filter((i) => i.severity === 'error').length;

  const homeRegion = inferOrganizationRegionCode({
    organizationInn: db1C?.organization.inn,
    organizationBik: db1C?.organization.bik || defaultBik,
  });

  // Deterministic formal-requisite cache per counterparty group key across all passes
  const formalCpRequisiteCache = new Map<
    string,
    { inn: string; kpp: string; source: CounterpartyResolutionSource }
  >();

  const recordChange = (
    whatWas: string,
    whatBecame: string,
    basis: string,
    category: AutoFixChangeRecord['category'],
    ruleId: AutofixRuleId,
    operationId?: string
  ) => {
    appliedRuleSet.add(ruleId);
    structuredChanges.push({
      id: nextAutoFixId(`fix-${structuredChanges.length + 1}`),
      whatWas,
      whatBecame,
      basis,
      category,
      operationId,
    });
  };

  let workingOperations: QueuedOperation[] = operations
    .filter((o) => !o.id.startsWith('op-cash-cover'))
    .map((o) => ({
      ...o,
      bindings: { ...o.bindings },
      entries: o.entries.map((e) => ({ ...e })),
    }));
  let passesExecuted = 0;

  for (let pass = 1; pass <= 5; pass++) {
    passesExecuted = pass;

    // Strip regulatory auto-generated closing/offset ops and any legacy cash-cover ops
    const manualAndImportedOps = workingOperations.filter(
      (op) => !op.autoGeneratedKind && !op.id.startsWith('op-cash-cover')
    );
    const canonicalRegistry = buildCanonicalCounterpartyRegistry1C(db1C, manualAndImportedOps);
    for (const [normKey, rec] of canonicalRegistry.entries()) {
      const cleanInn = rec.inn.replace(/\D/g, '');
      if (isValidRussianInnFormat(cleanInn) && validateRussianInnChecksum(cleanInn).valid) {
        const entryVal = {
          inn: cleanInn,
          kpp: rec.kpp || (cleanInn.length === 10 ? `${cleanInn.slice(0, 4)}01001` : ''),
          source: rec.source,
        };
        formalCpRequisiteCache.set(getCounterpartyGroupKey(rec.canonicalName), entryVal);
        formalCpRequisiteCache.set(normKey, entryVal);
      }
    }
    const enrichedOps: QueuedOperation[] = [];

    for (const origOp of manualAndImportedOps) {
      let op: QueuedOperation = {
        ...origOp,
        bindings: { ...origOp.bindings },
        entries: origOp.entries.map((e) => ({ ...e })),
      };

      // Pass Stage 1a: Normalize stray template years (e.g. 2020 / 2024) to reportingYear
      if (reportingYear && op.date && !op.date.startsWith(`${reportingYear}-`)) {
        const prevDate = op.date;
        const normDate = normalizeOperationDateToReportingYear(op.date, reportingYear);
        if (normDate && normDate !== prevDate) {
          op.date = normDate;
          fixedCount++;
          log.push(`Нормализована дата документа: ${prevDate} → ${normDate}`);
          recordChange(
            `Дата документа: ${prevDate}`,
            `Дата документа: ${normDate}`,
            `Приведение шаблонного года Excel к рабочему отчётному году ${reportingYear}`,
            'date_year',
            'normalize_date_year',
            op.id
          );
        }
      }

      // Pass Stage 1a-guard: Scrub accidental 10-digit INN / 9+-digit identifier parsed as ruble sum (>= 500M ₽)
      if (
        op.amount >= 500_000_000 &&
        /\b\d{9,}\b/.test(op.description) &&
        !/(?:млрд|миллиард)/iu.test(op.description)
      ) {
        const prevCorruptedAmt = op.amount;
        const safeCheck = extractRequisitesFromFreeText(op.description, reportingYear);
        op.amount =
          safeCheck.multiSumTotal && safeCheck.multiSumTotal < 500_000_000
            ? safeCheck.multiSumTotal
            : 0;
        op.amountMode = op.amount >= 0.01 ? 'explicit' : 'required_missing';
        op.entries = [];
        fixedCount++;
        log.push(
          `Очищена ложная сумма-реквизит (${prevCorruptedAmt.toLocaleString('ru-RU')} ₽ → ${op.amount.toLocaleString('ru-RU')} ₽)`
        );
        recordChange(
          `Ложная сумма из ИНН/реквизита: ${prevCorruptedAmt.toLocaleString('ru-RU')} ₽`,
          `Очищено для пересчёта по регистру (${op.amount.toLocaleString('ru-RU')} ₽)`,
          'Защита от принятия 10-значного ИНН / КПП / р/с за денежную сумму',
          'doc_reclassification',
          'reclassify_legacy_doc',
          op.id
        );
      }

      // Pass Stage 1b: Extract inline requisites from text if missing
      const inlineReq = extractRequisitesFromFreeText(op.description, reportingYear);
      const naturalPreCheck = detectOperationClassification({
        description: op.description,
        nomenclatureName: op.nomenclatureName || inlineReq.nomenclatureHint,
        counterpartyName: op.counterpartyName || inlineReq.counterparty,
      });
      const opRequiresCommercialCp =
        doesOperationRequireCounterparty(op.category) &&
        doesOperationRequireCounterparty(naturalPreCheck.category);

      if (
        (op.category === 'alimony_payout' || naturalPreCheck.category === 'alimony_payout') &&
        !op.alimonyRecipientInn &&
        inlineReq.inn
      ) {
        op.alimonyRecipientInn = inlineReq.inn;
      } else if (opRequiresCommercialCp && !op.counterpartyInn && inlineReq.inn) {
        op.counterpartyInn = inlineReq.inn;
        op.counterpartySource = 'excel_explicit';
        fixedCount++;
        log.push(`Из текста операции извлечён ИНН ${inlineReq.inn}`);
        recordChange(
          'ИНН контрагента: не заполнен',
          `ИНН: ${inlineReq.inn}`,
          'Прямое извлечение реквизитов из текста первичной операции',
          'counterparty_requisites',
          'fill_formal_requisites',
          op.id
        );
      }
      if (opRequiresCommercialCp && !op.counterpartyKpp && inlineReq.kpp) {
        op.counterpartyKpp = inlineReq.kpp;
        fixedCount++;
        recordChange(
          'КПП контрагента: не заполнен',
          `КПП: ${inlineReq.kpp}`,
          'Прямое извлечение КПП из текста операции',
          'counterparty_requisites',
          'fill_formal_requisites',
          op.id
        );
      }
      if (!op.counterpartyBankAccount && inlineReq.bankAccount) {
        op.counterpartyBankAccount = inlineReq.bankAccount;
        fixedCount++;
        recordChange(
          'Расчётный счёт получателя: не заполнен',
          `р/сч ${inlineReq.bankAccount}`,
          'Извлечение банковских реквизитов из текста операции',
          'bank_bik',
          'fill_formal_requisites',
          op.id
        );
      }
      if (!op.counterpartyBik && inlineReq.bik) {
        op.counterpartyBik = inlineReq.bik;
        op.counterpartyBankName = inlineReq.bankName;
        fixedCount++;
        recordChange(
          'БИК банка контрагента: по умолчанию',
          `БИК ${inlineReq.bik} (${inlineReq.bankName})`,
          'Прямое указание БИК в тексте операции (приоритет над банком по умолчанию)',
          'bank_bik',
          'fill_formal_requisites',
          op.id
        );
      }
      if (!op.organizationBik) {
        op.organizationBik = db1C?.organization.bik || defaultBik;
        op.organizationBankName = db1C?.organization.bankName || DEFAULT_SBERBANK_NAME;
      }

      // Pass Stage 1c: Disable accidental duplicates in 1C DB
      if (op.isDuplicateIn1C && op.includeInProcessing) {
        op.includeInProcessing = false;
        fixedCount++;
        log.push(`Исключён из расчёта дубликат документа: «${op.description.slice(0, 50)}»`);
        recordChange(
          `Дубликат включён в расчёт: «${op.description.slice(0, 45)}»`,
          'Исключён из проведения (защита от задвоения оборотов)',
          op.duplicateReason || 'Совпадение с уже проведённым документом в базе 1С',
          'duplicate_guard',
          'disable_duplicate_doc',
          op.id
        );
      }

      if (!op.includeInProcessing) {
        enrichedOps.push(op);
        continue;
      }

      // Sanitize accidental <2-char counterparty fragment
      if (op.counterpartyName.trim().length > 0 && op.counterpartyName.trim().length < 2) {
        op.counterpartyName = '';
        op.counterpartyInn = '';
        op.counterpartyKpp = '';
        if (doesOperationRequireCounterparty(op.category)) {
          op.bindings.counterparty = { status: 'missing', note: 'Не указан контрагент' };
        } else {
          op.bindings.counterparty = { status: 'not_required' };
        }
      }

      const buildChronoPriors = (targetOp: QueuedOperation): QueuedOperation[] => {
        const byId = new Map<string, QueuedOperation>();
        for (const p of enrichedOps) {
          if (p.id !== targetOp.id && p.includeInProcessing) {
            byId.set(p.id, p);
          }
        }
        for (const other of manualAndImportedOps) {
          if (
            other.id !== targetOp.id &&
            !byId.has(other.id) &&
            other.includeInProcessing &&
            (other.amount >= 0.01 ||
              other.category === 'hr_hire' ||
              other.category === 'writ_of_execution' ||
              other.category === 'contract_event' ||
              other.category === 'customer_invoice' ||
              other.category === 'supplier_invoice' ||
              other.category === 'policy_event') &&
            (!targetOp.date || !other.date || other.date <= targetOp.date)
          ) {
            byId.set(other.id, other);
          }
        }
        return Array.from(byId.values());
      };

      // Pass Stage 1d: Reclassify legacy misclassified operations
      const naturalClass = detectOperationClassification({
        description: op.description,
        nomenclatureName: op.nomenclatureName || inlineReq.nomenclatureHint,
        counterpartyName: op.counterpartyName || inlineReq.counterparty,
      });
      const shouldReclassify = isMisclassifiedLegacyOperation(op);

      if (shouldReclassify) {
        const prevDocType = op.docType1C;
        const prevHadNeedsAmount = Boolean(op.needsAmount || op.amountMode === 'required_missing');
        const prevVatRate = op.vatRate;
        const prevCp = op.counterpartyName;
        const naturalNeedsCp = doesOperationRequireCounterparty(naturalClass.category);

        const seqCtx: BatchSequentialContext = {
          priorOperations: buildChronoPriors(op),
          reportingYear,
          defaultBik,
          defaultBankName: DEFAULT_SBERBANK_NAME,
          assumeInvoiceOnVatPurchase: [
            'purchase_goods',
            'purchase_materials',
            'purchase_services',
            'purchase_equipment',
          ].includes(naturalClass.category),
        };

        const reclassified = bindAndGenerateOperation(
          {
            rowKey: op.rowKey,
            sourceFileName: op.sourceFileName,
            date: op.date,
            docNumber: op.docNumber,
            description: op.description,
            rawExcelAmount: op.rawExcelAmount,
            orderTotalAmount: op.orderTotalAmount,
            amount:
              naturalClass.category === 'sale_goods' &&
              (op.quantity ?? inlineReq.quantity) &&
              (op.unitPrice ?? inlineReq.unitPrice)
                ? 0
                : op.amount,
            quantity: op.quantity ?? inlineReq.quantity,
            unitPrice: op.unitPrice ?? inlineReq.unitPrice,
            counterpartyName: naturalNeedsCp
              ? op.counterpartyName || inlineReq.counterparty
              : naturalClass.category === 'founder_contribution'
                ? op.counterpartyName
                : '',
            counterpartyInn: naturalNeedsCp ? op.counterpartyInn : '',
            counterpartyKpp: naturalNeedsCp ? op.counterpartyKpp : '',
            counterpartyBankAccount: naturalNeedsCp ? op.counterpartyBankAccount : undefined,
            counterpartyBik: naturalNeedsCp ? op.counterpartyBik : undefined,
            counterpartyBankName: naturalNeedsCp ? op.counterpartyBankName : undefined,
            counterpartySource: naturalNeedsCp ? op.counterpartySource : undefined,
            contractName: naturalNeedsCp ? op.contractName : '',
            nomenclatureName: op.nomenclatureName || inlineReq.nomenclatureHint,
            nomenclatureGroupHint:
              op.nomenclatureGroupName && op.nomenclatureGroupName !== 'Основная номенклатурная группа'
                ? op.nomenclatureGroupName
                : inlineReq.productionObjectHint,
            employeeName: op.employeeName || inlineReq.employeeHint,
            monthlySalary: op.monthlySalary ?? inlineReq.monthlySalaryHint,
            employeePosition: op.employeePosition || inlineReq.employeePositionHint,
            employeeChildCount: op.employeeChildCount ?? inlineReq.employeeChildCountHint,
            employeeIsSingleParent:
              op.employeeIsSingleParent ?? inlineReq.employeeIsSingleParentHint,
            employeePropertyDeduction:
              op.employeePropertyDeduction ?? inlineReq.employeePropertyDeductionHint,
            founderShares: op.founderShares ?? inlineReq.founderSharesHint,
            ownOrganization: op.ownOrganization,
            actionSequenceHint: op.actionSequenceHint,
            usefulLifeMonths: op.usefulLifeMonths ?? inlineReq.usefulLifeMonthsHint,
            depreciationBaseAmount: op.depreciationBaseAmount,
            alimonyRecipientName: op.alimonyRecipientName || inlineReq.alimonyRecipientHint,
            alimonyRecipientInn:
              op.alimonyRecipientInn ||
              (naturalPreCheck.category === 'alimony_payout' ||
              naturalPreCheck.category === 'writ_of_execution'
                ? inlineReq.inn
                : undefined),
            alimonyRatePercent: op.alimonyRatePercent ?? inlineReq.alimonyRatePercentHint,
            alimonyFixedAmount: op.alimonyFixedAmount ?? inlineReq.alimonyFixedAmountHint,
            alimonyShareLabel: op.alimonyShareLabel || inlineReq.alimonyShareLabelHint,
            writStartDate: op.writStartDate || inlineReq.writStartDateHint,
            financialNotesSummary: op.financialNotesSummary || inlineReq.financialNotesSummaryHint,
            financialNotesList: op.financialNotesList ?? inlineReq.financialNotesListHint,
            periodicPaymentAmount: op.periodicPaymentAmount ?? inlineReq.periodicPaymentAmountHint,
            interestRatePercent: op.interestRatePercent ?? inlineReq.interestRatePercentHint,
            warehouseName: op.warehouseName,
            warehouseToHint: op.warehouseToName,
            expenseItemName: op.expenseItemName,
            cashFlowItemName: op.cashFlowItemName,
            costAccountHint: op.costAccount,
            materialAccountHint: op.materialAccount,
          },
          db1C,
          op.id,
          seqCtx
        );

        op = { ...reclassified, includeInProcessing: op.includeInProcessing };
        fixedCount++;
        const entryPreview =
          op.entries.length > 0
            ? op.entries
                .map((e) => (e.isOffBalance ? `Дт ${e.debit}` : `Дт ${e.debit} Кт ${e.credit}`))
                .join('; ')
            : 'без проводок (регистрационное событие)';
        log.push(
          `Переклассифицирована операция «${op.description.slice(0, 50)}»: ${prevDocType} → ${op.docType1C} (${entryPreview})`
        );
        recordChange(
          `1С: ${prevDocType}${prevVatRate > 0 ? `, НДС ${prevVatRate}%` : ''}${prevHadNeedsAmount ? ', ошибка «Требуется сумма»' : ''}${!naturalNeedsCp && prevCp ? `, ложный запрос контрагента` : ''}`,
          `1С: ${op.docType1C} (${DOC_TYPE_LABELS_1C[op.docType1C]})${op.documentSubKind1C ? ` · ${op.documentSubKind1C}` : ''}${op.employeeName ? ` · ${op.employeeName}` : ''}${op.counterpartyName ? ` · ${op.counterpartyName}` : ''} — ${entryPreview}${op.amount >= 0.01 ? ` (${op.amount.toFixed(2)} ₽)` : ''}`,
          'Интеллектуальный классификатор 1С:БП 3.0 (касса, банк, подотчёт 71.01, реализация 90.01.1, займы, векселя, ОС, договоры)',
          'doc_reclassification',
          'reclassify_legacy_doc',
          op.id
        );
      }

      // Pass Stage 2a: Auto-link missing buyer/supplier or compute missing amount via 8-level resolver
      if (
        !shouldReclassify &&
        (op.category === 'sale_goods' || op.category === 'sale_services') &&
        (!op.counterpartyName.trim() ||
          (/по\s+цене\s+без\s+ндс/i.test(op.description) && op.vatRule !== 'on_top'))
      ) {
        const prevCp = op.counterpartyName.trim();
        const prevAmt = op.amount;
        const prevVatRule = op.vatRule;
        const rebuiltSale = bindAndGenerateOperation(
          {
            rowKey: op.rowKey,
            sourceFileName: op.sourceFileName,
            date: op.date,
            docNumber: op.docNumber,
            description: op.description,
            rawExcelAmount: op.rawExcelAmount,
            orderTotalAmount: op.orderTotalAmount,
            amount:
              /по\s+цене\s+без\s+ндс/i.test(op.description) &&
              (op.quantity ?? inlineReq.quantity) &&
              (op.unitPrice ?? inlineReq.unitPrice)
                ? 0
                : op.amount,
            quantity: op.quantity ?? inlineReq.quantity,
            unitPrice: op.unitPrice ?? inlineReq.unitPrice,
            counterpartyName: op.counterpartyName || inlineReq.counterparty,
            counterpartyInn: op.counterpartyInn,
            counterpartyKpp: op.counterpartyKpp,
            contractName: op.contractName,
            nomenclatureName: op.nomenclatureName || inlineReq.nomenclatureHint,
            warehouseName: op.warehouseName,
            docTypeHint: op.docType1C,
            categoryHint: op.category,
          },
          db1C,
          op.id,
          {
            priorOperations: buildChronoPriors(op),
            reportingYear,
            defaultBik,
            defaultBankName: DEFAULT_SBERBANK_NAME,
            assumeInvoiceOnVatPurchase: false,
          }
        );
        if (
          rebuiltSale.counterpartyName !== prevCp ||
          Math.abs(rebuiltSale.amount - prevAmt) >= 0.01 ||
          rebuiltSale.vatRule !== prevVatRule
        ) {
          op = { ...rebuiltSale, includeInProcessing: op.includeInProcessing };
          fixedCount++;
          log.push(
            `Уточнена реализация «${op.description.slice(0, 50)}»: ${
              op.counterpartyName ? `покупатель «${op.counterpartyName}», ` : ''
            }сумма с НДС ${op.amount.toFixed(2)} ₽`
          );
          recordChange(
            `Реализация: ${prevCp ? prevCp : 'покупатель не указан'}, сумма ${prevAmt.toFixed(2)} ₽`,
            `Покупатель: ${op.counterpartyName || 'не указан'}, сумма с НДС: ${op.amount.toFixed(2)} ₽ (НДС ${op.vatAmount.toFixed(2)} ₽)`,
            'Хронологическое связывание покупателя по авансам 62.02 / договорам БД 1С и расчёт НДС 20% сверху (п. 1 ст. 168 НК РФ)',
            'directory_binding',
            'resolve_amount_and_links',
            op.id
          );
        }
      }

      // Context-link missing counterparty when uniquely proven by closed-world settlements (prior or forward)
      if (
        !shouldReclassify &&
        doesOperationRequireCounterparty(op.category) &&
        !op.counterpartyName.trim()
      ) {
        const ctxMatches = computeContextCounterpartySuggestions(
          op,
          [...enrichedOps, ...manualAndImportedOps.filter((m) => !enrichedOps.some((e) => e.id === m.id))],
          db1C
        );
        if (ctxMatches.length === 1) {
          const singleCp = ctxMatches[0];
          op.counterpartyName = singleCp.name;
          op.counterpartyInn = singleCp.inn || op.counterpartyInn;
          op.counterpartyKpp = singleCp.kpp || op.counterpartyKpp;
          if (!op.contractName && singleCp.contractName) {
            op.contractName = singleCp.contractName;
          }
          fixedCount++;
          recordChange(
            'Контрагент (поставщик): не указан',
            `Поставщик: «${singleCp.name}» (${singleCp.provenanceLabel})`,
            'Семантическая привязка оплаты к открытой задолженности по счёту 60.01',
            'directory_binding',
            'resolve_amount_and_links',
            op.id
          );
        }
      }

      if (
        !shouldReclassify &&
        (op.amount < 0.01 || op.needsAmount || op.amountMode === 'calculated_by_1c') &&
        op.category !== 'closing' &&
        op.category !== 'hr_hire' &&
        op.category !== 'writ_of_execution' &&
        op.category !== 'contract_event' &&
        op.category !== 'policy_event' &&
        op.category !== 'customer_invoice' &&
        op.category !== 'supplier_invoice'
      ) {
        const prevAmt = op.amount;
        const prevEntriesLen = op.entries.length;
        const recomputed = bindAndGenerateOperation(
          {
            rowKey: op.rowKey,
            sourceFileName: op.sourceFileName,
            date: op.date,
            docNumber: op.docNumber,
            description: op.description,
            rawExcelAmount: op.rawExcelAmount,
            orderTotalAmount: op.orderTotalAmount,
            amount: 0,
            quantity: op.quantity ?? inlineReq.quantity,
            unitPrice: op.unitPrice ?? inlineReq.unitPrice,
            counterpartyName:
              op.category === 'bank_out' && op.counterpartyName.includes(';')
                ? ''
                : op.counterpartyName || inlineReq.counterparty,
            counterpartyInn:
              op.category === 'bank_out' && op.counterpartyName.includes(';')
                ? ''
                : op.counterpartyInn,
            counterpartyKpp:
              op.category === 'bank_out' && op.counterpartyName.includes(';')
                ? ''
                : op.counterpartyKpp,
            counterpartyBankAccount: op.counterpartyBankAccount,
            counterpartyBik: op.counterpartyBik,
            counterpartyBankName: op.counterpartyBankName,
            counterpartySource: op.counterpartySource,
            egrulCandidates: op.egrulCandidates,
            contractName: op.contractName,
            nomenclatureName: op.nomenclatureName || inlineReq.nomenclatureHint,
            nomenclatureGroupHint:
              op.nomenclatureGroupName || inlineReq.productionObjectHint,
            employeeName: op.employeeName || inlineReq.employeeHint,
            monthlySalary: op.monthlySalary ?? inlineReq.monthlySalaryHint,
            employeePosition: op.employeePosition || inlineReq.employeePositionHint,
            employeeChildCount: op.employeeChildCount ?? inlineReq.employeeChildCountHint,
            employeeIsSingleParent:
              op.employeeIsSingleParent ?? inlineReq.employeeIsSingleParentHint,
            employeePropertyDeduction:
              op.employeePropertyDeduction ?? inlineReq.employeePropertyDeductionHint,
            founderShares: op.founderShares ?? inlineReq.founderSharesHint,
            ownOrganization: op.ownOrganization,
            actionSequenceHint: op.actionSequenceHint,
            usefulLifeMonths: op.usefulLifeMonths ?? inlineReq.usefulLifeMonthsHint,
            depreciationBaseAmount: op.depreciationBaseAmount,
            alimonyRecipientName: op.alimonyRecipientName || inlineReq.alimonyRecipientHint,
            alimonyRecipientInn:
              op.alimonyRecipientInn ||
              (op.category === 'alimony_payout' ? inlineReq.inn : undefined),
            alimonyRatePercent: op.alimonyRatePercent ?? inlineReq.alimonyRatePercentHint,
            alimonyFixedAmount: op.alimonyFixedAmount ?? inlineReq.alimonyFixedAmountHint,
            alimonyShareLabel: op.alimonyShareLabel || inlineReq.alimonyShareLabelHint,
            writStartDate: op.writStartDate || inlineReq.writStartDateHint,
            financialNotesSummary: op.financialNotesSummary || inlineReq.financialNotesSummaryHint,
            financialNotesList: op.financialNotesList ?? inlineReq.financialNotesListHint,
            periodicPaymentAmount: op.periodicPaymentAmount ?? inlineReq.periodicPaymentAmountHint,
            interestRatePercent: op.interestRatePercent ?? inlineReq.interestRatePercentHint,
            warehouseName: op.warehouseName,
            warehouseToHint: op.warehouseToName,
            expenseItemName: op.expenseItemName,
            cashFlowItemName: op.cashFlowItemName,
            costAccountHint: op.costAccount,
            materialAccountHint: op.materialAccount,
            docTypeHint: op.docType1C,
            categoryHint: op.category,
          },
          db1C,
          op.id,
          {
            priorOperations: buildChronoPriors(op),
            reportingYear,
            defaultBik,
            defaultBankName: DEFAULT_SBERBANK_NAME,
            assumeInvoiceOnVatPurchase: true,
          }
        );
        if (recomputed.amount >= 0.01 && prevAmt < 0.01) {
          op = { ...recomputed, includeInProcessing: op.includeInProcessing };
          fixedCount++;
          log.push(
            `Рассчитана сумма операции «${op.description.slice(0, 45)}»: ${op.amount.toFixed(2)} ₽`
          );
          recordChange(
            prevEntriesLen === 0
              ? 'Сумма операции: не заполнена (0,00 ₽)'
              : 'Себестоимость / сумма: расчёт в 1С (0,00 ₽)',
            `Сумма: ${op.amount.toFixed(2)} ₽ (${op.entries.length} провод.)`,
            op.amountCalculationNote || 'Авторасчёт по 7 уровням замкнутого контура задания',
            'amount_calc',
            'resolve_amount_and_links',
            op.id
          );
        } else if (recomputed.amountMode === 'calculated_by_1c' && prevEntriesLen === 0) {
          op = { ...recomputed, includeInProcessing: op.includeInProcessing };
          fixedCount++;
          log.push(
            `Сформированы эталонные проводки внутренней операции «${op.description.slice(0, 45)}»`
          );
        }
      }

      // Auto-extract founder FIO for 75.01 contributions if missing
      if (!op.counterpartyName.trim() && isFounderContributionText(op.description)) {
        const rebuiltFounder = bindAndGenerateOperation(
          {
            rowKey: op.rowKey,
            sourceFileName: op.sourceFileName,
            date: op.date,
            docNumber: op.docNumber,
            description: op.description,
            rawExcelAmount: op.rawExcelAmount,
            amount: op.amount,
            vatRate: 0,
            vatRule: 'none',
            vatAmount: 0,
          },
          db1C,
          op.id,
          {
            priorOperations: buildChronoPriors(op),
            reportingYear,
            defaultBik,
            defaultBankName: DEFAULT_SBERBANK_NAME,
            assumeInvoiceOnVatPurchase: true,
          }
        );
        if (rebuiltFounder.counterpartyName) {
          op = { ...rebuiltFounder, includeInProcessing: op.includeInProcessing };
          fixedCount++;
          log.push(
            `Определён учредитель «${op.counterpartyName}» для взноса в уставный капитал (счёт 75.01)`
          );
          recordChange(
            'Субконто 75.01: не заполнено',
            `Учредитель: ${op.counterpartyName} (Дт 51/50 Кт 75.01, без НДС)`,
            'Извлечение ФИО учредителя из текста операции и привязка к справочнику Физлиц 1С',
            'founder_75',
            'resolve_amount_and_links',
            op.id
          );
        }
      }

      // Pass Stage 3: Match Counterparty in db1C OR Fill Formal Requisites (EGRUL / Known / Valid FNS Educational INN/KPP)
      if (op.counterpartyName.trim().length >= 2 && db1C) {
        const directPersonOrCp = matchPersonOrCounterpartyIn1C(
          op.counterpartyName,
          op.counterpartyInn,
          db1C
        );
        const norm = normalizeEntityKey(op.counterpartyName);

        if (directPersonOrCp) {
          const wasMatched = op.bindings.counterparty.status === 'matched_1c';
          const prevCpLabel = `${op.counterpartyName} (ИНН: ${op.counterpartyInn || 'пусто'})`;
          const nameChanged = op.counterpartyName !== directPersonOrCp.name;
          const innAdded = !op.counterpartyInn && Boolean(directPersonOrCp.inn);
          const kppAdded = !op.counterpartyKpp && Boolean(directPersonOrCp.kpp);

          op.counterpartyName = directPersonOrCp.name;
          if (!op.counterpartyInn && directPersonOrCp.inn) {
            op.counterpartyInn = directPersonOrCp.inn;
          }
          if (!op.counterpartyKpp && directPersonOrCp.kpp) {
            op.counterpartyKpp = directPersonOrCp.kpp;
          }
          op.counterpartyKind = directPersonOrCp.kind;
          op.counterpartySource = 'db_1c';
          op.bindings.counterparty = {
            status: 'matched_1c',
            matchedName: directPersonOrCp.name,
            matchedCode1C: directPersonOrCp.code1C,
            matchedInn: directPersonOrCp.inn,
          };
          if (!wasMatched || nameChanged || innAdded || kppAdded) {
            fixedCount++;
            log.push(
              `Привязан элемент справочника 1С (${directPersonOrCp.source}): «${directPersonOrCp.name}»`
            );
            recordChange(
              prevCpLabel,
              `${op.counterpartyName} (ИНН ${op.counterpartyInn || '—'}, код 1С ${directPersonOrCp.code1C || '—'})`,
              `Сопоставление со справочником 1С «${directPersonOrCp.source}»`,
              'directory_binding',
              'fill_formal_requisites',
              op.id
            );
          }
        } else if (norm.length >= 3) {
          const matchedCp = db1C.counterparties.find((c) => {
            if (op.counterpartyInn && c.inn && op.counterpartyInn === c.inn) return true;
            const cn = normalizeEntityKey(c.name);
            const fn = normalizeEntityKey(c.fullName ?? '');
            return (
              cn === norm ||
              (cn.length >= 4 && (cn.includes(norm) || norm.includes(cn))) ||
              (fn.length >= 4 && (fn.includes(norm) || norm.includes(fn)))
            );
          });

          if (matchedCp) {
            const prevLabel = `${op.counterpartyName} (ИНН: ${op.counterpartyInn || 'пусто'})`;
            let changed = false;
            if (op.counterpartyName !== matchedCp.name) {
              op.counterpartyName = matchedCp.name;
              changed = true;
            }
            if (!op.counterpartyInn && matchedCp.inn) {
              op.counterpartyInn = matchedCp.inn;
              changed = true;
            }
            if (!op.counterpartyKpp && matchedCp.kpp) {
              op.counterpartyKpp = matchedCp.kpp;
              changed = true;
            }
            op.counterpartySource = 'db_1c';
            op.bindings.counterparty = {
              status: 'matched_1c',
              matchedName: matchedCp.name,
              matchedCode1C: matchedCp.code1C,
              matchedInn: matchedCp.inn,
            };
            if (changed) {
              fixedCount++;
              log.push(`Подтянуты реквизиты из справочника 1С для контрагента «${matchedCp.name}»`);
              recordChange(
                prevLabel,
                `${matchedCp.name} (ИНН ${matchedCp.inn}, КПП ${matchedCp.kpp || '—'})`,
                'Автоподбор карточки из справочника «Контрагенты» базы 1С',
                'directory_binding',
                'fill_formal_requisites',
                op.id
              );
            }
          } else {
            const histDoc = db1C.documents.find((d) => {
              const dn = normalizeEntityKey(d.counterparty);
              return dn.length >= 4 && (dn.includes(norm) || norm.includes(dn));
            });
            if (histDoc) {
              if (!op.counterpartyInn && histDoc.counterpartyInn) {
                op.counterpartyInn = histDoc.counterpartyInn;
                op.counterpartySource = 'db_1c';
                fixedCount++;
                log.push(`Подтянут ИНН из журнала документов 1С для «${histDoc.counterparty}»`);
                recordChange(
                  `ИНН «${op.counterpartyName}»: пусто`,
                  `ИНН: ${histDoc.counterpartyInn}`,
                  'История проведённых документов базы 1С (ВсеДокументы)',
                  'counterparty_requisites',
                  'fill_formal_requisites',
                  op.id
                );
              }
              if (!op.contractName && histDoc.contract) {
                op.contractName = histDoc.contract;
                op.bindings.contract = {
                  status: 'matched_1c',
                  matchedName: histDoc.contract,
                };
                fixedCount++;
              }
            }
          }
        }
      }

      // Pass Stage 3b: Formal Requisite Autofill for commercial counterparties not in 1C DB (EGRUL -> Known -> Educational FNS INN/KPP)
      const trimmedCp = op.counterpartyName.trim();
      const needsFormalCpInn =
        doesOperationRequireCounterparty(op.category) &&
        op.bindings.counterparty.status !== 'matched_1c' &&
        trimmedCp.length >= 2 &&
        !trimmedCp.includes(';') &&
        op.counterpartyKind !== 'ФизическоеЛицо' &&
        !isFounderContributionText(op.description);

      if (needsFormalCpInn) {
        const normCpKey = normalizeCounterpartyKey1C(trimmedCp);
        const canonicalRec = canonicalRegistry.get(normCpKey);
        const cpCacheKey = getCounterpartyGroupKey(trimmedCp);

        // Enforce 1 company = 1 canonical INN across the entire batch!
        if (
          canonicalRec &&
          isValidRussianInnFormat(canonicalRec.inn) &&
          validateRussianInnChecksum(canonicalRec.inn).valid
        ) {
          if (op.counterpartyInn !== canonicalRec.inn) {
            const prevInnLabel = op.counterpartyInn || 'не заполнен';
            op.counterpartyInn = canonicalRec.inn;
            op.counterpartyKpp =
              canonicalRec.kpp ||
              (canonicalRec.inn.length === 10 ? `${canonicalRec.inn.slice(0, 4)}01001` : op.counterpartyKpp);
            op.counterpartySource = canonicalRec.source;
            fixedCount++;
            recordChange(
              `ИНН «${trimmedCp}»: ${prevInnLabel}`,
              `ИНН ${op.counterpartyInn}${op.counterpartyKpp ? `, КПП ${op.counterpartyKpp}` : ''}`,
              'Синхронизация единого канонического ИНН контрагента по реестру операций (1 компания = 1 ИНН)',
              'counterparty_requisites',
              'fill_formal_requisites',
              op.id
            );
          }
          if (canonicalRec.canonicalName && op.counterpartyName !== canonicalRec.canonicalName) {
            op.counterpartyName = canonicalRec.canonicalName;
          }
        }

        const cleanCurrentInn = op.counterpartyInn.replace(/\D/g, '');
        const hasValidChecksumInn =
          isValidRussianInnFormat(cleanCurrentInn) &&
          validateRussianInnChecksum(cleanCurrentInn).valid;

        if (!hasValidChecksumInn) {
          const cachedFormal =
            formalCpRequisiteCache.get(cpCacheKey) ?? formalCpRequisiteCache.get(normCpKey);
          if (cachedFormal) {
            op.counterpartyInn = cachedFormal.inn;
            op.counterpartyKpp = cachedFormal.kpp || op.counterpartyKpp;
            op.counterpartySource = cachedFormal.source;
          } else {
            // 1. Region-aware active EGRUL candidate if fetched
            const bestEgrul = selectBestEgrulCandidate(op.egrulCandidates ?? [], {
              targetName: trimmedCp,
              homeRegionCode: homeRegion,
            });
            // 2. Known major Russian counterparty dictionary
            const normKey = normalizeEntityKey(trimmedCp);
            const knownMajor = KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES.find((k) =>
              k.aliases.some((al) => normKey === al || (al.length >= 4 && normKey.includes(al)))
            );

            if (bestEgrul && isValidRussianInnFormat(bestEgrul.inn)) {
              const prevInnLabel = op.counterpartyInn || 'не заполнен';
              op.counterpartyInn = bestEgrul.inn;
              op.counterpartyKpp =
                bestEgrul.kpp ||
                (bestEgrul.inn.length === 10 ? `${bestEgrul.inn.slice(0, 4)}01001` : '');
              op.counterpartyOgrn = bestEgrul.ogrn || op.counterpartyOgrn;
              op.counterpartySource = 'egrul_verified';
              const entryVal = {
                inn: op.counterpartyInn,
                kpp: op.counterpartyKpp,
                source: 'egrul_verified' as CounterpartyResolutionSource,
              };
              formalCpRequisiteCache.set(cpCacheKey, entryVal);
              formalCpRequisiteCache.set(normCpKey, entryVal);
              fixedCount++;
              log.push(
                `Заполнен ИНН/КПП из ЕГРЮЛ ФНС для «${trimmedCp}»: ИНН ${op.counterpartyInn}${op.counterpartyKpp ? `, КПП ${op.counterpartyKpp}` : ''}`
              );
              recordChange(
                `ИНН «${trimmedCp}»: ${prevInnLabel}`,
                `ИНН ${op.counterpartyInn}${op.counterpartyKpp ? `, КПП ${op.counterpartyKpp}` : ''} (действующее ЮЛ ЕГРЮЛ)`,
                `Приоритет действующей организации региона ${homeRegion} по данным ЕГРЮЛ ФНС`,
                'counterparty_requisites',
                'fill_formal_requisites',
                op.id
              );
            } else if (knownMajor) {
              op.counterpartyInn = knownMajor.inn;
              op.counterpartyKpp = knownMajor.kpp;
              op.counterpartyOgrn = knownMajor.ogrn || op.counterpartyOgrn;
              op.counterpartySource = 'egrul_verified';
              const entryVal = {
                inn: op.counterpartyInn,
                kpp: op.counterpartyKpp,
                source: 'egrul_verified' as CounterpartyResolutionSource,
              };
              formalCpRequisiteCache.set(cpCacheKey, entryVal);
              formalCpRequisiteCache.set(normCpKey, entryVal);
              fixedCount++;
              recordChange(
                `ИНН «${trimmedCp}»: не заполнен`,
                `ИНН ${op.counterpartyInn}, КПП ${op.counterpartyKpp}`,
                'Эталонный справочник федеральных поставщиков ЕГРЮЛ ФНС',
                'counterparty_requisites',
                'fill_formal_requisites',
                op.id
              );
            } else {
              // 3. Deterministic valid FNS-checksum educational INN/KPP in organization's home region
              const eduKind =
                op.counterpartyKind === 'ИндивидуальныйПредприниматель'
                  ? 'ИндивидуальныйПредприниматель'
                  : 'ЮридическоеЛицо';
              const generated = generateEducationalInnKpp(trimmedCp, eduKind, homeRegion);
              const prevInnLabel = op.counterpartyInn || 'не заполнен';
              op.counterpartyInn = generated.inn;
              op.counterpartyKpp = generated.kpp;
              op.counterpartySource = 'educational_generated';
              op.bindings.counterparty = {
                status: 'new_for_1c',
                note: 'Формальный реквизит подобран автоматически (на ОСВ не влияет)',
              };
              const entryVal = {
                inn: generated.inn,
                kpp: generated.kpp,
                source: 'educational_generated' as CounterpartyResolutionSource,
              };
              formalCpRequisiteCache.set(cpCacheKey, entryVal);
              formalCpRequisiteCache.set(normCpKey, entryVal);
              fixedCount++;
              log.push(
                `Сформирован формальный учебный ИНН/КПП (ФНС мод. 11, регион ${homeRegion}) для «${trimmedCp}»: ИНН ${generated.inn}${generated.kpp ? `, КПП ${generated.kpp}` : ''}`
              );
              recordChange(
                `ИНН «${trimmedCp}»: ${prevInnLabel}`,
                `ИНН ${generated.inn}${generated.kpp ? `, КПП ${generated.kpp}` : ''} (валидная контрольная цифра ФНС)`,
                `Автозаполнение формального реквизита учебной организации по региону ${homeRegion} (на расчёт ОСВ не влияет)`,
                'counterparty_requisites',
                'fill_formal_requisites',
                op.id
              );
            }
          }
        }

        // Fill missing 9-digit KPP for 10-digit legal entity INN
        const finalCleanInn = op.counterpartyInn.replace(/\D/g, '');
        if (
          op.counterpartyKind === 'ЮридическоеЛицо' &&
          finalCleanInn.length === 10 &&
          op.counterpartyKpp.replace(/\D/g, '').length !== 9
        ) {
          const fromDbKpp = db1C?.counterparties.find(
            (c) =>
              c.kpp.replace(/\D/g, '').length === 9 &&
              (c.inn.replace(/\D/g, '') === finalCleanInn ||
                normalizeEntityKey(c.name) === normalizeEntityKey(trimmedCp))
          )?.kpp;
          op.counterpartyKpp = fromDbKpp || `${finalCleanInn.slice(0, 4)}01001`;
          fixedCount++;
          recordChange(
            `КПП «${trimmedCp}»: не указан`,
            `КПП: ${op.counterpartyKpp}`,
            'Формирование стандартного КПП головной организации по коду ИФНС (первые 4 цифры ИНН + 01001)',
            'counterparty_requisites',
            'fill_formal_requisites',
            op.id
          );
        }
      }

      // Pass Stage 3c: Fill missing contract, warehouse, and expense item
      if (op.bindings.contract.status === 'missing') {
        const cpNorm = normalizeEntityKey(op.counterpartyName);
        const fromDir = db1C?.contracts.find(
          (c) =>
            (op.counterpartyInn && c.counterpartyInn === op.counterpartyInn) ||
            (cpNorm && normalizeEntityKey(c.counterpartyName) === cpNorm)
        );
        const fromDocs = db1C?.documents.find(
          (d) => d.contract && cpNorm && normalizeEntityKey(d.counterparty) === cpNorm
        );

        if (fromDir) {
          op.contractName = fromDir.name;
          op.contractNumber = fromDir.number || op.contractNumber;
          op.contractDate = fromDir.date || op.contractDate;
          op.bindings.contract = {
            status: 'matched_1c',
            matchedName: fromDir.name,
            matchedCode1C: fromDir.code1C,
          };
          fixedCount++;
          recordChange(
            `Договор (${op.counterpartyName}): не указан`,
            `Договор: «${fromDir.name}»`,
            'Справочник «ДоговорыКонтрагентов» базы 1С',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        } else if (fromDocs?.contract) {
          op.contractName = fromDocs.contract;
          op.bindings.contract = {
            status: 'matched_1c',
            matchedName: fromDocs.contract,
          };
          fixedCount++;
          recordChange(
            `Договор (${op.counterpartyName}): не указан`,
            `Договор: «${fromDocs.contract}»`,
            'Журнал документов базы 1С',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        } else {
          op.contractName = 'Основной договор';
          op.bindings.contract = {
            status: 'new_for_1c',
            note: 'Формальный реквизит (типовой договор 1С, на ОСВ не влияет)',
          };
          fixedCount++;
          recordChange(
            `Договор (${op.counterpartyName || op.docType1C}): не указан`,
            '«Основной договор» (автосоздание при выгрузке)',
            'Обязательность субконто «Договоры» на счетах 60/62 в 1С БП 3.0',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        }
      }

      if (op.bindings.warehouse.status === 'missing') {
        const whFromDb =
          db1C?.warehouses[0]?.name ||
          db1C?.documents.find((d) => Boolean(d.warehouse))?.warehouse;
        if (whFromDb) {
          op.warehouseName = whFromDb;
          op.bindings.warehouse = {
            status: 'matched_1c',
            matchedName: whFromDb,
            matchedCode1C: db1C?.warehouses[0]?.code1C,
          };
          fixedCount++;
          recordChange(
            'Склад МПЗ: не выбран',
            `Склад: «${whFromDb}»`,
            'Справочник «Склады» базы 1С',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        } else {
          op.warehouseName = 'Основной склад';
          op.bindings.warehouse = {
            status: 'new_for_1c',
            note: 'Формальный реквизит (основной склад 1С, на ОСВ не влияет)',
          };
          fixedCount++;
          recordChange(
            'Склад МПЗ: не выбран',
            'Склад: «Основной склад»',
            'Обязательный реквизит складского учёта счетов 10 / 41 в 1С БП 3.0',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        }
      }

      if (op.bindings.expenseItem.status === 'missing') {
        const cpNorm = normalizeEntityKey(op.counterpartyName);
        const histPosting = db1C?.postings.find(
          (p) =>
            ['20.01', '25', '26', '44.01'].includes(p.debit) &&
            p.debitSubconto.length > 0 &&
            cpNorm &&
            normalizeEntityKey(`${p.counterpartyName ?? ''} ${p.creditSubconto.join(' ')}`).includes(cpNorm)
        );
        const histExpName = histPosting?.debitSubconto[0];
        const fallbackExp = db1C?.expenseItems[0]?.name;

        if (histExpName) {
          op.expenseItemName = histExpName;
          op.bindings.expenseItem = { status: 'matched_1c', matchedName: histExpName };
          fixedCount++;
          recordChange(
            'Статья затрат: не выбрана',
            `Статья затрат: «${histExpName}»`,
            'Анализ предыдущих проводок по данному поставщику в базе 1С',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        } else if (fallbackExp) {
          op.expenseItemName = fallbackExp;
          op.bindings.expenseItem = {
            status: 'matched_1c',
            matchedName: fallbackExp,
            matchedCode1C: db1C?.expenseItems[0]?.code1C,
          };
          fixedCount++;
          recordChange(
            'Статья затрат: не выбрана',
            `Статья затрат: «${fallbackExp}»`,
            'Справочник «Статьи затрат» базы 1С',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        } else {
          op.expenseItemName = 'Прочие общехозяйственные расходы';
          op.bindings.expenseItem = {
            status: 'new_for_1c',
            note: 'Формальный реквизит (типовая статья затрат 26 счёта, на ОСВ не влияет)',
          };
          fixedCount++;
          recordChange(
            'Статья затрат: не выбрана',
            '«Прочие общехозяйственные расходы»',
            'Стандартная аналитика счёта 26 в 1С БП 3.0',
            'directory_binding',
            'fill_formal_requisites',
            op.id
          );
        }
      }

      // Regenerate empty entries if operation now has a valid amount
      if (
        op.entries.length === 0 &&
        op.category !== 'hr_hire' &&
        op.category !== 'writ_of_execution' &&
        op.category !== 'contract_event' &&
        op.category !== 'policy_event' &&
        op.category !== 'customer_invoice' &&
        op.category !== 'supplier_invoice' &&
        op.category !== 'manual' &&
        (op.amount >= 0.01 || op.amountMode === 'calculated_by_1c')
      ) {
        op = bindAndGenerateOperation(
          {
            rowKey: op.rowKey,
            sourceFileName: op.sourceFileName,
            date: op.date,
            docNumber: op.docNumber,
            description: op.description,
            rawExcelAmount: op.rawExcelAmount,
            orderTotalAmount: op.orderTotalAmount,
            amount: op.amount,
            vatRate: op.vatRate,
            vatRule: op.vatRule,
            vatAmount: op.vatAmount,
            hasInvoiceSF: op.hasInvoiceSF,
            counterpartyName: op.counterpartyName,
            counterpartyInn: op.counterpartyInn,
            counterpartyKpp: op.counterpartyKpp,
            counterpartyBankAccount: op.counterpartyBankAccount,
            counterpartyBik: op.counterpartyBik,
            counterpartyBankName: op.counterpartyBankName,
            counterpartySource: op.counterpartySource,
            egrulCandidates: op.egrulCandidates,
            contractName: op.contractName,
            nomenclatureName: op.nomenclatureName,
            nomenclatureGroupHint: op.nomenclatureGroupName,
            employeeName: op.employeeName,
            monthlySalary: op.monthlySalary,
            employeePosition: op.employeePosition,
            employeeChildCount: op.employeeChildCount,
            employeeIsSingleParent: op.employeeIsSingleParent,
            employeePropertyDeduction: op.employeePropertyDeduction,
            founderShares: op.founderShares,
            ownOrganization: op.ownOrganization,
            actionSequenceHint: op.actionSequenceHint,
            usefulLifeMonths: op.usefulLifeMonths,
            depreciationBaseAmount: op.depreciationBaseAmount,
            alimonyRecipientName: op.alimonyRecipientName,
            alimonyRecipientInn: op.alimonyRecipientInn,
            alimonyRatePercent: op.alimonyRatePercent,
            alimonyFixedAmount: op.alimonyFixedAmount,
            alimonyShareLabel: op.alimonyShareLabel,
            writStartDate: op.writStartDate,
            financialNotesSummary: op.financialNotesSummary,
            financialNotesList: op.financialNotesList,
            disposedFinancialNoteId: op.disposedFinancialNoteId,
            periodicPaymentAmount: op.periodicPaymentAmount,
            interestRatePercent: op.interestRatePercent,
            warehouseName: op.warehouseName,
            warehouseToHint: op.warehouseToName,
            expenseItemName: op.expenseItemName,
            cashFlowItemName: op.cashFlowItemName,
            costAccountHint: op.costAccount,
            materialAccountHint: op.materialAccount,
            docTypeHint: op.docType1C,
            categoryHint: op.category,
          },
          db1C,
          op.id,
          {
            priorOperations: buildChronoPriors(op),
            reportingYear,
            defaultBik,
            defaultBankName: DEFAULT_SBERBANK_NAME,
            assumeInvoiceOnVatPurchase: true,
          }
        );
        fixedCount++;
        appliedRuleSet.add('resolve_amount_and_links');
      }

      enrichedOps.push(op);
    }

    // Pass Stage 4: Full Chronological Recalculation across all enriched operations
    let chronoSyncedOps = recalculateOperationsChronologically(enrichedOps, db1C, {
      reportingYear,
      defaultBik,
      calculationProfile,
      monthlyProfitTax,
    });

    // Replace any remaining group accounts -> leaf subaccounts & refresh readinessStatus
    chronoSyncedOps = chronoSyncedOps.map((opItem) => {
      if (!opItem.includeInProcessing || opItem.autoGeneratedKind) return opItem;
      const cpSub = [opItem.counterpartyName, opItem.contractName].filter(Boolean).join(' / ');
      let entriesChanged = false;
      const fixedEntries = opItem.entries.map((entry) => {
        if (
          entry.isOffBalance ||
          isOffBalanceAccountCode(entry.debit) ||
          isOffBalanceAccountCode(entry.credit)
        ) {
          return entry;
        }
        let dt = entry.debit;
        let kt = entry.credit;
        if (getAccountInfo(dt).isGroup) {
          const oldDt = dt;
          dt = normalizeAccountToLeaf1C(dt, 'debit', opItem.description);
          entriesChanged = true;
          fixedCount++;
          recordChange(
            `Счёт Дт: ${oldDt} (групповой)`,
            `Счёт Дт: ${dt}`,
            'Замена группового счёта на рабочий субсчёт Плана счетов 1С БП 3.0',
            'directory_binding',
            'replace_group_account',
            opItem.id
          );
        }
        if (getAccountInfo(kt).isGroup) {
          const oldKt = kt;
          kt = normalizeAccountToLeaf1C(kt, 'credit', opItem.description);
          entriesChanged = true;
          fixedCount++;
          recordChange(
            `Счёт Кт: ${oldKt} (групповой)`,
            `Счёт Кт: ${kt}`,
            'Замена группового счёта на рабочий субсчёт Плана счетов 1С БП 3.0',
            'directory_binding',
            'replace_group_account',
            opItem.id
          );
        }
        return {
          ...entry,
          debit: dt,
          credit: kt,
          debitSubconto:
            entry.debitSubconto ||
            (dt.startsWith('60') || dt.startsWith('62')
              ? cpSub
              : dt === '26' || dt === '20.01'
                ? opItem.expenseItemName
                : ''),
          creditSubconto:
            entry.creditSubconto ||
            (kt.startsWith('60') || kt.startsWith('62') ? cpSub : ''),
        };
      });

      const updatedOp: QueuedOperation = {
        ...opItem,
        entries: fixedEntries,
      };

      if (
        updatedOp.category === 'hr_hire' ||
        updatedOp.category === 'writ_of_execution' ||
        updatedOp.category === 'contract_event' ||
        updatedOp.category === 'policy_event' ||
        updatedOp.category === 'customer_invoice' ||
        updatedOp.category === 'supplier_invoice' ||
        updatedOp.category === 'vat_deduction'
      ) {
        updatedOp.needsAmount = undefined;
        updatedOp.readinessStatus = 'ready';
      } else if (updatedOp.amountMode === 'calculated_by_1c') {
        updatedOp.needsAmount = undefined;
        updatedOp.readinessStatus = 'calculated_1c';
      } else {
        const requiresCp = doesOperationRequireCounterparty(updatedOp.category);
        const hasValidCp =
          !requiresCp ||
          (Boolean(updatedOp.counterpartyName.trim()) &&
            (updatedOp.bindings.counterparty.status === 'matched_1c' ||
              updatedOp.counterpartyKind === 'ФизическоеЛицо' ||
              updatedOp.counterpartyInn.length === 10 ||
              updatedOp.counterpartyInn.length === 12));
        const hasAllAnalytics =
          updatedOp.bindings.contract.status !== 'missing' &&
          updatedOp.bindings.warehouse.status !== 'missing' &&
          updatedOp.bindings.expenseItem.status !== 'missing';

        if (
          !updatedOp.needsAmount &&
          updatedOp.amountMode !== 'required_missing' &&
          (updatedOp.entries.length > 0 || updatedOp.category === 'closing') &&
          hasValidCp &&
          hasAllAnalytics &&
          !(updatedOp.category === 'manual' && updatedOp.entries.length === 0)
        ) {
          updatedOp.readinessStatus = 'ready';
          updatedOp.readinessNote = 'Все реквизиты и проводки 1С:БП 3.0 заполнены';
        }
      }

      if (entriesChanged) {
        updatedOp.mentorGuide1C = buildOperationMentorGuide1C(updatedOp, db1C);
      }
      return updatedOp;
    });

    // Pass Stage 5a: Reclassify red 60.01/60.02/62.01/62.02 balances and cover red 50.01 cash from 51
    let intermediateOsv = calculateCurrentOsv(chronoSyncedOps);
    const redSubs6001 = (intermediateOsv.subcontoRowsByAccount?.['60.01'] ?? []).filter(
      (s) => s.endCredit < -0.01 || s.endDebit > 0.01
    );
    const row6001 = intermediateOsv.leafRows.find((r) => r.code === '60.01');
    if ((row6001 && row6001.hasRedEnd) || redSubs6001.length > 0) {
      for (const op of chronoSyncedOps) {
        if (op.category === 'bank_out' || op.category === 'cash_out') {
          for (const e of op.entries) {
            if (e.debit === '60.01' && (e.credit === '51' || e.credit === '50.01')) {
              const subMatchesRed =
                redSubs6001.length === 0 ||
                redSubs6001.some((rs) => {
                  const rsKey = normalizeEntityKey(rs.subcontoLabel.split('/')[0] ?? '');
                  const eKey = normalizeEntityKey(
                    (e.debitSubconto || op.counterpartyName || '').split('/')[0] ?? ''
                  );
                  return !rsKey || !eKey || rsKey === eKey;
                });
              if (subMatchesRed) {
                e.debit = '60.02';
                e.description = 'Перечислен аванс поставщику (переклассифицировано с 60.01)';
                fixedCount++;
                recordChange(
                  `Проводка оплаты «${op.counterpartyName}»: Дт 60.01 Кт ${e.credit}`,
                  `Дт 60.02 Кт ${e.credit} (выданный аванс поставщику)`,
                  'Устранение отрицательного сальдо по пассивному расчётному субсчёту 60.01',
                  'advance_offset',
                  'flip_red_settlement_subaccount',
                  op.id
                );
              }
            }
          }
        }
      }
      intermediateOsv = calculateCurrentOsv(chronoSyncedOps);
    }

    const redSubs6002 = (intermediateOsv.subcontoRowsByAccount?.['60.02'] ?? []).filter(
      (s) => s.endDebit < -0.01 || s.endCredit > 0.01
    );
    const row6002 = intermediateOsv.leafRows.find((r) => r.code === '60.02');
    if ((row6002 && row6002.hasRedEnd) || redSubs6002.length > 0) {
      for (const op of chronoSyncedOps) {
        for (const e of op.entries) {
          if (e.credit === '60.02' && e.debit !== '60.01') {
            const subMatchesRed =
              redSubs6002.length === 0 ||
              redSubs6002.some((rs) => {
                const rsKey = normalizeEntityKey(rs.subcontoLabel.split('/')[0] ?? '');
                const eKey = normalizeEntityKey(
                  (e.creditSubconto || op.counterpartyName || '').split('/')[0] ?? ''
                );
                return !rsKey || !eKey || rsKey === eKey;
              });
            if (subMatchesRed) {
              e.credit = '60.01';
              fixedCount++;
              recordChange(
                `Проводка Кт 60.02`,
                `Кт 60.01 (расчёты с поставщиками)`,
                'Устранение отрицательного сальдо по активному счёту авансов 60.02',
                'advance_offset',
                'flip_red_settlement_subaccount',
                op.id
              );
            }
          }
        }
      }
      intermediateOsv = calculateCurrentOsv(chronoSyncedOps);
    }

    const redSubs6201 = (intermediateOsv.subcontoRowsByAccount?.['62.01'] ?? []).filter(
      (s) => s.endDebit < -0.01 || s.endCredit > 0.01
    );
    const row6201 = intermediateOsv.leafRows.find((r) => r.code === '62.01');
    if ((row6201 && row6201.hasRedEnd) || redSubs6201.length > 0) {
      for (const op of chronoSyncedOps) {
        if (op.category === 'bank_in' || op.category === 'cash_in') {
          for (const e of op.entries) {
            if ((e.debit === '51' || e.debit === '50.01') && e.credit === '62.01') {
              const subMatchesRed =
                redSubs6201.length === 0 ||
                redSubs6201.some((rs) => {
                  const rsKey = normalizeEntityKey(rs.subcontoLabel.split('/')[0] ?? '');
                  const eKey = normalizeEntityKey(
                    (e.creditSubconto || op.counterpartyName || '').split('/')[0] ?? ''
                  );
                  return !rsKey || !eKey || rsKey === eKey;
                });
              if (subMatchesRed) {
                e.credit = '62.02';
                e.description = 'Получен аванс от покупателя (переклассифицировано с 62.01)';
                fixedCount++;
                recordChange(
                  `Проводка поступления от «${op.counterpartyName}»: Дт ${e.debit} Кт 62.01`,
                  `Дт ${e.debit} Кт 62.02 (полученный аванс от покупателя)`,
                  'Устранение отрицательного сальдо по активному субсчёту 62.01',
                  'advance_offset',
                  'flip_red_settlement_subaccount',
                  op.id
                );
              }
            }
          }
        }
      }
      intermediateOsv = calculateCurrentOsv(chronoSyncedOps);
    }

    const redSubs6202 = (intermediateOsv.subcontoRowsByAccount?.['62.02'] ?? []).filter(
      (s) => s.endCredit < -0.01 || s.endDebit > 0.01
    );
    const row6202 = intermediateOsv.leafRows.find((r) => r.code === '62.02');
    if ((row6202 && row6202.hasRedEnd) || redSubs6202.length > 0) {
      for (const op of chronoSyncedOps) {
        for (const e of op.entries) {
          if (e.debit === '62.02' && e.credit !== '62.01') {
            const subMatchesRed =
              redSubs6202.length === 0 ||
              redSubs6202.some((rs) => {
                const rsKey = normalizeEntityKey(rs.subcontoLabel.split('/')[0] ?? '');
                const eKey = normalizeEntityKey(
                  (e.debitSubconto || op.counterpartyName || '').split('/')[0] ?? ''
                );
                return !rsKey || !eKey || rsKey === eKey;
              });
            if (subMatchesRed) {
              e.debit = '62.01';
              fixedCount++;
              recordChange(
                `Проводка Дт 62.02`,
                `Дт 62.01 (расчёты с покупателями)`,
                'Устранение отрицательного сальдо по пассивному счёту авансов 62.02',
                'advance_offset',
                'flip_red_settlement_subaccount',
                op.id
              );
            }
          }
        }
      }
      intermediateOsv = calculateCurrentOsv(chronoSyncedOps);
    }

    // Note: Cash register 50.01 shortages are covered inline inside cash_out / accountable_advance
    // operations during recalculateOperationsChronologically (Дт 50.01 Кт 51) — never via fake op-cash-cover rows.

    // Pass Stage 5b: Generate advance offsets, advance VAT, and period closing operations
    const { newOperations, log: closeLog, structuredChanges: closeChanges } =
      generatePeriodClosingOperations({
        db1C,
        operations: chronoSyncedOps,
        osv: intermediateOsv,
        periodEndDate,
        calculationProfile,
        monthlyProfitTax,
      });

    if (newOperations.length > 0) {
      fixedCount += newOperations.length;
      log.push(...closeLog);
      structuredChanges.push(...closeChanges);
      for (const genOp of newOperations) {
        if (genOp.autoGeneratedKind === 'advance_offset') appliedRuleSet.add('offset_advances_60_62');
        if (genOp.autoGeneratedKind === 'advance_vat') appliedRuleSet.add('accrue_advance_vat_76av');
        if (genOp.autoGeneratedKind === 'closing_90_91') appliedRuleSet.add('close_period_accounts');
      }
    }

    workingOperations = attachVirtualStateStep00ToOperations(
      [...chronoSyncedOps, ...newOperations],
      db1C
    );

    // Fixed-point convergence check: verify remaining autofixable issues
    const passOsv = calculateCurrentOsv(workingOperations);
    const passIssues = runAuditDiagnostics({
      db1C,
      operations: workingOperations,
      osv: passOsv,
    });
    const remainingFixable = passIssues.filter((i) => i.canAutoFixBy1C);
    if (remainingFixable.length === 0) {
      break;
    }
  }

  const finalOsv = calculateCurrentOsv(workingOperations);
  const finalIssues = runAuditDiagnostics({
    db1C,
    operations: workingOperations,
    osv: finalOsv,
  });
  const criticalAfterCount = finalIssues.filter((i) => i.severity === 'error').length;

  const executionSummary: AutofixExecutionSummary = {
    passesExecuted,
    issuesBefore: issuesBeforeCount,
    issuesAfter: finalIssues.length,
    autofixableBefore: autofixableBeforeCount,
    remainingAutofixableCount: finalIssues.filter((i) => i.canAutoFixBy1C).length,
    criticalBefore: criticalBeforeCount,
    criticalAfter: criticalAfterCount,
    isOsvBalanced:
      finalOsv.totals.isStartBalanced &&
      finalOsv.totals.isTurnoverBalanced &&
      finalOsv.totals.isEndBalanced,
    appliedRules: Array.from(appliedRuleSet),
  };

  return {
    operations: workingOperations,
    fixedCount,
    log,
    structuredChanges,
    executionSummary,
  };
}

/**
 * Applies targeted 1-click auto-fix to a single operation in the context of all chronological operations.
 */
export function autoFixSingleOperation(params: {
  operationId: string;
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  calculateCurrentOsv: (ops: QueuedOperation[], dateToOverride?: string) => OsvReport;
  periodEndDate: string;
  reportingYear?: number;
  defaultBik?: string;
  calculationProfile?: CalculationProfile1C;
  monthlyProfitTax?: boolean;
}): {
  operations: QueuedOperation[];
  fixedCount: number;
  structuredChanges: AutoFixChangeRecord[];
  summary: string;
} {
  const full = autoFixAllBy1CDb({
    db1C: params.db1C,
    operations: params.operations,
    calculateCurrentOsv: params.calculateCurrentOsv,
    periodEndDate: params.periodEndDate,
    reportingYear: params.reportingYear,
    defaultBik: params.defaultBik,
    calculationProfile: params.calculationProfile,
    monthlyProfitTax: params.monthlyProfitTax,
  });

  const fixedTarget = full.operations.find((o) => o.id === params.operationId);
  if (!fixedTarget) {
    return {
      operations: params.operations,
      fixedCount: 0,
      structuredChanges: [],
      summary: 'Операция не найдена в очереди.',
    };
  }

  const replacedList = params.operations
    .filter((o) => !o.id.startsWith('op-cash-cover'))
    .map((o) => (o.id === params.operationId ? fixedTarget : o));
  const recalcOps = recalculateOperationsChronologically(replacedList, params.db1C, {
    reportingYear: params.reportingYear,
    defaultBik: params.defaultBik,
    calculationProfile: params.calculationProfile,
    monthlyProfitTax: params.monthlyProfitTax,
  });
  const opChanges = full.structuredChanges.filter((c) => c.operationId === params.operationId);
  const effectiveChanges =
    opChanges.length > 0 ? opChanges : full.structuredChanges.slice(0, 1);
  const summary =
    effectiveChanges.length > 0
      ? `Исправлено (${effectiveChanges.length}): ${effectiveChanges[0].whatBecame}`
      : `Проверено: 1С ${fixedTarget.docType1C} (${fixedTarget.readinessNote || 'проводки синхронизированы'})`;

  return {
    operations: recalcOps,
    fixedCount: Math.max(1, effectiveChanges.length),
    structuredChanges: effectiveChanges,
    summary,
  };
}

/**
 * Executes deterministic 1-click fix for any individual `AuditIssue` card in Tab 3
 * (delegates per-operation issues to `autoFixSingleOperation` and OSV/period issues to `autoFixAllBy1CDb`).
 */
export function autoFixAuditIssue(params: {
  issue: AuditIssue;
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  calculateCurrentOsv: (ops: QueuedOperation[], dateToOverride?: string) => OsvReport;
  periodEndDate: string;
  reportingYear?: number;
  defaultBik?: string;
  calculationProfile?: CalculationProfile1C;
  monthlyProfitTax?: boolean;
}): {
  operations: QueuedOperation[];
  fixedCount: number;
  structuredChanges: AutoFixChangeRecord[];
  executionSummary?: AutofixExecutionSummary;
  summary: string;
} {
  if (params.issue.operationId) {
    const single = autoFixSingleOperation({
      operationId: params.issue.operationId,
      db1C: params.db1C,
      operations: params.operations,
      calculateCurrentOsv: params.calculateCurrentOsv,
      periodEndDate: params.periodEndDate,
      reportingYear: params.reportingYear,
      defaultBik: params.defaultBik,
      calculationProfile: params.calculationProfile,
      monthlyProfitTax: params.monthlyProfitTax,
    });
    return single;
  }

  const all = autoFixAllBy1CDb({
    db1C: params.db1C,
    operations: params.operations,
    calculateCurrentOsv: params.calculateCurrentOsv,
    periodEndDate: params.periodEndDate,
    reportingYear: params.reportingYear,
    defaultBik: params.defaultBik,
    calculationProfile: params.calculationProfile,
    monthlyProfitTax: params.monthlyProfitTax,
  });
  return {
    operations: all.operations,
    fixedCount: all.fixedCount,
    structuredChanges: all.structuredChanges,
    executionSummary: all.executionSummary,
    summary: `Исправлено замечаний: ${all.fixedCount} · Осталось автоисправляемых: ${all.executionSummary.remainingAutofixableCount}`,
  };
}
