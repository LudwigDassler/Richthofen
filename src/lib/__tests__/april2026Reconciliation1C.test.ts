import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { processBatchFiles } from '../import1c/batchFileParser';
import { parseBase0Json } from '../import1c/parseBase0Json';
import { calculateOsvReport } from '../engine/osvCalculator';
import { autoFixAllBy1CDb } from '../engine/auditAndAutofix';
import {
  bindAndGenerateOperation,
  rebindOperationsAgainst1CDb,
  recalculateOperationsChronologically,
} from '../engine/postingEngine';
import {
  buildVirtual1CStateTimeline,
  createInitialVirtual1CState,
} from '../engine/virtual1CState';
import { build1CTransferPackage, generateBslLoader } from '../export1c';
import { QueuedOperation } from '@/types/accounting';

function readAssetBuffer(relPath: string): ArrayBuffer {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function stripBslCommentsAndStrings(bsl: string): string {
  return bsl
    .split(/\r?\n/)
    .map((line) => {
      const noStrings = line.replace(/"(?:""|[^"])*"/g, '""');
      const commentIdx = noStrings.indexOf('//');
      return commentIdx >= 0 ? noStrings.slice(0, commentIdx) : noStrings;
    })
    .join('\n');
}

function countBslKeyword(cleanBsl: string, keyword: string): number {
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${keyword}(?=$|[^\\p{L}\\p{N}_])`, 'giu');
  return Array.from(cleanBsl.matchAll(re)).length;
}

test('April 2026 reconciliation (Part A): 60.02 advance transit, 41.01 resale goods, 97.21 SRO 31,250 RUB, 76.41 alimony writ, and bp30_legacy_pre2023 vs rf_2026 profiles', async () => {
  const q1Input = {
    name: 'Хоз.csv',
    buffer: readAssetBuffer('public/assets/aistudio/____09f9d030.csv'),
  };
  const q2Input = {
    name: 'Хоз(1).csv',
    buffer: readAssetBuffer('public/assets/aistudio/____1__443ffb42.csv'),
  };

  const batch = await processBatchFiles([q1Input, q2Input], null, {
    reportingYear: 2026,
  });

  // 1) Default profile 'rf_2026'
  const fixedRf2026 = autoFixAllBy1CDb({
    db1C: null,
    operations: batch.operations,
    calculateCurrentOsv: (ops, dateToOverride) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: dateToOverride || '2026-06-30',
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-06-30',
    reportingYear: 2026,
    calculationProfile: 'rf_2026',
    monthlyProfitTax: false,
  });

  // 2) Educational 1C:BP 3.0 pre-2023 profile 'bp30_legacy_pre2023'
  const recalcLegacy = recalculateOperationsChronologically(batch.operations, null, {
    reportingYear: 2026,
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });
  const fixedLegacy = autoFixAllBy1CDb({
    db1C: null,
    operations: recalcLegacy,
    calculateCurrentOsv: (ops, dateToOverride) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: dateToOverride || '2026-06-30',
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-06-30',
    reportingYear: 2026,
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });

  // Check 02.04.2026 prepayment of 1,236,900 RUB -> Dt 60.02 Kt 51
  const prepayOp = fixedLegacy.operations.find(
    (op) => op.date === '2026-04-02' && Math.abs(op.amount - 1236900) < 1
  );
  assert.ok(prepayOp, 'Expected 02.04.2026 supplier payment of 1,236,900 RUB');
  assert.ok(
    prepayOp.entries.some(
      (e) => e.debit === '60.02' && e.credit === '51' && Math.abs(e.amount - 1236900) < 0.01
    ),
    `Expected Dt 60.02 Kt 51 = 1,236,900 on 02.04.2026, got: ${JSON.stringify(prepayOp.entries)}`
  );

  // Check 03.04.2026 goods receipt -> 41.01 (1,030,750), 19.03 (206,150), and Dt 60.01 Kt 60.02 (1,236,900)
  const receiptOp = fixedLegacy.operations.find(
    (op) => op.date === '2026-04-03' && Math.abs(op.amount - 1236900) < 1
  );
  assert.ok(receiptOp, 'Expected 03.04.2026 goods receipt of 1,236,900 RUB');
  assert.ok(
    receiptOp.entries.some(
      (e) => e.debit === '41.01' && e.credit === '60.01' && Math.abs(e.amount - 1030750) < 0.01
    ),
    'Expected Dt 41.01 Kt 60.01 = 1,030,750'
  );
  assert.ok(
    receiptOp.entries.some(
      (e) => e.debit === '60.01' && e.credit === '60.02' && Math.abs(e.amount - 1236900) < 0.01
    ),
    `Expected automatic advance offset Dt 60.01 Kt 60.02 = 1,236,900, got: ${JSON.stringify(receiptOp.entries)}`
  );

  // Check 22.04.2026 resale of goods -> Dt 90.02.1 Kt 41.01 = 1,030,750
  const aprilOsvLegacy = calculateOsvReport({
    db1C: null,
    operations: fixedLegacy.operations,
    dateFrom: '2026-04-01',
    dateTo: '2026-04-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const acc4101 = aprilOsvLegacy.leafRows.find((a) => a.code === '41.01');
  assert.ok(acc4101, 'Expected account 41.01 in April OSV');
  assert.ok(Math.abs(acc4101.turnoverDebit - 1030750) < 0.01, `Expected 41.01 Dt 1,030,750, got ${acc4101.turnoverDebit}`);
  assert.ok(Math.abs(acc4101.turnoverCredit - 1030750) < 0.01, `Expected 41.01 Kt 1,030,750, got ${acc4101.turnoverCredit}`);
  assert.ok(Math.abs(acc4101.endDebit - acc4101.endCredit) < 0.01, `Expected 41.01 end balance 0, got ${acc4101.endDebit - acc4101.endCredit}`);

  // Compare April 2026 payroll in rf_2026 vs bp30_legacy_pre2023
  const aprilPayrollRf = fixedRf2026.operations.find(
    (op) => op.category === 'payroll_accrual' && op.date.startsWith('2026-04')
  );
  const aprilPayrollLegacy = fixedLegacy.operations.find(
    (op) => op.category === 'payroll_accrual' && op.date.startsWith('2026-04')
  );
  assert.ok(aprilPayrollRf && aprilPayrollLegacy, 'Expected April payroll operations in both profiles');

  const grossRf = aprilPayrollRf.entries
    .filter((e) => e.credit === '70')
    .reduce((s, e) => s + e.amount, 0);
  const grossLegacy = aprilPayrollLegacy.entries
    .filter((e) => e.credit === '70')
    .reduce((s, e) => s + e.amount, 0);

  assert.equal(grossRf.toFixed(2), '335654.55', 'rf_2026 must preserve pro-rata 335,654.55 RUB');
  assert.equal(grossLegacy.toFixed(2), '345500.00', 'bp30_legacy_pre2023 must accrue full monthly salaries 345,500.00 RUB');

  // Insurance contributions in bp30_legacy_pre2023: 34.2% split across 69.01 / 69.02.7 / 69.03.1 / 69.11, zero 69.09
  assert.equal(
    aprilPayrollLegacy.entries.some((e) => e.credit === '69.09'),
    false,
    'bp30_legacy_pre2023 must NOT post to 69.09'
  );
  const sum6901 = aprilPayrollLegacy.entries.filter((e) => e.credit === '69.01').reduce((s, e) => s + e.amount, 0);
  const sum69027 = aprilPayrollLegacy.entries.filter((e) => e.credit === '69.02.7').reduce((s, e) => s + e.amount, 0);
  const sum69031 = aprilPayrollLegacy.entries.filter((e) => e.credit === '69.03.1').reduce((s, e) => s + e.amount, 0);
  const sum6911 = aprilPayrollLegacy.entries.filter((e) => e.credit === '69.11').reduce((s, e) => s + e.amount, 0);
  assert.equal(sum6901.toFixed(2), '10019.50');
  assert.equal(sum69027.toFixed(2), '89830.00');
  assert.equal(sum69031.toFixed(2), '17620.50');
  assert.equal(sum6911.toFixed(2), '691.00');

  // Alimony writ deduction 76.41 = 20,000 RUB
  const alimonyEntry = aprilPayrollLegacy.entries.find(
    (e) => e.debit === '70' && e.credit === '76.41'
  );
  assert.ok(alimonyEntry, 'Expected Dt 70 Kt 76.41 alimony deduction in April payroll');
  assert.equal(alimonyEntry.amount.toFixed(2), '20000.00');

  // April closing: 97.21 SRO write-off = 31,250.00 RUB and monthly profit tax 99.02.1 posted on 2026-04-30
  const aprilClosingLegacy = fixedLegacy.operations.filter(
    (op) => op.category === 'closing' && op.date === '2026-04-30'
  );
  const aprilClosingRf = fixedRf2026.operations.filter(
    (op) => op.category === 'closing' && op.date === '2026-04-30'
  );
  const rbpAprilEntry = aprilClosingLegacy
    .flatMap((op) => op.entries)
    .find((e) => e.credit === '97.21');
  assert.ok(rbpAprilEntry, 'Expected 97.21 RBP write-off in April closing');
  assert.equal(rbpAprilEntry.amount.toFixed(2), '31250.00');

  const aprilProfitTaxLegacy = aprilClosingLegacy
    .flatMap((op) => op.entries)
    .find((e) => e.debit === '99.02.1' && e.credit === '68.04.1');
  assert.ok(
    aprilProfitTaxLegacy && aprilProfitTaxLegacy.amount > 0,
    'bp30_legacy_pre2023 must accrue monthly profit tax 99.02.1 in April'
  );

  const aprilProfitTaxRf = aprilClosingRf
    .flatMap((op) => op.entries)
    .find((e) => e.debit === '99.02.1' && e.credit === '68.04.1');
  assert.equal(
    aprilProfitTaxRf,
    undefined,
    'rf_2026 (monthlyProfitTax=false) must keep quarterly profit tax only'
  );
});

test('Chronological partial debt + advance split on 60.01/60.02 and 62.01/62.02 & Base 0 April seeding', () => {
  // 1) Partial supplier debt 100,000 + payment 150,000 -> 100,000 (60.01) + 50,000 (60.02)
  const ops: QueuedOperation[] = [
    bindAndGenerateOperation(
      {
        sourceFileName: 'Test',
        date: '2026-04-05',
        description: 'Поступили материалы от ООО «Альфа» на сумму 100 000 руб. без НДС',
        amount: 100000,
        vatRate: 0,
        vatAmount: 0,
        vatRule: 'none',
        counterpartyName: 'ООО «Альфа»',
      },
      null,
      'op-ptu-1'
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'Test',
        date: '2026-04-06',
        description: 'Перечислено с расчетного счета поставщику ООО «Альфа» 150 000 руб. без НДС',
        amount: 150000,
        vatRate: 0,
        vatAmount: 0,
        vatRule: 'none',
        counterpartyName: 'ООО «Альфа»',
      },
      null,
      'op-pay-1'
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'Test',
        date: '2026-04-10',
        description: 'Оказаны услуги покупателю ООО «Бета» на сумму 120 000 руб., в т.ч. НДС 20%',
        amount: 120000,
        vatRate: 20,
        vatAmount: 20000,
        vatRule: 'included',
        counterpartyName: 'ООО «Бета»',
      },
      null,
      'op-sale-1'
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'Test',
        date: '2026-04-11',
        description: 'Поступила оплата от покупателя ООО «Бета» на расчетный счет 240 000 руб., в т.ч. НДС 20%',
        amount: 240000,
        vatRate: 20,
        vatAmount: 40000,
        vatRule: 'included',
        counterpartyName: 'ООО «Бета»',
      },
      null,
      'op-rcpt-1'
    ),
  ];

  const recalculated = recalculateOperationsChronologically(ops, null, {
    reportingYear: 2026,
  });

  const payEntries = recalculated[1].entries;
  assert.ok(
    payEntries.some((e) => e.debit === '60.01' && e.credit === '51' && Math.abs(e.amount - 100000) < 0.01),
    'Expected Dt 60.01 Kt 51 = 100,000'
  );
  assert.ok(
    payEntries.some((e) => e.debit === '60.02' && e.credit === '51' && Math.abs(e.amount - 50000) < 0.01),
    'Expected Dt 60.02 Kt 51 = 50,000 excess advance'
  );

  const rcptEntries = recalculated[3].entries;
  assert.ok(
    rcptEntries.some((e) => e.debit === '51' && e.credit === '62.01' && Math.abs(e.amount - 120000) < 0.01),
    'Expected Dt 51 Kt 62.01 = 120,000'
  );
  assert.ok(
    rcptEntries.some((e) => e.debit === '51' && e.credit === '62.02' && Math.abs(e.amount - 120000) < 0.01),
    'Expected Dt 51 Kt 62.02 = 120,000 buyer advance'
  );
  assert.ok(
    rcptEntries.some((e) => e.debit === '76.АВ' && e.credit === '68.02' && Math.abs(e.amount - 20000) < 0.01),
    'Expected Dt 76.АВ Kt 68.02 = 20,000 VAT ONLY on the 120,000 advance part'
  );

  // 2) Base 0 as of 2026-04-01 with 968,750 RUB balance on 97.21 and writ of execution
  const base0Json = JSON.stringify({
    ФорматБазы0: 'bp30-base0-v1',
    ОтчетныйГод: 2026,
    ДатаОстатков: '2026-04-01',
    usesLegacyPayrollAccounts: true,
    payrollAccounts69: ['69.01', '69.02.7', '69.03.1', '69.11'],
    Организация: { Наименование: 'ООО «Вектор»', ИНН: '7810000001', КПП: '781001001' },
    ВсеСправочники: {
      РасходыБудущихПериодов: [
        {
          Код: '000000001',
          Наименование: 'Взнос в компенсационный фонд СРО',
          Сумма: 1000000,
          ДатаНачалаСписания: '2026-03-01',
          ДатаОкончанияСписания: '2028-10-31',
        },
      ],
      ИсполнительныеЛисты: [
        {
          Сотрудник: 'Валеев В.В.',
          Получатель: 'Валеева О.Г.',
          Размер: 20000,
          ДействуетС: '2026-03-01',
          ДействуетПо: '2026-12-31',
          Дата: '2026-03-10',
        },
      ],
    },
    НачальныеОстатки: [
      {
        Счет: '97.21',
        НаименованиеСчета: 'Прочие расходы будущих периодов',
        Субконто1: 'Взнос в компенсационный фонд СРО',
        СальдоНачДт: 968750,
        СальдоНачКт: 0,
      },
    ],
  });
  const db1C = parseBase0Json(base0Json, 'base0_april.json');
  const vState = createInitialVirtual1CState(db1C);
  const deferredList = vState.deferredExpenses ?? [];
  assert.equal(deferredList.length, 1);
  assert.equal(deferredList[0].monthlyAmount?.toFixed(2), '31250.00');
  assert.equal(vState.writsOfExecution.length, 1);
  assert.equal(vState.writsOfExecution[0].fixedAmount, 20000);
  assert.equal(vState.writsOfExecution[0].recipientName, 'Валеева О.Г.');

  const reboundSample = rebindOperationsAgainst1CDb(ops.slice(0, 1), db1C, {
    reportingYear: 2026,
    calculationProfile: 'bp30_legacy_pre2023',
  });
  assert.equal(reboundSample.length, 1);
  assert.ok(reboundSample[0].entries.length > 0);

  const aprilFromBase0Fixed = autoFixAllBy1CDb({
    db1C,
    operations: reboundSample,
    calculateCurrentOsv: (currOps, dateToOverride) =>
      calculateOsvReport({
        db1C,
        operations: currOps,
        dateFrom: '2026-04-01',
        dateTo: dateToOverride || '2026-04-30',
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-04-30',
    reportingYear: 2026,
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });
  const base0RbpWriteOff = aprilFromBase0Fixed.operations
    .filter((o) => o.category === 'closing' && o.date === '2026-04-30')
    .flatMap((o) => o.entries)
    .find((e) => e.credit === '97.21');
  assert.ok(base0RbpWriteOff, 'Expected 97.21 write-off in April closing when starting from Base 0 as of 2026-04-01');
  assert.equal(base0RbpWriteOff.amount.toFixed(2), '31250.00');
});

test('Part B BSL Generator & Package: metadata ВидОперации before РасшифровкаПлатежа, СпособЗачетаАвансов, manual duplicate guard, normalized counterparty/contract reuse, taxes_all guard, and ИсполнительныйЛист', async () => {
  const q1Input = {
    name: 'Хоз.csv',
    buffer: readAssetBuffer('public/assets/aistudio/____09f9d030.csv'),
  };
  const q2Input = {
    name: 'Хоз(1).csv',
    buffer: readAssetBuffer('public/assets/aistudio/____1__443ffb42.csv'),
  };
  const batch = await processBatchFiles([q1Input, q2Input], null, { reportingYear: 2026 });
  const { finalState } = buildVirtual1CStateTimeline(null, batch.operations);
  const pkg = build1CTransferPackage(batch.operations, null, finalState, {
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });

  assert.equal(pkg.meta.usesLegacyPayrollAccounts, true);

  const writDoc = pkg.documents.find((d) => d.metaType1C === 'ИсполнительныйЛист');
  assert.ok(writDoc, 'Expected ИсполнительныйЛист document in package');
  assert.equal(writDoc.header.alimonyFixedAmount, 20000);
  assert.ok(writDoc.header.writStartDate?.startsWith('2026-'), 'Expected writStartDate');
  assert.equal(writDoc.header.writEndDate, '2026-12-31');
  assert.ok(writDoc.header.counterpartyKey.length > 0, 'Expected recipient counterpartyKey on ИсполнительныйЛист');
  const writRecipient = pkg.catalogs.counterparties.find((c) => c.key === writDoc.header.counterpartyKey);
  assert.ok(writRecipient && /валеева/iu.test(writRecipient.name), 'Expected Валеева О.Г. in counterparties catalog');

  const bsl = generateBslLoader({ defaultReportingYear: 2026 });
  const cleanBsl = stripBslCommentsAndStrings(bsl);

  // Strict BSL syntax checks
  assert.equal(
    countBslKeyword(cleanBsl, 'Процедура'),
    countBslKeyword(cleanBsl, 'КонецПроцедуры'),
    'Unbalanced Процедура / КонецПроцедуры'
  );
  assert.equal(
    countBslKeyword(cleanBsl, 'Функция'),
    countBslKeyword(cleanBsl, 'КонецФункции'),
    'Unbalanced Функция / КонецФункции'
  );
  assert.equal(
    countBslKeyword(cleanBsl, 'Если'),
    countBslKeyword(cleanBsl, 'КонецЕсли'),
    'Unbalanced Если / КонецЕсли'
  );
  assert.equal(
    countBslKeyword(cleanBsl, 'Цикл'),
    countBslKeyword(cleanBsl, 'КонецЦикла'),
    'Unbalanced Цикл / КонецЦикла'
  );
  assert.equal(
    countBslKeyword(cleanBsl, 'Попытка'),
    countBslKeyword(cleanBsl, 'КонецПопытки'),
    'Unbalanced Попытка / КонецПопытки'
  );
  assert.equal(
    countBslKeyword(cleanBsl, 'Знач'),
    0,
    'Reserved word Знач must never be used in BSL'
  );
  assert.equal(cleanBsl.includes('.Выбрать('), false, 'Must not use .Выбрать( in BSL queries');

  // Verify all Part B + anti-hang mechanisms in BSL
  assert.equal(countBslKeyword(cleanBsl, 'Пока'), 0, 'Must contain zero Пока loops in BSL');
  assert.ok(bsl.includes('ПропускатьСуществующиеРучныеДокументы'), 'Missing form flag ПропускатьСуществующиеРучныеДокументы');
  assert.ok(bsl.includes('Функция УстановитьВидОперацииНапрямую('), 'Missing direct ВидОперации helper');
  assert.equal(
    bsl.includes('ЗначенияПеречисления'),
    false,
    'ВидОперации must NOT iterate metadata ЗначенияПеречисления collections'
  );
  assert.ok(bsl.includes('Процедура УстановитьАвтоЗачетАвансовДокумента('), 'Missing СпособЗачетаАвансов helper');
  assert.ok(bsl.includes('Функция НайтиСуществующийРучнойДубльДокумента('), 'Missing manual duplicate lookup helper');
  assert.ok(
    bsl.includes('ВЫБРАТЬ ПЕРВЫЕ 1 Док.Ссылка КАК Ссылка ИЗ Документ.'),
    'Manual duplicate check must use targeted ВЫБРАТЬ ПЕРВЫЕ 1 Док.Ссылка query'
  );
  assert.ok(bsl.includes('Функция НормализоватьИмяКонтрагентаДляПоиска('), 'Missing counterparty normalizer helper');
  assert.ok(bsl.includes('ОсновнойДоговорКонтрагента'), 'Missing contract reuse check');
  assert.ok(
    bsl.includes('ВЫБРАТЬ ПЕРВЫЕ 1 Движ.Регистратор КАК Регистратор ИЗ РегистрБухгалтерии.Хозрасчетный'),
    'Same-day taxes_all guard must use single ВЫБРАТЬ ПЕРВЫЕ 1 Движ.Регистратор query'
  );
  assert.ok(bsl.includes('alimonyFixedAmount'), 'Missing ИсполнительныйЛист fixed amount mapping');

  // Verify period cutoff executes strictly BEFORE Richthofen duplicate check, catalog preparation, and manual duplicate check
  const loadProcStart = bsl.indexOf('Процедура ЗагрузитьПакетНаСервере(');
  const loadLoopStart = bsl.indexOf('Для Каждого ДокЭл Из МассивДокументов Цикл', loadProcStart);
  const loadLoopSlice = bsl.slice(loadLoopStart);
  const periodCutoffIdx = loadLoopSlice.indexOf('ДатаДокПроверка > ДатаОкончанияЗагрузки');
  const tagDupIdx = loadLoopSlice.indexOf('НайтиСтатусДубляПоТегуRichthofen(ЦелевойВидДляПроверки');
  const prepCatIdx = loadLoopSlice.indexOf('ПодготовитьСправочникиДляДокументаПакета(');
  const manualDupIdx = loadLoopSlice.indexOf('НайтиСуществующийРучнойДубльДокумента(');
  assert.ok(
    periodCutoffIdx > 0 &&
      tagDupIdx > periodCutoffIdx &&
      prepCatIdx > tagDupIdx &&
      manualDupIdx > prepCatIdx,
    'ПериодС..ПериодПо cutoff must precede tag duplicate check, catalog lookup/creation, and manual duplicate check'
  );

  // Ensure in cash receipt/disbursement branches УстановитьВидОперацииНапрямую comes BEFORE РасшифровкаПлатежа.Очистить()
  const pkoSectionIdx = bsl.indexOf('ВидМета = "ПриходныйКассовыйОрдер"');
  assert.ok(pkoSectionIdx > 0);
  const cashSlice = bsl.slice(pkoSectionIdx, bsl.indexOf('ВидМета = "АвансовыйОтчет"'));
  const firstProchPrihod = cashSlice.indexOf('УстановитьВидОперацииНапрямую(ДокОбъект, ВидМета, "ПрочийПриход")');
  const afterProchPrihodClear = cashSlice.indexOf('ДокОбъект.РасшифровкаПлатежа.Очистить()', firstProchPrihod);
  assert.ok(
    firstProchPrihod > 0 && afterProchPrihodClear > firstProchPrihod,
    'ПрочийПриход ВидОперации must be set BEFORE РасшифровкаПлатежа.Очистить()'
  );
  const firstProchRashod = cashSlice.indexOf('УстановитьВидОперацииНапрямую(ДокОбъект, ВидМета, "ПрочийРасход")');
  const afterProchRashodClear = cashSlice.indexOf('ДокОбъект.РасшифровкаПлатежа.Очистить()', firstProchRashod);
  assert.ok(
    firstProchRashod > 0 && afterProchRashodClear > firstProchRashod,
    'ПрочийРасход ВидОперации must be set BEFORE РасшифровкаПлатежа.Очистить()'
  );
});
