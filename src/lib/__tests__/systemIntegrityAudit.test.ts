import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHART_OF_ACCOUNTS,
  GROUP_TO_DEFAULT_SUBACCOUNT_1C,
  getAccountInfo,
  normalizeAccountToLeaf1C,
} from '../../data/chartOfAccounts';
import {
  generateEducationalInnKpp,
  KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES,
  validateRussianInnChecksum,
} from '../egrul/egrulLookup';
import {
  ALL_DOC_TYPES_1C,
  autoFixAllBy1CDb,
  autoFixAuditIssue,
  bindAndGenerateOperation,
  buildOperationMentorGuide1C,
  calculateOsvReport,
  DOC_TYPE_LABELS_1C,
  DOC_TYPE_TO_DEFAULT_CATEGORY_1C,
  DOCUMENT_SPECS,
  extractCounterpartyFromText1C,
  extractExplicitCorrespondencesFromText1C,
  extractPersonFioFromText1C,
  getDocumentSpecByCategory,
  getDocumentSpecForOperation,
  inflectRussianSurnameToNominative,
  normalizeLegalEntityName1C,
  normalizeRussianFioToNominative1C,
  recalculateOperationsChronologically,
  runAuditDiagnostics,
  sanitizeGeneratedText1C,
} from '../engine';
import { buildExportBundle } from '../export1c';
import { processBatchFiles } from '../import1c/batchFileParser';
import { normalize1CDatabaseExport } from '../import1c/json1CSyncNormalizer';
import { DocType1CBP30, OperationCategory, QueuedOperation } from '../../types/accounting';

const AUDIT_DB_1C = normalize1CDatabaseExport(
  {
    version: '8.3.25',
    configuration: 'Бухгалтерия предприятия, редакция 3.0',
    organization: {
      name: 'ООО «ПромСтройАудит»',
      inn: '7701234569',
      kpp: '770101001',
      taxSystem: 'ОСНО',
      vatRate: 20,
      bik: '044525225',
      bankName: 'ПАО СБЕРБАНК',
      bankAccount: '40702810438000012345',
    },
    directories: {
      counterparties: [
        {
          code1C: 'К-001',
          name: 'ООО «БазаСнаб»',
          inn: '7707083893',
          kpp: '773601001',
          kind: 'ЮридическоеЛицо',
        },
      ],
      contracts: [
        {
          code1C: 'Д-001',
          name: 'Договор поставки № 1',
          number: '1',
          date: '2025-01-10',
          counterpartyName: 'ООО «БазаСнаб»',
          counterpartyInn: '7707083893',
          contractKind: 'СПоставщиком',
        },
      ],
      warehouses: [{ code1C: 'СК-1', name: 'Основной склад', warehouseType: 'Оптовый' }],
      expenseItems: [
        { code1C: 'СЗ-1', name: 'Аренда помещений' },
        { code1C: 'СЗ-2', name: 'Оплата труда' },
        { code1C: 'СЗ-3', name: 'Амортизация' },
        { code1C: 'СЗ-4', name: 'Материальные расходы' },
        { code1C: 'СЗ-5', name: 'Прочие расходы' },
      ],
      cashFlowItems: [
        { code1C: 'ДДС-1', name: 'Оплата товаров, работ, услуг, сырья и иных оборотных активов' },
        { code1C: 'ДДС-2', name: 'Поступление от продажи продукции и товаров, выполнения работ, оказания услуг' },
      ],
      nomenclatureGroups: [{ code1C: 'НГ-1', name: 'Основная номенклатурная группа' }],
      nomenclature: [],
      individuals: [],
    },
    balances: [
      { account: '51', startDebit: 2_500_000, startCredit: 0 },
      { account: '80.09', startDebit: 0, startCredit: 1_000_000 },
      { account: '84.01', startDebit: 0, startCredit: 1_500_000 },
    ],
    postings: [],
  },
  'audit_db_1c.json'
);

