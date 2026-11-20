import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  autoFixAllBy1CDb,
  buildAccompanyingActions1C,
  calculateOsvReport,
  runAuditDiagnostics,
} from '@/lib/engine';
import {
  lookupCounterpartyInEgrul,
  resolveCounterpartyByStrictPriority,
} from '@/lib/egrul/egrulLookup';
import { buildExportBundle } from '@/lib/export1c';
import {
  normalize1CDatabaseExport,
  normalizeOperationDateToReportingYear,
  processBatchFiles,
} from '@/lib/import1c';
import { DEFAULT_REPORTING_YEAR, DEFAULT_SBERBANK_BIK } from '@/types/accounting';

function makeWorkbookArrayBuffer(
  sheetName: string,
  rows: Array<Array<string | number | Date>>,
  merges?: XLSX.Range[]
): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (merges && merges.length > 0) {
    ws['!merges'] = merges;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

function createSample1CDbWithTaxDebtsAnd2024History() {
  return normalize1CDatabaseExport(
    {
      Организация: {
        Наименование: 'ООО «ОкнаПроект»',
        ПолноеНаименование: 'Общество с ограниченной ответственностью «ОкнаПроект»',
        ИНН: '7810554433',
        КПП: '781001001',
        ОГРН: '1157847001122',
        СистемаНалогообложения: 'ОСНО',
      },
      ПериодНачало: '2024-01-01',
      ПериодКонец: '2024-12-31',
      Остатки: [
        { Счет: '51', НачальныйОстатокДт: 3000000, КонечныйОстатокДт: 3000000 },
        { Счет: '68.02', НачальныйОстатокКт: 45000, КонечныйОстатокКт: 45000 },
        { Счет: '69.09', НачальныйОстатокКт: 30000, КонечныйОстатокКт: 30000 },
        { Счет: '80.09', НачальныйОстатокКт: 2925000, КонечныйОстатокКт: 2925000 },
      ],
      Проводки: [
        {
          Дата: '2024-11-15',
          СчетДт: '51',
          СчетКт: '62.01',
          Сумма: 100000,
          Содержание: 'Архивная оплата покупателя за 2024 год',
        },
        {
          Дата: '2024-11-15',
          СчетДт: '62.01',
          СчетКт: '90.01.1',
          Сумма: 100000,
          Содержание: 'Архивная реализация за 2024 год',
        },
      ],
      ВсеСправочники: {
        Склады: [{ Код: '001', Наименование: 'Основной склад' }],
        СтатьиЗатрат: [{ Код: '001', Наименование: 'Аренда помещений' }],
        Контрагенты: [
          {
            Код: '00010',
            Наименование: 'ООО «БизнесЦентр Нева»',
            ИНН: '7842112233',
            КПП: '784201001',
          },
        ],
      },
    },
    '1c_export_2024.json'
  );
}

test('1. Multi-file Excel batch import loses zero rows, computes empty amounts (68/69 & 100% advance), and generates full 4-posting receipt chain', () => {
  const db1C = createSample1CDbWithTaxDebtsAnd2024History();

  // File 1: Header note with Sberbank BIK 044030653, Row 1 tax payment (empty sum), Row 2 100% advance, Row 3 receipt (empty sum)
  const file1 = makeWorkbookArrayBuffer(
    'Апрель_1',
    [
      ['Журнал хозяйственных операций за апрель. Расчёты через р/с в Сбербанке (БИК Сбербанка 044030653)'],
      ['№ п/п', 'Дата', 'Содержание хозяйственной операции', 'Сумма с НДС, руб'],
      [
        1,
        '01.04.2020',
        'Перечислены в бюджет задолженности по налогам и взносам в МИ ФНС №10 по СПб (ИНН 7841000019, КПП 783901001, р/сч 40101810200000010001, БИК 044030001)',
        '',
      ],
      [
        2,
        '02.04.2024',
        'Перечислен 100% аванс ООО "Конкурент" за оконные блоки 133 шт по 9300 руб за шт с НДС 20%',
        '',
      ],
      [
        3,
        '', // empty date cell -> inherits 2026-04-02 from row above!
        'Поступили от ООО "Конкурент" оконные блоки 133 шт, счёт-фактура № 18',
        '',
      ],
    ]
  );

  // File 2: Repeating № 1, 2, merged vertical date cell for two operations on 10 апр
  const file2 = makeWorkbookArrayBuffer(
    'Апрель_2',
    [
      ['№ п/п', 'Дата', 'Содержание хозяйственной операции', 'Сумма с НДС, руб'],
      [
        1,
        '10 апр',
        'Акцептован счёт ООО «БизнесЦентр Нева» за аренду офиса в апреле, в т.ч. НДС 20%, УПД № 45',
        120000,
      ],
      [
        2,
        '',
        'Перечислено с расчётного счёта ООО «БизнесЦентр Нева» за аренду офиса',
        120000,
      ],
    ],
    [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }]
  );

  // File 3: Repeating № 1, 2 including an operation with unknown empty amount (must NOT be dropped, marked needsAmount)
  const file3 = makeWorkbookArrayBuffer('Апрель_3', [
    ['№ п/п', 'Дата', 'Содержание хозяйственной операции', 'Сумма с НДС, руб'],
    [
      1,
      '20.04.2020',
      'Отгружены покупателю ООО "СтройИнвест" оконные блоки 50 шт по 15000 руб с НДС 20%, УПД № 1',
      750000,
    ],
    [
      2,
      '25.04.2024',
      'Отражены прочие консультационные услуги нотариуса (первичный акт ожидается)',
      '',
    ],
  ]);

  const result = processBatchFiles(
    [
      { name: 'task_part1.xlsx', buffer: file1 },
      { name: 'task_part2.xlsx', buffer: file2 },
      { name: 'task_part3.xlsx', buffer: file3 },
    ],
    db1C,
    { reportingYear: DEFAULT_REPORTING_YEAR }
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.completenessStats.filesUploaded, 3);
  assert.equal(result.completenessStats.excelOperationRowsTotal, 7);
  assert.equal(result.completenessStats.importedOperationsCount, 7);
  assert.equal(result.completenessStats.skippedRowsCount, 0);
  assert.equal(result.operations.length, 7);
  assert.equal(result.completenessStats.sheetDefaults.defaultBik, DEFAULT_SBERBANK_BIK);

  // All 7 operations MUST have strict 2026 dates (no 2020 or 2024!)
  for (const op of result.operations) {
    assert.ok(
      op.date.startsWith('2026-04-'),
      `Expected 2026-04-* date, got ${op.date} for ${op.description}`
    );
  }

  // Row 1: Tax payoff computed from 68.02 (45 000) + 69.09 (30 000) = 75 000 ₽ + explicit FNS BIK 044030001
  const op1 = result.operations[0];
  assert.equal(op1.amount, 75000);
  assert.equal(op1.needsAmount, undefined);
  assert.equal(op1.counterpartyInn, '7841000019');
  assert.equal(op1.counterpartyKpp, '783901001');
  assert.equal(op1.counterpartyBankAccount, '40101810200000010001');
  assert.equal(op1.counterpartyBik, '044030001');
  assert.ok(
    op1.entries.some((e) => e.debit === '68.02' && e.credit === '51' && e.amount === 45000)
  );
  assert.ok(
    op1.entries.some((e) => e.debit === '69.09' && e.credit === '51' && e.amount === 30000)
  );

  // Row 2: 100% advance to ООО "Конкурент" -> 133 * 9300 = 1 236 900 ₽, Дт 60.02 Кт 51
  const op2 = result.operations[1];
  assert.equal(op2.amount, 1236900);
  assert.equal(op2.entries.length, 1);
  assert.equal(op2.entries[0].debit, '60.02');
  assert.equal(op2.entries[0].credit, '51');
  assert.equal(op2.entries[0].amount, 1236900);

  // Row 3: Goods receipt from ООО "Конкурент" with empty amount -> inherits date 2026-04-02, amount 1 236 900, and 4 full postings!
  const op3 = result.operations[2];
  assert.equal(op3.date, '2026-04-02');
  assert.equal(op3.amount, 1236900);
  assert.equal(op3.entries.length, 4);
  assert.ok(
    op3.entries.some((e) => e.debit === '41.01' && e.credit === '60.01' && e.amount === 1030750)
  );
  assert.ok(
    op3.entries.some((e) => e.debit === '19.03' && e.credit === '60.01' && e.amount === 206150)
  );
  assert.ok(
    op3.entries.some((e) => e.debit === '60.01' && e.credit === '60.02' && e.amount === 1236900)
  );
  assert.ok(
    op3.entries.some((e) => e.debit === '68.02' && e.credit === '19.03' && e.amount === 206150)
  );

  // Row 7 (File 3 Row 2): Unknown empty amount is kept with needsAmount === true
  const op7 = result.operations[6];
  assert.equal(op7.needsAmount, true);
  assert.equal(op7.amount, 0);
});

