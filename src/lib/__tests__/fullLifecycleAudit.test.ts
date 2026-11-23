import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferOrganizationRegionCode,
  selectBestEgrulCandidate,
  validateRussianInnChecksum,
} from '@/lib/egrul/egrulLookup';
import {
  AUTOFIX_REGISTRY,
  autoFixAllBy1CDb,
  autoFixAuditIssue,
  bindAndGenerateOperation,
  buildVirtual1CStateTimeline,
  calculateOsvReport,
  recalculateOperationsChronologically,
  runAuditDiagnostics,
} from '@/lib/engine';
import {
  normalize1CDatabaseExport,
  parseFreeTextOrDelimitedOperations,
} from '@/lib/import1c';
import { EgrulCandidate, QueuedOperation } from '@/types/accounting';

function createSpbOrganizationDb() {
  return normalize1CDatabaseExport(
    {
      Конфигурация: 'БухгалтерияПредприятия 3.0',
      НачалоПериода: '2026-01-01',
      КонецПериода: '2026-12-31',
      Организация: {
        Наименование: 'ООО «БалтикИнжиниринг»',
        ИНН: '7810456789',
        КПП: '781001001',
        БИК: '044030653',
        Банк: 'СЕВЕРО-ЗАПАДНЫЙ БАНК ПАО СБЕРБАНК',
        РасчетныйСчет: '40702810455000012345',
        СистемаНалогообложения: 'ОСНО',
      },
      УчетнаяПолитика: {
        СистемаНалогообложения: 'ОСНО',
        СтавкаНДС: 20,
        ДиректКостинг: true,
      },
      ОстаткиПоСчетам: [
        // Balanced opening balances on 01.01.2026: Debit = 3 250 000, Credit = 3 250 000
        { Счет: '51', СальдоНачальноеДебет: 2800000, СальдоНачальноеКредит: 0 },
        { Счет: '50.01', СальдоНачальноеДебет: 50000, СальдоНачальноеКредит: 0 },
        {
          Счет: '10.01',
          Субконто: 'Панель МДФ',
          СальдоНачальноеДебет: 400000,
          СальдоНачальноеКредит: 0,
        },
        { Счет: '80.09', СальдоНачальноеДебет: 0, СальдоНачальноеКредит: 1000000 },
        { Счет: '84.01', СальдоНачальноеДебет: 0, СальдоНачальноеКредит: 2100000 },
        {
          Счет: '68.02',
          Субконто: 'Налог (взносы): начислено / уплачено',
          СальдоНачальноеДебет: 0,
          СальдоНачальноеКредит: 150000,
        },
      ],
      Справочники: {
        Контрагенты: [
          {
            Код: 'К-001',
            Наименование: 'ООО «СеверМеталл»',
            ИНН: '7805123458',
            КПП: '780501001',
            ВидКонтрагента: 'ЮридическоеЛицо',
            ОсновнойДоговор: 'Договор поставки № 12',
          },
          {
            Код: 'К-002',
            Наименование: 'ООО «АльфаСтрой»',
            ИНН: '7814234567',
            КПП: '781401001',
            ВидКонтрагента: 'ЮридическоеЛицо',
            ОсновнойДоговор: 'Договор покупателя № 45',
          },
        ],
        Сотрудники: [
          { Код: 'С-001', Наименование: 'Смирнов С.С.', Должность: 'Генеральный директор', Оклад: '90000' },
        ],
        ФизическиеЛица: [
          { Код: 'Ф-001', Наименование: 'Смирнов С.С.', ИНН: '780112345678' },
          { Код: 'Ф-002', Наименование: 'Федоров Ф.Ф.', ИНН: '780223456789' },
        ],
      },
      Проводки: [],
      Документы: [],
    },
    'baltic_1c_2026.json'
  );
}