test('1. DOCUMENT_SPECS registry completeness & 100% menuPath parity across Mentor Guide and Audit Diagnostics', () => {
  const allCategories = Object.keys(DOCUMENT_SPECS) as OperationCategory[];
  assert.ok(allCategories.length >= 44, `Expected >= 44 categories, got ${allCategories.length}`);

  for (const cat of allCategories) {
    const spec = getDocumentSpecByCategory(cat);
    assert.equal(spec.category, cat);
    assert.ok(spec.menuPath1C.length >= 5, `Empty menuPath1C for ${cat}`);
    assert.ok(ALL_DOC_TYPES_1C.includes(spec.docType), `Unknown docType for ${cat}`);

    const sampleOp = bindAndGenerateOperation(
      {
        sourceFileName: 'spec_test.xlsx',
        date: '2025-04-15',
        docNumber: '1',
        description: `Тестовая операция категории ${cat}`,
        amount: spec.allowsZeroPostings ? 0 : 12000,
        categoryHint: cat,
        docTypeHint: spec.docType,
      },
      AUDIT_DB_1C
    );

    const mentor = buildOperationMentorGuide1C(sampleOp, AUDIT_DB_1C);
    assert.equal(
      mentor.navigationPath1C,
      getDocumentSpecForOperation(sampleOp).menuPath1C,
      `Mentor navigationPath1C mismatch for category ${cat}`
    );

    const osv = calculateOsvReport({
      db1C: AUDIT_DB_1C,
      operations: [sampleOp],
      dateFrom: '2025-04-01',
      dateTo: '2025-04-30',
      balanceAnchorOverride: 'treat_raw_as_start',
    });
    const issues = runAuditDiagnostics({
      db1C: AUDIT_DB_1C,
      operations: [sampleOp],
      osv,
    });
    for (const iss of issues) {
      if (iss.operationId === sampleOp.id && iss.guide1C && !iss.id.startsWith('misclassified-doc-')) {
        assert.equal(
          iss.guide1C.menuPath,
          getDocumentSpecForOperation(sampleOp).menuPath1C,
          `Audit issue ${iss.id} menuPath mismatch for category ${cat}`
        );
      }
    }
  }

  for (const dt of ALL_DOC_TYPES_1C) {
    assert.ok(DOC_TYPE_LABELS_1C[dt]?.length > 3, `Missing label for ${dt}`);
    const mappedCat = DOC_TYPE_TO_DEFAULT_CATEGORY_1C[dt];
    assert.ok(Boolean(DOCUMENT_SPECS[mappedCat]), `Unmapped default category for ${dt}`);
  }

  // Verify every group account maps to a non-group leaf subaccount in 1C:BP 3.0 Chart of Accounts
  for (const [grp, leaf] of Object.entries(GROUP_TO_DEFAULT_SUBACCOUNT_1C)) {
    const leafInfo = getAccountInfo(leaf);
    assert.equal(leafInfo.isGroup, false, `Default subaccount ${leaf} for group ${grp} must be leaf`);
    assert.equal(normalizeAccountToLeaf1C(grp).startsWith(grp), true);
  }
  assert.ok(CHART_OF_ACCOUNTS.length >= 100);
});

