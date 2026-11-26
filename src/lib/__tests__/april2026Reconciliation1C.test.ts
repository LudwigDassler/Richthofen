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
  assert.ok(bsl.includes('Функция НайтиВидОперацииПоМетаданным(Док, КандидатыИменИСинонимов)'), 'Missing metadata ВидОперации helper');
  assert.ok(bsl.includes('Функция УстановитьВидОперацииДокумента(ДокОбъект, КаноническийВид)'), 'Missing УстановитьВидОперацииДокумента helper');
  assert.ok(bsl.includes('Функция НайтиПогашениеЗадолженностиАвтоматически(Док)'), 'Missing ПогашениеЗадолженности helper');
  assert.ok(bsl.includes('Функция ЗаполнитьРасшифровкуПлатежаКонтрагента('), 'Missing РасшифровкаПлатежа helper');
  assert.ok(bsl.includes('Функция СформироватьДампПолейДокумента(Док)'), 'Missing draft field dump helper');
  assert.ok(bsl.includes('Процедура УстановитьАвтоЗачетАвансовДокумента('), 'Missing СпособЗачетаАвансов helper');
  assert.ok(bsl.includes('Функция НайтиСуществующийРучнойДубльДокумента('), 'Missing manual duplicate lookup helper');
  assert.ok(
    bsl.includes('ВЫБРАТЬ ПЕРВЫЕ 20 Док.Ссылка КАК Ссылка') && bsl.includes('ИЗ Документ.'),
    'Business-key & manual duplicate check must use bounded ВЫБРАТЬ ПЕРВЫЕ 20 Док.Ссылка query'
  );
  assert.ok(bsl.includes('Функция НормализоватьИмяКонтрагентаДляПоиска('), 'Missing counterparty normalizer helper');
  assert.ok(bsl.includes('ОсновнойДоговорКонтрагента'), 'Missing contract reuse check');
  assert.ok(
    bsl.includes('ВЫБРАТЬ ПЕРВЫЕ 1 Движ.Регистратор КАК Регистратор ИЗ РегистрБухгалтерии.Хозрасчетный'),
    'Same-day taxes_all guard must use single ВЫБРАТЬ ПЕРВЫЕ 1 Движ.Регистратор query'
  );
  assert.ok(bsl.includes('alimonyFixedAmount'), 'Missing ИсполнительныйЛист fixed amount mapping');

  // Verify period cutoff executes strictly BEFORE catalog preparation and natural business-key duplicate checks
  const loadProcStart = bsl.indexOf('Процедура ЗагрузитьПакетНаСервере(');
  const loadLoopStart = bsl.indexOf('Для Каждого ДокЭл Из МассивДокументов Цикл', loadProcStart);
  const loadLoopSlice = bsl.slice(loadLoopStart);
  const periodCutoffIdx = loadLoopSlice.indexOf('ДатаДокПроверка > ДатаОкончанияЗагрузки');
  const prepCatIdx = loadLoopSlice.indexOf('ПодготовитьСправочникиДляДокументаПакета(');
  const bizDupIdx = loadLoopSlice.indexOf('НайтиСтатусДубляПоБизнесКлючу(ЦелевойВидДляПроверки');
  const manualDupIdx = loadLoopSlice.indexOf('НайтиСуществующийРучнойДубльДокумента(');
  assert.ok(
    periodCutoffIdx > 0 &&
      prepCatIdx > periodCutoffIdx &&
      bizDupIdx > prepCatIdx &&
      manualDupIdx > bizDupIdx,
    'ПериодС..ПериодПо cutoff must precede catalog preparation, business-key duplicate check, and manual duplicate check'
  );

  // Ensure in bank and cash branches УстановитьВидОперацииДокумента comes strictly BEFORE bank account / СчетУчета and BEFORE РасшифровкаПлатежа
  const createNativeStart = bsl.indexOf('Функция СоздатьНативныйДокумент1С(');
  assert.ok(createNativeStart > 0);
  const bankInIdx = bsl.indexOf('ИначеЕсли ВидМета = "ПоступлениеНаРасчетныйСчет" Тогда', createNativeStart);
  const bankOutIdx = bsl.indexOf('ИначеЕсли ВидМета = "СписаниеСРасчетногоСчета" Тогда', bankInIdx);
  const pkoSectionIdx = bsl.indexOf('ИначеЕсли ВидМета = "ПриходныйКассовыйОрдер"', bankOutIdx);
  const aoSectionIdx = bsl.indexOf('ИначеЕсли ВидМета = "АвансовыйОтчет" Тогда', pkoSectionIdx);
  assert.ok(bankInIdx > 0 && bankOutIdx > bankInIdx && pkoSectionIdx > bankOutIdx && aoSectionIdx > pkoSectionIdx);

  const bankOutSlice = bsl.slice(bankOutIdx, pkoSectionIdx);
  const bankOutSetVO = bankOutSlice.indexOf('УстановитьВидОперацииДокумента(ДокОбъект,');
  const bankOutSetAccOrg = bankOutSlice.indexOf('ЗаполнитьБанковскиеСчетаШапкиПоМетаданным(ДокОбъект, БанкСчетОргС)');
  const bankOutFillRassh = bankOutSlice.indexOf('ЗаполнитьРасшифровкуПлатежаКонтрагента(ДокОбъект,');
  assert.ok(
    bankOutSetVO > 0 && bankOutSetAccOrg > bankOutSetVO && bankOutFillRassh > bankOutSetAccOrg,
    'СписаниеСРасчетногоСчета must set ВидОперации BEFORE ЗаполнитьБанковскиеСчетаШапкиПоМетаданным and BEFORE ЗаполнитьРасшифровкуПлатежаКонтрагента'
  );

  const cashSlice = bsl.slice(pkoSectionIdx, aoSectionIdx);
  assert.ok(
    cashSlice.includes('ЗаполнитьБанковскиеСчетаШапкиПоМетаданным(ДокОбъект, БанкСчетПКО)'),
    'ПКО (ПолучениеНаличныхВБанке) must populate bank account attributes via ЗаполнитьБанковскиеСчетаШапкиПоМетаданным'
  );
  assert.ok(
    cashSlice.includes('ЗаполнитьКассуОрганизацииЕслиЕсть(ДокОбъект, ОргСсылка)'),
    'Cash orders must populate Касса via ЗаполнитьКассуОрганизацииЕслиЕсть'
  );
  const pkoSetVO = cashSlice.indexOf('УстановитьВидОперацииДокумента(ДокОбъект, РежимВидПКО)');
  const pkoSetAcc = cashSlice.indexOf('УстановитьСчетУчетаДенежныхСредствПоМетаданным(ДокОбъект, НайтиСчет("50.01"))');
  const pkoClearRassh = cashSlice.indexOf('ДокОбъект.РасшифровкаПлатежа.Очистить()', pkoSetVO);
  assert.ok(
    pkoSetVO > 0 && pkoSetAcc > pkoSetVO && pkoClearRassh > pkoSetAcc,
    'ПКО must set ВидОперации BEFORE metadata СчетУчета (50.01) and BEFORE РасшифровкаПлатежа'
  );

  const rkoSetVO = cashSlice.indexOf('УстановитьВидОперацииДокумента(ДокОбъект, РежимВидРКО)');
  const rkoSetAcc = cashSlice.indexOf(
    'УстановитьСчетУчетаДенежныхСредствПоМетаданным(ДокОбъект, НайтиСчет("50.01"))',
    rkoSetVO
  );
  const rkoSetCorr70 = cashSlice.indexOf(
    'УстановитьКоррСчетБанкаКассыПоМетаданным(ДокОбъект, СчЗПКасса, Ложь, Истина',
    rkoSetVO
  );
  assert.ok(
    rkoSetVO > 0 && rkoSetAcc > rkoSetVO && rkoSetCorr70 > rkoSetAcc,
    'РКО must set ВидОперации BEFORE metadata СчетУчета (50.01) and BEFORE ПрочийРасход 70 correspondent account'
  );

  // Verify ОперацияБух duplicate detection queries РегистрБухгалтерии.Хозрасчетный (Период МЕЖДУ &НачДня И &КонДня, Активность = ИСТИНА, ±1 ruble) and never touches ОперацияБух.Проведен
  const opDupStart = bsl.indexOf('Функция НайтиРучнойДубльОперацииПоПроводкам(');
  assert.ok(opDupStart > 0, 'Missing НайтиРучнойДубльОперацииПоПроводкам');
  const opDupBody = bsl.slice(opDupStart, bsl.indexOf('КонецФункции', opDupStart));
  assert.match(opDupBody, /РегистрБухгалтерии\.Хозрасчетный/u);
  assert.match(opDupBody, /Движ\.Период\s+МЕЖДУ\s+&НачДня\s+И\s+&КонДня/u);
  assert.match(opDupBody, /Движ\.Организация\s*=\s*&Организация/u);
  assert.match(opDupBody, /Движ\.Активность\s*=\s*ИСТИНА/u);
  assert.match(opDupBody, /СумБД\s*<\s*\(СумЖ\s*-\s*1\)\s+Или\s+СумБД\s*>\s*\(СумЖ\s*\+\s*1\)/u);
  assert.equal(opDupBody.includes('.Проведен'), false, 'ОперацияБух duplicate check must not access .Проведен');

  // 1) Verify payroll RKO checks live 50.01 debit balance and auto-posts paired ПКО (ПолучениеНаличныхВБанке, Дт 50.01 Кт 51) at -1 min with clean Комментарий = "" and metadata bank account
  const cashReplStart = bsl.indexOf('Функция ОбеспечитьНаличныеВКассеПодВыплатуЗП(');
  assert.ok(cashReplStart > 0, 'Missing ОбеспечитьНаличныеВКассеПодВыплатуЗП');
  const cashReplBody = bsl.slice(cashReplStart, bsl.indexOf('КонецФункции', cashReplStart));
  assert.match(
    cashReplBody,
    /РегистрБухгалтерии\.Хозрасчетный\.Остатки\(&ГраницаКассы,\s*Счет\s*=\s*&Счет5001,\s*,\s*Организация\s*=\s*&Организация\)/u
  );
  assert.ok(cashReplBody.includes('"ПолучениеНаличныхВБанке"'), 'Cash replenishment PKO must search ПолучениеНаличныхВБанке');
  assert.ok(cashReplBody.includes('"Получение наличных в банке"'), 'Cash replenishment PKO must search synonym Получение наличных в банке');
  assert.ok(cashReplBody.includes('НайтиВидОперацииПоМетаданным(ШаблонПКО, КандВОПКО)'), 'Cash replenishment PKO must use НайтиВидОперацииПоМетаданным');
  assert.ok(cashReplBody.includes('ДатаПКО = ДатаРКО - 60;'), 'Cash replenishment PKO must be created 1 minute earlier than RKO');
  assert.ok(cashReplBody.includes('ПКО.Комментарий = "";'), 'Cash replenishment PKO must set ПКО.Комментарий = ""');
  assert.ok(cashReplBody.includes('УстановитьСчетУчетаДенежныхСредствПоМетаданным(ПКО, Счет5001)'), 'Cash replenishment PKO must set 50.01');
  assert.ok(cashReplBody.includes('УстановитьЕслиЕсть(ПКО, "СчетКредита", Счет51)'), 'Cash replenishment PKO must set СчетКредита = 51');
  assert.ok(cashReplBody.includes('ЗаполнитьБанковскиеСчетаШапкиПоМетаданным(ПКО, ОсновнойБанковскийСчет)'), 'Cash replenishment PKO must populate bank account fields via metadata');
  assert.ok(cashReplBody.includes('ЗаполнитьКассуОрганизацииЕслиЕсть(ПКО, ОргСсылка)'), 'Cash replenishment PKO must set Касса');
  assert.ok(cashReplBody.includes('УстановитьЕслиЕсть(ПКО, "ВалютаДокумента", ВалютаРуб)'), 'Cash replenishment PKO must set ВалютаДокумента');
  assert.ok(cashReplBody.includes('ПКО.Записать(РежимЗаписиДокумента.Проведение)'), 'Cash replenishment PKO must be posted');
  assert.ok(
    bsl.includes('ОбеспечитьНаличныеВКассеПодВыплатуЗП(ОргСсылка, ДокОбъект.Дата, СуммаШапки'),
    'СоздатьНативныйДокумент1С must invoke ОбеспечитьНаличныеВКассеПодВыплатуЗП before posting payroll RKO'
  );

  // 2) Verify live advance/debt balance contract lookup (62.02 for РТУ, 60.02 for ПТУ, 60.01/62.01 for payments) before ОсновнойДоговорКонтрагента fallback
  const contractByBalStart = bsl.indexOf('Функция НайтиДоговорПоОстаткамНаДату(');
  assert.ok(contractByBalStart > 0, 'Missing НайтиДоговорПоОстаткамНаДату');
  const contractByBalBody = bsl.slice(contractByBalStart, bsl.indexOf('КонецФункции', contractByBalStart));
  assert.match(
    contractByBalBody,
    /РегистрБухгалтерии\.Хозрасчетный\.Остатки\(&ДатаДок,\s*Счет\s+В\s*\(&СчетаАвансовИДолга\),\s*,\s*Организация\s*=\s*&Организация\s+И\s+Субконто1\s*=\s*&Контрагент\)/u
  );
  assert.ok(contractByBalBody.includes('Ост.Субконто2 КАК Договор'), 'Contract balance query must extract Субконто2 (Договор)');

  const pickContractStart = bsl.indexOf('Функция ПодобратьДоговорПоЖивомуСальдоИлиОсновной(');
  assert.ok(pickContractStart > 0, 'Missing ПодобратьДоговорПоЖивомуСальдоИлиОсновной');
  const pickContractBody = bsl.slice(pickContractStart, bsl.indexOf('КонецФункции', pickContractStart));
  const queryBalCallIdx = pickContractBody.indexOf('НайтиДоговорПоОстаткамНаДату(');
  const mainContractFallbackIdx = pickContractBody.indexOf('КонтрагентСсылка.ОсновнойДоговорКонтрагента');
  assert.ok(
    queryBalCallIdx > 0 && mainContractFallbackIdx > queryBalCallIdx,
    'ПодобратьДоговорПоЖивомуСальдоИлиОсновной must check Хозрасчетный.Остатки BEFORE falling back to ОсновнойДоговорКонтрагента'
  );
  assert.ok(pickContractBody.includes('НайтиСчет("62.02")') && pickContractBody.includes('НайтиСчет("60.02")'));
  assert.ok(pickContractBody.includes('НайтиСчет("62.01")') && pickContractBody.includes('НайтиСчет("60.01")'));

  // Ensure ПТУ, РТУ, ПоступлениеНаРасчетныйСчет, and СписаниеСРасчетногоСчета all resolve contracts via ПодобратьДоговорПоЖивомуСальдоИлиОсновной
  assert.ok(
    bsl.includes('ПодобратьДоговорПоЖивомуСальдоИлиОсновной(КонтрСсылка, ОргСсылка, ДатаДок, ДогСсылка, "СПоставщиком", "ПТУ"'),
    'ПоступлениеТоваровУслуг must select supplier contract by live 60.02 balance'
  );
  assert.ok(
    bsl.includes('ПодобратьДоговорПоЖивомуСальдоИлиОсновной(КонтрСсылка, ОргСсылка, ДатаДок, ДогСсылка, "СПокупателем", "РТУ"'),
    'РеализацияТоваровУслуг must select buyer contract by live 62.02 balance'
  );
  assert.ok(
    bsl.includes('ПодобратьДоговорПоЖивомуСальдоИлиОсновной(КонтрСсылка, ОргСсылка, ДатаДок, ДогСсылка, "СПокупателем", "ОплатаОтПокупателя"'),
    'ПоступлениеНаРасчетныйСчет must select buyer contract by live 62.01/62.02 balance'
  );
  assert.ok(
    bsl.includes('ПодобратьДоговорПоЖивомуСальдоИлиОсновной(КонтрСсылка, ОргСсылка, ДатаДок, ДогСсылка, "СПоставщиком", "ОплатаПоставщику"'),
    'СписаниеСРасчетногоСчета must select supplier contract by live 60.01/60.02 balance'
  );

  // 3) Verify 1-pass non-recursive chronological re-posting of ПоступлениеТоваровУслуг & РеализацияТоваровУслуг at the end of ЗагрузитьПакетНаСервере
  const repostStart = bsl.indexOf('Функция ПерепровестиПоступленияИРеализацииПериода(');
  assert.ok(repostStart > 0, 'Missing ПерепровестиПоступленияИРеализацииПериода');
  const repostBody = bsl.slice(bsl.indexOf('\n', repostStart) + 1, bsl.indexOf('КонецФункции', repostStart));
  assert.ok(repostBody.includes('ИЗ Документ.ПоступлениеТоваровУслуг'), 'Chronological repost must include ПоступлениеТоваровУслуг');
  assert.ok(repostBody.includes('ИЗ Документ.РеализацияТоваровУслуг'), 'Chronological repost must include РеализацияТоваровУслуг');
  assert.ok(repostBody.includes('УПОРЯДОЧИТЬ ПО Дата ВОЗР'), 'Chronological repost must sort ascending by Дата');
  assert.equal(
    repostBody.includes('ПерепровестиПоступленияИРеализацииПериода('),
    false,
    'ПерепровестиПоступленияИРеализацииПериода must be single-pass with zero recursion'
  );
  assert.ok(
    loadLoopSlice.includes('ПерепровестиПоступленияИРеализацииПериода(ОргСсылка, НачПерПерепров, КонПерПерепров'),
    'ЗагрузитьПакетНаСервере must invoke ПерепровестиПоступленияИРеализацииПериода after main document loop'
  );
});

