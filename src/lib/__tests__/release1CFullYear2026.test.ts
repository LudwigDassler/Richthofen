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
import {
  build1CTransferPackage,
  generateBslLoader,
  summarize1CPackageSections,
} from '../export1c';
import { QueuedOperation } from '@/types/accounting';

function readAssetBuffer(relPath: string): ArrayBuffer {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

const STEALTH_FORBIDDEN_RE = new RegExp(
  [
    'richt' + 'hofen',
    'ludwig' + 'dassler',
    'git' + 'hub',
    'https?:\\/\\/',
    'bp30' + '-v1',
    '1c-base0' + '-v1',
    '-cash' + 'in',
    'автооплата51',
    '\\[налог:',
    '\\[фолбэк\\]',
  ].join('|'),
  'iu'
);

test('Release 1C:BP 3.0 (Blocks 1–4): Stealth mode, 3 month-closing fixes, ProveritZapolnenie, and full May–Dec document coverage', async () => {
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

  // Append representative Q4 (Oct–Dec) operations to exercise all remaining annual 1C document types
  const q4RetSupplier: QueuedOperation = {
    ...bindAndGenerateOperation(
      {
        sourceFileName: 'Хоз_Q4.csv',
        date: '2026-10-12',
        description: 'Возвращены бракованные материалы Плита ПВХ (2 шт.) поставщику ООО «Сбыт» по накладной возврата, в т.ч. НДС 20%',
        amount: 12000,
        vatRate: 20,
        vatAmount: 2000,
        vatRule: 'included',
        counterpartyName: 'ООО «Сбыт»',
      },
      null,
      'op-q4-ret-sup'
    ),
    docType1C: 'ВозвратТоваровПоставщику',
  };

  const q4RetBuyer: QueuedOperation = {
    ...bindAndGenerateOperation(
      {
        sourceFileName: 'Хоз_Q4.csv',
        date: '2026-10-20',
        description: 'Оформлен возврат товаров от покупателя ООО «Магнат» по накладной, в т.ч. НДС 20%',
        amount: 24000,
        vatRate: 20,
        vatAmount: 4000,
        vatRule: 'included',
        counterpartyName: 'ООО «Магнат»',
      },
      null,
      'op-q4-ret-buy'
    ),
    docType1C: 'ВозвратТоваровОтПокупателя',
  };

  const q4DebtAdj: QueuedOperation = {
    ...bindAndGenerateOperation(
      {
        sourceFileName: 'Хоз_Q4.csv',
        date: '2026-11-05',
        description: 'Проведен взаимозачет встречных требований (корректировка долга) с ООО «Сбыт» по акту взаимозачета',
        amount: 15000,
        vatRate: 0,
        vatAmount: 0,
        vatRule: 'none',
        counterpartyName: 'ООО «Сбыт»',
      },
      null,
      'op-q4-debt-adj'
    ),
    docType1C: 'КорректировкаДолга',
  };

  const q4InvWriteOff: QueuedOperation = {
    ...bindAndGenerateOperation(
      {
        sourceFileName: 'Хоз_Q4.csv',
        date: '2026-11-18',
        description: 'По результатам инвентаризации списаны испорченные материалы (Клей, 1 кг) по акту списания ТМЦ',
        amount: 3500,
        vatRate: 0,
        vatAmount: 0,
        vatRule: 'none',
        categoryHint: 'inventory_result',
      },
      null,
      'op-q4-inv-wo'
    ),
    docType1C: 'СписаниеТоваров',
  };

  const q4OsWriteOff: QueuedOperation = {
    ...bindAndGenerateOperation(
      {
        sourceFileName: 'Хоз_Q4.csv',
        date: '2026-12-10',
        description: 'Списан вследствие физического износа объект основных средств «Бытовка строительная» по акту списания ОС',
        amount: 120000,
        vatRate: 0,
        vatAmount: 0,
        vatRule: 'none',
        nomenclatureName: 'Бытовка строительная',
        categoryHint: 'os_disposal',
      },
      null,
      'op-q4-os-wo'
    ),
    docType1C: 'СписаниеОС',
  };

  const q4Dismissal: QueuedOperation = {
    ...bindAndGenerateOperation(
      {
        sourceFileName: 'Хоз_Q4.csv',
        date: '2026-12-15',
        description: 'Приказ об увольнении по собственному желанию сотрудника Валеев В.В.',
        amount: 0,
        vatRate: 0,
        vatAmount: 0,
        vatRule: 'none',
        employeeName: 'Валеев В.В.',
        categoryHint: 'hr_hire',
      },
      null,
      'op-q4-hr-dismiss'
    ),
    docType1C: 'Увольнение',
  };

  const allOpsRaw = recalculateOperationsChronologically(
    [
      ...batch.operations,
      q4RetSupplier,
      q4RetBuyer,
      q4DebtAdj,
      q4InvWriteOff,
      q4OsWriteOff,
      q4Dismissal,
    ],
    null,
    {
      reportingYear: 2026,
      calculationProfile: 'bp30_legacy_pre2023',
      monthlyProfitTax: true,
    }
  );

  const fixed = autoFixAllBy1CDb({
    db1C: null,
    operations: allOpsRaw,
    calculateCurrentOsv: (ops, dateToOverride) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        dateFrom: '2026-01-01',
        dateTo: dateToOverride || '2026-12-31',
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-12-31',
    reportingYear: 2026,
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });

  const { finalState } = buildVirtual1CStateTimeline(null, fixed.operations);
  const pkg = build1CTransferPackage(fixed.operations, null, finalState, {
    calculationProfile: 'bp30_legacy_pre2023',
    monthlyProfitTax: true,
  });
  const serializedPkg = JSON.stringify(pkg);
  const bsl = generateBslLoader({ defaultReportingYear: 2026 });

  // =========================================================================
  // BLOCK 1: Stealth Mode (zero automation traces in JSON and BSL)
  // =========================================================================
  assert.equal(pkg.meta.schemaVersion, '1.0');
  assert.equal(STEALTH_FORBIDDEN_RE.test(serializedPkg), false, 'Package_1C.json must contain zero stealth/service markers');
  assert.equal(STEALTH_FORBIDDEN_RE.test(bsl), false, 'Loader_1C83.bsl must contain zero stealth/service markers');

  const legacyIdKey = 'richt' + 'hofenId';
  for (const doc of pkg.documents) {
    assert.ok(typeof doc.documentId === 'string' && doc.documentId.length > 0, 'Every document must carry documentId');
    assert.equal(legacyIdKey in (doc as unknown as Record<string, unknown>), false, 'Legacy ID field must not exist');
  }

  // =========================================================================
  // BLOCK 2: Fix All 3 «Закрытие месяца» Errors
  // =========================================================================
  // 2.1 ПогашениеЗадолженности = Автоматически
  assert.match(bsl, /ПрименитьПогашениеЗадолженностиАвтоматически\(ДокОбъект\)/u);

  // 2.2 Native bank account priority: posted bank docs -> Организация.ОсновнойБанковскийСчет -> active 20-digit account -> create last
  const bankFnIdx = bsl.indexOf('Функция НайтиНативныйБанковскийСчетВладельца(Организация)');
  const bankFnBody = bsl.slice(bankFnIdx, bsl.indexOf('КонецФункции', bankFnIdx));
  const p1 = bankFnBody.indexOf('ИЗ Документ.СписаниеСРасчетногоСчета');
  const p2 = bankFnBody.indexOf('Организация.ОсновнойБанковскийСчет');
  const p3 = bankFnBody.indexOf('СтрДлина(НомСтр) >= 20');
  assert.ok(p1 > 0 && p2 > p1 && p3 > p2, 'Strict 1 -> 2 -> 3 priority in НайтиНативныйБанковскийСчетВладельца');

  // 2.3 Chief Accountant hire in April 2026 even WITHOUT Base 0 must have real Russian FIO ('Иванова Мария Сергеевна'), never "Главный бухгалтер"
  const aprilHire = pkg.documents.find(
    (d) => d.metaType1C === 'ПриемНаРаботу' && d.date.startsWith('2026-04')
  );
  assert.ok(aprilHire, 'Expected ПриемНаРаботу in April 2026');
  assert.equal(aprilHire.header.employeeName, 'Иванова Мария Сергеевна');
  assert.equal(aprilHire.header.employeePosition, 'Главный бухгалтер');
  assert.equal(aprilHire.header.monthlySalary, 72200);

  // 2.4 НайтиВидНачисленияОклада(Док, ИмяТЧ, ИмяКолонкиНачисления): strict 1 -> 2 -> 3 priority, dynamic ТЧ/header discovery, diagnostic dump format, zero hardcoded ОплатаПоОкладу
  assert.equal(bsl.includes('.ОплатаПоОкладу'), false, 'Loader_1C83.bsl must not hardcode .ОплатаПоОкладу');
  const accFnIdx = bsl.indexOf('Функция НайтиВидНачисленияОклада(Док, ИмяТЧ, ИмяКолонкиНачисления)');
  assert.ok(accFnIdx > 0, 'Expected НайтиВидНачисленияОклада helper in BSL');
  const accFnBody = bsl.slice(accFnIdx, bsl.indexOf('КонецФункции', accFnIdx));
  const accP1 = accFnBody.indexOf('ВЫБРАТЬ ПЕРВЫЕ 1 Начисление ИЗ РегистрСведений.ПлановыеНачисления ГДЕ Начисление <> НЕОПРЕДЕЛЕНО УПОРЯДОЧИТЬ ПО Период УБЫВ');
  const accP2 = accFnBody.indexOf('ИЗ Документ.ПриемНаРаботу.');
  const accP3 = accFnBody.indexOf('Метаданные.НайтиПоТипу(ТипНач)');
  assert.ok(
    accP1 > 0 && accP2 > accP1 && accP3 > accP2,
    'Strict Priority 1 (ПлановыеНачисления) -> Priority 2 (ПриемНаРаботу.<ИмяТЧ>) -> Priority 3 (Метаданные.НайтиПоТипу) in НайтиВидНачисленияОклада'
  );
  assert.match(bsl, /Функция\s+ОпределитьРеквизитыНачисленийПриемаНаРаботу\(Док\)/u);
  assert.match(bsl, /Функция\s+ПроверитьЗаполнениеНачисленияПриемаНаРаботу\(Док\)/u);
  assert.match(bsl, /ТипКолонкиНач=/u);
  assert.match(bsl, /МДПоТипу\.ПолноеИмя\(\)/u);

  // 2.5 ВыгрузитьБазу0НаСервере: safe non-hierarchical Справочник.Организации + cutoff fallback (01.01 -> ПериодС -> ДобавитьМесяц(НачалоМесяца(МаксПериодБазы), 1))
  assert.match(bsl, /УсловиеБезГруппСправочника\("Организации",\s*"Орг"\)/u);
  assert.match(bsl, /ДатаПериодС\s*=\s*НачалоДня\(ЭтотОбъект\["ПериодС"\]\)/u);
  assert.match(bsl, /Если МассивОстатков\.Количество\(\) = 0 Тогда/u);
  assert.match(bsl, /ВЫБРАТЬ МАКСИМУМ\(Движ\.Период\) КАК МаксПериод ИЗ РегистрБухгалтерии\.Хозрасчетный/u);
  assert.match(bsl, /ДобавитьМесяц\(НачалоМесяца\(МаксПериодБазы\),\s*1\)/u);

  // 2.6 Neutral build stamp ONLY in form log, never in documents
  assert.match(bsl, /Сборка модуля: bp30-may-fix-2/u);
  assert.equal(serializedPkg.includes('bp30-may-fix-2'), false, 'Package_1C.json must never contain build stamp');

  // =========================================================================
  // BLOCK 3: Full May–December 2026 Document Hardening
  // =========================================================================
  // 3.1 ПередачаОС (04.06 ООО «Светоч» 4,500,000 ₽ & 07.07 ООО «Управление» 1,636,000 ₽)
  const osSales = pkg.documents.filter((d) => d.metaType1C === 'ПередачаОС');
  assert.ok(osSales.length >= 2, `Expected >= 2 ПередачаОС documents, got ${osSales.length}`);
  const saleJune = osSales.find((d) => d.date === '2026-06-04' && Math.abs(d.header.amount - 4500000) < 1);
  const saleJuly = osSales.find((d) => d.date === '2026-07-07' && Math.abs(d.header.amount - 1636000) < 1);
  assert.ok(saleJune, 'Expected 04.06.2026 ПередачаОС for 4,500,000 ₽');
  assert.ok(saleJuly, 'Expected 07.07.2026 ПередачаОС for 1,636,000 ₽');
  for (const osSale of [saleJune, saleJuly]) {
    assert.ok(osSale.header.debitAccount.startsWith('62'), 'ПередачаОС debitAccount must be 62.*');
    assert.equal(osSale.header.registerInvoiceSF, true);
    assert.equal(osSale.header.invoiceSFKind, 'issued_sale');
    assert.ok(osSale.rows.length >= 1);
    assert.equal(osSale.rows[0].costAccount, '91.02');
    assert.equal(osSale.rows[0].vatAccount, '91.02');
    const ctr = pkg.catalogs.contracts.find((c) => c.key === osSale.header.contractKey);
    assert.equal(ctr?.kind, 'СПокупателем');
  }
  assert.match(bsl, /Функция\s+НайтиИлиСоздатьСобытиеОС\(/u);

  // 3.2 ПоступлениеДопРасходов (02.08 11,800 ₽, 08.08 316,000 ₽ paid immediately, 11.09 59,000 ₽ paid immediately)
  const addExpDocs = pkg.documents.filter((d) => d.metaType1C === 'ПоступлениеДопРасходов');
  assert.ok(addExpDocs.length >= 3, `Expected >= 3 ПоступлениеДопРасходов docs, got ${addExpDocs.length}`);
  const expAug2 = addExpDocs.find((d) => d.date === '2026-08-02' && Math.abs(d.header.amount - 11800) < 1);
  const expAug8 = addExpDocs.find((d) => d.date === '2026-08-08' && Math.abs(d.header.amount - 316000) < 1);
  const expSep11 = addExpDocs.find((d) => d.date === '2026-09-11' && Math.abs(d.header.amount - 59000) < 1);
  assert.ok(expAug2 && expAug2.rows.length > 0, '02.08.2026 ПоступлениеДопРасходов (11,800 ₽) must carry target batch rows');
  assert.ok(
    expAug8 && expAug8.rows.length > 0 && expAug8.header.isPaidImmediately === true,
    '08.08.2026 ПоступлениеДопРасходов (316,000 ₽) must carry target batch rows and isPaidImmediately = true'
  );
  assert.ok(
    expSep11 && expSep11.rows.length > 0 && expSep11.header.isPaidImmediately === true,
    '11.09.2026 ПоступлениеДопРасходов (59,000 ₽) must carry target batch rows and isPaidImmediately = true'
  );
  assert.match(bsl, /Процедура\s+УстановитьСпособРаспределенияДопРасходовПоМетаданным\(/u);
  assert.match(bsl, /Функция\s+НайтиДокументПартииПТУДляНоменклатуры\(/u);

  // 3.3 АвансовыйОтчет (21.08 8,400 ₽ & 05.09 9,200 ₽)
  const aoDocs = pkg.documents.filter((d) => d.metaType1C === 'АвансовыйОтчет');
  const aoAug21 = aoDocs.find((d) => d.date === '2026-08-21' && Math.abs(d.header.amount - 8400) < 1);
  const aoSep5 = aoDocs.find((d) => d.date === '2026-09-05' && Math.abs(d.header.amount - 9200) < 1);
  assert.ok(
    aoAug21 && aoAug21.header.employeeKey.length > 0 && (aoAug21.header.employeeName || '').length > 0,
    '21.08 АвансовыйОтчет must resolve accountable employee'
  );
  assert.ok(
    aoSep5 && aoSep5.header.employeeKey.length > 0 && (aoSep5.header.employeeName || '').length > 0 && aoSep5.rows[0]?.nomenclatureKey.length > 0,
    '05.09 АвансовыйОтчет must resolve accountable employee and non-empty nomenclatureKey'
  );
  assert.match(bsl, /Процедура\s+УстановитьПодотчетноеЛицоПоМетаданным\(/u);
  assert.match(bsl, /Процедура\s+ЗаполнитьТЧАвансыАвансовогоОтчета\(/u);

  // 3.4 Buyer advance refunds (31.08 ООО «Магнат» 1,520,000 ₽ & 29.09 ООО «ЖилСтройИнвест» 1,000,000 ₽) -> ВозвратПокупателю (never ПеречислениеНалога!)
  const refundAug31 = pkg.documents.find(
    (d) => d.date === '2026-08-31' && d.metaType1C === 'СписаниеСРасчетногоСчета' && Math.abs(d.header.amount - 1520000) < 1
  );
  const refundSep29 = pkg.documents.find(
    (d) => d.date === '2026-09-29' && d.metaType1C === 'СписаниеСРасчетногоСчета' && Math.abs(d.header.amount - 1000000) < 1
  );
  assert.ok(refundAug31, 'Expected 31.08.2026 buyer refund 1,520,000 ₽');
  assert.equal(refundAug31.header.operationKind1C, 'ВозвратПокупателю');
  assert.ok(refundSep29, 'Expected 29.09.2026 buyer refund 1,000,000 ₽');
  assert.equal(refundSep29.header.operationKind1C, 'ВозвратПокупателю');

  // 3.5 Sept 2 lawn grass ("газонная трава (56 кг)") -> ПоступлениеТоваровУслуг (Товары, 10.08) + ТребованиеНакладная
  const sep2Docs = pkg.documents.filter((d) => d.date === '2026-09-02');
  const sep2Ptu = sep2Docs.find((d) => d.metaType1C === 'ПоступлениеТоваровУслуг');
  const sep2WriteOff = sep2Docs.find((d) => d.metaType1C === 'ТребованиеНакладная');
  assert.ok(sep2Ptu && sep2Ptu.header.operationKind1C === 'Товары', '02.09 lawn grass must be ПоступлениеТоваровУслуг (Товары)');
  assert.ok(sep2WriteOff, '02.09 lawn grass transfer for landscaping must emit ТребованиеНакладная');

  // 3.6 ПринятиеКУчетуОС carries exact usefulLifeMonths per asset (not hardcoded 60 everywhere)
  const osCommissionDocs = pkg.documents.filter((d) => d.metaType1C === 'ПринятиеКУчетуОС');
  assert.ok(osCommissionDocs.length >= 2, 'Expected ПринятиеКУчетуОС documents across the year');
  assert.ok(
    osCommissionDocs.every((d) => typeof d.header.usefulLifeMonths === 'number' && d.header.usefulLifeMonths >= 13),
    'Every ПринятиеКУчетуОС document must specify usefulLifeMonths >= 13'
  );
  assert.match(bsl, /СПИМесОС\s*=\s*Число\(ПолучитьИзСоответствия\(Шапка,\s*"usefulLifeMonths",\s*0\)\)/u);

  // 3.7 Q4 native document types mapped cleanly & partitioned in 8 sections
  for (const expectedType of [
    'ВозвратТоваровПоставщику',
    'ВозвратТоваровОтПокупателя',
    'КорректировкаДолга',
    'СписаниеТоваров',
    'СписаниеОС',
    'Увольнение',
  ] as const) {
    const found = pkg.documents.find((d) => d.metaType1C === expectedType);
    assert.ok(found && found.executionStrategy === 'native', `Expected native document ${expectedType} in full-year package`);
  }
  const secSummary = summarize1CPackageSections(pkg);
  assert.equal(
    secSummary.purchases +
      secSummary.sales +
      secSummary.bankCash +
      secSummary.warehouse +
      secSummary.osNma +
      secSummary.hrPayroll +
      secSummary.manualOps +
      secSummary.reglamentIn1C,
    pkg.documents.length
  );

  // 3.8 May–Dec Fix #1: ТребованиеНакладная (all write-offs have non-empty nomenclature, leaf 10.* account, reconciled >0 qty, and BSL metadata account fill)
  const tnDocs = pkg.documents.filter((d) => d.metaType1C === 'ТребованиеНакладная');
  assert.ok(tnDocs.length >= 8, `Expected >= 8 ТребованиеНакладная documents across May–Sept, got ${tnDocs.length}`);
  for (const tn of tnDocs) {
    assert.ok(tn.rows.length >= 1, `ТребованиеНакладная on ${tn.date} must have >= 1 row`);
    for (const r of tn.rows) {
      assert.ok(r.nomenclatureKey.length > 0 && r.nomenclatureName.length > 0, `ТребованиеНакладная row on ${tn.date} must have non-empty nomenclature`);
      assert.ok(r.quantity > 0, `ТребованиеНакладная row on ${tn.date} must have quantity > 0`);
      assert.match(r.account, /^10\.\d+/u, `ТребованиеНакладная row on ${tn.date} must use leaf 10.* subaccount, got ${r.account}`);
    }
  }
  const ptuMay17 = pkg.documents.find((d) => d.metaType1C === 'ПоступлениеТоваровУслуг' && d.date === '2026-05-17');
  const tnMay19 = tnDocs.find((d) => d.date === '2026-05-19');
  assert.ok(
    ptuMay17 && tnMay19 && tnMay19.rows[0].nomenclatureName === 'Бетон' && tnMay19.rows[0].account === ptuMay17.rows[0].account && tnMay19.rows[0].account === '10.08',
    '19.05 ТребованиеНакладная must resolve Бетон on exact 17.05 receipt subaccount 10.08'
  );
  const tnJul06 = tnDocs.find((d) => d.date === '2026-07-06');
  assert.ok(tnJul06 && tnJul06.rows[0].quantity === 160, '06.07 ТребованиеНакладная must write off all 160 ceiling tiles');
  const tnAug09 = tnDocs.find((d) => d.date === '2026-08-09');
  const brickRowAug09 = tnAug09?.rows.find((r) => /кирпич/iu.test(r.nomenclatureName));
  const mortarRowAug09 = tnAug09?.rows.find((r) => /раствор/iu.test(r.nomenclatureName));
  assert.ok(
    brickRowAug09?.quantity === 750 && mortarRowAug09?.quantity === 1,
    '09.08 ТребованиеНакладная must write off 750 bricks + 1 batch of mortar'
  );
  const tnSep08 = tnDocs.find((d) => d.date === '2026-09-08');
  assert.ok(tnSep08 && tnSep08.rows[0].quantity === 1, '08.09 ТребованиеНакладная must reconcile parquet batch qty = 1');
  assert.match(bsl, /Функция\s+ПодобратьМатериалИСчет10ДляСписания\(/u);
  assert.match(bsl, /Процедура\s+ЗаполнитьСчетаСтрокиМатериаловПоМетаданным\(/u);

  // 3.9 May–Dec Fix #2: ИсполнительныйЛист (06.05 Федоров Ф.Ф., start date >= doc date, end date 31.12.2026, 25%, metadata fill + initials match)
  const writMay06 = pkg.documents.find((d) => d.metaType1C === 'ИсполнительныйЛист' && d.date === '2026-05-06');
  assert.ok(writMay06, 'Expected 06.05.2026 ИсполнительныйЛист');
  assert.equal(writMay06.header.employeeName, 'Федоров Ф.Ф.');
  assert.ok((writMay06.header.writStartDate || '') >= writMay06.date, 'writStartDate must be >= document date (never < prohibition date)');
  assert.equal(writMay06.header.writEndDate, '2026-12-31');
  assert.equal(writMay06.header.alimonyRatePercent, 25);
  assert.match(bsl, /Процедура\s+ЗаполнитьРеквизитыИсполнительногоЛистаПоМетаданным\(/u);
  assert.match(bsl, /Функция\s+ФИОСовпадаетСИнициалами\(/u);

  // 3.10 May–Dec Fix #3: ИнвентаризацияНЗП (31.05, 30.06, 31.08 — non-zero Состав row, exact WIP amount, sorted after payroll and before month-close)
  const wipDocs = pkg.documents.filter((d) => d.metaType1C === 'ИнвентаризацияНЗП' && d.date >= '2026-05-01');
  assert.equal(wipDocs.length, 3, 'Expected 3 ИнвентаризацияНЗП documents in May–Dec (31.05, 30.06, 31.08)');
  const wipMay = wipDocs.find((d) => d.date === '2026-05-31');
  const wipJun = wipDocs.find((d) => d.date === '2026-06-30');
  const wipAug = wipDocs.find((d) => d.date === '2026-08-31');
  assert.ok(wipMay && Math.abs(wipMay.header.amount - 568779.93) < 0.05 && wipMay.rows[0]?.nomenclatureGroup === 'Ремонт помещений');
  assert.ok(wipJun && Math.abs(wipJun.header.amount - 794638.53) < 0.05 && wipJun.rows[0]?.nomenclatureGroup === 'Ремонт помещений');
  assert.ok(wipAug && Math.abs(wipAug.header.amount - 6633480.26) < 0.05 && wipAug.rows[0]?.nomenclatureGroup === 'Кирпичная кладка');
  for (const dEnd of ['2026-05-31', '2026-06-30', '2026-08-31']) {
    const idxPayroll = pkg.documents.findIndex(
      (d) => d.date === dEnd && (d.metaType1C === 'НачислениеЗарплаты' || d.comment.toLowerCase().includes('начислена заработная плата'))
    );
    const idxWip = pkg.documents.findIndex((d) => d.date === dEnd && d.metaType1C === 'ИнвентаризацияНЗП');
    const idxClose = pkg.documents.findIndex(
      (d) => d.date === dEnd && d.metaType1C === 'ЗакрытиеМесяца' && d.header.operationKind1C === 'ЗакрытиеМесяца'
    );
    assert.ok(idxPayroll >= 0 && idxWip > idxPayroll && idxClose > idxWip, `On ${dEnd}, ИнвентаризацияНЗП must be sorted after payroll accrual and before ЗакрытиеМесяца`);
  }
  assert.match(bsl, /Функция\s+ПодобратьНоменклатурнуюГруппуИОстатокНЗП\(/u);
  assert.match(bsl, /МетаНЗП\.ТабличныеЧасти\.Найти\("Состав"\)/u);

  // 3.11 May–Dec Fix #4: СчетНаОплатуПокупателю (01.05 — 2,320,000 ₽, non-empty nomenclature, bank account metadata fill)
  const invBuyerMay01 = pkg.documents.find((d) => d.metaType1C === 'СчетНаОплатуПокупателю' && d.date === '2026-05-01');
  assert.ok(invBuyerMay01, 'Expected 01.05.2026 СчетНаОплатуПокупателю');
  assert.equal(invBuyerMay01.header.amount, 2320000);
  assert.ok(invBuyerMay01.rows.length === 1 && invBuyerMay01.rows[0].nomenclatureKey.length > 0 && invBuyerMay01.rows[0].nomenclatureName.length > 0);
  assert.match(bsl, /УстановитьЕслиЕсть\(ДокОбъект,\s*"СтруктурнаяЕдиница",\s*БанкСчСчетПок\)/u);

  // 3.12 Payroll & Cash Payouts: 15.05 via bank (51), 15.06 & 15.08 via cash (50.01), 20.08 & 04.09 RKO with 50.01<-51 auto-PKO
  const payMay15 = pkg.documents.find((d) => d.date === '2026-05-15' && d.dynamicBalanceMode === 'payroll_balance');
  assert.ok(payMay15 && payMay15.metaType1C === 'СписаниеСРасчетногоСчета', '15.05 payroll payout must remain via bank (СписаниеСРасчетногоСчета)');
  const payJun15 = pkg.documents.find((d) => d.date === '2026-06-15' && d.dynamicBalanceMode === 'payroll_balance');
  const payAug15 = pkg.documents.find((d) => d.date === '2026-08-15' && d.dynamicBalanceMode === 'payroll_balance');
  assert.ok(payJun15 && payJun15.metaType1C === 'ВыдачаНаличных', '15.06 payroll payout must be cash RKO (ВыдачаНаличных)');
  assert.ok(payAug15 && payAug15.metaType1C === 'ВыдачаНаличных', '15.08 payroll payout must be cash RKO (ВыдачаНаличных)');
  assert.match(bsl, /Функция\s+ДокументСодержитСнятиеНаличныхИзБанка51\(/u);

  // =========================================================================
  // BLOCK 4: ПроверитьЗаполнение() & Chronological Re-posting (ПТУ + ДопРасходы + РТУ + ПередачаОС)
  // =========================================================================
  assert.match(bsl, /ПрошелПроверкуЗаполнения\s*=\s*ДокОбъект\.ПроверитьЗаполнение\(\)/u);
  assert.match(bsl, /\[ВНИМАНИЕ ПРОБЛЕМА ЗАПОЛНЕНИЯ\]/u);
  assert.match(bsl, /НужноПерепровестиПериод\s*=\s*\(СозданоИПроведено\s*>\s*0\s+Или\s+ПерезаписаноЧерновиков\s*>\s*0\)/u);
  assert.match(bsl, /ИЗ Документ\.ПоступлениеДопРасходов/u);
  assert.match(bsl, /ИЗ Документ\.ПередачаОС/u);
});

test('Release 1C:BP 3.0 (Block 5): Exact 0.00-kopeck April 2026 OSV convergence with live 1C:BP 3.0 (14,202,374.21 RUB)', async () => {
  const q2Input = {
    name: 'Хоз(1).csv',
    buffer: readAssetBuffer('public/assets/aistudio/____1__443ffb42.csv'),
  };

  // Exact clean Base 0 JSON exported from live educational 1C:BP 3.0 as of 2026-04-01 (21,780,009.27 ₽)
  const cleanBase0April = {
    ФорматБазы0: '1.0',
    ОтчетныйГод: 2026,
    ДатаОстатков: '2026-04-01',
    usesLegacyPayrollAccounts: true,
    payrollAccounts69: ['69.01', '69.02.7', '69.03.1', '69.11'],
    Организация: {
      Наименование: 'ООО «Завод»',
      ИНН: '7810119529',
      КПП: '781001001',
      ГлавныйБухгалтер: 'Иванова Мария Сергеевна',
    },
    ВсеСправочники: {
      Сотрудники: [
        { Код: '000000001', Наименование: 'Федоров Ф.Ф.', Должность: 'Генеральный директор', Оклад: 115000, СчетЗатрат: '26' },
        { Код: '000000002', Наименование: 'Валеев В.В.', Должность: 'Фрезеровщик', Оклад: 88400, СчетЗатрат: '20.01' },
        { Код: '000000003', Наименование: 'Фадеев Ф.Ф.', Должность: 'Каменщик', Оклад: 69900, СчетЗатрат: '20.01' },
      ],
      ИсполнительныеЛисты: [
        {
          Сотрудник: 'Валеев В.В.',
          Получатель: 'Валеева О.Г.',
          Размер: 20000,
          ДействуетС: '2026-04-01',
          ДействуетПо: '2026-12-31',
          Дата: '2026-03-27',
        },
      ],
      РасходыБудущихПериодов: [
        {
          Код: '000000001',
          Наименование: 'Взнос в компенсационный фонд СРО',
          Сумма: 1000000,
          ДатаНачалаСписания: '2026-03-01',
          ДатаОкончанияСписания: '2026-12-31',
          СпособСписания: 'По месяцам',
          СчетЗатрат: '26',
        },
      ],
      ОсновныеСредства: [
        {
          Код: '000000001',
          Наименование: 'Фрезерный станок',
          ПервоначальнаяСтоимость: 3625000,
          СрокПолезногоИспользования: 72,
          СчетЗатрат: '20.01',
        },
        {
          Код: '000000002',
          Наименование: 'Леса строительные',
          ПервоначальнаяСтоимость: 800000,
          СрокПолезногоИспользования: 60,
          СчетЗатрат: '20.01',
        },
      ],
      ЦенныеБумаги: [
        {
          Контрагент: 'ПАО Банк «Санкт-Петербург»',
          Наименование: 'Вексель ПАО Банк «Санкт-Петербург»',
          Сумма: 620000,
          Дата: '2026-03-17',
          Содержание: 'Приобретен вексель у Банка Санкт-Петербург под 15% годовых',
        },
      ],
    },
    НачальныеОстатки: [
      { Счет: '01.01', Субконто1: 'Фрезерный станок', СальдоНачДт: 3625000, СальдоНачКт: 0 },
      { Счет: '01.01', Субконто1: 'Леса строительные', СальдоНачДт: 800000, СальдоНачКт: 0 },
      { Счет: '02.01', Субконто1: 'Фрезерный станок', СальдоНачДт: 0, СальдоНачКт: 100694.44 },
      { Счет: '20.01', Субконто1: 'Основная номенклатурная группа', СальдоНачДт: 370530.27, СальдоНачКт: 0 },
      { Счет: '51', Субконто1: 'Основной счет', СальдоНачДт: 14257162.0, СальдоНачКт: 0 },
      { Счет: '58.02', Субконто1: 'ПАО Банк «Санкт-Петербург»', СальдоНачДт: 620000.0, СальдоНачКт: 0 },
      { Счет: '60.01', Субконто1: 'ООО «Континент»', СальдоНачДт: 0, СальдоНачКт: 2896000.0 },
      { Счет: '60.01', Субконто1: 'ООО «Стабильность»', СальдоНачДт: 0, СальдоНачКт: 960000.0 },
      { Счет: '60.01', Субконто1: 'ООО «Сбыт»', СальдоНачДт: 0, СальдоНачКт: 195710.0 },
      { Счет: '62.02', Субконто1: 'ООО «Конкурент»', СальдоНачДт: 0, СальдоНачКт: 6120000.0 },
      { Счет: '62.02', Субконто1: 'ООО «Управление»', СальдоНачДт: 0, СальдоНачКт: 690000.0 },
      { Счет: '68.01', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 61217.0 },
      { Счет: '68.02', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 1527068.34 },
      { Счет: '68.04.1', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 1197558.0 },
      { Счет: '69.01', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 13824.3 },
      { Счет: '69.02.7', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 123942.0 },
      { Счет: '69.03.1', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 24311.7 },
      { Счет: '69.11', Субконто1: 'Налог (взносы): начислено / уплачено', СальдоНачДт: 0, СальдоНачКт: 953.4 },
      { Счет: '70', Субконто1: '', СальдоНачДт: 0, СальдоНачКт: 238525.0 },
      { Счет: '76.09', Субконто1: 'ПАО Банк «Санкт-Петербург»', СальдоНачДт: 3567.0, СальдоНачКт: 0 },
      { Счет: '76.АВ', Субконто1: 'ООО «Конкурент»', СальдоНачДт: 1020000.0, СальдоНачКт: 0 },
      { Счет: '76.АВ', Субконто1: 'ООО «Управление»', СальдоНачДт: 115000.0, СальдоНачКт: 0 },
      { Счет: '80.09', Субконто1: '', СальдоНачДт: 0, СальдоНачКт: 2840000.0 },
      { Счет: '97.21', Субконто1: 'Взнос в компенсационный фонд СРО', СальдоНачДт: 968750.0, СальдоНачКт: 0 },
      { Счет: '99.01.1', Субконто1: '', СальдоНачДт: 0, СальдоНачКт: 5987763.09 },
      { Счет: '99.02.1', Субконто1: '', СальдоНачДт: 1197558.0, СальдоНачКт: 0 },
    ],
  };

  const db1CLiveApril = parseBase0Json(JSON.stringify(cleanBase0April), 'base0_live_april.json', 2026);
  const seededState = createInitialVirtual1CState(db1CLiveApril);
  assert.equal(seededState.deferredExpenses?.[0]?.writeOffAccount, '26');

  // 3. Parse Q2 file and filter April 2026 primary operations, rebind against live Base 0, and run autoFixAllBy1CDb
  const q2Batch = await processBatchFiles([q2Input], db1CLiveApril, {
    reportingYear: 2026,
  });
  const aprilPrimaryOps = rebindOperationsAgainst1CDb(
    q2Batch.operations.filter((op) => op.date >= '2026-04-01' && op.date <= '2026-04-30'),
    db1CLiveApril,
    {
      reportingYear: 2026,
      calculationProfile: 'bp30_legacy_pre2023',
      monthlyProfitTax: true,
    }
  );

  const aprilFixed = autoFixAllBy1CDb({
    db1C: db1CLiveApril,
    operations: aprilPrimaryOps,
    calculateCurrentOsv: (ops, dateToOverride) =>
      calculateOsvReport({
        db1C: db1CLiveApril,
        operations: ops,
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

  const osvApril = calculateOsvReport({
    db1C: db1CLiveApril,
    operations: aprilFixed.operations,
    dateFrom: '2026-04-01',
    dateTo: '2026-04-30',
    reportingYear: 2026,
    includeQueuedOperations: true,
  });

  // Verify exact control numbers from live 1C:BP 3.0 April 2026 OSV:
  assert.equal(osvApril.totals.startDebit.toFixed(2), '21780009.27', 'Start Debit on 01.04.2026 must be 21,780,009.27 ₽');
  assert.equal(osvApril.totals.startCredit.toFixed(2), '21780009.27', 'Start Credit on 01.04.2026 must be 21,780,009.27 ₽');

  const row51 = osvApril.leafRows.find((r) => r.code === '51');
  assert.ok(row51);
  assert.equal(row51.endDebit.toFixed(2), '8296263.10', 'Account 51 end Debit must be 8,296,263.10 ₽');
  assert.equal(row51.endCredit.toFixed(2), '0.00');

  const row5001 = osvApril.leafRows.find((r) => r.code === '50.01');
  assert.equal((row5001?.endDebit ?? 0).toFixed(2), '0.00', 'Account 50.01 end Debit must be 0.00 ₽');
  assert.equal((row5001?.endCredit ?? 0).toFixed(2), '0.00', 'Account 50.01 end Credit must be 0.00 ₽');

  const row6001 = osvApril.leafRows.find((r) => r.code === '60.01');
  const row6002 = osvApril.leafRows.find((r) => r.code === '60.02');
  assert.equal((row6001?.endCredit ?? 0).toFixed(2), '3494000.00', 'Account 60.01 end Credit must be 3,494,000.00 ₽');
  assert.equal((row6002?.endDebit ?? 0).toFixed(2), '0.00', 'Account 60.02 end Debit must be 0.00 ₽');

  const row6201 = osvApril.leafRows.find((r) => r.code === '62.01');
  const row6202 = osvApril.leafRows.find((r) => r.code === '62.02');
  assert.equal(round2((row6201?.endDebit ?? 0) + (row6201?.endCredit ?? 0)).toFixed(2), '0.00', 'Account 62.01 end balance must be 0.00 ₽');
  assert.equal(round2((row6202?.endDebit ?? 0) + (row6202?.endCredit ?? 0)).toFixed(2), '0.00', 'Account 62.02 end balance must be 0.00 ₽');

  const row9721 = osvApril.leafRows.find((r) => r.code === '97.21');
  assert.ok(row9721);
  assert.equal(row9721.turnoverCredit.toFixed(2), '107638.89', 'Account 97.21 April write-off must be 107,638.89 ₽');
  assert.equal(row9721.endDebit.toFixed(2), '861111.11', 'Account 97.21 end Debit must be 861,111.11 ₽');

  assert.equal(osvApril.totals.endDiff, 0, 'End OSV diff must be 0.00 ₽');
  assert.equal(osvApril.totals.endDebit.toFixed(2), '14202374.21', 'Final OSV total on 30.04.2026 must match live 1C:BP 3.0: 14,202,374.21 ₽');
  assert.equal(osvApril.totals.endCredit.toFixed(2), '14202374.21', 'Final OSV credit total on 30.04.2026 must match live 1C:BP 3.0: 14,202,374.21 ₽');
});