test('Region-aware EGRUL ranking prefers active St. Petersburg (78) company over liquidated Samara (63) namesake', () => {
  const db1C = createSpbOrganizationDb();
  const homeRegion = inferOrganizationRegionCode({
    organizationInn: db1C.organization.inn,
    organizationBik: db1C.organization.bik,
  });
  assert.equal(homeRegion, '78');

  const candidates: EgrulCandidate[] = [
    {
      inn: '6316099123',
      kpp: '631601001',
      ogrn: '1086316001234',
      name: 'ООО «ПромСнабРесурс»',
      fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «ПРОМСНАБРЕСУРС»',
      kind: 'ЮридическоеЛицо',
      region: '63',
      isActive: false, // Liquidated Samara namesake listed first!
      source: 'egrul_fns',
    },
    {
      inn: '7811456123',
      kpp: '781101001',
      ogrn: '1197847009876',
      name: 'ООО «ПромСнабРесурс»',
      fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «ПРОМСНАБРЕСУРС»',
      kind: 'ЮридическоеЛицо',
      region: '78',
      isActive: true, // Active St. Petersburg entity
      source: 'egrul_fns',
    },
  ];

  const best = selectBestEgrulCandidate(candidates, 'ООО «ПромСнабРесурс»', homeRegion);
  assert.ok(best);
  assert.equal(best.inn, '7811456123');
  assert.equal(best.isActive, true);
  assert.equal(best.region, '78');
});

