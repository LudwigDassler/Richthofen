import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize1CDatabaseExport } from '../import1c/json1CSyncNormalizer';
import { calculateOsvReport } from '../engine/osvCalculator';
import { bindAndGenerateOperation } from '../engine/postingEngine';
import {
  parse1CClientBankExchange,
  parseFreeTextOrDelimitedOperations,
  parseXml1CDocuments,
} from '../import1c/batchFileParser';
import {
  autoFixAllBy1CDb,
  runAuditDiagnostics,
} from '../engine/auditAndAutofix';
import { buildExportBundle } from '../export1c/index';

function buildRealistic1CRawJson() {
  // Real-world shape: Организация, Остатки (current register balances at end of April),
  // ПроводкиС_Апреля, ВсеСправочники, ВсеДокументы, РегистрыСведений.
  // Start balances on 01.04:
  //   51 (active): 1 000 000 Dt
  //   80.09 (passive): 1 000 000 Kt
  // April postings in 1C:
  //   1) 05.04: Дт 41.01 Кт 60.01 = 100 000; Дт 19.03 Кт 60.01 = 20 000; Дт 68.02 Кт 19.03 = 20 000
  //   2) 10.04: Дт 60.01 Кт 51 = 120 000
  // Resulting current Остатки in 1C after April postings:
  //   51: 880 000 Dt
  //   41.01: 100 000 Dt
  //   68.02: 20 000 Dt (tax credit)
  //   80.09: 1 000 000 Kt
  // Sum End Dt = 880k + 100k + 20k = 1 000 000 === Sum End Kt = 1 000 000
  return {
    Организация: {
      Наименование: 'ООО «Завод МеталлПрофиль»',
      НаименованиеПолное: 'Общество с ограниченной ответственностью «Завод МеталлПрофиль»',
      ИНН: '6671098412',
      КПП: '667101001',
      ОГРН: '1186658012345',
      РасчетныйСчет: '40702810416540012345',
      БИК: '046577674',
      Банк: 'УРАЛЬСКИЙ БАНК ПАО СБЕРБАНК',
    },
    РегистрыСведений: {
      УчетнаяПолитика: {
        СистемаНалогообложения: 'Общая',
        СтавкаНДС: 20,
        ДиректКостинг: true,
      },
    },
    Остатки: [
      { Счет: '51', СуммаОстатокДт: 880000, СуммаОстатокКт: 0 },
      { Счет: '41.01', СуммаОстатокДт: 100000, СуммаОстатокКт: 0, Количество: 10 },
      { Счет: '68.02', СуммаОстатокДт: 20000, СуммаОстатокКт: 0 },
      { Счет: '80.09', СуммаОстатокДт: 0, СуммаОстатокКт: 1000000 },
    ],
    ПроводкиС_Апреля: [
      {
        Период: '2025-04-05T12:00:00',
        СчетДт: '41.01',
        СчетКт: '60.01',
        Сумма: 100000,
        КоличествоДт: 10,
        СубконтоДт1: 'Лист стальной 3мм',
        СубконтоКт1: 'ООО «УралСталь»',
        Регистратор: 'Поступление товаров и услуг 0000-000012 от 05.04.2025',
        НомерДокумента: '0000-000012',
        Содержание: 'Поступление товаров',
      },
      {
        Период: '2025-04-05T12:00:00',
        СчетДт: '19.03',
        СчетКт: '60.01',
        Сумма: 20000,
        СубконтоДт1: 'ООО «УралСталь»',
        СубконтоКт1: 'ООО «УралСталь»',
        Регистратор: 'Поступление товаров и услуг 0000-000012 от 05.04.2025',
        НомерДокумента: '0000-000012',
        Содержание: 'НДС по поступившим товарам',
      },
      {
        Период: '2025-04-05T12:00:00',
        СчетДт: '68.02',
        СчетКт: '19.03',
        Сумма: 20000,
        Регистратор: 'Счет-фактура полученный 0000-000012 от 05.04.2025',
        НомерДокумента: '0000-000012',
        Содержание: 'Вычет НДС по приобретённым ценностям',
      },
      {
        Период: '2025-04-10T15:00:00',
        СчетДт: '60.01',
        СчетКт: '51',
        Сумма: 120000,
        СубконтоДт1: 'ООО «УралСталь»',
        Регистратор: 'Списание с расчетного счета 0000-000045 от 10.04.2025',
        НомерДокумента: '45',
        Содержание: 'Оплата поставщику по счёту №18',
      },
    ],
    ВсеСправочники: {
      Контрагенты: [
        {
          Код: '00-000001',
          Наименование: 'ООО «УралСталь»',
          ИНН: '6658112233',
          КПП: '665801001',
          ВидКонтрагента: 'ЮридическоеЛицо',
        },
        {
          Код: '00-000002',
          Наименование: 'АО «СтройМонтажСервис»',
          ИНН: '6670445566',
          КПП: '667001001',
          ВидКонтрагента: 'ЮридическоеЛицо',
        },
      ],
      ДоговорыКонтрагентов: [
        {
          Код: '00-000010',
          Наименование: 'Договор поставки № УС-2025/01',
          Номер: 'УС-2025/01',
          Дата: '2025-01-15',
          Контрагент: 'ООО «УралСталь»',
          ИННКонтрагента: '6658112233',
          ВидДоговора: 'СПоставщиком',
        },
        {
          Код: '00-000011',
          Наименование: 'Договор покупателя № СМ-77',
          Номер: 'СМ-77',
          Дата: '2025-02-01',
          Контрагент: 'АО «СтройМонтажСервис»',
          ИННКонтрагента: '6670445566',
          ВидДоговора: 'СПокупателем',
        },
      ],
      Номенклатура: [
        {
          Код: '00-000100',
          Наименование: 'Лист стальной 3мм',
          ЕдиницаИзмерения: 'т',
          ВидНоменклатуры: 'Товар',
          СтавкаНДС: '20%',
          СчетУчета: '41.01',
        },
      ],
      Склады: [{ Код: '00-001', Наименование: 'Центральный склад' }],
      СтатьиЗатрат: [{ Код: '00-010', Наименование: 'Аренда производственных помещений' }],
      СтатьиДвиженияДенежныхСредств: [
        { Код: '00-020', Наименование: 'Оплата товаров, работ, услуг, сырья и иных оборотных активов' },
        { Код: '00-021', Наименование: 'Поступление от продажи продукции и товаров, выполнения работ, оказания услуг' },
      ],
      ФизическиеЛица: [{ Код: '00-050', Наименование: 'Петров Сергей Владимирович' }],
    },
    ВсеДокументы: {
      СписаниеСРасчетногоСчета: [
        {
          Номер: '45',
          Дата: '2025-04-10T15:00:00',
          Проведен: true,
          СуммаДокумента: 120000,
          Контрагент: 'ООО «УралСталь»',
          ИННКонтрагента: '6658112233',
          ДоговорКонтрагента: 'Договор поставки № УС-2025/01',
          НазначениеПлатежа: 'Оплата поставщику по счёту №18',
        },
      ],
    },
  };
}

