import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoFixAllBy1CDb,
  autoFixSingleOperation,
  bindAndGenerateOperation,
  calculateOsvReport,
  computePendingNewCounterparties,
  doesOperationRequireCounterparty,
  getOperationCardProfile,
  recalculateOperationsChronologically,
  runAuditDiagnostics,
} from '../engine';
import {
  generateEducationalInnKpp,
  validateRussianInnChecksum,
} from '../egrul/egrulLookup';
import { buildExportBundle } from '../export1c';
import { parseFreeTextOrDelimitedOperations } from '../import1c';
import { QueuedOperation } from '../../types/accounting';

test('1. Cash withdrawal from bank («По чеку сняли денежные средства с расчетного счета») -> ПоступлениеНаличных (50.01 / 51), 0% VAT, no counterparty, 0 errors', () => {
  const drafts = parseFreeTextOrDelimitedOperations(
    '12.01.2026\tПо чеку сняли денежные средства с расчетного счета\t50 000',
    'Касса_январь.xlsx',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 1);

  const op = bindAndGenerateOperation(drafts[0], null, 'op-cash-withdraw', {
    priorOperations: [],
    reportingYear: 2026,
  });

  assert.equal(op.category, 'cash_bank_internal');
  assert.equal(op.docType1C, 'ПоступлениеНаличных');
  assert.equal(op.vatRate, 0);
  assert.equal(op.vatRule, 'none');
  assert.equal(op.vatAmount, 0);
  assert.equal(op.hasInvoiceSF, false);
  assert.equal(op.counterpartyName, '');
  assert.equal(doesOperationRequireCounterparty(op.category), false);
  assert.equal(op.readinessStatus, 'ready');
  assert.equal(op.entries.length, 1);
  assert.equal(op.entries[0].debit, '50.01');
  assert.equal(op.entries[0].credit, '51');
  assert.equal(op.entries[0].amount, 50000);

  const [inflowDraft] = parseFreeTextOrDelimitedOperations(
    '10.01.2026\tПоступил на расчетный счет вклад учредителя Петрова П.П. в уставный капитал\t100 000',
    'Банк_январь.xlsx',
    null,
    { reportingYear: 2026 }
  );
  const inflowOp = bindAndGenerateOperation(inflowDraft, null, 'op-bank-seed', {
    priorOperations: [],
    reportingYear: 2026,
  });

  const osv = calculateOsvReport({
    db1C: null,
    operations: [inflowOp, op],
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: [inflowOp, op], osv });
  assert.equal(
    issues.filter((i) => i.severity === 'error').length,
    0,
    `Expected 0 critical errors, got: ${issues.map((i) => i.title).join(', ')}`
  );
});