test('2. Entity extraction & inflection normalization across all Russian grammatical cases and OPF quotes (Zero Fabrication)', () => {
  // Surname + initials across cases
  assert.equal(normalizeRussianFioToNominative1C('Иванова И.И.', { obliqueContext: true }), 'Иванов И.И.');
  assert.equal(normalizeRussianFioToNominative1C('Петрову П.П.'), 'Петров П.П.');
  assert.equal(normalizeRussianFioToNominative1C('Сидоровым С.С.'), 'Сидоров С.С.');
  assert.equal(normalizeRussianFioToNominative1C('Соколовой А.В.'), 'Соколова А.В.');
  assert.equal(normalizeRussianFioToNominative1C('Ковалевскому Д.А.'), 'Ковалевский Д.А.');
  assert.equal(inflectRussianSurnameToNominative('Морозовым', 'M'), 'Мороз'.length < 0 ? '' : 'Морозов');

  // Full 3-part FIO in genitive / dative / instrumental
  assert.equal(
    normalizeRussianFioToNominative1C('Смирнова Алексея Сергеевича'),
    'Смирнов Алексей Сергеевич'
  );
  assert.equal(
    normalizeRussianFioToNominative1C('Кузнецову Дмитрию Павловичу'),
    'Кузнецов Дмитрий Павлович'
  );
  assert.equal(
    normalizeRussianFioToNominative1C('Орловой Елены Викторовны'),
    'Орлова Елена Викторовна'
  );

  // Legal entity canonicalization across quote styles & OPF forms
  const n1 = normalizeLegalEntityName1C('Общество с ограниченной ответственностью "ТехноСтрой"');
  const n2 = normalizeLegalEntityName1C('ооо «ТехноСтрой»');
  const n3 = normalizeLegalEntityName1C("ООО 'ТехноСтрой'");
  assert.equal(n1, 'ООО «ТехноСтрой»');
  assert.equal(n2, 'ООО «ТехноСтрой»');
  assert.equal(n3, 'ООО «ТехноСтрой»');

  const extractedCp = extractCounterpartyFromText1C(
    'Оплачен счет поставщика Общества с ограниченной ответственностью "Вектор-Плюс" за материалы'
  );
  assert.equal(extractedCp, 'ООО «Вектор-Плюс»');

  const extractedPerson = extractPersonFioFromText1C(
    'Выдано из кассы под отчет Федорову Игорю Николаевичу на командировочные расходы'
  );
  assert.equal(extractedPerson, 'Федоров Игорь Николаевич');

  // Explicit correspondence extraction (single, composite, and off-balance)
  const corrComposite = extractExplicitCorrespondencesFromText1C(
    'Отражена ручная корректировка: Дт 94 Кт 10.01 — 5 000 руб.; Дт 73.02 Кт 94 — 5 000 руб.'
  );
  assert.equal(corrComposite.length, 2);
  assert.equal(corrComposite[0].debit, '94');
  assert.equal(corrComposite[0].credit, '10.01');
  assert.equal(corrComposite[0].amount, 5000);
  assert.equal(corrComposite[1].debit, '73.02');
  assert.equal(corrComposite[1].credit, '94');

  const corrOffBal = extractExplicitCorrespondencesFromText1C(
    'Принято арендованное оборудование на забалансовый учет Дт 001 на сумму 450 000 руб.'
  );
  assert.equal(corrOffBal.length, 1);
  assert.equal(corrOffBal[0].isOffBalance, true);
  assert.equal(corrOffBal[0].debit, '001');
});

test('3. Bidirectional Multi-Pass Closed-World Resolver resolves forward contracts, forward invoices, and forward payments', async () => {
  // Scenario A: Rent service act appears BEFORE the contract terms row in the task table,
  // and supplier payment without amount appears BEFORE the supplier invoice row!
  const tsvText = [
    'Дата\tСодержание хозяйственной операции\tСумма',
    '10.04.2025\tОтражены услуги аренды офиса от ООО «АрендаСити» за апрель\t',
    '12.04.2025\tЗаключен договор аренды офиса с ООО «АрендаСити», ежемесячная арендная плата 90 000 руб. (в т.ч. НДС 20%)\t',
    '15.04.2025\tПеречислена с расчетного счета предоплата ООО «СтальПрофиль» по счету за металлопрокат\t',
    '18.04.2025\tПоступил металлопрокат от ООО «СтальПрофиль» по счету-фактуре № 45\t180 000',
    '20.04.2025\tРеализована готовая продукция покупателю (накладная № 12)\t240 000',
    '25.04.2025\tПоступила на расчетный счет оплата от покупателя АО «ГорСтройИнвест» за отгруженную продукцию\t240 000',
  ].join('\n');

  const rawBytes = new TextEncoder().encode(tsvText);
  const fileBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
  const imported = await processBatchFiles(
    [{ name: 'forward_links.tsv', buffer: fileBuffer }],
    AUDIT_DB_1C,
    { reportingYear: 2025 }
  );
  assert.equal(imported.operations.length, 6);

  const rentAct = imported.operations[0];
  assert.equal(rentAct.category, 'purchase_services');
  assert.equal(rentAct.amount, 90_000, 'Rent act must resolve 90,000 ₽ from forward contract row');
  assert.ok(rentAct.entries.length >= 2);

  const prepayOp = imported.operations[2];
  assert.equal(prepayOp.category, 'bank_out');
  assert.equal(
    prepayOp.amount,
    180_000,
    'Prepayment without amount must resolve 180,000 ₽ from forward receipt of ООО «СтальПрофиль»'
  );

  const saleOp = imported.operations[4];
  assert.equal(saleOp.category, 'sale_goods');
  assert.equal(
    saleOp.counterpartyName,
    'АО «ГорСтройИнвест»',
    'Sale without buyer name must resolve АО «ГорСтройИнвест» from forward exact-amount payment'
  );
});