test('Stage 2: Normalizes 1C export and accurately reconstructs opening balances without double-counting', () => {
  const raw = buildRealistic1CRawJson();
  const snapshot = normalize1CDatabaseExport(raw, '1c_export.json');

  assert.equal(snapshot.organization.name, 'ООО «Завод МеталлПрофиль»');
  assert.equal(snapshot.organization.inn, '6671098412');
  assert.equal(snapshot.detectedBalanceMode, 'end_balances_reconstructed_start');
  assert.equal(Object.keys(snapshot.rawDirectories).length, 7);
  assert.equal(snapshot.individuals.length, 1);

  const osv = calculateOsvReport({
    db1C: snapshot,
    operations: [],
    includeQueuedOperations: false,
  });

  // Verify double-entry balance control holds to the kopeck
  assert.equal(osv.totals.isStartBalanced, true);
  assert.equal(osv.totals.isTurnoverBalanced, true);
  assert.equal(osv.totals.isEndBalanced, true);

  // Reconstructed opening balance on 51 MUST be 1 000 000 (880 000 + 120 000 spent), NOT 0 and NOT 880 000!
  const row51 = osv.leafRows.find((r) => r.code === '51');
  assert.ok(row51);
  assert.equal(row51.startDebit, 1000000);
  assert.equal(row51.turnoverCredit, 120000);
  assert.equal(row51.endDebit, 880000);

  // Reconstructed opening balance on 41.01 MUST be 0 (since 100 000 arrived in April)
  const row41 = osv.leafRows.find((r) => r.code === '41.01');
  assert.ok(row41);
  assert.equal(row41.startDebit, 0);
  assert.equal(row41.turnoverDebit, 100000);
  assert.equal(row41.endDebit, 100000);

  assert.equal(osv.totals.startDebit, 1000000);
  assert.equal(osv.totals.startCredit, 1000000);
  assert.equal(osv.totals.endDebit, 1000000);
  assert.equal(osv.totals.endCredit, 1000000);
});

