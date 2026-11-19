import { getAccountInfo } from '@/data/chartOfAccounts';
import {
  AuditIssue,
  Database1CSnapshot,
  OsvReport,
  QueuedOperation,
} from '@/types/accounting';
import {
  bindAndGenerateOperation,
  normalizeEntityKey,
} from '@/lib/engine/postingEngine';

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function isValidRussianInnFormat(inn: string): boolean {
  const digits = inn.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 12;
}

function canResolveCounterpartyFrom1C(
  op: QueuedOperation,
  db1C: Database1CSnapshot | null
): boolean {
  if (!db1C) return false;
  const norm = normalizeEntityKey(op.counterpartyName);
  if (!norm) return false;

  const inDir = db1C.counterparties.some((c) => {
    const cn = normalizeEntityKey(c.name);
    const fn = normalizeEntityKey(c.fullName ?? '');
    return (
      Boolean(c.inn) &&
      (cn === norm ||
        (cn.length >= 4 && (cn.includes(norm) || norm.includes(cn))) ||
        (fn.length >= 4 && (fn.includes(norm) || norm.includes(fn))))
    );
  });
  if (inDir) return true;

  return db1C.documents.some((d) => {
    const dn = normalizeEntityKey(d.counterparty);
    return Boolean(d.counterpartyInn) && dn.length >= 4 && (dn.includes(norm) || norm.includes(dn));
  });
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
      canAutoFixBy1C: false,
    });
  }

  // 2. Red balances ("краснота") on active / passive accounts
  for (const row of osv.leafRows) {
    if (row.hasRedEnd) {
      const val = row.type === 'active' ? row.endDebit : row.endCredit;
      const isSettlementReclassifiable = row.code === '60.01' || row.code === '62.01' || row.code === '60.02' || row.code === '62.02';
      issues.push({
        id: `red-end-${row.code}`,
        severity: 'error',
        category: 'red_balance',
        accountCode: row.code,
        title: `Отрицательный остаток («краснота») по счёту ${row.code}`,
        description: `Счёт ${row.code} «${row.name}» (${row.type === 'active' ? 'активный' : 'пассивный'}) имеет отрицательное конечное сальдо ${val.toFixed(2)} ₽.`,
        canAutoFixBy1C: isSettlementReclassifiable,
        autoFixActionLabel: isSettlementReclassifiable
          ? 'Переклассифицировать расчёты / авансы (60.01↔60.02, 62.01↔62.02)'
          : undefined,
      });
    }
  }

  // 3. Unoffset advances (одновременный остаток на 60.01 и 60.02 или 62.01 и 62.02)
  const acc6001 = osv.leafRows.find((r) => r.code === '60.01');
  const acc6002 = osv.leafRows.find((r) => r.code === '60.02');
  if (acc6001 && acc6002 && acc6001.endCredit > 0.01 && acc6002.endDebit > 0.01) {
    const offsetAmt = Math.min(acc6001.endCredit, acc6002.endDebit);
    issues.push({
      id: 'unoffset-advance-60',
      severity: 'warning',
      category: 'unoffset_advance',
      accountCode: '60',
      title: 'Незачтённые авансы поставщикам (счета 60.01 и 60.02)',
      description: `Одновременно числится кредиторская задолженность на 60.01 (${acc6001.endCredit.toFixed(2)} ₽) и выданный аванс на 60.02 (${acc6002.endDebit.toFixed(2)} ₽). Возможен зачёт на сумму до ${offsetAmt.toFixed(2)} ₽.`,
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Сформировать зачёт авансов поставщикам (Дт 60.01 Кт 60.02)',
    });
  }

  const acc6201 = osv.leafRows.find((r) => r.code === '62.01');
  const acc6202 = osv.leafRows.find((r) => r.code === '62.02');
  if (acc6201 && acc6202 && acc6201.endDebit > 0.01 && acc6202.endCredit > 0.01) {
    const offsetAmt = Math.min(acc6201.endDebit, acc6202.endCredit);
    issues.push({
      id: 'unoffset-advance-62',
      severity: 'warning',
      category: 'unoffset_advance',
      accountCode: '62',
      title: 'Незачтённые авансы покупателей (счета 62.01 и 62.02)',
      description: `Одновременно числится дебиторская задолженность на 62.01 (${acc6201.endDebit.toFixed(2)} ₽) и полученный аванс на 62.02 (${acc6202.endCredit.toFixed(2)} ₽). Возможен зачёт на сумму до ${offsetAmt.toFixed(2)} ₽.`,
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Сформировать зачёт авансов покупателей (Дт 62.02 Кт 62.01)',
    });
  }

  // Check unaccrued VAT on remaining buyer advances (62.02 > 0 in OSNO without sufficient 76.АВ)
  const isOsno = (db1C?.accountingPolicy.taxSystem ?? 'ОСНО') === 'ОСНО';
  const vatRate = db1C?.accountingPolicy.vatRate ?? 20;
  if (isOsno && vatRate > 0 && acc6202 && acc6202.endCredit > 0.01) {
    const expected76AV = round2((acc6202.endCredit * vatRate) / (100 + vatRate));
    const acc76AV = osv.leafRows.find((r) => r.code === '76.АВ');
    const current76AV = acc76AV?.endDebit ?? 0;
    if (expected76AV - current76AV > 1) {
      issues.push({
        id: 'missing-advance-vat-76av',
        severity: 'warning',
        category: 'unclosed_period',
        accountCode: '76.АВ',
        title: 'Не начислен НДС с полученных авансов покупателей (76.АВ — 68.02)',
        description: `По остатку авансов на счёте 62.02 (${acc6202.endCredit.toFixed(2)} ₽) расчётный НДС ${vatRate}/${100 + vatRate} составляет ${expected76AV.toFixed(2)} ₽ (отражено на 76.АВ: ${current76AV.toFixed(2)} ₽).`,
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Сформировать СФ на аванс (Дт 76.АВ Кт 68.02)',
      });
    }
  }

  // 4. Unclosed month-end accounts (26, 44.01, 90, 91)
  const acc26 = osv.leafRows.find((r) => r.code === '26');
  if (acc26 && acc26.endDebit > 0.01) {
    issues.push({
      id: 'unclosed-26',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '26',
      title: 'Не закрыт счёт 26 «Общехозяйственные расходы»',
      description: `На конец периода на счёте 26 числится остаток ${acc26.endDebit.toFixed(2)} ₽. По РСБУ счёт 26 закрывается ежемесячно.`,
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Закрыть счёт 26 регламентной операцией',
    });
  }

  const acc4401 = osv.leafRows.find((r) => r.code === '44.01');
  if (acc4401 && acc4401.endDebit > 0.01) {
    issues.push({
      id: 'unclosed-44',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '44.01',
      title: 'Не закрыт счёт 44.01 «Издержки обращения»',
      description: `На конец периода на счёте 44.01 числится остаток ${acc4401.endDebit.toFixed(2)} ₽.`,
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Списать расходы на продажу в Дт 90.02.1',
    });
  }

  const group90 = osv.rows.find((r) => r.code === '90' && r.isGroup);
  if (group90 && (group90.endDebit > 0.01 || group90.endCredit > 0.01)) {
    const residual = group90.endCredit > 0 ? group90.endCredit : -group90.endDebit;
    issues.push({
      id: 'unclosed-90',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '90',
      title: 'Не закрыт счёт 90 «Продажи» на финансовый результат (90.09 — 99.01.1)',
      description: `Синтетический счёт 90 имеет ненулевое свёрнутое сальдо на конец периода (${Math.abs(residual).toFixed(2)} ₽).`,
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Сформировать закрытие счёта 90 (90.09 ↔ 99.01.1)',
    });
  }

  const group91 = osv.rows.find((r) => r.code === '91' && r.isGroup);
  if (group91 && (group91.endDebit > 0.01 || group91.endCredit > 0.01)) {
    const residual = group91.endCredit > 0 ? group91.endCredit : -group91.endDebit;
    issues.push({
      id: 'unclosed-91',
      severity: 'warning',
      category: 'unclosed_period',
      accountCode: '91',
      title: 'Не закрыт счёт 91 «Прочие доходы и расходы» (91.09 — 99.01.1)',
      description: `Синтетический счёт 91 имеет ненулевое свёрнутое сальдо на конец периода (${Math.abs(residual).toFixed(2)} ₽).`,
      canAutoFixBy1C: true,
      autoFixActionLabel: 'Сформировать закрытие счёта 91 (91.09 ↔ 99.01.1)',
    });
  }

  // 5. Per-operation requisite & posting checks
  for (const op of operations) {
    if (op.isDuplicateIn1C && op.includeInProcessing) {
      issues.push({
        id: `dup-enabled-${op.id}`,
        severity: 'warning',
        category: 'duplicate_doc',
        operationId: op.id,
        title: `Включён дубликат документа: ${op.description.slice(0, 60)}`,
        description:
          op.duplicateReason ??
          'Операция совпадает с уже проведённым документом в БД 1С и может задвоить обороты.',
        canAutoFixBy1C: true,
        autoFixActionLabel: 'Исключить дубликат из загрузки',
      });
    }
  }

  for (const op of activeOps) {
    if (op.autoGeneratedKind) continue;

    const needsCp = ![
      'closing',
      'payroll_accrual',
      'payroll_payout',
      'bank_fee',
      'tax_payment',
    ].includes(op.category);

    if (needsCp && !op.counterpartyName.trim()) {
      issues.push({
        id: `missing-cp-name-${op.id}`,
        severity: 'error',
        category: 'missing_requisite',
        operationId: op.id,
        title: 'Не указано наименование контрагента',
        description: `Документ «${op.description.slice(0, 70)}» (${op.amount.toFixed(2)} ₽): отсутствует контрагент для привязки субконто.`,
        canAutoFixBy1C: false,
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'counterpartyName',
          label: 'Наименование контрагента',
          placeholder: 'Например: ООО «ТехноСнаб»',
          currentValue: op.counterpartyName,
        },
      });
    } else if (needsCp && !isValidRussianInnFormat(op.counterpartyInn)) {
      const resolvable = canResolveCounterpartyFrom1C(op, db1C);
      issues.push({
        id: `missing-inn-${op.id}`,
        severity: 'error',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не заполнен ИНН контрагента: ${op.counterpartyName}`,
        description: resolvable
          ? `Контрагент найден в базе 1С — ИНН подтянется автоматически кнопкой «Автозаполнить и исправить всё по БД 1С».`
          : `Новый контрагент (${op.counterpartyName}) отсутствует в справочнике 1С. Укажите реальный ИНН (10 или 12 цифр) для создания карточки при экспорте.`,
        canAutoFixBy1C: resolvable,
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'counterpartyInn',
          label: `ИНН контрагента: ${op.counterpartyName}`,
          placeholder: '10 или 12 цифр ИНН',
          currentValue: op.counterpartyInn,
        },
      });
    }

    if (
      needsCp &&
      op.counterpartyName &&
      op.counterpartyKind === 'ЮридическоеЛицо' &&
      isValidRussianInnFormat(op.counterpartyInn) &&
      op.counterpartyInn.replace(/\D/g, '').length === 10 &&
      op.counterpartyKpp.replace(/\D/g, '').length !== 9
    ) {
      const resolvableKpp = Boolean(
        db1C?.counterparties.some(
          (c) =>
            c.kpp.replace(/\D/g, '').length === 9 &&
            (c.inn.replace(/\D/g, '') === op.counterpartyInn.replace(/\D/g, '') ||
              normalizeEntityKey(c.name) === normalizeEntityKey(op.counterpartyName))
        )
      );
      issues.push({
        id: `missing-kpp-${op.id}`,
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не указан КПП юрлица: ${op.counterpartyName}`,
        description:
          'Для корректного формирования книги покупок/продаж и счёта-фактуры в 1С БП 3.0 требуется КПП (9 цифр).',
        canAutoFixBy1C: resolvableKpp,
        inlineTarget: {
          kind: 'operation_field',
          operationId: op.id,
          field: 'counterpartyKpp',
          label: `КПП контрагента: ${op.counterpartyName}`,
          placeholder: '9 цифр КПП',
          currentValue: op.counterpartyKpp,
        },
      });
    }

    if (op.bindings.contract.status === 'missing') {
      issues.push({
        id: `missing-contract-${op.id}`,
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не заполнен договор контрагента (${op.counterpartyName || 'без имени'})`,
        description:
          'Счета 60 и 62 в 1С БП 3.0 ведутся в разрезе субконто «Договоры». Автоисправление подберёт договор из БД 1С или создаст основной договор.',
        canAutoFixBy1C: true,
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
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не указан склад учёта МПЗ (${op.docType1C})`,
        description: 'Для проведения документа движения ТМЦ в 1С БП 3.0 требуется реквизит «Склад».',
        canAutoFixBy1C: true,
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
        severity: 'warning',
        category: 'missing_requisite',
        operationId: op.id,
        title: `Не выбрана статья затрат (${op.description.slice(0, 45)})`,
        description:
          'Для затратных счетов (20, 26, 44) необходимо заполнить аналитику «Статьи затрат».',
        canAutoFixBy1C: true,
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

    if (op.entries.length === 0) {
      issues.push({
        id: `empty-entries-${op.id}`,
        severity: 'error',
        category: 'unbalanced_entry',
        operationId: op.id,
        title: `Отсутствуют проводки у операции «${op.description.slice(0, 50)}»`,
        description: 'Операция включена в расчёт, но список проводок пуст.',
        canAutoFixBy1C: true,
      });
    }

    for (const entry of op.entries) {
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
        // Warn if unknown account not in standard RSBU chart
        const dtInfo = getAccountInfo(entry.debit);
        const ktInfo = getAccountInfo(entry.credit);
        if (dtInfo.isGroup) {
          issues.push({
            id: `group-dt-${entry.id}`,
            severity: 'warning',
            category: 'missing_requisite',
            operationId: op.id,
            accountCode: entry.debit,
            title: `Указан групповой счёт Дт ${entry.debit} вместо субсчёта`,
            description: `В 1С БП 3.0 проводки формируются по конечным субсчетам (например, ${entry.debit}.01 вместо ${entry.debit}).`,
            canAutoFixBy1C: true,
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
            severity: 'warning',
            category: 'missing_requisite',
            operationId: op.id,
            accountCode: entry.credit,
            title: `Указан групповой счёт Кт ${entry.credit} вместо субсчёта`,
            description: `В 1С БП 3.0 проводки формируются по конечным субсчетам (например, ${entry.credit}.01 вместо ${entry.credit}).`,
            canAutoFixBy1C: true,
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

  return issues;
}

const DEFAULT_SUBACCOUNT_MAP: Record<string, string> = {
  '01': '01.01',
  '02': '02.01',
  '08': '08.04',
  '10': '10.01',
  '19': '19.03',
  '20': '20.01',
  '41': '41.01',
  '44': '44.01',
  '50': '50.01',
  '60': '60.01',
  '62': '62.01',
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
}): { newOperations: QueuedOperation[]; log: string[] } {
  const { db1C, operations, osv, periodEndDate } = params;
  const closeDate = periodEndDate || db1C?.periodEnd || new Date().toISOString().slice(0, 10);
  const log: string[] = [];
  const generated: QueuedOperation[] = [];

  // Remove old auto-generated closing/offset ops first by caller if regenerating; here we inspect current osv
  const directCosting = db1C?.accountingPolicy.directCosting26To9008 ?? true;
  const nomGroup =
    db1C?.nomenclatureGroups[0]?.name || 'Основная номенклатурная группа';

  // 1. Advance Offset (Зачёт авансов 60.01—60.02 and 62.02—62.01)
  const acc6001 = osv.leafRows.find((r) => r.code === '60.01');
  const acc6002 = osv.leafRows.find((r) => r.code === '60.02');
  const offset60 =
    acc6001 && acc6002 ? round2(Math.min(acc6001.endCredit, acc6002.endDebit)) : 0;

  const acc6201 = osv.leafRows.find((r) => r.code === '62.01');
  const acc6202 = osv.leafRows.find((r) => r.code === '62.02');
  const offset62 =
    acc6201 && acc6202 ? round2(Math.min(acc6201.endDebit, acc6202.endCredit)) : 0;

  if (offset60 > 0.01 || offset62 > 0.01) {
    const entries = [];
    if (offset60 > 0.01) {
      entries.push({
        id: `auto-offset-60-${Date.now()}`,
        debit: '60.01',
        credit: '60.02',
        debitSubconto: 'Контрагенты (поставщики)',
        creditSubconto: 'Контрагенты (поставщики)',
        amount: offset60,
        description: 'Зачёт ранее выданного аванса поставщикам',
      });
      log.push(`Сформирован зачёт авансов поставщикам Дт 60.01 Кт 60.02 на ${offset60.toFixed(2)} ₽`);
    }
    if (offset62 > 0.01) {
      entries.push({
        id: `auto-offset-62-${Date.now()}`,
        debit: '62.02',
        credit: '62.01',
        debitSubconto: 'Контрагенты (покупатели)',
        creditSubconto: 'Контрагенты (покупатели)',
        amount: offset62,
        description: 'Зачёт ранее полученного аванса от покупателей',
      });
      log.push(`Сформирован зачёт авансов покупателей Дт 62.02 Кт 62.01 на ${offset62.toFixed(2)} ₽`);
    }

    generated.push({
      id: `op-auto-offset-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sourceFileName: 'Автоисправление 1С',
      date: closeDate,
      docNumber: 'АВТ-ЗАЧЕТ',
      description: 'Автоматический зачёт взаимных расчётов и авансов (60 / 62)',
      category: 'advance_offset',
      docType1C: 'КорректировкаДолга',
      amount: round2(offset60 + offset62),
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
    });
  }

  // 2. Advance VAT on remaining 62.02 balance (after offset62!)
  const isOsno = (db1C?.accountingPolicy.taxSystem ?? 'ОСНО') === 'ОСНО';
  const vatRate = db1C?.accountingPolicy.vatRate ?? 20;
  const remaining6202 = round2((acc6202?.endCredit ?? 0) - offset62);
  if (isOsno && vatRate > 0 && remaining6202 > 0.01) {
    const expected76AV = round2((remaining6202 * vatRate) / (100 + vatRate));
    const current76AV = osv.leafRows.find((r) => r.code === '76.АВ')?.endDebit ?? 0;
    const deltaVat = round2(expected76AV - current76AV);
    if (deltaVat > 1) {
      // Find buyer counterparty from 62.02 operations if available
      const advOp = operations.find((o) =>
        o.entries.some((e) => e.credit === '62.02')
      );
      const cpName = advOp?.counterpartyName ?? 'Покупатели по авансам';
      generated.push({
        id: `op-auto-76av-${Date.now()}`,
        createdAt: new Date().toISOString(),
        sourceFileName: 'Автоисправление 1С',
        date: closeDate,
        docNumber: 'АВТ-СФА',
        description: `Регистрация счёта-фактуры на полученный аванс (НДС ${vatRate}/${100 + vatRate})`,
        category: 'advance_vat',
        docType1C: 'СчетФактураВыданный',
        amount: deltaVat,
        vatRate,
        vatRule: 'none',
        vatAmount: deltaVat,
        hasInvoiceSF: true,
        counterpartyName: cpName,
        counterpartyInn: advOp?.counterpartyInn ?? '',
        counterpartyKpp: advOp?.counterpartyKpp ?? '',
        counterpartyKind: 'ЮридическоеЛицо',
        contractName: advOp?.contractName ?? '',
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
            id: `e-76av-${Date.now()}`,
            debit: '76.АВ',
            credit: '68.02',
            debitSubconto: cpName,
            creditSubconto: 'Налог (взносы): начислено / уплачено',
            amount: deltaVat,
            description: 'Начислен НДС с полученных авансов покупателей',
          },
        ],
      });
      log.push(`Начислен НДС с авансов покупателей Дт 76.АВ Кт 68.02 на ${deltaVat.toFixed(2)} ₽`);
    }
  }

  // 3. Closing 26, 44.01, 90, 91
  const closingEntries = [];
  let addedTo9008 = 0;
  let addedTo9002 = 0;

  const acc26 = osv.leafRows.find((r) => r.code === '26');
  if (acc26 && acc26.endDebit > 0.01) {
    const targetDt = directCosting ? '90.08.1' : '20.01';
    closingEntries.push({
      id: `close-26-${Date.now()}`,
      debit: targetDt,
      credit: '26',
      debitSubconto: nomGroup,
      creditSubconto: 'Общехозяйственные расходы',
      amount: acc26.endDebit,
      description: directCosting
        ? 'Закрытие счёта 26 «Директ-костинг» в Дт 90.08.1'
        : 'Закрытие счёта 26 в основное производство (20.01)',
    });
    if (directCosting) addedTo9008 = acc26.endDebit;
    log.push(`Закрыт счёт 26 в Дт ${targetDt} на сумму ${acc26.endDebit.toFixed(2)} ₽`);
  }

  const acc4401 = osv.leafRows.find((r) => r.code === '44.01');
  if (acc4401 && acc4401.endDebit > 0.01) {
    closingEntries.push({
      id: `close-44-${Date.now()}`,
      debit: '90.02.1',
      credit: '44.01',
      debitSubconto: nomGroup,
      creditSubconto: 'Издержки обращения',
      amount: acc4401.endDebit,
      description: 'Списание расходов на продажу (44.01)',
    });
    addedTo9002 = acc4401.endDebit;
    log.push(`Закрыт счёт 44.01 в Дт 90.02.1 на сумму ${acc4401.endDebit.toFixed(2)} ₽`);
  }

  // Net residual on 90 after closing 26 and 44.01
  const children90 = osv.leafRows.filter((r) => r.code.startsWith('90.'));
  const currentNet90DebitMinusCredit = round2(
    children90.reduce((s, r) => s + (r.endDebit - r.endCredit), 0) + addedTo9008 + addedTo9002
  );
  // Note: if Credit > Debit, currentNet90DebitMinusCredit < 0 -> Profit! Close via Дт 90.09 Кт 99.01.1
  if (Math.abs(currentNet90DebitMinusCredit) > 0.01) {
    if (currentNet90DebitMinusCredit < 0) {
      const profit90 = round2(-currentNet90DebitMinusCredit);
      closingEntries.push({
        id: `close-90-profit-${Date.now()}`,
        debit: '90.09',
        credit: '99.01.1',
        debitSubconto: nomGroup,
        creditSubconto: 'Прибыль (убыток) от продаж',
        amount: profit90,
        description: 'Определён финансовый результат (прибыль от продаж) за период',
      });
      log.push(`Закрыт счёт 90 (прибыль от продаж): Дт 90.09 Кт 99.01.1 на ${profit90.toFixed(2)} ₽`);
    } else {
      const loss90 = round2(currentNet90DebitMinusCredit);
      closingEntries.push({
        id: `close-90-loss-${Date.now()}`,
        debit: '99.01.1',
        credit: '90.09',
        debitSubconto: 'Прибыль (убыток) от продаж',
        creditSubconto: nomGroup,
        amount: loss90,
        description: 'Определён финансовый результат (убыток от продаж) за период',
      });
      log.push(`Закрыт счёт 90 (убыток от продаж): Дт 99.01.1 Кт 90.09 на ${loss90.toFixed(2)} ₽`);
    }
  }

  // Net residual on 91
  const children91 = osv.leafRows.filter((r) => r.code.startsWith('91.'));
  const net91DebitMinusCredit = round2(
    children91.reduce((s, r) => s + (r.endDebit - r.endCredit), 0)
  );
  if (Math.abs(net91DebitMinusCredit) > 0.01) {
    if (net91DebitMinusCredit < 0) {
      const profit91 = round2(-net91DebitMinusCredit);
      closingEntries.push({
        id: `close-91-profit-${Date.now()}`,
        debit: '91.09',
        credit: '99.01.1',
        debitSubconto: '',
        creditSubconto: 'Прочие доходы и расходы',
        amount: profit91,
        description: 'Закрытие счёта 91 (превышение прочих доходов над расходами)',
      });
      log.push(`Закрыт счёт 91 (прибыль): Дт 91.09 Кт 99.01.1 на ${profit91.toFixed(2)} ₽`);
    } else {
      const loss91 = round2(net91DebitMinusCredit);
      closingEntries.push({
        id: `close-91-loss-${Date.now()}`,
        debit: '99.01.1',
        credit: '91.09',
        debitSubconto: 'Прочие доходы и расходы',
        creditSubconto: '',
        amount: loss91,
        description: 'Закрытие счёта 91 (превышение прочих расходов над доходами)',
      });
      log.push(`Закрыт счёт 91 (сальдо прочих расходов): Дт 99.01.1 Кт 91.09 на ${loss91.toFixed(2)} ₽`);
    }
  }

  if (closingEntries.length > 0) {
    const totalCloseAmt = round2(closingEntries.reduce((s, e) => s + e.amount, 0));
    generated.push({
      id: `op-auto-close-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sourceFileName: 'Регламентная операция 1С',
      date: closeDate,
      docNumber: 'РЕГЛ-ЗАКР',
      description: 'Регламентное закрытие счетов затрат и финансовых результатов (26, 90, 91)',
      category: 'closing',
      docType1C: 'ЗакрытиеМесяца',
      amount: totalCloseAmt,
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
    });
  }

  return { newOperations: generated, log };
}

export function autoFixAllBy1CDb(params: {
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  calculateCurrentOsv: (ops: QueuedOperation[]) => OsvReport;
  periodEndDate: string;
}): {
  operations: QueuedOperation[];
  fixedCount: number;
  log: string[];
} {
  const { db1C, operations, calculateCurrentOsv, periodEndDate } = params;
  let fixedCount = 0;
  const log: string[] = [];

  // Remove stale auto-generated ops before recalculating fresh ones
  const manualAndImportedOps = operations.filter((op) => !op.autoGeneratedKind);

  const enrichedOps: QueuedOperation[] = manualAndImportedOps.map((origOp) => {
    let op = { ...origOp, bindings: { ...origOp.bindings }, entries: origOp.entries.map((e) => ({ ...e })) };

    // 1. Disable accidental duplicates if enabled
    if (op.isDuplicateIn1C && op.includeInProcessing) {
      op.includeInProcessing = false;
      fixedCount++;
      log.push(`Исключён из расчёта дубликат документа: «${op.description.slice(0, 50)}»`);
    }

    if (!op.includeInProcessing) return op;

    // 2. Fuzzy match Counterparty in db1C.counterparties and db1C.documents
    if (op.counterpartyName && db1C) {
      const norm = normalizeEntityKey(op.counterpartyName);
      if (norm.length >= 3) {
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
          op.bindings.counterparty = {
            status: 'matched_1c',
            matchedName: matchedCp.name,
            matchedCode1C: matchedCp.code1C,
            matchedInn: matchedCp.inn,
          };
          if (changed) {
            fixedCount++;
            log.push(`Подтянуты реквизиты из справочника 1С для контрагента «${matchedCp.name}»`);
          }
        } else {
          // Check ВсеДокументы history
          const histDoc = db1C.documents.find((d) => {
            const dn = normalizeEntityKey(d.counterparty);
            return dn.length >= 4 && (dn.includes(norm) || norm.includes(dn));
          });
          if (histDoc) {
            if (!op.counterpartyInn && histDoc.counterpartyInn) {
              op.counterpartyInn = histDoc.counterpartyInn;
              fixedCount++;
              log.push(`Подтянут ИНН из журнала документов 1С для «${histDoc.counterparty}»`);
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

    // 3. Fill missing contract by 1C contracts, historical docs, or default contract
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
        log.push(`Подобран договор 1С «${fromDir.name}» для «${op.counterpartyName}»`);
      } else if (fromDocs?.contract) {
        op.contractName = fromDocs.contract;
        op.bindings.contract = {
          status: 'matched_1c',
          matchedName: fromDocs.contract,
        };
        fixedCount++;
        log.push(`Подобран договор из истории документов 1С: «${fromDocs.contract}»`);
      } else if (op.counterpartyName) {
        op.contractName = 'Основной договор';
        op.bindings.contract = {
          status: 'new_for_1c',
          note: 'Типовой договор будет создан при экспорте в 1С',
        };
        fixedCount++;
        log.push(`Назначен «Основной договор» для контрагента «${op.counterpartyName}»`);
      }
    }

    // 4. Fill missing warehouse from 1C warehouses or historical receipts
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
        log.push(`Проставлен склад из БД 1С: «${whFromDb}»`);
      } else {
        op.warehouseName = 'Основной склад';
        op.bindings.warehouse = {
          status: 'new_for_1c',
          note: 'Склад будет создан при экспорте в 1С',
        };
        fixedCount++;
      }
    }

    // 5. Fill missing expense item from 1C expenseItems or historical postings
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
        log.push(`Подобрана статья затрат по аналогии с проводками 1С: «${histExpName}»`);
      } else if (fallbackExp) {
        op.expenseItemName = fallbackExp;
        op.bindings.expenseItem = {
          status: 'matched_1c',
          matchedName: fallbackExp,
          matchedCode1C: db1C?.expenseItems[0]?.code1C,
        };
        fixedCount++;
      } else {
        op.expenseItemName = 'Прочие общехозяйственные расходы';
        op.bindings.expenseItem = {
          status: 'new_for_1c',
          note: 'Статья затрат будет создана при экспорте',
        };
        fixedCount++;
      }
    }

    // 6. Regenerate entries if empty, or fix group accounts -> subaccounts & update subconto strings
    if (op.entries.length === 0) {
      op = bindAndGenerateOperation(
        {
          sourceFileName: op.sourceFileName,
          date: op.date,
          docNumber: op.docNumber,
          description: op.description,
          amount: op.amount,
          vatRate: op.vatRate,
          vatRule: op.vatRule,
          vatAmount: op.vatAmount,
          hasInvoiceSF: op.hasInvoiceSF,
          counterpartyName: op.counterpartyName,
          counterpartyInn: op.counterpartyInn,
          counterpartyKpp: op.counterpartyKpp,
          contractName: op.contractName,
          nomenclatureName: op.nomenclatureName,
          warehouseName: op.warehouseName,
          expenseItemName: op.expenseItemName,
          cashFlowItemName: op.cashFlowItemName,
          docTypeHint: op.docType1C,
          categoryHint: op.category,
        },
        db1C,
        op.id
      );
      fixedCount++;
    } else {
      const cpSub = [op.counterpartyName, op.contractName].filter(Boolean).join(' / ');
      op.entries = op.entries.map((entry) => {
        let dt = entry.debit;
        let kt = entry.credit;
        if (DEFAULT_SUBACCOUNT_MAP[dt]) {
          dt = DEFAULT_SUBACCOUNT_MAP[dt];
          fixedCount++;
        }
        if (DEFAULT_SUBACCOUNT_MAP[kt]) {
          kt = DEFAULT_SUBACCOUNT_MAP[kt];
          fixedCount++;
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
                ? op.expenseItemName
                : ''),
          creditSubconto:
            entry.creditSubconto ||
            (kt.startsWith('60') || kt.startsWith('62') ? cpSub : ''),
        };
      });
    }

    return op;
  });

  // 7. Check if 60.01 or 62.01 has red balance because payment was posted to 60.01/62.01 instead of 60.02/62.02
  let intermediateOsv = calculateCurrentOsv(enrichedOps);
  const row6001 = intermediateOsv.leafRows.find((r) => r.code === '60.01');
  if (row6001 && row6001.hasRedEnd) {
    for (const op of enrichedOps) {
      if (op.category === 'bank_out') {
        for (const e of op.entries) {
          if (e.debit === '60.01' && e.credit === '51') {
            e.debit = '60.02';
            e.description = 'Перечислен аванс поставщику (переклассифицировано с 60.01)';
            fixedCount++;
            log.push(`Устранена краснота по 60.01: оплата «${op.counterpartyName}» перенесена на счёт авансов 60.02`);
          }
        }
      }
    }
    intermediateOsv = calculateCurrentOsv(enrichedOps);
  }

  const row6201 = intermediateOsv.leafRows.find((r) => r.code === '62.01');
  if (row6201 && row6201.hasRedEnd) {
    for (const op of enrichedOps) {
      if (op.category === 'bank_in') {
        for (const e of op.entries) {
          if (e.debit === '51' && e.credit === '62.01') {
            e.credit = '62.02';
            e.description = 'Получен аванс от покупателя (переклассифицировано с 62.01)';
            fixedCount++;
            log.push(`Устранена краснота по 62.01: оплата от «${op.counterpartyName}» перенесена на счёт авансов 62.02`);
          }
        }
      }
    }
    intermediateOsv = calculateCurrentOsv(enrichedOps);
  }

  // 8. Generate advance offsets, advance VAT, and period closing operations
  const { newOperations, log: closeLog } = generatePeriodClosingOperations({
    db1C,
    operations: enrichedOps,
    osv: intermediateOsv,
    periodEndDate,
  });

  if (newOperations.length > 0) {
    fixedCount += newOperations.length;
    log.push(...closeLog);
  }

  return {
    operations: [...enrichedOps, ...newOperations],
    fixedCount,
    log,
  };
}
