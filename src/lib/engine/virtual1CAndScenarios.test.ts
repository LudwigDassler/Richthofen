import test from 'node:test';
import assert from 'node:assert/strict';
import { processBatchFiles } from '../import1c';
import {
  buildVirtual1CStateTimeline,
  recalculateOperationsChronologically,
  attachVirtualStateStep00ToOperations,
  computePendingNewCounterparties,
  computeContextCounterpartySuggestions,
  runAuditDiagnostics,
  calculateOsvReport,
} from './index';

function importTextAsOperations(rawText: string, fileName = 'journal.txt') {
  const buf = new TextEncoder().encode(rawText).buffer;
  const res = processBatchFiles([{ name: fileName, buffer: buf }], null, {
    reportingYear: 2025,
  });
  return attachVirtualStateStep00ToOperations(
    recalculateOperationsChronologically(res.operations, null, { reportingYear: 2025 }),
    null
  );
}

test('1 & 2. Writ of execution (76.41) + Payroll alimony deduction + Alimony payout with recipient INN', () => {
  const rawText = [
    '10.01.2025\tПринят на работу Валеев В.В. на должность инженера с окладом 100 000 руб.',
    '12.01.2025\tПоступил исполнительный лист о взыскании алиментов с Валеева В.В в пользу Валеевой (1/4 дохода)',
    '31.01.2025\tНачислена заработная плата за январь',
    '05.02.2025\tПеречислена задолженность по алиментам Супруге Валеева (ИНН 7816171168)',
  ].join('\n');

  const ops = importTextAsOperations(rawText, 'journal.txt');
  assert.equal(ops.length, 4);

  const writOp = ops[1];
  assert.equal(writOp.category, 'writ_of_execution');
  assert.equal(writOp.docType1C, 'ИсполнительныйЛист');
  assert.equal(writOp.entries.length, 0);
  assert.equal(writOp.readinessStatus, 'ready');
  assert.equal(writOp.alimonyRatePercent, 25);

  const payrollOp = ops[2];
  assert.equal(payrollOp.category, 'payroll_accrual');
  assert.equal(payrollOp.amount, 100000);
  const ndflEntry = payrollOp.entries.find((e) => e.debit === '70' && e.credit === '68.01');
  const alimonyEntry = payrollOp.entries.find((e) => e.debit === '70' && e.credit === '76.41');
  assert.ok(ndflEntry, 'NDFL 68.01 entry exists');
  assert.equal(ndflEntry.amount, 13000);
  assert.ok(alimonyEntry, 'Alimony 76.41 entry exists on payroll');
  // (100000 - 13000) * 25% = 21750
  assert.equal(alimonyEntry.amount, 21750);

  const payoutOp = ops[3];
  assert.equal(payoutOp.category, 'alimony_payout');
  assert.equal(payoutOp.docType1C, 'СписаниеСРасчетногоСчета');
  assert.equal(payoutOp.amount, 21750);
  assert.equal(payoutOp.alimonyRecipientInn, '7816171168');
  assert.equal(payoutOp.entries.length, 1);
  assert.equal(payoutOp.entries[0].debit, '76.41');
  assert.equal(payoutOp.entries[0].credit, '51');
  assert.equal(payoutOp.entries[0].amount, 21750);

  // Non-commercial ops must NOT pollute pending commercial counterparties or trigger missing-amount audit errors
  const pendingCps = computePendingNewCounterparties(ops, null);
  assert.equal(pendingCps.length, 0);

  const osv = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2025-01-01',
    dateTo: '2025-02-28',
    includeQueuedOperations: true,
    balanceAnchorOverride: 'auto',
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: ops, osv });
  const writOrAlimonyErrors = issues.filter(
    (i) =>
      i.severity === 'error' &&
      (i.operationId === writOp.id || i.operationId === payoutOp.id)
  );
  assert.equal(writOrAlimonyErrors.length, 0);
});

