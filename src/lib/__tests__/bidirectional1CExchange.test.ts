import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { processBatchFiles } from '../import1c/batchFileParser';
import {
  isBase0JsonPayload,
  parseBase0Json,
  summarizeConnectedBase0,
} from '../import1c/parseBase0Json';
import { calculateOsvReport } from '../engine/osvCalculator';
import { autoFixAllBy1CDb } from '../engine/auditAndAutofix';
import {
  attachVirtualStateStep00ToOperations,
  rebindOperationsAgainst1CDb,
} from '../engine/postingEngine';
import { buildVirtual1CStateTimeline } from '../engine/virtual1CState';
import {
  build1CTransferPackage,
  generateBslLoader,
  summarize1CPackageSections,
} from '../export1c';

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

test('build1CTransferPackage (bp30-v1): builds canonical Q1–Q3 package with clean catalogs, multi-row documents, Art. 270 NK RF flags, and strict execution strategies', async () => {
  const q1Input = {
    name: 'Хоз.csv',
    buffer: readAssetBuffer('public/assets/aistudio/____09f9d030.csv'),
  };
  const q2Input = {
    name: 'Хоз(1).csv',
    buffer: readAssetBuffer('public/assets/aistudio/____1__443ffb42.csv'),
  };
  const q3Input = {
    name: 'Хоз(2).csv',
    buffer: readAssetBuffer('public/assets/aistudio/____2__232e9040.csv'),
  };

  const batch = await processBatchFiles([q1Input, q2Input, q3Input], null, {
    reportingYear: 2026,
  });

  const fixed = autoFixAllBy1CDb({
    db1C: null,
    operations: batch.operations,
    calculateCurrentOsv: (ops, dateToOverride) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: dateToOverride || '2026-09-30',
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-09-30',
    reportingYear: 2026,
  });

  const { finalState } = buildVirtual1CStateTimeline(null, fixed.operations);
  const pkg = build1CTransferPackage(fixed.operations, null, finalState);

  // 1. Meta & non-empty Organization
  assert.equal(pkg.meta.schemaVersion, 'bp30-v1');
  assert.equal(pkg.meta.reportingYear, 2026);
  assert.equal(pkg.meta.totalDocuments, pkg.documents.length);
  assert.ok(pkg.documents.length >= 60, `Expected >= 60 documents across Q1-Q3, got ${pkg.documents.length}`);
  assert.ok(pkg.organization.name.trim().length > 0, 'Organization name must not be empty');
  assert.ok(pkg.organization.bik.trim().length === 9, 'Organization BIK must be 9 digits');
  assert.ok(pkg.organization.accountNumber.trim().length === 20, 'Organization settlement account must be 20 digits');

  // 2. Clean Nomenclature (no comma concatenations, no loans/promissory notes/interest/penalties)
  const nomNames = pkg.catalogs.nomenclature.map((n) => n.name);
  assert.ok(nomNames.length > 0, 'Nomenclature catalog must not be empty');
  assert.equal(
    nomNames.some((n) => n.includes(',')),
    false,
    `Nomenclature must not contain comma-concatenated strings: ${JSON.stringify(nomNames)}`
  );
  assert.equal(
    nomNames.some((n) => /(?:вексел|кредит|займ|заём|процент|уставн|штраф|алимент)/iu.test(n)),
    false,
    `Nomenclature must not contain financial/legal garbage items: ${JSON.stringify(nomNames)}`
  );
  assert.ok(nomNames.includes('Плита ПВХ'), 'Individual item "Плита ПВХ" must exist');
  assert.ok(nomNames.includes('Заготовка МДФ'), 'Individual item "Заготовка МДФ" must exist');
  assert.ok(nomNames.includes('Клей'), 'Individual item "Клей" must exist');

  // 3. Strict chronological & intra-day ordering
  for (let i = 1; i < pkg.documents.length; i++) {
    assert.ok(
      pkg.documents[i - 1].date <= pkg.documents[i].date,
      `Documents must be sorted chronologically: ${pkg.documents[i - 1].date} vs ${pkg.documents[i].date}`
    );
  }

  // Within a month-end date (e.g. 2026-03-31), closing (`run_native_in_1c`) must come at the end of that day
  const mar31Docs = pkg.documents.filter((d) => d.date === '2026-03-31');
  if (mar31Docs.length > 1) {
    const lastMar31 = mar31Docs[mar31Docs.length - 1];
    assert.equal(
      lastMar31.executionStrategy,
      'run_native_in_1c',
      'Month-end closing must be ordered after all primary documents on 2026-03-31'
    );
  }

  // 4. Multi-row tabular parts (`rows`) populated for multi-item purchases / write-offs
  const multiRowDocs = pkg.documents.filter(
    (d) =>
      (d.metaType1C === 'ПоступлениеТоваровУслуг' || d.metaType1C === 'ТребованиеНакладная') &&
      d.rows.length >= 2
  );
  assert.ok(
    multiRowDocs.length >= 2,
    `Expected multi-item purchase/warehouse documents with rows.length >= 2, got ${multiRowDocs.length}`
  );

  // 5. Art. 270 NK RF nonDeductibleForProfitTax preserved in package entries
  const giftDoc = pkg.documents.find((d) => d.date === '2026-08-17' && /подар/iu.test(d.comment));
  assert.ok(giftDoc, 'Gift document on 2026-08-17 must be present in package');
  assert.equal(giftDoc.executionStrategy, 'manual_operation');
  const gift9102 = giftDoc.entries.filter((e) => e.debit === '91.02');
  assert.ok(gift9102.length >= 2);
  assert.equal(
    gift9102.every((e) => e.nonDeductibleForProfitTax === true),
    true,
    'All 91.02 entries on employee gifts must preserve nonDeductibleForProfitTax = true'
  );

  const matAidDoc = pkg.documents.find(
    (d) => d.date === '2026-09-20' && /материальн\S*\s+помощ/iu.test(d.comment)
  );
  assert.ok(matAidDoc, 'Material aid document on 2026-09-20 must be present in package');
  assert.equal(matAidDoc.executionStrategy, 'manual_operation');
  const aidPrincipal = matAidDoc.entries.find((e) => e.debit === '91.02' && e.credit === '73.03');
  const aidInsurance = matAidDoc.entries.find((e) => e.debit === '91.02' && e.credit === '69.09');
  assert.ok(aidPrincipal && aidPrincipal.nonDeductibleForProfitTax === true);
  assert.ok(aidInsurance && aidInsurance.nonDeductibleForProfitTax === false);

  // 6. Execution strategies & section summary
  const strategies = new Set(pkg.documents.map((d) => d.executionStrategy));
  assert.ok(strategies.has('native'), 'Package must contain native 1C documents');
  assert.ok(strategies.has('manual_operation'), 'Package must contain manual_operation documents');
  assert.ok(strategies.has('run_native_in_1c'), 'Package must contain run_native_in_1c closing steps');

  const summary = summarize1CPackageSections(pkg);
  const totalFromSummary =
    summary.purchases +
    summary.sales +
    summary.bankCash +
    summary.warehouse +
    summary.osNma +
    summary.hrPayroll +
    summary.manualOps +
    summary.reglamentIn1C;
  assert.equal(
    totalFromSummary,
    pkg.documents.length,
    '8-section summary counts must partition pkg.documents.length exactly'
  );

  // 7. Dynamic balance modes for full tax settlements ('taxes_all') and monthly salary payouts ('payroll_balance')
  const taxesAllDocs = pkg.documents.filter((d) => d.dynamicBalanceMode === 'taxes_all');
  assert.ok(
    taxesAllDocs.length >= 2,
    `Expected >= 2 full tax/insurance payoff documents with dynamicBalanceMode = 'taxes_all', got ${taxesAllDocs.length}`
  );
  assert.equal(
    taxesAllDocs.every(
      (d) =>
        d.metaType1C === 'СписаниеСРасчетногоСчета' &&
        d.header.dynamicBalanceMode === 'taxes_all'
    ),
    true,
    'All taxes_all documents must be СписаниеСРасчетногоСчета with header.dynamicBalanceMode = taxes_all'
  );

  const payrollBalanceDocs = pkg.documents.filter(
    (d) => d.dynamicBalanceMode === 'payroll_balance'
  );
  assert.ok(
    payrollBalanceDocs.length >= 2,
    `Expected >= 2 completed-month salary payout documents with dynamicBalanceMode = 'payroll_balance', got ${payrollBalanceDocs.length}`
  );

  // Mid-month salary advance ("аванс") must NOT be overridden by live balance on 70
  const advancePayouts = pkg.documents.filter(
    (d) =>
      (d.metaType1C === 'СписаниеСРасчетногоСчета' || d.metaType1C === 'ВыдачаНаличных') &&
      /аванс|перв\p{L}+\s+половин/iu.test(d.comment) &&
      d.entries.some((e) => e.debit === '70')
  );
  for (const adv of advancePayouts) {
    assert.equal(
      adv.dynamicBalanceMode,
      undefined,
      `Mid-month advance (${adv.date}: ${adv.comment}) must keep explicit JSON amount without payroll_balance`
    );
  }
});

