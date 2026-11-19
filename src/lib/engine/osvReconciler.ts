import {
  BusinessOperation,
  OsvDiscrepancy,
  OsvReconciliationResult,
  OsvReport,
  OsvRow,
  UserOsvInputRow,
} from '@/types/accounting';
import { getAccountInfo } from '@/data/chartOfAccounts';
import { formatDateRu, formatMoneyRu, roundMoney } from './smartLinker';

function hasNumericValue(val: number | null | undefined): val is number {
  return val !== null && val !== undefined && Number.isFinite(val);
}

function isRowChecked(input: UserOsvInputRow): boolean {
  return (
    hasNumericValue(input.turnoverDebit) ||
    hasNumericValue(input.turnoverCredit) ||
    hasNumericValue(input.endDebit) ||
    hasNumericValue(input.endCredit)
  );
}

function findBestOperationByPosting(
  operations: BusinessOperation[],
  predicate: (debit: string, credit: string, amount: number) => boolean,
  targetAmount?: number
): BusinessOperation | undefined {
  const candidates = operations.filter((op) =>
    op.postings.some((p) => predicate(p.debitAccount, p.creditAccount, p.amount))
  );
  if (candidates.length === 0) return undefined;
  if (targetAmount === undefined) return candidates[0];

  let best = candidates[0];
  let bestDelta = Infinity;
  for (const op of candidates) {
    for (const p of op.postings) {
      if (predicate(p.debitAccount, p.creditAccount, p.amount)) {
        const delta = Math.abs(p.amount - targetAmount);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = op;
        }
      }
    }
  }
  return best;
}

/**
 * Compares user-entered 1C OSV figures against the reference OSV down to 0.01 ₽
 * and produces expert Russian 1C 8.3 accounting diagnostics explaining root causes and fixes.
 */