test('Final 5 April 2026 live-run fixes: (1) zero tags/empty Комментарий, (2) ПогашениеЗадолженности=Автоматически, (3) native БанковскийСчет priority, (4) ПриемНаРаботу FIO/Должность/ВидЗанятости/Начисления 72200, (5) Base 0 RBP 2026-12-31 = 107,638.89 RUB', async () => {
  const bsl = generateBslLoader({
    defaultReportingYear: 2026,
    defaultPackageFileName: 'Package_1C.json',
    defaultBase0FileName: 'base0_1c.json',
  });

  // Fix 1: Zero occurrences of Richthofen, GitHub, URLs, bp30-v1, -CASHIN, or service tags in BSL & empty Комментарий everywhere
  assert.equal(
    /richthofen|github|http|bp30|cashin|АвтоОплата51|\[Налог:|\[Фолбэк\]/iu.test(bsl),
    false,
    'BSL must contain 0 occurrences of Richthofen, GitHub, http, bp30, cashin, or service tags'
  );
  // Every write to "Комментарий" via УстановитьЕслиЕсть must pass strictly ""
  for (const m of bsl.matchAll(/УстановитьЕслиЕсть\([^,]+,\s*"Комментарий",\s*([^)]+)\)/gu)) {
    assert.equal(
      m[1].trim(),
      '""',
      `Every Комментарий assignment in BSL must be strictly empty string "", got: ${m[0]}`
    );
  }
  // Every direct property assignment `.Комментарий = ...` must also pass strictly ""
  for (const m of bsl.matchAll(/\.Комментарий\s*=\s*([^;]+);/gu)) {
    assert.equal(
      m[1].trim(),
      '""',
      `Every direct .Комментарий assignment in BSL must be strictly "", got: ${m[0]}`
    );
  }

  // Fix 2: ПогашениеЗадолженности = Автоматически via metadata, and NO ДокументРасчетовСКонтрагентом when auto-settlement is set
  const applyAutoStart = bsl.indexOf('Процедура ПрименитьПогашениеЗадолженностиАвтоматически(');
  assert.ok(applyAutoStart > 0, 'Missing ПрименитьПогашениеЗадолженностиАвтоматически');
  const applyAutoBody = bsl.slice(applyAutoStart, bsl.indexOf('КонецПроцедуры', applyAutoStart));
  assert.match(applyAutoBody, /НайтиПогашениеЗадолженностиАвтоматически\(Док\)/u);
  assert.equal(
    applyAutoBody.includes('ДокументРасчетовСКонтрагентом'),
    false,
    'ПрименитьПогашениеЗадолженностиАвтоматически must NEVER set ДокументРасчетовСКонтрагентом'
  );
  // Also ensure the pre-save bank block calls ПрименитьПогашениеЗадолженностиАвтоматически(ДокОбъект)
  const preSaveIdx = bsl.indexOf('// Повторно фиксируем СчетОрганизации (банк и ПКО из банка)');
  assert.ok(preSaveIdx > 0);
  const preSaveSlice = bsl.slice(preSaveIdx, preSaveIdx + 1500);
  assert.ok(
    preSaveSlice.includes('ПрименитьПогашениеЗадолженностиАвтоматически(ДокОбъект)'),
    'Pre-save bank block must enforce ПогашениеЗадолженности = Автоматически on every РасшифровкаПлатежа row'
  );

  // Fix 3: Native organization bank account priority (excluding "ОСНОВНОЙ РАСЧЕТНЫЙ СЧЕТ" first, never creating duplicate when any active account exists)
  const nativeBankFnStart = bsl.indexOf('Функция НайтиНативныйБанковскийСчетВладельца(');
  assert.ok(nativeBankFnStart > 0, 'Missing НайтиНативныйБанковскийСчетВладельца');
  const nativeBankFnBody = bsl.slice(nativeBankFnStart, bsl.indexOf('КонецФункции', nativeBankFnStart));
  const exclDefaultIdx = nativeBankFnBody.indexOf('"ОСНОВНОЙ РАСЧЕТНЫЙ СЧЕТ"');
  const postedBankDocIdx = nativeBankFnBody.indexOf('ИЗ Документ.СписаниеСРасчетногоСчета');
  const orgMainAccIdx = nativeBankFnBody.indexOf('Организация.ОсновнойБанковскийСчет');
  assert.ok(
    exclDefaultIdx > 0 && postedBankDocIdx > exclDefaultIdx && orgMainAccIdx > postedBankDocIdx,
    'НайтиНативныйБанковскийСчетВладельца must prioritize native active account (!= "ОСНОВНОЙ РАСЧЕТНЫЙ СЧЕТ") -> posted bank docs -> Организация.ОсновнойБанковскийСчет'
  );
  const findOrCreateBankStart = bsl.indexOf('Функция НайтиИлиСоздатьБанковскийСчет(');
  const findOrCreateBankBody = bsl.slice(findOrCreateBankStart, bsl.indexOf('КонецФункции', findOrCreateBankStart));
  assert.ok(
    findOrCreateBankBody.indexOf('НайтиНативныйБанковскийСчетВладельца(ВладелецСсылка)') > 0 &&
      findOrCreateBankBody.indexOf('НайтиНативныйБанковскийСчетВладельца(ВладелецСсылка)') <
        findOrCreateBankBody.indexOf('Справочники.БанковскиеСчета.СоздатьЭлемент()'),
    'НайтиИлиСоздатьБанковскийСчет must return existing native bank account BEFORE ever calling СоздатьЭлемент()'
  );

  // Fix 4: ПриемНаРаботу with real Chief Accountant FIO from Base 0 (never "Главный бухгалтер (ФИО студента)"), Должность, ВидЗанятости, and Начисления (72,200 RUB)
  const q1Input = {
    name: 'Хоз.csv',
    buffer: readAssetBuffer('public/assets/aistudio/____09f9d030.csv'),
  };
  const q2Input = {
    name: 'Хоз(1).csv',
    buffer: readAssetBuffer('public/assets/aistudio/____1__443ffb42.csv'),
  };
  const base0AprilStudentJson = JSON.stringify({
    ФорматБазы0: '1c-base0-v1',
    ОтчетныйГод: 2026,
    ДатаОстатков: '2026-04-01',
    usesLegacyPayrollAccounts: true,
    payrollAccounts69: ['69.01', '69.02.7', '69.03.1', '69.11'],
    Организация: {
      Наименование: 'ООО «Вектор»',
      ИНН: '7810000001',
      КПП: '781001001',
      ГлавныйБухгалтер: 'Смирнова Анна Сергеевна',
    },
    ВсеСправочники: {
      Сотрудники: [
        { Код: '000000001', Наименование: 'Директоров И.И.', Должность: 'Генеральный директор', Оклад: 95000 },
        { Код: '000000005', Наименование: 'Смирнова Анна Сергеевна' },
      ],
      РасходыБудущихПериодов: [
        {
          Код: '000000001',
          Наименование: 'Взнос в компенсационный фонд СРО',
          Сумма: 1000000,
          ДатаНачалаСписания: '2026-03-01',
          ДатаОкончанияСписания: '2026-12-31',
          СпособСписания: 'По месяцам',
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
  const db1CApril = parseBase0Json(base0AprilStudentJson, 'base0_april_student.json', 2026);
  assert.equal(db1CApril.organization.chiefAccountant, 'Смирнова Анна Сергеевна');

  const batchWithDb = await processBatchFiles([q1Input, q2Input], db1CApril, {
    reportingYear: 2026,
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });
  const fixedWithDb = autoFixAllBy1CDb({
    db1C: db1CApril,
    operations: batchWithDb.operations,
    calculateCurrentOsv: (currOps, dateToOverride) =>
      calculateOsvReport({
        db1C: db1CApril,
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
  const { finalState: finalStateWithDb } = buildVirtual1CStateTimeline(db1CApril, fixedWithDb.operations);
  const pkgWithDb = build1CTransferPackage(fixedWithDb.operations, db1CApril, finalStateWithDb, {
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });

  // Ensure NO employee in catalogs has placeholder role name as fullName/fio
  for (const emp of pkgWithDb.catalogs.employees) {
    assert.equal(
      /главн\p{L}*\s+бухгалтер|фио\s+студент/iu.test(emp.fullName) ||
        /главн\p{L}*\s+бухгалтер|фио\s+студент/iu.test(emp.fio),
      false,
      `Employee catalog must NEVER contain position placeholder as FIO: ${JSON.stringify(emp)}`
    );
  }
  const hireDoc = pkgWithDb.documents.find(
    (d) => d.metaType1C === 'ПриемНаРаботу' && d.date.startsWith('2026-04')
  );
  assert.ok(hireDoc, 'Expected April ПриемНаРаботу document in package');
  assert.equal(hireDoc.header.employeeName, 'Смирнова Анна Сергеевна');
  assert.equal(hireDoc.header.employeePosition, 'Главный бухгалтер');
  assert.equal(hireDoc.header.monthlySalary, 72200);
  assert.ok(
    bsl.includes('НайтиВидЗанятостиОсновноеПоМетаданным(ДокОбъект)') &&
      bsl.includes('ЗаполнитьНачисленияПриемаНаРаботуПоМетаданным(ДокОбъект, СотрСсылкаПрием, ОкладШапки)'),
    'BSL ПриемНаРаботу must populate ВидЗанятости and Начисления (ОплатаПоОкладу, 72200) via metadata'
  );

  // Also ensure zero Richthofen / GitHub / URLs in serialized JSON comments & descriptions
  for (const doc of pkgWithDb.documents) {
    assert.equal(
      /richthofen|github|http|bp30-v1/iu.test(doc.comment),
      false,
      `Document comment must not contain service mentions: ${doc.comment}`
    );
  }

  // Fix 5: RBP 97.21 write-off in April 2026 when Base 0 ДатаОкончанияСписания = "2026-12-31" and residual = 968,750 RUB -> 968,750 / 9 = 107,638.89 RUB/mo
  const aprilRbpEntry2026End = fixedWithDb.operations
    .filter((o) => o.category === 'closing' && o.date === '2026-04-30')
    .flatMap((o) => o.entries)
    .find((e) => e.credit === '97.21');
  assert.ok(aprilRbpEntry2026End, 'Expected April 97.21 write-off entry with Base 0 end date 2026-12-31');
  assert.equal(
    aprilRbpEntry2026End.amount.toFixed(2),
    '107638.89',
    `Expected 968,750 / 9 months (Apr–Dec 2026) = 107,638.89 RUB/mo, got ${aprilRbpEntry2026End.amount.toFixed(2)}`
  );
});


