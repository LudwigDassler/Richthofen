import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  autoFixAllBy1CDb,
  bindAndGenerateOperation,
  calculateOsvReport,
  isInternalWarehouseOrProductionOp,
  runAuditDiagnostics,
} from '../engine';
import { buildExportBundle } from '../export1c';
import { parseFreeTextOrDelimitedOperations, processBatchFiles } from '../import1c';
import { QueuedOperation } from '../../types/accounting';

function makeXlsxBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Журнал');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

test('1. Standalone internal materials write-off («Передан кирпич на объект для производства трубы») has РасходМатериалов, Дт 20.01 Кт 10.08, 0 VAT, no counterparty, calculated_1c status, and 0 missing_amount errors', () => {
  const drafts = parseFreeTextOrDelimitedOperations(
    '05.03.2026\tПередан кирпич на объект для производства трубы',
    'Лабораторная_материалы.xlsx',
    null,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 1);

  const op = bindAndGenerateOperation(drafts[0], null, 'op-brick-standalone', {
    priorOperations: [],
    reportingYear: 2026,
  });

  assert.equal(op.category, 'materials_writeoff');
  assert.equal(op.docType1C, 'РасходМатериалов');
  assert.equal(op.documentSubKind1C, 'Использование материалов');
  assert.equal(isInternalWarehouseOrProductionOp(op), true);

  // Zero external counterparty, zero VAT, zero SF
  assert.equal(op.counterpartyName, '');
  assert.equal(op.vatRate, 0);
  assert.equal(op.vatRule, 'none');
  assert.equal(op.vatAmount, 0);
  assert.equal(op.hasInvoiceSF, false);
  assert.equal(op.bindings.counterparty.status, 'not_required');
  assert.equal(op.bindings.contract.status, 'not_required');

  // Extracted item & production object
  assert.match(op.nomenclatureName, /кирпич/i);
  assert.match(op.nomenclatureGroupName, /труб/i);

  // Student-friendly amount & readiness status (never red "Требуется сумма")
  assert.equal(op.needsAmount, undefined);
  assert.equal(op.amountMode, 'calculated_by_1c');
  assert.equal(op.readinessStatus, 'calculated_1c');

  // Reference posting Дт 20.01 Кт 10.08 generated even with 0 explicit Excel sum
  assert.equal(op.entries.length, 1);
  assert.equal(op.entries[0].debit, '20.01');
  assert.equal(op.entries[0].credit, '10.08');

  // Mentor guide populated with exact 1C:BP 3.0 path
  assert.ok(op.mentorGuide1C);
  assert.match(op.mentorGuide1C.navigationPath1C, /Расход материалов/i);
  assert.ok(op.mentorGuide1C.headerFieldsSteps.length >= 3);
  assert.ok(op.mentorGuide1C.tabularAndTabsSteps.length >= 2);

  // Audit diagnostics must NOT flag missing_amount or missing counterparty
  const osv = calculateOsvReport({
    db1C: null,
    operations: [op],
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: [op], osv });
  const missingAmtIssue = issues.find((i) => i.category === 'missing_amount');
  const missingCpIssue = issues.find((i) => i.id.startsWith('missing-cp-'));
  assert.equal(missingAmtIssue, undefined);
  assert.equal(missingCpIssue, undefined);
});

test('2. Chronological stock batch propagation: brick purchase (120 000 ₽ incl. 20% VAT -> 100 000 ₽ net on 10.08) automatically feeds write-off cost without VAT', () => {
  const buf = makeXlsxBuffer([
    ['Дата', 'Содержание хозяйственной операции', 'Сумма с НДС, руб'],
    [
      '02.03.2026',
      'Поступил кирпич строительный 1000 шт от ООО "СтройСнаб" (ИНН 7810123456, КПП 781001001) с НДС 20%, получен УПД',
      120000,
    ],
    ['05.03.2026', 'Передан кирпич на объект для производства трубы', ''],
  ]);

  const res = processBatchFiles(
    [{ name: 'Журнал_март.xlsx', buffer: buf }],
    null,
    { reportingYear: 2026 }
  );

  assert.equal(res.operations.length, 2);
  const [purchaseOp, writeoffOp] = res.operations;

  // Purchase: Дт 10.08 = 100 000, Дт 19.03 = 20 000, Дт 68.02 Кт 19.03 = 20 000
  assert.equal(purchaseOp.category, 'purchase_materials');
  assert.equal(purchaseOp.docType1C, 'ПоступлениеТоваровУслуг');
  assert.equal(purchaseOp.entries[0].debit, '10.08');
  assert.equal(purchaseOp.entries[0].amount, 100000);

  // Write-off: automatically pulls net cost 100 000 ₽ (excluding VAT!) from account 10.08
  assert.equal(writeoffOp.category, 'materials_writeoff');
  assert.equal(writeoffOp.docType1C, 'РасходМатериалов');
  assert.equal(writeoffOp.amount, 100000);
  assert.equal(writeoffOp.amountMode, 'from_stock_balance');
  assert.equal(writeoffOp.readinessStatus, 'ready');
  assert.equal(writeoffOp.vatAmount, 0);
  assert.equal(writeoffOp.entries.length, 1);
  assert.equal(writeoffOp.entries[0].debit, '20.01');
  assert.equal(writeoffOp.entries[0].credit, '10.08');
  assert.equal(writeoffOp.entries[0].amount, 100000);
});