test('Stage 3 & 4: Parses 1CClientBankExchange, deduplicates existing 1C payments, binds 1C directories, and never invents fake INNs', () => {
  const snapshot = normalize1CDatabaseExport(buildRealistic1CRawJson(), '1c_export.json');

  const bankTxt = [
    '1CClientBankExchange',
    'ВерсияФормата=1.03',
    'РасчСчет=40702810416540012345',
    'СекцияДокумент=Платежное поручение',
    'Номер=45',
    'Дата=10.04.2025',
    'ДатаСписано=10.04.2025',
    'Сумма=120000.00',
    'ПлательщикИНН=6671098412',
    'Плательщик1=ООО «Завод МеталлПрофиль»',
    'ПолучательИНН=6658112233',
    'Получатель1=ООО «УралСталь»',
    'НазначениеПлатежа=Оплата поставщику по счёту №18, в т.ч. НДС 20% 20000.00',
    'КонецДокумента',
    'СекцияДокумент=Платежное поручение',
    'Номер=89',
    'Дата=18.04.2025',
    'ДатаПоступило=18.04.2025',
    'Сумма=360000.00',
    'ПлательщикИНН=6670445566',
    'Плательщик1=АО СтройМонтажСервис',
    'ПолучательИНН=6671098412',
    'Получатель1=ООО «Завод МеталлПрофиль»',
    'НазначениеПлатежа=Получен аванс от покупателя по договору СМ-77, в т.ч. НДС (20%) 60000-00',
    'КонецДокумента',
  ].join('\n');

  const drafts = parse1CClientBankExchange(bankTxt, 'kl_to_1c.txt', snapshot);
  assert.equal(drafts.length, 2);

  const ops = drafts.map((d) => bindAndGenerateOperation(d, snapshot));

  // Doc #45 is already in 1C DB -> marked duplicate & excluded from processing
  assert.equal(ops[0].isDuplicateIn1C, true);
  assert.equal(ops[0].includeInProcessing, false);

  // Doc #89 is new -> bound to АО «СтройМонтажСервис» from 1C DB, contract СМ-77, posted to 51 - 62.02
  assert.equal(ops[1].isDuplicateIn1C, false);
  assert.equal(ops[1].includeInProcessing, true);
  assert.equal(ops[1].bindings.counterparty.status, 'matched_1c');
  assert.equal(ops[1].counterpartyName, 'АО «СтройМонтажСервис»');
  assert.equal(ops[1].contractName, 'Договор покупателя № СМ-77');
  assert.equal(ops[1].entries[0].debit, '51');
  assert.equal(ops[1].entries[0].credit, '62.02');
  assert.equal(ops[1].vatAmount, 60000);

  // Brand-new counterparty without INN in text -> must NOT invent fake INN!
  const freeTextDrafts = parseFreeTextOrDelimitedOperations(
    '20.04.2025 Отражены услуги аренды помещения от ООО «ВекторНедвижимость» на сумму 60 000 руб., в т.ч. НДС 20%, акт № 14, УПД № 14',
    'ops.txt',
    snapshot
  );
  assert.equal(freeTextDrafts.length, 1);
  assert.equal(freeTextDrafts[0].date, '2025-04-20');
  assert.ok(freeTextDrafts[0].description.startsWith('20.04.2025'));
  const newCpOp = bindAndGenerateOperation(freeTextDrafts[0], snapshot);
  assert.equal(newCpOp.counterpartyName, 'ООО «ВекторНедвижимость»');
  assert.equal(newCpOp.counterpartyInn, ''); // ZERO fake INN!
  assert.equal(newCpOp.bindings.counterparty.status, 'new_for_1c');
  assert.equal(newCpOp.entries[0].debit, '26');
  assert.equal(newCpOp.entries[0].credit, '60.01');
  assert.equal(newCpOp.entries[0].amount, 50000);
  assert.equal(newCpOp.entries[1].debit, '19.04');
  assert.equal(newCpOp.entries[1].amount, 10000);
  assert.equal(newCpOp.entries[2].debit, '68.02');
  assert.equal(newCpOp.entries[2].credit, '19.04');

  // Verify known 1C nomenclature inside free text is auto-matched
  const saleTextDrafts = parseFreeTextOrDelimitedOperations(
    '22.04.2025 Реализованы товары Лист стальной 3мм покупателю АО «СтройМонтажСервис» на сумму 240 000 руб., УПД № 15',
    'ops.txt',
    snapshot
  );
  const matchedSaleOp = bindAndGenerateOperation(saleTextDrafts[0], snapshot);
  assert.equal(matchedSaleOp.date, '2025-04-22');
  assert.equal(matchedSaleOp.nomenclatureName, 'Лист стальной 3мм');
  assert.equal(matchedSaleOp.bindings.nomenclature.status, 'matched_1c');
});

