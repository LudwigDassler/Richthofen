import {
  BusinessOperation,
  EmployeeCard1C,
  ExtractedDirectories1C,
  JournalPosting,
  OpeningBalanceEntry,
  OperationStatus,
  OrganizationCard,
  PitfallWarning,
} from '@/types/accounting';
import { formatDateRu, formatMoneyRu, parseDateToSortKey, roundMoney } from './smartLinker';

function normalizeGroupKey(str?: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeMonthEndDate(
  periodStartDate: string,
  sampleOperations: BusinessOperation[]
): { dateValue: string; displayDateRu: string; monthYearLabel: string; year: number; month: number } {
  let year = 2026;
  let month = 4; // 1..12

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec((periodStartDate || '').trim());
  const dotMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec((periodStartDate || '').trim());
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
  } else if (dotMatch) {
    year = Number(dotMatch[3]);
    month = Number(dotMatch[2]);
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dd = String(lastDay).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const isoStr = `${year}-${mm}-${dd}`;
  const dotStr = `${dd}.${mm}.${year}`;

  const firstOpDate = sampleOperations.find((o) => !o.isMonthEndClosing)?.date?.trim() || '';
  const usesDotFormat = /^\d{1,2}\.\d{1,2}(\.\d{2,4})?$/.test(firstOpDate);

  const monthNames = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];
  const monthYearLabel = `${monthNames[month - 1] || 'Период'} ${year}`;

  return {
    dateValue: usesDotFormat ? dotStr : isoStr,
    displayDateRu: formatDateRu(dotStr, year),
    monthYearLabel,
    year,
    month,
  };
}

function sumAccountNetDebit(
  accountPrefixOrExact: string,
  openingBalances: OpeningBalanceEntry[],
  ops: BusinessOperation[]
): number {
  let net = 0;
  for (const b of openingBalances) {
    if (
      b.accountCode === accountPrefixOrExact ||
      b.accountCode.startsWith(`${accountPrefixOrExact}.`)
    ) {
      net += (b.debit || 0) - (b.credit || 0);
    }
  }
  for (const op of ops) {
    if (op.status === 'needs_data') continue;
    for (const p of op.postings) {
      if (
        p.debitAccount === accountPrefixOrExact ||
        p.debitAccount.startsWith(`${accountPrefixOrExact}.`)
      ) {
        net += p.amount;
      }
      if (
        p.creditAccount === accountPrefixOrExact ||
        p.creditAccount.startsWith(`${accountPrefixOrExact}.`)
      ) {
        net -= p.amount;
      }
    }
  }
  return roundMoney(net);
}

function detectPrimaryNomenclatureGroup20(
  baseOps: BusinessOperation[],
  directories: ExtractedDirectories1C
): string {
  for (const op of baseOps) {
    for (const p of op.postings) {
      if (p.debitAccount === '20.01' && p.debitSubconto[0]) {
        return p.debitSubconto[0];
      }
    }
  }
  const empWithGroup = directories.employees.find(
    (e) => e.costAccount.startsWith('20') && e.nomenclatureGroup
  );
  if (empWithGroup?.nomenclatureGroup) {
    return empWithGroup.nomenclatureGroup;
  }
  if (directories.nomenclatureGroups.length > 0) {
    return directories.nomenclatureGroups[0];
  }
  return 'Основная номенклатурная группа';
}

/**
 * Resolves effective employees list for month-end payroll accrual, applying student name
 * substitution for Chief Accountant / `(ФИО студента)` and picking up any HR hiring
 * operations (e.g. Op 5: `Принят на работу главный бухгалтер (ФИО студента) с окладом 72 200`).
 */
