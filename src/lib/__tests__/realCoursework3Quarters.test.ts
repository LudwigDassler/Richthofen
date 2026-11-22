import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractSafeInlineMonetaryAmount,
  processBatchFiles,
} from '../import1c/batchFileParser';
import { autoFixAllBy1CDb, runAuditDiagnostics } from '../engine/auditAndAutofix';
import { calculateOsvReport } from '../engine/osvCalculator';
import {
  detectOperationClassification,
  sanitizeHydratedOperations,
} from '../engine/postingEngine';
import { DOCUMENT_SPECS } from '../engine/documentSpecs1C';
import { selectBestEgrulCandidate } from '../egrul/egrulLookup';

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

test('Hard sanity guard forbids parsing 9..20-digit INN/KPP/BIK/OGRN/bank codes as rubles and enforces region 78 EGRUL filter', () => {
  assert.equal(
    extractSafeInlineMonetaryAmount('Приобретен вексель у Банка Санкт-Петербург (7831820027 / 780601001)'),
    0,
    '10-digit SPb INN 7831820027 must NEVER be parsed as 7.83B rubles'
  );
  assert.equal(
    extractSafeInlineMonetaryAmount('Оплачен счет ООО "Тест" ИНН 7816588904 КПП 781601001 р/сч 40702810455000001234 БИК 044030653'),
    0,
    'INN, KPP, r/s, and BIK must all yield 0 inline amount'
  );
  assert.equal(
    extractSafeInlineMonetaryAmount('Выписан счет по дог.15 на 2 320 000 руб. ООО "Слава" (7816588904 / 781601001)'),
    2320000,
    'Explicit ruble sum alongside parenthesized INN/KPP must extract 2 320 000'
  );

  // Strict SPb region 78 filter: Krasnodar (23...) or Samara (63...) homonyms must be rejected
  const krasnodarSlava = selectBestEgrulCandidate(
    [
      {
        name: 'ООО «Слава»',
        fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «СЛАВА»',
        inn: '2315997706',
        kpp: '231501001',
        ogrn: '1172375000000',
        kind: 'ЮридическоеЛицо',
        source: 'egrul_fns',
        region: '23',
        isActive: true,
      },
    ],
    {
      targetName: 'ООО «Слава»',
      homeRegionCode: '78',
    }
  );
  assert.equal(krasnodarSlava, null, 'Out-of-region Krasnodar candidate must be rejected for SPb home region 78');
});

test('Universal grammar classifier handles incoming payments, СчетПокупателю, payroll payouts, OS word order, SRO fees, and composite settlement', () => {
  const pay1 = detectOperationClassification({
    description: 'Получена оплата за оконные блоки от Покупателя А.',
  });
  assert.equal(pay1.category, 'bank_in');
  assert.equal(pay1.docType1C, 'ПоступлениеНаРасчетныйСчет');

  const pay2 = detectOperationClassification({
    description: 'Получена на расчетный счет доплата от Заказчика Б за отгруженную продукцию.',
  });
  assert.equal(pay2.category, 'bank_in');
  assert.equal(pay2.docType1C, 'ПоступлениеНаРасчетныйСчет');

  const invBuyer = detectOperationClassification({
    description: 'Выписан счет по дог.15 на ремонт помещений ООО "Слава" (7816588904 / 781601001).',
  });
  assert.equal(invBuyer.category, 'customer_invoice');
  assert.equal(invBuyer.docType1C, 'СчетПокупателю');

  const zpBank = detectOperationClassification({
    description: 'На основании ведомостей в банк произведена выплата ЗП за предыдущий месяц.',
  });
  assert.equal(zpBank.category, 'payroll_payout');
  assert.equal(zpBank.docType1C, 'СписаниеСРасчетногоСчета');

  const zpCash = detectOperationClassification({
    description: 'На основании ведомостей в кассу произведена выплата ЗП за предыдущий месяц.',
  });
  assert.equal(zpCash.category, 'payroll_payout');
  assert.equal(zpCash.docType1C, 'ВыдачаНаличных');

  const fee = detectOperationClassification({
    description: 'Удержана с расчетного счета комиссии банка за ведение расчетного счета.',
  });
  assert.equal(fee.category, 'bank_fee');
  assert.equal(fee.docType1C, 'СписаниеСРасчетногоСчета');

  const osAcq = detectOperationClassification({
    description: 'Приобретены леса строительные (с НДС) для сдачи в аренду у поставщика.',
  });
  assert.equal(osAcq.category, 'purchase_equipment');
  assert.equal(osAcq.docType1C, 'ПоступлениеТоваровУслуг');

  const osSale = detectOperationClassification({
    description: 'Реализованы строительные леса с НДС покупателю.',
  });
  assert.equal(osSale.category, 'os_disposal');
  assert.equal(osSale.docType1C, 'ПередачаОС');

  const sro = detectOperationClassification({
    description: 'Перечислен вступительный взнос в саморегулируемую организацию (СРО) (без НДС).',
  });
  assert.equal(sro.category, 'purchase_services');

  const intIn = detectOperationClassification({
    description: 'Получена от Банка задолженность по %%.',
  });
  assert.equal(intIn.category, 'bank_in');
  assert.equal(intIn.docType1C, 'ПоступлениеНаРасчетныйСчет');
});