test('2. Accountable person issue («Выдано Федорову Ф.Ф. подотчет») -> ВыдачаНаличных (71.01 / 50.01), normalized FIO, accountable_71 profile, 0% VAT, excluded from INN center', () => {
  const drafts = parseFreeTextOrDelimitedOperations(
    [
      '10.01.2026\tПоступил в кассу вклад учредителя Сидорова С.С. в уставный капитал\t50 000',
      '14.01.2026\tВыдано Федорову Ф.Ф. подотчет\t15 000',
    ].join('\n'),
    'Касса_январь.xlsx',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 2);
  assert.equal(drafts[1].employeeName, 'Федоров Ф.Ф.');

  const seedCashOp = bindAndGenerateOperation(drafts[0], null, 'op-cash-seed', {
    priorOperations: [],
    reportingYear: 2026,
  });
  const op = bindAndGenerateOperation(drafts[1], null, 'op-71-issue', {
    priorOperations: [seedCashOp],
    reportingYear: 2026,
  });

  assert.equal(op.category, 'accountable_issue');
  assert.equal(op.docType1C, 'ВыдачаНаличных');
  assert.equal(getOperationCardProfile(op), 'accountable_71');
  assert.equal(op.employeeName, 'Федоров Ф.Ф.');
  assert.equal(op.counterpartyName, '');
  assert.equal(op.vatRate, 0);
  assert.equal(op.vatRule, 'none');
  assert.equal(op.hasInvoiceSF, false);
  assert.equal(op.readinessStatus, 'ready');
  assert.equal(op.entries.length, 1);
  assert.equal(op.entries[0].debit, '71.01');
  assert.equal(op.entries[0].credit, '50.01');
  assert.equal(op.entries[0].debitSubconto, 'Федоров Ф.Ф.');
  assert.equal(op.entries[0].amount, 15000);

  const pendingCps = computePendingNewCounterparties([seedCashOp, op], null);
  assert.equal(pendingCps.length, 0);

  const osv = calculateOsvReport({
    db1C: null,
    operations: [seedCashOp, op],
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: [seedCashOp, op], osv });
  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

test('3. Shipment («Поставлена продукция 226 шт Панель из ПВХ и МДФ по цене без НДС 1 500 руб.») -> РеализацияТоваровУслуг, +20% VAT on_top (406 800 ₽), auto-linked buyer from 62.02 advance & COGS from 43', () => {
  const rawText = [
    '10.01.2026\tПоступила на расчетный счет предоплата от покупателя ООО «Конкурент» по счету №5\t406 800',
    '18.01.2026\tВыпущена из производства готовая продукция Панель из ПВХ и МДФ 300 шт по себестоимости 900 руб.\t270 000',
    '25.01.2026\tПоставлена продукция 226 шт Панель из ПВХ и МДФ по цене без НДС 1 500 руб.',
  ].join('\n');

  const drafts = parseFreeTextOrDelimitedOperations(rawText, 'Продажи.xlsx', null, {
    reportingYear: 2026,
  });
  assert.equal(drafts.length, 3);

  // Verify parser extracted 226 * 1500 = 339 000 net with vatRule = 'on_top'
  assert.equal(drafts[2].quantity, 226);
  assert.equal(drafts[2].unitPrice, 1500);
  assert.equal(drafts[2].amount, 339000);
  assert.equal(drafts[2].vatRule, 'on_top');
  assert.equal(drafts[2].vatRate, 20);

  const built: QueuedOperation[] = [];
  drafts.forEach((d, idx) => {
    const op = bindAndGenerateOperation(d, null, `op-sale-chain-${idx + 1}`, {
      priorOperations: built,
      reportingYear: 2026,
    });
    built.push(op);
  });

  const saleOp = built[2];
  assert.equal(saleOp.category, 'sale_goods');
  assert.equal(saleOp.docType1C, 'РеализацияТоваровУслуг');
  assert.equal(saleOp.vatRule, 'on_top');
  assert.equal(saleOp.vatRate, 20);
  assert.equal(saleOp.vatAmount, 67800);
  assert.equal(saleOp.amount, 406800);
  assert.equal(saleOp.counterpartyName, 'ООО «Конкурент»');
  assert.notEqual(saleOp.readinessStatus, 'critical_error');
  assert.equal(saleOp.readinessStatus, 'needs_clarification');

  // Once buyer INN/KPP is filled, chronological recalculation propagates INN and autoFixAllBy1CDb promotes readinessStatus to 'ready'
  const edu = generateEducationalInnKpp('ООО «Конкурент»', 'ЮридическоеЛицо', '78');
  built[0].counterpartyInn = edu.inn;
  built[0].counterpartyKpp = edu.kpp;
  const recalced = recalculateOperationsChronologically(built, null, { reportingYear: 2026 });
  assert.equal(recalced[2].counterpartyInn, edu.inn);
  const fixedAll = autoFixAllBy1CDb({
    db1C: null,
    operations: recalced,
    calculateCurrentOsv: (ops) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        reportingYear: 2026,
        sourceMode: 'queued_only',
      }),
    periodEndDate: '2026-01-31',
    reportingYear: 2026,
  });
  assert.equal(fixedAll.operations.find((o) => o.id === saleOp.id)?.readinessStatus, 'ready');

  const offsetEntry = saleOp.entries.find(
    (e) => e.debit === '62.02' && e.credit === '62.01'
  );
  const revEntry = saleOp.entries.find(
    (e) => e.debit === '62.01' && e.credit === '90.01.1'
  );
  const vatEntry = saleOp.entries.find(
    (e) => e.debit === '90.03' && e.credit === '68.02'
  );
  const cogsEntry = saleOp.entries.find(
    (e) => e.debit === '90.02.1' && e.credit === '43'
  );

  assert.ok(offsetEntry, 'Expected advance offset 62.02 -> 62.01');
  assert.equal(offsetEntry.amount, 406800);
  assert.ok(revEntry, 'Expected revenue 62.01 -> 90.01.1');
  assert.equal(revEntry.amount, 406800);
  assert.ok(vatEntry, 'Expected VAT 90.03 -> 68.02');
  assert.equal(vatEntry.amount, 67800);
  assert.ok(cogsEntry, 'Expected COGS 90.02.1 -> 43');
  assert.equal(cogsEntry.amount, 203400);
});