test('4. Universal RSBU coverage: charter capital, dividends, NMA lifecycle, inventory 94, acquiring 57.03, 55, 73, 97, 63, off-balance 001', () => {
  const opsRaw = [
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-01-10',
        description: 'Сформирован уставный капитал организации учредителем Орловым П.С.',
        amount: 500_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-02-01',
        description: 'Приобретено исключительное право на программу ЭВМ у ООО «СофтЛаб» (УПД, в т.ч. НДС 20%)',
        amount: 120_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-02-05',
        description: 'Принят к учету нематериальный актив программа ЭВМ со СПИ 20 мес.',
        amount: 0,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-02-28',
        description: 'Начислена амортизация нематериального актива за февраль',
        amount: 0,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-03-05',
        description: 'Выявлена при инвентаризации недостача материалов и отнесена на виновное лицо Сидорова А.А.',
        amount: 8_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-03-10',
        description: 'Зачислена на расчетный счет выручка по эквайрингу 100 000 руб., удержана комиссия банка 2 000 руб.',
        amount: 100_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-03-12',
        description: 'Начислены дивиденды учредителю Орлову П.С. за счет нераспределенной прибыли',
        amount: 200_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-03-15',
        description: 'Создан резерв по сомнительным долгам по покупателю ООО «БетаТорг»',
        amount: 35_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'rsbu.xlsx',
        date: '2025-03-20',
        description: 'Принято на забалансовый счет арендованное основное средство складской ангар',
        amount: 1_200_000,
      },
      AUDIT_DB_1C
    ),
  ];

  const synced = recalculateOperationsChronologically(opsRaw, AUDIT_DB_1C, { reportingYear: 2025 });

  // Charter capital: 75.01 - 80.09
  assert.equal(synced[0].category, 'charter_capital');
  assert.equal(synced[0].entries[0].debit, '75.01');
  assert.equal(synced[0].entries[0].credit, '80.09');

  // NMA acquisition (100,000 net on 08.05 + 20,000 VAT) -> commissioning (04.01 - 08.05 = 100,000) -> amortization (100,000 / 20 = 5,000 on Кт 05)
  assert.equal(synced[1].category, 'intangible_acquisition');
  assert.equal(synced[1].entries[0].debit, '08.05');
  assert.equal(synced[1].entries[0].amount, 100_000);

  assert.equal(synced[2].category, 'intangible_commissioning');
  assert.equal(synced[2].amount, 100_000);
  assert.equal(synced[2].entries[0].debit, '04.01');
  assert.equal(synced[2].entries[0].credit, '08.05');

  assert.equal(synced[3].category, 'intangible_amortization');
  assert.equal(synced[3].amount, 5_000);
  assert.equal(synced[3].entries[0].credit, '05');

  // Composite shortage: 94 - 10.01 AND 73.02 - 94
  assert.equal(synced[4].category, 'inventory_result');
  assert.equal(synced[4].entries.length, 2);
  assert.equal(synced[4].entries[0].debit, '94');
  assert.equal(synced[4].entries[1].debit, '73.02');
  assert.equal(synced[4].entries[1].credit, '94');

  // Acquiring bank settlement: 51 - 57.03 (98,000) + 91.02 - 57.03 (2,000)
  assert.equal(synced[5].category, 'acquiring_receipt');
  assert.equal(synced[5].entries.length, 2);
  assert.equal(synced[5].entries[0].debit, '51');
  assert.equal(synced[5].entries[0].credit, '57.03');
  assert.equal(synced[5].entries[0].amount, 98_000);
  assert.equal(synced[5].entries[1].debit, '91.02');
  assert.equal(synced[5].entries[1].amount, 2_000);

  // Dividends accrual: 84.01 - 75.02 (200,000) + 75.02 - 68.01 (26,000 НДФЛ 13%)
  assert.equal(synced[6].category, 'dividends_accrual');
  assert.equal(synced[6].entries[0].debit, '84.01');
  assert.equal(synced[6].entries[0].credit, '75.02');
  assert.equal(synced[6].entries[1].debit, '75.02');
  assert.equal(synced[6].entries[1].credit, '68.01');
  assert.equal(synced[6].entries[1].amount, 26_000);

  // Reserve 63: 91.02 - 63
  assert.equal(synced[7].category, 'reserve_doubtful_63');
  assert.equal(synced[7].entries[0].debit, '91.02');
  assert.equal(synced[7].entries[0].credit, '63');

  // Unilateral off-balance 001: does NOT break OSV balance!
  assert.equal(synced[8].category, 'off_balance_op');
  assert.equal(synced[8].entries[0].isOffBalance, true);
  assert.equal(synced[8].entries[0].debit, '001');
  assert.equal(synced[8].entries[0].credit, '');

  const osv = calculateOsvReport({
    db1C: AUDIT_DB_1C,
    operations: synced,
    dateFrom: '2025-01-01',
    dateTo: '2025-03-31',
    balanceAnchorOverride: 'treat_raw_as_start',
  });
  assert.equal(osv.totals.isStartBalanced, true);
  assert.equal(osv.totals.isTurnoverBalanced, true);
  assert.equal(osv.totals.isEndBalanced, true);
});

