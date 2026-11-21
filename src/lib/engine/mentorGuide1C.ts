import {
  Database1CSnapshot,
  DocType1CBP30,
  OperationCardProfile,
  OperationCategory,
  OperationMentorGuide1C,
  QueuedOperation,
  Step01CalculationBreakdown1C,
  Step02AccountingLogic1C,
} from '@/types/accounting';
import {
  DOC_TYPE_LABELS_1C,
  DOC_TYPE_TO_DEFAULT_CATEGORY_1C,
  doesSpecRequireCommercialCounterparty,
  getDocumentSpecForOperation,
  resolveCardProfileFromSpec,
} from './documentSpecs1C';
import { sanitizeMentorGuide1C } from './textHygiene1C';

export { DOC_TYPE_LABELS_1C };

const WAREHOUSE_PRODUCTION_CATEGORIES = new Set<OperationCategory>([
  'materials_writeoff',
  'workwear_issue',
  'production_output',
  'warehouse_transfer',
  'inventory_result',
]);

const WAREHOUSE_PRODUCTION_DOC_TYPES = new Set<DocType1CBP30>([
  'РасходМатериалов',
  'ПередачаМатериаловВЭксплуатацию',
  'ВыпускПродукции',
  'ПеремещениеТоваров',
  'ИнвентаризацияТоваров',
]);

export function doesOperationRequireCounterparty(category: OperationCategory): boolean {
  return doesSpecRequireCommercialCounterparty(category);
}

/**
 * Strictly warehouse / production internal operations (NEVER includes payroll, HR, OS, or closing!).
 */
export function isInternalWarehouseOrProductionOp(
  op: Pick<QueuedOperation, 'category' | 'docType1C'>
): boolean {
  if (WAREHOUSE_PRODUCTION_CATEGORIES.has(op.category)) return true;
  return WAREHOUSE_PRODUCTION_DOC_TYPES.has(op.docType1C);
}

/**
 * Maps every operation to one of the 5 strict contextual UI card profiles:
 * 1. 'trade_services' — Поступление / Реализация / Оплата контрагентам / Зачёт авансов
 * 2. 'warehouse_production' — РасходМатериалов / ПередачаМатериаловВЭксплуатацию / ВыпускПродукции / ПеремещениеТоваров
 * 3. 'hr_payroll' — ПриемНаРаботу / НачислениеЗарплаты / ВедомостьВБанк / ВедомостьВКассу / Выплата ЗП
 * 4. 'os_regulatory' — ПринятиеКУчетуОС / Начисление амортизации / ЗакрытиеМесяца
 * 5. 'taxes_bank_founders' — Уплата налогов и взносов / Комиссия банка РКО / Вклад учредителя 75.01 / Касса<->Банк
 */
export function getOperationCardProfile(
  op: Pick<QueuedOperation, 'category' | 'docType1C'> & {
    entries?: QueuedOperation['entries'];
  }
): OperationCardProfile {
  return resolveCardProfileFromSpec(op);
}

export function getOperationStatusBadgeText(
  op: Pick<
    QueuedOperation,
    'category' | 'docType1C' | 'readinessStatus' | 'needsAmount' | 'amountMode' | 'amount'
  >
): string {
  const profile = getOperationCardProfile(op);
  if (op.readinessStatus === 'critical_error' || op.needsAmount) {
    return 'Требует проверки';
  }
  if (op.category === 'contract_event') {
    return 'Договор / счёт 1С (без проводок)';
  }
  if (op.category === 'policy_event') {
    return 'Учётная политика / лимит 1С';
  }
  if (op.category === 'manual' && op.readinessStatus === 'needs_clarification') {
    return 'Уточните счёт Дт/Кт';
  }
  if (op.category === 'writ_of_execution' || op.docType1C === 'ИсполнительныйЛист') {
    return 'Исполнительный лист 1С';
  }
  if (op.category === 'alimony_payout') {
    return 'Уплата алиментов 76.41';
  }
  if (
    op.category === 'financial_investment' ||
    op.category === 'financial_interest_accrual' ||
    op.category === 'financial_disposal' ||
    op.docType1C === 'ФинансовыеВложения'
  ) {
    if (op.category === 'financial_interest_accrual') return 'Проценты по ЦБ 76.09 / 91.01';
    if (op.category === 'financial_disposal') return 'Выбытие ЦБ / векселя 58.02';
    return 'Учёт ценных бумаг 58.02';
  }
  if (op.category === 'loan_issued') {
    return 'Выданный заём 58.03';
  }
  if (op.category === 'loan_interest_accrual') {
    return 'Проценты по займу 66/67';
  }
  if (op.category === 'os_disposal') {
    return 'Выбытие ОС 01.09';
  }
  if (op.category === 'vat_deduction') {
    return 'Вычет НДС 68.02 / 19';
  }
  if (profile === 'accountable_71') {
    if (op.category === 'expense_report') return 'Авансовый отчёт 71.01';
    if (op.category === 'accountable_return') return 'Возврат подотчёта 71.01';
    return 'Выдача подотчёт 71.01';
  }
  if (op.category === 'hr_hire' || op.docType1C === 'ПриемНаРаботу') {
    return 'Кадровый приказ 1С';
  }
  if (profile === 'hr_payroll') {
    if (op.readinessStatus === 'needs_clarification') {
      return 'Уточните штатный ФОТ';
    }
    return op.category === 'payroll_payout'
      ? 'Выплата по ведомости 1С'
      : 'Расчёт ЗП и взносов 1С';
  }
  if (profile === 'os_regulatory') {
    return op.category === 'os_commissioning' || op.docType1C === 'ПринятиеКУчетуОС'
      ? 'Ввод ОС в эксплуатацию'
      : 'Регламентная операция 1С';
  }
  if (profile === 'warehouse_production') {
    return op.amount >= 0.01 ? 'Списано по партиям 1С' : 'Авто по себестоимости 1С';
  }
  if (op.category === 'charter_capital') return 'Уставный капитал 75.01 / 80.09';
  if (op.category === 'dividends_accrual') return 'Дивиденды 84.01 / 75.02';
  if (op.category === 'dividends_payout') return 'Выплата дивидендов 75.02';
  if (op.category === 'intangible_acquisition') return 'Поступление НМА 08.05';
  if (op.category === 'intangible_commissioning') return 'Принятие к учёту НМА 04.01';
  if (op.category === 'intangible_amortization') return 'Амортизация НМА 05';
  if (op.category === 'inventory_result') return 'Инвентаризация ТМЦ 94';
  if (op.category === 'acquiring_receipt') return 'Эквайринг 51 / 57.03';
  if (op.category === 'special_bank_55') return 'Спецсчёт в банке 55';
  if (op.category === 'employee_settlement_73') return 'Расчёты с персоналом 73';
  if (op.category === 'deferred_expense_97') return 'РБП 97.21';
  if (op.category === 'reserve_doubtful_63') return 'Резерв сомнит. долгов 63';
  if (op.category === 'off_balance_op') return 'Забалансовый учёт 001–009';
  if (op.readinessStatus === 'needs_clarification') {
    return 'Нужно уточнение';
  }
  return 'Готово к экспорту';
}

export function mapDocTypeToDefaultCategory(
  docType1C: DocType1CBP30,
  prevCategory: OperationCategory
): OperationCategory {
  switch (docType1C) {
    case 'РасходМатериалов':
      return 'materials_writeoff';
    case 'ПередачаМатериаловВЭксплуатацию':
      return 'workwear_issue';
    case 'ПринятиеКУчетуОС':
      return 'os_commissioning';
    case 'ПринятиеКУчетуНМА':
      return 'intangible_commissioning';
    case 'ПередачаОС':
    case 'СписаниеОС':
      return 'os_disposal';
    case 'ИнвентаризацияТоваров':
      return 'inventory_result';
    case 'ОперацияПоПлатежнойКарте':
      return 'acquiring_receipt';
    case 'ВыпускПродукции':
      return 'production_output';
    case 'ПеремещениеТоваров':
      return 'warehouse_transfer';
    case 'ПриемНаРаботу':
      return 'hr_hire';
    case 'ИсполнительныйЛист':
      return 'writ_of_execution';
    case 'ФинансовыеВложения':
      return 'financial_investment';
    case 'НачислениеЗарплаты':
      return prevCategory === 'insurance_accrual' ? 'insurance_accrual' : 'payroll_accrual';
    case 'ВедомостьВБанк':
    case 'ВедомостьВКассу':
      return 'payroll_payout';
    case 'ЗакрытиеМесяца':
      return prevCategory === 'depreciation_accrual' || prevCategory === 'intangible_amortization'
        ? prevCategory
        : 'closing';
    case 'КорректировкаДолга':
      return 'advance_offset';
    case 'РеализацияТоваровУслуг':
      return prevCategory === 'sale_services' ? 'sale_services' : 'sale_goods';
    case 'ПоступлениеТоваровУслуг':
      if (
        prevCategory === 'purchase_materials' ||
        prevCategory === 'purchase_services' ||
        prevCategory === 'purchase_equipment' ||
        prevCategory === 'intangible_acquisition' ||
        prevCategory === 'deferred_expense_97'
      ) {
        return prevCategory;
      }
      return 'purchase_goods';
    case 'СписаниеСРасчетногоСчета':
      return [
        'tax_payment',
        'bank_fee',
        'payroll_payout',
        'accountable_issue',
        'loan_repaid',
        'loan_issued',
        'alimony_payout',
        'dividends_payout',
        'special_bank_55',
        'employee_settlement_73',
      ].includes(prevCategory)
        ? prevCategory
        : 'bank_out';
    case 'ПоступлениеНаРасчетныйСчет':
      if (['founder_contribution', 'loan_received', 'acquiring_receipt', 'special_bank_55'].includes(prevCategory)) {
        return prevCategory;
      }
      return 'bank_in';
    case 'ПоступлениеНаличных':
      if (['cash_bank_internal', 'accountable_return', 'founder_contribution', 'employee_settlement_73'].includes(prevCategory)) {
        return prevCategory;
      }
      return 'cash_in';
    case 'ВыдачаНаличных':
      if (['cash_bank_internal', 'accountable_issue', 'payroll_payout', 'dividends_payout', 'employee_settlement_73'].includes(prevCategory)) {
        return prevCategory;
      }
      return 'cash_out';
    case 'АвансовыйОтчет':
      return 'expense_report';
    case 'СчетФактураПолученный':
      return 'vat_deduction';
    case 'ОперацияБух':
      return [
        'penalty_claim',
        'financial_investment',
        'financial_interest_accrual',
        'financial_disposal',
        'loan_interest_accrual',
        'os_disposal',
        'contract_event',
        'policy_event',
        'charter_capital',
        'dividends_accrual',
        'employee_settlement_73',
        'reserve_doubtful_63',
        'off_balance_op',
      ].includes(prevCategory)
        ? prevCategory
        : 'manual';
    default:
      return DOC_TYPE_TO_DEFAULT_CATEGORY_1C[docType1C] ?? prevCategory;
  }
}