test('3. Fixed asset commissioning ("Введен бетоносмеситель в эксплуатацию (СПИ 28 мес)") pulls 08.04.1 cost and calculates /28 depreciation', () => {
  const rawText = [
    '14.01.2025\tПоступил бетоносмеситель от ООО СтройМаш на сумму 336 000 руб. в т.ч. НДС 20%',
    '15.01.2025\tВведен бетоносмеситель в эксплуатацию (СПИ 28 мес)',
    '28.02.2025\tНачислена амортизация основных средств за февраль',
  ].join('\n');

  const ops = importTextAsOperations(rawText, 'os.txt');
  assert.equal(ops.length, 3);

  const receiptOp = ops[0];
  assert.equal(receiptOp.category, 'purchase_equipment');
  // 336000 / 1.2 = 280000 net on 08.04.1
  const e0804 = receiptOp.entries.find((e) => e.debit === '08.04.1');
  assert.ok(e0804);
  assert.equal(e0804.amount, 280000);

  const commOp = ops[1];
  assert.equal(commOp.category, 'os_commissioning');
  assert.equal(commOp.docType1C, 'ПринятиеКУчетуОС');
  assert.equal(commOp.usefulLifeMonths, 28);
  assert.equal(commOp.amount, 280000);
  assert.equal(commOp.entries[0].debit, '01.01');
  assert.equal(commOp.entries[0].credit, '08.04.1');
  assert.equal(commOp.entries[0].amount, 280000);

  const deprOp = ops[2];
  assert.equal(deprOp.category, 'depreciation_accrual');
  // 280000 / 28 = 10000 per month
  assert.equal(deprOp.amount, 10000);
  assert.equal(deprOp.entries[0].credit, '02.01');
  assert.equal(deprOp.entries[0].amount, 10000);
});

test('4. Multi-invoice supplier payment by subject stems sums unpaid 60.01 balances and never guesses unrelated counterparties', () => {
  const rawText = [
    '10.02.2025\tПоступил принтер от ООО ОргТехника на сумму 36 000 руб. в т.ч. НДС 20%',
    '12.02.2025\tОказаны услуги по формированию сети от ООО Сетевые Решения на сумму 24 000 руб. в т.ч. НДС 20%',
    '18.02.2025\tПеречислен платеж за принтер и услуги по формированию сети',
    '20.02.2025\tОплачено поставщику за канцтовары 5 000 руб.',
  ].join('\n');

  const ops = importTextAsOperations(rawText, 'bank.txt');
  assert.equal(ops.length, 4);

  const multiBankOp = ops[2];
  assert.equal(multiBankOp.category, 'bank_out');
  assert.equal(multiBankOp.amount, 60000);
  assert.equal(multiBankOp.entries.length, 2);
  const totalPosted = multiBankOp.entries.reduce((s, e) => s + e.amount, 0);
  assert.equal(totalPosted, 60000);
  assert.ok(multiBankOp.entries.every((e) => e.debit === '60.01' && e.credit === '51'));

  // Idempotent second pass must preserve both suppliers and full 60 000 ₽ sum
  const secondPass = recalculateOperationsChronologically(ops, null, { reportingYear: 2025 });
  assert.equal(secondPass[2].amount, 60000);
  assert.equal(secondPass[2].entries.length, 2);

  // Pending new counterparties & Virtual1CState must contain ONLY the 2 real suppliers (no ';'-joined fake counterparty)
  const pendingCps = computePendingNewCounterparties(ops, null);
  assert.equal(pendingCps.length, 2);
  const timeline = buildVirtual1CStateTimeline(null, ops);
  assert.equal(timeline.finalState.counterparties.length, 2);

  // Unmatched stem ("канцтовары") must NOT guess ООО ОргТехника or ООО Сетевые Решения!
  const unmatchedOp = ops[3];
  assert.equal(unmatchedOp.counterpartyName, '');
  const suggestions = computeContextCounterpartySuggestions(unmatchedOp, ops, null);
  assert.equal(suggestions.length, 0);
});

