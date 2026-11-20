import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  autoFixAllBy1CDb,
  bindAndGenerateOperation,
  calculateOsvReport,
  getOperationCardProfile,
  isInternalWarehouseOrProductionOp,
  recalculateOperationsChronologically,
  runAuditDiagnostics,
} from '../engine';
import {
  generateEducationalInnKpp,
  validateRussianInnChecksum,
} from '../egrul/egrulLookup';
import { buildExportBundle } from '../export1c';
import {
  normalize1CDatabaseExport,
  parseFreeTextOrDelimitedOperations,
  processBatchFiles,
} from '../import1c';

function makeXlsxBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Журнал');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

test('1. НачислениеЗарплаты uses hr_payroll profile (never warehouse!), never flags missing_amount critical_error when ФОТ is empty, and builds 4 RSBU postings', () => {
  const drafts = parseFreeTextOrDelimitedOperations(
    '31.03.2026\tНачислена заработная плата сотрудникам за март',
    'Зарплата_март.xlsx',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 1);

  const op = bindAndGenerateOperation(drafts[0], null, 'op-payroll-empty', {
    priorOperations: [],
    reportingYear: 2026,
  });

  assert.equal(op.category, 'payroll_accrual');
  assert.equal(op.docType1C, 'НачислениеЗарплаты');
  assert.equal(isInternalWarehouseOrProductionOp(op), false);
  assert.equal(getOperationCardProfile(op), 'hr_payroll');

  // Empty salary must be needs_clarification, NEVER critical_error or needsAmount
  assert.notEqual(op.readinessStatus, 'critical_error');
  assert.equal(op.readinessStatus, 'needs_clarification');
  assert.equal(op.needsAmount, undefined);

  // All 4 standard RSBU 2026 postings exist (70, 68.01, 69.09, 69.11)
  assert.equal(op.entries.length, 4);
  assert.equal(op.entries[0].credit, '70');
  assert.equal(op.entries[1].debit, '70');
  assert.equal(op.entries[1].credit, '68.01');
  assert.equal(op.entries[2].credit, '69.09');
  assert.equal(op.entries[3].credit, '69.11');

  // Audit diagnostics must NOT produce missing_amount or empty-entries critical error
  const osv = calculateOsvReport({
    db1C: null,
    operations: [op],
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: [op], osv });
  assert.equal(
    issues.find((i) => i.category === 'missing_amount'),
    undefined
  );
  assert.equal(
    issues.find((i) => i.id.startsWith('empty-entries-')),
    undefined
  );
});