function formatRuDate(iso: string): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || 'дата операции';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatMoneyRu(n: number): string {
  return `${n.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function buildStep01Fallback(op: QueuedOperation): Step01CalculationBreakdown1C {
  if (op.resolverTrace) {
    return op.resolverTrace;
  }
  const nonPostingCategories: OperationCategory[] = [
    'contract_event',
    'policy_event',
    'hr_hire',
    'writ_of_execution',
  ];
  if (nonPostingCategories.includes(op.category)) {
    return {
      resolverLevel: 6,
      resolverLevelName: 'Уровень 6 — Регистр сведений 1С:БП 3.0 (управленческое / кадровое событие без проводок)',
      summaryFormula: op.calculationProvenance || '0,00 ₽ по регистру бухгалтерии (запись параметров в регистр сведений 1С)',
      steps: [
        op.calculationProvenance ||
          `Операция «${op.description}» регистрирует нормативные условия в базе 1С без изменения сальдо счетов в этот день.`,
      ],
      sourceLinks: [],
    };
  }

  const lines: string[] = [];
  if (op.calculationProvenance) {
    lines.push(op.calculationProvenance);
  } else if (op.amount >= 0.01) {
    lines.push(`Итоговая сумма документа: ${formatMoneyRu(op.amount)}.`);
  }
  if (op.vatAmount > 0) {
    const net = Math.max(0, op.amount - op.vatAmount);
    lines.push(
      `Расчёт НДС (${op.vatRate}%): база без НДС = ${formatMoneyRu(net)}, сумма НДС = ${formatMoneyRu(op.vatAmount)}, всего с НДС = ${formatMoneyRu(op.amount)}.`
    );
  }
  if (op.entries.length > 0) {
    for (const e of op.entries) {
      if (e.amount >= 0.01) {
        lines.push(`Дт ${e.debit || '—'} Кт ${e.credit || '—'}: ${formatMoneyRu(e.amount)} (${e.description}).`);
      }
    }
  }

  return {
    resolverLevel: op.needsAmount ? 8 : op.amountMode === 'explicit' ? 1 : 6,
    resolverLevelName: op.needsAmount
      ? 'Уровень 8 — Требуется уточнение внешней суммы (проверены все 7 источников контура)'
      : op.amountMode === 'explicit'
        ? 'Уровень 1 — Явная сумма из колонки / условия задания'
        : 'Уровень 6 — Автоматический расчёт по живой модели 1С:БП 3.0',
    summaryFormula:
      op.calculationProvenance ||
      (op.amount >= 0.01
        ? `Сумма операции = ${formatMoneyRu(op.amount)}${op.vatAmount > 0 ? ` (в т.ч. НДС ${formatMoneyRu(op.vatAmount)})` : ' (Без НДС)'}`
        : 'Рассчитывается 1С при проведении документа'),
    steps: lines.length > 0 ? lines : ['Сумма рассчитана по правилам бухгалтерского учёта 1С:БП 3.0.'],
    sourceLinks: [],
  };
}

function buildStep02Logic(
  op: QueuedOperation,
  guide: Pick<OperationMentorGuide1C, 'accountingMeaning' | 'whyAmountOrVatRule'>
): Step02AccountingLogic1C {
  const norms: string[] = [];
  switch (op.category) {
    case 'contract_event':
    case 'policy_event':
      norms.push(
        'ПБУ 1/2008 «Учётная политика организации»',
        'Ст. 9 Федерального закона № 402-ФЗ (факт хозяйственной жизни vs заключение рамочного договора / выставление счёта)'
      );
      break;
    case 'hr_hire':
      norms.push('Ст. 68 ТК РФ (оформление приёма на работу)', 'План счетов 1С:БП 3.0 (регистры плановых начислений)');
      break;
    case 'writ_of_execution':
    case 'alimony_payout':
      norms.push(
        'Ст. 99 Федерального закона № 229-ФЗ «Об исполнительном производстве» (расчёт удержаний после вычета НДФЛ)',
        'Ст. 109 СК РФ (обязанность работодателя удерживать алименты — счёт 76.41)'
      );
      break;
    case 'payroll_accrual':
    case 'insurance_accrual':
    case 'payroll_payout':
      norms.push(
        'Гл. 23 НК РФ (ст. 224, 226 НК РФ — удержание НДФЛ 13% налоговым агентом)',
        'Гл. 34 НК РФ (ст. 425 НК РФ — единый тариф страховых взносов 30%) + ФЗ № 125-ФЗ (взносы от НС и ПЗ)'
      );
      break;
    case 'materials_writeoff':
    case 'workwear_issue':
    case 'purchase_materials':
    case 'purchase_goods':
    case 'production_output':
    case 'warehouse_transfer':
      norms.push(
        'ФСБУ 5/2019 «Запасы» (оценка при признании без возмещаемых налогов и списание по средней / ФИФО)',
        ...(op.vatAmount > 0 ? ['Ст. 171, 172 НК РФ (вычет входного НДС по счёту-фактуре / УПД)'] : [])
      );
      break;
    case 'purchase_equipment':
    case 'os_commissioning':
    case 'depreciation_accrual':
    case 'os_disposal':
      norms.push(
        'ФСБУ 26/2020 «Капитальные вложения» (формирование первоначальной стоимости на счёте 08.04.1)',
        'ФСБУ 6/2020 «Основные средства» (принятие к учёту на счёт 01.01, линейная амортизация на 02.01, списание через 01.09)',
        'Ст. 256–259.1 НК РФ (амортизируемое имущество в налоговом учёте)'
      );
      break;
    case 'financial_investment':
    case 'financial_interest_accrual':
    case 'financial_disposal':
    case 'loan_issued':
      norms.push(
        'ПБУ 19/02 «Учёт финансовых вложений» (счета 58.02 «Долговые ценные бумаги», 58.03 «Предоставленные займы»)',
        'ПБУ 9/99 и ПБУ 10/99 (признание процентного дохода и выбытия ценных бумаг через счёт 91)',
        'Пп. 12, 15 п. 2 ст. 149 НК РФ (операции с ценными бумагами и займами не облагаются НДС)'
      );
      break;
    case 'loan_received':
    case 'loan_repaid':
    case 'loan_interest_accrual':
      norms.push(
        'ПБУ 15/2008 «Учёт расходов по займам и кредитам» (основной долг 66.03/67.03, проценты отдельно на 66.04/67.04 в корреспонденции с 91.02)',
        'Ст. 269 НК РФ (признание процентов по долговым обязательствам во внереализационных расходах)'
      );
      break;
    case 'sale_goods':
    case 'sale_services':
      norms.push(
        'ПБУ 9/99 «Доходы организации» (признание выручки на счёте 90.01.1)',
        'ПБУ 10/99 «Расходы организации» (списание себестоимости продаж в дебет 90.02.1)',
        'Ст. 146, 164, 168 НК РФ (начисление НДС при реализации — Дт 90.03 Кт 68.02)'
      );
      break;
    case 'vat_deduction':
      norms.push('Ст. 171, 172 НК РФ (принятие входного НДС к вычету со счёта 19 в дебет 68.02)');
      break;
    case 'charter_capital':
    case 'founder_contribution':
      norms.push(
        'Ст. 14–16 ФЗ «Об ООО» / ст. 25–34 ФЗ «Об АО» (формирование уставного капитала — Дт 75.01 Кт 80.09)',
        'Пп. 4 п. 3 ст. 39, пп. 1 п. 2 ст. 146 НК РФ (вклады в уставный капитал не признаются реализацией и не облагаются НДС)'
      );
      break;
    case 'dividends_accrual':
    case 'dividends_payout':
      norms.push(
        'Ст. 28 ФЗ «Об ООО» / ст. 42 ФЗ «Об АО» (распределение чистой прибыли прошлых лет со счёта 84.01 в кредит 75.02 / 70)',
        'Ст. 214, 224, 275 НК РФ (удержание НДФЛ / налога на прибыль налоговым агентом при выплате дивидендов)'
      );
      break;
    case 'intangible_acquisition':
    case 'intangible_commissioning':
    case 'intangible_amortization':
      norms.push(
        'ФСБУ 26/2020 и ФСБУ 14/2022 «Нематериальные активы» (вложения на счёте 08.05, принятие на 04.01, амортизация на счёте 05)',
        'Пп. 26 п. 2 ст. 149 НК РФ (особенности освобождения от НДС прав на программы для ЭВМ и базы данных из реестра РФ)'
      );
      break;
    case 'inventory_result':
      norms.push(
        'ФСБУ 28/2023 «Инвентаризация» и ФСБУ 5/2019 (отражение недостач в Дт 94, списание на виновных лиц Дт 73.02 или в прочие расходы Дт 91.02; излишки Дт 10/41 Кт 91.01)'
      );
      break;
    case 'acquiring_receipt':
    case 'special_bank_55':
      norms.push(
        'Инструкция к Плану счетов № 94н (счёт 57.03 «Продажи по платёжным картам», счёт 55 «Специальные счета в банках»)',
        'ПБУ 10/99 (комиссия банка-эквайера отражается в прочих расходах Дт 91.02 Кт 57.03 без НДС по пп. 3–4 п. 3 ст. 149 НК РФ)'
      );
      break;
    case 'employee_settlement_73':
      norms.push(
        'Счёт 73 Плана счетов РФ (73.01 — займы работникам, 73.02 — возмещение материального ущерба по ст. 238–248 ТК РФ)'
      );
      break;
    case 'deferred_expense_97':
      norms.push(
        'П. 65 Положения № 34н и ФСБУ 14/2022 (равномерное признание краткосрочных неисключительных прав / страховок через счёт 97.21)'
      );
      break;
    case 'reserve_doubtful_63':
      norms.push(
        'П. 70 Положения по ведению БУ № 34н (обязательное создание резерва по сомнительным долгам в бухгалтерском учёте — Дт 91.02 Кт 63)',
        'Ст. 266 НК РФ (порядок формирования резерва в налоговом учёте)'
      );
      break;
    case 'off_balance_op':
      norms.push(
        'Раздел «Забалансовые счета» Плана счетов РФ № 94н (односторонняя запись Дт или Кт по счетам 001–009 и МЦ без двойной записи по балансу)'
      );
      break;
    case 'closing':
      norms.push(
        'ПБУ 9/99, ПБУ 10/99, ПБУ 18/02 (закрытие счетов 20, 25, 26, 44 и определение финансового результата на счёте 99.01.1; 31 декабря — реформация баланса на счёт 84)',
        'Ст. 284 НК РФ (ставка налога на прибыль организаций — 20%)'
      );
      break;
    default:
      norms.push(
        'План счетов бухгалтерского учёта (Приказ Минфина РФ № 94н)',
        op.vatAmount > 0 ? 'Гл. 21 НК РФ (учёт НДС на ОСНО)' : 'Ст. 149 / 146 НК РФ (операция без НДС)'
      );
      break;
  }

  const subcontoArchitecture =
    op.entries.length > 0
      ? op.entries
          .map(
            (e) =>
              `Дт ${e.debit || '—'} (${e.debitSubconto || 'без аналитики'})${
                e.isOffBalance ? '' : ` → Кт ${e.credit || '—'} (${e.creditSubconto || 'без аналитики'})`
              }`
          )
          .join(' · ')
      : 'Аналитика сохраняется в регистрах сведений 1С:БП 3.0 (Контрагенты / Договоры / Кадровый учёт / Учётная политика) и подставляется в проводки последующих документов.';

  return {
    plainExplanation: `${guide.accountingMeaning} ${guide.whyAmountOrVatRule}`.trim(),
    regulatoryNorms: norms,
    subcontoArchitecture,
  };
}

function enrichMentorGuideForDefense(
  guide: OperationMentorGuide1C,
  op: QueuedOperation
): OperationMentorGuide1C {
  const spec = getDocumentSpecForOperation(op);
  return sanitizeMentorGuide1C({
    ...guide,
    // Invariant 1: 100% single-source-of-truth navigationPath1C from DOCUMENT_SPECS!
    navigationPath1C: spec.menuPath1C,
    documentOperationKind1C: op.documentSubKind1C || guide.documentOperationKind1C || spec.documentKind1C,
    step01CalculationBreakdown: guide.step01CalculationBreakdown ?? buildStep01Fallback(op),
    step02AccountingLogic: guide.step02AccountingLogic ?? buildStep02Logic(op, guide),
  });
}

export function buildOperationMentorGuide1C(
  op: QueuedOperation,
  db1C: Database1CSnapshot | null
): OperationMentorGuide1C {
  const rawGuide = buildOperationMentorGuideCore(op, db1C);
  return enrichMentorGuideForDefense(rawGuide, op);
}

function buildOperationMentorGuideCore(
  op: QueuedOperation,
  db1C: Database1CSnapshot | null
): OperationMentorGuide1C {
  const orgName = db1C?.organization.name || 'Ваша организация';
  const dateRu = formatRuDate(op.date);
  const wh = op.warehouseName || 'Основной склад';
  const nom = op.nomenclatureName || 'Номенклатура из условия';
  const nomGroup = op.nomenclatureGroupName || 'Основная номенклатурная группа';
  const costAcc = op.costAccount || '20.01';
  const matAcc = op.materialAccount || '10.01';
  const emp = op.employeeName || 'Сотрудник (МОЛ)';
  const qtyStr = op.quantity && op.quantity > 0 ? `${op.quantity} ед.` : 'по нормативу / условию задачи';
  const cp = op.counterpartyName || 'Контрагент из первичного документа';
  const ctr = op.contractName || 'Основной договор';

  const buildRefPostingsFromEntries = (defaultRuleFallback: string) => {
    if (op.entries.length > 0) {
      return op.entries.map((e) => ({
        debit: e.debit ? `${e.debit}${e.debitSubconto ? ` (${e.debitSubconto})` : ''}` : '—',
        credit: e.credit ? `${e.credit}${e.creditSubconto ? ` (${e.creditSubconto})` : ''}` : '— (забалансовый)',
        amountRule:
          e.amount >= 0.01
            ? formatMoneyRu(e.amount)
            : e.amountRuleNote || defaultRuleFallback,
        purpose: e.description,
        isOffBalance: e.isOffBalance,
      }));
    }
    return [];
  };

  // 1. Списание / передача материалов в производство или на строительный объект
  if (op.category === 'materials_writeoff' || op.docType1C === 'РасходМатериалов') {
    const expItem = op.expenseItemName || 'Материальные расходы';
    const sumExplanation =
      op.amount >= 0.01
        ? `${formatMoneyRu(op.amount)} (${op.stockSourceNote || 'рассчитано по себестоимости партии без НДС'})`
        : `Вводится БЕЗ суммы — 1С рассчитает себестоимость автоматически при проведении со счёта ${matAcc}`;

    return {
      accountingMeaning: `Внутренняя складская и производственная операция (ФСБУ 5/2019): материалы («${nom}») передаются со склада в основное производство / на строительный объект («${nomGroup}»). Материалы перестают числиться на складе (Кредит ${matAcc}) и формируют прямую себестоимость выпускаемой продукции или работ (Дебет ${costAcc}).`,
      whyAmountOrVatRule: `НДС, контрагент, договор и счёт-фактура здесь НЕ указываются: расчётов с поставщиком нет, входной НДС уже был учтён ранее при покупке материалов. В документе «Расход материалов» колонки «Цена» и «Сумма» вообще нет — студент указывает только количество, а 1С списывает себестоимость со счёта ${matAcc} автоматически (по средней себестоимости или ФИФО согласно учётной политике).`,
      navigationPath1C:
        'Раздел «Склад» → «Расход материалов (Требования-накладные)» → кнопка «Создать» (или Раздел «Производство» → «Расход материалов»)',
      documentOperationKind1C: 'Расход материалов — Вид операции: «Использование материалов»',
      headerFieldsSteps: [
        { field: 'Вид операции', value: 'Использование материалов', hint: 'Для списания на выпуск продукции, выполнение СМР или собственные нужды' },
        { field: 'От (Дата)', value: dateRu, hint: 'Время документа должно быть позже времени приходной накладной по этому материалу' },
        { field: 'Организация', value: orgName },
        { field: 'Склад', value: wh, hint: `Тот же склад, на который ранее приходовался материал на счёт ${matAcc}` },
        {
          field: 'Счёт затрат',
          value: `Установить переключатель «В шапке» (или на вкладке «Счёт затрат»): ${costAcc}`,
          hint: `${costAcc} — Основное производство, Номенклатурная группа: «${nomGroup}», Статья затрат: «${expItem}»`,
        },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Вкладка «Материалы»',
          instruction: `Нажмите «Добавить» (или «Подбор») → выберите номенклатуру «${nom}», укажите Количество (${qtyStr}) и проверьте колонку «Счёт учёта» = ${matAcc} (${matAcc === '10.08' ? 'Строительные материалы' : matAcc === '10.03' ? 'Топливо' : 'Сырьё и материалы'}). Сумму вручную вводить не нужно.`,
        },
        {
          tabName: 'Вкладка «Счёт затрат»',
          instruction: `Выберите Счёт затрат = ${costAcc}, Подразделение затрат = Основное подразделение, Номенклатурная группа = «${nomGroup}», Статья затрат = «${expItem}» (вид расхода НУ: Материальные расходы).`,
        },
      ],
      referencePostings:
        buildRefPostingsFromEntries(`Автоматически по себестоимости остатка счёта ${matAcc} (${sumExplanation})`),
      selfCheckOsv: [
        `Нажмите кнопку «Дт/Кт» в проведённом документе: должна сформироваться проводка Дт ${costAcc} Кт ${matAcc} с количеством и списанной себестоимостью (без НДС).`,
        `Откройте «Отчёты → Оборотно-сальдовая ведомость по счёту ${matAcc}» (с галочками «Количество» и «По складам»): убедитесь, что по материалу «${nom}» нет красного отрицательного остатка.`,
        `Откройте «ОСВ по счёту ${costAcc}»: сумма должна отразиться по номенклатурной группе «${nomGroup}».`,
      ],
      commonStudentMistakes: [
        'Ошибочное создание документа «Поступление товаров» или «Реализация» вместо «Расход материалов (Требование-накладная)».',
        `Несовпадение субсчёта материалов: например, кирпич оприходовали на 10.01, а в Требовании-накладной указали 10.08 (или другой Склад) — тогда 1С выдаст ошибку «Не списано по партиям» или спишет только количество с нулевой суммой!`,
        `Не заполнена «Номенклатурная группа» («${nomGroup}») на счёте 20.01 — в конце месяца регламентное «Закрытие месяца» не сможет закрыть счёт 20.01.`,
      ],
    };
  }

  // 2. Выдача спецодежды / спецоснастки / хозинвентаря сотруднику в эксплуатацию
  if (op.category === 'workwear_issue' || op.docType1C === 'ПередачаМатериаловВЭксплуатацию') {
    const offAcc = op.offBalanceAccount || (/инвентар|хозпринадлежност|инструмент/i.test(nom) ? 'МЦ.04' : 'МЦ.02');
    const tabTitle = offAcc === 'МЦ.04' ? 'Инвентарь и хозяйственные принадлежности' : 'Спецодежда';
    const expItem = op.expenseItemName || 'Материальные расходы';

    return {
      accountingMeaning: `Внутренняя передача спецодежды / инвентаря («${nom}») со склада в эксплуатацию конкретному сотруднику — материально ответственному лицу («${emp}»). По ФСБУ 5/2019 (для спецодежды со сроком носки до 12 мес. или малоценной по учётной политике) стоимость единовременно списывается в расходы производства (Дт ${costAcc} Кт ${matAcc}), но сама вещь остаётся в пользовании работника, поэтому 1С одновременно ставит её на количественный забалансовый контроль по счёту ${offAcc}!`,
      whyAmountOrVatRule: `НДС и внешний контрагент отсутствуют: это выдача имущества собственному работнику («${emp}»). Сумму вручную указывать не нужно — 1С автоматически спишет учётную себестоимость со счёта ${matAcc} и зафиксирует числящееся количество за сотрудником на забалансовом счёте ${offAcc}.`,
      navigationPath1C:
        'Раздел «Склад» → «Спецодежда и инвентарь» → «Передача материалов в эксплуатацию» → кнопка «Создать» (в новых релизах 3.0 также доступно через «Склад → Расход материалов → Вид операции: Передача сотруднику»)',
      documentOperationKind1C: `Передача материалов в эксплуатацию (вкладка «${tabTitle}»)`,
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu, hint: 'Не ранее даты поступления спецодежды/инвентаря на склад' },
        { field: 'Организация', value: orgName },
        { field: 'Склад', value: wh, hint: `Склад, где числится «${nom}» на счёте ${matAcc}` },
        { field: 'Местонахождение (Подразделение)', value: 'Основное подразделение (Производство / Стройучасток)' },
      ],
      tabularAndTabsSteps: [
        {
          tabName: `Вкладка «${tabTitle}»`,
          instruction: `Нажмите «Добавить» → Номенклатура: «${nom}», Количество: ${op.quantity || 1}, Физическое лицо (Сотрудник): «${emp}».`,
        },
        {
          tabName: 'Реквизит «Назначение использования» (в строке таблицы)',
          instruction:
            offAcc === 'МЦ.04'
              ? `Счёт затрат: ${costAcc}, Статья затрат: «${expItem}», Счёт учёта на складе: ${matAcc} (10.09).`
              : `Создайте/выберите элемент справочника «Назначения использования»: Способ погашения стоимости = «Погашать стоимость при передаче в эксплуатацию» (ФСБУ 5/2019), Способ отражения расходов = Дт ${costAcc} («${nomGroup}», «${expItem}»), Счёт учёта = ${matAcc} (10.10).`,
        },
      ],
      referencePostings:
        buildRefPostingsFromEntries(`Автоматически по себестоимости склада (${matAcc})`),
      selfCheckOsv: [
        `Откройте движения документа по кнопке «Дт/Кт»: проверьте наличие ДВУХ записей — балансовой проводки списания стоимости Дт ${costAcc} Кт ${matAcc} и односторонней забалансовой проводки Дт ${offAcc} по сотруднику «${emp}».`,
        `Сформируйте «ОСВ по счёту ${matAcc}»: остаток на складе должен уменьшиться без красноты.`,
        `Сформируйте «ОСВ по счёту ${offAcc}» (забалансовый): за сотрудником «${emp}» должна числиться «${nom}» в выданном количестве.`,
      ],
      commonStudentMistakes: [
        'Попытка оформить выдачу спецодежды обычной «Реализацией» или «Списанием товаров» — тогда не формируется забалансовый учёт на счёте МЦ.02 за работником.',
        'Указание сотрудника в поле «Контрагент» вместо справочника «Физические лица / Сотрудники».',
        `Выбор счёта 10.01 вместо 10.10 (для спецодежды) или 10.09 (для инвентаря), если при покупке спецодежда приходовалась на 10.10.`,
      ],
    };
  }

  // 3. Поступление оборудования (капитальные вложения на счёт 08.04.1)
  if (op.category === 'purchase_equipment') {
    return {
      accountingMeaning: `Приобретение объекта будущих основных средств («${nom}») у поставщика «${cp}». По ФСБУ 26/2020 и Плану счетов затраты на покупку оборудования до момента готовности к эксплуатации собираются НЕ на счёте 01 и НЕ на счёте 10/41, а как капитальные вложения на счёте 08.04.1 «Приобретение компонентов основных средств» (без НДС).`,
      whyAmountOrVatRule:
        op.vatAmount > 0
          ? `Сумма с НДС ${formatMoneyRu(op.amount)}: в первоначальную стоимость на счёт 08.04.1 включается сумма БЕЗ НДС (${formatMoneyRu(op.amount - op.vatAmount)}), а входной НДС (${formatMoneyRu(op.vatAmount)}) выделяется на специальный субсчёт 19.01 «НДС при приобретении основных средств».`
          : `Операция без НДС: вся сумма ${formatMoneyRu(op.amount)} формирует капитальные вложения на счёте 08.04.1.`,
      navigationPath1C:
        'Раздел «ОС и НМА» → «Поступление основных средств» → «Поступление оборудования» (либо «Покупки → Поступление (акты, накладные, УПД) → Создать: Оборудование»)',
      documentOperationKind1C: 'Поступление оборудования (вид операции «Оборудование»)',
      headerFieldsSteps: [
        { field: 'Накладная / УПД № и от', value: `${op.docNumber || 'б/н'} от ${dateRu}` },
        { field: 'Контрагент', value: cp },
        { field: 'Договор', value: ctr, hint: 'Вид договора: «С поставщиком»' },
        { field: 'Склад', value: wh },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Вкладка «Оборудование»',
          instruction: `Добавьте номенклатуру «${nom}» (вид номенклатуры: Оборудование (объекты основных средств)), Количество = ${op.quantity || 1}, Сумма = ${formatMoneyRu(op.amount)}, Счёт учёта = 08.04.1, Счёт НДС = 19.01.`,
        },
        {
          tabName: 'Регистрация Счёта-фактуры / УПД',
          instruction: op.hasInvoiceSF
            ? 'Установите переключатель «УПД» или введите номер и дату входящего СФ внизу документа → нажмите «Зарегистрировать» для вычета НДС Дт 68.02 Кт 19.01.'
            : 'При получении счёта-фактуры от поставщика зарегистрируйте его внизу документа.',
        },
      ],
      referencePostings: buildRefPostingsFromEntries('По первичной накладной поставщика'),
      selfCheckOsv: [
        'Проверьте «Дт/Кт»: Дт 08.04.1 Кт 60.01 (сумма без НДС) и Дт 19.01 Кт 60.01 (сумма НДС).',
        'Следующим шагом для ввода объекта в работу оформите документ «Принятие к учёту ОС» (Дт 01.01 Кт 08.04.1).',
      ],
      commonStudentMistakes: [
        'Оприходование станка/оборудования документом «Товары» на счёт 41.01 или 10.01 — тогда «Принятие к учёту ОС» не увидит остаток на счёте 08.04.1.',
        'Указание счёта НДС 19.03 вместо 19.01.',
      ],
    };
  }

  // 4. Ввод в эксплуатацию / Принятие к учёту ОС (01.01 — 08.04.1)
  if (op.category === 'os_commissioning' || op.docType1C === 'ПринятиеКУчетуОС') {
    const capAcc = op.materialAccount || '08.04.1';
    return {
      accountingMeaning: `Ввод объекта основных средств («${nom}») в эксплуатацию (ФСБУ 6/2020). Все накопленные на счёте ${capAcc} капитальные вложения (стоимость покупки + доставка/монтаж без НДС) формируют первоначальную стоимость объекта и переносятся на счёт 01.01 «Основные средства в организации». Со следующего месяца (или с даты принятия по учётной политике) по объекту начнёт начисляться амортизация.`,
      whyAmountOrVatRule: `НДС и поставщик здесь НЕ указываются — это внутренний акт ввода ОС (форма ОС-1 / приказ руководителя). Первоначальная стоимость НЕ вводится вручную: 1С автоматически собирает её по дебетовому остатку счёта ${capAcc} по выбранному оборудованию.`,
      navigationPath1C:
        'Раздел «ОС и НМА» → «Поступление основных средств» → «Принятие к учёту ОС» → кнопка «Создать»',
      documentOperationKind1C: 'Принятие к учёту ОС — Вид операции: «Оборудование»',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu, hint: 'Позже по времени, чем «Поступление оборудования» на 08.04.1' },
        { field: 'МОЛ (Материально ответственное лицо)', value: emp },
        { field: 'Местонахождение ОС', value: 'Основное подразделение' },
        { field: 'Событие ОС', value: 'Принятие к учёту с вводом в эксплуатацию' },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Вкладка «Внеоборотный актив»',
          instruction: `Способ поступления: «Приобретение за плату», Оборудование: «${nom}», Склад: «${wh}», Счёт: ${capAcc}.`,
        },
        {
          tabName: 'Вкладка «Основные средства»',
          instruction: `Создайте и выберите элемент справочника «Основные средства» («${nom}», укажите инвентарный номер и амортизационную группу).`,
        },
        {
          tabName: 'Вкладки «Бухгалтерский учёт» и «Налоговый учёт»',
          instruction: `Счёт учёта = 01.01, Порядок учёта = «Начисление амортизации», галочка «Начислять амортизацию» установлена, Способ = Линейный, Счёт начисления амортизации = 02.01, Способ отражения расходов по амортизации = Счёт ${costAcc}, Статья затрат «Амортизация», Срок полезного использования (СПИ) = ${op.usefulLifeMonths && op.usefulLifeMonths > 0 ? `${op.usefulLifeMonths} мес.` : 'в месяцах по классификатору ОС (например, 37 мес.)'}.`,
        },
      ],
      referencePostings:
        buildRefPostingsFromEntries(`Автоматически по накопленному сальдо счёта ${capAcc}`),
      selfCheckOsv: [
        `Кнопка «Дт/Кт»: проводка Дт 01.01 Кт ${capAcc} на первоначальную стоимость объекта без НДС.`,
        `Откройте «ОСВ по счёту ${capAcc}»: конечное сальдо по объекту «${nom}» должно стать строго 0,00 ₽!`,
        'Откройте «ОСВ по счёту 01.01»: объект должен числиться в дебетовом остатке.',
      ],
      commonStudentMistakes: [
        'Забыта галочка «Начислять амортизацию» на вкладках БУ и НУ — при закрытии следующих месяцев не начислится амортизация (Дт 20/26 Кт 02.01).',
        'Время документа «Принятие к учёту ОС» раньше «Поступления оборудования» за тот же день — 1С напишет, что на счёте 08.04.1 нет остатка.',
      ],
    };
  }

  // 5. Выпуск готовой продукции из производства (43 — 20.01)
  if (op.category === 'production_output' || op.docType1C === 'ВыпускПродукции') {
    return {
      accountingMeaning: `Оприходование выпущенной из цеха готовой продукции («${nom}») на склад. Документ переносит стоимость выпущенной продукции с производственного счёта ${costAcc} в дебет счёта 43 «Готовая продукция» (в течение месяца по плановой цене или без суммы с окончательной калькуляцией фактической себестоимости при «Закрытии месяца»).`,
      whyAmountOrVatRule: `Внутренний выпуск продукции НДС не облагается и контрагента не имеет (НДС возникнет только при последующей продаже покупателю). Если фактическая себестоимость за месяц ещё собирается на счёте ${costAcc}, 1С досчитает и скорректирует себестоимость выпуска при регламентном закрытии месяца.`,
      navigationPath1C:
        'Раздел «Производство» → «Выпуск продукции (Отчёты производства за смену)» → кнопка «Создать»',
      documentOperationKind1C: 'Отчёт производства за смену (Выпуск продукции)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Склад', value: wh, hint: 'Склад готовой продукции' },
        { field: 'Счёт затрат', value: costAcc, hint: 'Подразделение затрат: Основное подразделение' },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Вкладка «Продукция»',
          instruction: `Добавьте «${nom}» (вид номенклатуры: Продукция), Количество: ${op.quantity || 1}, Счёт учёта = 43, Номенклатурная группа = «${nomGroup}» (СТРОГО та же группа, на которую списывались материалы, зарплата и амортизация по счёту ${costAcc}!).`,
        },
      ],
      referencePostings:
        buildRefPostingsFromEntries(`Фактическая себестоимость рассчитывается 1С при закрытии счёта ${costAcc}`),
      selfCheckOsv: [
        'Проверьте «Дт/Кт»: проводка Дт 43 Кт 20.01 с количеством выпущенной продукции.',
        'В конце месяца запустите «Операции → Закрытие месяца» (операция «Закрытие счетов 20, 23, 25, 26») и проверьте «Справку-расчёт себестоимости выпущенной продукции».',
      ],
      commonStudentMistakes: [
        `Разные «Номенклатурные группы» в Требовании-накладной (Дт 20.01) и в Отчёте производства (Кт 20.01) — главная ошибка студентов, из-за которой 1С не может рассчитать себестоимость!`,
      ],
    };
  }

  // 6. Внутреннее перемещение между складами
  if (op.category === 'warehouse_transfer' || op.docType1C === 'ПеремещениеТоваров') {
    const whTo = op.warehouseToName || 'Цеховая кладовая / Склад получатель';
    return {
      accountingMeaning: `Внутреннее перемещение запасов («${nom}») с одного склада («${wh}») на другой («${whTo}») внутри одной организации. Право собственности не переходит, затраты не возникают.`,
      whyAmountOrVatRule: `НДС, контрагента и дохода/расхода нет. 1С автоматически переносит себестоимость партии между складами внутри счёта ${matAcc}.`,
      navigationPath1C: 'Раздел «Склад» → «Перемещение товаров, материалов» → кнопка «Создать»',
      documentOperationKind1C: 'Перемещение товаров, материалов',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Отправитель (Склад)', value: wh },
        { field: 'Получатель (Склад)', value: whTo },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Вкладка «Товары»',
          instruction: `Номенклатура: «${nom}», Количество: ${op.quantity || 1}, Счёт отправителя = ${matAcc}, Счёт получателя = ${matAcc}.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(`Автоматически по себестоимости партии на счёте ${matAcc}`),
      selfCheckOsv: [
        `Откройте «ОСВ по счёту ${matAcc}» с детализацией по Складам: остаток ушёл со склада «${wh}» и появился на складе «${whTo}».`,
      ],
      commonStudentMistakes: [
        'Ввод двух документов (Списание + Оприходование) вместо одного документа «Перемещение товаров».',
      ],
    };
  }

  // 7. Внутреннее перемещение денежных средств Банк <-> Касса (50.01 <-> 51)
  if (op.category === 'cash_bank_internal') {
    const isWithdrawToCash = op.docType1C === 'ПоступлениеНаличных';
    return {
      accountingMeaning: isWithdrawToCash
        ? 'Снятие наличных денег с расчётного счёта в кассу организации (на хознужды или выдачу зарплаты): Дт 50.01 Кт 51.'
        : 'Сдача (взнос) наличных денег из кассы на расчётный счёт в банке: Дт 51 Кт 50.01.',
      whyAmountOrVatRule:
        'ВАЖНОЕ ПРАВИЛО 1С:БП 3.0: при операциях между кассой (50) и банком (51) проводку формирует ТОЛЬКО кассовый документ (ПКО или РКО)! Банковская выписка по этой операции в 1С НЕ проводится отдельно с проводкой (или не создаётся), иначе обороты Дт 50 Кт 51 задвоятся ровно в 2 раза!',
      navigationPath1C: isWithdrawToCash
        ? 'Раздел «Банк и касса» → «Кассовые документы» → кнопка «Поступление» (ПКО)'
        : 'Раздел «Банк и касса» → «Кассовые документы» → кнопка «Выдача» (РКО)',
      documentOperationKind1C: isWithdrawToCash
        ? 'Поступление наличных (ПКО) — Вид операции: «Получение наличных в банке»'
        : 'Выдача наличных (РКО) — Вид операции: «Взнос наличными в банк»',
      headerFieldsSteps: [
        { field: 'Вид операции', value: isWithdrawToCash ? 'Получение наличных в банке' : 'Взнос наличными в банк' },
        { field: 'От (Дата)', value: dateRu },
        { field: 'Сумма', value: formatMoneyRu(op.amount) },
        { field: 'Банковский счёт', value: 'Основной расчётный счёт организации (счёт 51)' },
        { field: 'Статья ДДС', value: op.cashFlowItemName || 'Получение / взнос наличных в банке' },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Реквизиты кассового ордера',
          instruction: 'Заполните основание и приложение (по чеку / объявлению на взнос наличными) и нажмите «Провести и закрыть».',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'Проверьте Карточку счёта 50.01 и 51 за эту дату: проводка должна быть ровно ОДНА (без задвоения со стороны банковской выписки!).',
      ],
      commonStudentMistakes: [
        'Создание и ПКО (Дт 50.01 Кт 51), и Списания с расчётного счёта на ту же сумму — в 1С:БП 3.0 кассовый ордер сам формирует движение по счёту 51!',
      ],
    };
  }

  // 7b. Расчёты с подотчётными лицами (счёт 71.01): Выдача под отчёт / Авансовый отчёт / Возврат остатка
  if (
    op.category === 'accountable_issue' ||
    op.category === 'expense_report' ||
    op.category === 'accountable_return' ||
    op.docType1C === 'АвансовыйОтчет'
  ) {
    const accPerson = op.employeeName || op.counterpartyName || 'Подотчётное лицо (сотрудник)';
    if (op.category === 'accountable_issue') {
      const isBank = op.docType1C === 'СписаниеСРасчетногоСчета';
      return {
        accountingMeaning: `Выдача денежных средств под отчёт сотруднику организации («${accPerson}») на хозяйственные или командировочные расходы: ${isBank ? 'перечисление с расчётного счёта на карту сотрудника (Дт 71.01 Кт 51)' : 'выдача наличных из кассы по РКО (Дт 71.01 Кт 50.01)'}.`,
        whyAmountOrVatRule:
          'Выдача денег под отчёт сотруднику НЕ является расходом и НЕ облагается НДС (0%). Внешний контрагент и счёт-фактура здесь НЕ указываются — аналитика счёта 71.01 ведётся строго по справочнику «Работники организаций / Физические лица».',
        navigationPath1C: isBank
          ? 'Раздел «Банк и касса» → «Банковские выписки» → кнопка «Списание» (Вид операции: Перечисление подотчётному лицу)'
          : 'Раздел «Банк и касса» → «Кассовые документы» → кнопка «Выдача» (РКО, Вид операции: Выдача подотчётному лицу)',
        documentOperationKind1C: isBank
          ? 'Списание с расчётного счёта — Вид операции: «Перечисление подотчётному лицу»'
          : 'Выдача наличных (РКО) — Вид операции: «Выдача подотчётному лицу»',
        headerFieldsSteps: [
          { field: 'Вид операции', value: isBank ? 'Перечисление подотчётному лицу' : 'Выдача подотчётному лицу' },
          { field: 'От (Дата)', value: dateRu },
          { field: 'Подотчётное лицо (Получатель)', value: accPerson, hint: 'Выберите сотрудника из справочника Физические лица' },
          { field: 'Сумма', value: formatMoneyRu(op.amount) },
          { field: 'Назначение (Основание)', value: op.description },
        ],
        tabularAndTabsSteps: [
          {
            tabName: 'Проведение документа',
            instruction: `Проверьте счёт расчётов 71.01 и нажмите «Провести и закрыть». За сотрудником «${accPerson}» образуется дебетовая задолженность на счёте 71.01 до утверждения Авансового отчёта.`,
          },
        ],
        referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
        selfCheckOsv: [
          `Откройте «ОСВ по счёту 71.01»: по сотруднику «${accPerson}» отражён дебетовый оборот ${formatMoneyRu(op.amount)}.`,
        ],
        commonStudentMistakes: [
          'Создание документа «Поступление товаров и услуг» с НДС 20% вместо РКО / Списания с р/с с видом операции «Выдача подотчётному лицу».',
          'Попытка выбрать сотрудника в справочнике «Контрагенты» вместо «Физические лица».',
        ],
      };
    }

    if (op.category === 'accountable_return') {
      return {
        accountingMeaning: `Возврат неизрасходованного остатка подотчётных сумм сотрудником «${accPerson}» в кассу организации по приходному кассовому ордеру (Дт 50.01 Кт 71.01).`,
        whyAmountOrVatRule: 'Возврат подотчётных средств НДС не облагается, внешний контрагент не указывается.',
        navigationPath1C: 'Раздел «Банк и касса» → «Кассовые документы» → кнопка «Поступление» (ПКО)',
        documentOperationKind1C: 'Поступление наличных (ПКО) — Вид операции: «Возврат от подотчётного лица»',
        headerFieldsSteps: [
          { field: 'Вид операции', value: 'Возврат от подотчётного лица' },
          { field: 'От (Дата)', value: dateRu },
          { field: 'Подотчётное лицо', value: accPerson },
          { field: 'Сумма', value: formatMoneyRu(op.amount) },
        ],
        tabularAndTabsSteps: [
          {
            tabName: 'Реквизиты ПКО',
            instruction: 'Заполните основание «Возврат неизрасходованной подотчётной суммы» и проведите документ.',
          },
        ],
        referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
        selfCheckOsv: [
          `Проверьте «ОСВ по счёту 71.01»: задолженность подотчётного лица «${accPerson}» должна закрыться в 0,00 ₽.`,
        ],
        commonStudentMistakes: [
          'Выбор вида операции «Оплата от покупателя» (счёт 62) вместо «Возврат от подотчётного лица» (счёт 71.01).',
        ],
      };
    }

    return {
      accountingMeaning: `Утверждение авансового отчёта сотрудника «${accPerson}» по израсходованным подотчётным суммам (приобретение ТМЦ, хозрасходы или командировочные): списание задолженности с кредита счёта 71.01 в дебет счетов учёта запасов или затрат.`,
      whyAmountOrVatRule:
        op.vatAmount > 0
          ? `К авансовому отчёту приложен счёт-фактура / чек с выделенным НДС (${formatMoneyRu(op.vatAmount)}).`
          : 'Без счёта-фактуры (по кассовому/товарному чеку) вся сумма относится на стоимость ТМЦ или расходов без выделения НДС на счёт 19.',
      navigationPath1C: 'Раздел «Банк и касса» → «Касса» → «Авансовые отчёты» → кнопка «Создать»',
      documentOperationKind1C: 'Авансовый отчёт (счёт 71.01)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Подотчётное лицо', value: accPerson },
        { field: 'Склад', value: wh },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Вкладки «Авансы» и «Товары» / «Прочее»',
          instruction: `На вкладке «Авансы» подтяните выданный РКО/перечисление. На вкладке «Товары» (для материалов/ТМЦ) или «Прочее» (для услуг/командировочных) укажите подтверждающий чек и сумму ${formatMoneyRu(op.amount)}.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        `Проверьте «ОСВ по счёту 71.01» по сотруднику «${accPerson}» после проведения отчёта.`,
      ],
      commonStudentMistakes: [
        'Выделение НДС на счёт 19.03 по обычному кассовому чеку без счёта-фактуры (в НУ такой НДС нельзя принять к вычету и списывать в расходы).',
      ],
    };
  }

  // 8. Начисление амортизации ОС / Страховых взносов / Зарплаты
  if (op.category === 'depreciation_accrual') {
    return {
      accountingMeaning: `Ежемесячное перенесение части стоимости основных средств на затраты производства/управления (Дт ${costAcc} Кт 02.01). Счёт 01.01 при этом не уменьшается — износ накапливается на пассивном регулирующем счёте 02.01 (в балансе ОС отражаются по остаточной стоимости: Сальдо 01 − Сальдо 02).`,
      whyAmountOrVatRule: 'НДС не облагается. В 1С:БП 3.0 рассчитывается автоматически регламентной операцией при Закрытии месяца исходя из первоначальной стоимости и СПИ.',
      navigationPath1C: 'Раздел «Операции» → «Закрытие месяца» → «Амортизация и износ основных средств»',
      documentOperationKind1C: 'Регламентная операция «Амортизация и износ основных средств»',
      headerFieldsSteps: [
        { field: 'Период', value: dateRu.slice(3), hint: 'Последний день месяца' },
        { field: 'Организация', value: orgName },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Справка-расчёт амортизации',
          instruction: `Выполните операцию и откройте печатную форму «Справка-расчёт амортизации» для проверки суммы по каждому инвентарному объекту.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries('По норме амортизации (Первоначальная стоимость / СПИ в мес.)'),
      selfCheckOsv: [
        `Проверьте ОСВ по счёту 02.01 (кредитовый оборот) и ОСВ по счёту ${costAcc} (дебетовый оборот по статье «Амортизация»).`,
      ],
      commonStudentMistakes: [
        'Ручное списание амортизации в кредит счёта 01.01 вместо 02.01.',
      ],
    };
  }

  if (op.category === 'hr_hire' || op.docType1C === 'ПриемНаРаботу') {
    const sal = op.monthlySalary || op.amount || 0;
    const pos = op.employeePosition || 'Должность по штатному расписанию';
    return {
      accountingMeaning: `Кадровый приказ о приёме сотрудника «${emp}» на должность «${pos}»${sal >= 0.01 ? ` с должностным окладом ${formatMoneyRu(sal)} в месяц` : ''}. Кадровый документ сам по себе бухгалтерских проводок не формирует, но регистрирует плановый оклад и способ отражения зарплаты (счёт ${costAcc}) в регистрах сведений 1С — благодаря этому документ «Начисление зарплаты» в конце месяца заполнится автоматически по кнопке «Заполнить»!`,
      whyAmountOrVatRule:
        'Кадровый приказ не отражает движение имущества или обязательств на дату приёма — проводки по счёту 70, НДФЛ (68.01) и взносам (69) формируются в конце месяца документом «Начисление зарплаты».',
      navigationPath1C:
        'Раздел «Зарплата и кадры» → «Кадровые документы» → кнопка «Создать: Приём на работу»',
      documentOperationKind1C: 'Приём на работу (Кадровый учёт)',
      headerFieldsSteps: [
        { field: 'Дата приёма', value: dateRu },
        { field: 'Организация', value: orgName },
        { field: 'Сотрудник', value: emp, hint: 'Создайте/выберите в справочнике «Сотрудники» (укажите ИНН, СНИЛС, дату рождения и вычеты НДФЛ)' },
        { field: 'Подразделение и Должность', value: `Основное подразделение / ${pos}` },
        { field: 'Оклад (Начисление)', value: sal >= 0.01 ? formatMoneyRu(sal) : 'По трудовому договору', hint: `Способ отражения зарплаты в бухучёте: Счёт ${costAcc}` },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Блок «Начисления» в документе Приём на работу',
          instruction: `Проверьте вид начисления «Оклад по дням», размер оклада${sal >= 0.01 ? ` (${formatMoneyRu(sal)})` : ''} и нажмите «Провести и закрыть».`,
        },
      ],
      referencePostings: [
        {
          debit: '— (Регистр кадрового учёта)',
          credit: '— (Плановые начисления)',
          amountRule: sal >= 0.01 ? `Оклад ${formatMoneyRu(sal)} / мес.` : 'По штатному расписанию',
          purpose: `Регистрация приёма «${emp}» для последующего автоматического расчёта зарплаты`,
        },
      ],
      selfCheckOsv: [
        'В самом документе «Приём на работу» бухгалтерских проводок Дт/Кт нет (это норма 1С:БП 3.0).',
        'В конце месяца создайте «Зарплата и кадры → Все начисления → Начисление зарплаты» и нажмите «Заполнить» — сотрудник и его оклад подтянутся автоматически!',
      ],
      commonStudentMistakes: [
        'Попытка вручную ввести проводку Дт 20/26 Кт 70 в день приёма сотрудника на работу (зарплата начисляется последним днём месяца за фактически отработанное время).',
        'Пропуск кадрового документа «Приём на работу» — из-за этого кнопка «Заполнить» в «Начислении зарплаты» оставляет таблицу пустой.',
      ],
    };
  }

  // 8b. Исполнительный лист (регистрация удержания алиментов — без собственных проводок)
  if (op.category === 'writ_of_execution' || op.docType1C === 'ИсполнительныйЛист') {
    const recName = op.alimonyRecipientName || op.counterpartyName || 'Получатель алиментов';
    const shareTxt =
      op.alimonyShareLabel ||
      (op.alimonyRatePercent ? `${op.alimonyRatePercent}%` : '25% (1/4 дохода)');
    return {
      accountingMeaning: `Регистрация поступившего исполнительного листа на удержание алиментов из дохода сотрудника «${emp}» в пользу получателя «${recName}» (${shareTxt}). В 1С:Бухгалтерия 8.3 сам документ «Исполнительный лист» бухгалтерских проводок Дт/Кт НЕ формирует — он делает запись в регистр плановых удержаний!`,
      whyAmountOrVatRule: `НДС (0%) и внешний коммерческий контрагент отсутствуют. Сумма удержания рассчитывается автоматически в конце каждого месяца документом «Начисление зарплаты» строго с дохода работника ЗА ВЫЧЕТОМ НДФЛ 13% (ч. 1 ст. 99 Закона № 229-ФЗ): Дт 70 (${emp}) Кт 76.41 (${recName}).`,
      navigationPath1C:
        'Раздел «Зарплата и кадры» → «Зарплата» → «Исполнительные листы» → кнопка «Создать»',
      documentOperationKind1C: 'Исполнительный лист (регистрация планового удержания)',
      headerFieldsSteps: [
        { field: 'От (Дата регистрации)', value: dateRu },
        { field: 'Организация', value: orgName },
        { field: 'Сотрудник', value: emp, hint: 'Выберите работника из справочника «Сотрудники»' },
        {
          field: 'Получатель',
          value: recName,
          hint: 'Создайте/выберите в справочнике «Контрагенты» с видом «Физическое лицо»',
        },
        { field: 'Удерживать с', value: dateRu },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Способ расчёта удержания',
          instruction: `Установите переключатель «Процентом» (или «Долей») от заработка, укажите размер ${shareTxt} и нажмите «Провести и закрыть».`,
        },
      ],
      referencePostings: [
        {
          debit: '— (Регистр плановых удержаний)',
          credit: '— (Без проводок в день регистрации)',
          amountRule: `${shareTxt} от чистого дохода (Оклад − НДФЛ 13%)`,
          purpose: `При следующем «Начислении зарплаты» 1С автоматически сформирует проводку Дт 70 Кт 76.41 в пользу «${recName}»`,
        },
      ],
      selfCheckOsv: [
        'В самом документе «Исполнительный лист» проводок Дт/Кт нет — это эталонное поведение 1С:БП 3.0.',
        `Проверьте следующий документ «Начисление зарплаты»: на вкладке «Удержания» автоматически появится строка по сотруднику «${emp}» и проводка Дт 70 Кт 76.41.`,
      ],
      commonStudentMistakes: [
        'Ошибочный ввод исполнительного листа как «Поступление товаров/услуг» или ручной проводки в день получения листа до начисления зарплаты.',
        'Расчёт алиментов от полного оклада до вычета НДФЛ 13% (по закону алименты считаются строго от суммы после удержания НДФЛ!).',
      ],
    };
  }

  // 8c. Перечисление удержанных алиментов получателю (Дт 76.41 Кт 51)
  if (op.category === 'alimony_payout') {
    const recName = op.alimonyRecipientName || op.counterpartyName || 'Получатель алиментов';
    const recInn = op.alimonyRecipientInn || op.counterpartyInn || '';
    return {
      accountingMeaning: `Перечисление с расчётного счёта удержанной из зарплаты суммы алиментов получателю «${recName}»${recInn ? ` (ИНН ${recInn})` : ''}: погашается кредиторская задолженность организации по счёту 76.41 «Расчёты по исполнительным документам работников» (Дт 76.41 Кт 51).`,
      whyAmountOrVatRule: `Перечисление алиментов НДС не облагается (Без НДС). Если сумма в условии явно не названа, перечисляется вся накопленная кредитовая задолженность по счёту 76.41, удержанная при начислении зарплаты (${formatMoneyRu(op.amount)}).`,
      navigationPath1C:
        'Раздел «Банк и касса» → «Банковские выписки» → кнопка «Списание»',
      documentOperationKind1C:
        'Списание с расчётного счёта — Вид операции: «Прочее списание» (или «Перечисление по исполнительному листу»)',
      headerFieldsSteps: [
        { field: 'Вид операции', value: 'Прочее списание (счёт 76.41)' },
        { field: 'От (Дата)', value: dateRu, hint: 'Установите галочку «Подтверждено выпиской банка»' },
        {
          field: 'Получатель',
          value: `${recName}${recInn ? ` (ИНН ${recInn})` : ''}`,
          hint: 'Физлицо в справочнике «Контрагенты»',
        },
        { field: 'Сумма', value: formatMoneyRu(op.amount) },
        { field: 'Счёт дебета', value: '76.41', hint: `Субконто «Контрагенты»: «${recName}»` },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Реквизиты списания и проведение',
          instruction: `Проверьте Счёт дебета = 76.41, Контрагент = «${recName}», Статья ДДС = «Оплата труда / Прочие выплаты» и проведите документ.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        `Откройте «ОСВ по счёту 76.41»: кредитовое сальдо по получателю «${recName}» должно закрыться в 0,00 ₽.`,
      ],
      commonStudentMistakes: [
        'Выбор вида операции «Оплата поставщику» (счёт 60.01) с НДС вместо счёта 76.41 «Расчёты по исполнительным документам работников».',
      ],
    };
  }

  // 8d. Приобретение векселей / долговых ценных бумаг (Финансовые вложения — счёт 58.02)
  if (op.category === 'financial_investment' || op.docType1C === 'ФинансовыеВложения') {
    const notesSummary = op.financialNotesSummary || op.nomenclatureName || 'Процентные векселя третьих лиц';
    return {
      accountingMeaning: `Приобретение процентных векселей (долговых ценных бумаг третьих лиц): принятие к учёту финансовых вложений по первоначальной стоимости на счёт 58.02 «Долговые ценные бумаги» (${notesSummary}) в корреспонденции со счётом расчётов с продавцом 76.09 (ПБУ 19/02).`,
      whyAmountOrVatRule: `Операции с ценными бумагами и векселями НЕ облагаются НДС (пп. 12 п. 2 ст. 149 НК РФ — строго 0% / Без НДС). При покупке нескольких векселей одной операцией общая сумма вложения складывается из стоимости каждого векселя (${formatMoneyRu(op.amount)}). Проценты, указанные на векселях (например, 13%), не уменьшают и не увеличивают цену покупки в день приобретения — они служат ставкой для последующего начисления процентного дохода (Дт 76.09 Кт 91.01).`,
      navigationPath1C:
        'Раздел «Операции» → «Операции, введённые вручную» → кнопка «Создать» → «Операция»',
      documentOperationKind1C: 'Операция, введённая вручную (учёт финансовых вложений на счёте 58.02)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Организация', value: orgName },
        { field: 'Содержание', value: op.description },
        { field: 'Сумма операции', value: formatMoneyRu(op.amount) },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Табличная часть проводок (по каждому векселю)',
          instruction: `Добавьте проводку(и) Дт 58.02 «Долговые ценные бумаги» — Кт 76.09 «Прочие расчёты с разными дебиторами и кредиторами». В субконто счёта 58.02 укажите контрагента-эмитента и карточку каждого векселя (${notesSummary}) на общую сумму ${formatMoneyRu(op.amount)}.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        `Откройте «ОСВ по счёту 58.02»: в дебетовом сальдо должна отразиться полная стоимость приобретённых векселей (${formatMoneyRu(op.amount)}) в разрезе ценных бумаг.`,
      ],
      commonStudentMistakes: [
        'Ошибочное оформление покупки векселей документом «Поступление товаров» на счёт 41.01 с выделением НДС 20%.',
        'Потеря суммы в Excel, когда номиналы векселей написаны текстом внутри описания операции («один на 280 000..., второй - 540 000»).',
      ],
    };
  }

  // 8e. Заключение договора / получение счёта на оплату (без бухгалтерских проводок в день подписания)
  if (op.category === 'contract_event') {
    return {
      accountingMeaning: `Управленческое / договорное событие («${op.description}»). Подписание рамочного договора или получение счёта на оплату фиксирует условия будущих расчётов с контрагентом «${cp}», но само по себе ещё НЕ меняет активы или обязательства организации — поэтому в день заключения договора бухгалтерские проводки Дт/Кт НЕ формируются (0 проводок).`,
      whyAmountOrVatRule:
        'Бухгалтерские проводки возникнут позже в момент реального факта хозяйственной жизни: при перечислении оплаты (Дт 60 Кт 51) или подписании акта / накладной (Дт 10/20/26/41 Кт 60.01). При этом периодическая ставка из договора сохраняется в модели 1С и автоматически подставляется в последующие ежемесячные акты и платежи!',
      navigationPath1C:
        'Раздел «Справочники» → «Контрагенты» → карточка контрагента → вкладка «Договоры» → кнопка «Создать» (либо «Покупки → Счета от поставщиков»)',
      documentOperationKind1C: 'Регистрация договора контрагента / Счёта на оплату (без проводок Дт/Кт)',
      headerFieldsSteps: [
        { field: 'Контрагент', value: cp },
        { field: 'Договор', value: ctr, hint: `Дата договора: ${dateRu}` },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Карточка договора в 1С:БП 3.0',
          instruction: `Запишите реквизиты договора «${ctr}» (вид договора: С поставщиком / С покупателем). Проводки по регистру бухгалтерии создавать НЕ нужно.`,
        },
      ],
      referencePostings: [
        {
          debit: '— (Справочник «Договоры»)',
          credit: '— (Без проводок в день подписания)',
          amountRule: op.calculationProvenance || 'Фиксация условий для будущих актов и оплат',
          purpose: op.description,
        },
      ],
      selfCheckOsv: [
        'Убедитесь, что в день подписания договора или выставления счёта в ОСВ не появилось преждевременной задолженности на счёте 60 или 62.',
      ],
      commonStudentMistakes: [
        'Ошибочное проведение счёта на оплату или подписанного договора аренды как готового «Поступления услуг» в день подписания договора.',
      ],
    };
  }

  // 8f. Учётная политика / кассовая дисциплина (без бухгалтерских проводок)
  if (op.category === 'policy_event') {
    return {
      accountingMeaning: `Организационно-распорядительное событие («${op.description}»). Настройка учётной политики или утверждение лимита остатка кассы задаёт правила работы алгоритмов 1С:БП 3.0 (способ оценки МПЗ, метод директ-костинга для счёта 26, контроль кассового лимита), но бухгалтерских проводок Дт/Кт не формирует.`,
      whyAmountOrVatRule: 'Нормативный приказ руководителя не является хозяйственной операцией по движению активов — сумма проводки 0,00 ₽.',
      navigationPath1C: 'Раздел «Главное» → «Настройки» → «Учётная политика» (или «Налоги и отчёты»)',
      documentOperationKind1C: 'Настройка параметров учёта и учётной политики 1С:БП 3.0',
      headerFieldsSteps: [
        { field: 'Применяется с', value: dateRu },
        { field: 'Организация', value: orgName },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Параметры учётной политики',
          instruction: 'Проверьте способ оценки МПЗ (По средней / ФИФО), порядок закрытия счёта 26 («Директ-костинг» на 90.08.1) и сохраните настройки.',
        },
      ],
      referencePostings: [
        {
          debit: '— (Регистр сведений «Учётная политика»)',
          credit: '— (Без проводок Дт/Кт)',
          amountRule: 'Нормативная настройка 1С',
          purpose: op.description,
        },
      ],
      selfCheckOsv: ['В ОСВ данная строка оборотов не даёт — она управляет автоматическим расчётом последующих документов и «Закрытия месяца».'],
      commonStudentMistakes: ['Попытка ввести приказ об учётной политике или лимите кассы ручной проводкой.'],
    };
  }

  // 8g. Начисление процентного дохода по векселям / ценным бумагам / выданным займам (Дт 76.09 Кт 91.01)
  if (op.category === 'financial_interest_accrual') {
    return {
      accountingMeaning: `Начисление причитающегося процентного дохода (дисконта) по активным финансовым вложениям — процентным векселям, облигациям или предоставленным займам (Дт 76.09 Кт 91.01, ПБУ 19/02 и ПБУ 9/99).`,
      whyAmountOrVatRule: `Процентный доход по ценным бумагам и займам НЕ облагается НДС (пп. 12, 15 п. 2 ст. 149 НК РФ). В расчёт включаются ТОЛЬКО те ценные бумаги, которые на дату ${dateRu} числятся на балансе (счёт 58.02) и ещё не были погашены или переданы!`,
      navigationPath1C: 'Раздел «Операции» → «Операции, введённые вручную» → «Создать: Операция»',
      documentOperationKind1C: 'Операция, введённая вручную (начисление процентов по ценным бумагам)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Организация', value: orgName },
        { field: 'Сумма операции', value: formatMoneyRu(op.amount) },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Табличная часть проводок',
          instruction: `Укажите Дт 76.09 (Контрагент / Вексель) — Кт 91.01 (Субконто «Прочие доходы и расходы»: Проценты к получению) на сумму ${formatMoneyRu(op.amount)}.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'Проверьте ОСВ по счёту 76.09 (дебетовое сальдо начисленных процентов) и ОСВ по счёту 91.01 (кредитовый оборот прочих доходов).',
      ],
      commonStudentMistakes: [
        'Ошибочное начисление процентов по уже выбывшему (переданному по индоссаменту или погашенному) векселю.',
        'Увеличение номинала на счёте 58.02 вместо отражения процентов на счёте 76.09.',
      ],
    };
  }

  // 8h. Выбытие / погашение / передача векселя (индоссамент в оплату поставщику или предъявление к платежу)
  if (op.category === 'financial_disposal') {
    return {
      accountingMeaning: `Выбытие долговой ценной бумаги (векселя третьего лица) со счёта 58.02 (ПБУ 19/02): отражается доход от передачи/погашения векселя (Дт 76.09 Кт 91.01), списывается учётная балансовая стоимость самого векселя (Дт 91.02 Кт 58.02) и закрываются расчёты (взаимозачёт с поставщиком Дт 60.01 Кт 76.09 при индоссаменте либо поступление денег Дт 51 Кт 76.09 при погашении).`,
      whyAmountOrVatRule: `Реализация и передача векселей третьих лиц в счёт оплаты товаров/работ НЕ облагается НДС (пп. 12 п. 2 ст. 149 НК РФ). После проведения этой операции данный вексель снимается с учёта на счёте 58.02, и по нему прекращается дальнейшее начисление процентов!`,
      navigationPath1C: 'Раздел «Операции» → «Операции, введённые вручную» → «Создать: Операция»',
      documentOperationKind1C: 'Операция, введённая вручную (выбытие / индоссамент / погашение векселя)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Организация', value: orgName },
        { field: 'Содержание', value: op.description },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Проводки выбытия ценной бумаги через счёт 91',
          instruction:
            'Отразите: 1) Дт 76.09 Кт 91.01 — договорная стоимость передачи/погашения; 2) Дт 91.02 Кт 58.02 — списание первоначальной стоимости конкретного векселя; 3) Дт 60.01 Кт 76.09 (зачёт долга перед поставщиком при индоссаменте) либо Дт 51 Кт 76.09 (поступление денег при погашении).',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'Откройте «ОСВ по счёту 58.02»: остаток должен уменьшиться ровно на учётную стоимость выбывшего векселя, а оставшиеся ценные бумаги продолжают числиться на балансе.',
      ],
      commonStudentMistakes: [
        'Прямая проводка Дт 60.01 Кт 58.02 мимо счёта 91 «Прочие доходы и расходы» (по ПБУ 19/02 выбытие векселя третьего лица всегда проходит через счёт 91!).',
      ],
    };
  }

  // 8i. Выдача займа контрагенту (58.03 — 51) и начисление процентов по кредитам/займам (91.02 — 66.04 / 67.04)
  if (op.category === 'loan_issued' || op.category === 'loan_interest_accrual') {
    const isIssued = op.category === 'loan_issued';
    return {
      accountingMeaning: isIssued
        ? `Перечисление с расчётного счёта процентного займа заёмщику «${cp}»: формируется финансовое вложение на счёте 58.03 «Предоставленные займы» (Дт 58.03 Кт 51).`
        : `Начисление процентов к уплате по полученному кредиту или займу (Дт 91.02 Кт 66.04 / 66.02 / 67.04, ПБУ 15/2008).`,
      whyAmountOrVatRule: 'Выдача тела займа и начисление процентов по займам/кредитам НДС не облагаются (пп. 15 п. 3 ст. 149 НК РФ).',
      navigationPath1C: isIssued
        ? 'Раздел «Банк и касса» → «Банковские выписки» → кнопка «Списание» (Вид операции: Выдача займа контрагенту)'
        : 'Раздел «Операции» → «Операции, введённые вручную» → «Создать: Операция»',
      documentOperationKind1C: isIssued
        ? 'Списание с расчётного счёта — Вид операции: «Выдача займа контрагенту» (счёт 58.03)'
        : 'Операция, введённая вручную (начисление процентов по кредиту/займу)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Контрагент', value: cp },
        { field: 'Сумма', value: formatMoneyRu(op.amount) },
      ],
      tabularAndTabsSteps: [
        {
          tabName: isIssued ? 'Реквизиты договора займа' : 'Корреспонденция счетов по ПБУ 15/2008',
          instruction: isIssued
            ? 'Проверьте Счёт расчётов = 58.03, Договор с видом «Прочее» и флаг «Подтверждено выпиской банка».'
            : 'Укажите Дт 91.02 (Проценты к уплате) — Кт 66.04 (или 66.02 для банковского кредита). Проценты всегда учитываются обособленно от основного долга!',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        isIssued
          ? 'Проверьте ОСВ по счёту 58.03: отражено дебетовое сальдо выданного займа.'
          : 'Проверьте ОСВ по счёту 66 (субсчёт процентов 66.02 / 66.04 отдельно от тела долга 66.01 / 66.03).',
      ],
      commonStudentMistakes: [
        isIssued
          ? 'Отражение выданного займа как «Оплаты поставщику» на счёт 60.02 вместо счёта 58.03.'
          : 'Начисление процентов на тот же субсчёт 66.03, где учитывается основной долг.',
      ],
    };
  }

  // 8j. Выбытие / списание / продажа основного средства через счёт 01.09
  if (op.category === 'os_disposal') {
    return {
      accountingMeaning: `Выбытие (ликвидация или реализация) объекта основных средств «${nom}» через специальный субсчёт 01.09 «Выбытие основных средств» (ФСБУ 6/2020): списывается первоначальная стоимость (Дт 01.09 Кт 01.01), закрывается накопленная амортизация (Дт 02.01 Кт 01.09), а остаточная стоимость переносится в прочие расходы (Дт 91.02 Кт 01.09).`,
      whyAmountOrVatRule:
        op.vatAmount > 0
          ? `При продаже объекта ОС покупателю признаётся прочий доход с НДС (Дт 62.01 Кт 91.01 на ${formatMoneyRu(op.amount)}) и начисляется НДС ${op.vatRate}% (Дт 91.02 Кт 68.02 на ${formatMoneyRu(op.vatAmount)}). Списание самого ОС при ликвидации НДС не облагается.`
          : 'При ликвидации ОС вследствие износа остаточная стоимость списывается в прочие расходы (Дт 91.02 Кт 01.09) без начисления НДС.',
      navigationPath1C:
        op.vatAmount > 0
          ? 'Раздел «ОС и НМА» → «Выбытие основных средств» → «Передача ОС»'
          : 'Раздел «ОС и НМА» → «Выбытие основных средств» → «Списание ОС»',
      documentOperationKind1C: op.vatAmount > 0 ? 'Передача ОС (реализация объекта ОС)' : 'Списание ОС (ликвидация объекта ОС)',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Основное средство', value: nom },
        ...(op.vatAmount > 0 ? [{ field: 'Покупатель', value: cp }] : []),
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Табличная часть «Основные средства»',
          instruction: `Выберите инвентарный объект «${nom}» и проведите документ — 1С автоматически рассчитает накопленную амортизацию и закроет субсчёт 01.09 в ноль.`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'Откройте «ОСВ по счёту 01»: конечное сальдо на вспомогательном субсчёте 01.09 обязано стать строго 0,00 ₽!',
      ],
      commonStudentMistakes: [
        'Списание полной первоначальной стоимости напрямую в Дт 91.02 Кт 01.01 без закрытия накопленной амортизации со счёта 02.01 через субсчёт 01.09.',
      ],
    };
  }

  // 8k. Регистрация вычета НДС (Счёт-фактура полученный / Формирование записей книги покупок: Дт 68.02 Кт 19)
  if (op.category === 'vat_deduction' || op.docType1C === 'СчетФактураПолученный') {
    return {
      accountingMeaning: `Принятие к вычету ранее учтённого входного НДС со счёта 19 в уменьшение задолженности перед бюджетом по НДС (Дт 68.02 Кт 19.03 / 19.04 / 19.01, ст. 171–172 НК РФ).`,
      whyAmountOrVatRule: `Сумма вычета (${formatMoneyRu(op.amount)}) переносится со счёта 19 в дебет 68.02 на основании зарегистрированного счёта-фактуры поставщика «${cp}».`,
      navigationPath1C: 'Раздел «Операции» → «Регламентные операции НДС» → «Формирование записей книги покупок» (или регистрация СФ в документе поступления)',
      documentOperationKind1C: 'Счёт-фактура полученный / Формирование записей книги покупок',
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Контрагент', value: cp },
        { field: 'Сумма НДС к вычету', value: formatMoneyRu(op.amount) },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Книга покупок',
          instruction: 'Нажмите «Заполнить документ» (или установите флаг «Отразить вычет НДС в книге покупок датой получения» в СФ) и проведите.',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: ['Откройте «ОСВ по счёту 19»: дебетовый остаток по данному поступлению закрылся в 0,00 ₽.'],
      commonStudentMistakes: ['Повторное принятие к вычету НДС, который уже был списан галочкой в самом документе Поступления.'],
    };
  }

  if (op.category === 'payroll_accrual' || op.category === 'insurance_accrual') {
    return {
      accountingMeaning: `Начисление заработной платы работникам организации за месяц (Дт ${costAcc} Кт 70), удержание НДФЛ 13% из дохода сотрудников (Дт 70 Кт 68.01) и начисление страховых взносов работодателя по единому тарифу 30% + взносов от НС и ПЗ ${op.injuryInsuranceRate ?? 0.2}% (Дт ${costAcc} Кт 69.09, 69.11).`,
      whyAmountOrVatRule: `Оплата труда и страховые взносы НДС не облагаются. НДФЛ удерживается ИЗ начисленной зарплаты (уменьшает сумму «на руки» на счёте 70), а страховые взносы начисляются СВЕРХ зарплаты за счёт расходов работодателя.${op.calculationProvenance ? ` (${op.calculationProvenance})` : ''}`,
      navigationPath1C: 'Раздел «Зарплата и кадры» → «Все начисления» → кнопка «Создать: Начисление зарплаты»',
      documentOperationKind1C: 'Начисление зарплаты и взносов',
      headerFieldsSteps: [
        { field: 'Зарплата за', value: 'Месяц начисления' },
        { field: 'От (Дата)', value: dateRu, hint: 'Последний календарный день месяца' },
        { field: 'Организация', value: orgName },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Кнопка «Заполнить» → Вкладки «Начисления», «НДФЛ», «Взносы»',
          instruction: `Нажмите «Заполнить» (либо добавьте сотрудников вручную), проверьте оклады на вкладке «Начисления», исчисленный НДФЛ 13% на вкладке «НДФЛ» и взносы 30% + 0,2% на вкладке «Взносы».`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'ОСВ по счёту 70: Кредитовое сальдо равно сумме к выплате «на руки» (Начислено минус НДФЛ 13%).',
        'ОСВ по счетам 68.01, 69.09 и 69.11: отражена кредиторская задолженность перед бюджетом и СФР.',
      ],
      commonStudentMistakes: [
        'Начисление НДФЛ в дебет 20/26 вместо дебета счёта 70 (НДФЛ платится за счёт дохода работника, а не расходов фирмы!).',
      ],
    };
  }

  // 9. Взнос учредителя в уставный капитал (75.01)
  if (op.category === 'founder_contribution') {
    const isCash = op.docType1C === 'ПоступлениеНаличных';
    return {
      accountingMeaning: `Погашение задолженности учредителя («${cp}») по вкладу в уставный капитал организации: денежные средства поступают ${isCash ? 'в кассу (Дт 50.01)' : 'на расчётный счёт (Дт 51)'} в кредит счёта 75.01 «Расчёты по вкладам в уставный (складочный) капитал».`,
      whyAmountOrVatRule: `Вклады в уставный капитал НЕ являются реализацией и НЕ облагаются НДС (пп. 4 п. 3 ст. 39, пп. 1 п. 2 ст. 146 НК РФ). Договор купли-продажи не создаётся.`,
      navigationPath1C: isCash
        ? 'Раздел «Банк и касса» → «Кассовые документы» → «Поступление» (Вид операции: Прочий приход)'
        : 'Раздел «Банк и касса» → «Банковские выписки» → «Поступление» (Вид операции: Прочее поступление)',
      documentOperationKind1C: isCash
        ? 'Поступление наличных (ПКО) — Прочий приход (счёт 75.01)'
        : 'Поступление на расчётный счёт — Прочее поступление (счёт 75.01)',
      headerFieldsSteps: [
        { field: 'Вид операции', value: isCash ? 'Прочий приход' : 'Прочее поступление' },
        { field: 'От (Дата)', value: dateRu },
        { field: 'Плательщик / Принято от', value: cp, hint: 'Учредитель из справочника Контрагенты / Физические лица' },
        { field: 'Сумма', value: formatMoneyRu(op.amount) },
        { field: 'Счёт кредита (Счёт расчётов)', value: '75.01', hint: `Субконто «Контрагенты»: «${cp}»` },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Аналитика ДДС и субконто 75.01',
          instruction: `Укажите Статью ДДС «Поступления денежных вкладов собственников (участников)» и убедитесь, что НДС = «Без НДС».`,
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        `Откройте «ОСВ по счёту 75.01»: если ранее был сформирован уставный капитал (Дт 75.01 Кт 80.09), дебетовая задолженность учредителя «${cp}» закроется в 0,00 ₽.`,
      ],
      commonStudentMistakes: [
        'Выбор вида операции «Оплата от покупателя» (счёт 62) с выделением НДС вместо «Прочее поступление» на счёт 75.01 без НДС.',
      ],
    };
  }

  // 10. Уплата налогов и взносов / Выплата зарплаты / РКО банка / Оплата поставщику / Поступление от покупателя
  if (op.docType1C === 'СписаниеСРасчетногоСчета' || op.docType1C === 'ПоступлениеНаРасчетныйСчет') {
    const isOut = op.docType1C === 'СписаниеСРасчетногоСчета';
    const opKind1C =
      op.category === 'tax_payment'
        ? 'Уплата налога'
        : op.category === 'bank_fee'
          ? 'Комиссия банка'
          : op.category === 'payroll_payout'
            ? 'Перечисление заработной платы по ведомостям'
            : isOut
              ? 'Оплата поставщику'
              : 'Оплата от покупателя';

    return {
      accountingMeaning:
        op.category === 'tax_payment'
          ? 'Перечисление с расчётного счёта в бюджет задолженности по налогам и/или страховым взносам (погашение кредитового сальдо счетов 68 и 69).'
          : op.category === 'bank_fee'
            ? 'Списание банком комиссии за расчётно-кассовое обслуживание (РКО) в прочие расходы организации (Дт 91.02 Кт 51).'
            : op.category === 'payroll_payout'
              ? 'Перечисление заработной платы сотрудникам на банковские карты (Дт 70 Кт 51).'
              : isOut
                ? `Безналичная оплата (или перечисление аванса) поставщику «${cp}» с расчётного счёта организации. 1С автоматически определяет: если поставки ещё не было — это аванс выданный (Дт 60.02 Кт 51); если долг уже числится на 60.01 — погашение долга (Дт 60.01 Кт 51).`
                : `Поступление безналичной оплаты (или предоплаты) от покупателя «${cp}» на расчётный счёт (Дт 51 Кт 62.01 / 62.02).`,
      whyAmountOrVatRule:
        op.category === 'tax_payment'
          ? `Налоги и взносы перечисляются строго без НДС. Если сумма в задании не указана явно, она берётся равной входящему кредитовому остатку по соответствующим субсчетам 68 / 69 в ОСВ на дату платежа (${formatMoneyRu(op.amount)}).`
          : op.category === 'bank_fee' || op.category === 'payroll_payout'
            ? 'Банковские услуги РКО (ст. 149 НК РФ) и выплата заработной платы НДС не облагаются.'
            : op.vatAmount > 0
              ? `В платёжном поручении указывается ставка НДС ${op.vatRate}% (сумма НДС ${formatMoneyRu(op.vatAmount)}), однако при перечислении поставщику проводка по НДС не делается (вычет будет по накладной/СФ). При получении аванса от покупателя на счёт 62.02 регистрируется Счёт-фактура на аванс (Дт 76.АВ Кт 68.02).`
              : `Сумма платежа: ${formatMoneyRu(op.amount)} (Без НДС).`,
      navigationPath1C: `Раздел «Банк и касса» → «Банковские выписки» → кнопка «${isOut ? 'Списание' : 'Поступление'}»`,
      documentOperationKind1C: `${DOC_TYPE_LABELS_1C[op.docType1C]} — Вид операции: «${opKind1C}»`,
      headerFieldsSteps: [
        { field: 'Вид операции', value: opKind1C },
        { field: 'От (Дата)', value: dateRu, hint: 'Не забудьте установить флажок «Подтверждено выпиской банка»' },
        ...(doesOperationRequireCounterparty(op.category)
          ? [
              { field: isOut ? 'Получатель' : 'Плательщик', value: cp },
              { field: 'Договор', value: ctr, hint: 'Тот же договор, что и в накладной/акте для автозачёта аванса!' },
            ]
          : []),
        { field: 'Сумма', value: formatMoneyRu(op.amount) },
        { field: 'Статья расходов (ДДС)', value: op.cashFlowItemName || 'По виду платежа' },
      ],
      tabularAndTabsSteps: [
        {
          tabName: 'Счета расчётов и проведение',
          instruction:
            op.category === 'tax_payment'
              ? 'Выберите Налог (счёт 68.01 / 68.02 / 69.09 / 68.90 ЕНП), Вид обязательства: «Налог (взносы): начислено / уплачено».'
              : op.category === 'bank_fee'
                ? 'Проверьте Счёт дебета = 91.02, Прочие доходы и расходы = «Расходы на услуги банков».'
                : op.category === 'payroll_payout'
                  ? 'Выберите Ведомость в банк (или укажите список сотрудников и сумму к выплате по счёту 70).'
                  : isOut
                    ? 'Проверьте Счёт расчётов = 60.01, Счёт авансов = 60.02, Погашение задолженности = «Автоматически».'
                    : 'Проверьте Счёт расчётов = 62.01, Счёт авансов = 62.02. Если получен аванс на ОСНО — нажмите «Создать на основании → Счёт-фактура выданный» (Дт 76.АВ Кт 68.02).',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'Откройте «ОСВ по счёту 51»: проверьте отсутствие отрицательного («красного») остатка на конец дня.',
        ...(doesOperationRequireCounterparty(op.category)
          ? [`Откройте «ОСВ по счёту ${isOut ? '60' : '62'}» с разбивкой по субсчетам и договорам.`]
          : []),
      ],
      commonStudentMistakes: [
        'Не поставлена галочка «Подтверждено выпиской банка» в документе Списание с расчётного счёта — документ записан, но даёт 0 проводок!',
        'Создан дубликат договора у контрагента — тогда аванс на 60.02 не зачтётся при поступлении товаров на 60.01.',
      ],
    };
  }

  // 11. Поступление товаров / материалов / услуг от поставщика
  if (op.docType1C === 'ПоступлениеТоваровУслуг') {
    const isService = op.category === 'purchase_services';
    const isMaterials = op.category === 'purchase_materials';
    const targetAcc = op.entries[0]?.debit || (isService ? '26' : isMaterials ? matAcc : '41.01');
    const vatAcc = isService ? '19.04' : '19.03';

    return {
      accountingMeaning: isService
        ? `Отражение приобретённых у поставщика «${cp}» работ/услуг («${nom}») по акту или УПД с отнесением стоимости без НДС на счёт затрат ${targetAcc}.`
        : `Оприходование поступивших от поставщика «${cp}» ${isMaterials ? 'материалов' : 'товаров'} («${nom}») на склад «${wh}» по товарной накладной (ТОРГ-12) или УПД на счёт ${targetAcc} по стоимости без НДС.`,
      whyAmountOrVatRule:
        op.vatAmount > 0
          ? `Общая сумма документа с НДС ${op.vatRate}% = ${formatMoneyRu(op.amount)}. На счёт учёта (${targetAcc}) ложится чистая стоимость без НДС (${formatMoneyRu(op.amount - op.vatAmount)}), а входной НДС (${formatMoneyRu(op.vatAmount)}) выделяется на счёт ${vatAcc}. При наличии оригинала счёта-фактуры / УПД (статус 1) НДС сразу принимается к вычету в Дт 68.02 Кт ${vatAcc}.`
          : `Документ без НДС на сумму ${formatMoneyRu(op.amount)}.`,
      navigationPath1C: `Раздел «Покупки» → «Поступление (акты, накладные, УПД)» → кнопка «Поступление» → «${isService ? 'Услуги (акт, УПД)' : 'Товары (накладная, УПД)'}»`,
      documentOperationKind1C: `Поступление: ${isService ? 'Услуги (акт, УПД)' : 'Товары (накладная, УПД)'}`,
      headerFieldsSteps: [
        { field: 'Накладная / Акт № и от', value: `${op.docNumber || 'б/н'} от ${dateRu}`, hint: 'Номер и дата входящего документа поставщика + дата оприходования' },
        { field: 'Контрагент', value: cp },
        { field: 'Договор', value: ctr, hint: 'Вид договора: «С поставщиком» (совпадает с договором предоплаты при наличии аванса)' },
        ...(!isService ? [{ field: 'Склад', value: wh }] : []),
        { field: 'Расчёты', value: 'Счёт 60.01 / Авансы 60.02, Зачёт авансов: «Автоматически»' },
      ],
      tabularAndTabsSteps: [
        {
          tabName: isService ? 'Табличная часть «Услуги»' : 'Табличная часть «Товары»',
          instruction: isService
            ? `Добавьте услугу «${nom}», Сумма: ${formatMoneyRu(op.amount)}, % НДС: ${op.vatRate > 0 ? `${op.vatRate}%` : 'Без НДС'}, Счёт затрат: ${targetAcc} (Статья затрат: «${op.expenseItemName || 'Прочие расходы'}»), Счёт НДС: ${vatAcc}.`
            : `Добавьте номенклатуру «${nom}», Количество: ${op.quantity || 1}, Сумма: ${formatMoneyRu(op.amount)}, % НДС: ${op.vatRate > 0 ? `${op.vatRate}%` : 'Без НДС'}, Счёт учёта: ${targetAcc}, Счёт НДС: ${vatAcc}.`,
        },
        {
          tabName: 'Подвал документа: Счёт-фактура / УПД',
          instruction:
            op.vatAmount > 0
              ? 'Переключите тумблер «УПД» (либо укажите № и дату СФ поставщика и нажмите «Зарегистрировать»). Проверьте галочку «Отразить вычет НДС в книге покупок датой получения».'
              : 'Счёт-фактура не требуется (операция без НДС).',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        `Проверьте кнопку «Дт/Кт»: оприходование Дт ${targetAcc} Кт 60.01, входной НДС Дт ${vatAcc} Кт 60.01${op.entries.some((e) => e.debit === '60.01' && e.credit === '60.02') ? ', зачёт выданного аванса Дт 60.01 Кт 60.02' : ''}${op.hasInvoiceSF && op.vatAmount > 0 ? ` и вычет НДС Дт 68.02 Кт ${vatAcc}` : ''}.`,
        `Откройте «ОСВ по счёту 60» и «ОСВ по счёту ${vatAcc}»: при зарегистрированном СФ сальдо на счёте ${vatAcc} закрывается в 0,00 ₽.`,
      ],
      commonStudentMistakes: [
        'Неверная настройка ссылки «НДС в сумме» vs «НДС сверху»: проверьте в шапке табличной части, чтобы итоговая сумма документа «Всего» точно равнялась сумме из условия задачи!',
        'Забыта регистрация Счёта-фактуры внизу накладной — тогда входной НДС зависает дебетовым остатком на счёте 19.',
      ],
    };
  }

  // 12. Реализация товаров / готовой продукции / услуг покупателю
  if (op.docType1C === 'РеализацияТоваровУслуг') {
    const isService = op.category === 'sale_services';
    return {
      accountingMeaning: `Отгрузка товаров / готовой продукции или сдача оказанных услуг («${nom}») покупателю «${cp}». Признаётся выручка от продаж (Дт 62.01 Кт 90.01.1), начисляется исходящий НДС в бюджет (Дт 90.03 Кт 68.02)${!isService ? ' и одновременно списывается складская себестоимость проданных ТМЦ (Дт 90.02.1 Кт 41.01 / 43)' : ''}.`,
      whyAmountOrVatRule:
        op.vatAmount > 0
          ? `Выручка в Дт 62.01 Кт 90.01.1 отражается В ПОЛНОЙ СУММЕ с НДС (${formatMoneyRu(op.amount)}), а начисленный НДС ${op.vatRate}% (${formatMoneyRu(op.vatAmount)}) выделяется отдельной проводкой Дт 90.03 Кт 68.02.`
          : `Реализация без НДС на сумму ${formatMoneyRu(op.amount)}.`,
      navigationPath1C: `Раздел «Продажи» → «Реализация (акты, накладные, УПД)» → кнопка «Реализация» → «${isService ? 'Услуги (акт, УПД)' : 'Товары (накладная, УПД)'}»`,
      documentOperationKind1C: `Реализация: ${isService ? 'Услуги (акт, УПД)' : 'Товары (накладная, УПД)'}`,
      headerFieldsSteps: [
        { field: 'От (Дата)', value: dateRu },
        { field: 'Контрагент', value: cp },
        { field: 'Договор', value: ctr, hint: 'Вид договора: «С покупателем»' },
        ...(!isService ? [{ field: 'Склад', value: wh }] : []),
      ],
      tabularAndTabsSteps: [
        {
          tabName: isService ? 'Вкладка «Услуги»' : 'Вкладка «Товары»',
          instruction: `Номенклатура: «${nom}», Количество: ${op.quantity || 1}, Сумма с НДС: ${formatMoneyRu(op.amount)}, % НДС: ${op.vatRate > 0 ? `${op.vatRate}%` : 'Без НДС'}, Счёт доходов: 90.01.1 (Номенклатурная группа: «${nomGroup}»).`,
        },
        {
          tabName: 'Выписка Счёта-фактуры выданного',
          instruction: op.vatAmount > 0
            ? 'Внизу документа нажмите кнопку «Выписать счёт-фактуру» (или включите тумблер «УПД») для регистрации в Книге продаж.'
            : 'Счёт-фактура не требуется.',
        },
      ],
      referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
      selfCheckOsv: [
        'Проверьте «Дт/Кт»: выручка Дт 62.01 Кт 90.01.1, НДС Дт 90.03 Кт 68.02 и (для товаров/продукции) списание себестоимости Дт 90.02.1 Кт 41.01 (43).',
        'Проверьте «Отчёты → Книга продаж»: выписанный счёт-фактура должен попасть в отчёт.',
      ],
      commonStudentMistakes: [
        'Проведение реализации раньше по времени, чем поступление/выпуск этого товара в тот же день — тогда себестоимость (Дт 90.02.1 Кт 41/43) не спишется!',
        'Забыта кнопка «Выписать счёт-фактуру» внизу документа.',
      ],
    };
  }

  // 13. Специализированное пояснение для всех расширенных разделов Плана счетов и Регламентного закрытия (УК 80, дивиденды 84/75.02, НМА 04/05/08.05, инвентаризация 94, эквайринг 57.03, спецсчета 55, расчёты с персоналом 73, РБП 97, резервы 63, забалансовые 001–009)
  const specFallback = getDocumentSpecForOperation(op);
  const specialMeaningMap: Partial<Record<OperationCategory, string>> = {
    charter_capital: `Формирование объявленного уставного капитала организации согласно решению учредителей / уставу: отражается задолженность участников по вкладам (Дт 75.01 Кт 80.09)${op.entries.length > 1 ? ' и одновременное внесение вклада учредителя в счёт погашения доли (Кт 75.01)' : ''}.`,
    dividends_accrual: `Начисление дивидендов участникам (акционерам) за счёт нераспределённой чистой прибыли по решению общего собрания (Дт 84.01 Кт 75.02 / 70)${op.entries.some((e) => e.credit === '68.01') ? ' с удержанием НДФЛ налоговым агентом' : ''}.`,
    dividends_payout: `Выплата начисленных дивидендов участникам за вычетом удержанного налога (Дт 75.02 / 70 Кт 51 / 50.01).`,
    intangible_acquisition: `Приобретение исключительных прав / нематериального актива у правообладателя «${cp}» с отражением капитальных вложений на счёте 08.05 (ФСБУ 26/2020, ФСБУ 14/2022).`,
    intangible_commissioning: `Принятие к бухгалтерскому учёту нематериального актива «${nom}» по сформированной первоначальной стоимости (Дт 04.01 Кт 08.05).`,
    intangible_amortization: `Ежемесячное начисление амортизации нематериального актива на счёте 05 в состав расходов по обычным видам деятельности.`,
    inventory_result: `Отражение результатов инвентаризации ТМЦ (ФСБУ 28/2023): выявленные недостачи учитываются на счёте 94 и списываются на виновных лиц (73.02) или прочие расходы (91.02), а излишки приходуются в Кт 91.01.`,
    acquiring_receipt: `Зачисление банком-эквайером торговой выручки по платёжным картам со счёта 57.03 «Продажи по платёжным картам» на расчётный счёт 51${op.entries.some((e) => e.debit === '91.02') ? ' с одновременным отражением удержанной комиссии эквайринга в Дт 91.02 Кт 57.03' : ''}.`,
    special_bank_55: `Движение денежных средств по специальным счетам в банках (аккредитивы 55.01, депозитные счета 55.03, корпоративные карты 55.04).`,
    employee_settlement_73: `Расчёты с персоналом по прочим операциям на счёте 73 (предоставление займов работникам на 73.01 или возмещение материального ущерба на 73.02).`,
    deferred_expense_97: `Учёт расходов будущих периодов на счёте 97.21 для последующего равномерного списания в расходы в течение срока действия лицензии / полиса.`,
    reserve_doubtful_63: `Формирование (или корректировка) оценочного резерва по сомнительным долгам покупателей в бухгалтерском учёте (Дт 91.02 Кт 63).`,
    off_balance_op: `Забалансовый учёт ценностей и обязательств, не принадлежащих организации на праве собственности (счета 001–009, МЦ): проводка формируется простой односторонней записью без двойной корреспонденции по балансу.`,
    closing:
      'Регламентное закрытие счетов затрат (20.01, 25, 26, 44.01), сопоставление оборотов по счетам 90 и 91 с выведением финансового результата на счёт 99.01.1 (а в декабре — реформация баланса с переносом чистой прибыли/убытка года на счёт 84).',
    advance_offset:
      'Взаимозачёт ранее выданных/полученных авансов и задолженности (60.02 ↔ 60.01, 62.02 ↔ 62.01, 76) документом «Корректировка долга».',
  };

  return {
    accountingMeaning:
      specialMeaningMap[op.category] ||
      `Отражение хозяйственной операции «${op.description}» в регистре бухгалтерии 1С:БП 3.0.`,
    whyAmountOrVatRule:
      op.category === 'closing'
        ? 'Регламентные операции выполняются строго последним числом месяца в 23:59:59 автоматически обработкой «Закрытие месяца».'
        : op.category === 'off_balance_op'
          ? `Учёт ведётся в оценке, предусмотренной договором (${formatMoneyRu(op.amount)}), без НДС и без влияния на валюту бухгалтерского баланса.`
          : `Сумма операции: ${formatMoneyRu(op.amount)}${op.vatAmount > 0 ? ` (в т.ч. НДС ${formatMoneyRu(op.vatAmount)})` : ' (без НДС)'}.`,
    navigationPath1C: specFallback.menuPath1C,
    documentOperationKind1C: specFallback.documentKind1C,
    headerFieldsSteps: [
      { field: 'Дата', value: dateRu },
      { field: 'Организация', value: orgName },
      { field: 'Содержание', value: op.description },
    ],
    tabularAndTabsSteps: [
      {
        tabName: 'Табличная часть / Регламентное выполнение',
        instruction:
          op.category === 'closing'
            ? 'Нажмите «Перепровести документы за месяц», затем «Выполнить закрытие месяца» — все пункты регламентных операций должны стать выполненными.'
            : specFallback.auditGuidanceTemplate.repostInstruction,
      },
    ],
    referencePostings: buildRefPostingsFromEntries(formatMoneyRu(op.amount)),
    selfCheckOsv: [
      specFallback.auditGuidanceTemplate.verifyInOsv,
      ...specFallback.auditGuidanceTemplate.defaultCheckPoints,
    ],
    commonStudentMistakes: [
      op.category === 'closing'
        ? 'Закрытие счетов 20, 26, 90 ручными операциями вместо штатной обработки «Закрытие месяца» в учебной базе 1С.'
        : 'Незаполненное субконто (аналитика Контрагенты / Договоры / Статьи прочих доходов и расходов) в ручной или регламентной проводке.',
    ],
  };
}