test('3. Workwear issue («Выдали спецодежду каменщику») creates ПередачаМатериаловВЭксплуатацию, Дт 20.01 Кт 10.10 + unilateral off-balance Дт МЦ.02, and keeps OSV double-entry balanced', () => {
  const buf = makeXlsxBuffer([
    ['Дата', 'Содержание операции', 'Сумма, руб'],
    [
      '03.03.2026',
      'Приобретена спецодежда (костюм рабочий) 2 шт у ООО "СпецЗащита" (ИНН 7805112233, КПП 780501001) с НДС 20%',
      18000,
    ],
    ['06.03.2026', 'Выдали спецодежду каменщику 1 шт', ''],
  ]);

  const res = processBatchFiles(
    [{ name: 'Спецодежда.xlsx', buffer: buf }],
    null,
    { reportingYear: 2026 }
  );

  assert.equal(res.operations.length, 2);
  const [buyWorkwear, issueWorkwear] = res.operations;

  // Purchase lands on 10.10 net of VAT: 18 000 / 1.2 = 15 000 (unit cost = 7 500 ₽)
  assert.equal(buyWorkwear.entries[0].debit, '10.10');
  assert.equal(buyWorkwear.entries[0].amount, 15000);

  // Issue of 1 unit = 7 500 ₽
  assert.equal(issueWorkwear.category, 'workwear_issue');
  assert.equal(issueWorkwear.docType1C, 'ПередачаМатериаловВЭксплуатацию');
  assert.equal(issueWorkwear.employeeName, 'Каменщик');
  assert.equal(issueWorkwear.nomenclatureName, 'Спецодежда');
  assert.equal(issueWorkwear.amount, 7500);
  assert.equal(issueWorkwear.vatRate, 0);
  assert.equal(issueWorkwear.counterpartyName, '');

  // Postings: 1) Дт 20.01 Кт 10.10 = 7500, 2) unilateral off-balance Дт МЦ.02 = 7500
  assert.equal(issueWorkwear.entries.length, 2);
  assert.equal(issueWorkwear.entries[0].debit, '20.01');
  assert.equal(issueWorkwear.entries[0].credit, '10.10');
  assert.equal(issueWorkwear.entries[0].amount, 7500);

  assert.equal(issueWorkwear.entries[1].debit, 'МЦ.02');
  assert.equal(issueWorkwear.entries[1].credit, '');
  assert.equal(issueWorkwear.entries[1].isOffBalance, true);
  assert.equal(issueWorkwear.entries[1].amount, 7500);
  assert.match(issueWorkwear.entries[1].debitSubconto, /Каменщик/);

  // OSV check: balance-sheet double entry strictly holds (Дт === Кт) AND МЦ.02 is visible!
  const osv = calculateOsvReport({
    db1C: null,
    operations: res.operations,
    reportingYear: 2026,
    includeQueuedOperations: true,
  });
  assert.equal(osv.totals.isStartBalanced, true);
  assert.equal(osv.totals.isTurnoverBalanced, true);
  assert.equal(osv.totals.isEndBalanced, true);

  const mcRow = osv.leafRows.find((r) => r.code === 'МЦ.02');
  assert.ok(mcRow);
  assert.equal(mcRow.endDebit, 7500);

  // Audit diagnostics must NOT complain about empty credit account on МЦ.02
  const issues = runAuditDiagnostics({ db1C: null, operations: res.operations, osv });
  const brokenAccIssue = issues.find((i) => i.id.startsWith('missing-acc-'));
  assert.equal(brokenAccIssue, undefined);

  // BSL export generates native ПередачаМатериаловВЭксплуатацию
  const exported = buildExportBundle({
    mode: 'incremental',
    db1C: null,
    operations: res.operations,
    osv,
    reportingYear: 2026,
  });
  assert.match(exported.bslCode, /Документы\.ПередачаМатериаловВЭксплуатацию\.СоздатьДокумент/);
});

