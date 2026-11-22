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
import { detectOperationClassification } from '../engine/postingEngine';
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
        region: '23',
        isActive: true,
      },
    ],
    'ООО «Слава»',
    '78'
  );
  assert.equal(krasnodarSlava, null, 'Out-of-region Krasnodar candidate must be rejected for SPb home region 78');
});

test('Universal grammar classifier handles incoming payments, СчетПокупателю, payroll payouts, OS word order, SRO fees, and composite settlement', () => {
  // 1. Incoming bank payment mentioning shipped goods/products must NEVER fall into sale_goods or manual
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

  // 1b. Standalone invoice to buyer -> СчетПокупателю (customer_invoice)
  const invBuyer = detectOperationClassification({
    description: 'Выписан счет по дог.15 на ремонт помещений ООО "Слава" (7816588904 / 781601001).',
  });
  assert.equal(invBuyer.category, 'customer_invoice');
  assert.equal(invBuyer.docType1C, 'СчетПокупателю');

  // 2. Payroll payout with abbreviated "ЗП" (without slash) or "з/п"
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

  // 3. Bank fee with plural/genitive "комиссии банка за ведение расчетного счета"
  const fee = detectOperationClassification({
    description: 'Удержана с расчетного счета комиссии банка за ведение расчетного счета.',
  });
  assert.equal(fee.category, 'bank_fee');
  assert.equal(fee.docType1C, 'СписаниеСРасчетногоСчета');

  // 4. Equipment acquired "для сдачи в аренду" must be 08.04.1 purchase_equipment, not rental expense
  const osAcq = detectOperationClassification({
    description: 'Приобретены леса строительные (с НДС) для сдачи в аренду у поставщика.',
  });
  assert.equal(osAcq.category, 'purchase_equipment');
  assert.equal(osAcq.docType1C, 'ПоступлениеТоваровУслуг');

  // 5. OS disposal word-order invariance ("Реализованы строительные леса")
  const osSale = detectOperationClassification({
    description: 'Реализованы строительные леса с НДС покупателю.',
  });
  assert.equal(osSale.category, 'os_disposal');
  assert.equal(osSale.docType1C, 'ПередачаОС');

  // 6. SRO membership / entry fee
  const sro = detectOperationClassification({
    description: 'Перечислен вступительный взнос в саморегулируемую организацию (СРО) (без НДС).',
  });
  assert.equal(sro.category, 'purchase_services');

  // 7. Accrued bank/promissory note interest receipt regardless of word order
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

test('Real 3-quarter coursework CSV pipeline (207 operations): 100% OSV balance, 0 red active/subconto balances, 0 false manual, 0 critical errors, 0 autofixable left', async () => {
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

  // Max primary operation amount must equal 10 692 000 ₽ (ООО «Ключ»), proving 0 billion-ruble INN corruptions
  const primaryOps = ops.filter((o) => o.category !== 'closing');
  const maxPrimaryAmt = Math.max(...primaryOps.map((o) => o.amount));
  assert.equal(maxPrimaryAmt, 10692000, 'Max primary operation amount must be 10 692 000 ₽');

  // Verify standalone СчетПокупателю and openOrders resolution (ООО «Слава» 2 320 000 ₽)
  const slavaInvoice = ops.find(
    (o) => o.category === 'customer_invoice' && o.description.includes('Слава')
  );
  assert.ok(slavaInvoice, 'Expected СчетПокупателю for ООО "Слава"');
  assert.equal(slavaInvoice.docType1C, 'СчетПокупателю');
  assert.equal(slavaInvoice.amount, 2320000);
  assert.equal(slavaInvoice.entries.length, 0);

  const slavaPrepay = ops.find(
    (o) => o.category === 'bank_in' && o.description.includes('предоплата от ООО "Слава"')
  );
  assert.ok(slavaPrepay, 'Expected bank_in prepayment from ООО "Слава"');
  assert.equal(slavaPrepay.amount, 2320000, 'Prepayment from ООО "Слава" must pull 2 320 000 ₽ from openOrders');

  // Zero false manual (ОперацияБух) and zero critical_error
  const manuals = ops.filter((o) => o.category === 'manual');
  const criticals = ops.filter((o) => o.readinessStatus === 'critical_error');
  assert.equal(
    manuals.length,
    0,
    `Expected 0 manual fallback operations, got: ${manuals.map((m) => m.description).join(' | ')}`
  );
  assert.equal(
    criticals.length,
    0,
    `Expected 0 critical_error operations, got: ${criticals.map((c) => `${c.date}: ${c.readinessNote}`).join(' | ')}`
  );

  assert.equal(fixed.executionSummary.remainingAutofixableCount, 0);
  assert.equal(fixed.executionSummary.criticalAfter, 0);

  // Zero occurrences of deprecated generic message
  for (const op of ops) {
    const combinedNotes = `${op.readinessNote ?? ''} ${op.amountCalculationNote ?? ''} ${op.calculationProvenance ?? ''}`;
    assert.equal(
      combinedNotes.includes('Требуется указать сумму первичного документа'),
      false,
      `Deprecated generic message found in operation ${op.id}`
    );
  }

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
    assert.equal(osv.totals.isStartBalanced, true, `${p.label} start must be balanced`);
    assert.equal(osv.totals.isTurnoverBalanced, true, `${p.label} turnover must be balanced`);
    assert.equal(osv.totals.isEndBalanced, true, `${p.label} end must be balanced`);

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

  // Key closing & settlement invariants at end of Q3 / Year 2026
  const findLeaf = (code: string) => yearOsv.leafRows.find((r) => r.code === code);
  assert.equal(findLeaf('08.04.1')?.endDebit ?? 0, 0, 'All 08.04.1 capex must be commissioned');
  assert.equal(findLeaf('01.09')?.endDebit ?? 0, 0, '01.09 OS disposal account must close to 0');
  assert.equal(findLeaf('01.09')?.endCredit ?? 0, 0, '01.09 OS disposal account must close to 0');
  assert.equal(findLeaf('10.01')?.endDebit ?? 0, 0, '10.01 raw materials must be written off to 0');
  assert.equal(findLeaf('10.08')?.endDebit ?? 0, 0, '10.08 construction materials must be written off to 0');
  assert.equal(findLeaf('10.10')?.endDebit ?? 0, 0, '10.10 workwear must be issued to exploitation');
  assert.equal(findLeaf('41.01')?.endDebit ?? 0, 0, '41.01 resale goods must close to 0');
  assert.equal(findLeaf('43')?.turnoverDebit ?? 0, 2016400, '43 finished goods output must equal 2 016 400.00 ₽');
  assert.equal(findLeaf('43')?.endDebit ?? 0, 0, '43 finished goods must close to 0 after shipment');
  assert.equal(findLeaf('20.01')?.endDebit ?? 0, 0, '20.01 main production must close to 0');
  assert.equal(findLeaf('26')?.endDebit ?? 0, 0, '26 general expenses must close to 0');
  assert.equal(findLeaf('19.01')?.endDebit ?? 0, 0, '19.01 VAT must be deducted');
  assert.equal(findLeaf('19.03')?.endDebit ?? 0, 0, '19.03 VAT must be deducted');
  assert.equal(findLeaf('19.04')?.endDebit ?? 0, 0, '19.04 VAT must be deducted');
  assert.equal(findLeaf('71.01')?.endDebit ?? 0, 0, '71.01 accountable persons must close to 0');
  assert.equal(findLeaf('71.01')?.endCredit ?? 0, 0, '71.01 accountable persons must close to 0');
  assert.equal(findLeaf('73.03')?.endDebit ?? 0, 0, '73.03 material aid must close to 0');
  assert.equal(findLeaf('73.03')?.endCredit ?? 0, 0, '73.03 material aid must close to 0');
  assert.equal(findLeaf('75.01')?.endDebit ?? 0, 0, '75.01 founder shares must close to 0');
  assert.equal(findLeaf('75.01')?.endCredit ?? 0, 0, '75.01 founder shares must close to 0');
  assert.equal(findLeaf('76.09')?.endDebit ?? 0, 0, '76.09 interest/note settlements must close to 0');
  assert.equal(findLeaf('76.09')?.endCredit ?? 0, 0, '76.09 interest/note settlements must close to 0');
  assert.equal(findLeaf('76.41')?.endDebit ?? 0, 0, '76.41 alimony settlements must close to 0');
  assert.equal(findLeaf('76.41')?.endCredit ?? 0, 0, '76.41 alimony settlements must close to 0');
  assert.ok((findLeaf('51')?.endDebit ?? 0) > 0, '51 bank account must have positive debit balance');

  // Audit diagnostics: 0 remaining autofixable issues (and 0 total issues)
  const issues = runAuditDiagnostics({ db1C: null, operations: ops, osv: yearOsv });
  const autofixable = issues.filter((i) => i.canAutoFixBy1C);
  assert.equal(autofixable.length, 0, 'Expected 0 remaining autofixable audit issues');
  assert.equal(issues.length, 0, 'Expected 0 audit issues after autofix');

  // Subconto & AuditorHints invariants: 0 unoffset_advances warnings and 0 red subconto rows across ALL accounts
  const unoffsetHints = (yearOsv.auditorHints ?? []).filter((h) => h.checkType === 'unoffset_advances');
  assert.equal(
    unoffsetHints.length,
    0,
    `Expected 0 unoffset_advances hints, got: ${unoffsetHints.map((h) => h.title).join(' | ')}`
  );
  for (const [accCode, subs] of Object.entries(yearOsv.subcontoRowsByAccount ?? {})) {
    const redSubs = subs.filter((s) => s.hasRedEnd || s.hasRedStart);
    assert.equal(
      redSubs.length,
      0,
      `Expected 0 red subconto rows on ${accCode}, got: ${redSubs.map((s) => `${s.subcontoLabel} (${s.endDebit}/${s.endCredit})`).join(', ')}`
    );
  }

  // Account Card (movementsByAccount) invariants on leaf & synthetic group accounts (e.g. "51", "10", "60", "62", "90")
  for (const code of ['51', '10', '60', '62', '90']) {
    const movs = yearOsv.movementsByAccount?.[code] ?? [];
    assert.ok(movs.length > 0, `Expected Account Card movements for account ${code}`);
    const lastMov = movs[movs.length - 1];
    const row = yearOsv.rows.find((r) => r.code === code);
    assert.ok(row, `Expected OSV row for ${code}`);
    const rowNet = Math.round((row.endDebit - row.endCredit) * 100) / 100;
    assert.equal(
      lastMov.runningNet,
      rowNet,
      `Final Account Card runningNet on ${code} (${lastMov.runningNet}) must equal OSV row net (${rowNet})`
    );
  }
});