test('Full 28-operation multi-quarter coursework lifecycle: closed-world L1..L7 resolver, promissory notes, OS lifecycle, 1-click autofix convergence, and 00..04 defense guides', () => {
  const db1C = createSpbOrganizationDb();

  // 28 realistic operations across Q1–Q3 2026 covering every tricky category
  const courseworkJournalLines = [
    // Q1 (January–March 2026)
    '10.01.2026\tУтверждена учетная политика организации на 2026 год (метод начисления, ОСНО)',
    '11.01.2026\tЗаключен договор аренды офиса № АР-10 с ООО «БизнесЦентрНева» с ежемесячной арендной платой 60 000 руб. (в т.ч. НДС 20%)',
    '12.01.2026\tПринят на работу инженер Валеев В.В. с окладом 80 000 руб.',
    '13.01.2026\tПоступил исполнительный лист на удержание алиментов с Валеева В.В. в пользу Валеевой А.П. в размере 25%',
    '15.01.2026\tПеречислен в бюджет НДС за прошлый квартал по остатку счета 68.02',
    '18.01.2026\tПриобретены процентные векселя ООО «ФинИнвест» на сумму 820 000 руб.: вексель №1 номиналом 280 000 руб. под 13% годовых и вексель №2 номиналом 540 000 руб. под 11% годовых',
    '20.01.2026\tПриобретен станок фрезерный ЧПУ у ООО «СеверМеталл» на сумму 360 000 руб. (в т.ч. НДС 20%)',
    '21.01.2026\tОтражены услуги доставки и монтажа станка фрезерного ЧПУ от ООО «ЛогистикСПб» на сумму 60 000 руб. (в т.ч. НДС 20%)',
    '22.01.2026\tВведен в эксплуатацию станок фрезерный ЧПУ со сроком полезного использования 60 мес.',
    '25.01.2026\tПоступил аванс от покупателя ООО «АльфаСтрой» на расчетный счет 600 000 руб. (в т.ч. НДС 20%)',
    '28.01.2026\tПо чеку сняли денежные средства с расчетного счета в кассу на хозрасходы 40 000 руб.',
    '29.01.2026\tВыдано Федорову Ф.Ф. под отчет из кассы на хозяйственные нужды 25 000 руб.',
    '30.01.2026\tУтвержден авансовый отчет Федорова Ф.Ф. по приобретению канцтоваров на сумму 18 000 руб.',
    '31.01.2026\tВозвращен в кассу остаток неиспользованных подотчетных сумм от Федорова Ф.Ф.',
    '31.01.2026\tНачислена арендная плата за офис за январь по договору аренды с ООО «БизнесЦентрНева»',
    '31.01.2026\tНачислена заработная плата сотрудникам и страховые взносы за январь',
    // Q2 (April–June 2026)
    '05.04.2026\tПеречислена заработная плата сотрудникам с расчетного счета за январь',
    '06.04.2026\tПеречислены удержанные алименты получателю Валеевой А.П. с расчетного счета',
    '10.04.2026\tНачислены проценты по приобретенным векселям за 3 месяца',
    '15.04.2026\tПоступили материалы Профиль алюминиевый от ООО «ПромХимПоставка» на сумму 336 000 руб. (в т.ч. НДС 20%)',
    '18.04.2026\tПередан вексель №1 ООО «ПромХимПоставка» в счет оплаты поставленных материалов',
    '20.04.2026\tПередана панель МДФ со склада в основное производство на сумму 220 000 руб.',
    '25.04.2026\tВыпущена из производства готовая продукция Стеновые панели по фактической себестоимости 220 000 руб.',
    '28.04.2026\tОтгружена продукция Стеновые панели покупателю по цене без НДС 500 000 руб. (НДС 20% сверху)',
    '30.04.2026\tНачислена амортизация по станку фрезерному ЧПУ за месяц',
    // Q3 (July–September 2026)
    '10.07.2026\tНачислены проценты по оставшимся процентным векселям за 3 месяца',
    '15.07.2026\tВыдан краткосрочный процентный заем ООО «ВекторРазвитие» с расчетного счета 200 000 руб. под 12% годовых',
    '15.08.2026\tНачислены проценты по выданному займу ООО «ВекторРазвитие» за 1 месяц',
    '20.09.2026\tСписан станок фрезерный ЧПУ вследствие физического износа (ликвидация объекта ОС)',
  ].join('\n');

  const drafts = parseFreeTextOrDelimitedOperations(
    courseworkJournalLines,
    'Курсовая_2026.xlsx',
    db1C,
    { reportingYear: 2026 }
  );
  assert.equal(drafts.length, 29);

  // Build operations sequentially
  const rawOps: QueuedOperation[] = [];
  drafts.forEach((draft, idx) => {
    const op = bindAndGenerateOperation(draft, db1C, `op-course-${idx + 1}`, {
      priorOperations: rawOps,
      reportingYear: 2026,
      defaultBik: db1C.organization.bik,
      defaultBankName: db1C.organization.bankName,
      assumeInvoiceOnVatPurchase: true,
    });
    rawOps.push(op);
  });

  const syncedOps = recalculateOperationsChronologically(rawOps, db1C, {
    reportingYear: 2026,
    defaultBik: db1C.organization.bik,
  });

  // INVARIANT 1: Zero false ПоступлениеТоваровУслуг on non-purchase rows!
  const purchaseDocOps = syncedOps.filter((o) => o.docType1C === 'ПоступлениеТоваровУслуг');
  for (const pOp of purchaseDocOps) {
    assert.ok(
      ['purchase_goods', 'purchase_materials', 'purchase_services', 'purchase_equipment'].includes(
        pOp.category
      ),
      `Unexpected ПоступлениеТоваровУслуг on category ${pOp.category}: ${pOp.description}`
    );
  }

  // Policy event & Contract event produce 0 postings and ready status (zero false red errors!)
  const policyOp = syncedOps[0];
  assert.equal(policyOp.category, 'policy_event');
  assert.equal(policyOp.entries.length, 0);
  assert.equal(policyOp.readinessStatus, 'ready');

  const contractOp = syncedOps[1];
  assert.equal(contractOp.category, 'contract_event');
  assert.equal(contractOp.entries.length, 0);
  assert.equal(contractOp.readinessStatus, 'ready');

  // Tax payment derived 150,000 ₽ from opening credit balance on 68.02
  const vatPayOp = syncedOps.find((o) => o.category === 'tax_payment');
  assert.ok(vatPayOp);
  assert.equal(vatPayOp.amount, 150000);

  // OS Capex accumulates purchase (300,000 excl. VAT) + delivery/mounting (50,000 excl. VAT) = 350,000 on 08.04.1 -> 01.01!
  const osCommissionOp = syncedOps.find((o) => o.category === 'os_commissioning');
  assert.ok(osCommissionOp);
  assert.equal(osCommissionOp.amount, 350000);

  // Accountable return derived 25,000 - 18,000 = 7,000 ₽ automatically
  const accReturnOp = syncedOps.find((o) => o.category === 'accountable_return');
  assert.ok(accReturnOp);
  assert.equal(accReturnOp.amount, 7000);

  // Rent accrual derived 60,000 ₽ from contract_event #2!
  const rentAccrualOp = syncedOps.find((o) =>
    o.description.toLowerCase().includes('начислена арендная плата')
  );
  assert.ok(rentAccrualOp);
  assert.equal(rentAccrualOp.amount, 60000);

  // Payroll accrual derived staff ФОТ: Смирнов (90,000 from 1C DB) + Валеев (80,000 from hire order) = 170,000 ₽
  // Plus alimony withholding on Валеев: (80,000 - 10,400 НДФЛ) * 25% = 17,400 ₽ on Кт 76.41!
  const payrollOp = syncedOps.find((o) => o.category === 'payroll_accrual');
  assert.ok(payrollOp);
  const totalGross70 =
    Math.round(
      payrollOp.entries.filter((e) => e.credit === '70').reduce((s, e) => s + e.amount, 0) * 100
    ) / 100;
  assert.equal(totalGross70, 170000);
  const alimWithholdEntry = payrollOp.entries.find(
    (e) => e.debit === '70' && e.credit === '76.41'
  );
  assert.equal(alimWithholdEntry?.amount, 17400);

  // Alimony payout derived 17,400 ₽ from 76.41 balance!
  const alimPayOp = syncedOps.find((o) => o.category === 'alimony_payout');
  assert.ok(alimPayOp);
  assert.equal(alimPayOp.amount, 17400);

  // INVARIANT 2: Promissory note lifecycle!
  // Acquisition with both total and breakdown ("на сумму 820 000 руб.: 280 000 ... и 540 000") MUST equal 820,000 ₽ (never doubled to 1,640,000 ₽)!
  const noteAcqOp = syncedOps.find((o) => o.category === 'financial_investment');
  assert.ok(noteAcqOp);
  assert.equal(noteAcqOp.amount, 820000);

  // Also verify "Внесен вклад учредителя Петрова П.П. на расчетный счет 500 000 руб." classifies as founder_contribution (Дт 51 Кт 75.01)
  const founderCheckOp = bindAndGenerateOperation(
    parseFreeTextOrDelimitedOperations(
      '10.01.2026\tВнесен вклад учредителя Петрова П.П. на расчетный счет 500 000 руб.',
      'founder.xlsx',
      db1C,
      { reportingYear: 2026 }
    )[0],
    db1C,
    'op-founder-check',
    { priorOperations: [], reportingYear: 2026 }
  );
  assert.equal(founderCheckOp.category, 'founder_contribution');
  assert.equal(founderCheckOp.amount, 500000);
  assert.equal(founderCheckOp.counterpartyName, 'Петров П.П.');
  assert.ok(founderCheckOp.entries.some((e) => e.debit === '51' && e.credit === '75.01' && e.amount === 500000));

  // Note #1: 280,000 @ 13% -> 3 months = 280,000 * 0.13 * (3/12) = 9,100 ₽
  // Note #2: 540,000 @ 11% -> 3 months = 540,000 * 0.11 * (3/12) = 14,850 ₽
  // First interest accrual (both active) = 9,100 + 14,850 = 23,950 ₽
  const noteInterestOps = syncedOps.filter(
    (o) => o.category === 'financial_interest_accrual'
  );
  assert.equal(noteInterestOps.length, 2);
  assert.equal(noteInterestOps[0].amount, 23950);

  // Endorsement of Note #1 to ООО «ПромХимПоставка»: principal 280,000 + accrued interest 9,100 = 289,100 ₽!
  // Entries: Дт 76.09 Кт 91.01 (289,100), Дт 91.02 Кт 58.02 (280,000), Дт 60.01 Кт 76.09 (289,100 + 9,100 accrued or principal+interest settlement)
  const noteDisposalOp = syncedOps.find((o) => o.category === 'financial_disposal');
  assert.ok(noteDisposalOp);
  assert.ok(noteDisposalOp.entries.some((e) => e.debit === '91.02' && e.credit === '58.02' && e.amount === 280000));
  assert.ok(noteDisposalOp.entries.some((e) => e.debit === '60.01' && e.credit === '76.09'));

  // Second interest accrual (10.07.2026) MUST accrue ONLY on active Note #2 (540,000 * 11% * 3/12 = 14,850 ₽), NOT disposed Note #1!
  assert.equal(noteInterestOps[1].amount, 14850);

  // Loan issued (200,000 @ 12%) -> 1 month interest = 200,000 * 0.12 / 12 = 2,000 ₽
  const loanOp = syncedOps.find((o) => o.category === 'loan_issued');
  assert.ok(loanOp);
  assert.ok(loanOp.entries.some((e) => e.debit === '58.03' && e.credit === '51' && e.amount === 200000));

  const loanInterestOp = syncedOps.find((o) => o.category === 'loan_interest_accrual');
  assert.ok(loanInterestOp);
  assert.equal(loanInterestOp.amount, 2000);

  // OS disposal via retirement subaccount 01.09: writes off initial cost 350,000 (Дт 01.09 Кт 01.01), accumulated depreciation (Дт 02.01 Кт 01.09), residual value to 91.02 (Дт 91.02 Кт 01.09) so 01.09 closes to 0!
  const osDisposalOp = syncedOps.find((o) => o.category === 'os_disposal');
  assert.ok(osDisposalOp);
  assert.ok(osDisposalOp.entries.some((e) => e.debit === '01.09' && e.credit === '01.01' && e.amount === 350000));
  assert.ok(osDisposalOp.entries.some((e) => e.debit === '91.02' && e.credit === '01.09'));

  // Sale without buyer specified in text ("покупателю по цене без НДС 500 000") binds to ООО «АльфаСтрой» via open 62.02 advance (600,000 ₽) and computes 500,000 + 20% VAT = 600,000 ₽!
  const saleOp = syncedOps.find((o) => o.category === 'sale_goods');
  assert.ok(saleOp);
  assert.equal(saleOp.amount, 600000);
  assert.ok(saleOp.counterpartyName.includes('АльфаСтрой'));

  // INVARIANT 3: Every autofixable issue is registered in AUTOFIX_REGISTRY, and 1 call to autoFixAllBy1CDb leaves 0 autofixable issues!
  const calcYearOsv = (ops: QueuedOperation[]) =>
    calculateOsvReport({
      db1C,
      operations: ops,
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      reportingYear: 2026,
      includeQueuedOperations: true,
    });

  const preIssues = runAuditDiagnostics({
    db1C,
    operations: syncedOps,
    osv: calcYearOsv(syncedOps),
  });
  for (const iss of preIssues) {
    assert.equal(
      iss.description.includes('402-ФЗ'),
      false,
      `Audit issue must never blame 402-ФЗ: ${iss.description}`
    );
    if (iss.canAutoFixBy1C) {
      assert.ok(iss.fixId && AUTOFIX_REGISTRY[iss.fixId], `Missing fixId in AUTOFIX_REGISTRY for ${iss.id}`);
    }
  }

  // Verify single-card autoFixAuditIssue works on a missing-inn issue before running full pipeline
  const sampleAutoIssue = preIssues.find((i) => i.canAutoFixBy1C);
  if (sampleAutoIssue) {
    const singleFixRes = autoFixAuditIssue({
      issue: sampleAutoIssue,
      db1C,
      operations: syncedOps,
      calculateCurrentOsv: calcYearOsv,
      periodEndDate: '2026-09-30',
      reportingYear: 2026,
    });
    assert.ok(singleFixRes.fixedCount >= 1);
  }

  // Run full 5-pass fixed-point 1-click AutoFix
  const fixed = autoFixAllBy1CDb({
    db1C,
    operations: syncedOps,
    calculateCurrentOsv: calcYearOsv,
    periodEndDate: '2026-09-30',
    reportingYear: 2026,
    defaultBik: db1C.organization.bik,
  });

  assert.equal(fixed.executionSummary.remainingAutofixableCount, 0);
  assert.equal(fixed.executionSummary.criticalAfter, 0);
  assert.equal(fixed.executionSummary.isOsvBalanced, true);

  const postOsvYear = calcYearOsv(fixed.operations);
  const postIssues = runAuditDiagnostics({
    db1C,
    operations: fixed.operations,
    osv: postOsvYear,
  });
  assert.equal(
    postIssues.filter((i) => i.canAutoFixBy1C).length,
    0,
    `Expected 0 remaining canAutoFixBy1C issues, got: ${postIssues
      .filter((i) => i.canAutoFixBy1C)
      .map((i) => i.id)
      .join(', ')}`
  );

  // All fictional companies received valid 10-digit FNS checksum INNs in home region 78
  for (const op of fixed.operations) {
    if (op.counterpartySource === 'educational_generated') {
      assert.equal(validateRussianInnChecksum(op.counterpartyInn).valid, true);
      assert.equal(op.counterpartyInn.startsWith('78'), true);
    }
  }

  // INVARIANT 4: OSV balances cleanly (Σ Дт === Σ Кт) for Q1, Q2, Q3, and Year, with zero red active balances and closed 20/25/26/44/90/91!
  const periods = [
    ['2026-01-01', '2026-03-31'],
    ['2026-04-01', '2026-06-30'],
    ['2026-07-01', '2026-09-30'],
    ['2026-01-01', '2026-12-31'],
  ] as const;

  for (const [dateFrom, dateTo] of periods) {
    const pOsv = calculateOsvReport({
      db1C,
      operations: fixed.operations,
      dateFrom,
      dateTo,
      reportingYear: 2026,
      includeQueuedOperations: true,
    });
    assert.equal(pOsv.totals.isStartBalanced, true, `Start OSV unbalanced for ${dateFrom}..${dateTo}`);
    assert.equal(pOsv.totals.isTurnoverBalanced, true, `Turnover OSV unbalanced for ${dateFrom}..${dateTo}`);
    assert.equal(pOsv.totals.isEndBalanced, true, `End OSV unbalanced for ${dateFrom}..${dateTo}`);
  }

  // Zero red ending balances on active accounts (50.01, 51, 10.*, 41.*, 43, 01.09)
  for (const row of postOsvYear.leafRows) {
    if (
      row.code === '50.01' ||
      row.code === '51' ||
      row.code === '01.09' ||
      row.code.startsWith('10.') ||
      row.code.startsWith('41.') ||
      row.code === '43'
    ) {
      assert.equal(row.hasRedEnd, false, `Unexpected red balance on active account ${row.code}`);
    }
  }
  const row0109 = postOsvYear.leafRows.find((r) => r.code === '01.09');
  assert.equal(row0109?.endDebit ?? 0, 0);
  assert.equal(row0109?.endCredit ?? 0, 0);

  // Cost & financial result accounts (20.01, 25, 26, 44.01, synthetic 90, synthetic 91) closed to 0.00 at period end!
  for (const closedCode of ['20.01', '25', '26', '44.01']) {
    const r = postOsvYear.leafRows.find((x) => x.code === closedCode);
    assert.equal(r?.endDebit ?? 0, 0, `Account ${closedCode} should be closed to 0`);
  }
  const grp90 = postOsvYear.rows.find((r) => r.code === '90' && r.isGroup);
  assert.equal(grp90?.endDebit ?? 0, 0);
  assert.equal(grp90?.endCredit ?? 0, 0);
  const grp91 = postOsvYear.rows.find((r) => r.code === '91' && r.isGroup);
  assert.equal(grp91?.endDebit ?? 0, 0);
  assert.equal(grp91?.endCredit ?? 0, 0);

  // Virtual 1C State confirms Note #1 is 'disposed' and Note #2 remains 'active'
  const timeline = buildVirtual1CStateTimeline(db1C, fixed.operations);
  const finNotes = timeline.finalState.financialInvestments.filter((f) => f.account === '58.02');
  assert.equal(finNotes.some((n) => n.paperIndex === 1 && n.status === 'disposed'), true);
  assert.equal(finNotes.some((n) => n.paperIndex === 2 && n.status === 'active'), true);

  // INVARIANT 5: Every operation has populated Defense Mode blocks (step00Prep array, step01CalculationBreakdown, step02AccountingLogic)
  let sawFormalAutoFillBadge = false;
  for (const op of fixed.operations) {
    assert.ok(op.mentorGuide1C, `Missing mentorGuide1C on ${op.id}`);
    assert.ok(Array.isArray(op.mentorGuide1C.step00Prep), `Missing step00Prep on ${op.id}`);
    assert.ok(op.mentorGuide1C.step01CalculationBreakdown, `Missing step01CalculationBreakdown on ${op.id}`);
    assert.ok(
      op.mentorGuide1C.step01CalculationBreakdown.summaryFormula.length > 0,
      `Empty summaryFormula on ${op.id}`
    );
    assert.ok(op.mentorGuide1C.step02AccountingLogic, `Missing step02AccountingLogic on ${op.id}`);
    assert.ok(op.mentorGuide1C.step02AccountingLogic.regulatoryNorms.length > 0);
    if (op.mentorGuide1C.step00Prep.some((s) => s.isFormalAutoFilled)) {
      sawFormalAutoFillBadge = true;
    }
  }
  assert.equal(sawFormalAutoFillBadge, true, 'Expected formal auto-fill note in Step 00 for fictional counterparties');
});