test('4. Expense report (АвансовыйОтчет) and Founder contribution (75.01) have 0% VAT and never appear in INN/KPP center', () => {
  const drafts = parseFreeTextOrDelimitedOperations(
    [
      '05.01.2026\tПоступил на расчетный счет вклад учредителя Соколова А.В. в уставный капитал\t100 000',
      '20.01.2026\tУтвержден авансовый отчет Федорова Ф.Ф. за хозинвентарь\t12 000',
    ].join('\n'),
    'Учредитель_и_АО.xlsx',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 2);

  const ops = recalculateOperationsChronologically(
    drafts.map((d, i) =>
      bindAndGenerateOperation(d, null, `op-f-ao-${i + 1}`, {
        priorOperations: [],
        reportingYear: 2026,
      })
    ),
    null,
    { reportingYear: 2026 }
  );

  const founderOp = ops[0];
  assert.equal(founderOp.category, 'founder_contribution');
  assert.equal(founderOp.docType1C, 'ПоступлениеНаРасчетныйСчет');
  assert.equal(founderOp.counterpartyName, 'Соколов А.В.');
  assert.equal(founderOp.vatRate, 0);
  assert.equal(founderOp.entries[0].debit, '51');
  assert.equal(founderOp.entries[0].credit, '75.01');
  assert.equal(founderOp.entries[0].amount, 100000);

  const aoOp = ops[1];
  assert.equal(aoOp.category, 'expense_report');
  assert.equal(aoOp.docType1C, 'АвансовыйОтчет');
  assert.equal(aoOp.vatRate, 0);
  assert.equal(aoOp.entries[0].debit, '10.09');
  assert.equal(aoOp.entries[0].credit, '71.01');
  assert.equal(aoOp.entries[0].amount, 12000);

  const pendingCps = computePendingNewCounterparties(ops, null);
  assert.equal(pendingCps.length, 0);
});

test('5. Unknown text row falls back to neutral ОперацияБух (manual) with needs_clarification, 0% VAT, and 0 false counterparty errors', () => {
  const drafts = parseFreeTextOrDelimitedOperations(
    '28.01.2026\tПроведена сверка аналитических показателей по внутреннему распоряжению\t10 000',
    'Прочее.xlsx',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 1);

  const op = bindAndGenerateOperation(drafts[0], null, 'op-unknown', {
    priorOperations: [],
    reportingYear: 2026,
  });

  assert.equal(op.category, 'manual');
  assert.equal(op.docType1C, 'ОперацияБух');
  assert.notEqual(op.docType1C, 'ПоступлениеТоваровУслуг');
  assert.equal(op.vatRate, 0);
  assert.equal(op.vatRule, 'none');
  assert.equal(op.hasInvoiceSF, false);
  assert.equal(op.readinessStatus, 'needs_clarification');

  const osv = calculateOsvReport({
    db1C: null,
    operations: [op],
    reportingYear: 2026,
    sourceMode: 'queued_only',
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: [op], osv });
  assert.equal(
    issues.filter((i) => i.id.startsWith('missing-cp-name-')).length,
    0
  );
});