test('5. Provable Autofix Contract (remainingAutofixableCount === 0, zero hollow fixes) & Year-End December Balance Reformation (90, 91, 99 -> 84)', () => {
  const rawOps: QueuedOperation[] = [
    bindAndGenerateOperation(
      {
        sourceFileName: 'year.xlsx',
        date: '2025-12-05',
        description: 'Поступили материалы от ООО «НовыйПоставщик» (УПД)',
        amount: 120_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'year.xlsx',
        date: '2025-12-10',
        description: 'Оказаны консультационные услуги покупателю ООО «АльфаКлиент» (УПД)',
        amount: 360_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'year.xlsx',
        date: '2025-12-15',
        description: 'Отражены услуги аренды офиса от ООО «АрендаПлюс» (акт)',
        amount: 60_000,
      },
      AUDIT_DB_1C
    ),
    // Ambiguous missing counterparty when TWO distinct buyers exist: must NOT claim canAutoFixBy1C === true!
    bindAndGenerateOperation(
      {
        sourceFileName: 'year.xlsx',
        date: '2025-12-18',
        description: 'Поступила оплата от покупателя ООО «ВторойКлиент» на расчетный счет',
        amount: 50_000,
      },
      AUDIT_DB_1C
    ),
    bindAndGenerateOperation(
      {
        sourceFileName: 'year.xlsx',
        date: '2025-12-20',
        description: 'Оказаны прочие услуги заказчику',
        amount: 18_000,
        counterpartyName: '',
      },
      AUDIT_DB_1C
    ),
  ];

  const calcYearOsv = (ops: QueuedOperation[]) =>
    calculateOsvReport({
      db1C: AUDIT_DB_1C,
      operations: ops,
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      balanceAnchorOverride: 'treat_raw_as_start',
    });

  const osvBefore = calcYearOsv(rawOps);
  const issuesBefore = runAuditDiagnostics({
    db1C: AUDIT_DB_1C,
    operations: rawOps,
    osv: osvBefore,
  });

  // Verify ambiguous missing-cp-name is honestly marked canAutoFixBy1C === false
  const ambiguousCpIssue = issuesBefore.find((i) => i.id === `missing-cp-name-${rawOps[4].id}`);
  assert.ok(ambiguousCpIssue, 'Expected missing-cp-name issue on ambiguous sale');
  assert.equal(
    ambiguousCpIssue.canAutoFixBy1C,
    false,
    'Ambiguous counterparty with 2 buyers must NOT promise automatic fix'
  );

  // Test individual 1-click issue fix never produces 0 changes
  const firstFixable = issuesBefore.find((i) => i.canAutoFixBy1C);
  assert.ok(firstFixable, 'Expected at least one autofixable issue');
  const singleRes = autoFixAuditIssue({
    issue: firstFixable,
    db1C: AUDIT_DB_1C,
    operations: rawOps,
    calculateCurrentOsv: calcYearOsv,
    periodEndDate: '2025-12-31',
    reportingYear: 2025,
  });
  assert.ok(singleRes.fixedCount >= 1);

  // Now run full autoFixAllBy1CDb on December 31
  const fixedAll = autoFixAllBy1CDb({
    db1C: AUDIT_DB_1C,
    operations: rawOps,
    calculateCurrentOsv: calcYearOsv,
    periodEndDate: '2025-12-31',
    reportingYear: 2025,
  });

  assert.equal(
    fixedAll.executionSummary.remainingAutofixableCount,
    0,
    'All autofixable issues must converge to 0'
  );
  assert.equal(fixedAll.executionSummary.isOsvBalanced, true);

  const osvAfter = calcYearOsv(fixedAll.operations);
  assert.equal(osvAfter.totals.startDiff, 0);
  assert.equal(osvAfter.totals.turnoverDiff, 0);
  assert.equal(osvAfter.totals.endDiff, 0);

  // Verify December 31 Реформация баланса closed 26, 90.*, 91.*, and 99.01.1 to 0.00!
  for (const closedCode of ['26', '90.01.1', '90.03', '90.08.1', '90.09', '99.01.1']) {
    const r = osvAfter.leafRows.find((x) => x.code === closedCode);
    if (r) {
      assert.ok(
        r.endDebit < 0.01 && r.endCredit < 0.01,
        `Account ${closedCode} must have 0 ending balance after Dec 31 reformation, got Dt=${r.endDebit} Kt=${r.endCredit}`
      );
    }
  }
  const row8401 = osvAfter.leafRows.find((x) => x.code === '84.01');
  assert.ok(
    (row8401?.endCredit ?? 0) > 1_500_000,
    'Net profit after 20% corporate tax must be transferred to Кт 84.01'
  );
});