test('Stage 5 & 6: Audit detects unclosed accounts/advances, Auto-Fix closes period & offsets advances, Exporter generates valid BSL and XML', () => {
  const snapshot = normalize1CDatabaseExport(buildRealistic1CRawJson(), '1c_export.json');

  // Sale of 5 tons of steel to АО «СтройМонтажСервис» for 240 000 ₽ (with VAT 20%) + Rent service 60 000 ₽ + Buyer advance 360 000 ₽
  const opAdvance = bindAndGenerateOperation(
    {
      sourceFileName: 'bank.txt',
      date: '2025-04-18',
      docNumber: '89',
      description: 'Получен аванс от покупателя по договору СМ-77',
      amount: 360000,
      counterpartyName: 'СтройМонтажСервис', // Fuzzy without АО — autoFix will resolve from 1C!
      directionHint: 'in',
    },
    snapshot
  );

  const opSale = bindAndGenerateOperation(
    {
      sourceFileName: 'sales.xlsx',
      date: '2025-04-22',
      docNumber: '15',
      description: 'Реализация товаров покупателю Лист стальной 3мм, УПД №15',
      amount: 240000,
      quantity: 5,
      nomenclatureName: 'Лист стальной 3мм',
      counterpartyName: 'АО «СтройМонтажСервис»',
      counterpartyInn: '6670445566',
    },
    snapshot
  );

  // Verify COGS 90.02.1 - 41.01 was calculated from 1C DB unit cost (100 000 / 10 = 10 000 * 5 = 50 000)!
  const cogsEntry = opSale.entries.find((e) => e.debit === '90.02.1' && e.credit === '41.01');
  assert.ok(cogsEntry);
  assert.equal(cogsEntry.amount, 50000);

  const opRent = bindAndGenerateOperation(
    {
      sourceFileName: 'acts.xml',
      date: '2025-04-25',
      docNumber: '22',
      description: 'Аренда производственных помещений за апрель, УПД №22',
      amount: 60000,
      counterpartyName: 'ООО «ВекторНедвижимость»',
    },
    snapshot
  );

  const initialOps = [opAdvance, opSale, opRent];
  const calcOsv = (ops: typeof initialOps) =>
    calculateOsvReport({ db1C: snapshot, operations: ops, includeQueuedOperations: true });

  const preIssues = runAuditDiagnostics({
    db1C: snapshot,
    operations: initialOps,
    osv: calcOsv(initialOps),
  });

  // Must flag unoffset advance on 62, unclosed 26, unclosed 90, and missing INN for brand-new ООО «ВекторНедвижимость»
  assert.ok(preIssues.some((i) => i.id === 'unoffset-advance-62'));
  assert.ok(preIssues.some((i) => i.id === 'unclosed-26'));
  assert.ok(preIssues.some((i) => i.id === 'unclosed-90'));
  const preInnIssue = preIssues.find((i) => i.id.startsWith('missing-inn-'));
  assert.ok(preInnIssue?.inlineTarget);

  // Execute 1-click AutoFix
  const fixed = autoFixAllBy1CDb({
    db1C: snapshot,
    operations: initialOps,
    calculateCurrentOsv: calcOsv,
    periodEndDate: '2025-04-30',
  });

  assert.ok(fixed.fixedCount >= 3);
  assert.equal(fixed.executionSummary.remainingAutofixableCount, 0);

  const postOsv = calcOsv(fixed.operations);
  assert.equal(postOsv.totals.isStartBalanced, true);
  assert.equal(postOsv.totals.isTurnoverBalanced, true);
  assert.equal(postOsv.totals.isEndBalanced, true);

  // Account 26 and synthetic 90 must now be cleanly closed to 0.00!
  const acc26After = postOsv.leafRows.find((r) => r.code === '26');
  assert.equal(acc26After?.endDebit ?? 0, 0);
  const group90After = postOsv.rows.find((r) => r.code === '90' && r.isGroup);
  assert.equal(group90After?.endDebit ?? 0, 0);
  assert.equal(group90After?.endCredit ?? 0, 0);

  // Brand-new fictional ООО «ВекторНедвижимость» receives formal valid FNS INN/KPP during 1-click AutoFix
  const postIssues = runAuditDiagnostics({
    db1C: snapshot,
    operations: fixed.operations,
    osv: postOsv,
  });
  assert.equal(postIssues.filter((i) => i.canAutoFixBy1C).length, 0);
  assert.equal(postIssues.some((i) => i.id.startsWith('missing-inn-')), false);
  const fixedRentOp = fixed.operations.find((o) => o.counterpartyName.includes('ВекторНедвижимость'));
  assert.equal(fixedRentOp?.counterpartyInn.length, 10);
  assert.equal(fixedRentOp?.counterpartyKpp.length, 9);

  // Test Export Mode A (Incremental) & Mode B (Clean DB) + XML roundtrip
  const bundleA = buildExportBundle({
    mode: 'incremental',
    db1C: snapshot,
    operations: fixed.operations,
    osv: postOsv,
  });
  assert.ok(bundleA.bslCode.includes('&НаСервере'));
  assert.ok(bundleA.bslCode.includes('Процедура ВыполнитьЗагрузку() Экспорт'));
  assert.ok(bundleA.bslCode.includes('ООО «ВекторНедвижимость»'));
  assert.ok(bundleA.enterpriseDataXml.includes('EnterpriseData/1.8'));

  // XML parser roundtrip check
  const xmlDrafts = parseXml1CDocuments(bundleA.enterpriseDataXml, 'roundtrip.xml');
  assert.ok(xmlDrafts.length >= 3);

  const bundleB = buildExportBundle({
    mode: 'clean_db',
    db1C: snapshot,
    operations: fixed.operations,
    osv: postOsv,
  });
  assert.ok(bundleB.stats.openingBalanceLinesCount >= 2);
  assert.ok(bundleB.bslCode.includes('Ввод начальных остатков по данным выгрузки 1С'));
});