test('2. Chronological HR -> Payroll -> Payout -> Tax payment chain across multiple Excel files pulls salaries automatically', () => {
  const file1Hr = makeXlsxBuffer([
    ['Дата', 'Содержание операции', 'Сумма, руб'],
    ['01.03.2026', 'Принят на работу директор Иванов И.И. с окладом 100 000 руб.', ''],
    ['02.03.2026', 'Принят на работу технолог Петров П.П. с окладом 80 000 руб.', ''],
  ]);

  const file2Payroll = makeXlsxBuffer([
    ['Дата', 'Содержание операции', 'Сумма, руб'],
    ['31.03.2026', 'Начислена заработная плата за март', ''],
    ['05.04.2026', 'Выплачена с расчетного счета заработная плата сотрудникам за март', ''],
    ['28.04.2026', 'Перечислен НДФЛ в бюджет с расчетного счета', ''],
  ]);

  // Intentionally pass file2 first and file1 second to verify cross-file chronological sort!
  const batch = processBatchFiles(
    [
      { name: 'Файл2_Зарплата_и_банк.xlsx', buffer: file2Payroll },
      { name: 'Файл1_Кадры.xlsx', buffer: file1Hr },
    ],
    null,
    { reportingYear: 2026 }
  );

  assert.equal(batch.operations.length, 5);

  // Operations must be sorted chronologically: 01.03, 02.03, 31.03, 05.04, 28.04
  assert.equal(batch.operations[0].date, '2026-03-01');
  assert.equal(batch.operations[0].docType1C, 'ПриемНаРаботу');
  assert.equal(batch.operations[0].category, 'hr_hire');
  assert.equal(batch.operations[0].employeeName, 'Иванов И.И.');
  assert.equal(batch.operations[0].employeePosition, 'директор');
  assert.equal(batch.operations[0].monthlySalary, 100000);

  assert.equal(batch.operations[1].date, '2026-03-02');
  assert.equal(batch.operations[1].docType1C, 'ПриемНаРаботу');
  assert.equal(batch.operations[1].employeeName, 'Петров П.П.');
  assert.equal(batch.operations[1].employeePosition, 'технолог');
  assert.equal(batch.operations[1].monthlySalary, 80000);

  // Also verify 2-column TSV lines without an explicit 3rd amount column parse inline «на сумму 120 000 руб»
  const twoColDrafts = parseFreeTextOrDelimitedOperations(
    [
      '10.03.2026\tПоступили материалы от ООО «Конкурент» на сумму 120 000 руб с НДС 20%, получен УПД',
      '20.03.2026\tРеализована продукция покупателю ООО «СеверСтрой» на сумму 360 000 руб с НДС 20%, выставлен счет-фактура',
    ].join('\n'),
    'Двухколоночный_ТСВ.tsv',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(twoColDrafts.length, 2);
  assert.equal(twoColDrafts[0].amount, 120000);
  assert.equal(twoColDrafts[1].amount, 360000);

  const payrollOp = batch.operations[2];
  assert.equal(payrollOp.docType1C, 'НачислениеЗарплаты');
  assert.equal(payrollOp.readinessStatus, 'ready');
  // Total ФОТ = 100 000 + 80 000 = 180 000 ₽
  assert.equal(payrollOp.amount, 180000);
  assert.ok(payrollOp.calculationProvenance?.includes('Иванов И.И.'));
  assert.ok(payrollOp.calculationProvenance?.includes('180'));

  const e70 = payrollOp.entries.find((e) => e.credit === '70');
  const eNdfl = payrollOp.entries.find((e) => e.debit === '70' && e.credit === '68.01');
  const eIns = payrollOp.entries.find((e) => e.credit === '69.09');
  const eInj = payrollOp.entries.find((e) => e.credit === '69.11');
  assert.equal(e70?.amount, 180000);
  assert.equal(eNdfl?.amount, 23400); // 13% of 180 000
  assert.equal(eIns?.amount, 54000); // 30% of 180 000
  assert.equal(eInj?.amount, 360); // 0.2% of 180 000

  // Payout on 05.04 automatically pulls net payable 180 000 - 23 400 = 156 600 ₽ from Kt 70
  const payoutOp = batch.operations[3];
  assert.equal(payoutOp.category, 'payroll_payout');
  assert.equal(payoutOp.amount, 156600);
  assert.equal(payoutOp.entries[0].debit, '70');
  assert.equal(payoutOp.entries[0].credit, '51');
  assert.equal(payoutOp.entries[0].amount, 156600);

  // Tax payment on 28.04 automatically pulls accrued NDFL 23 400 ₽ from Kt 68.01
  const ndflPayOp = batch.operations[4];
  assert.equal(ndflPayOp.category, 'tax_payment');
  assert.equal(ndflPayOp.amount, 23400);
  assert.equal(ndflPayOp.entries[0].amount, 23400);

  // Recalculation when salary changes updates downstream payroll, payout, and NDFL payment
  const edited = batch.operations.map((op, idx) =>
    idx === 0 ? { ...op, monthlySalary: 120000 } : op
  );
  const recalculated = recalculateOperationsChronologically(edited, null, {
    reportingYear: 2026,
  });
  // New ФОТ = 120 000 + 80 000 = 200 000 ₽ -> NDFL 26 000 ₽ -> Payout 174 000 ₽
  assert.equal(recalculated[2].amount, 200000);
  assert.equal(recalculated[3].amount, 174000);
  assert.equal(recalculated[4].amount, 26000);

  // Export bundle supports ПриемНаРаботу cleanly
  const osvForExport = calculateOsvReport({
    db1C: null,
    operations: recalculated,
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const bundle = buildExportBundle({
    mode: 'incremental',
    db1C: null,
    operations: recalculated,
    osv: osvForExport,
  });
  assert.match(bundle.bslCode, /ПриемНаРаботу/);
  assert.match(bundle.enterpriseDataXml, /Документ\.ПриемНаРаботу/);
});

test('3. Full quarter chain: supplier advance (60.02), OS commissioning (08.04.1 -> 01.01, СПИ 60 мес), sale (90.01.1), autoFixAllBy1CDb + quarter-end closing with 20% profit tax (68.04.1)', () => {
  const journal = makeXlsxBuffer([
    ['Дата', 'Содержание операции', 'Сумма с НДС, руб'],
    [
      '10.02.2026',
      'Перечислен с расчетного счета аванс поставщику ООО "ТехМаш" (ИНН 7810123456, КПП 781001001) за станок',
      240000,
    ],
    [
      '15.02.2026',
      'Поступил станок токарный от ООО "ТехМаш" (ИНН 7810123456, КПП 781001001) с НДС 20%, получен УПД',
      600000,
    ],
    [
      '16.02.2026',
      'Принят к учету и введен в эксплуатацию станок токарный со сроком полезного использования 60 месяцев',
      '',
    ],
    [
      '20.03.2026',
      'Реализована готовая продукция покупателю ООО "СеверСтрой" (ИНН 7811654321, КПП 781101001) с НДС 20%, выставлен счет-фактура',
      960000,
    ],
  ]);

  const batch = processBatchFiles(
    [{ name: 'Курсовая_1кв.xlsx', buffer: journal }],
    null,
    { reportingYear: 2026 }
  );

  assert.equal(batch.operations.length, 4);
  const osAcceptOp = batch.operations[2];
  assert.equal(osAcceptOp.docType1C, 'ПринятиеКУчетуОС');
  assert.equal(getOperationCardProfile(osAcceptOp), 'os_regulatory');
  // Net OS cost without VAT = 600 000 / 1.2 = 500 000 ₽, СПИ = 60 months
  assert.equal(osAcceptOp.amount, 500000);
  assert.equal(osAcceptOp.usefulLifeMonths, 60);

  // Run full chief-accountant autofix (advance offset 60.01/60.02 + month/quarter closing + 20% profit tax)
  const fixed = autoFixAllBy1CDb({
    db1C: null,
    operations: batch.operations,
    calculateCurrentOsv: (ops) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
        reportingYear: 2026,
        sourceMode: 'queued_only',
      }),
    periodEndDate: '2026-03-31',
    reportingYear: 2026,
  });

  const allEntries = fixed.operations.flatMap((o) => o.entries);

  // 1) Advance offset Дт 60.01 Кт 60.02 = 240 000 ₽
  const advOffset = allEntries.find((e) => e.debit === '60.01' && e.credit === '60.02');
  assert.ok(advOffset, 'Expected automatic advance offset 60.01 — 60.02');
  assert.equal(advOffset.amount, 240000);

  // 2) OS depreciation in March (commissioned in Feb -> accrued starting March): 500 000 / 60 = 8 333.33 ₽
  const depEntry = allEntries.find((e) => e.credit === '02.01');
  assert.ok(depEntry, 'Expected linear OS depreciation on 02.01');
  assert.equal(depEntry.amount, 8333.33);

  // 3) Quarter-end closing to 99.01.1 and 20% corporate profit tax Дт 99.01.1 Кт 68.04.1
  const profitTaxEntry = allEntries.find(
    (e) => e.debit === '99.01.1' && e.credit === '68.04.1'
  );
  assert.ok(profitTaxEntry, 'Expected 20% corporate profit tax Дт 99.01.1 Кт 68.04.1');
  // Revenue without VAT = 800 000; expenses = 8 333.33 -> profit = 791 666.67 -> 20% tax = 158 333.33
  assert.equal(profitTaxEntry.amount, 158333.33);

  // 4) Resulting OSV is strictly balanced (Σ Дт = Σ Кт) with zero open 20/26/90 balances
  const osv = calculateOsvReport({
    db1C: null,
    operations: fixed.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  assert.equal(osv.totals.isTurnoverBalanced, true);
  assert.equal(osv.totals.isEndBalanced, true);

  const row20 = osv.rows.find((r) => r.code === '20.01');
  if (row20) {
    assert.equal(row20.endDebit, 0);
    assert.equal(row20.endCredit, 0);
  }
  const row90 = osv.rows.find((r) => r.code === '90');
  assert.ok(row90);
  assert.equal(row90.endDebit, 0);
  assert.equal(row90.endCredit, 0);
});

test('4. Interactive OSV source modes (combined / queued_only / db_only), subconto drilldown, account card running balance, and Smart Auditor Hints', () => {
  const mockDb = normalize1CDatabaseExport(
    {
      Организация: {
        Наименование: 'ООО «УчебныйПолигон»',
        ИНН: '7810000000',
        КПП: '781001001',
      },
      Остатки: [
        { Счет: '51', СуммаОстатокДт: 100000, СуммаОстатокКт: 0, Субконто1: 'Основной р/с' },
        { Счет: '80.09', СуммаОстатокДт: 0, СуммаОстатокКт: 100000, Субконто1: 'Учредитель' },
      ],
      Проводки: [],
    },
    'База_1С.json'
  );

  // Deliberately create operations that trigger auditor hints:
  // - overspend on active 51 (spend 250 000 when opening is 100 000 -> red balance -150 000 on 51)
  // - simultaneous advance 60.02 and debt 60.01 for same supplier without offset
  // - unclosed 26 and 90.01.1
  const drafts = parseFreeTextOrDelimitedOperations(
    [
      '05.03.2026\tПеречислен с расчетного счета аванс поставщику ООО "Альфа" за услуги\t250000',
      '10.03.2026\tАкцептован счет ООО "Альфа" за аренду офиса (общехозяйственные нужды) без НДС\t90000',
      '20.03.2026\tРеализованы услуги покупателю ООО "Бета" без НДС\t300000',
    ].join('\n'),
    'Тест_диагностики_ОСВ.txt',
    mockDb,
    { reportingYear: 2026 }
  );

  const ops = drafts.map((d, i) =>
    bindAndGenerateOperation(d, mockDb, `op-osv-${i}`, {
      priorOperations: [],
      reportingYear: 2026,
    })
  );

  const osvCombined = calculateOsvReport({
    db1C: mockDb,
    operations: ops,
    dateFrom: '2026-03-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    sourceMode: 'combined',
  });
  const osvQueuedOnly = calculateOsvReport({
    db1C: mockDb,
    operations: ops,
    dateFrom: '2026-03-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const osvDbOnly = calculateOsvReport({
    db1C: mockDb,
    operations: ops,
    dateFrom: '2026-03-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    sourceMode: 'db_only',
  });

  // Source modes isolate DB vs queued operations properly
  assert.equal(osvCombined.rows.find((r) => r.code === '51')?.startDebit, 100000);
  assert.equal(osvQueuedOnly.rows.find((r) => r.code === '51')?.startDebit, 0);
  assert.equal(osvDbOnly.rows.find((r) => r.code === '51')?.turnoverCredit, 0);
  assert.equal(osvDbOnly.rows.find((r) => r.code === '80.09')?.endCredit, 100000);

  // Account card movements & subconto breakdown exist for 51
  assert.ok((osvCombined.movementsByAccount?.['51'] ?? []).length >= 1);
  assert.equal(osvCombined.movementsByAccount?.['51']?.[0].operationId, 'op-osv-0');
  assert.ok((osvCombined.subcontoRowsByAccount?.['51'] ?? []).length >= 1);

  // Smart Auditor Hints detect red active balance (51), unoffset advance (60.01 & 60.02), and unclosed 26 / 90
  const hintTypes = new Set((osvCombined.auditorHints ?? []).map((h) => h.checkType));
  assert.equal(hintTypes.has('red_balance'), true);
  assert.equal(hintTypes.has('unoffset_advances'), true);
  assert.equal(hintTypes.has('unclosed_accounts'), true);
});

test('5. FNS modulo-11 INN checksum validator and deterministic educational INN/KPP generator', () => {
  // Official Sberbank INN 7707083893 passes 10-digit FNS modulo-11 check
  assert.equal(validateRussianInnChecksum('7707083893').valid, true);
  // Broken last digit fails with expected check digit reason
  const bad = validateRussianInnChecksum('7707083894');
  assert.equal(bad.valid, false);
  assert.equal(bad.expectedCheckDigits, '3');

  // Educational legal entity INN/KPP is deterministic, starts with 78, and passes FNS checksum
  const eduOrg1 = generateEducationalInnKpp('ООО «Конкурент»', 'ЮридическоеЛицо', '78');
  const eduOrg2 = generateEducationalInnKpp('ООО "Конкурент"', 'ЮридическоеЛицо', '78');
  assert.equal(eduOrg1.inn, eduOrg2.inn);
  assert.equal(eduOrg1.inn.length, 10);
  assert.equal(eduOrg1.inn.startsWith('78'), true);
  assert.equal(eduOrg1.kpp.length, 9);
  assert.equal(eduOrg1.kpp.endsWith('01001'), true);
  assert.equal(validateRussianInnChecksum(eduOrg1.inn).valid, true);

  // Educational entrepreneur (ИП) generates valid 12-digit FNS INN and empty KPP
  const eduIp = generateEducationalInnKpp(
    'ИП Соколов А.В.',
    'ИндивидуальныйПредприниматель',
    '78'
  );
  assert.equal(eduIp.inn.length, 12);
  assert.equal(eduIp.kpp, '');
  assert.equal(validateRussianInnChecksum(eduIp.inn).valid, true);
});