test('6. 100% FNS INN Checksum Validity across KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES and Educational Generator', () => {
  assert.ok(KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES.length >= 9);
  for (const item of KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES) {
    const check = validateRussianInnChecksum(item.inn);
    assert.equal(
      check.valid,
      true,
      `Static directory INN ${item.inn} for ${item.name} failed FNS checksum: ${check.reason}`
    );
  }

  const sampleNames = [
    'ООО «ТехноПромСнаб»',
    'АО «СеверСтройИнжиниринг»',
    'ПАО «ВостокЭнергоСеть»',
    'ИП Смирнов Алексей Викторович',
    'ИП Ковалева Мария Сергеевна',
  ];
  for (const name of sampleNames) {
    const isIp = name.startsWith('ИП ');
    const gen = generateEducationalInnKpp(name, isIp ? 'ИндивидуальныйПредприниматель' : 'ЮридическоеЛицо', '78');
    const check = validateRussianInnChecksum(gen.inn);
    assert.equal(check.valid, true, `Generated INN ${gen.inn} for ${name} failed checksum`);
    if (isIp) {
      assert.equal(gen.inn.length, 12);
      assert.equal(gen.kpp, '');
    } else {
      assert.equal(gen.inn.length, 10);
      assert.equal(gen.kpp.length, 9);
    }
  }
});