function resolveEffectiveEmployeesForPayroll(
  baseOps: BusinessOperation[],
  directories: ExtractedDirectories1C,
  organization: OrganizationCard,
  defaultNomGroup20: string
): EmployeeCard1C[] {
  const studentName = (organization.studentName || '').trim();
  const list: EmployeeCard1C[] = (directories.employees || []).map((emp) => {
    let fullName = emp.fullName;
    const isStudentPlaceholder = /фио\s+студента/i.test(fullName);
    const isChiefAccountant = /главн[ыйая]*\s+бухгалтер|главбух/i.test(emp.position);

    if (studentName && (isStudentPlaceholder || (isChiefAccountant && organization.substituteStudentAsAccountant))) {
      fullName = studentName;
    } else if (isStudentPlaceholder && organization.chiefAccountantName) {
      fullName = organization.chiefAccountantName.replace(/\(?\s*фио\s+студента\s*\)?/gi, '').trim() || fullName;
    }

    return {
      ...emp,
      fullName,
    };
  });

  // Scan HR hiring operations (e.g. Op 5: "Принят на работу главный бухгалтер (ФИО студента) с окладом 72 200")
  for (const op of baseOps) {
    const isHiringOp =
      /принят[ао]?\s+на\s+работу/i.test(op.rawDescription) ||
      /прием\s+на\s+работу/i.test(op.documentType1C);

    if (!isHiringOp || op.resolvedAmount <= 0) continue;

    const isChiefAccHire = /главн[ыйая]*\s+бухгалтер|главбух/i.test(op.rawDescription);
    const isProdHire = /прораб|рабоч|инженер|монтажник|строител/i.test(op.rawDescription);

    const existingIdx = list.findIndex((e) =>
      isChiefAccHire
        ? /главн[ыйая]*\s+бухгалтер|главбух/i.test(e.position) || /фио\s+студента/i.test(e.fullName)
        : Math.abs(e.salary - op.resolvedAmount) < 1
    );

    if (existingIdx >= 0) {
      // Sync salary if user edited Op 5's explicitAmount
      list[existingIdx] = {
        ...list[existingIdx],
        salary: roundMoney(op.resolvedAmount),
        fullName:
          isChiefAccHire && studentName
            ? studentName
            : list[existingIdx].fullName,
      };
    } else {
      const hiredName =
        isChiefAccHire && studentName
          ? studentName
          : isChiefAccHire
            ? organization.chiefAccountantName || 'Главный бухгалтер (ФИО студента)'
            : 'Сотрудник организации';

      list.push({
        id: `emp-hired-${op.id}`,
        fullName: hiredName,
        position: isChiefAccHire ? 'Главный бухгалтер' : 'Специалист',
        department: isProdHire ? 'Основное производство' : 'Администрация',
        salary: roundMoney(op.resolvedAmount),
        hireDate: op.date,
        costAccount: isProdHire ? '20.01' : '26',
        nomenclatureGroup: isProdHire ? defaultNomGroup20 : undefined,
      });
    }
  }

  return list.filter((e) => e.salary > 0);
}

/**
 * Checks whether a 20.01 Nomenclature Group has customer realization (`Кт 90.01.*`) in the period.
 * In 1C 8.3, if a Nomenclature Group on 20.01 has NO realization in the current month (e.g. SPb Op 9
 * «Ремонт кровли с установкой кирпичной трубы» where works were subcontracted on 20.01 but not yet
 * handed over to a customer), 1C keeps 20.01 open as Незавершенное производство (НЗП)!
 */