test('generateBslLoader: produces syntactically balanced 1C 8.3 BSL code with zero .Выбрать() calls and safe ОперацияБух recording', () => {
  const bsl = generateBslLoader({ defaultReportingYear: 2026 });
  const clean = stripBslCommentsAndStrings(bsl);

  // 1. Balanced BSL block pairs
  const procStart = countBslKeyword(clean, 'Процедура');
  const procEnd = countBslKeyword(clean, 'КонецПроцедуры');
  assert.ok(procStart >= 8, `Expected >= 8 procedures, got ${procStart}`);
  assert.equal(procStart, procEnd, `Процедура (${procStart}) != КонецПроцедуры (${procEnd})`);

  const fnStart = countBslKeyword(clean, 'Функция');
  const fnEnd = countBslKeyword(clean, 'КонецФункции');
  assert.ok(fnStart >= 12, `Expected >= 12 functions, got ${fnStart}`);
  assert.equal(fnStart, fnEnd, `Функция (${fnStart}) != КонецФункции (${fnEnd})`);

  const ifStart = countBslKeyword(clean, 'Если');
  const ifEnd = countBslKeyword(clean, 'КонецЕсли');
  assert.equal(ifStart, ifEnd, `Если (${ifStart}) != КонецЕсли (${ifEnd})`);

  const loopStart = countBslKeyword(clean, 'Цикл');
  const loopEnd = countBslKeyword(clean, 'КонецЦикла');
  assert.equal(loopStart, loopEnd, `Цикл (${loopStart}) != КонецЦикла (${loopEnd})`);

  const tryStart = countBslKeyword(clean, 'Попытка');
  const exceptCount = countBslKeyword(clean, 'Исключение');
  const tryEnd = countBslKeyword(clean, 'КонецПопытки');
  assert.equal(tryStart, exceptCount, `Попытка (${tryStart}) != Исключение (${exceptCount})`);
  assert.equal(tryStart, tryEnd, `Попытка (${tryStart}) != КонецПопытки (${tryEnd})`);

  const regionStart = Array.from(clean.matchAll(/#Область\b/giu)).length;
  const regionEnd = Array.from(clean.matchAll(/#КонецОбласти\b/giu)).length;
  assert.equal(regionStart, regionEnd, `#Область (${regionStart}) != #КонецОбласти (${regionEnd})`);

  // 2. Zero forbidden synchronous modal `.Выбрать(` calls
  assert.equal(
    bsl.includes('.Выбрать('),
    false,
    'Generated BSL must never use .Выбрать() (neither synchronous file dialog nor cursor selection)'
  );
  assert.match(bsl, /Новый\s+ОписаниеОповещения\(/u);
  assert.match(bsl, /\.Показать\(Оповещение\)/u);

  // 3. ОперацияБух must strictly write in РежимЗаписиДокумента.Запись + Движения.Хозрасчетный and NEVER call Проведение
  assert.match(bsl, /ДокОп\s*=\s*Документы\.ОперацияБух\.СоздатьДокумент\(\)/u);
  assert.match(bsl, /ДокОп\.Записать\(РежимЗаписиДокумента\.Запись\)/u);
  assert.equal(
    /ДокОп\.Записать\(\s*РежимЗаписиДокумента\.Проведение\s*\)/u.test(bsl),
    false,
    'ОперацияБух must NEVER be written with РежимЗаписиДокумента.Проведение'
  );
  assert.match(bsl, /НаборДвижений\s*=\s*ДокОп\.Движения\.Хозрасчетный/u);
  assert.match(bsl, /НаборДвижений\.Записать\(\)/u);

  // 4. Key bidirectional & tax accounting capabilities
  assert.match(bsl, /Процедура\s+ПриСозданииНаСервере/u);
  assert.match(bsl, /ИзменитьРеквизиты\(/u);
  assert.match(bsl, /Функция\s+ВыгрузитьБазу0НаСервере/u);
  assert.match(bsl, /Процедура\s+ЗагрузитьПакетНаСервере/u);
  assert.match(bsl, /СуммаНУДт/u);
  assert.match(bsl, /СуммаПРДт/u);
  assert.match(bsl, /РасшифровкаПлатежа\.Добавить\(\)/u);
  assert.match(bsl, /Документы\.СчетФактураПолученный\.СоздатьДокумент\(\)/u);
  assert.match(bsl, /Документы\.СчетФактураВыданный\.СоздатьДокумент\(\)/u);

  // 5. Pre-ENS 1C:BP 3.0 compatibility: monthly period filter, live Хозрасчетный.Остатки, and 69.09 -> 69.01/69.02.7/69.03.1 split
  assert.match(bsl, /РеквизитФормы\("ПериодС"/u);
  assert.match(bsl, /РеквизитФормы\("ПериодПо"/u);
  assert.match(bsl, /ДатаНачалаЗагрузки\s*=\s*ЭтотОбъект\["ПериодС"\]/u);
  assert.match(bsl, /ДатаОкончанияЗагрузки\s*=\s*ЭтотОбъект\["ПериодПо"\]/u);
  assert.match(bsl, /РегистрБухгалтерии\.Хозрасчетный\.Остатки/u);
  assert.match(bsl, /"taxes_all"/u);
  assert.match(bsl, /"payroll_balance"/u);
  assert.match(bsl, /ПланыСчетов\.Хозрасчетный\.НайтиПоКоду\("69\.09"\)/u);
  assert.match(bsl, /НайтиСчет\("69\.01"\)/u);
  assert.match(bsl, /НайтиСчет\("69\.02\.7"\)/u);
  assert.match(bsl, /НайтиСчет\("69\.03\.1"\)/u);
  assert.match(bsl, /"usesLegacyPayrollAccounts"/u);

  // 6. Live-run 1C:BP 3.0 fixes:
  // (a) Reserved keyword `Знач` must NEVER be used as a variable or parameter modifier where unexpected
  assert.equal(
    countBslKeyword(clean, 'Знач'),
    0,
    'Reserved BSL keyword Знач must never be used as an identifier anywhere in RichthofenLoader_1C83.bsl'
  );
  assert.match(bsl, /РезЗначение\s*=\s*Карта\.Получить\(Ключ\)/u);

  // (b) Exact BP 3.0 metadata names for cash orders (ПКО/РКО with fallback) and fixed assets tabular section (ДокОбъект.ОС)
  assert.match(bsl, /Метаданные\.Документы\.Найти\("ПриходныйКассовыйОрдер"\)/u);
  assert.match(bsl, /Метаданные\.Документы\.Найти\("РасходныйКассовыйОрдер"\)/u);
  assert.match(bsl, /ДокОбъект\.ОС\.Добавить\(\)/u);

  // (c) Detailed 1C posting diagnostics via ПолучитьСообщенияПользователю(Истина)
  assert.match(bsl, /Процедура\s+ОчиститьСообщенияПользователю\(\)/u);
  assert.match(bsl, /Функция\s+СобратьТекстОшибки1С\(/u);
  assert.match(bsl, /ПолучитьСообщенияПользователю\(Истина\)/u);
  assert.match(bsl, /ТекстОшибкиДок\s*=\s*СобратьТекстОшибки1С\(ОписаниеОшибки\(\)\)/u);

  // (d) Mandatory accounting accounts & subconto across ПТУ, РТУ, bank, cash, ТребованиеНакладная, and ОперацияБух
  assert.match(bsl, /"БанковскийСчетОрганизации"/u);
  assert.match(bsl, /"СтатьяДвиженияДенежныхСредств"/u);
  assert.match(bsl, /"СтатьяДДС"/u);
  assert.match(bsl, /"СтатьяРасходов"/u);
  assert.match(bsl, /"СчетРасчетов"/u);
  assert.match(bsl, /"СчетАвансов"/u);
  assert.match(bsl, /"СчетУчетаНДСПоРеализации"/u);
  assert.match(bsl, /"ПодразделениеЗатрат"/u);
  assert.match(bsl, /СуммаПроводокИтого/u);

  // Verify ДокОп.Записать(РежимЗаписиДокумента.Запись) strictly precedes НаборДвижений.Записать() inside ЗаписатьОперациюБухИзПроводок
  const opBuhStart = bsl.indexOf('Функция ЗаписатьОперациюБухИзПроводок');
  const opBuhEnd = bsl.indexOf('КонецФункции', opBuhStart);
  const opBuhBody = bsl.slice(opBuhStart, opBuhEnd);
  const docWriteIdx = opBuhBody.indexOf('ДокОп.Записать(РежимЗаписиДокумента.Запись)');
  const movWriteIdx = opBuhBody.indexOf('НаборДвижений.Записать()');
  assert.ok(docWriteIdx > 0 && movWriteIdx > docWriteIdx, 'ДокОп.Записать(Запись) must execute before НаборДвижений.Записать()');

  // (e) Strict duplicate check by non-empty [RichthofenID:<id>] and wide horizontal form groups
  assert.match(bsl, /ИскомаяПодстрокаТега\s*=\s*"\[RichthofenID:"\s*\+\s*ЧистыйИД\s*\+\s*"\]"/u);
  assert.match(bsl, /УстановитьЕслиЕсть\(ГруппаНастроек,\s*"РастягиватьПоГоризонтали",\s*Истина\)/u);
  assert.match(bsl, /УстановитьЕслиЕсть\(ГруппаПериодаЗагрузки,\s*"РастягиватьПоГоризонтали",\s*Истина\)/u);
  assert.match(bsl, /УстановитьЕслиЕсть\(ЭтаФорма,\s*"Ширина",\s*115\)/u);

  // 7. April 1C:BP 3.0 live-run fixes:
  // (a) ПолучитьВалютуРуб() with exact 3-step priority: Константы.ВалютаРегламентированногоУчета -> НайтиПоКоду("643") -> НайтиПоНаименованию("руб.")
  const fnRubStart = bsl.indexOf('Функция ПолучитьВалютуРуб()');
  assert.ok(fnRubStart > 0, 'ПолучитьВалютуРуб() must be defined in generateBslLoader');
  const fnRubBody = bsl.slice(fnRubStart, bsl.indexOf('КонецФункции', fnRubStart));
  const idxConstCurr = fnRubBody.indexOf('Константы.ВалютаРегламентированногоУчета.Получить()');
  const idxCode643 = fnRubBody.indexOf('Справочники.Валюты.НайтиПоКоду("643")');
  const idxNameRub = fnRubBody.indexOf('Справочники.Валюты.НайтиПоНаименованию("руб.")');
  assert.ok(
    idxConstCurr > 0 && idxCode643 > idxConstCurr && idxNameRub > idxCode643,
    'ПолучитьВалютуРуб() must try ВалютаРегламентированногоУчета -> НайтиПоКоду("643") -> НайтиПоНаименованию("руб.") in order'
  );

  // (b) Currency & multiplicity (ВалютаДокумента, КурсВзаиморасчетов = 1, КратностьВзаиморасчетов = 1) in native docs, taxes_all, payroll_balance, and РасшифровкаПлатежа
  assert.match(bsl, /Процедура\s+ЗаполнитьВалютуИКратностьДокумента\(/u);
  assert.match(bsl, /УстановитьЕслиЕсть\(ДокОбъект,\s*"ВалютаДокумента",\s*ВалютаРуб\)/u);
  assert.match(bsl, /УстановитьЕслиЕсть\(ДокОбъект,\s*"КурсВзаиморасчетов",\s*1\)/u);
  assert.match(bsl, /УстановитьЕслиЕсть\(ДокОбъект,\s*"КратностьВзаиморасчетов",\s*1\)/u);

  const fnTaxesStart = bsl.indexOf('Функция СоздатьУплатуНалоговПоЖивымОстаткам1С');
  const fnTaxesBody = bsl.slice(fnTaxesStart, bsl.indexOf('КонецФункции', fnTaxesStart));
  assert.match(fnTaxesBody, /ВалютаРуб\s*=\s*ПолучитьВалютуРуб\(\)/u);
  assert.match(fnTaxesBody, /УстановитьЕслиЕсть\(ДокНал,\s*"ВалютаДокумента",\s*ВалютаРуб\)/u);
  assert.match(fnTaxesBody, /УстановитьЕслиЕсть\(ДокНал,\s*"КурсВзаиморасчетов",\s*1\)/u);
  assert.match(fnTaxesBody, /УстановитьЕслиЕсть\(ДокНал,\s*"КратностьВзаиморасчетов",\s*1\)/u);

  const procRowCurrStart = bsl.indexOf('Процедура ЗаполнитьВалютуСтрокиРасшифровкиПлатежа');
  assert.ok(procRowCurrStart > 0, 'ЗаполнитьВалютуСтрокиРасшифровкиПлатежа must be defined');
  const procRowCurrBody = bsl.slice(procRowCurrStart, bsl.indexOf('КонецПроцедуры', procRowCurrStart));
  assert.match(procRowCurrBody, /УстановитьЕслиЕсть\(СтрРасш,\s*"КурсВзаиморасчетов",\s*1\)/u);
  assert.match(procRowCurrBody, /УстановитьЕслиЕсть\(СтрРасш,\s*"КратностьВзаиморасчетов",\s*1\)/u);
  assert.match(procRowCurrBody, /УстановитьЕслиЕсть\(СтрРасш,\s*"СуммаВзаиморасчетов",\s*СуммаПлатежаСтроки\)/u);

  // (c) НайтиИлиСоздатьПрочиеДоходыРасходы(Наименование) embedded directly in module for Ctrl+F7 compilation
  const fnPdrStart = bsl.indexOf('Функция НайтиИлиСоздатьПрочиеДоходыРасходы(Наименование)');
  assert.ok(fnPdrStart > 0, 'НайтиИлиСоздатьПрочиеДоходыРасходы(Наименование) must be defined in module');
  const fnPdrBody = bsl.slice(fnPdrStart, bsl.indexOf('КонецФункции', fnPdrStart));
  assert.match(fnPdrBody, /Справочники\.ПрочиеДоходыИРасходы\.НайтиПоНаименованию\([^,]+,\s*Истина\)/u);
  assert.match(fnPdrBody, /Справочники\.ПрочиеДоходыИРасходы\.СоздатьЭлемент\(\)/u);
  assert.match(fnPdrBody, /УстановитьЕслиЕсть\(НовыйПДР,\s*"ПринимаетсяКНалоговомуУчету",\s*Истина\)/u);

  // (d) Smart duplicate & unposted draft handling: checks Док.Проведен, skips posted, reopens unposted draft via ПолучитьОбъект() + ОчиститьТабличныеЧастиДокумента
  assert.match(bsl, /Функция\s+НайтиСтатусДубляПоТегуRichthofen\(/u);
  assert.match(bsl, /Док\.Проведен\s+КАК\s+Проведен/u);
  assert.match(bsl, /Процедура\s+ОчиститьТабличныеЧастиДокумента\(/u);
  assert.match(bsl, /ЧерновикСсылка\.ПолучитьОбъект\(\)/u);
  assert.match(bsl, /ОчиститьТабличныеЧастиДокумента\(ДокОбъект\)/u);

  // (e) Static Ctrl+F7 compilation guard: every standalone procedure/function call in clean BSL must be either a 1C 8.3 platform built-in or defined in this module
  const definedRoutines = new Set<string>();
  for (const m of clean.matchAll(/(?:Процедура|Функция)\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/giu)) {
    definedRoutines.add(m[1].toLowerCase());
  }
  const platformBuiltins1C83 = new Set(
    [
      // Type constructors & platform functions
      'ОписаниеТипов',
      'КвалификаторыЧисла',
      'КвалификаторыДаты',
      'РеквизитФормы',
      'ИзменитьРеквизиты',
      'Тип',
      'ДиалогВыбораФайла',
      'ОписаниеОповещения',
      'ПустаяСтрока',
      'СокрЛП',
      'ЗаписьТекста',
      'ЧтениеТекста',
      'ДвоичныеДанные',
      'ПоместитьВоВременноеХранилище',
      'ПолучитьИзВременногоХранилища',
      'ПолучитьИмяВременногоФайла',
      'УдалитьФайлы',
      'ПоказатьПредупреждение',
      'Формат',
      'ТекущаяДата',
      'ПолучитьСообщенияПользователю',
      'Строка',
      'Число',
      'Булево',
      'Дата',
      'Год',
      'НачалоДня',
      'КонецДня',
      'НачалоМесяца',
      'СтрДлина',
      'Лев',
      'Сред',
      'НРег',
      'Найти',
      'Окр',
      'ЗначениеЗаполнено',
      'ОписаниеОшибки',
      'ВызватьИсключение',
      'Запрос',
      'Структура',
      'Соответствие',
      'Массив',
      'ЗаписьJSON',
      'ПараметрыЗаписиJSON',
      'ЗаписатьJSON',
      'ЧтениеJSON',
      'ПрочитатьJSON',
      // BSL language keywords that can precede parenthesized expressions
      'Если',
      'ИначеЕсли',
      'Пока',
      'И',
      'Или',
      'Не',
      'Возврат',
    ].map((s) => s.toLowerCase())
  );
  for (const callMatch of clean.matchAll(/(?<![.\p{L}\p{N}_])([\p{L}_][\p{L}\p{N}_]*)\s*\(/gu)) {
    const fnName = callMatch[1];
    const lower = fnName.toLowerCase();
    assert.ok(
      definedRoutines.has(lower) || platformBuiltins1C83.has(lower),
      `Undefined BSL procedure/function call "${fnName}(...)" would fail Ctrl+F7 in 1C Configurator!`
    );
  }
});

test('parseBase0Json: imports Base 0 snapshot, rebinds existing catalogs to already_exists / matched_1c, and carries opening balances into OSV', async () => {
  const rawBase0 = {
    ФорматБазы0: 'bp30-base0-v1',
    ОтчетныйГод: 2026,
    ДатаОстатков: '2026-01-01',
    usesLegacyPayrollAccounts: true,
    payrollAccounts69: ['69.01', '69.02.7', '69.03.1', '69.11'],
    Организация: {
      Наименование: 'ООО "Альфа-Мебель"',
      ПолноеНаименование: 'Общество с ограниченной ответственностью "Альфа-Мебель"',
      ИНН: '7810901235',
      КПП: '781001001',
      БИК: '044030653',
      Банк: 'СЕВЕРО-ЗАПАДНЫЙ БАНК ПАО СБЕРБАНК',
      НомерСчета: '40702810955000012345',
    },
    ВсеСправочники: {
      Контрагенты: [
        { Код: '00001', Наименование: 'ООО "ЛесПромСнаб"', ИНН: '7805123456', КПП: '780501001' },
      ],
      ДоговорыКонтрагентов: [
        {
          Код: '00001',
          Наименование: 'Договор поставки № 15',
          Владелец: 'ООО "ЛесПромСнаб"',
          ВидДоговора: 'СПоставщиком',
        },
      ],
      Склады: [{ Код: '00001', Наименование: 'Основной склад' }],
      Номенклатура: [{ Код: '00010', Наименование: 'Плита ПВХ', Услуга: false }],
      НоменклатурныеГруппы: [{ Наименование: 'Основная номенклатурная группа' }],
      Сотрудники: [{ Код: '00001', Наименование: 'Иванов Иван Иванович' }],
      ОсновныеСредства: [{ Код: '00001', Наименование: 'Станок форматно-раскроечный' }],
      РасходыБудущихПериодов: [],
    },
    НачальныеОстатки: [
      {
        Счет: '51',
        НаименованиеСчета: 'Расчетные счета',
        Субконто1: 'Основной банковский счет',
        СальдоНачДт: 500000,
        СальдоНачКт: 0,
      },
      {
        Счет: '10.01',
        НаименованиеСчета: 'Сырье и материалы',
        Субконто1: 'Плита ПВХ',
        СальдоНачДт: 100000,
        СальдоНачКт: 0,
        КоличествоОстаток: 50,
      },
      {
        Счет: '80.09',
        НаименованиеСчета: 'Прочий капитал',
        Субконто1: 'Учредитель',
        СальдоНачДт: 0,
        СальдоНачКт: 600000,
      },
    ],
  };

  assert.equal(isBase0JsonPayload(rawBase0, 'base0_1c.json'), true);

  const db1C = parseBase0Json(JSON.stringify(rawBase0), 'base0_1c.json', 2026);
  assert.equal(db1C.organization.name, 'ООО "Альфа-Мебель"');
  assert.equal(db1C.organization.inn, '7810901235');
  assert.equal(db1C.organization.bik, '044030653');
  assert.equal(db1C.organization.bankAccount, '40702810955000012345');
  assert.equal(db1C.detectedBalanceMode, 'start_balances_forward_end');
  assert.equal(db1C.rawBalances.length, 3);

  const summary = summarizeConnectedBase0(db1C);
  assert.ok(summary);
  assert.equal(summary.organizationName, 'ООО "Альфа-Мебель"');
  assert.equal(summary.openingBalanceLinesCount, 3);
  assert.ok(summary.totalCatalogItems >= 7);
  assert.equal(summary.usesLegacyPayrollAccounts, true);
  assert.deepEqual(summary.payrollAccounts69, ['69.01', '69.02.7', '69.03.1', '69.11']);

  // Import a purchase from ООО "ЛесПромСнаб" of "Плита ПВХ" BEFORE connecting Base 0, then rebind against Base 0
  const csvText = [
    '№;Дата;Содержание операции;Сумма',
    '1;15.01.2026;Поступили материалы Плита ПВХ (10 шт.) от поставщика ООО "ЛесПромСнаб" (ИНН 7805123456), в т.ч. НДС 20%, счет-фактура № 12;120000',
  ].join('\n');
  const enc = new TextEncoder().encode(csvText);
  const importedBeforeBase0 = await processBatchFiles(
    [{ name: 'jan_ops.csv', buffer: enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength) }],
    null,
    { reportingYear: 2026 }
  );

  assert.equal(importedBeforeBase0.operations.length, 1);
  assert.equal(importedBeforeBase0.operations[0].bindings.counterparty.status, 'new_for_1c');

  const reboundOps = attachVirtualStateStep00ToOperations(
    rebindOperationsAgainst1CDb(importedBeforeBase0.operations, db1C),
    db1C
  );
  const op = reboundOps[0];
  assert.equal(
    op.bindings.counterparty.status,
    'matched_1c',
    'Counterparty from Base 0 must switch to matched_1c'
  );
  assert.equal(
    op.bindings.nomenclature.status,
    'matched_1c',
    'Nomenclature "Плита ПВХ" from Base 0 must switch to matched_1c'
  );
  const cpPrep = op.mentorGuide1C?.step00Prep?.find((p) => p.entityKind === 'counterparty');
  if (cpPrep) {
    assert.equal(
      cpPrep.status,
      'already_exists',
      'Mentor step00Prep for existing Base 0 counterparty must be already_exists'
    );
  }

  // Calculate OSV with connected Base 0 + new operation
  const osv = calculateOsvReport({
    db1C,
    operations: reboundOps,
    dateFrom: '2026-01-01',
    dateTo: '2026-03-31',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  assert.equal(osv.totals.startDebit, 600000, 'Start Debit must equal Base 0 opening debit (500k + 100k)');
  assert.equal(osv.totals.startCredit, 600000, 'Start Credit must equal Base 0 opening credit (600k)');
  assert.equal(osv.totals.isStartBalanced, true);
  assert.equal(osv.totals.isTurnoverBalanced, true);
  assert.equal(osv.totals.isEndBalanced, true);

  const row1001 = osv.leafRows.find((r) => r.code === '10.01');
  assert.ok(row1001);
  assert.equal(row1001.startDebit, 100000);
  assert.equal(row1001.turnoverDebit, 100000);
  assert.equal(row1001.endDebit, 200000, '10.01 End Debit = 100 000 opening + 100 000 net purchase');

  // Verify meta.usesLegacyPayrollAccounts propagates into Richthofen_1C_Package.json when Base 0 is pre-ENS
  const pkgWithLegacyBase0 = build1CTransferPackage(reboundOps, db1C, null);
  assert.equal(pkgWithLegacyBase0.meta.usesLegacyPayrollAccounts, true);
});