test('DOCUMENT_SPECS menuPath1C has zero duplicated adjacent segments', () => {
  for (const [category, spec] of Object.entries(DOCUMENT_SPECS)) {
    const segments = spec.menuPath1C
      .split('→')
      .map((s) => s.trim().toLowerCase());
    for (let i = 1; i < segments.length; i++) {
      assert.notEqual(
        segments[i],
        segments[i - 1],
        `Duplicated adjacent segment in menuPath1C for ${category}: "${spec.menuPath1C}"`
      );
    }
  }
});

test('Real 3-quarter coursework CSV pipeline (207 operations): all 8 systemic checkpoints, 100% OSV balance, 0 red subcontos, 0 op-cash-cover', async () => {
  const files = loadCourseworkBatchInput();
  const batch = await processBatchFiles(files, null, { reportingYear: 2026 });

  const q1Count = batch.operations.filter((o) => o.sourceFileName === 'Хоз.csv').length;
  const q2Count = batch.operations.filter((o) => o.sourceFileName === 'Хоз(1).csv').length;
  const q3Count = batch.operations.filter((o) => o.sourceFileName === 'Хоз(2).csv').length;

  assert.equal(q1Count, 57, 'Хоз.csv must yield all 57 numbered operations');
  assert.equal(q2Count, 60, 'Хоз(1).csv must yield all 60 numbered operations');
  assert.equal(q3Count, 90, 'Хоз(2).csv must yield all 90 numbered operations');
  assert.equal(batch.operations.length, 207, 'Total coursework operations must equal 207');

  const calcCur = (ops: typeof batch.operations, dateTo?: string) =>
    calculateOsvReport({
      db1C: null,
      operations: ops,
      dateTo,
      reportingYear: 2026,
      includeQueuedOperations: true,
    });

  const fixed = autoFixAllBy1CDb({
    db1C: null,
    operations: batch.operations,
    calculateCurrentOsv: calcCur,
    periodEndDate: '2026-12-31',
    reportingYear: 2026,
  });

  const ops = fixed.operations;
  assert.equal(
    ops.filter((o) => Boolean(o.sourceFileName)).length,
    207,
    'Must retain all 207 CSV operations without fake op-cash-cover injections'
  );
  assert.equal(
    ops.filter((o) => o.id.startsWith('op-cash-cover')).length,
    0,
    'Expected 0 op-cash-cover operations'
  );

  const q1Ops = ops.filter((o) => o.sourceFileName === 'Хоз.csv');
  const q2Ops = ops.filter((o) => o.sourceFileName === 'Хоз(1).csv');
  const q3Ops = ops.filter((o) => o.sourceFileName === 'Хоз(2).csv');

  // --- CHECKPOINT 1: Non-posting Excel amounts (HR hires, salaries, deductions, customer invoices) ---
  assert.equal(q1Ops[1].monthlySalary, 115000, 'Q1 #2 Федоров Ф.Ф. salary must be 115 000 ₽');
  assert.equal(q1Ops[10].monthlySalary, 88400, 'Q1 #11 Валеев В.В. salary must be 88 400 ₽');
  assert.equal(q1Ops[26].monthlySalary, 69900, 'Q1 #27 Фадеев Ф.Ф. salary must be 69 900 ₽');
  assert.equal(q1Ops[26].employeeChildCount, 3, 'Q1 #27 Фадеев Ф.Ф. must have 3 children');
  assert.equal(q2Ops[4].monthlySalary, 72200, 'Q2 #5 Главный бухгалтер salary must be 72 200 ₽');
  assert.equal(q2Ops[18].monthlySalary, 82300, 'Q2 #19 Баранкина salary must be 82 300 ₽');
  assert.equal(q2Ops[18].employeeChildCount, 2, 'Q2 #19 Баранкина must have 2 children');
  assert.equal(q2Ops[18].employeeIsSingleParent, true, 'Q2 #19 Баранкина must be single parent');
  assert.equal(q2Ops[40].monthlySalary, 88400, 'Q2 #41 Валеев transfer must retain 88 400 ₽ salary');
  assert.equal(q2Ops[45].monthlySalary, 86000, 'Q2 #46 Петров salary must be 86 000 ₽');
  assert.equal(
    q2Ops[46].employeePropertyDeduction,
    2000000,
    'Q2 #47 Главный бухгалтер must record 2 000 000 ₽ property deduction'
  );

  // Customer invoices preserve Excel amounts with 0 entries
  assert.equal(q1Ops[27].category, 'customer_invoice');
  assert.equal(q1Ops[27].amount, 6120000, 'Q1 #28 СчетПокупателю Конкурент must be 6 120 000 ₽');
  assert.equal(q1Ops[27].entries.length, 0);
  assert.equal(q1Ops[31].category, 'customer_invoice');
  assert.equal(q1Ops[31].amount, 1380000, 'Q1 #32 СчетПокупателю Управление must be 1 380 000 ₽');
  assert.equal(q1Ops[31].entries.length, 0);
  assert.equal(q2Ops[17].category, 'customer_invoice');
  assert.equal(q2Ops[17].amount, 2320000, 'Q2 #18 СчетПокупателю Слава must be 2 320 000 ₽');
  assert.equal(q2Ops[17].entries.length, 0);

  // Monthly payroll accruals (Feb..Sep): 203 400, 273 300, 345 500, 427 800, 513 800 x 4
  const payrollAccruals = ops.filter((o) => o.category === 'payroll_accrual');
  assert.deepEqual(
    payrollAccruals.map((p) => p.amount),
    [203400, 273300, 345500, 427800, 513800, 513800, 513800, 513800],
    'Monthly ФОТ across Feb–Sep 2026 must match exact staffing schedule'
  );

  // Alimony payouts (Q3: 155 037.50 ₽ and 90 025.00 ₽)
  const alimonyPayouts = ops.filter((o) => o.category === 'alimony_payout');
  assert.deepEqual(
    alimonyPayouts.map((a) => a.amount),
    [155037.5, 90025],
    'Alimony payouts must equal exact accumulated 76.41 balances'
  );

  // --- CHECKPOINT 2: 1 Company = 1 Canonical INN, Q2 #29/#43, Commercial Court Writs ---
  const innByCompany = new Map<string, Set<string>>();
  for (const op of ops) {
    if (op.counterpartyName && op.counterpartyInn) {
      if (!innByCompany.has(op.counterpartyName)) innByCompany.set(op.counterpartyName, new Set());
      innByCompany.get(op.counterpartyName)!.add(op.counterpartyInn);
    }
  }
  const multiInnCompanies = [...innByCompany.entries()].filter(([, s]) => s.size > 1);
  assert.equal(
    multiInnCompanies.length,
    0,
    `Expected 1 company = 1 INN across all 207 ops, got duplicates: ${JSON.stringify(
      multiInnCompanies.map(([k, v]) => [k, [...v]])
    )}`
  );

  assert.equal(q2Ops[28].category, 'purchase_materials');
  assert.equal(q2Ops[28].counterpartyName, 'ООО «Импульс»');
  assert.equal(q2Ops[28].amount, 520000);
  assert.equal(q2Ops[42].category, 'purchase_materials');
  assert.equal(q2Ops[42].counterpartyName, 'ООО «Норман»');
  assert.equal(q2Ops[42].amount, 3150000);

  assert.equal(q2Ops[3].category, 'penalty_claim');
  assert.equal(q2Ops[3].amount, 196510, 'Q2 #4 Сбыт court writ must equal 3 000 + 5 000 + 188 510 = 196 510 ₽');
  assert.equal(q3Ops[1].docType1C, 'КорректировкаДолга');
  assert.equal(q3Ops[1].entries[0]?.credit, '60.01', 'Q3 #2 must credit 60.01 (7 000 ₽)');
  assert.equal(q3Ops[2].docType1C, 'КорректировкаДолга');
  assert.equal(q3Ops[2].entries[0]?.credit, '60.01', 'Q3 #3 must credit 60.01 (3 000 ₽)');
  assert.equal(q3Ops[3].amount, 620000, 'Q3 #4 promissory note endorsement must settle 620 000 ₽ on 60.01');

  // --- CHECKPOINT 3: Charter Capital, ownOrganization, Nominative Founders ---
  assert.equal(q1Ops[0].ownOrganization?.name, 'ООО «Завод»');
  assert.equal(q1Ops[0].ownOrganization?.inn, '7810119529');
  assert.equal(q1Ops[0].counterpartyName, '', 'Own organization must never be stored as external counterparty');
  assert.equal(q1Ops[2].counterpartyName, 'Сидоров С.С.');
  assert.equal(q1Ops[2].amount, 1988000);
  assert.equal(q1Ops[11].counterpartyName, 'Иванов И.И.');
  assert.equal(q1Ops[11].amount, 852000);
  assert.equal(q3Ops[59].amount, 500000);
  assert.equal(q3Ops[60].counterpartyName, 'Федоров Ф.Ф.');
  assert.equal(q3Ops[60].nomenclatureName, 'Вагон-бытовка');
  assert.equal(q3Ops[60].usefulLifeMonths, 72);

  // --- CHECKPOINT 4: Arithmetic Chains (#13-#14-#21 & #16-#19-#20) ---
  assert.equal(q1Ops[12].amount, 568000, 'Q1 #13 advance to Конкурент');
  assert.equal(q1Ops[13].amount, 2044800, 'Q1 #14 МДФ receipt 284 * 7 200 = 2 044 800 ₽');
  assert.equal(q1Ops[20].amount, 1476800, 'Q1 #21 balance payment to Конкурент = 1 476 800 ₽');
  assert.equal(q1Ops[15].amount, 4884800, 'Q1 #16 advance from Управление');
  assert.equal(q1Ops[18].amount, 9769600, 'Q1 #19 shipment 284 * 34 400 = 9 769 600 ₽');
  assert.equal(q1Ops[19].amount, 4884800, 'Q1 #20 balance receipt from Управление = 4 884 800 ₽');
  assert.equal(q1Ops[19].entries[0]?.credit, '62.01', 'Q1 #20 must credit 62.01 (not 62.02)');

  // --- CHECKPOINT 5: Clean Nomenclature, 71.01 Subconto, OS СПИ, Promissory Note Scrub ---
  assert.equal(q1Ops[9].nomenclatureName, 'Плита ПВХ');
  assert.equal(q1Ops[9].employeeName, 'Федоров Ф.Ф.');
  assert.equal(q1Ops[29].nomenclatureName, 'Кирпич');
  assert.equal(q1Ops[33].nomenclatureName, 'Цемент');
  assert.equal(q1Ops[39].nomenclatureName, 'Вексель');
  assert.equal(q1Ops[39].amount, 620000);
  assert.equal(q1Ops[41].nomenclatureName, 'Спецодежда');
  assert.equal(q1Ops[42].employeeName, 'Фадеев Ф.Ф.');
  assert.equal(q1Ops[44].nomenclatureName, 'Принтер');
  assert.equal(q3Ops[13].nomenclatureName, 'Экскаватор-погрузчик');
  assert.equal(q3Ops[13].usefulLifeMonths, 83);
  assert.equal(q3Ops[27].usefulLifeMonths, 28);
  assert.equal(q3Ops[36].usefulLifeMonths, 90);
  assert.equal(q3Ops[72].nomenclatureName, 'Плоттер');
  assert.equal(q3Ops[72].usefulLifeMonths, 28);

  // --- CHECKPOINT 6 & 7: Zero zombie 26/60.01 on #24 & Synchronized resolverTrace ---
  assert.equal(q1Ops[23].category, 'vat_deduction');
  assert.equal(
    q1Ops[23].entries.some((e) => e.debit === '26' && e.credit === '60.01'),
    false,
    'Q1 #24 must have 0 zombie 26/60.01 entries'
  );

  const vatFreeCategories = new Set([
    'charter_capital',
    'founder_contribution',
    'payroll_accrual',
    'payroll_payout',
    'insurance_accrual',
    'tax_payment',
    'financial_investment',
    'loan_principal',
    'accountable_issue',
    'accountable_return',
    'alimony_payout',
  ]);
  for (const op of ops) {
    const traceStr = JSON.stringify(op.resolverTrace ?? '');
    if (vatFreeCategories.has(op.category)) {
      assert.equal(
        traceStr.includes('НДС 20%'),
        false,
        `VAT-free op ${op.date} (${op.category}) must not mention НДС 20% in resolverTrace`
      );
    }
    if (op.amount > 0) {
      assert.equal(
        traceStr.includes('Уровень 8'),
        false,
        `Resolved op ${op.date} (${op.amount} ₽) must not show Level 8 unresolved fallback`
      );
    }
  }

  // Max primary operation amount must equal 10 692 000 ₽ (ООО «Ключ»), proving 0 billion-ruble INN corruptions
  const primaryOps = ops.filter((o) => o.category !== 'closing');
  const maxPrimaryAmt = Math.max(...primaryOps.map((o) => o.amount));
  assert.equal(maxPrimaryAmt, 10692000, 'Max primary operation amount must be 10 692 000 ₽');

  // Zero false manual (ОперацияБух) and zero critical_error
  const manuals = ops.filter((o) => o.category === 'manual');
  const criticals = ops.filter((o) => o.readinessStatus === 'critical_error');
  assert.equal(manuals.length, 0);
  assert.equal(criticals.length, 0);
  assert.equal(fixed.executionSummary.remainingAutofixableCount, 0);
  assert.equal(fixed.executionSummary.criticalAfter, 0);

  // Verify Q1, Q2, Q3, and Year 2026 OSV equality and zero red balances
  const periods = [
    { label: 'Q1', from: '2026-01-01', to: '2026-03-31' },
    { label: 'Q2', from: '2026-04-01', to: '2026-06-30' },
    { label: 'Q3', from: '2026-07-01', to: '2026-09-30' },
    { label: 'YEAR', from: '2026-01-01', to: '2026-12-31' },
  ];

  for (const p of periods) {
    const osv = calculateOsvReport({
      db1C: null,
      operations: ops,
      dateFrom: p.from,
      dateTo: p.to,
      reportingYear: 2026,
      includeQueuedOperations: true,
    });

    assert.equal(osv.totals.startDiff, 0, `${p.label} startDiff must be 0`);
    assert.equal(osv.totals.turnoverDiff, 0, `${p.label} turnoverDiff must be 0`);
    assert.equal(osv.totals.endDiff, 0, `${p.label} endDiff must be 0`);
    assert.equal(osv.totals.isStartBalanced, true);
    assert.equal(osv.totals.isTurnoverBalanced, true);
    assert.equal(osv.totals.isEndBalanced, true);

    const redRows = osv.rows.filter((r) => r.hasRedStart || r.hasRedEnd);
    assert.equal(
      redRows.length,
      0,
      `${p.label} must have 0 red balances, got: ${redRows.map((r) => `${r.code} (${r.endDebit}/${r.endCredit})`).join(', ')}`
    );
  }

  const yearOsv = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  const findLeaf = (code: string) => yearOsv.leafRows.find((r) => r.code === code);
  assert.equal(findLeaf('08.04.1')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('01.09')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('01.09')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('10.01')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('10.08')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('10.10')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('41.01')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('43')?.turnoverDebit ?? 0, 2016400);
  assert.equal(findLeaf('43')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('20.01')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('26')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('50.01')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('58.02')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('60.02')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('62.02')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('71.01')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('71.01')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('75.01')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('75.01')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('76.02')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('76.02')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('76.09')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('76.09')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('76.41')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('76.41')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('76.АВ')?.endDebit ?? 0, 0);
  assert.equal(findLeaf('76.АВ')?.endCredit ?? 0, 0);
  assert.equal(findLeaf('80.09')?.endCredit ?? 0, 3340000);
  assert.ok((findLeaf('51')?.endDebit ?? 0) > 0);

  // Every 75.01 founder subconto closes to 0.00
  const subs7501 = yearOsv.subcontoRowsByAccount?.['75.01'] ?? [];
  assert.equal(subs7501.length, 3, '75.01 must have exactly 3 nominative founder subcontos');
  for (const s of subs7501) {
    assert.equal(s.endDebit, 0, `75.01 subconto ${s.subcontoLabel} endDebit must be 0`);
    assert.equal(s.endCredit, 0, `75.01 subconto ${s.subcontoLabel} endCredit must be 0`);
  }

  const issues = runAuditDiagnostics({ db1C: null, operations: ops, osv: yearOsv });
  assert.equal(issues.length, 0, 'Expected 0 audit issues after autofix');

  for (const [accCode, subs] of Object.entries(yearOsv.subcontoRowsByAccount ?? {})) {
    const redSubs = subs.filter((s) => s.hasRedEnd);
    assert.equal(
      redSubs.length,
      0,
      `Expected 0 red subconto rows on ${accCode}, got: ${redSubs.map((s) => `${s.subcontoLabel} (${s.endDebit}/${s.endCredit})`).join(', ')}`
    );
  }
});