test('Level 8 truly missing amount lists all 7 checked closed-world sources calmly without blaming ст. 9 402-ФЗ', () => {
  const db1C = createSpbOrganizationDb();
  const mysteryOp = bindAndGenerateOperation(
    {
      sourceFileName: 'mystery.xlsx',
      date: '2026-05-12',
      docNumber: '',
      description: 'Поступили консультационные услуги от ООО «НеизвестныйКонсультант»',
      amount: 0,
      needsAmount: true,
      counterpartyName: 'ООО «НеизвестныйКонсультант»',
    },
    db1C,
    'op-l8-check',
    { priorOperations: [], reportingYear: 2026 }
  );

  assert.equal(mysteryOp.amountMode, 'required_missing');
  assert.equal(mysteryOp.mentorGuide1C?.step01CalculationBreakdown?.resolverLevel, 8);
  assert.equal(
    mysteryOp.mentorGuide1C?.step01CalculationBreakdown?.checkedSourcesWhenMissing?.length,
    7
  );

  const osv = calculateOsvReport({ db1C, operations: [mysteryOp], includeQueuedOperations: true });
  const issues = runAuditDiagnostics({ db1C, operations: [mysteryOp], osv });
  const missingAmtIssue = issues.find((i) => i.id === `missing-amount-${mysteryOp.id}`);
  assert.ok(missingAmtIssue);
  assert.equal(missingAmtIssue.description.includes('402-ФЗ'), false);
  assert.equal(missingAmtIssue.accountingReason?.includes('402-ФЗ') ?? false, false);
  assert.ok(missingAmtIssue.description.includes('Проверены все 7 уровней'));
});
