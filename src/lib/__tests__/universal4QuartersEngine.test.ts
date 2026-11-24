import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { processBatchFiles } from '../import1c/batchFileParser';
import { autoFixAllBy1CDb, runAuditDiagnostics } from '../engine/auditAndAutofix';
import { calculateOsvReport } from '../engine/osvCalculator';
import {
  bindAndGenerateOperation,
  BatchSequentialContext,
  RawDraftOperationInput,
  recalculateOperationsChronologically,
} from '../engine/postingEngine';
import {
  sanitizeAndValidateOperationIntent,
  RollingAccountingContext1C,
} from '../../types/semanticIntent';
import { applyParsedIntentToDraft } from '../engine/semanticIntentAdapter';
import { QueuedOperation } from '../../types/accounting';

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function loadCourseworkBatchInput() {
  const specs = [
    { name: 'Хоз.csv', relPath: 'public/assets/aistudio/____09f9d030.csv' },
    { name: 'Хоз(1).csv', relPath: 'public/assets/aistudio/____1__443ffb42.csv' },
    { name: 'Хоз(2).csv', relPath: 'public/assets/aistudio/____2__232e9040.csv' },
  ];
  return specs.map((s) => {
    const abs = path.resolve(process.cwd(), s.relPath);
    const buf = fs.readFileSync(abs);
    return {
      name: s.name,
      buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  });
}

function buildSequentialBatch(
  drafts: Array<Omit<RawDraftOperationInput, 'sourceFileName' | 'amount'> & { amount?: number; sourceFileName?: string }>,
  priorOps: QueuedOperation[] = []
): QueuedOperation[] {
  const ctx: BatchSequentialContext = {
    priorOperations: [...priorOps],
    reportingYear: 2026,
    assumeInvoiceOnVatPurchase: true,
  };
  const built: QueuedOperation[] = [];
  for (const d of drafts) {
    const fullDraft: RawDraftOperationInput = {
      sourceFileName: d.sourceFileName ?? 'Хоз_Q4.csv',
      amount: d.amount ?? 0,
      ...d,
    };
    const op = bindAndGenerateOperation(fullDraft, null, undefined, ctx);
    ctx.priorOperations.push(op);
    built.push(op);
  }
  return built;
}

test('Multi-period OSV (Q1, Q2, H1, Q3, 9M): collapsed synthetic 90/91/99 in Итого, seamless carry-over, WIP preserved, no premature Dec 31 reformation', async () => {
  const files = loadCourseworkBatchInput();
  const batch = await processBatchFiles(files, null, { reportingYear: 2026 });

  const calcCur = (ops: QueuedOperation[], dateTo?: string) =>
    calculateOsvReport({
      db1C: null,
      operations: ops,
      dateTo,
      reportingYear: 2026,
      includeQueuedOperations: true,
    });

  // Even when periodEndDate is '2026-12-31', Q1–Q3 dataset (max date in September) must NOT trigger Dec 31 Reformation!
  const fixed = autoFixAllBy1CDb({
    db1C: null,
    operations: batch.operations,
    calculateCurrentOsv: calcCur,
    periodEndDate: '2026-12-31',
    reportingYear: 2026,
  });
  const ops = fixed.operations;

  const osvQ1 = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2026-01-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const osvQ2 = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2026-04-01',
    dateTo: '2026-06-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const osvH1 = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const osvQ3 = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2026-07-01',
    dateTo: '2026-09-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const osv9M = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2026-01-01',
    dateTo: '2026-09-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  // 1. Collapsed Итого check on Q1: raw leaf sum (including un-collapsed 90.*, 91.*, 99.*) is ~33.45M,
  // whereas 1С synthetic-collapsed Итого must be ~21.78M (< 25M) with 0.00 endDiff!
  const uncollapsedLeafDebitQ1 = round2(osvQ1.leafRows.reduce((s, r) => s + r.endDebit, 0));
  assert.ok(
    uncollapsedLeafDebitQ1 > 30_000_000,
    `Expected un-collapsed leaf subaccounts in Q1 to exceed 30M (YTD 90/91/99 turnovers), got ${uncollapsedLeafDebitQ1}`
  );
  assert.ok(
    osvQ1.totals.endDebit > 18_000_000 && osvQ1.totals.endDebit < 25_000_000,
    `Expected 1С collapsed Итого in Q1 around 21.78M (without 11.67M 90/91/99 inflation), got ${osvQ1.totals.endDebit}`
  );
  assert.equal(osvQ1.totals.endDiff, 0, 'Q1 collapsed Итого endDebit must equal endCredit');

  // 2. Seamless inter-period carry-over to 0.00 ₽
  assert.equal(osvQ2.totals.startDebit, osvQ1.totals.endDebit, 'Q2 startDebit must equal Q1 endDebit');
  assert.equal(osvQ2.totals.startCredit, osvQ1.totals.endCredit, 'Q2 startCredit must equal Q1 endCredit');
  assert.equal(osvQ2.totals.endDebit, osvH1.totals.endDebit, 'Q2 endDebit must equal H1 endDebit');
  assert.equal(osvQ3.totals.startDebit, osvH1.totals.endDebit, 'Q3 startDebit must equal H1 endDebit');
  assert.equal(osvQ3.totals.startCredit, osvH1.totals.endCredit, 'Q3 startCredit must equal H1 endCredit');
  assert.equal(osvQ3.totals.endDebit, osv9M.totals.endDebit, 'Q3 endDebit must equal 9M endDebit');

  // 3. WIP (НЗП) on 20.01 preserved in Q1 & Q2 without false unclosedCostRows warning, then closed in Q3
  const row20Q1 = osvQ1.leafRows.find((r) => r.code === '20.01');
  assert.ok((row20Q1?.endDebit ?? 0) > 0, 'Q1 must preserve unfinished construction WIP (НЗП) on 20.01');
  assert.equal(
    (osvQ1.auditorHints ?? []).some((h) => h.checkType === 'unclosed_accounts' && h.explanation.includes('20.01')),
    false,
    'Legitimate WIP on 20.01 after March closing must not be flagged as unclosed error'
  );
  const row20NineM = osv9M.leafRows.find((r) => r.code === '20.01');
  assert.equal(row20NineM?.endDebit ?? 0, 0, 'By end of Q3 all handed-over projects on 20.01 close to 0.00');

  // 4. Guard against premature Dec 31 Balance Reformation on Q1–Q3 dataset
  const hasPremature84 = ops.some((o) =>
    o.entries.some((e) => e.debit.startsWith('84') || e.credit.startsWith('84'))
  );
  assert.equal(hasPremature84, false, 'Q1–Q3 dataset must NOT run Dec 31 Balance Reformation onto 84');
  const row9901NineM = osv9M.leafRows.find((r) => r.code === '99.01.1');
  const row9902NineM = osv9M.leafRows.find((r) => r.code === '99.02.1');
  assert.ok((row9901NineM?.endCredit ?? 0) > 0, '99.01.1 cumulative profit remains open at end of 9M');
  const nonDeductible9M = round2(
    ops
      .filter((o) => o.includeInProcessing !== false && (o.date || '') <= '2026-09-30')
      .flatMap((o) => o.entries)
      .filter((e) => e.nonDeductibleForProfitTax === true)
      .reduce((s, e) => s + e.amount, 0)
  );
  assert.equal(nonDeductible9M, 188000, '9M non-deductible expenses under Art. 270 NK RF (144 000 gifts + 44 000 material aid) must equal 188 000 ₽');
  assert.equal(
    row9902NineM?.endDebit ?? 0,
    round2(((row9901NineM?.endCredit ?? 0) + nonDeductible9M) * 0.2),
    '99.02.1 cumulative profit tax at 9M must equal exact 20% of (99.01.1 + nonDeductibleYTD)'
  );
});

test('Universal RPB (97.21) write-off supports both calendar_days and monthly modes and closes exact residual to 0.00', () => {
  // 1) calendar_days mode: 36 500 ₽ from 2026-10-01 to 2026-12-31 (92 inclusive calendar days: Oct=31, Nov=30, Dec=31)
  const calOps = buildSequentialBatch([
    {
      date: '2026-10-01',
      description: 'Оплачен и принят к учету страховой полис ОСАГО на 3 мес. (без НДС) в ООО "АльфаСтрахование"',
      amount: 36500,
      categoryHint: 'deferred_expense_97',
      costAccountHint: '26',
      rpbWriteOffMethod: 'calendar_days',
      rpbStartDate: '2026-10-01',
      rpbEndDate: '2026-12-31',
      paidImmediatelyVia: 'bank_51',
    },
    { date: '2026-10-31', description: 'Закрытие месяца (октябрь)', categoryHint: 'closing' },
    { date: '2026-11-30', description: 'Закрытие месяца (ноябрь)', categoryHint: 'closing' },
    { date: '2026-12-31', description: 'Закрытие месяца (декабрь)', categoryHint: 'closing' },
  ]);

  const octRpb = calOps[1].entries.find((e) => e.credit === '97.21')?.amount ?? 0;
  const novRpb = calOps[2].entries.find((e) => e.credit === '97.21')?.amount ?? 0;
  const decRpb = calOps[3].entries.find((e) => e.credit === '97.21')?.amount ?? 0;

  assert.equal(octRpb, round2((36500 * 31) / 92), 'Oct write-off proportional to 31/92 calendar days');
  assert.equal(novRpb, round2((36500 * 30) / 92), 'Nov write-off proportional to 30/92 calendar days');
  assert.equal(round2(octRpb + novRpb + decRpb), 36500, 'Final month writes off exact remaining balance to 0.00');

  const calOsv = calculateOsvReport({
    db1C: null,
    operations: calOps,
    dateFrom: '2026-10-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  assert.equal(calOsv.leafRows.find((r) => r.code === '97.21')?.endDebit ?? 0, 0, '97.21 closes to 0.00');

  // 2) monthly mode: 10 000 ₽ over 3 months (3 333.33 + 3 333.33 + 3 333.34 = 10 000.00)
  const monOps = buildSequentialBatch([
    {
      date: '2026-10-01',
      description: 'Приобретена неисключительная лицензия на ПО сроком 3 мес. (без НДС) у ООО "СофтСервис"',
      amount: 10000,
      categoryHint: 'deferred_expense_97',
      costAccountHint: '44.01',
      rpbTermMonths: 3,
      rpbWriteOffMethod: 'monthly',
      rpbStartDate: '2026-10-01',
      paidImmediatelyVia: 'bank_51',
    },
    { date: '2026-10-31', description: 'Закрытие месяца (октябрь)', categoryHint: 'closing' },
    { date: '2026-11-30', description: 'Закрытие месяца (ноябрь)', categoryHint: 'closing' },
    { date: '2026-12-31', description: 'Закрытие месяца (декабрь)', categoryHint: 'closing' },
  ]);

  const m1 = monOps[1].entries.find((e) => e.credit === '97.21')?.amount ?? 0;
  const m2 = monOps[2].entries.find((e) => e.credit === '97.21')?.amount ?? 0;
  const m3 = monOps[3].entries.find((e) => e.credit === '97.21')?.amount ?? 0;
  assert.equal(m1, 3333.33);
  assert.equal(m2, 3333.33);
  assert.equal(m3, 3333.34, 'Final month writes off exact 3333.34 residual');
  assert.ok(
    monOps[1].entries.some((e) => e.debit === '90.07.1' && e.credit === '44.01' && e.amount === 3333.33),
    '44.01 must close strictly to 90.07.1 (commercial selling expenses)'
  );
});

test('Layer 1 Semantic Intent Sanity Guard validates customPostings leaf accounts and blocks 9+ digit INN/BIK as rubles', () => {
  const emptyContext: RollingAccountingContext1C = {
    counterparties: [],
    employees: [],
    openOrders: [],
    openSettlements: [],
    fixedAssets: [],
    financialBills: [],
    deferredExpenses: [],
    stockItems: [],
  };
  const rawRow = {
    rowIndex: 0,
    date: '2026-10-20',
    description: 'Списана безнадежная дебиторская задолженность ООО «Должник» за счет резерва ИНН 7810119529',
    rawExcelAmount: 45000,
  };
  const guardRes = sanitizeAndValidateOperationIntent(
    {
      rowIndex: 0,
      category: 'manual',
      docType1C: 'ОперацияБух',
      isNonPostingEvent: false,
      amountIntent: {
        mode: 'explicit_column',
        orderTotalAmount: 7810119529, // Hallucinated 10-digit INN as money!
      },
      vatIntent: { rule: 'not_applicable', rate: 0 },
      customPostings: [
        {
          debit: '63',
          credit: '62.01',
          amount: 45000,
          debitSubconto: 'Резервы по сомнительным долгам',
          creditSubconto: 'ООО «Должник»',
        },
        {
          debit: '63',
          credit: '62.01',
          amount: 7810119529, // Hallucinated 10-digit INN as customPosting amount!
        },
        { debit: '999.99', credit: '62.01', amount: 1000 }, // Hallucinated non-existent account!
      ],
      studentExplanation: 'Списание безнадёжного долга за счёт созданного резерва по сомнительным долгам.',
    },
    rawRow,
    emptyContext
  );

  assert.equal(guardRes.ok, true);
  const checked = guardRes.intent!;
  assert.equal(
    checked.amountIntent.orderTotalAmount,
    undefined,
    '10-digit INN inside rawText must be blocked from orderTotalAmount'
  );
  assert.equal(
    checked.customPostings?.length,
    2,
    'Invalid account 999.99 must be stripped while valid leaf 63/62.01 entries are kept'
  );
  assert.equal(checked.customPostings?.[0]?.debit, '63');
  assert.equal(checked.customPostings?.[0]?.credit, '62.01');
  assert.equal(checked.customPostings?.[0]?.amount, 45000);
  assert.equal(
    checked.customPostings?.[1]?.amount,
    undefined,
    '10-digit INN inside customPostings amount must be cleared by Sanity Guard'
  );

  // Keep only the first clean customPosting for deterministic generation check
  checked.customPostings = [checked.customPostings![0]];
  const draft = applyParsedIntentToDraft(
    {
      sourceFileName: 'Хоз_Q4.csv',
      date: '2026-10-20',
      description: 'Списана безнадежная дебиторская задолженность за счет резерва 45 000 руб.',
      amount: 45000,
      rawExcelAmount: 45000,
    },
    checked
  );
  const op = bindAndGenerateOperation(draft, null);
  assert.equal(op.entries.length, 1);
  assert.equal(op.entries[0].debit, '63');
  assert.equal(op.entries[0].credit, '62.01');
  assert.equal(op.entries[0].amount, 45000);
});

test('Full 4-Quarter Annual Cycle (Real Q1–Q3 + Unseen Exam Q4 Oct–Dec 2026): dismissal, sick leave, advance, OS modernization/disposal, НМА, loans, 99.02.3 sanction, Q4 tax reduction, and Dec 31 Balance Reformation', async () => {
  const files = loadCourseworkBatchInput();
  const batch = await processBatchFiles(files, null, { reportingYear: 2026 });

  const calcCur = (ops: QueuedOperation[], dateTo?: string) =>
    calculateOsvReport({
      db1C: null,
      operations: ops,
      dateTo,
      reportingYear: 2026,
      includeQueuedOperations: true,
    });

  const q1ToQ3Fixed = autoFixAllBy1CDb({
    db1C: null,
    operations: batch.operations,
    calculateCurrentOsv: calcCur,
    periodEndDate: '2026-09-30',
    reportingYear: 2026,
  });

  const osv9M = calculateOsvReport({
    db1C: null,
    operations: q1ToQ3Fixed.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-09-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const taxAccrued9M = osv9M.leafRows.find((r) => r.code === '99.02.1')?.endDebit ?? 0;
  assert.ok(taxAccrued9M > 500_000, 'Expected substantial accrued 20% profit tax after 9M');

  // Construct an unseen exam Q4 (Oct–Dec 2026) exercising every Q4 accounting scenario:
  const q4Drafts: Array<Omit<RawDraftOperationInput, 'sourceFileName' | 'amount'> & { amount?: number }> = [
    // 1. Short-term bank credit received (66.01)
    {
      date: '2026-10-05',
      description: 'Получен краткосрочный кредит ПАО "Сбербанк" на расчетный счет по кредитному договору №КР-10.',
      amount: 1_200_000,
      counterpartyName: 'ПАО «Сбербанк»',
      counterpartyInn: '7707083893',
    },
    // 2. НМА acquisition + commissioning (08.05 -> 04.01, СПИ 24 мес.)
    {
      date: '2026-10-08',
      description: 'Приобретено исключительное право на программный комплекс сметного расчета у ООО "СофтСтрой" (7814500119 / 781401001), в т.ч. НДС 20%, счет-фактура получен.',
      amount: 288_000,
      categoryHint: 'intangible_acquisition',
      counterpartyName: 'ООО «СофтСтрой»',
      counterpartyInn: '7814500119',
      counterpartyKpp: '781401001',
      nomenclatureName: 'ПК Смета-Строй',
    },
    {
      date: '2026-10-09',
      description: 'Принят к учету нематериальный актив ПК Смета-Строй (СПИ 24 мес.).',
      amount: 240_000,
      categoryHint: 'intangible_commissioning',
      nomenclatureName: 'ПК Смета-Строй',
      usefulLifeMonths: 24,
      costAccountHint: '26',
    },
    // 3. OS Modernization of Плоттер (commissioned in Q3): +56 000 ₽ net on 08.04.1 -> 01.01
    {
      date: '2026-10-10',
      description: 'Приобретен модуль автоподачи для модернизации плоттера у ООО "ТехноСервис" (7810554433 / 781001001), в т.ч. НДС 20%, СФ.',
      amount: 67_200,
      categoryHint: 'purchase_equipment',
      counterpartyName: 'ООО «ТехноСервис»',
      counterpartyInn: '7810554433',
      counterpartyKpp: '781001001',
      nomenclatureName: 'Плоттер',
    },
    {
      date: '2026-10-12',
      description: 'Приняты работы по модернизации объекта ОС Плоттер (увеличение первоначальной стоимости).',
      amount: 56_000,
      nomenclatureName: 'Плоттер',
      isOsModernization: true,
    },
    // 4. Direct material delivery to construction site -> 20.01 + Commercial advertising -> 44.01
    {
      date: '2026-10-14',
      description: 'Оказаны услуги по доставке бетона на объект ООО "АвтоТранс" (7811442216 / 781101001), в т.ч. НДС 20%, СФ.',
      amount: 120_000,
      counterpartyName: 'ООО «АвтоТранс»',
      counterpartyInn: '7811442216',
      counterpartyKpp: '781101001',
      nomenclatureGroupHint: 'Благоустройство территории',
    },
    {
      date: '2026-10-14',
      description: 'Оказаны рекламные услуги по продвижению продукции ООО "МедиаПлюс" (7813221108 / 781301001), в т.ч. НДС 20%, СФ.',
      amount: 360_000,
      counterpartyName: 'ООО «МедиаПлюс»',
      counterpartyInn: '7813221108',
      counterpartyKpp: '781301001',
    },
    // 5. Employee Dismissal mid-October (Валеев В.В. dismissed 15.10.2026 + unused vacation compensation)
    {
      date: '2026-10-15',
      description: 'Приказ об увольнении Валеева В.В. с 15.10.2026 по собственному желанию.',
      amount: 0,
      employeeName: 'Валеев В.В.',
      employeeTerminationDate: '2026-10-15',
    },
    {
      date: '2026-10-15',
      description: 'Начислена компенсация за неиспользованный отпуск при увольнении Валееву В.В.',
      amount: 24_000,
      employeeName: 'Валеев В.В.',
    },
    // 6. Sick leave (3 days at employer expense -> 13% NDFL, 0% insurance!) + Material aid (4 000 ₽ exempt)
    {
      date: '2026-10-18',
      description: 'Начислено пособие по временной нетрудоспособности за первые 3 дня за счет работодателя Фадееву Ф.Ф.',
      amount: 9_500,
      employeeName: 'Фадеев Ф.Ф.',
    },
    {
      date: '2026-10-19',
      description: 'Начислена материальная помощь сотруднику Петрову П.П.',
      amount: 10_000,
      employeeName: 'Петров П.П.',
    },
    // 7. Mid-month salary advance (20.10.2026)
    {
      date: '2026-10-20',
      description: 'Перечислен с расчетного счета аванс за первую половину октября сотрудникам организации.',
      amount: 150_000,
    },
    // 8. Tax sanction from FNS -> strictly 99.02.3 (must NOT reduce 99.01.1 taxable profit!)
    {
      date: '2026-10-25',
      description: 'Начислен штраф налогового органа (ИФНС) за несвоевременное представление сведений = 15 000 руб. (счет 99).',
      amount: 15_000,
      categoryHint: 'penalty_claim',
      counterpartyName: 'ИФНС России по г. Санкт-Петербургу',
    },
    // 9. Handover of October site work so 20.01 closes cleanly + October payroll + October closing
    {
      date: '2026-10-30',
      description: 'Выполнены и сданы работы по благоустройству территории заказчику ООО "Управление" с НДС 20%, СФ.',
      amount: 240_000,
      categoryHint: 'sale_goods',
      counterpartyName: 'ООО «Управление»',
      nomenclatureGroupHint: 'Благоустройство территории',
    },
    {
      date: '2026-10-31',
      description:
        'Начислена заработная плата сотрудникам за октябрь (рабочие работали на благоустройстве территории).',
      amount: 0,
    },
    {
      date: '2026-10-31',
      description: 'Закрытие месяца (октябрь 2026).',
      categoryHint: 'closing',
    },
    // 10. November: payout of October net salary (must deduct NDFL, alimony, AND 150 000 ₽ advance!)
    {
      date: '2026-11-05',
      description: 'На основании ведомостей в банк произведена выплата ЗП за октябрь.',
      amount: 0,
    },
    // 11. Bank credit interest accrual + payment (66.02) & partial principal repayment (66.01)
    {
      date: '2026-11-15',
      description: 'Начислены и списаны с расчетного счета проценты по полученному краткосрочному кредиту ПАО "Сбербанк".',
      amount: 18_000,
      categoryHint: 'loan_interest_accrual',
      counterpartyName: 'ПАО «Сбербанк»',
    },
    {
      date: '2026-11-16',
      description: 'Перечислено с расчетного счета в погашение основного долга по краткосрочному кредиту ПАО "Сбербанк".',
      amount: 400_000,
      categoryHint: 'loan_repaid',
      counterpartyName: 'ПАО «Сбербанк»',
    },
    // 12. Sale of OS «Вагон-бытовка» in November (must accrue Nov disposal-month 02.01 depr, close 01.09 to 0, and stop depr in Dec!)
    {
      date: '2026-11-20',
      description: 'Реализован объект ОС Вагон-бытовка покупателю ООО "Слава" с НДС 20%, СФ.',
      amount: 540_000,
      categoryHint: 'os_disposal',
      counterpartyName: 'ООО «Слава»',
      nomenclatureName: 'Вагон-бытовка',
    },
    // 13. Large consulting / repair services in Nov creating a Q4 loss to test bidirectional YTD profit tax reduction!
    {
      date: '2026-11-25',
      description: 'Оказаны консультационные и инжиниринговые услуги по управлению проектами ООО "КонсалтГрупп" (7810998877 / 781001001), в т.ч. НДС 20%, СФ.',
      amount: 1_800_000,
      counterpartyName: 'ООО «КонсалтГрупп»',
      counterpartyInn: '7810998877',
      counterpartyKpp: '781001001',
    },
    {
      date: '2026-11-30',
      description: 'Начислена заработная плата сотрудникам за ноябрь (благоустройство территории).',
      amount: 0,
    },
    {
      date: '2026-11-30',
      description: 'Закрытие месяца (ноябрь 2026).',
      categoryHint: 'closing',
    },
    // 14. December: final stage handover of Благоустройство территории + payroll + Year-End Closing & Balance Reformation (31.12.2026)
    {
      date: '2026-12-28',
      description: 'Сданы выполненные работы по благоустройству территории заказчику ООО "Управление" с НДС 20%, СФ.',
      amount: 360_000,
      categoryHint: 'sale_goods',
      counterpartyName: 'ООО «Управление»',
      nomenclatureGroupHint: 'Благоустройство территории',
    },
    {
      date: '2026-12-31',
      description: 'Начислена заработная плата сотрудникам за декабрь (благоустройство территории).',
      amount: 0,
    },
    {
      date: '2026-12-31',
      description: 'Закрытие месяца и реформация баланса за 2026 год.',
      categoryHint: 'closing',
    },
  ];

  const q4Built = buildSequentialBatch(q4Drafts, q1ToQ3Fixed.operations);
  const fullYearFixed = autoFixAllBy1CDb({
    db1C: null,
    operations: recalculateOperationsChronologically([...q1ToQ3Fixed.operations, ...q4Built], null),
    calculateCurrentOsv: calcCur,
    periodEndDate: '2026-12-31',
    reportingYear: 2026,
  });
  const fullYearOps = fullYearFixed.operations;
  const fullQ4Ops = fullYearOps.filter((o) => (o.date || '') >= '2026-10-01');

  // --- Assert Q4 HR, Sick Leave, Material Aid, Advance, Credit, Sanction, OS & НМА ---
  const creditRecOp = fullQ4Ops[0];
  assert.equal(creditRecOp.entries[0]?.debit, '51');
  assert.equal(creditRecOp.entries[0]?.credit, '66.01', 'Short-term bank credit must credit 66.01');

  const deliveryOp = fullQ4Ops[5];
  assert.equal(deliveryOp.entries[0]?.debit, '20.01', 'Direct concrete delivery to site must hit 20.01');

  const adOp = fullQ4Ops[6];
  assert.equal(adOp.entries[0]?.debit, '44.01', 'Advertising service must hit 44.01');

  const sickOp = fullQ4Ops[9];
  assert.equal(sickOp.entries.some((e) => e.credit === '70' && e.amount === 9500), true);
  assert.equal(
    sickOp.entries.some((e) => e.credit.startsWith('69')),
    false,
    'Sick leave (больничный) must accrue 0 insurance contributions per Art. 422 NK RF'
  );

  const matAidOp = fullQ4Ops[10];
  assert.equal(
    matAidOp.entries.find((e) => e.debit === '70' && e.credit === '68.01')?.amount,
    780,
    'Material aid 10 000 ₽ with 4 000 ₽ exemption must withhold 13% * 6 000 = 780 ₽ NDFL'
  );
  assert.equal(
    matAidOp.entries.find((e) => e.credit === '69.09')?.amount,
    1800,
    'Material aid 10 000 ₽ with 4 000 ₽ exemption must accrue 30% * 6 000 = 1 800 ₽ insurance'
  );

  const taxSanctionOp = fullQ4Ops[12];
  assert.equal(
    taxSanctionOp.entries[0]?.debit,
    '99.02.3',
    'Tax sanction must post strictly to 99.02.3 (non-deductible for profit tax)'
  );

  // Dismissal pro-rata in October & 0.00 in November/December:
  // Before dismissal, monthly ФОТ was 513 800 ₽ (Валеев = 88 400 ₽; remaining staff = 425 400 ₽).
  // In Oct 2026 (22 working days), 1–15 Oct has 11 working days -> Валеев pro-rata = 44 200 ₽ -> Oct ФОТ = 469 600 ₽.
  // In Nov & Dec 2026, Валеев is 0.00 ₽ -> ФОТ = 425 400 ₽!
  const octPayroll = fullQ4Ops[14];
  const novPayroll = fullQ4Ops[21];
  const decPayroll = fullQ4Ops[24];
  assert.equal(octPayroll.amount, 469600, 'Oct payroll must pro-rate dismissed Валеев (11/22 days = 44 200 ₽)');
  assert.equal(novPayroll.amount, 425400, 'Nov payroll must exclude dismissed Валеев (0 ₽)');
  assert.equal(decPayroll.amount, 425400, 'Dec payroll must exclude dismissed Валеев (0 ₽)');

  // Oct closing: 44.01 -> 90.07.1 (300 000 ₽ net advertising)
  const octClose = fullQ4Ops[15];
  assert.ok(
    octClose.entries.some((e) => e.debit === '90.07.1' && e.credit === '44.01' && e.amount === 300000),
    'Oct closing must close 44.01 (300 000 ₽) strictly to 90.07.1'
  );

  // Nov 5 salary payout must clear open Кт 70 after Oct advance (150 000 ₽), Oct payroll, compensation, sick leave, and mat aid!
  const osvAfterNov5 = calculateOsvReport({
    db1C: null,
    operations: fullYearOps,
    dateFrom: '2026-01-01',
    dateTo: '2026-11-05',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  assert.equal(
    osvAfterNov5.leafRows.find((r) => r.code === '70')?.endCredit ?? 0,
    0,
    'Salary payout on Nov 5 must settle exact remaining Кт 70 net of 150 000 ₽ advance'
  );
  assert.equal(
    osvAfterNov5.leafRows.find((r) => r.code === '70')?.endDebit ?? 0,
    0,
    'Salary payout on Nov 5 must not overpay 70 into red debit'
  );

  // Nov НМА amortization (240 000 / 24 = 10 000 ₽/mo on Кт 05) & OS Вагон-бытовка disposal
  const novOsDisposal = fullQ4Ops[19];
  assert.ok(
    novOsDisposal.entries.some((e) => e.credit === '02.01'),
    'OS disposal in Nov must accrue disposal-month depreciation on 02.01'
  );
  assert.ok(
    novOsDisposal.entries.some((e) => e.debit === '02.01' && e.credit === '01.09'),
    'OS disposal must write off accumulated 02.01 depreciation to 01.09'
  );

  const novClose = fullQ4Ops[22];
  assert.ok(
    novClose.entries.some((e) => e.credit === '05' && e.amount === 10000),
    'Nov closing must accrue 10 000 ₽ НМА amortization (240 000 / 24 мес.) on Кт 05'
  );

  const decClose = fullQ4Ops[25];
  assert.equal(
    decClose.entries.some((e) => e.credit === '02.01' && e.creditSubconto.includes('Вагон-бытовка')),
    false,
    'Disposed OS Вагон-бытовка must accrue ZERO depreciation in December after November disposal'
  );
  // Bidirectional YTD profit tax: Q4 had heavy expenses -> Dec 31 closing must post Дт 68.04.1 Кт 99.02.1!
  assert.ok(
    decClose.entries.some((e) => e.debit === '68.04.1' && e.credit === '99.02.1'),
    'Q4 loss must trigger bidirectional YTD profit tax reduction (Дт 68.04.1 Кт 99.02.1) on Dec 31'
  );

  // --- Assert Multi-Period Q4 & Full Year OSV + Dec 31 Balance Reformation + 2027-01-01 Opening ---
  const osvQ4 = calculateOsvReport({
    db1C: null,
    operations: fullYearOps,
    dateFrom: '2026-10-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const osvYear = calculateOsvReport({
    db1C: null,
    operations: fullYearOps,
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const osv2027Start = calculateOsvReport({
    db1C: null,
    operations: fullYearOps,
    dateFrom: '2027-01-01',
    dateTo: '2027-01-31',
    reportingYear: 2027,
    includeQueuedOperations: true,
  });

  // Seamless Q3/9M -> Q4 -> 2027 carry-over
  assert.equal(osvQ4.totals.startDebit, osv9M.totals.endDebit, 'Q4 startDebit must equal 9M endDebit');
  assert.equal(osvQ4.totals.startCredit, osv9M.totals.endCredit, 'Q4 startCredit must equal 9M endCredit');
  assert.equal(osvQ4.totals.endDiff, 0, 'Q4 endDiff must be 0.00');
  assert.equal(osvYear.totals.endDiff, 0, 'Full Year 2026 endDiff must be 0.00');
  assert.equal(osvYear.totals.turnoverDiff, 0, 'Full Year 2026 turnoverDiff must be 0.00');
  assert.equal(osv2027Start.totals.startDebit, osvYear.totals.endDebit, '2027 opening Debit === 2026 ending Debit');
  assert.equal(osv2027Start.totals.startCredit, osvYear.totals.endCredit, '2027 opening Credit === 2026 ending Credit');

  // Dec 31 Balance Reformation: ALL 90.*, 91.*, 99.* subaccounts must be 0.00!
  for (const r of osvYear.leafRows) {
    if (r.code.startsWith('90.') || r.code.startsWith('91.') || r.code.startsWith('99.')) {
      assert.equal(r.endDebit, 0, `After Dec 31 Reformation ${r.code} endDebit must be 0.00`);
      assert.equal(r.endCredit, 0, `After Dec 31 Reformation ${r.code} endCredit must be 0.00`);
    }
  }

  const row8401 = osvYear.leafRows.find((r) => r.code === '84.01');
  assert.ok((row8401?.endCredit ?? 0) > 0, 'Net retained profit after tax and sanctions must sit on Кт 84.01');
  const credit6601At9M = osv9M.leafRows.find((r) => r.code === '66.01')?.endCredit ?? 0;
  assert.equal(
    osvYear.leafRows.find((r) => r.code === '66.01')?.endCredit ?? 0,
    round2(credit6601At9M + 800_000),
    'Remaining bank credit principal on 66.01 = 9M balance + 1 200 000 − 400 000 ₽'
  );
  assert.equal(osvYear.leafRows.find((r) => r.code === '66.02')?.endCredit ?? 0, 0, 'Paid credit interest on 66.02 = 0.00 ₽');
  assert.equal(osvYear.leafRows.find((r) => r.code === '05')?.endCredit ?? 0, 20_000, '2 months (Nov+Dec) НМА amortization on 05 = 20 000 ₽');

  // Zero red balances across Full Year OSV & zero critical audit issues
  const redYearRows = osvYear.rows.filter((r) => r.hasRedStart || r.hasRedEnd);
  assert.equal(
    redYearRows.length,
    0,
    `Expected 0 red balances after full Q1–Q4 + Reformation, got: ${redYearRows.map((r) => `${r.code} (${r.endDebit}/${r.endCredit})`).join(', ')}`
  );
  const yearIssues = runAuditDiagnostics({ db1C: null, operations: fullYearOps, osv: osvYear });
  assert.equal(
    yearIssues.filter((i) => i.severity === 'error').length,
    0,
    `Expected 0 error-level audit issues after Q1–Q4 Reformation, got: ${yearIssues.map((i) => i.title).join('; ')}`
  );
});