export function reconcileUserOsv(
  referenceOsv: OsvReport,
  userInputs: Record<string, UserOsvInputRow>,
  operations: BusinessOperation[]
): OsvReconciliationResult {
  const refByCode = new Map<string, OsvRow>();
  for (const row of referenceOsv.rows) {
    refByCode.set(row.accountCode, row);
  }

  const rowDiffs: OsvReconciliationResult['rowDiffs'] = {};
  let checkedAccountsCount = 0;
  let mismatchedAccountsCount = 0;

  for (const [rawKey, input] of Object.entries(userInputs || {})) {
    if (!input || !isRowChecked(input)) continue;
    const code = (input.accountCode || rawKey).trim();
    if (!code) continue;

    checkedAccountsCount += 1;
    const ref = refByCode.get(code);
    const refTurnDb = ref?.turnoverDebit ?? 0;
    const refTurnCr = ref?.turnoverCredit ?? 0;
    const refEndDb = ref?.endDebit ?? 0;
    const refEndCr = ref?.endCredit ?? 0;

    // Compare turnover pair if at least one turnover field was entered
    const enteredTurnoverPair =
      hasNumericValue(input.turnoverDebit) || hasNumericValue(input.turnoverCredit);
    const turnoverDebitDiff = enteredTurnoverPair
      ? roundMoney((input.turnoverDebit ?? 0) - refTurnDb)
      : 0;
    const turnoverCreditDiff = enteredTurnoverPair
      ? roundMoney((input.turnoverCredit ?? 0) - refTurnCr)
      : 0;

    // Compare ending balance pair if at least one ending balance field was entered
    const enteredEndPair =
      hasNumericValue(input.endDebit) || hasNumericValue(input.endCredit);
    const endDebitDiff = enteredEndPair
      ? roundMoney((input.endDebit ?? 0) - refEndDb)
      : 0;
    const endCreditDiff = enteredEndPair
      ? roundMoney((input.endCredit ?? 0) - refEndCr)
      : 0;

    const hasMismatch =
      Math.abs(turnoverDebitDiff) >= 0.01 ||
      Math.abs(turnoverCreditDiff) >= 0.01 ||
      Math.abs(endDebitDiff) >= 0.01 ||
      Math.abs(endCreditDiff) >= 0.01;

    if (hasMismatch) {
      mismatchedAccountsCount += 1;
    }

    rowDiffs[code] = {
      turnoverDebitDiff,
      turnoverCreditDiff,
      endDebitDiff,
      endCreditDiff,
      hasMismatch,
    };
  }

  const diagnostics: OsvDiscrepancy[] = [];
  const explainedAccounts = new Set<string>();

  // ==========================================================================
  // 1. Незачтенный аванс поставщику (60.01 и 60.02, или развернутый 60)
  // ==========================================================================
  const diff6001 = rowDiffs['60.01'];
  const diff6002 = rowDiffs['60.02'];
  const diff60Group = rowDiffs['60'];

  const excess6001Cr =
    diff6001 && diff6001.endCreditDiff >= 0.01
      ? diff6001.endCreditDiff
      : diff6001 && diff6001.turnoverDebitDiff <= -0.01
        ? Math.abs(diff6001.turnoverDebitDiff)
        : 0;
  const excess6002Db =
    diff6002 && diff6002.endDebitDiff >= 0.01
      ? diff6002.endDebitDiff
      : diff6002 && diff6002.turnoverCreditDiff <= -0.01
        ? Math.abs(diff6002.turnoverCreditDiff)
        : 0;

  if (
    excess6001Cr >= 0.01 &&
    excess6002Db >= 0.01 &&
    Math.abs(excess6001Cr - excess6002Db) <= Math.max(1, excess6001Cr * 0.02)
  ) {
    const amountX = roundMoney(excess6001Cr);
    const advOp =
      findBestOperationByPosting(
        operations,
        (d, c) => d === '60.01' && c === '60.02',
        amountX
      ) ||
      findBestOperationByPosting(
        operations,
        (_, c) => c === '60.01',
        amountX
      );

    const affected = ['60.01', '60.02'];
    if (diff60Group?.hasMismatch) affected.push('60');
    affected.forEach((a) => explainedAccounts.add(a));

    const opClause = advOp
      ? `в операции №${advOp.number} от ${formatDateRu(advOp.date)} `
      : '';

    diagnostics.push({
      id: 'diag-unoffset-supplier-advance',
      severity: 'error',
      accountsAffected: affected,
      diffAmount: amountX,
      title: `Не зачтен аванс поставщику на сумму ${formatMoneyRu(amountX)} (счета 60.01 и 60.02)`,
      probableCause: `Расхождение по счетам 60.01 и 60.02 на сумму ${formatMoneyRu(amountX)} — ${opClause}не произошел автоматический зачет аванса (Дт 60.01 Кт 60.02). Проверьте совпадение договора и время проведения документов в 1С (списание с р/сч должно быть раньше поступления)!`,
      howToFixIn1C:
        '1) Откройте «Списание с расчетного счета» и «Поступление (акт, накладная, УПД)» и убедитесь, что выбран один и тот же элемент справочника «Договоры»; 2) Проверьте реквизит «Зачет авансов: Автоматически»; 3) Убедитесь, что дата/время оплаты раньше времени поступления, и перепроведите документы («Операции → Групповое перепроведение документов»).',
      relatedOperationId: advOp?.id,
    });
  } else if (
    !diff6001 &&
    !diff6002 &&
    diff60Group?.hasMismatch &&
    diff60Group.endDebitDiff >= 0.01 &&
    Math.abs(diff60Group.endDebitDiff - diff60Group.endCreditDiff) <=
      Math.max(1, diff60Group.endDebitDiff * 0.02)
  ) {
    const amountX = roundMoney(diff60Group.endDebitDiff);
    const advOp = findBestOperationByPosting(
      operations,
      (d, c) => d === '60.01' && c === '60.02',
      amountX
    );
    explainedAccounts.add('60');
    diagnostics.push({
      id: 'diag-unoffset-supplier-advance-group',
      severity: 'error',
      accountsAffected: ['60', '60.01', '60.02'],
      diffAmount: amountX,
      title: `Развернутое сальдо по счету 60 на сумму ${formatMoneyRu(amountX)} (не зачтен аванс)`,
      probableCause: `По счету 60 одновременно завышены дебетовый и кредитовый остатки на ${formatMoneyRu(amountX)} — не сформирована проводка зачета аванса Дт 60.01 Кт 60.02${advOp ? ` в операции №${advOp.number} от ${formatDateRu(advOp.date)}` : ''}.`,
      howToFixIn1C:
        'Проверьте совпадение договора в платежном документе и документе поступления, а также время проведения документов в 1С (оплата с р/сч должна быть проведена раньше поступления).',
      relatedOperationId: advOp?.id,
    });
  }

  // ==========================================================================
  // 2. Незачтенный аванс покупателя (62.01 и 62.02, или развернутый 62)
  // ==========================================================================
  const diff6201 = rowDiffs['62.01'];
  const diff6202 = rowDiffs['62.02'];
  const diff62Group = rowDiffs['62'];

  const excess6201Db =
    diff6201 && diff6201.endDebitDiff >= 0.01
      ? diff6201.endDebitDiff
      : diff6201 && diff6201.turnoverCreditDiff <= -0.01
        ? Math.abs(diff6201.turnoverCreditDiff)
        : 0;
  const excess6202Cr =
    diff6202 && diff6202.endCreditDiff >= 0.01
      ? diff6202.endCreditDiff
      : diff6202 && diff6202.turnoverDebitDiff <= -0.01
        ? Math.abs(diff6202.turnoverDebitDiff)
        : 0;

  if (
    excess6201Db >= 0.01 &&
    excess6202Cr >= 0.01 &&
    Math.abs(excess6201Db - excess6202Cr) <= Math.max(1, excess6201Db * 0.02)
  ) {
    const amountX = roundMoney(excess6201Db);
    const buyerOp =
      findBestOperationByPosting(
        operations,
        (d, c) => d === '62.02' && c === '62.01',
        amountX
      ) ||
      findBestOperationByPosting(
        operations,
        (d, c) => d === '62.01' && c.startsWith('90.01'),
        amountX
      );

    const affected = ['62.01', '62.02'];
    if (diff62Group?.hasMismatch) affected.push('62');
    affected.forEach((a) => explainedAccounts.add(a));

    diagnostics.push({
      id: 'diag-unoffset-buyer-advance',
      severity: 'error',
      accountsAffected: affected,
      diffAmount: amountX,
      title: `Не зачтен аванс покупателя на сумму ${formatMoneyRu(amountX)} (счета 62.01 и 62.02)`,
      probableCause: `Расхождение по счетам 62.01 и 62.02 на сумму ${formatMoneyRu(amountX)}${buyerOp ? ` (операция №${buyerOp.number} от ${formatDateRu(buyerOp.date)})` : ''} — не произошел автоматический зачет полученной предоплаты покупателя (Дт 62.02 Кт 62.01).`,
      howToFixIn1C:
        'Проверьте в документах «Поступление на расчетный счет» и «Реализация (акт, накладная, УПД)» совпадение Контрагента и Договора с покупателем, реквизит «Зачет авансов: Автоматически» и последовательность времени проведения.',
      relatedOperationId: buyerOp?.id,
    });
  }

  // ==========================================================================
  // 3. Не принят к вычету НДС (19.01 / 19.03 / 19.04 и 68.02)
  // ==========================================================================
  const vat19Codes = ['19.01', '19.03', '19.04', '19'].filter(
    (code) => rowDiffs[code]?.hasMismatch && rowDiffs[code].endDebitDiff >= 0.01
  );

  if (vat19Codes.length > 0) {
    const sub19Codes = vat19Codes.filter((c) => c !== '19');
    const codesToSum = sub19Codes.length > 0 ? sub19Codes : vat19Codes;
    const strandedVat = roundMoney(
      codesToSum.reduce((s, c) => s + rowDiffs[c].endDebitDiff, 0)
    );

    const diff6802 = rowDiffs['68.02'];
    const affected = [...vat19Codes];
    if (diff6802?.hasMismatch) {
      affected.push('68.02');
      if (rowDiffs['68']?.hasMismatch) affected.push('68');
    }
    affected.forEach((a) => explainedAccounts.add(a));

    const vatOp = findBestOperationByPosting(
      operations,
      (d, c) => d === '68.02' && c.startsWith('19'),
      strandedVat
    );

    diagnostics.push({
      id: 'diag-stranded-vat-19',
      severity: 'error',
      accountsAffected: affected,
      diffAmount: strandedVat,
      title: `Не принят к вычету входящий НДС на сумму ${formatMoneyRu(strandedVat)} (счет ${codesToSum.join(', ')})`,
      probableCause: `Завис НДС на счете 19 (${formatMoneyRu(strandedVat)}) — не сформирована проводка налогового вычета Дт 68.02 Кт 19${vatOp ? ` по операции №${vatOp.number} от ${formatDateRu(vatOp.date)}` : ''}. Проверьте тумблер «УПД» под табличной частью документа поступления или регистрацию счета-фактуры и регламентную операцию Формирование записей книги покупок.`,
      howToFixIn1C:
        'В документе «Поступление (акт, накладная, УПД)» переключите тумблер «УПД» внизу формы в активное положение (либо зарегистрируйте счет-фактуру полученный с галочкой «Отразить вычет НДС в книге покупок датой получения») или выполните «Операции → Закрытие периода → Регламентные операции НДС → Формирование записей книги покупок».',
      relatedOperationId: vatOp?.id,
    });
  }

  // ==========================================================================
  // 4. Не закрыт затратный счет 20.01 или 26
  // ==========================================================================
  const unclosedCostCodes = ['20.01', '26', '25', '44.01'].filter((code) => {
    const refEnd = refByCode.get(code)?.endDebit ?? 0;
    const diff = rowDiffs[code];
    return Math.abs(refEnd) < 0.01 && diff?.hasMismatch && diff.endDebitDiff >= 0.01;
  });

  // Fallback if user only pasted synthetic "20"
  if (
    unclosedCostCodes.length === 0 &&
    Math.abs(refByCode.get('20')?.endDebit ?? 0) < 0.01 &&
    rowDiffs['20']?.hasMismatch &&
    rowDiffs['20'].endDebitDiff >= 0.01
  ) {
    unclosedCostCodes.push('20');
  }

  if (unclosedCostCodes.length > 0) {
    const totalUnclosed = roundMoney(
      unclosedCostCodes.reduce((s, c) => s + rowDiffs[c].endDebitDiff, 0)
    );
    const affected = [...unclosedCostCodes];
    if (rowDiffs['20']?.hasMismatch && !affected.includes('20')) affected.push('20');
    affected.forEach((a) => explainedAccounts.add(a));

    const closingCostOp =
      operations.find((op) => op.id === 'closing-regl-3-costs') ||
      findBestOperationByPosting(operations, (d) => d === '20.01' || d === '26');

    diagnostics.push({
      id: 'diag-unclosed-cost-accounts',
      severity: 'error',
      accountsAffected: affected,
      diffAmount: totalUnclosed,
      title: `Не закрыт затратный счет ${unclosedCostCodes.join(' / ')} на сумму ${formatMoneyRu(totalUnclosed)}`,
      probableCause: `Счет ${unclosedCostCodes.join(' / ')} не закрылся при закрытии месяца (осталось дебетовое сальдо ${formatMoneyRu(totalUnclosed)}) — проверьте совпадение Номенклатурной группы в расходах и в документе Реализации, а также проведение регламентной операции Закрытие счетов 20, 23, 25, 26.`,
      howToFixIn1C:
        '1) Проверьте, что в документах затрат (Расход материалов, Поступление субподрядных работ, Начисление зарплаты) и в документе «Реализация (акты, УПД)» указана строго одна и та же Номенклатурная группа; 2) Проверьте настройку директ-костинга для счета 26 в Учетной политике; 3) Выполните «Операции → Закрытие месяца → Закрытие счетов 20, 23, 25, 26».',
      relatedOperationId: closingCostOp?.id,
    });
  }

  // Обратная ситуация по 20.01: в эталоне числится НЗП (реализации СМР не было), а у студента 20.01 списан в 0 или отнесен на 26
  const ref2001End = refByCode.get('20.01')?.endDebit ?? 0;
  const diff2001 = rowDiffs['20.01'];
  if (
    ref2001End >= 0.01 &&
    diff2001?.hasMismatch &&
    diff2001.endDebitDiff <= -0.01 &&
    !explainedAccounts.has('20.01')
  ) {
    const wipDiff = roundMoney(Math.abs(diff2001.endDebitDiff));
    const affected = ['20.01'];
    if (rowDiffs['20']?.hasMismatch) affected.push('20');
    affected.forEach((a) => explainedAccounts.add(a));

    const wipOp = findBestOperationByPosting(operations, (d) => d === '20.01');
    diagnostics.push({
      id: 'diag-missing-wip-20',
      severity: 'error',
      accountsAffected: affected,
      diffAmount: wipDiff,
      title: `Занижен остаток НЗП на счете 20.01 на сумму ${formatMoneyRu(wipDiff)}`,
      probableCause: `В эталоне на счете 20.01 числится незавершенное производство (НЗП) ${formatMoneyRu(ref2001End)}, так как сдачи строительно-монтажных работ заказчику в текущем месяце не было. У вас сальдо 20.01 ниже на ${formatMoneyRu(wipDiff)}.`,
      howToFixIn1C:
        'Проверьте документ «Поступление услуг (акт, УПД)» по субподрядным работам: 1) Счет затрат должен быть 20.01 (не 26!); 2) Должна быть выделена отдельная Номенклатурная группа строительного объекта (например, «Ремонт кровли с установкой кирпичной трубы»), отличная от торговой группы реализации товаров, иначе 1С ошибочно спишет СМР под выручку от продажи товаров.',
      relatedOperationId: wipOp?.id,
    });
  }

  // ==========================================================================
  // 5. Штрафы и санкции (91.02 vs 99.02.3 / 99.01.1)
  // ==========================================================================
  const diff9102 = rowDiffs['91.02'];
  const diff99023 = rowDiffs['99.02.3'];

  if (
    (diff9102?.hasMismatch && diff99023?.hasMismatch) ||
    (diff99023?.hasMismatch && Math.abs(diff99023.endDebitDiff || diff99023.turnoverDebitDiff) >= 0.01)
  ) {
    const sanctionDiff = roundMoney(
      Math.max(
        Math.abs(diff99023?.endDebitDiff || 0),
        Math.abs(diff99023?.turnoverDebitDiff || 0),
        Math.abs(diff9102?.endDebitDiff || 0)
      )
    );
    const affected = ['99.02.3'];
    if (diff9102?.hasMismatch) affected.push('91.02');
    affected.forEach((a) => explainedAccounts.add(a));

    const penaltyOp = findBestOperationByPosting(
      operations,
      (d, c) => d === '99.02.3' || c === '76.02' || c === '68.10'
    );

    diagnostics.push({
      id: 'diag-penalty-split-91-99',
      severity: 'error',
      accountsAffected: affected,
      diffAmount: sanctionDiff,
      title: `Расхождение по штрафам и налоговым санкциям (${affected.join(' и ')})`,
      probableCause:
        'Проверьте раздельное отражение договорных неустоек (счет 91.02) и налоговых штрафов ИФНС (счет 99.02.3). Хозяйственные санкции контрагентам включаются в прочие расходы (91.02), а штрафы в бюджет относятся напрямую на счет 99.02.3 и не уменьшают налог на прибыль.',
      howToFixIn1C:
        'Проверьте проводки документа «Операция, введенная вручную» (по исполнительному листу / решению ИФНС): неустойку контрагенту отразите Дт 91.02 Кт 76.02, а налоговые санкции — Дт 99.02.3 Кт 68.10, после чего перезакройте месяц.',
      relatedOperationId: penaltyOp?.id,
    });
  }

  // ==========================================================================
  // 6. Ошибка НДС «сверху» вместо «в том числе» (~20%, ~16.67%, ~22%, ~18.03%)
  //    + Generic detailed per-account diagnostics for any remaining mismatches
  // ==========================================================================
  for (const [code, diff] of Object.entries(rowDiffs)) {
    if (!diff.hasMismatch || explainedAccounts.has(code)) continue;

    const refRow = refByCode.get(code);
    // Skip synthetic group row if at least one of its mismatched child subaccounts is also present in rowDiffs
    if (refRow?.isGroup) {
      const hasMismatchedChildInInput = Object.keys(rowDiffs).some(
        (k) => k.startsWith(`${code}.`) && rowDiffs[k].hasMismatch
      );
      if (hasMismatchedChildInInput) {
        explainedAccounts.add(code);
        continue;
      }
    }

    const primaryDelta =
      Math.abs(diff.endDebitDiff) >= 0.01
        ? diff.endDebitDiff
        : Math.abs(diff.endCreditDiff) >= 0.01
          ? diff.endCreditDiff
          : Math.abs(diff.turnoverDebitDiff) >= 0.01
            ? diff.turnoverDebitDiff
            : diff.turnoverCreditDiff;

    const absDelta = roundMoney(Math.abs(primaryDelta));
    const refBasis = Math.max(
      Math.abs(refRow?.turnoverDebit ?? 0),
      Math.abs(refRow?.turnoverCredit ?? 0),
      Math.abs(refRow?.endDebit ?? 0),
      Math.abs(refRow?.endCredit ?? 0)
    );

    const ratio = refBasis > 0 ? absDelta / refBasis : 0;
    const isVatModeError =
      ['10.01', '19.03', '19.04', '20.01', '26', '41.01', '60.01', '62.01', '90.01.1', '90.03'].includes(
        code
      ) &&
      ((ratio >= 0.194 && ratio <= 0.206) ||
        (ratio >= 0.162 && ratio <= 0.171) ||
        (ratio >= 0.214 && ratio <= 0.226) ||
        (ratio >= 0.176 && ratio <= 0.185));

    const relatedOp = findBestOperationByPosting(
      operations,
      (d, c) =>
        d === code ||
        c === code ||
        d.startsWith(`${code}.`) ||
        c.startsWith(`${code}.`),
      absDelta
    );

    if (isVatModeError) {
      const pctLabel = (ratio * 100).toFixed(2).replace('.', ',');
      explainedAccounts.add(code);
      diagnostics.push({
        id: `diag-vat-mode-${code}`,
        severity: 'warning',
        accountsAffected: [code],
        diffAmount: absDelta,
        title: `Вероятная ошибка настройки «НДС в сумме / НДС сверху» по счету ${code} (${formatMoneyRu(absDelta)})`,
        probableCause: `Разница по счету ${code} составляет ${formatMoneyRu(absDelta)} (~${pctLabel}% от эталона). Такая погрешность возникает, когда в документе 1С выбран режим начисления НДС «Сверху» вместо «НДС в сумме» (или наоборот).`,
        howToFixIn1C:
          'Откройте первичный документ в 1С, нажмите на ссылку «НДС сверху / НДС в сумме» над табличной частью и переключите режим в «НДС в сумме», чтобы итоговая сумма документа совпала с условием задачи.',
        relatedOperationId: relatedOp?.id,
      });
      continue;
    }

    // Generic precise explanation for this account
    const accInfo = getAccountInfo(code);
    const diffDetails: string[] = [];
    if (Math.abs(diff.turnoverDebitDiff) >= 0.01) {
      diffDetails.push(
        `Оборот Дт: отклонение ${diff.turnoverDebitDiff > 0 ? '+' : ''}${formatMoneyRu(diff.turnoverDebitDiff)} (эталон ${formatMoneyRu(refRow?.turnoverDebit ?? 0)})`
      );
    }
    if (Math.abs(diff.turnoverCreditDiff) >= 0.01) {
      diffDetails.push(
        `Оборот Кт: отклонение ${diff.turnoverCreditDiff > 0 ? '+' : ''}${formatMoneyRu(diff.turnoverCreditDiff)} (эталон ${formatMoneyRu(refRow?.turnoverCredit ?? 0)})`
      );
    }
    if (Math.abs(diff.endDebitDiff) >= 0.01) {
      diffDetails.push(
        `Сальдо кон. Дт: отклонение ${diff.endDebitDiff > 0 ? '+' : ''}${formatMoneyRu(diff.endDebitDiff)} (эталон ${formatMoneyRu(refRow?.endDebit ?? 0)})`
      );
    }
    if (Math.abs(diff.endCreditDiff) >= 0.01) {
      diffDetails.push(
        `Сальдо кон. Кт: отклонение ${diff.endCreditDiff > 0 ? '+' : ''}${formatMoneyRu(diff.endCreditDiff)} (эталон ${formatMoneyRu(refRow?.endCredit ?? 0)})`
      );
    }

    const touchingOps = operations
      .filter((op) =>
        op.postings.some(
          (p) =>
            p.debitAccount === code ||
            p.creditAccount === code ||
            p.debitAccount.startsWith(`${code}.`) ||
            p.creditAccount.startsWith(`${code}.`)
        )
      )
      .map((op) => `№${op.number}`);

    const opsHint =
      touchingOps.length > 0 ? ` Связанные операции задачи: ${touchingOps.join(', ')}.` : '';

    explainedAccounts.add(code);
    diagnostics.push({
      id: `diag-account-${code}`,
      severity: 'error',
      accountsAffected: [code],
      diffAmount: absDelta,
      title: `Расхождение по счету ${code} «${accInfo.name}» на ${formatMoneyRu(absDelta)}`,
      probableCause: `${diffDetails.join('; ')}.${opsHint}`,
      howToFixIn1C: `Сформируйте в 1С «Карточку счета ${code}» (двойной клик по строке счета в ОСВ) и сверьте начальный остаток и каждую проводку с разделом «Пошаговый разбор».`,
      relatedOperationId: relatedOp?.id,
    });
  }

  return {
    isPerfectMatch: mismatchedAccountsCount === 0,
    checkedAccountsCount,
    mismatchedAccountsCount,
    rowDiffs,
    diagnostics,
  };
}