function hasRealizationFor20Group(
  nomGroup: string,
  ops: BusinessOperation[]
): boolean {
  const targetNorm = normalizeGroupKey(nomGroup);

  for (const op of ops) {
    if (op.status === 'needs_data') continue;
    const hasGoodsWriteOff = op.postings.some(
      (p) => p.debitAccount.startsWith('90.02') && (p.creditAccount.startsWith('41') || p.creditAccount.startsWith('43'))
    );

    for (const p of op.postings) {
      if (!p.creditAccount.startsWith('90.01')) continue;
      const revSubcontoNorm = normalizeGroupKey(p.creditSubconto[0]);

      // Exact or substring match on Nomenclature Group
      if (
        revSubcontoNorm &&
        targetNorm &&
        (revSubcontoNorm === targetNorm ||
          revSubcontoNorm.includes(targetNorm) ||
          targetNorm.includes(revSubcontoNorm))
      ) {
        return true;
      }

      // If an operation realizes works/services (not 41.01 goods resale!) and didn't specify a different group
      if (!hasGoodsWriteOff && (!revSubcontoNorm || revSubcontoNorm === 'основная номенклатурная группа')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generates authentic 1C:Бухгалтерия 8.3 (ред. 3.0) month-end closing operations:
 * - Регл-1: Начисление зарплаты, НДФЛ (13%) и страховых взносов (30% + 0,2%)
 * - Регл-2: Амортизация и износ основных средств (02.01)
 * - Регл-3: Закрытие затратных счетов 20.01 (только по реализованным НГ, иначе НЗП!), 25, 26, 44.01
 * - Регл-4: Закрытие счетов 90 и 91 (Определение финансового результата на 99.01.1)
 * - Регл-5: Расчет налога на прибыль (20% при ОСНО и положительной прибыли)
 */
export function generateMonthEndClosingOperations(
  resolvedOperations: BusinessOperation[],
  openingBalances: OpeningBalanceEntry[],
  directories: ExtractedDirectories1C,
  organization: OrganizationCard,
  existingClosingStatuses?: Record<string, OperationStatus>
): BusinessOperation[] {
  const baseOps = resolvedOperations.filter((op) => !op.isMonthEndClosing);
  const activeBaseOps = baseOps.filter((op) => op.status !== 'needs_data');
  const { dateValue, displayDateRu, monthYearLabel, year, month } = computeMonthEndDate(
    organization.periodStartDate,
    baseOps
  );

  const defaultNomGroup20 = detectPrimaryNomenclatureGroup20(activeBaseOps, directories);
  const generatedClosingOps: BusinessOperation[] = [];
  const runningOps: BusinessOperation[] = [...activeBaseOps];

  // ============================================================================
  // Регл-1: Начисление зарплаты, НДФЛ (13%) и страховых взносов (30% + 0,2%)
  // ============================================================================
  const alreadyHasManualSalaryAccrual = activeBaseOps.some((op) =>
    op.postings.some((p) => p.creditAccount === '70' && p.amount > 0)
  );
  const activeEmployees = resolveEffectiveEmployeesForPayroll(
    activeBaseOps,
    directories,
    organization,
    defaultNomGroup20
  );

  if (activeEmployees.length > 0 && !alreadyHasManualSalaryAccrual) {
    const payrollPostings: JournalPosting[] = [];
    let totalGrossSalary = 0;
    let totalNdfl = 0;
    let totalUnifiedContrib = 0;
    let totalInjuryContrib = 0;
    let midMonthHireNote: string | null = null;

    const monthStartSortKey = year * 10000 + month * 100 + 1;
    const monthEndSortKey = year * 10000 + month * 100 + 31;

    activeEmployees.forEach((emp, idx) => {
      const salary = roundMoney(emp.salary);
      const ndfl = roundMoney(salary * 0.13);
      const contrib30 = roundMoney(salary * 0.3);
      const contrib02 = roundMoney(salary * 0.002);
      const costAcc = emp.costAccount || '26';
      const isProdAccount = costAcc.startsWith('20');
      const nomGroup = emp.nomenclatureGroup || defaultNomGroup20;

      const hireSortKey = parseDateToSortKey(emp.hireDate, year);
      if (hireSortKey > monthStartSortKey && hireSortKey <= monthEndSortKey) {
        const proRata19of22 = roundMoney((salary * 19) / 22);
        midMonthHireNote = `Сотрудник «${emp.fullName}» принят в течение месяца (${formatDateRu(emp.hireDate, year)}) с окладом ${formatMoneyRu(salary)}. В эталоне начислен полный месячный оклад ${formatMoneyRu(salary)} (НДФЛ 13% = ${formatMoneyRu(ndfl)}, к выплате = ${formatMoneyRu(roundMoney(salary - ndfl))}). Обратите внимание: если в 1С 8.3 в документе «Прием на работу» указано 05.04, производственный календарь может рассчитать пропорционально рабочим дням (например, 19 из 22 раб. дн. = ${formatMoneyRu(proRata19of22)}) — проверьте колонку «Отработано дней» в «Начислении зарплаты» по требованиям вашего преподавателя!`;
      }

      totalGrossSalary = roundMoney(totalGrossSalary + salary);
      totalNdfl = roundMoney(totalNdfl + ndfl);
      totalUnifiedContrib = roundMoney(totalUnifiedContrib + contrib30);
      totalInjuryContrib = roundMoney(totalInjuryContrib + contrib02);

      payrollPostings.push({
        id: `regl1-sal-${idx + 1}`,
        debitAccount: costAcc,
        debitSubconto: isProdAccount
          ? [nomGroup, 'Оплата труда']
          : ['Оплата труда', emp.department || 'Администрация'],
        creditAccount: '70',
        creditSubconto: [emp.fullName, 'Начислено'],
        amount: salary,
        comment: `Начислена зарплата за месяц: ${emp.fullName} (${emp.position})`,
        formulaHint: `Оклад по штатному расписанию = ${formatMoneyRu(salary)}`,
        proportionOfTotal: 'custom',
      });

      payrollPostings.push({
        id: `regl1-ndfl-${idx + 1}`,
        debitAccount: '70',
        debitSubconto: [emp.fullName, 'Удержан НДФЛ'],
        creditAccount: '68.01',
        creditSubconto: ['Налог: начислено / уплачено'],
        amount: ndfl,
        comment: `Удержан НДФЛ 13%: ${emp.fullName}`,
        formulaHint: `${formatMoneyRu(salary)} × 13% = ${formatMoneyRu(ndfl)}`,
        proportionOfTotal: 'custom',
      });

      payrollPostings.push({
        id: `regl1-ins30-${idx + 1}`,
        debitAccount: costAcc,
        debitSubconto: isProdAccount
          ? [nomGroup, 'Страховые взносы']
          : ['Страховые взносы', emp.department || 'Администрация'],
        creditAccount: '69.09',
        creditSubconto: ['Страховые взносы по единому тарифу'],
        amount: contrib30,
        comment: `Страховые взносы по единому тарифу (30%): ${emp.fullName}`,
        formulaHint: `${formatMoneyRu(salary)} × 30% = ${formatMoneyRu(contrib30)}`,
        proportionOfTotal: 'custom',
      });

      payrollPostings.push({
        id: `regl1-ins02-${idx + 1}`,
        debitAccount: costAcc,
        debitSubconto: isProdAccount
          ? [nomGroup, 'Страховые взносы']
          : ['Страховые взносы', emp.department || 'Администрация'],
        creditAccount: '69.11',
        creditSubconto: ['Взносы от НС и ПЗ'],
        amount: contrib02,
        comment: `Взносы на травматизм НС и ПЗ (0,2%): ${emp.fullName}`,
        formulaHint: `${formatMoneyRu(salary)} × 0,2% = ${formatMoneyRu(contrib02)}`,
        proportionOfTotal: 'custom',
      });
    });

    const netPayout = roundMoney(totalGrossSalary - totalNdfl);
    const totalPayrollExpense = roundMoney(
      totalGrossSalary + totalUnifiedContrib + totalInjuryContrib
    );
    const opId = 'closing-regl-1-payroll';

    const payrollPitfalls: PitfallWarning[] = [];
    if (midMonthHireNote) {
      payrollPitfalls.push({
        severity: 'info',
        checkType: 'general',
        title: 'Нюанс 1С 8.3 при приеме сотрудника не с 1-го числа месяца (пропорция дней vs полный оклад)',
        description: midMonthHireNote,
      });
    }
    payrollPitfalls.push({
      severity: 'warning',
      checkType: 'closing_subconto',
      title: 'Проверьте способы отражения зарплаты в бухучете (счета 26 и 20.01)',
      description:
        'Административно-управленческий персонал (директор, главный бухгалтер) отражается на счете 26 «Общехозяйственные расходы», а производственный персонал — на счете 20.01 с указанием Номенклатурной группы.',
    });

    const regl1: BusinessOperation = {
      id: opId,
      number: 'Регл-1',
      date: dateValue,
      rawDescription: `Начисление заработной платы сотрудникам (${activeEmployees.map((e) => e.fullName).join(', ')}), удержание НДФЛ (13%) и начисление страховых взносов (30% + 0,2%) за ${monthYearLabel.toLowerCase()}`,
      explicitAmount: totalPayrollExpense,
      resolvedAmount: totalPayrollExpense,
      isMonthEndClosing: true,
      status: existingClosingStatuses?.[opId] ?? 'pending',
      menuPath1C: ['Зарплата и кадры', 'Все начисления', 'Создать → Начисление зарплаты'],
      documentType1C: 'Начисление зарплаты',
      operationKind1C: 'Окончательный расчет за месяц',
      hasUpdOrSf: false,
      documentFields: [
        { label: 'Дата документа', value: displayDateRu, copyable: true },
        { label: 'Месяц начисления', value: monthYearLabel, copyable: true, highlight: true },
        {
          label: 'Сотрудники',
          value: activeEmployees.map((e) => `${e.fullName} (${e.position})`).join('; '),
          copyable: true,
        },
        {
          label: 'Начислено (ФОТ)',
          value: formatMoneyRu(totalGrossSalary, { alwaysDecimals: true }),
          copyable: true,
        },
        {
          label: 'НДФЛ удержанный (13%)',
          value: formatMoneyRu(totalNdfl, { alwaysDecimals: true }),
          copyable: true,
        },
        {
          label: 'К выплате на руки',
          value: formatMoneyRu(netPayout, { alwaysDecimals: true }),
          copyable: true,
        },
        {
          label: 'Взносы 69.09 (30%) + 69.11 (0,2%)',
          value: formatMoneyRu(roundMoney(totalUnifiedContrib + totalInjuryContrib), {
            alwaysDecimals: true,
          }),
          copyable: true,
        },
      ],
      postings: payrollPostings,
      pitfalls: payrollPitfalls,
    };

    generatedClosingOps.push(regl1);
    runningOps.push(regl1);
  }

  // ============================================================================
  // Регл-2: Амортизация основных средств за месяц (при наличии остатка по 01 / 01.01)
  // ============================================================================
  const fixedAssetsCost = sumAccountNetDebit('01', openingBalances, runningOps);
  const alreadyHasDepreciation = activeBaseOps.some((op) =>
    op.postings.some((p) => p.creditAccount.startsWith('02') && p.amount > 0)
  );

  if (fixedAssetsCost > 0 && !alreadyHasDepreciation) {
    const deprAmount = roundMoney(fixedAssetsCost / 60);
    const assetEntry = openingBalances.find((b) => b.accountCode.startsWith('01'));
    const assetName = assetEntry?.subconto1 || 'Основные средства производственного назначения';
    const hasProdActivity =
      runningOps.some((o) => o.postings.some((p) => p.debitAccount === '20.01')) ||
      activeEmployees.some((e) => e.costAccount.startsWith('20'));
    const deprDebitAccount = hasProdActivity ? '20.01' : '26';
    const opId = 'closing-regl-2-depreciation';

    const regl2: BusinessOperation = {
      id: opId,
      number: 'Регл-2',
      date: dateValue,
      rawDescription: `Регламентная операция: Начисление амортизации основных средств за месяц (1/60 от первоначальной стоимости ${formatMoneyRu(fixedAssetsCost)})`,
      explicitAmount: deprAmount,
      resolvedAmount: deprAmount,
      isMonthEndClosing: true,
      status: existingClosingStatuses?.[opId] ?? 'pending',
      menuPath1C: [
        'Операции',
        'Закрытие периода',
        'Закрытие месяца',
        'Амортизация и износ основных средств',
      ],
      documentType1C: 'Регламентная операция',
      operationKind1C: 'Амортизация и износ основных средств',
      hasUpdOrSf: false,
      documentFields: [
        { label: 'Дата операции', value: displayDateRu, copyable: true },
        { label: 'Основное средство', value: assetName, copyable: true },
        {
          label: 'Первоначальная стоимость (01.01)',
          value: formatMoneyRu(fixedAssetsCost, { alwaysDecimals: true }),
          copyable: true,
        },
        { label: 'Способ начисления / СПИ', value: 'Линейный способ, 60 мес.', copyable: false },
        {
          label: 'Амортизация за месяц',
          value: formatMoneyRu(deprAmount, { alwaysDecimals: true }),
          copyable: true,
          highlight: true,
        },
      ],
      postings: [
        {
          id: 'regl2-depr-1',
          debitAccount: deprDebitAccount,
          debitSubconto:
            deprDebitAccount === '20.01'
              ? [defaultNomGroup20, 'Амортизация']
              : ['Амортизация', 'Основное подразделение'],
          creditAccount: '02.01',
          creditSubconto: [assetName],
          amount: deprAmount,
          comment: `Начислена амортизация ОС за ${monthYearLabel.toLowerCase()}`,
          formulaHint: `${formatMoneyRu(fixedAssetsCost)} / 60 мес. = ${formatMoneyRu(deprAmount)}`,
          proportionOfTotal: 'full',
        },
      ],
      pitfalls: [
        {
          severity: 'info',
          checkType: 'general',
          title: 'Настройка параметров амортизации при вводе начальных остатков ОС',
          description:
            'Чтобы 1С 8.3 автоматически начислила амортизацию при закрытии месяца, в документе «Ввод остатков» по разделу 01 должна стоять галочка «Начислять амортизацию», указан линейный способ, СПИ (60 мес.) и способ отражения расходов по амортизации.',
        },
      ],
    };

    generatedClosingOps.push(regl2);
    runningOps.push(regl2);
  }

  // ============================================================================
  // Регл-3: Закрытие затратных счетов 20.01, 25, 26, 44.01 (с учетом НЗП!)
  // ============================================================================
  const byNomGroup20 = new Map<string, number>();
  for (const b of openingBalances) {
    if (b.accountCode === '20.01' || b.accountCode === '20') {
      const grp = b.subconto1 || defaultNomGroup20;
      const net = (b.debit || 0) - (b.credit || 0);
      byNomGroup20.set(grp, roundMoney((byNomGroup20.get(grp) || 0) + net));
    }
  }
  for (const op of runningOps) {
    for (const p of op.postings) {
      if (p.debitAccount === '20.01' || p.debitAccount === '20') {
        const grp = p.debitSubconto[0] || defaultNomGroup20;
        byNomGroup20.set(grp, roundMoney((byNomGroup20.get(grp) || 0) + p.amount));
      }
      if (p.creditAccount === '20.01' || p.creditAccount === '20') {
        const grp = p.creditSubconto[0] || defaultNomGroup20;
        byNomGroup20.set(grp, roundMoney((byNomGroup20.get(grp) || 0) - p.amount));
      }
    }
  }

  const balance25 = sumAccountNetDebit('25', openingBalances, runningOps);
  const balance26 = sumAccountNetDebit('26', openingBalances, runningOps);
  const balance44 = sumAccountNetDebit('44', openingBalances, runningOps);

  const costPostings: JournalPosting[] = [];
  let totalClosedCosts = 0;

  if (balance25 > 0) {
    costPostings.push({
      id: 'regl3-close-25',
      debitAccount: '20.01',
      debitSubconto: [defaultNomGroup20, 'Общепроизводственные расходы'],
      creditAccount: '25',
      creditSubconto: ['Основное подразделение'],
      amount: balance25,
      comment: 'Распределение общепроизводственных расходов (счет 25) в основное производство',
      proportionOfTotal: 'custom',
    });
    byNomGroup20.set(
      defaultNomGroup20,
      roundMoney((byNomGroup20.get(defaultNomGroup20) || 0) + balance25)
    );
  }

  if (balance26 > 0 && organization.costingMethod === 'full-absorption') {
    costPostings.push({
      id: 'regl3-absorb-26',
      debitAccount: '20.01',
      debitSubconto: [defaultNomGroup20, 'Общехозяйственные расходы'],
      creditAccount: '26',
      creditSubconto: ['Администрация'],
      amount: balance26,
      comment:
        'Распределение общехозяйственных расходов (счет 26) в себестоимость работ (Дт 20.01 Кт 26)',
      proportionOfTotal: 'custom',
    });
    byNomGroup20.set(
      defaultNomGroup20,
      roundMoney((byNomGroup20.get(defaultNomGroup20) || 0) + balance26)
    );
    totalClosedCosts = roundMoney(totalClosedCosts + balance26);
  }

  let groupIdx = 0;
  const unclosedWipGroups: { group: string; amount: number }[] = [];

  for (const [grp, amount] of Array.from(byNomGroup20.entries())) {
    const cleanAmt = roundMoney(amount);
    if (cleanAmt <= 0) continue;

    // 1C 8.3 Rule: Close 20.01 ONLY if there was realization (`Кт 90.01`) on this Nomenclature Group!
    // Otherwise keep it on 20.01 as Незавершенное производство (НЗП).
    if (hasRealizationFor20Group(grp, runningOps)) {
      groupIdx += 1;
      costPostings.push({
        id: `regl3-close-20-${groupIdx}`,
        debitAccount: '90.02.1',
        debitSubconto: [grp],
        creditAccount: '20.01',
        creditSubconto: [grp],
        amount: cleanAmt,
        comment: `Списание фактической себестоимости сданных работ (услуг) по объекту «${grp}»`,
        proportionOfTotal: 'custom',
      });
      totalClosedCosts = roundMoney(totalClosedCosts + cleanAmt);
    } else {
      unclosedWipGroups.push({ group: grp, amount: cleanAmt });
    }
  }

  if (balance26 > 0 && organization.costingMethod === 'direct-costing') {
    costPostings.push({
      id: 'regl3-close-26-direct',
      debitAccount: '90.08.1',
      debitSubconto: [],
      creditAccount: '26',
      creditSubconto: ['Управленческие расходы'],
      amount: balance26,
      comment: 'Списание общехозяйственных расходов по методу «Директ-костинг» (Дт 90.08.1 Кт 26)',
      proportionOfTotal: 'custom',
    });
    totalClosedCosts = roundMoney(totalClosedCosts + balance26);
  }

  if (balance44 > 0) {
    costPostings.push({
      id: 'regl3-close-44',
      debitAccount: '90.08.1',
      debitSubconto: [],
      creditAccount: '44.01',
      creditSubconto: ['Издержки обращения'],
      amount: balance44,
      comment: 'Списание коммерческих расходов (издержек обращения) на финансовый результат продаж',
      proportionOfTotal: 'custom',
    });
    totalClosedCosts = roundMoney(totalClosedCosts + balance44);
  }

  if (costPostings.length > 0 || unclosedWipGroups.length > 0) {
    const opId = 'closing-regl-3-costs';
    const methodLabel =
      organization.costingMethod === 'direct-costing'
        ? 'Директ-костинг (счет 26 → 90.08.1)'
        : 'Полная производственная себестоимость (счет 26 → 20.01)';

    const wipSummary = unclosedWipGroups
      .map((w) => `«${w.group}» — ${formatMoneyRu(w.amount)}`)
      .join('; ');

    const fields = [
      { label: 'Дата закрытия', value: displayDateRu, copyable: true },
      { label: 'Метод учета счета 26', value: methodLabel, copyable: false, highlight: true },
      {
        label: 'Списано затрат в Дт 90',
        value: formatMoneyRu(totalClosedCosts, { alwaysDecimals: true }),
        copyable: true,
      },
    ];

    const reg3Pitfalls: PitfallWarning[] = [];

    if (unclosedWipGroups.length > 0) {
      fields.push({
        label: 'Незавершенное производство (НЗП на 20.01)',
        value: `${wipSummary} (остается на Дт 20.01 на конец месяца)`,
        copyable: false,
        highlight: true,
      });
      reg3Pitfalls.push({
        severity: 'info',
        checkType: 'closing_subconto',
        title: 'Почему счет 20.01 остается с дебетовым остатком (НЗП) на конец месяца?',
        description: `По номенклатурной группе ${wipSummary} в текущем месяце отражены прямые затраты (субподрядные СМР), но Акт сдачи выполненных работ заказчику (Кт 90.01.1 по этому объекту) еще не оформлен. Поэтому в 1С 8.3 счет 20.01 правомерно остается на конец месяца как Незавершенное производство (НЗП), а счет 26 закрывается на 90.08.1 по методу «Директ-костинг» за счет наличия выручки от оптовой торговли.`,
      });
    } else {
      fields.push({
        label: 'Номенклатурная группа (20.01)',
        value: defaultNomGroup20,
        copyable: true,
      });
      reg3Pitfalls.push({
        severity: 'warning',
        checkType: 'closing_subconto',
        title: 'Главное условие закрытия счета 20.01 в 1С 8.3 без ошибок',
        description: `Счет 20.01 закроется автоматически только если во всех документах затрат (Расход материалов, Поступление услуг, Начисление зарплаты) и в документе «Реализация (акт, УПД)» выбрана одна и та же Номенклатурная группа («${defaultNomGroup20}»).`,
      });
    }

    const regl3: BusinessOperation = {
      id: opId,
      number: 'Регл-3',
      date: dateValue,
      rawDescription:
        unclosedWipGroups.length > 0
          ? `Регламентная операция: Закрытие счета 26 (${methodLabel}); затраты на счете 20.01 (${wipSummary}) переходят в НЗП`
          : `Регламентная операция: Закрытие затратных счетов 20, 23, 25, 26 (${methodLabel})`,
      explicitAmount: totalClosedCosts,
      resolvedAmount: totalClosedCosts,
      isMonthEndClosing: true,
      status: existingClosingStatuses?.[opId] ?? 'pending',
      menuPath1C: [
        'Операции',
        'Закрытие периода',
        'Закрытие месяца',
        'Закрытие счетов 20, 23, 25, 26',
      ],
      documentType1C: 'Регламентная операция',
      operationKind1C: 'Закрытие счетов 20, 23, 25, 26',
      hasUpdOrSf: false,
      documentFields: fields,
      postings: costPostings,
      pitfalls: reg3Pitfalls,
    };

    generatedClosingOps.push(regl3);
    runningOps.push(regl3);
  }

  // ============================================================================
  // Регл-4: Закрытие счетов 90, 91 (Определение финансового результата)
  // ============================================================================
  const rev90_01 = roundMoney(-sumAccountNetDebit('90.01', openingBalances, runningOps));
  const cogs90_02 = sumAccountNetDebit('90.02', openingBalances, runningOps);
  const vat90_03 = sumAccountNetDebit('90.03', openingBalances, runningOps);
  const admin90_08 = sumAccountNetDebit('90.08', openingBalances, runningOps);
  const existing90_09 = sumAccountNetDebit('90.09', openingBalances, runningOps);

  const salesResult90 = roundMoney(
    rev90_01 - cogs90_02 - vat90_03 - admin90_08 - existing90_09
  );

  const otherIncome91_01 = roundMoney(-sumAccountNetDebit('91.01', openingBalances, runningOps));
  const otherExpense91_02 = sumAccountNetDebit('91.02', openingBalances, runningOps);
  const existing91_09 = sumAccountNetDebit('91.09', openingBalances, runningOps);

  const otherResult91 = roundMoney(otherIncome91_01 - otherExpense91_02 - existing91_09);

  const finPostings: JournalPosting[] = [];

  if (Math.abs(salesResult90) >= 0.01) {
    if (salesResult90 > 0) {
      finPostings.push({
        id: 'regl4-close-90-profit',
        debitAccount: '90.09',
        debitSubconto: [],
        creditAccount: '99.01.1',
        creditSubconto: ['Прибыль (убыток) от продаж'],
        amount: salesResult90,
        comment: 'Определена прибыль от продаж за месяц (Дт 90.09 Кт 99.01.1)',
        formulaHint: `${formatMoneyRu(rev90_01)} (90.01.1) − ${formatMoneyRu(cogs90_02)} (90.02.1) − ${formatMoneyRu(vat90_03)} (90.03) − ${formatMoneyRu(admin90_08)} (90.08.1) = ${formatMoneyRu(salesResult90)}`,
        proportionOfTotal: 'custom',
      });
    } else {
      const loss90 = roundMoney(Math.abs(salesResult90));
      finPostings.push({
        id: 'regl4-close-90-loss',
        debitAccount: '99.01.1',
        debitSubconto: ['Прибыль (убыток) от продаж'],
        creditAccount: '90.09',
        creditSubconto: [],
        amount: loss90,
        comment: 'Отражен убыток от продаж за месяц (Дт 99.01.1 Кт 90.09)',
        formulaHint: `Расходы и НДС превышают выручку на ${formatMoneyRu(loss90)}`,
        proportionOfTotal: 'custom',
      });
    }
  }

  if (Math.abs(otherResult91) >= 0.01) {
    if (otherResult91 > 0) {
      finPostings.push({
        id: 'regl4-close-91-profit',
        debitAccount: '91.09',
        debitSubconto: [],
        creditAccount: '99.01.1',
        creditSubconto: ['Сальдо прочих доходов и расходов'],
        amount: otherResult91,
        comment: 'Списано положительное сальдо прочих доходов и расходов (Дт 91.09 Кт 99.01.1)',
        formulaHint: `${formatMoneyRu(otherIncome91_01)} (91.01) − ${formatMoneyRu(otherExpense91_02)} (91.02) = ${formatMoneyRu(otherResult91)}`,
        proportionOfTotal: 'custom',
      });
    } else {
      const loss91 = roundMoney(Math.abs(otherResult91));
      finPostings.push({
        id: 'regl4-close-91-loss',
        debitAccount: '99.01.1',
        debitSubconto: ['Сальдо прочих доходов и расходов'],
        creditAccount: '91.09',
        creditSubconto: [],
        amount: loss91,
        comment: 'Списано отрицательное сальдо прочих расходов (Дт 99.01.1 Кт 91.09)',
        formulaHint: `${formatMoneyRu(otherExpense91_02)} (91.02) − ${formatMoneyRu(otherIncome91_01)} (91.01) = ${formatMoneyRu(loss91)}`,
        proportionOfTotal: 'custom',
      });
    }
  }

  if (finPostings.length > 0) {
    const netBeforeTax = roundMoney(salesResult90 + otherResult91);
    const displayAmount = roundMoney(
      finPostings.reduce((sum, p) => sum + p.amount, 0)
    );
    const opId = 'closing-regl-4-fin-result';

    const regl4: BusinessOperation = {
      id: opId,
      number: 'Регл-4',
      date: dateValue,
      rawDescription: `Регламентная операция: Закрытие счетов 90, 91 и определение финансового результата за месяц (${netBeforeTax >= 0 ? 'прибыль' : 'убыток'} до налогообложения ${formatMoneyRu(Math.abs(netBeforeTax))})`,
      explicitAmount: displayAmount,
      resolvedAmount: displayAmount,
      isMonthEndClosing: true,
      status: existingClosingStatuses?.[opId] ?? 'pending',
      menuPath1C: [
        'Операции',
        'Закрытие периода',
        'Закрытие месяца',
        'Закрытие счетов 90, 91',
      ],
      documentType1C: 'Регламентная операция',
      operationKind1C: 'Закрытие счетов 90, 91',
      hasUpdOrSf: false,
      documentFields: [
        { label: 'Дата операции', value: displayDateRu, copyable: true },
        {
          label: 'Финансовый результат по счету 90',
          value: formatMoneyRu(salesResult90, { alwaysDecimals: true }),
          copyable: true,
        },
        {
          label: 'Сальдо прочих доходов/расходов (91)',
          value: formatMoneyRu(otherResult91, { alwaysDecimals: true }),
          copyable: true,
        },
        {
          label: 'Итого прибыль (убыток) на 99.01.1',
          value: formatMoneyRu(netBeforeTax, { alwaysDecimals: true }),
          copyable: true,
          highlight: true,
        },
      ],
      postings: finPostings,
      pitfalls: [
        {
          severity: 'info',
          checkType: 'general',
          title: 'Почему субсчета 90.01–90.09 имеют остатки внутри года, а синтетический счет 90 равен нулю?',
          description:
            'В 1С 8.3 (и по Плану счетов Минфина РФ) субсчета 90.01, 90.02, 90.03, 90.08 накапливают обороты нарастающим итогом весь год и закрываются внутренними проводками только 31 декабря («Реформация баланса»). В конце каждого месяца проводка на 90.09 и 91.09 обнуляет общее (свернутое) сальдо синтетических счетов 90 и 91.',
        },
      ],
    };

    generatedClosingOps.push(regl4);
    runningOps.push(regl4);
  }

  // ============================================================================
  // Регл-5: Расчет налога на прибыль (20% при ОСНО и положительной прибыли)
  // ============================================================================
  if (organization.taxSystem === 'OSNO') {
    const taxableProfit = roundMoney(-sumAccountNetDebit('99.01', openingBalances, runningOps));
    if (taxableProfit > 0) {
      const profitTax20 = roundMoney(taxableProfit * 0.2);
      const fedPart3 = roundMoney(taxableProfit * 0.03);
      const regPart17 = roundMoney(profitTax20 - fedPart3);
      const opId = 'closing-regl-5-profit-tax';

      const regl5: BusinessOperation = {
        id: opId,
        number: 'Регл-5',
        date: dateValue,
        rawDescription: `Регламентная операция: Расчет налога на прибыль организаций (20% от налогооблагаемой прибыли ${formatMoneyRu(taxableProfit)})`,
        explicitAmount: profitTax20,
        resolvedAmount: profitTax20,
        isMonthEndClosing: true,
        status: existingClosingStatuses?.[opId] ?? 'pending',
        menuPath1C: [
          'Операции',
          'Закрытие периода',
          'Закрытие месяца',
          'Расчет налога на прибыль',
        ],
        documentType1C: 'Регламентная операция',
        operationKind1C: 'Расчет налога на прибыль',
        hasUpdOrSf: false,
        documentFields: [
          { label: 'Дата расчета', value: displayDateRu, copyable: true },
          {
            label: 'Налоговая база (99.01.1)',
            value: formatMoneyRu(taxableProfit, { alwaysDecimals: true }),
            copyable: true,
          },
          { label: 'Ставка налога на прибыль', value: '20% (ФБ 3% + РБ 17%)', copyable: false },
          {
            label: 'Сумма налога (68.04.1)',
            value: formatMoneyRu(profitTax20, { alwaysDecimals: true }),
            copyable: true,
            highlight: true,
          },
          {
            label: 'В т.ч. ФБ (3%) / РБ (17%)',
            value: `${formatMoneyRu(fedPart3, { alwaysDecimals: true })} / ${formatMoneyRu(regPart17, { alwaysDecimals: true })}`,
            copyable: false,
          },
        ],
        postings: [
          {
            id: 'regl5-profit-tax',
            debitAccount: '99.02.1',
            debitSubconto: [],
            creditAccount: '68.04.1',
            creditSubconto: ['Налог: начислено / уплачено', 'Федеральный и региональный бюджет'],
            amount: profitTax20,
            comment: 'Начислен налог на прибыль за месяц (20%)',
            formulaHint: `${formatMoneyRu(taxableProfit)} × 20% = ${formatMoneyRu(profitTax20)} (штрафы на 99.02.3 базу не уменьшают!)`,
            proportionOfTotal: 'full',
          },
        ],
        pitfalls: [
          {
            severity: 'info',
            checkType: 'penalty_split',
            title: 'Штрафные санкции на счете 99.02.3 не уменьшают налог на прибыль!',
            description:
              'Обратите внимание: штрафы на счете 99.02.3 отражены напрямую на счете 99 мимо счета 91.02, поэтому они не занижают налоговую базу по налогу на прибыль (п. 2 ст. 270 НК РФ).',
          },
        ],
      };

      generatedClosingOps.push(regl5);
      runningOps.push(regl5);
    }
  }

  return generatedClosingOps;
}