test('4. Equipment purchase (08.04.1 + 19.01) followed by Fixed Asset commissioning («Введен в эксплуатацию станок токарный») -> ПринятиеКУчетуОС (Дт 01.01 Кт 08.04.1)', () => {
  const buf = makeXlsxBuffer([
    ['Дата', 'Операция', 'Сумма'],
    [
      '10.03.2026',
      'Приобретен станок токарный (оборудование к установке) от ООО "ТехМаш" (ИНН 7701234567, КПП 770101001) с НДС 20%',
      600000,
    ],
    ['12.03.2026', 'Введен в эксплуатацию станок токарный и принят к учету в состав ОС', ''],
  ]);

  const res = processBatchFiles(
    [{ name: 'ОС_оборудование.xlsx', buffer: buf }],
    null,
    { reportingYear: 2026 }
  );

  assert.equal(res.operations.length, 2);
  const [buyEq, commOs] = res.operations;

  assert.equal(buyEq.category, 'purchase_equipment');
  assert.equal(buyEq.docType1C, 'ПоступлениеТоваровУслуг');
  assert.equal(buyEq.entries[0].debit, '08.04.1');
  assert.equal(buyEq.entries[0].credit, '60.01');
  assert.equal(buyEq.entries[0].amount, 500000);
  assert.equal(buyEq.entries[1].debit, '19.01');
  assert.equal(buyEq.entries[1].amount, 100000);

  assert.equal(commOs.category, 'os_commissioning');
  assert.equal(commOs.docType1C, 'ПринятиеКУчетуОС');
  assert.equal(commOs.amount, 500000);
  assert.equal(commOs.amountMode, 'from_stock_balance');
  assert.equal(commOs.vatRate, 0);
  assert.equal(commOs.entries.length, 1);
  assert.equal(commOs.entries[0].debit, '01.01');
  assert.equal(commOs.entries[0].credit, '08.04.1');
  assert.equal(commOs.entries[0].amount, 500000);
});

test('5. autoFixAllBy1CDb reclassifies corrupted legacy ПоступлениеТоваровУслуг internal operations into РасходМатериалов / ПередачаМатериаловВЭксплуатацию and logs doc_reclassification', () => {
  // Simulate a corrupted legacy operation that was saved as ПоступлениеТоваровУслуг with 20% VAT, needsAmount: true, and 0 entries
  const corruptedBrickOp: QueuedOperation = {
    id: 'legacy-corrupted-brick',
    createdAt: '2026-03-05T10:00:00.000Z',
    sourceFileName: 'Лабораторная.xlsx',
    date: '2026-03-05',
    docNumber: '',
    description: 'Передан кирпич на объект для производства трубы',
    category: 'purchase_goods',
    docType1C: 'ПоступлениеТоваровУслуг',
    amount: 0,
    needsAmount: true,
    amountMode: 'required_missing',
    readinessStatus: 'critical_error',
    vatRate: 20,
    vatRule: 'included',
    vatAmount: 0,
    hasInvoiceSF: true,
    counterpartyName: '',
    counterpartyInn: '',
    counterpartyKpp: '',
    counterpartyKind: 'ЮридическоеЛицо',
    contractName: '',
    contractNumber: '',
    contractDate: '',
    nomenclatureName: 'Кирпич',
    warehouseName: 'Основной склад',
    expenseItemName: '',
    cashFlowItemName: '',
    employeeName: '',
    nomenclatureGroupName: '',
    isDuplicateIn1C: false,
    includeInProcessing: true,
    bindings: {
      counterparty: { status: 'missing', note: 'Не указан контрагент' },
      contract: { status: 'missing', note: 'Не указан договор' },
      nomenclature: { status: 'new_for_1c' },
      warehouse: { status: 'new_for_1c' },
      expenseItem: { status: 'not_required' },
      cashFlowItem: { status: 'not_required' },
    },
    entries: [],
  };

  const fixResult = autoFixAllBy1CDb({
    db1C: null,
    operations: [corruptedBrickOp],
    calculateCurrentOsv: (ops) =>
      calculateOsvReport({
        db1C: null,
        operations: ops,
        reportingYear: 2026,
        includeQueuedOperations: true,
      }),
    periodEndDate: '2026-03-31',
    reportingYear: 2026,
  });

  assert.ok(fixResult.fixedCount >= 1);
  const fixedOp = fixResult.operations.find((o) => o.id === 'legacy-corrupted-brick')!;
  assert.equal(fixedOp.docType1C, 'РасходМатериалов');
  assert.equal(fixedOp.category, 'materials_writeoff');
  assert.equal(fixedOp.vatRate, 0);
  assert.equal(fixedOp.hasInvoiceSF, false);
  assert.equal(fixedOp.needsAmount, undefined);
  assert.equal(fixedOp.amountMode, 'calculated_by_1c');
  assert.equal(fixedOp.readinessStatus, 'calculated_1c');
  assert.equal(fixedOp.entries.length, 1);
  assert.equal(fixedOp.entries[0].debit, '20.01');
  assert.equal(fixedOp.entries[0].credit, '10.08');

  const reclassRecord = fixResult.structuredChanges.find(
    (c) => c.category === 'doc_reclassification'
  );
  assert.ok(reclassRecord);
  assert.match(reclassRecord.whatBecame, /РасходМатериалов/);
});