function parseRussianNumberCell(raw: string): number | null {
  const cleaned = (raw || '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/[₽рР](?:уб\.?)?/g, '')
    .trim();

  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === '–') {
    return 0;
  }

  // Handle parentheses negative accounting format "(133 200,00)"
  const isParenNegative = /^\(.*\)$/.test(cleaned);
  const unwrapped = isParenNegative ? cleaned.slice(1, -1) : cleaned;
  const normalized = unwrapped.replace(/,/g, '.').replace(/−/g, '-');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }
  return roundMoney(isParenNegative ? -Math.abs(parsed) : parsed);
}

function isLikelyTextNameCell(cell: string): boolean {
  const trimmed = cell.trim();
  if (!trimmed) return false;
  if (parseRussianNumberCell(trimmed) !== null && !/[а-яёa-z]{2,}/i.test(trimmed)) {
    return false;
  }
  return /[а-яёa-z]{2,}/i.test(trimmed);
}

/**
 * Parses TSV / semicolon-CSV / Markdown / space-separated rows copied from Excel or 1C 8.3 ОСВ
 * into `Record<string, UserOsvInputRow>`.
 */
export function parsePastedOsvTable(text: string): Record<string, UserOsvInputRow> {
  const result: Record<string, UserOsvInputRow> = {};
  if (!text || !text.trim()) return result;

  const lines = text.split(/\r?\n/);
  const accountCodeRegex = /^(\d{2}(?:\.\d{1,2})?(?:\.[0-9А-ЯЁA-Z]{1,3})?|000)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip headers & totals
    if (/^(счет|счёт|итого|оборотно-сальдовая|период|показатель)/i.test(line)) {
      continue;
    }

    let cells: string[] = [];
    if (line.includes('\t')) {
      cells = rawLine.split('\t').map((c) => c.trim());
      // Trim trailing completely empty tab columns only if > 8 cols
      while (cells.length > 8 && cells[cells.length - 1] === '') {
        cells.pop();
      }
      if (cells[0] === '' && cells.length > 1) {
        cells.shift();
      }
    } else if (line.includes(';')) {
      cells = line.split(';').map((c) => c.trim());
    } else if (line.includes('|')) {
      cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
    }

    if (cells.length >= 2) {
      const candidateCode = cells[0].replace(/^сч\.?\s*/i, '').trim();
      if (!accountCodeRegex.test(candidateCode)) continue;

      const rest = cells.slice(1);
      // Drop account name column if present right after account code
      const numericCells =
        rest.length > 0 && isLikelyTextNameCell(rest[0]) ? rest.slice(1) : rest;

      const parsedNums = numericCells.map((c) => parseRussianNumberCell(c));
      if (parsedNums.every((v) => v === null)) continue;

      const valAt = (i: number): number => parsedNums[i] ?? 0;

      if (numericCells.length >= 6) {
        // [StartDb, StartCr, TurnDb, TurnCr, EndDb, EndCr]
        result[candidateCode] = {
          accountCode: candidateCode,
          turnoverDebit: valAt(2),
          turnoverCredit: valAt(3),
          endDebit: valAt(4),
          endCredit: valAt(5),
        };
      } else if (numericCells.length >= 4) {
        // [TurnDb, TurnCr, EndDb, EndCr]
        result[candidateCode] = {
          accountCode: candidateCode,
          turnoverDebit: valAt(0),
          turnoverCredit: valAt(1),
          endDebit: valAt(2),
          endCredit: valAt(3),
        };
      } else if (numericCells.length >= 2) {
        // [EndDb, EndCr]
        result[candidateCode] = {
          accountCode: candidateCode,
          endDebit: valAt(0),
          endCredit: valAt(1),
        };
      } else if (numericCells.length === 1 && parsedNums[0] !== null) {
        const info = getAccountInfo(candidateCode);
        result[candidateCode] =
          info.type === 'passive'
            ? { accountCode: candidateCode, endDebit: 0, endCredit: parsedNums[0] }
            : { accountCode: candidateCode, endDebit: parsedNums[0], endCredit: 0 };
      }
      continue;
    }

    // Space-separated fallback (e.g. "60.01 1 236 900,00 1 630 750,00 0,00 573 850,00" or "60.01 0 1416900")
    const leadMatch = /^(\d{2}(?:\.\d{1,2})?(?:\.[0-9А-ЯЁA-Z]{1,3})?|000)\s+(.+)$/i.exec(
      line
    );
    if (!leadMatch) continue;

    const code = leadMatch[1];
    const tail = leadMatch[2].trim();

    const hasDecimalTokens = /\d[.,]\d{2}\b/.test(tail);
    const tokenRegex = hasDecimalTokens
      ? /[−-]?\d{1,3}(?:[\s\u00A0]\d{3})*[.,]\d{2}\b|[−-]?\d+(?:[.,]\d+)?/g
      : /[−-]?\d+(?:[.,]\d+)?/g;

    const matches = tail.match(tokenRegex) || [];
    const nums = matches
      .map((m) => parseRussianNumberCell(m))
      .filter((n): n is number => n !== null);

    if (nums.length >= 6) {
      result[code] = {
        accountCode: code,
        turnoverDebit: nums[2],
        turnoverCredit: nums[3],
        endDebit: nums[4],
        endCredit: nums[5],
      };
    } else if (nums.length >= 4) {
      result[code] = {
        accountCode: code,
        turnoverDebit: nums[0],
        turnoverCredit: nums[1],
        endDebit: nums[2],
        endCredit: nums[3],
      };
    } else if (nums.length >= 2) {
      result[code] = {
        accountCode: code,
        endDebit: nums[0],
        endCredit: nums[1],
      };
    } else if (nums.length === 1) {
      const info = getAccountInfo(code);
      result[code] =
        info.type === 'passive'
          ? { accountCode: code, endDebit: 0, endCredit: nums[0] }
          : { accountCode: code, endDebit: nums[0], endCredit: 0 };
    }
  }

  return result;
}
