import {
  AuditIssue,
  AuditIssueCategory,
  AuditPostingComparisonRow,
  BusinessOperation,
  ExtractedDirectories1C,
  Full1CAuditReport,
  JournalPosting,
  OrganizationCard,
  OsvReport,
  Synced1CPosting,
  Synced1CSnapshot,
  UserOsvInputRow,
} from '@/types/accounting';
import { checkRequisitesCompleteness } from './requisiteChecker';
import { reconcileUserOsv } from './osvReconciler';
import { formatDateRu, formatMoneyRu, parseDateToSortKey, roundMoney } from './smartLinker';

function normalizeToken(str?: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`.,()]/g, ' ')
    .replace(/\b(ооо|ао|пао|зао|оао|ип)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMonthEndClosing1CPosting(p: Synced1CPosting): boolean {
  const d = p.debitAccount;
  const c = p.creditAccount;
  if (
    d === '90.08.1' ||
    d === '90.09' ||
    d === '91.09' ||
    d === '99.01.1' ||
    d === '99.02.1' ||
    c === '90.09' ||
    c === '91.09' ||
    c === '99.01.1' ||
    c.startsWith('02') ||
    (d.startsWith('90.02') && c.startsWith('20')) ||
    c === '26'
  ) {
    return true;
  }
  // Payroll & contribution accruals on month-end (Кт 70, Кт 69.*, Дт 70 Кт 68.01)
  if (
    c === '70' ||
    (d === '70' && c === '68.01') ||
    ((d === '26' || d.startsWith('20')) && c.startsWith('69'))
  ) {
    return true;
  }
  return false;
}

function extractOperationKeywords(op: BusinessOperation): string[] {
  const keywords = new Set<string>();
  const entityRegex =
    /(?:ООО|АО|ПАО|ЗАО|ОАО)\s*[«"]([^»"]+)[»"]|(МИ\s*ФНС\s*№\s*\d+|ИФНС\s*№\s*\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = entityRegex.exec(op.rawDescription)) !== null) {
    const token = normalizeToken(m[1] || m[2]);
    if (token.length >= 2) keywords.add(token);
  }

  const contractMatch = /(?:договор[ауеом]?|дог\.?)\s*(?:№|n|#)?\s*([0-9a-zа-я/-]+)/i.exec(
    op.rawDescription
  );
  if (contractMatch && contractMatch[1]) {
    keywords.add(contractMatch[1].toLowerCase());
  }

  for (const p of op.postings) {
    if (p.debitSubconto[0]) {
      const t = normalizeToken(p.debitSubconto[0]);
      if (t.length >= 3 && !/^(налог|основн|работник|получен|оплат)/.test(t)) {
        keywords.add(t);
      }
    }
    if (p.creditSubconto[0]) {
      const t = normalizeToken(p.creditSubconto[0]);
      if (t.length >= 3 && !/^(налог|основн|работник|получен|оплат)/.test(t)) {
        keywords.add(t);
      }
    }
  }

  return Array.from(keywords);
}

function scorePostingAgainstOperation(
  p1c: Synced1CPosting,
  op: BusinessOperation,
  opKeywords: string[]
): number {
  let score = 0;

  const opDateKey = parseDateToSortKey(op.date);
  const pDateKey = parseDateToSortKey(p1c.date);
  const dayDiff = Math.abs(opDateKey - pDateKey);

  if (dayDiff === 0) {
    score += 55;
  } else if (dayDiff <= 2) {
    score += 22;
  } else if (dayDiff <= 5) {
    score += 8;
  }

  const haystack = normalizeToken(
    [
      ...(p1c.debitSubconto || []),
      ...(p1c.creditSubconto || []),
      p1c.comment || '',
      p1c.documentType || '',
      p1c.documentNumber || '',
    ].join(' ')
  );

  for (const kw of opKeywords) {
    if (kw && haystack.includes(kw)) {
      score += 65;
      break;
    }
  }

  // Exact or classic-error account pair match
  let bestAccountScore = 0;
  for (const exp of op.postings) {
    if (p1c.debitAccount === exp.debitAccount && p1c.creditAccount === exp.creditAccount) {
      let s = 50;
      if (Math.abs(p1c.amount - exp.amount) < 0.02) s += 35;
      else if (
        exp.amount > 0 &&
        Math.abs(p1c.amount - exp.amount) / exp.amount <= 0.25
      ) {
        s += 15;
      }
      bestAccountScore = Math.max(bestAccountScore, s);
      continue;
    }

    // Known student account-choice errors:
    // 1) Penalty 5 000 ₽ posted to 91.02 instead of 99.02.3 (or vice versa) against 76.02 / 68.10 / 60.01
    if (
      exp.debitAccount === '99.02.3' &&
      p1c.debitAccount === '91.02' &&
      (p1c.creditAccount === exp.creditAccount || p1c.creditAccount.startsWith('76') || p1c.creditAccount.startsWith('60'))
    ) {
      bestAccountScore = Math.max(bestAccountScore, 48);
    }
    // 2) Goods for resale posted to 10.01/10.08 instead of 41.01
    if (
      exp.debitAccount === '41.01' &&
      p1c.debitAccount.startsWith('10') &&
      p1c.creditAccount.startsWith('60')
    ) {
      bestAccountScore = Math.max(bestAccountScore, 48);
    }
    // 3) Production SMR posted to 26 or 44.01 instead of 20.01
    if (
      exp.debitAccount === '20.01' &&
      (p1c.debitAccount === '26' || p1c.debitAccount.startsWith('44')) &&
      p1c.creditAccount.startsWith('60')
    ) {
      bestAccountScore = Math.max(bestAccountScore, 48);
    }
    // 4) Advance 60.02 posted directly to 60.01 (or vice versa) with 51
    if (
      ((exp.debitAccount === '60.02' && p1c.debitAccount === '60.01') ||
        (exp.debitAccount === '60.01' && p1c.debitAccount === '60.02')) &&
      exp.creditAccount === '51' &&
      p1c.creditAccount === '51'
    ) {
      bestAccountScore = Math.max(bestAccountScore, 45);
    }
  }

  score += bestAccountScore;
  return score;
}

function isAdvanceOffsetPosting(p: { debitAccount: string; creditAccount: string }): boolean {
  return (
    (p.debitAccount === '60.01' && p.creditAccount === '60.02') ||
    (p.debitAccount === '62.02' && p.creditAccount === '62.01')
  );
}

function isVatSfDeductionOrAccrualPosting(p: {
  debitAccount: string;
  creditAccount: string;
}): boolean {
  return (
    (p.debitAccount === '68.02' && p.creditAccount.startsWith('19')) ||
    (p.debitAccount === '90.03' && p.creditAccount === '68.02')
  );
}

/**
 * Runs the comprehensive 6-Category 1C Error Auditor («4. Поиск ошибок»):
 * 1) `advance_unoffset` — Незачтенные авансы 60.01/60.02 и 62.01/62.02
 * 2) `missing_sf_upd` — Не зарегистрированы счета-фактуры / УПД (зависший НДС на 19)
 * 3) `incomplete_requisites` — Пустые или неверные реквизиты организации и контрагентов в 1С
 * 4) `unclosed_month` — Не выполнено Закрытие месяца (висят счета 26, 90, 91 / не начислена ЗП)
 * 5) `posting_mismatch` — Расхождения в счетах (91.02 vs 99.02.3, 10.01 vs 41.01, 26 vs 20.01), субконто и суммах
 * 6) `missing_operation` — Пропущенные операции из задания (1..9), отсутствующие в базе 1С
 */
export function runFull1CAudit(
  operations: BusinessOperation[],
  referenceOsv: OsvReport,
  effectiveOrganization: OrganizationCard,
  referenceDirectories: ExtractedDirectories1C,
  synced1C: Synced1CSnapshot | null,
  userOsvInputs: Record<string, UserOsvInputRow>
): Full1CAuditReport {
  const issuesByCategory: Record<AuditIssueCategory, AuditIssue[]> = {
    advance_unoffset: [],
    missing_sf_upd: [],
    incomplete_requisites: [],
    unclosed_month: [],
    posting_mismatch: [],
    missing_operation: [],
  };

  const mainOps = operations.filter((op) => !op.isMonthEndClosing);
  const hasUserOsv = Object.values(userOsvInputs || {}).some(
    (r) =>
      r &&
      (r.turnoverDebit !== null && r.turnoverDebit !== undefined ||
        r.turnoverCredit !== null && r.turnoverCredit !== undefined ||
        r.endDebit !== null && r.endDebit !== undefined ||
        r.endCredit !== null && r.endCredit !== undefined)
  );
  const has1CData = Boolean(synced1C) || hasUserOsv;

  // ============================================================================
  // Category 3: Requisite Completeness («Реквизит-контроль»)
  // ============================================================================
  const requisiteReport = checkRequisitesCompleteness(
    effectiveOrganization,
    referenceDirectories,
    synced1C
  );

  if (synced1C) {
    if (requisiteReport.organizationCheck.status !== 'complete') {
      const orgCheck = requisiteReport.organizationCheck;
      const missingNames = orgCheck.missingFields.map((f) => f.fieldLabel).join(', ');
      issuesByCategory.incomplete_requisites.push({
        id: 'audit-req-org',
        category: 'incomplete_requisites',
        severity: 'warning',
        title: `Не заполнены реквизиты нашей организации «${orgCheck.name}» в 1С (${orgCheck.missingFields.length} из ${orgCheck.totalRequired})`,
        summary: `В карточке организации в 1С не заполнены или отличаются обязательные поля: ${missingNames}. Это приведет к пустым графам в печатных формах УПД, счетов-фактур и платежных поручений.`,
        howToFixIn1C:
          'Откройте в 1С «Главное → Настройки → Организации», заполните недостающие реквизиты, банковский счет и ответственных лиц (Руководитель, Главный бухгалтер) на вкладке «Подписи».',
        missingRequisites: orgCheck.missingFields,
      });
    }

    for (const cpCheck of requisiteReport.counterpartyChecks) {
      if (cpCheck.status === 'complete') continue;
      const isMissingCard = cpCheck.status === 'missing_in_1c';
      const missingNames = cpCheck.missingFields.map((f) => f.fieldLabel).join(', ');

      issuesByCategory.incomplete_requisites.push({
        id: `audit-req-${cpCheck.entityId}`,
        category: 'incomplete_requisites',
        severity: isMissingCard ? 'critical' : 'warning',
        title: isMissingCard
          ? `Контрагент «${cpCheck.name}» отсутствует в справочнике вашей 1С`
          : `Неполные реквизиты контрагента «${cpCheck.name}» в 1С (не заполнено: ${cpCheck.missingFields.length})`,
        summary: isMissingCard
          ? `В выгрузке из 1С не найден контрагент «${cpCheck.name}» (ИНН ${cpCheck.innExpected}).`
          : `Требуется дозаполнение в карточке «${cpCheck.name}»: ${missingNames}.`,
        howToFixIn1C:
          'Перейдите в раздел «Справочники → Контрагенты» в 1С 8.3 и скопируйте эталонные значения ИНН, КПП, р/сч, БИК и договора прямо из карточек ниже кнопкой «Копировать».',
        missingRequisites: cpCheck.missingFields,
      });
    }
  }

  // If no 1C snapshot and no user OSV inputs yet, return clean baseline state
  if (!has1CData) {
    const allBaseline = Object.values(issuesByCategory).flat();
    return {
      has1CData: false,
      totalIssuesCount: allBaseline.length,
      criticalCount: allBaseline.filter((i) => i.severity === 'critical').length,
      warningCount: allBaseline.filter((i) => i.severity === 'warning').length,
      matchedOperationsCount: 0,
      totalOperationsCount: mainOps.length,
      issuesByCategory,
      allIssues: allBaseline,
    };
  }

  // Build effective UserOsvInputs combining synced1C.endBalances and manual userOsvInputs
  const combinedOsvInputs: Record<string, UserOsvInputRow> = { ...userOsvInputs };
  if (synced1C?.endBalances) {
    for (const [accCode, bal] of Object.entries(synced1C.endBalances)) {
      if (!combinedOsvInputs[accCode]) {
        combinedOsvInputs[accCode] = {
          accountCode: accCode,
          endDebit: roundMoney(bal.debit || 0),
          endCredit: roundMoney(bal.credit || 0),
        };
      }
    }
  }

  const aprilPostings = synced1C?.aprilPostings || [];
  const hasPostingsStream = aprilPostings.length > 0;

  // Separate regular postings from month-end closing postings
  const regular1CPostings = aprilPostings.filter((p) => !isMonthEndClosing1CPosting(p));
  const closing1CPostings = aprilPostings.filter((p) => isMonthEndClosing1CPosting(p));

  // ============================================================================
  // Match regular1CPostings to reference mainOps (1..9)
  // ============================================================================
  const opKeywordsMap = new Map<string, string[]>();
  const matchedByOpId = new Map<string, Synced1CPosting[]>();
  for (const op of mainOps) {
    opKeywordsMap.set(op.id, extractOperationKeywords(op));
    matchedByOpId.set(op.id, []);
  }

  for (const p1c of regular1CPostings) {
    let bestOp: BusinessOperation | null = null;
    let bestScore = 0;

    for (const op of mainOps) {
      if (op.postings.length === 0) continue; // Skip HR-only operations with 0 postings
      const score = scorePostingAgainstOperation(
        p1c,
        op,
        opKeywordsMap.get(op.id) || []
      );
      if (score > bestScore) {
        bestScore = score;
        bestOp = op;
      }
    }

    if (bestOp && bestScore >= 40) {
      matchedByOpId.get(bestOp.id)!.push(p1c);
    }
  }

  let matchedOperationsCount = 0;

  // ============================================================================
  // Inspect each reference operation 1..9 for Categories 1, 2, 5, 6
  // ============================================================================
  if (hasPostingsStream) {
    for (const op of mainOps) {
      // Special handling for HR operation with 0 postings (e.g. Op №5 Chief Accountant hiring)
      if (op.postings.length === 0) {
        const hasChiefInOrg =
          Boolean(synced1C?.organization?.chiefAccountantName?.trim()) &&
          !/фио\s+студента/i.test(synced1C?.organization?.chiefAccountantName || '');
        const hasPayrollAccrual = closing1CPostings.some(
          (p) => p.creditAccount === '70' && p.amount > 0
        );
        if (hasChiefInOrg || hasPayrollAccrual || !synced1C?.organization) {
          matchedOperationsCount += 1;
        } else {
          issuesByCategory.missing_operation.push({
            id: `audit-missing-hr-${op.id}`,
            category: 'missing_operation',
            severity: 'warning',
            title: `Не оформлен кадровый прием Главного бухгалтера (Операция №${op.number} от ${formatDateRu(op.date)})`,
            summary: `В базе 1С не назначен Главный бухгалтер и отсутствует начисление оклада ${formatMoneyRu(op.resolvedAmount)} по счету 26.`,
            howToFixIn1C:
              'Создайте документ «Зарплата и кадры → Кадры → Приемы, переводы, увольнения → Прием на работу» от 05.04.2026 с окладом 72 200,00 ₽ (способ отражения: счет 26) и укажите ФИО в «Главное → Организации → Подписи».',
            relatedOperationId: op.id,
            relatedOperationNumber: op.number,
            affectedAccounts: ['26', '70'],
          });
        }
        continue;
      }

      const matchedPostings = matchedByOpId.get(op.id) || [];

      // Category 6: Missing Operation
      if (matchedPostings.length === 0) {
        const affectedAccs = Array.from(
          new Set(op.postings.flatMap((p) => [p.debitAccount, p.creditAccount]))
        );
        const compRows: AuditPostingComparisonRow[] = op.postings.map((exp) => ({
          label: exp.comment || `Операция №${op.number}`,
          in1CDebit: '—',
          in1CCredit: '—',
          in1CSubconto: 'Документ отсутствует в 1С',
          in1CAmount: null,
          expectedDebit: exp.debitAccount,
          expectedCredit: exp.creditAccount,
          expectedSubconto: [...exp.debitSubconto, ...exp.creditSubconto]
            .filter(Boolean)
            .slice(0, 2)
            .join(' / '),
          expectedAmount: exp.amount,
          diffAmount: roundMoney(-exp.amount),
        }));

        issuesByCategory.missing_operation.push({
          id: `audit-missing-op-${op.id}`,
          category: 'missing_operation',
          severity: 'critical',
          title: `Пропущена Операция №${op.number} от ${formatDateRu(op.date)}: ${op.shortTitle || op.documentType1C} (${formatMoneyRu(op.resolvedAmount, { alwaysDecimals: true })})`,
          summary: `В проводках 1С за апрель не найден документ по операции №${op.number}: «${op.rawDescription}».`,
          howToFixIn1C: `Перейдите в меню 1С «${op.menuPath1C.join(' → ')}», создайте и проведите документ «${op.documentType1C}» от ${formatDateRu(op.date)} на сумму ${formatMoneyRu(op.resolvedAmount, { alwaysDecimals: true })}.`,
          relatedOperationId: op.id,
          relatedOperationNumber: op.number,
          affectedAccounts: affectedAccs,
          comparisonRows: compRows,
        });
        continue;
      }

      matchedOperationsCount += 1;

      // Category 1: Unoffset Advance (`Дт 60.01 Кт 60.02` or `Дт 62.02 Кт 62.01`)
      for (const expAdv of op.postings.filter(isAdvanceOffsetPosting)) {
        const actualOffsetSum = roundMoney(
          matchedPostings
            .filter(
              (p) =>
                p.debitAccount === expAdv.debitAccount &&
                p.creditAccount === expAdv.creditAccount
            )
            .reduce((s, p) => s + p.amount, 0)
        );
        const missingAdv = roundMoney(expAdv.amount - actualOffsetSum);
        if (missingAdv >= 0.01) {
          const isSupplier = expAdv.debitAccount === '60.01';
          issuesByCategory.advance_unoffset.push({
            id: `audit-adv-${op.id}`,
            category: 'advance_unoffset',
            severity: 'critical',
            title: `Не зачтен аванс ${isSupplier ? 'поставщику' : 'покупателя'} на сумму ${formatMoneyRu(missingAdv, { alwaysDecimals: true })} (Операция №${op.number})`,
            summary: `В документе «${op.documentType1C}» от ${formatDateRu(op.date)} (${expAdv.debitSubconto[0] || ''}) отсутствует проводка зачета аванса Дт ${expAdv.debitAccount} Кт ${expAdv.creditAccount} на сумму ${formatMoneyRu(missingAdv, { alwaysDecimals: true })}. Из-за этого в ОСВ одновременно зависло развернутое сальдо по счетам ${expAdv.debitAccount} и ${expAdv.creditAccount}!`,
            howToFixIn1C: `1) Откройте документ оплаты (аванса) и документ «${op.documentType1C}» от ${formatDateRu(op.date)} и выберите строго один и тот же элемент справочника «Договоры»; 2) Проверьте реквизит «Зачет авансов: Автоматически»; 3) Убедитесь, что время проведения аванса раньше времени поступления/реализации, и выполните «Операции → Групповое перепроведение документов».`,
            relatedOperationId: op.id,
            relatedOperationNumber: op.number,
            affectedAccounts: [expAdv.debitAccount, expAdv.creditAccount],
            comparisonRows: [
              {
                label: 'Автоматический зачет аванса',
                in1CDebit: actualOffsetSum > 0 ? expAdv.debitAccount : '—',
                in1CCredit: actualOffsetSum > 0 ? expAdv.creditAccount : '—',
                in1CSubconto:
                  actualOffsetSum > 0
                    ? expAdv.debitSubconto.join(' / ')
                    : 'Проводка не сформирована',
                in1CAmount: actualOffsetSum > 0 ? actualOffsetSum : 0,
                expectedDebit: expAdv.debitAccount,
                expectedCredit: expAdv.creditAccount,
                expectedSubconto: expAdv.debitSubconto.join(' / '),
                expectedAmount: expAdv.amount,
                diffAmount: roundMoney(actualOffsetSum - expAdv.amount),
              },
            ],
          });
        }
      }

      // Category 2: Missing Счет-фактура / УПД (`Дт 68.02 Кт 19.*` or `Дт 90.03 Кт 68.02`)
      for (const expSf of op.postings.filter(isVatSfDeductionOrAccrualPosting)) {
        const actualSfSum = roundMoney(
          matchedPostings
            .filter(
              (p) =>
                p.debitAccount === expSf.debitAccount &&
                p.creditAccount === expSf.creditAccount
            )
            .reduce((s, p) => s + p.amount, 0)
        );
        const missingVat = roundMoney(expSf.amount - actualSfSum);
        if (missingVat >= 0.01) {
          const isInputVat = expSf.creditAccount.startsWith('19');
          const cpName =
            expSf.creditSubconto[0] || expSf.debitSubconto[0] || '';
          issuesByCategory.missing_sf_upd.push({
            id: `audit-sf-${op.id}-${expSf.creditAccount}`,
            category: 'missing_sf_upd',
            severity: 'critical',
            title: isInputVat
              ? `Не зарегистрирован счет-фактура / УПД в Операции №${op.number}: завис НДС ${formatMoneyRu(missingVat, { alwaysDecimals: true })} на счете ${expSf.creditAccount}`
              : `Не выписан счет-фактура на реализацию в Операции №${op.number} (${formatMoneyRu(missingVat, { alwaysDecimals: true })})`,
            summary: isInputVat
              ? `В документе «${op.documentType1C}» от ${formatDateRu(op.date)} (${cpName}) отражен входящий НДС на счете ${expSf.creditAccount}, но отсутствует проводка налогового вычета Дт 68.02 Кт ${expSf.creditAccount} на ${formatMoneyRu(missingVat, { alwaysDecimals: true })}.`
              : `В документе реализации от ${formatDateRu(op.date)} не начислен НДС в книгу продаж (Дт 90.03 Кт 68.02 = ${formatMoneyRu(missingVat, { alwaysDecimals: true })}).`,
            howToFixIn1C: isInputVat
              ? `Откройте документ «Поступление» от ${formatDateRu(op.date)} (${cpName}), внизу формы введите номер и дату счета-фактуры и нажмите «Зарегистрировать» (с галочкой «Отразить вычет НДС в книге покупок датой получения») либо включите тумблер «УПД».`
              : `Откройте документ «Реализация» от ${formatDateRu(op.date)} и нажмите кнопку «Выписать счет-фактуру» (или включите тумблер «УПД») внизу формы.`,
            relatedOperationId: op.id,
            relatedOperationNumber: op.number,
            affectedAccounts: [expSf.debitAccount, expSf.creditAccount],
            comparisonRows: [
              {
                label: isInputVat
                  ? `Вычет НДС по счету-фактуре (${cpName})`
                  : 'Начисление НДС с реализации',
                in1CDebit: actualSfSum > 0 ? expSf.debitAccount : '—',
                in1CCredit: actualSfSum > 0 ? expSf.creditAccount : '—',
                in1CSubconto:
                  actualSfSum > 0 ? cpName : 'Счет-фактура не зарегистрирован',
                in1CAmount: actualSfSum > 0 ? actualSfSum : 0,
                expectedDebit: expSf.debitAccount,
                expectedCredit: expSf.creditAccount,
                expectedSubconto: cpName,
                expectedAmount: expSf.amount,
                diffAmount: roundMoney(actualSfSum - expSf.amount),
              },
            ],
          });
        }
      }

      // Category 5: Posting Mismatch (Accounts, Subcontos, Amounts on core postings)
      const coreExpected = op.postings.filter(
        (p) => !isAdvanceOffsetPosting(p) && !isVatSfDeductionOrAccrualPosting(p)
      );
      const coreActualPool = matchedPostings
        .filter(
          (p) => !isAdvanceOffsetPosting(p) && !isVatSfDeductionOrAccrualPosting(p)
        )
        .map((p, idx) => ({ p, used: false, idx }));

      const comparisonRows: AuditPostingComparisonRow[] = [];
      let hasOpPostingMismatch = false;
      const mismatchReasons: string[] = [];

      for (const exp of coreExpected) {
        // 1) Try exact account pair + closest amount
        let candidate = coreActualPool
          .filter(
            (item) =>
              !item.used &&
              item.p.debitAccount === exp.debitAccount &&
              item.p.creditAccount === exp.creditAccount
          )
          .sort(
            (a, b) =>
              Math.abs(a.p.amount - exp.amount) - Math.abs(b.p.amount - exp.amount)
          )[0];

        // 2) Else try same amount + one matching account (catches 91.02 vs 99.02.3, 10.01 vs 41.01, 26 vs 20.01!)
        if (!candidate) {
          candidate = coreActualPool
            .filter(
              (item) =>
                !item.used &&
                (item.p.creditAccount === exp.creditAccount ||
                  item.p.debitAccount === exp.debitAccount ||
                  Math.abs(item.p.amount - exp.amount) < 0.02)
            )
            .sort(
              (a, b) =>
                Math.abs(a.p.amount - exp.amount) - Math.abs(b.p.amount - exp.amount)
            )[0];
        }

        if (candidate) {
          candidate.used = true;
          const act = candidate.p;
          const diffAmt = roundMoney(act.amount - exp.amount);
          const accountDiffer =
            act.debitAccount !== exp.debitAccount ||
            act.creditAccount !== exp.creditAccount;

          // Check Nomenclature Group subconto on 20.01
          const expectedSub0 = exp.debitSubconto[0] || '';
          const actualSub0 = act.debitSubconto[0] || '';
          const subconto20Differ =
            exp.debitAccount === '20.01' &&
            act.debitAccount === '20.01' &&
            expectedSub0 &&
            normalizeToken(actualSub0) !== normalizeToken(expectedSub0) &&
            !normalizeToken(actualSub0).includes(normalizeToken(expectedSub0));

          if (accountDiffer || Math.abs(diffAmt) >= 0.01 || subconto20Differ) {
            hasOpPostingMismatch = true;
            if (accountDiffer) {
              mismatchReasons.push(
                `указана корреспонденция Дт ${act.debitAccount} Кт ${act.creditAccount} вместо Дт ${exp.debitAccount} Кт ${exp.creditAccount} (на сумму ${formatMoneyRu(exp.amount, { alwaysDecimals: true })})`
              );
            } else if (Math.abs(diffAmt) >= 0.01) {
              mismatchReasons.push(
                `по проводке Дт ${exp.debitAccount} Кт ${exp.creditAccount} проведена сумма ${formatMoneyRu(act.amount, { alwaysDecimals: true })} вместо ${formatMoneyRu(exp.amount, { alwaysDecimals: true })} (Δ ${diffAmt > 0 ? '+' : ''}${formatMoneyRu(diffAmt, { alwaysDecimals: true })})`
              );
            } else if (subconto20Differ) {
              mismatchReasons.push(
                `на счете 20.01 неверно заполнена Номенклатурная группа («${actualSub0 || 'пусто'}» вместо «${expectedSub0}»)`
              );
            }
          }

          comparisonRows.push({
            label: exp.comment || `Проводка Дт ${exp.debitAccount} Кт ${exp.creditAccount}`,
            in1CDebit: act.debitAccount,
            in1CCredit: act.creditAccount,
            in1CSubconto:
              [...(act.debitSubconto || []), ...(act.creditSubconto || [])]
                .filter(Boolean)
                .slice(0, 2)
                .join(' / ') || '—',
            in1CAmount: act.amount,
            expectedDebit: exp.debitAccount,
            expectedCredit: exp.creditAccount,
            expectedSubconto:
              [...exp.debitSubconto, ...exp.creditSubconto]
                .filter(Boolean)
                .slice(0, 2)
                .join(' / ') || '—',
            expectedAmount: exp.amount,
            diffAmount: diffAmt,
          });
        } else {
          // Missing specific sub-posting inside a partially posted operation (e.g. merged 3000+5000=8000 onto 91.02 leaving 99.02.3 empty, or forgot payment part of Op 9)
          hasOpPostingMismatch = true;
          mismatchReasons.push(
            `отсутствует проводка Дт ${exp.debitAccount} Кт ${exp.creditAccount} на сумму ${formatMoneyRu(exp.amount, { alwaysDecimals: true })}`
          );
          comparisonRows.push({
            label: exp.comment || `Проводка Дт ${exp.debitAccount} Кт ${exp.creditAccount}`,
            in1CDebit: '—',
            in1CCredit: '—',
            in1CSubconto: 'Отсутствует в 1С',
            in1CAmount: null,
            expectedDebit: exp.debitAccount,
            expectedCredit: exp.creditAccount,
            expectedSubconto:
              [...exp.debitSubconto, ...exp.creditSubconto]
                .filter(Boolean)
                .slice(0, 2)
                .join(' / ') || '—',
            expectedAmount: exp.amount,
            diffAmount: roundMoney(-exp.amount),
          });
        }
      }

      // Check leftover extra postings in 1C (e.g. duplicated bank-to-cash withdrawal!)
      for (const extra of coreActualPool.filter((item) => !item.used)) {
        hasOpPostingMismatch = true;
        mismatchReasons.push(
          `лишняя/задвоенная проводка в 1С Дт ${extra.p.debitAccount} Кт ${extra.p.creditAccount} на сумму ${formatMoneyRu(extra.p.amount, { alwaysDecimals: true })}`
        );
        comparisonRows.push({
          label: extra.p.comment || 'Лишняя проводка в 1С',
          in1CDebit: extra.p.debitAccount,
          in1CCredit: extra.p.creditAccount,
          in1CSubconto: (extra.p.debitSubconto || []).join(' / ') || '—',
          in1CAmount: extra.p.amount,
          expectedDebit: '—',
          expectedCredit: '—',
          expectedSubconto: 'Не требуется',
          expectedAmount: 0,
          diffAmount: roundMoney(extra.p.amount),
        });
      }

      if (hasOpPostingMismatch) {
        const affected = Array.from(
          new Set(
            comparisonRows.flatMap((r) =>
              [r.in1CDebit, r.in1CCredit, r.expectedDebit, r.expectedCredit].filter(
                (a) => a && a !== '—'
              )
            )
          )
        );

        const isPenaltySplitError =
          affected.includes('99.02.3') && affected.includes('91.02');

        issuesByCategory.posting_mismatch.push({
          id: `audit-mismatch-${op.id}`,
          category: 'posting_mismatch',
          severity: 'critical',
          title: isPenaltySplitError
            ? `Ошибка счета учета штрафа в Операции №${op.number}: отражен на 91.02 вместо 99.02.3`
            : `Расхождение в проводках Операции №${op.number} от ${formatDateRu(op.date)} (${op.shortTitle || op.documentType1C})`,
          summary: `При сверке документа в 1С с эталоном выявлено: ${mismatchReasons.join('; ')}.`,
          howToFixIn1C: isPenaltySplitError
            ? 'Откройте документ «Операция, введенная вручную» от 04.04.2026: разделите начисление по исполнительному листу на две строки — неустойку 3 000,00 ₽ оставьте на Дт 91.02 Кт 76.02, а штраф 5 000,00 ₽ перенесите на Дт 99.02.3 Кт 76.02!'
            : `Откройте документ «${op.documentType1C}» от ${formatDateRu(op.date)} в 1С, нажмите кнопку «ДтКт» и исправьте счета учета, субконто или настройку «НДС в сумме» по таблице сравнения ниже.`,
          relatedOperationId: op.id,
          relatedOperationNumber: op.number,
          affectedAccounts: affected,
          comparisonRows,
        });
      }
    }
  } else {
    // Fallback when no `aprilPostings` array was supplied (only OSV balances in `combinedOsvInputs`):
    // Leverage `reconcileUserOsv` so OSV-only syncs still populate `advance_unoffset`, `missing_sf_upd`, and `posting_mismatch`!
    const osvRec = reconcileUserOsv(referenceOsv, combinedOsvInputs, operations);
    for (const diag of osvRec.diagnostics) {
      if (diag.id.includes('advance')) {
        issuesByCategory.advance_unoffset.push({
          id: `audit-osv-${diag.id}`,
          category: 'advance_unoffset',
          severity: 'critical',
          title: diag.title,
          summary: diag.probableCause,
          howToFixIn1C: diag.howToFixIn1C,
          relatedOperationId: diag.relatedOperationId,
          affectedAccounts: diag.accountsAffected,
        });
      } else if (diag.id.includes('vat-19')) {
        issuesByCategory.missing_sf_upd.push({
          id: `audit-osv-${diag.id}`,
          category: 'missing_sf_upd',
          severity: 'critical',
          title: diag.title,
          summary: diag.probableCause,
          howToFixIn1C: diag.howToFixIn1C,
          relatedOperationId: diag.relatedOperationId,
          affectedAccounts: diag.accountsAffected,
        });
      } else if (!diag.id.includes('unclosed-cost')) {
        issuesByCategory.posting_mismatch.push({
          id: `audit-osv-${diag.id}`,
          category: 'posting_mismatch',
          severity: diag.severity === 'error' ? 'critical' : 'warning',
          title: diag.title,
          summary: diag.probableCause,
          howToFixIn1C: diag.howToFixIn1C,
          relatedOperationId: diag.relatedOperationId,
          affectedAccounts: diag.accountsAffected,
        });
      }
    }
  }

  // ============================================================================
  // Category 4: Month-End Closing Check (`unclosed_month`)
  // ============================================================================
  const endBal26 = combinedOsvInputs['26']?.endDebit ?? 0;
  const endBal90 =
    Math.abs(combinedOsvInputs['90']?.endDebit ?? 0) +
    Math.abs(combinedOsvInputs['90']?.endCredit ?? 0);
  const endBal91 =
    Math.abs(combinedOsvInputs['91']?.endDebit ?? 0) +
    Math.abs(combinedOsvInputs['91']?.endCredit ?? 0);

  const hasSalesOrOtherIn1C = regular1CPostings.some(
    (p) => p.creditAccount.startsWith('90.01') || p.debitAccount === '91.02'
  );
  const has90or91ClosingInPostings = closing1CPostings.some(
    (p) =>
      p.debitAccount === '90.09' ||
      p.creditAccount === '90.09' ||
      p.debitAccount === '91.09' ||
      p.creditAccount === '91.09'
  );
  const hasPayrollInPostings = closing1CPostings.some(
    (p) => p.creditAccount === '70' && p.amount > 0
  );

  const isExplicitlyUnclosed = synced1C?.hasMonthEndClosing === false;
  const hasHangingClosingBalances =
    endBal26 >= 0.01 ||
    endBal90 >= 0.01 ||
    endBal91 >= 0.01 ||
    (hasPostingsStream && hasSalesOrOtherIn1C && !has90or91ClosingInPostings);

  if (isExplicitlyUnclosed || hasHangingClosingBalances) {
    const unclosedAccList: string[] = [];
    if (endBal26 >= 0.01 || (hasPostingsStream && !hasPayrollInPostings)) {
      unclosedAccList.push('26');
    }
    if (endBal90 >= 0.01 || (hasPostingsStream && hasSalesOrOtherIn1C && !has90or91ClosingInPostings)) {
      unclosedAccList.push('90');
    }
    if (endBal91 >= 0.01 || (hasPostingsStream && hasSalesOrOtherIn1C && !has90or91ClosingInPostings)) {
      unclosedAccList.push('91');
    }
    if (unclosedAccList.length === 0) {
      unclosedAccList.push('26', '90', '91');
    }

    issuesByCategory.unclosed_month.push({
      id: 'audit-unclosed-month',
      category: 'unclosed_month',
      severity: 'warning',
      title: `Не выполнено регламентное «Закрытие месяца» за апрель (счета ${unclosedAccList.join(', ')})`,
      summary: `На конец апреля в вашей базе 1С не сформированы завершающие регламентные проводки: не закрыты счета ${unclosedAccList.join(', ')}${hasPostingsStream && !hasPayrollInPostings ? ' и не начислена зарплата за апрель по принятому главному бухгалтеру (счет 26 / 70)' : ''}. Важно: счет 26 закрывается в Дт 90.08.1 (Директ-костинг), синтетические счета 90 и 91 сворачиваются в 0,00 ₽ на счет 99.01.1, тогда как счет 20.01 по объекту «Ремонт кровли с установкой кирпичной трубы» (1 960 000,00 ₽) правомерно остается на конец апреля как незавершенное производство (НЗП) до подписания акта с заказчиком!`,
      howToFixIn1C:
        '1) Проведите «Зарплата и кадры → Все начисления → Начисление зарплаты» за Апрель; 2) Перейдите в «Операции → Закрытие периода → Закрытие месяца», выберите Апрель 2026 г., нажмите «Перепровести документы за месяц» и «Выполнить закрытие месяца».',
      affectedAccounts: [...unclosedAccList, '20.01', '99.01.1'],
    });
  }

  const allIssues: AuditIssue[] = [
    ...issuesByCategory.advance_unoffset,
    ...issuesByCategory.missing_sf_upd,
    ...issuesByCategory.posting_mismatch,
    ...issuesByCategory.missing_operation,
    ...issuesByCategory.incomplete_requisites,
    ...issuesByCategory.unclosed_month,
  ];

  return {
    has1CData: true,
    totalIssuesCount: allIssues.length,
    criticalCount: allIssues.filter((i) => i.severity === 'critical').length,
    warningCount: allIssues.filter((i) => i.severity === 'warning').length,
    matchedOperationsCount,
    totalOperationsCount: mainOps.length,
    issuesByCategory,
    allIssues,
  };
}