test('Self-heals attached 1c_workbench_snapshot.json (209 -> 207 ops): strips op-cash-cover, zombie 26/60.01, and multi-INN drift', () => {
  const snapPath = path.resolve(
    process.cwd(),
    'public/assets/aistudio/1c_workbench_snapshot_ab1273b2.json'
  );
  const rawSnap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  assert.equal(rawSnap.operations.length, 209, 'Raw attached snapshot has 209 ops (including 2 op-cash-cover)');

  const sanitized = sanitizeHydratedOperations(rawSnap.operations, rawSnap.db1C ?? null);
  assert.equal(
    sanitized.filter((o) => Boolean(o.sourceFileName)).length,
    207,
    'sanitizeHydratedOperations must retain all 207 CSV operations'
  );
  assert.equal(
    sanitized.filter((o) => o.id.startsWith('op-cash-cover')).length,
    0,
    'Zero op-cash-cover operations after hydration sanitizer'
  );

  // Check #24 has zero zombie 26/60.01
  const vatOp24 = sanitized.find(
    (o) => o.date === '2026-02-28' && o.category === 'vat_deduction'
  );
  assert.ok(vatOp24, 'Expected Feb 28 vat_deduction operation');
  assert.equal(
    vatOp24.entries.some((e) => e.debit === '26' && e.credit === '60.01'),
    false,
    'Zombie 26/60.01 entry on #24 must be stripped on hydration'
  );

  // Check 1 company = 1 canonical INN after hydration + autofix
  const calcCur = (ops: typeof sanitized, dateTo?: string) =>
    calculateOsvReport({
      db1C: null,
      operations: ops,
      dateTo,
      reportingYear: 2026,
      includeQueuedOperations: true,
    });
  const healed = autoFixAllBy1CDb({
    db1C: null,
    operations: sanitized,
    calculateCurrentOsv: calcCur,
    periodEndDate: '2026-12-31',
    reportingYear: 2026,
  });

  const innMap = new Map<string, Set<string>>();
  for (const op of healed.operations) {
    if (op.counterpartyName && op.counterpartyInn) {
      if (!innMap.has(op.counterpartyName)) innMap.set(op.counterpartyName, new Set());
      innMap.get(op.counterpartyName)!.add(op.counterpartyInn);
    }
  }
  const multiInn = [...innMap.entries()].filter(([, s]) => s.size > 1);
  assert.equal(multiInn.length, 0, 'Healed snapshot must have 0 companies with >1 INN');
});