test('5. Promissory notes / financial investment sums multiple principals on 58.02 without VAT (ст. 149 НК РФ)', () => {
  const rawText =
    '16.03.2025\tПриобретено два векселя (один на 280 000 под 13% , второй - 540 000 под 11%)';

  const ops = importTextAsOperations(rawText, 'notes.txt');
  assert.equal(ops.length, 1);

  const noteOp = ops[0];
  assert.equal(noteOp.category, 'financial_investment');
  assert.equal(noteOp.docType1C, 'ФинансовыеВложения');
  assert.equal(noteOp.amount, 820000);
  assert.equal(noteOp.vatRule, 'none');
  assert.equal(noteOp.vatAmount, 0);
  assert.equal(noteOp.entries[0].debit, '58.02');
  assert.equal(noteOp.entries[0].amount, 820000);
});

test('6. Repeated fuel & lubricants ("смазка для автомобилей") maps to 10.03 and transitions Step 00 from create_new to already_exists', () => {
  const rawText = [
    '11.01.2025\tПоступила смазка для автомобилей от ООО АвтоХим на сумму 12 000 руб. в т.ч. НДС 20%',
    '25.02.2025\tПоступила смазка для автомобилей от ООО АвтоХим на сумму 18 000 руб. в т.ч. НДС 20%',
  ].join('\n');

  const ops = importTextAsOperations(rawText, 'fuel.txt');
  assert.equal(ops.length, 2);
  assert.equal(ops[0].entries[0].debit, '10.03');
  assert.equal(ops[1].entries[0].debit, '10.03');

  const step00First = ops[0].mentorGuide1C?.step00Prep ?? [];
  const nomStepFirst = step00First.find((s) => s.entityKind === 'nomenclature');
  assert.ok(nomStepFirst);
  assert.equal(nomStepFirst.status, 'create_new');

  const step00Second = ops[1].mentorGuide1C?.step00Prep ?? [];
  const nomStepSecond = step00Second.find((s) => s.entityKind === 'nomenclature');
  assert.ok(nomStepSecond);
  assert.equal(nomStepSecond.status, 'already_exists');
  assert.equal(nomStepSecond.firstSeenOpNumber, 1);

  const timeline = buildVirtual1CStateTimeline(null, ops);
  assert.equal(timeline.finalState.nomenclature.length, 1);
  assert.equal(timeline.finalState.nomenclature[0].defaultAccount, '10.03');
  assert.equal(timeline.finalState.nomenclature[0].usages.length, 2);
});

test('7. Audit diagnostics emits 0 missing_requisite errors on founder contribution and multi-supplier bank_out after supplier INNs are filled', () => {
  const rawText = [
    '09.01.2025\tВнесен вклад в уставный капитал от Петрова П.П. на расчетный счет 500 000 руб.',
    '10.02.2025\tПоступил принтер от ООО ОргТехника (ИНН 7707083893 КПП 773601001) на сумму 36 000 руб. в т.ч. НДС 20%',
    '12.02.2025\tОказаны услуги по формированию сети от ООО Сетевые Решения (ИНН 7736207543 КПП 773601001) на сумму 24 000 руб. в т.ч. НДС 20%',
    '18.02.2025\tПеречислен платеж за принтер и услуги по формированию сети',
  ].join('\n');

  const ops = importTextAsOperations(rawText, 'audit-clean.txt');
  const osv = calculateOsvReport({
    db1C: null,
    operations: ops,
    dateFrom: '2025-01-01',
    dateTo: '2025-02-28',
    includeQueuedOperations: true,
    balanceAnchorOverride: 'auto',
  });
  const issues = runAuditDiagnostics({ db1C: null, operations: ops, osv });
  const reqErrors = issues.filter((i) => i.severity === 'error' && i.category === 'missing_requisite');
  assert.equal(reqErrors.length, 0);
});

