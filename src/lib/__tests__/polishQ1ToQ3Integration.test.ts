import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { processBatchFiles } from '@/lib/import1c/batchFileParser';
import { calculateOsvReport } from '@/lib/engine/osvCalculator';
import {
  bindAndGenerateOperation,
  recalculateOperationsChronologically,
} from '@/lib/engine/postingEngine';
import { buildVirtual1CStateTimeline, computeMonthlyRpbWriteOff1C } from '@/lib/engine/virtual1CState';
import { extractRpbTermAndDates1C } from '@/lib/engine/entityNormalizer1C';
import { sanitizeAndValidateOperationIntent } from '@/types/semanticIntent';

function readAssetBuffer(relPath: string): ArrayBuffer {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test('RPB (97.21) parser & calculator: monthly equal shares default vs calendar_days with explicit dates', () => {
  // 1. Term in months/years -> 'monthly'
  const m1 = extractRpbTermAndDates1C(
    'Приобретена неисключительная лицензия на ПО сроком 2 года 8 мес.',
    ''
  );
  assert.equal(m1.termMonths, 32);
  assert.equal(m1.writeOffMethod, 'monthly');

  // 2. Term in actionSequenceHint -> 'monthly'
  const m2 = extractRpbTermAndDates1C(
    'Учтены расходы будущих периодов на сертификацию',
    'Покупки = Поступление услуг (срок списания 24 мес.)'
  );
  assert.equal(m2.termMonths, 24);
  assert.equal(m2.writeOffMethod, 'monthly');

  // 3. Explicit date bounds -> 'calendar_days'
  const m3 = extractRpbTermAndDates1C(
    'Оплачен полис страхования имущества на период с 01.03.2026 по 28.02.2027',
    ''
  );
  assert.equal(m3.writeOffMethod, 'calendar_days');
  assert.equal(m3.startDate, '2026-03-01');
  assert.equal(m3.endDate, '2027-02-28');

  // 4. SRO entrance fee without explicit term -> 32 months 'monthly' (1 000 000 / 32 = 31 250.00 ₽/mo)
  const mSro = extractRpbTermAndDates1C(
    'Перечислен вступительный взнос в саморегулируемую организацию (СРО) в Союз строителей. НДС не облагается.',
    'Д 76 К 51; Д 97 К 76'
  );
  assert.equal(mSro.termMonths, 32);
  assert.equal(mSro.writeOffMethod, 'monthly');

  // 5. Final-month residual write-off leaves exact 0.00 tail
  const residualShare = computeMonthlyRpbWriteOff1C(
    {
      key: 'rpb:test',
      name: 'Лицензия',
      totalAmount: 100000,
      remainingAmount: 33333.34,
      termMonths: 3,
      remainingMonths: 1,
      monthlyAmount: 33333.33,
      writeOffMethod: 'monthly',
      writeOffAccount: '26',
      startMonth: '2026-01',
      settlementAccount: '60.01',
      source: 'created_in_operation',
      usages: [],
    },
    '2026-03-31'
  );
  assert.equal(residualShare, 33333.34);
});

test('Explicit ruble WIP inventory (ИнвентаризацияНЗП) retains exact WIP amount and closes excess 20.01 to 90.02.1', () => {
  const op1 = bindAndGenerateOperation(
    {
      date: '2026-10-10',
      description: 'Списаны материалы в основное производство',
      amount: 400000,
      vatRate: 0,
      vatRule: 'none',
      categoryHint: 'materials_writeoff',
      docTypeHint: 'РасходМатериалов',
      explicitDebit: '20.01',
      explicitCredit: '10.01',
    },
    null,
    'wip-test-1'
  );
  const op2 = bindAndGenerateOperation(
    {
      date: '2026-10-31',
      description: 'Инвентаризация НЗП на конец октября',
      amount: 150000,
      rawExcelAmount: 150000,
    },
    null,
    'wip-test-2'
  );
  assert.equal(op2.category, 'wip_inventory');
  assert.equal(op2.docType1C, 'ИнвентаризацияНЗП');
  assert.equal(op2.entries.length, 0);

  const op3 = bindAndGenerateOperation(
    {
      date: '2026-10-31',
      description: 'Закрытие месяца за октябрь 2026',
      categoryHint: 'closing',
      docTypeHint: 'ЗакрытиеМесяца',
    },
    null,
    'wip-test-3'
  );

  const recalc = recalculateOperationsChronologically([op1, op2, op3], null, {
    reportingYear: 2026,
  });
  const osv = calculateOsvReport({
    db1C: null,
    operations: recalc,
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  const row20 = osv.leafRows.find((r) => r.code === '20.01');
  const row9002 = osv.leafRows.find((r) => r.code === '90.02.1');
  assert.equal(row20?.endDebit, 150000, '20.01 must retain exact 150 000 ₽ WIP from ИнвентаризацияНЗП');
  assert.equal(row9002?.turnoverDebit, 250000, 'Excess 250 000 ₽ above WIP must close to 90.02.1');
});

test('AI Chief-Accountant sanitizer blocks generic nomenclature placeholders, recovers multi-item writeoffs, and enforces 43 & non-recurring contracts', () => {
  const emptyRolling = {
    counterparties: [],
    employees: [],
    openOrders: [],
    openSettlements: [],
    stockBalances: [],
    fixedAssets: [],
    deferredExpenses: [],
  };

  const resWriteoff = sanitizeAndValidateOperationIntent(
    {
      rowIndex: 17,
      category: 'materials_writeoff',
      docType1C: 'РасходМатериалов',
      isNonPostingEvent: false,
      confidence: 'high',
      nomenclature: { canonicalName: 'Материлы', account: '10.01' },
      amountIntent: { mode: 'full_stock_writeoff' },
      vatIntent: { rule: 'not_applicable', rate: 0 },
      studentExplanation: 'Списание материалов в производство',
    },
    {
      rowIndex: 17,
      date: '2026-02-10',
      description:
        'Переданы материлы в производство для производства Панели из ПВХ и МДФ в кол-ве 284 шт (плита ПВХ 284 шт, заготовка МДФ 284 шт, клей 284 шт.)',
      rawExcelAmount: 0,
    },
    emptyRolling
  );
  assert.equal(resWriteoff.ok, true, resWriteoff.error);
  assert.ok(resWriteoff.intent?.items && resWriteoff.intent.items.length === 3);
  assert.deepEqual(
    resWriteoff.intent.items.map((i) => i.cleanName),
    ['Плита ПВХ', 'Заготовка МДФ', 'Клей']
  );

  const resProdSale = sanitizeAndValidateOperationIntent(
    {
      rowIndex: 19,
      category: 'sale_goods',
      docType1C: 'РеализацияТоваровУслуг',
      isNonPostingEvent: false,
      confidence: 'high',
      nomenclature: {
        canonicalName: 'Продукция',
        quantity: 284,
        unitPrice: 34400,
        account: '41.01',
      },
      amountIntent: { mode: 'qty_times_price' },
      vatIntent: { rule: 'included', rate: 20 },
      studentExplanation: 'Реализация готовой продукции покупателю',
    },
    {
      rowIndex: 19,
      date: '2026-02-15',
      description: 'Поставлена продукция 284 шт Панель из ПВХ и МДФ по цене вкл.НДС',
      rawExcelAmount: 9769600,
    },
    emptyRolling
  );
  assert.equal(resProdSale.ok, true, resProdSale.error);
  assert.equal(resProdSale.intent?.nomenclature?.canonicalName, 'Панель из ПВХ и МДФ');
  assert.equal(resProdSale.intent?.nomenclature?.account, '43');

  const resOneOffCtr = sanitizeAndValidateOperationIntent(
    {
      rowIndex: 28,
      category: 'customer_invoice',
      docType1C: 'СчетПокупателю',
      isNonPostingEvent: true,
      confidence: 'high',
      amountIntent: {
        mode: 'explicit_column',
        orderTotalAmount: 6120000,
        isRecurringMonthly: true,
      },
      vatIntent: { rule: 'included', rate: 20 },
      studentExplanation: 'Выставлен счёт покупателю на реконструкцию кровли',
    },
    {
      rowIndex: 28,
      date: '2026-03-05',
      description:
        'Заключили дог с ООО "Конкурент" № 20, выписали счет на реконструкцию кровли с установкой кирпичной трубы',
      rawExcelAmount: 6120000,
    },
    emptyRolling
  );
  assert.equal(resOneOffCtr.ok, true, resOneOffCtr.error);
  assert.equal(resOneOffCtr.intent?.amountIntent.isRecurringMonthly, false);
});

test('Q1 standalone reference 1C parity (21,78 млн ₽ OSV) & sequential Q1 -> Q2 -> Q3 carry-over', async () => {
  const q1Input = { name: 'Хоз.csv', buffer: readAssetBuffer('public/assets/aistudio/____09f9d030.csv') };
  const q2Input = { name: 'Хоз(1).csv', buffer: readAssetBuffer('public/assets/aistudio/____1__443ffb42.csv') };
  const q3Input = { name: 'Хоз(2).csv', buffer: readAssetBuffer('public/assets/aistudio/____2__232e9040.csv') };

  // --- STEP 1: Import Q1 standalone ---
  const q1Res = await processBatchFiles([q1Input], null, { reportingYear: 2026 });
  assert.equal(q1Res.operations.length, 57);

  const q1Osv = calculateOsvReport({
    db1C: null,
    operations: q1Res.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  // 1a. 97.21 SRO fee: 1 000 000 / 32 = 31 250.00 ₽ write-off in March -> 968 750.00 ₽ ending debit
  const q1Row9721 = q1Osv.leafRows.find((r) => r.code === '97.21');
  assert.equal(q1Row9721?.turnoverCredit, 31250, 'Q1 97.21 March write-off must equal 31 250.00 ₽');
  assert.equal(q1Row9721?.endDebit, 968750, 'Q1 97.21 ending debit must equal 968 750.00 ₽');

  // 1b. 20.01 closing: ONLY "Реконструкция кровли" (364 539.94 ₽) stays in WIP; "Основная номенклатурная группа" closes 100% (0.00 tail!)
  const q1Row2001 = q1Osv.leafRows.find((r) => r.code === '20.01');
  assert.equal(q1Row2001?.endDebit, 364539.94, 'Q1 20.01 ending WIP must equal exact 364 539.94 ₽ without 50 347.22 ₽ tail');
  const q1Subs20 = q1Osv.subcontoRowsByAccount?.['20.01'] ?? [];
  const mainGroup20 = q1Subs20.find((s) =>
    s.subcontoLabel.toLowerCase().includes('основная номенклатурная группа')
  );
  assert.equal(mainGroup20?.endDebit ?? 0, 0, 'Основная номенклатурная группа on 20.01 must close 100% to 0.00 ₽');

  // 1c. Q1 OSV Итого matches reference 1C (~21.78M ₽, balanced to 0.00 kopeks)
  assert.equal(q1Osv.totals.endDiff, 0);
  assert.equal(Math.floor(q1Osv.totals.endDebit / 10000), 2178, `Expected Q1 endDebit in 21,78 млн ₽ band, got ${q1Osv.totals.endDebit}`);

  // 1d. Q1 #53 is classified as ИнвентаризацияНЗП ('wip_inventory')
  assert.equal(q1Res.operations[52].category, 'wip_inventory');
  assert.equal(q1Res.operations[52].docType1C, 'ИнвентаризацияНЗП');

  // 1e. Directory hygiene: #9 firstSeenOpNumber, #17 multi-item Step 00, #16/#19 Панель из ПВХ и МДФ (43), one-off contracts
  const { finalState: q1State } = buildVirtual1CStateTimeline(null, q1Res.operations);

  const cpStabilnost = q1State.counterparties.find((c) => c.name.includes('Стабильность'));
  const nomPlita = q1State.nomenclature.find((n) => n.name === 'Плита ПВХ');
  assert.equal(cpStabilnost?.firstSeenOpNumber, 9, 'ООО «Стабильность» must have firstSeenOpNumber = 9 (Доверенность)');
  assert.equal(nomPlita?.firstSeenOpNumber, 9, 'Плита ПВХ must have firstSeenOpNumber = 9 (Доверенность)');

  const bannedInState = q1State.nomenclature.filter((n) =>
    /^(?:материал\p{L}*|материл\p{L}*|продукци\p{L}*|товар\p{L}*|предоплат\p{L}*)/iu.test(n.name)
  );
  assert.equal(
    bannedInState.length,
    0,
    `Zero generic/placeholder nomenclature cards allowed, got: ${bannedInState.map((b) => b.name).join(', ')}`
  );

  const nomPanel = q1State.nomenclature.find((n) => n.name === 'Панель из ПВХ и МДФ');
  assert.ok(nomPanel, 'Панель из ПВХ и МДФ card must exist');
  assert.equal(nomPanel.itemKind, 'Продукция');
  assert.equal(nomPanel.defaultAccount, '43');
  assert.equal(nomPanel.firstSeenOpNumber, 16);

  // Check #17 Step 00 lists Плита ПВХ, Заготовка МДФ, Клей as already_exists
  const op17 = q1Res.operations[16];
  const op17NomSteps = (op17.mentorGuide1C?.step00Prep ?? []).filter(
    (s) => s.entityKind === 'nomenclature'
  );
  assert.deepEqual(
    op17NomSteps.map((s) => s.entityName),
    ['Плита ПВХ', 'Заготовка МДФ', 'Клей']
  );
  assert.ok(
    op17NomSteps.every((s) => s.status === 'already_exists'),
    'All 3 materials in #17 must be already_exists in Step 00'
  );

  // Check #19 uses Панель из ПВХ и МДФ on account 43 and shows already_exists in Step 00
  const op19 = q1Res.operations[18];
  assert.equal(op19.nomenclatureName, 'Панель из ПВХ и МДФ');
  assert.equal(op19.materialAccount, '43');
  const op19NomStep = (op19.mentorGuide1C?.step00Prep ?? []).find(
    (s) => s.entityKind === 'nomenclature'
  );
  assert.equal(op19NomStep?.entityName, 'Панель из ПВХ и МДФ');
  assert.equal(op19NomStep?.status, 'already_exists');

  // Check one-off contracts (#9 Стабильность, #28 Конкурент) have NO periodicAmount
  const ctrStabilnost = q1State.contracts.find((c) => c.counterpartyName.includes('Стабильность'));
  const ctrKonkurent20 = q1State.contracts.find(
    (c) => c.counterpartyName.includes('Конкурент') && c.number === '20'
  );
  assert.equal(ctrStabilnost?.periodicAmount, undefined);
  assert.ok(ctrKonkurent20, 'Contract № 20 with ООО «Конкурент» (#28) must be registered');
  assert.equal(ctrKonkurent20.periodicAmount, undefined);

  // Check #48 writ_of_execution recipient is clean feminine nominative (no trailing "в период с 01/04..." garbage)
  assert.equal(q1Res.operations[47].alimonyRecipientName, 'Валеева О.Г.');
  const recCard7641 = q1State.counterparties.find((c) => c.name === 'Валеева О.Г.');
  assert.equal(recCard7641?.kind, 'ФизическоеЛицо');
  assert.ok(recCard7641?.roleHint?.includes('76.41'));

  // Check RPB carry-over state after Q1
  assert.equal(q1State.deferredExpenses.length, 1);
  assert.equal(q1State.deferredExpenses[0].remainingAmount, 968750);
  assert.equal(q1State.deferredExpenses[0].remainingMonths, 31);

  // --- STEP 2: Sequential import Q2 on top of Q1 ---
  const q2Res = await processBatchFiles([q2Input], null, {
    reportingYear: 2026,
    priorOperations: q1Res.operations,
  });
  const opsQ1Q2 = recalculateOperationsChronologically(
    [...q1Res.operations, ...q2Res.operations],
    null,
    { reportingYear: 2026 }
  );
  assert.equal(opsQ1Q2.length, 117);

  const osv6m = calculateOsvReport({
    db1C: null,
    operations: opsQ1Q2,
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  assert.equal(osv6m.totals.endDiff, 0);
  assert.equal(
    osv6m.leafRows.find((r) => r.code === '97.21')?.endDebit,
    875000,
    'After Q2 (3 more months * 31 250 ₽), 97.21 ending debit must equal 875 000.00 ₽'
  );
  const { finalState: q2State } = buildVirtual1CStateTimeline(null, opsQ1Q2);
  assert.equal(q2State.deferredExpenses[0].remainingMonths, 28);

  // --- STEP 3: Sequential import Q3 on top of Q1+Q2 ---
  const q3Res = await processBatchFiles([q3Input], null, {
    reportingYear: 2026,
    priorOperations: opsQ1Q2,
  });
  const opsQ1Q2Q3 = recalculateOperationsChronologically(
    [...opsQ1Q2, ...q3Res.operations],
    null,
    { reportingYear: 2026 }
  );
  assert.equal(opsQ1Q2Q3.length, 207);

  const osv9m = calculateOsvReport({
    db1C: null,
    operations: opsQ1Q2Q3,
    dateFrom: '2026-01-01',
    dateTo: '2026-09-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  assert.equal(osv9m.totals.endDiff, 0);
  assert.equal(
    osv9m.leafRows.find((r) => r.code === '97.21')?.endDebit,
    781250,
    'After Q3 (6 total months * 31 250 ₽), 97.21 ending debit must equal 781 250.00 ₽'
  );
  assert.equal(
    osv9m.leafRows.find((r) => r.code === '20.01')?.endDebit ?? 0,
    0,
    'After Q3 September closing (no wip_inventory in Sep), 20.01 must close 100% to 0.00 ₽'
  );
  const { finalState: q3State } = buildVirtual1CStateTimeline(null, opsQ1Q2Q3);
  assert.equal(q3State.deferredExpenses[0].remainingMonths, 25);

  // Verify sequential Q1->Q2->Q3 OSV matches all-at-once Q1+Q2+Q3 OSV to the exact kopek!
  const allAtOnce = await processBatchFiles([q1Input, q2Input, q3Input], null, {
    reportingYear: 2026,
  });
  const osvAllAtOnce = calculateOsvReport({
    db1C: null,
    operations: allAtOnce.operations,
    dateFrom: '2026-01-01',
    dateTo: '2026-09-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  assert.equal(osv9m.totals.turnoverDebit, osvAllAtOnce.totals.turnoverDebit);
  assert.equal(osv9m.totals.endDebit, osvAllAtOnce.totals.endDebit);
});