test('7. Export validity (.bsl and EnterpriseData .xml) across all 29 DocType1CBP30 & off-balance credit/debit + Copy Hygiene', () => {
  const exportOps: QueuedOperation[] = ALL_DOC_TYPES_1C.map((dt: DocType1CBP30, idx: number) => {
    const cat = DOC_TYPE_TO_DEFAULT_CATEGORY_1C[dt];
    return bindAndGenerateOperation(
      {
        sourceFileName: 'export_all.xlsx',
        date: `2025-04-${String((idx % 28) + 1).padStart(2, '0')}`,
        docNumber: String(idx + 1),
        description: `Тест выгрузки документа ${dt}`,
        amount: 24_000,
        counterpartyName: 'ООО «БазаСнаб»',
        counterpartyInn: '7707083893',
        counterpartyKpp: '773601001',
        nomenclatureName: 'Тестовая позиция',
        employeeName: 'Иванов Иван Иванович',
        categoryHint: cat,
        docTypeHint: dt,
      },
      AUDIT_DB_1C
    );
  });

  // Also include unilateral off-balance Дт 001 and Кт 001 operations
  const offDebitOp = bindAndGenerateOperation(
    {
      sourceFileName: 'export_all.xlsx',
      date: '2025-04-29',
      docNumber: '100',
      description: 'Принято на забалансовый счет арендованное основное средство',
      amount: 500_000,
    },
    AUDIT_DB_1C
  );
  const offCreditOp = bindAndGenerateOperation(
    {
      sourceFileName: 'export_all.xlsx',
      date: '2025-04-30',
      docNumber: '101',
      description: 'Возвращено арендодателю списанное с забалансового счета арендованное основное средство',
      amount: 500_000,
    },
    AUDIT_DB_1C
  );
  assert.equal(offCreditOp.entries[0].credit, '001');

  const allExportOps = [...exportOps, offDebitOp, offCreditOp];
  const exportOsv = calculateOsvReport({
    db1C: AUDIT_DB_1C,
    operations: allExportOps,
    dateFrom: '2025-04-01',
    dateTo: '2025-04-30',
    balanceAnchorOverride: 'treat_raw_as_start',
  });
  const bundle = buildExportBundle({
    mode: 'clean_db',
    db1C: AUDIT_DB_1C,
    operations: allExportOps,
    osv: exportOsv,
    reportingYear: 2025,
  });
  const bsl = bundle.bslCode;
  const xml = bundle.enterpriseDataXml;

  assert.ok(bsl.includes('Процедура ВыполнитьЗагрузку() Экспорт'));
  assert.ok(bsl.includes('Хозрасчетный.НайтиПоКоду("001")'));
  assert.ok(bsl.includes('Движ.СчетКт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("001");'));
  assert.ok(!bsl.includes('undefined'), 'BSL export must never contain "undefined"');

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<Message xmlns="http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8"'));
  assert.ok(xml.includes('</Message>'));
  assert.ok(!xml.includes('undefined'), 'XML export must never contain "undefined"');

  // Copy hygiene checks
  const dirty = sanitizeGeneratedText1C(
    'Проверьте сумму в карточке ниже.. Не забудьте заполнить в поле ниже.; undefined, , готово..'
  );
  assert.ok(!dirty.includes('..'));
  assert.ok(!dirty.includes('.;'));
  assert.ok(!dirty.includes('undefined'));
  assert.ok(!dirty.includes('ниже'));
  assert.ok(!dirty.includes(', ,'));
});