test('2. Date normalization strictly converts 2020/2024/serial/Russian dates to 2026 and OSV folds <2026 DB history into opening balance', () => {
  assert.equal(normalizeOperationDateToReportingYear('02.04.2020', 2026), '2026-04-02');
  assert.equal(normalizeOperationDateToReportingYear('2024-05-19', 2026), '2026-05-19');
  assert.equal(normalizeOperationDateToReportingYear('1 апр', 2026), '2026-04-01');
  assert.equal(normalizeOperationDateToReportingYear('15 мая 2020 г.', 2026), '2026-05-15');
  assert.equal(
    normalizeOperationDateToReportingYear(new Date(Date.UTC(2020, 3, 7)), 2026),
    '2026-04-07'
  );
  // Excel serial date 43922 = 2020-04-01
  assert.equal(normalizeOperationDateToReportingYear(43922, 2026), '2026-04-01');

  const db1C = createSample1CDbWithTaxDebtsAnd2024History();
  const osv2026 = calculateOsvReport({
    db1C,
    operations: [],
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  // 2024 postings must NOT appear in 2026 turnovers!
  assert.equal(osv2026.totals.turnoverDebit, 0);
  assert.equal(osv2026.totals.turnoverCredit, 0);
  assert.equal(osv2026.totals.isStartBalanced, true);
  assert.equal(osv2026.totals.isEndBalanced, true);
});

test('3. Accompanying 1C actions & BSL exporter include Sberbank BIK 044030653, explicit counterparty BIK 044030001, and zero 2020/2024 dates', () => {
  const db1C = createSample1CDbWithTaxDebtsAnd2024History();
  const buf = makeWorkbookArrayBuffer('Лист1', [
    ['Банк организации: БИК Сбербанка 044030653'],
    ['№', 'Дата', 'Содержание операции', 'Сумма'],
    [
      1,
      '01.04.2020',
      'Перечислены в бюджет задолженности по налогам и взносам в МИ ФНС №10 по СПб (ИНН 7841000019, КПП 783901001, р/сч 40101810200000010001, БИК 044030001)',
      '',
    ],
  ]);

  const imported = processBatchFiles([{ name: 'ops.xlsx', buffer: buf }], db1C, {
    reportingYear: 2026,
  });
  const actions = buildAccompanyingActions1C(
    imported.operations,
    db1C,
    imported.completenessStats.sheetDefaults.defaultBik,
    imported.completenessStats.sheetDefaults.defaultBankName
  );

  assert.ok(actions.some((a) => a.kind === 'create_bank_account' && a.bik === '044030653'));
  assert.ok(
    actions.some(
      (a) =>
        a.kind === 'create_bank_account' &&
        a.bik === '044030001' &&
        a.accountNumber === '40101810200000010001'
    )
  );

  const osv = calculateOsvReport({
    db1C,
    operations: imported.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  const bundle = buildExportBundle({
    mode: 'clean_db',
    db1C,
    operations: imported.operations,
    osv,
    reportingYear: 2026,
  });

  assert.ok(bundle.bslCode.includes('НайтиИлиСоздатьБанковскийСчет'));
  assert.ok(bundle.bslCode.includes('044030653'));
  assert.ok(bundle.bslCode.includes('044030001'));
  assert.ok(bundle.bslCode.includes('40101810200000010001'));
  assert.ok(!bundle.bslCode.includes('Дата(2020,'));
  assert.ok(!bundle.bslCode.includes('Дата(2024,'));
  assert.ok(bundle.bslCode.includes('Дата(2026, 4, 1'));
});

test('4. Official FNS EGRUL lookup verifies real companies and marks unfound textbook companies as educational_unverified without fake INNs', async () => {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === 'https://egrul.nalog.ru/' && init?.method === 'POST') {
      const bodyStr = String(init.body ?? '');
      const params = new URLSearchParams(bodyStr);
      const q = params.get('query') ?? '';
      const token = q.toLowerCase().includes('комус') ? 'tok-komus' : 'tok-empty';
      return new Response(JSON.stringify({ t: token, captchaRequired: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('tok-komus')) {
      return new Response(
        JSON.stringify({
          rows: [
            {
              k: 'ul',
              n: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "КОМУС"',
              c: 'ООО "КОМУС"',
              i: '7721107079',
              p: '772101001',
              o: '1027700168605',
              a: 'Г. МОСКВА',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // Real company found in EGRUL
  const realLookup = await lookupCounterpartyInEgrul('ООО «Комус»', {
    fetchImpl: mockFetch,
    skipCache: true,
  });
  assert.equal(realLookup.found, true);
  assert.equal(realLookup.candidates[0].inn, '7721107079');
  assert.equal(realLookup.candidates[0].kpp, '772101001');

  const resolvedReal = resolveCounterpartyByStrictPriority({
    name: 'ООО «Комус»',
    db1C: null,
    egrulCandidates: realLookup.candidates,
  });
  assert.equal(resolvedReal.source, 'egrul_verified');
  assert.equal(resolvedReal.inn, '7721107079');
  assert.equal(resolvedReal.kpp, '772101001');

  // Priority 1: Explicit Excel INN overrides everything
  const resolvedExplicit = resolveCounterpartyByStrictPriority({
    name: 'МИ ФНС №10 по СПб',
    explicitInn: '7841000019',
    explicitKpp: '783901001',
    explicitBik: '044030001',
    db1C: null,
  });
  assert.equal(resolvedExplicit.source, 'excel_explicit');
  assert.equal(resolvedExplicit.inn, '7841000019');
  assert.equal(resolvedExplicit.bik, '044030001');

  // Fictional textbook company NOT in EGRUL -> strictly educational_unverified with empty INN
  const eduLookup = await lookupCounterpartyInEgrul('ООО «Конкурент-Учебный-999»', {
    fetchImpl: mockFetch,
    skipCache: true,
  });
  assert.equal(eduLookup.found, false);
  const resolvedEdu = resolveCounterpartyByStrictPriority({
    name: 'ООО «Конкурент-Учебный-999»',
    db1C: null,
    egrulCandidates: eduLookup.candidates,
  });
  assert.equal(resolvedEdu.source, 'educational_unverified');
  assert.equal(resolvedEdu.inn, '');
  assert.equal(resolvedEdu.kpp, '');
});

test('5. Expert 1C 8.3 (BP 3.0) Audit & Auto-Fix generate step-by-step 1C guides and structured Что было -> Что стало -> Основание logs', () => {
  const db1C = createSample1CDbWithTaxDebtsAnd2024History();
  const buf = makeWorkbookArrayBuffer('Лист1', [
    ['№', 'Дата', 'Содержание операции', 'Сумма'],
    [
      1,
      '12.04.2020',
      'Акцептован счёт ООО «БизнесЦентр Нева» за аренду помещения, в т.ч. НДС 20%, УПД № 15',
      120000,
    ],
    [
      2,
      '15.04.2020',
      'Отражена прочая услуга без указания суммы в акте',
      '',
    ],
  ]);

  const imported = processBatchFiles([{ name: 'audit.xlsx', buffer: buf }], db1C, {
    reportingYear: 2026,
  });

  // Intentionally introduce a 2020 date on op[0] to verify Auto-Fix structured change log
  imported.operations[0].date = '2020-04-12';

  const osvBefore = calculateOsvReport({
    db1C,
    operations: imported.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-04-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  const issuesBefore = runAuditDiagnostics({
    db1C,
    operations: imported.operations,
    osv: osvBefore,
  });

  const missingAmountIssue = issuesBefore.find((i) => i.category === 'missing_amount');
  assert.ok(missingAmountIssue, 'Expected missing_amount audit issue for empty-amount row');
  assert.ok(missingAmountIssue.accountingReason);
  assert.ok(missingAmountIssue.guide1C?.menuPath);
  assert.ok(missingAmountIssue.guide1C?.verifyInOsv);

  const fixed = autoFixAllBy1CDb({
    db1C,
    operations: imported.operations,
    calculateCurrentOsv: (ops) =>
      calculateOsvReport({
        db1C,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: '2026-04-30',
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-04-30',
    reportingYear: 2026,
    defaultBik: DEFAULT_SBERBANK_BIK,
  });

  assert.ok(fixed.fixedCount > 0);
  assert.equal(fixed.operations[0].date, '2026-04-12');
  assert.ok(fixed.structuredChanges.length >= 2);
  assert.ok(
    fixed.structuredChanges.some(
      (c) => c.category === 'date_year' && c.whatBecame.includes('2026-04-12')
    )
  );
  assert.ok(
    fixed.structuredChanges.some((c) => c.category === 'closing' && c.whatBecame.includes('26'))
  );
});
