import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAndValidateOperationIntent,
  RollingAccountingContext1C,
} from '@/types/semanticIntent';
import {
  autoFixAllBy1CDb,
  buildVirtual1CStateTimeline,
  calculateEmployeeMonthlySalaryProRata2026,
  calculateOsvReport,
  getWorkingDaysInMonthRf,
  runAuditDiagnostics,
} from '@/lib/engine';
import { QueuedOperation } from '@/types/accounting';
import {
  processBatchFiles,
  processBatchFilesAsync,
  reparseSingleOperationWithAI,
} from '@/lib/import1c';

function csvToBuffer(csv: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(csv);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const BASE_ROLLING_CTX: RollingAccountingContext1C = {
  ownOrganization: { name: 'ООО «СтройПром»', inn: '7810000000' },
  counterparties: [
    { canonicalName: 'ООО «Стабильность»', inn: '7831820027', kpp: '783101001', roleHint: 'buyer' },
  ],
  employees: [],
  openOrders: [],
  openSettlements: [],
  fixedAssets: [],
  financialBills: [],
  deferredExpenses: [],
  stockItems: [],
};

test('Layer 1 Sanity Guard blocks leaked 10-digit INN from monetary fields and blocks ungrounded counterparties', () => {
  const rawRow = {
    rowIndex: 0,
    date: '2026-03-12',
    description: 'Оплачено поставщику ООО «Стабильность» ИНН 7831820027 по счету № 14',
    rawExcelAmount: 0,
  };

  // Attempt to leak 10-digit INN 7831820027 as monetary orderTotalAmount + hallucinate counterparty "ООО Ромашка-Фантом"
  const maliciousIntent = {
    rowIndex: 0,
    category: 'bank_out',
    docType1C: 'СписаниеСРасчетногоСчета',
    isNonPostingEvent: false,
    counterparty: {
      canonicalName: 'ООО «Ромашка-Фантом»',
      kind: 'legal',
      role: 'supplier',
    },
    amountIntent: {
      mode: 'explicit_column',
      orderTotalAmount: 7831820027,
    },
    vatIntent: {
      rule: 'included',
      rate: 20,
    },
    studentExplanation: 'Оплата поставщику с расчётного счёта.',
  };

  const checked = sanitizeAndValidateOperationIntent(maliciousIntent, rawRow, BASE_ROLLING_CTX);
  assert.equal(checked.ok, true);
  assert.ok(checked.intent);
  assert.equal(
    checked.intent.amountIntent.orderTotalAmount,
    undefined,
    'Sanity Guard must strip 10-digit INN 7831820027 from orderTotalAmount'
  );
  assert.equal(
    checked.intent.counterparty,
    undefined,
    'Sanity Guard must strip hallucinated counterparty absent from text & rollingContext'
  );
  assert.ok(checked.warnings.length >= 2);
});

test('Layer 2 Official 2026 RF Production Calendar & split payroll (20.01 vs 26) calculate exact pro-rata wages', () => {
  assert.equal(getWorkingDaysInMonthRf(2026, 2), 19, 'February 2026 has 19 working days');
  assert.equal(getWorkingDaysInMonthRf(2026, 4), 22, 'April 2026 has 22 working days');
  assert.equal(getWorkingDaysInMonthRf(2026, 5), 19, 'May 2026 has 19 working days');
  assert.equal(getWorkingDaysInMonthRf(2026, 6), 21, 'June 2026 has 21 working days');

  const valeevFeb = calculateEmployeeMonthlySalaryProRata2026({
    monthlySalary: 88400,
    payrollDateIso: '2026-02-28',
    hireDateIso: '2026-02-05',
  });
  assert.equal(valeevFeb.workedDays, 16);
  assert.equal(valeevFeb.totalWorkingDays, 19);
  assert.equal(valeevFeb.accruedSalary, 74442.11);

  const csv = [
    '№;Дата;Содержание операции;Сумма;Последовательность действий',
    '1;25.01.2026;Внесен вклад учредителя на расчетный счет;2000000;',
    '2;26.01.2026;Принят на работу ген.директор Федоров Ф.Ф. с окладом;115000;Зарплата и Кадры = Принять на работу с 01/02.',
    '3;05.02.2026;Принят на работу фрезеровщик Валеев В.В. с окладом;88400;',
    '4;10.02.2026;Рабочий Валеев В.В. направлен на выполнение работ «Бетонное покрытие»;;',
    '5;28.02.2026;Начислена заработная плата сотрудникам за февраль;;',
    '6;05.03.2026;Перечислена заработная плата сотрудникам с расчетного счета;;',
  ].join('\n');

  const res = processBatchFiles([{ name: 'payroll_split.csv', buffer: csvToBuffer(csv) }], null, {
    reportingYear: 2026,
  });

  // Order date of row #2 stays 2026-01-26 while hireStartDate is 2026-02-01
  const hireDir = res.operations.find((o) => /Федоров/u.test(o.description));
  assert.ok(hireDir);
  assert.equal(hireDir.date, '2026-01-26');
  assert.equal(hireDir.employeeHireStartDate, '2026-02-01');

  const accrual = res.operations.find((o) => o.category === 'payroll_accrual');
  assert.ok(accrual, 'Expected payroll_accrual operation');
  assert.equal(accrual.amount, 189442.11, '115 000 (26) + 74 442.11 (20.01) = 189 442.11 ₽');

  const wage26 = accrual.entries.find((e) => e.debit === '26' && e.credit === '70');
  const wage20 = accrual.entries.find((e) => e.debit === '20.01' && e.credit === '70');
  assert.ok(wage26, 'Expected АУП salary on Дт 26 Кт 70');
  assert.ok(wage20, 'Expected worker salary on Дт 20.01 Кт 70');
  assert.equal(wage26.amount, 115000);
  assert.equal(wage20.amount, 74442.11);
  assert.match(
    wage20.debitSubconto,
    /Бетонное покрытие/iu,
    'Expected project nomenclature group «Бетонное покрытие» in debitSubconto on 20.01'
  );

  const ins26 = accrual.entries.find((e) => e.debit === '26' && e.credit === '69.09');
  const ins20 = accrual.entries.find((e) => e.debit === '20.01' && e.credit === '69.09');
  assert.ok(ins26 && ins20, 'Expected social contributions 69.09 split across 26 and 20.01');
  assert.equal(ins26.amount, 34500);
  assert.equal(ins20.amount, 22332.63);

  const payout = res.operations.find((o) => o.category === 'payroll_payout');
  assert.ok(payout);
  const ndfl = accrual.entries.find((e) => e.debit === '70' && e.credit === '68.01');
  assert.ok(ndfl);
  assert.equal(payout.amount, Number((189442.11 - ndfl.amount).toFixed(2)));
});

test('Layer 2 Deferred Expenses (97.21 РБП) register on 97.21 and amortize monthly during ЗакрытиеМесяца', () => {
  const csv = [
    '№;Дата;Содержание операции;Сумма',
    '1;10.03.2026;Внесен уставный капитал на расчетный счет;2000000',
    '2;23.03.2026;Уплачен с р/с вступительный взнос в СРО (расходы будущих периодов, срок списания 12 мес.) ООО «СРО СтройАльянс» ИНН 7810556677;1000000',
    '3;31.03.2026;Закрытие месяца за март;',
  ].join('\n');

  const res = processBatchFiles([{ name: 'rpb_97.csv', buffer: csvToBuffer(csv) }], null, {
    reportingYear: 2026,
  });

  const rpbOp = res.operations.find((o) => o.category === 'deferred_expense_97');
  assert.ok(rpbOp, 'Expected deferred_expense_97 category');
  assert.ok(
    rpbOp.entries.some(
      (e) =>
        e.debit === '97.21' &&
        (e.credit === '76.09' || e.credit === '60.01') &&
        e.amount === 1000000
    ),
    'Expected Дт 97.21 Кт 76.09/60.01 = 1 000 000 ₽'
  );
  assert.ok(
    rpbOp.entries.some(
      (e) =>
        (e.debit === '76.09' || e.debit === '60.01') &&
        e.credit === '51' &&
        e.amount === 1000000
    ),
    'Expected immediate bank payment Дт 76.09/60.01 Кт 51 = 1 000 000 ₽'
  );

  const closingOp = res.operations.find((o) => o.category === 'closing');
  assert.ok(closingOp, 'Expected March ЗакрытиеМесяца');
  const rpbWriteOff = closingOp.entries.find((e) => e.debit === '26' && e.credit === '97.21');
  assert.ok(rpbWriteOff, 'Expected monthly RPB write-off Дт 26 Кт 97.21');
  assert.equal(rpbWriteOff.amount, 83333.33);

  const timeline = buildVirtual1CStateTimeline(null, res.operations);
  const deferredList = timeline.finalState.deferredExpenses ?? [];
  assert.equal(deferredList.length, 1);
  assert.equal(deferredList[0].remainingAmount, 916666.67);
});

test('Layer 2 Work-in-Progress (НЗП on 20.01) closes completed project and preserves unfinished project without unclosed-20 warning', () => {
  const csv = [
    '№;Дата;Содержание операции;Сумма',
    '1;05.05.2026;Внесен вклад на расчетный счет;3000000',
    '2;10.05.2026;Приобретены материалы цемент 100 мешков у ООО «СтройСнаб» ИНН 7707083893 в т.ч. НДС 20%;600000',
    '3;12.05.2026;Переданы материалы цемент 40 мешков в производство на выполнение работ «Бетонное покрытие»;',
    '4;15.05.2026;Переданы материалы цемент 60 мешков в производство на выполнение работ «Ремонт помещений»;',
    '5;25.05.2026;Сданы работы «Бетонное покрытие» заказчику ООО «Альфа» ИНН 7728168971 в т.ч. НДС 20%;960000',
    '6;31.05.2026;Закрытие месяца за май;',
  ].join('\n');

  const res = processBatchFiles([{ name: 'wip_20.csv', buffer: csvToBuffer(csv) }], null, {
    reportingYear: 2026,
  });

  const mayClosing = res.operations.find((o) => o.category === 'closing');
  assert.ok(mayClosing);
  const closed20 = mayClosing.entries.filter((e) => e.debit === '90.02.1' && e.credit === '20.01');
  assert.equal(closed20.length, 1, 'Only completed project «Бетонное покрытие» should close to 90.02.1');
  assert.equal(closed20[0].amount, 200000);

  const osvMay = calculateOsvReport({
    db1C: null,
    operations: res.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-05-31',
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const row20 = osvMay.rows.find((r) => r.code === '20.01');
  assert.ok(row20);
  assert.equal(row20.endDebit, 300000, 'Unfinished project «Ремонт помещений» stays as 300 000 ₽ WIP on 20.01');

  const issues = runAuditDiagnostics({
    db1C: null,
    operations: res.operations,
    osv: osvMay,
  });
  assert.equal(
    issues.some((i) => i.id === 'unclosed-20'),
    false,
    'Open WIP for unfinished project must NOT trigger unclosed-20 warning'
  );
});

test('Layer 2 Profit Tax 20% posts to 99.02.1 and Dec 31 Balance Reformation zeroes all 90.*, 91.*, and 99.* into 84', () => {
  const csv = [
    '№;Дата;Содержание операции;Сумма',
    '1;15.10.2026;Оказаны консультационные услуги заказчику ООО «Вектор» ИНН 7707083893 в т.ч. НДС 20%;1200000',
    '2;20.10.2026;Акцептован счет ООО «ОфисСервис» ИНН 7728168971 за аренду офиса в т.ч. НДС 20%;240000',
  ].join('\n');

  const parsed = processBatchFiles([{ name: 'q4_reform.csv', buffer: csvToBuffer(csv) }], null, {
    reportingYear: 2026,
  });

  const fixed = autoFixAllBy1CDb({
    operations: parsed.operations,
    db1C: null,
    calculateCurrentOsv: (ops: QueuedOperation[]) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        reportingYear: 2026,
        sourceMode: 'queued_only',
      }),
    periodEndDate: '2026-12-31',
    reportingYear: 2026,
  });

  const allEntries = fixed.operations.flatMap((o) => o.entries);
  const taxEntry = allEntries.find((e) => e.debit === '99.02.1' && e.credit === '68.04.1');
  assert.ok(taxEntry, 'Expected Дт 99.02.1 Кт 68.04.1');
  assert.equal(taxEntry.amount, 160000);

  const osvYearEnd = calculateOsvReport({
    db1C: null,
    operations: fixed.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  assert.equal(osvYearEnd.totals.isTurnoverBalanced, true);
  assert.equal(osvYearEnd.totals.isEndBalanced, true);

  for (const prefix of ['90', '91', '99']) {
    for (const r of osvYearEnd.rows.filter(
      (row) => row.code === prefix || row.code.startsWith(`${prefix}.`)
    )) {
      assert.equal(r.endDebit, 0, `Expected 0 endDebit on ${r.code} after Dec 31 reformation`);
      assert.equal(r.endCredit, 0, `Expected 0 endCredit on ${r.code} after Dec 31 reformation`);
    }
  }

  const row84 = osvYearEnd.rows.find((r) => r.code === '84.01');
  assert.ok(row84, 'Expected retained earnings on 84.01');
  assert.equal(row84.endCredit, 640000);
});

test('Hybrid processBatchFilesAsync falls back seamlessly on 503 and applies LLM semantic JSON intents on 200 + single-op AI reparse', async () => {
  const csv = [
    '№;Дата;Содержание операции;Сумма',
    '1;12.04.2026;Перевели по б/н предопл. поставщику ООО «ТехноСталь» ИНН 7707083893 по сч. 77 (в т.ч. НДС 20%);360000',
  ].join('\n');

  // 1) 503 missing key -> seamless fallback to offline parser with 0 dropped rows
  const fallbackRes = await processBatchFilesAsync(
    [{ name: 'messy.csv', buffer: csvToBuffer(csv) }],
    null,
    {
      reportingYear: 2026,
      parserMode: 'ai_json',
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          fallbackToOffline: true,
          error: 'GEMINI_API_KEY not configured',
        }),
      }),
    }
  );
  assert.equal(fallbackRes.usedAiParser, false);
  assert.equal(fallbackRes.aiFallbackTriggered, true);
  assert.equal(fallbackRes.operations.length, 1);
  assert.equal(fallbackRes.operations[0].amount, 360000);

  // 2) 200 valid semantic intent JSON -> applies intent + studentExplanation + math core postings
  const progressCalls: number[] = [];
  const aiRes = await processBatchFilesAsync(
    [{ name: 'messy.csv', buffer: csvToBuffer(csv) }],
    null,
    {
      reportingYear: 2026,
      parserMode: 'ai_json',
      onAiBatchProgress: (p) => progressCalls.push(p.processedRows),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          intents: [
            {
              rowIndex: 0,
              category: 'bank_out',
              docType1C: 'СписаниеСРасчетногоСчета',
              isNonPostingEvent: false,
              counterparty: {
                canonicalName: 'ООО «ТехноСталь»',
                inn: '7707083893',
                kind: 'legal',
                role: 'supplier',
              },
              amountIntent: {
                mode: 'explicit_column',
              },
              vatIntent: {
                rule: 'included',
                rate: 20,
              },
              studentExplanation:
                'Перечислен аванс поставщику с р/с (Дт 60.02 Кт 51) до поступления товаров.',
            },
          ],
        }),
      }),
    }
  );

  assert.equal(aiRes.usedAiParser, true);
  assert.equal(aiRes.aiFallbackTriggered, false);
  assert.deepEqual(progressCalls, [0, 1]);
  assert.equal(aiRes.operations.length, 1);
  assert.equal(aiRes.operations[0].docType1C, 'СписаниеСРасчетногоСчета');
  assert.equal(
    aiRes.operations[0].studentExplanation,
    'Перечислен аванс поставщику с р/с (Дт 60.02 Кт 51) до поступления товаров.'
  );
  assert.ok(
    aiRes.operations[0].entries.some(
      (e) => (e.debit === '60.02' || e.debit === '60.01') && e.credit === '51' && e.amount === 360000
    )
  );

  // 3) Single-operation AI reparse updates operation and preserves ID
  const targetId = aiRes.operations[0].id;
  const reparseRes = await reparseSingleOperationWithAI({
    targetOpId: targetId,
    operations: aiRes.operations,
    db1C: null,
    reportingYear: 2026,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        intents: [
          {
            rowIndex: 0,
            category: 'bank_out',
            docType1C: 'СписаниеСРасчетногоСчета',
            isNonPostingEvent: false,
            counterparty: {
              canonicalName: 'ООО «ТехноСталь»',
              inn: '7707083893',
              kind: 'legal',
              role: 'supplier',
            },
            amountIntent: {
              mode: 'explicit_column',
            },
            vatIntent: {
              rule: 'included',
              rate: 20,
            },
            studentExplanation: 'Уточнено при переразборе ИИ: оплата поставщику ООО «ТехноСталь».',
          },
        ],
      }),
    }),
  });
  assert.equal(reparseRes.ok, true);
  assert.equal(reparseRes.operations[0].id, targetId);
  assert.equal(
    reparseRes.operations[0].studentExplanation,
    'Уточнено при переразборе ИИ: оплата поставщику ООО «ТехноСталь».'
  );
});