test('6. Legacy misclassified ПоступлениеТоваровУслуг cards are repaired by both autoFixSingleOperation and autoFixAllBy1CDb', () => {
  const [advanceDraft] = parseFreeTextOrDelimitedOperations(
    '10.01.2026\tПоступила оплата от покупателя ООО «Вектор» авансом\t406 800',
    'Банк.xlsx',
    null,
    { reportingYear: 2026 }
  );
  const advanceOp = bindAndGenerateOperation(advanceDraft, null, 'op-adv', {
    priorOperations: [],
    reportingYear: 2026,
  });
  const edu = generateEducationalInnKpp('ООО «Вектор»', 'ЮридическоеЛицо', '78');
  advanceOp.counterpartyInn = edu.inn;
  advanceOp.counterpartyKpp = edu.kpp;

  const makeBrokenLegacy = (
    id: string,
    date: string,
    description: string,
    amount: number
  ): QueuedOperation => {
    const base = bindAndGenerateOperation(
      {
        sourceFileName: 'legacy.xlsx',
        date,
        docNumber: '',
        description: 'Поступили товары от поставщика',
        amount: amount || 1000,
        counterpartyName: '',
        docTypeHint: 'ПоступлениеТоваровУслуг',
        categoryHint: 'purchase_goods',
      },
      null,
      id,
      { priorOperations: [], reportingYear: 2026 }
    );
    return {
      ...base,
      description,
      amount,
      counterpartyName: '',
      docType1C: 'ПоступлениеТоваровУслуг',
      category: 'purchase_goods',
      vatRate: 20,
      vatRule: 'included',
      hasInvoiceSF: true,
      readinessStatus: 'critical_error',
    };
  };

  const brokenCash = makeBrokenLegacy(
    'op-legacy-cash',
    '2026-01-11',
    'По чеку сняли денежные средства с расчетного счета',
    50000
  );
  const broken71 = makeBrokenLegacy(
    'op-legacy-71',
    '2026-01-12',
    'Выдано Федорову Ф.Ф. подотчет',
    15000
  );
  const brokenSale = makeBrokenLegacy(
    'op-legacy-sale',
    '2026-01-25',
    'Поставлена продукция 226 шт Панель из ПВХ и МДФ по цене без НДС 1 500 руб.',
    0
  );

  const calcOsv = (ops: QueuedOperation[]) =>
    calculateOsvReport({
      db1C: null,
      operations: ops,
      reportingYear: 2026,
      sourceMode: 'queued_only',
    });

  // A. Test single-card «Исправить» on brokenCash
  const singleRes = autoFixSingleOperation({
    operationId: 'op-legacy-cash',
    operations: [advanceOp, brokenCash, broken71, brokenSale],
    db1C: null,
    calculateCurrentOsv: calcOsv,
    periodEndDate: '2026-03-31',
    reportingYear: 2026,
  });
  assert.ok(singleRes.fixedCount >= 1, 'Expected autoFixSingleOperation to fix brokenCash');
  const fixedCashSingle = singleRes.operations.find((o) => o.id === 'op-legacy-cash')!;
  assert.equal(fixedCashSingle.docType1C, 'ПоступлениеНаличных');
  assert.equal(fixedCashSingle.category, 'cash_bank_internal');
  assert.equal(fixedCashSingle.vatRate, 0);
  assert.equal(fixedCashSingle.entries[0].debit, '50.01');
  assert.equal(fixedCashSingle.entries[0].credit, '51');

  // B. Test global «Исправить всё автоматически» on all 4 operations
  const allRes = autoFixAllBy1CDb({
    db1C: null,
    operations: [advanceOp, brokenCash, broken71, brokenSale],
    calculateCurrentOsv: calcOsv,
    periodEndDate: '2026-03-31',
    reportingYear: 2026,
  });

  assert.ok(allRes.fixedCount >= 3);
  const fixedCash = allRes.operations.find((o) => o.id === 'op-legacy-cash')!;
  const fixed71 = allRes.operations.find((o) => o.id === 'op-legacy-71')!;
  const fixedSale = allRes.operations.find((o) => o.id === 'op-legacy-sale')!;

  assert.equal(fixedCash.docType1C, 'ПоступлениеНаличных');
  assert.equal(fixed71.docType1C, 'ВыдачаНаличных');
  assert.equal(fixed71.employeeName, 'Федоров Ф.Ф.');
  assert.equal(fixedSale.docType1C, 'РеализацияТоваровУслуг');
  assert.equal(fixedSale.counterpartyName, 'ООО «Вектор»');
  assert.equal(fixedSale.amount, 406800);
  assert.equal(fixedSale.vatAmount, 67800);

  // Verify .bsl export builds cleanly without throwing
  const osvAfter = calcOsv(allRes.operations);
  const bundle = buildExportBundle({
    mode: 'incremental',
    db1C: null,
    operations: allRes.operations,
    osv: osvAfter,
    reportingYear: 2026,
  });
  assert.ok(bundle.bslCode.includes('ПоступлениеНаличных'));
  assert.ok(bundle.bslCode.includes('ВыдачаНаличных'));
  assert.ok(bundle.bslCode.includes('РеализацияТоваровУслуг'));
});

test('7. Educational INN/KPP generator produces deterministic 10-digit and 12-digit INNs passing official FNS checksum', () => {
  for (const company of ['ООО «Конкурент»', 'ООО «Ромашка»', 'АО «ТехноПром»']) {
    const gen = generateEducationalInnKpp(company, 'ЮридическоеЛицо', '78');
    assert.equal(gen.inn.length, 10);
    assert.equal(gen.kpp.length, 9);
    const check = validateRussianInnChecksum(gen.inn);
    assert.equal(check.valid, true, `Expected valid 10-digit INN for ${company}, got ${gen.inn}`);
  }

  const ipGen = generateEducationalInnKpp('ИП Смирнов А.А.', 'ИндивидуальныйПредприниматель', '78');
  assert.equal(ipGen.inn.length, 12);
  assert.equal(ipGen.kpp, '');
  const ipCheck = validateRussianInnChecksum(ipGen.inn);
  assert.equal(ipCheck.valid, true, `Expected valid 12-digit INN for IP, got ${ipGen.inn}`);
});
