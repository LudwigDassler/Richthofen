import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize1CDatabaseExport } from '../import1c/json1CSyncNormalizer';
import {
  bindAndGenerateOperation,
  get1CCounterpartyAndIndividualOptions,
  sanitizeHydratedOperations,
} from '../engine/postingEngine';
import {
  computePendingNewCounterparties,
  runAuditDiagnostics,
} from '../engine/auditAndAutofix';
import { calculateOsvReport } from '../engine/osvCalculator';

const SAMPLE_1C_DB = normalize1CDatabaseExport(
  {
    Организация: {
      Наименование: 'ООО «Завод МеталлПрофиль»',
      ИНН: '6671098412',
      КПП: '667101001',
    },
    Остатки: [
      { Счет: '51', СальдоНачальноеДт: 100000, СальдоКонечноеДт: 100000 },
      { Счет: '80.09', СальдоНачальноеКт: 100000, СальдоКонечноеКт: 100000 },
    ],
    ВсеСправочники: {
      Контрагенты: [
        {
          Код: 'К-001',
          Наименование: 'ООО «СнабКомплект»',
          ИНН: '6670112233',
          КПП: '667001001',
        },
      ],
      ФизическиеЛица: [
        {
          Код: 'ФЛ-001',
          Наименование: 'Иванов Иван Иванович',
        },
        {
          Код: 'ФЛ-002',
          Наименование: 'Морозова Елена Сергеевна',
          ИНН: '667199887766',
        },
      ],
    },
  },
  'test_1c.json'
);

test('Founder share contributions (75.01) extract inflected FIO and bind to 1C ФизическиеЛица without asking for INN', () => {
  const op = bindAndGenerateOperation(
    {
      sourceFileName: 'bank.txt',
      date: '2025-04-12',
      docNumber: '101',
      description: 'Поступление на расчетный счет доли Иванова Ивана Ивановича',
      amount: 250000,
    },
    SAMPLE_1C_DB
  );

  assert.equal(op.category, 'founder_contribution');
  assert.equal(op.docType1C, 'ПоступлениеНаРасчетныйСчет');
  assert.equal(op.counterpartyName, 'Иванов Иван Иванович');
  assert.equal(op.bindings.counterparty.status, 'matched_1c');
  assert.equal(op.bindings.contract.status, 'not_required');
  assert.equal(op.vatRate, 0);
  assert.equal(op.entries.length, 1);
  assert.equal(op.entries[0].debit, '51');
  assert.equal(op.entries[0].credit, '75.01');
  assert.equal(op.entries[0].amount, 250000);

  // Even though Иванов Иван Иванович has no INN in ФизическиеЛица, audit must NOT request INN
  const osv = calculateOsvReport({
    db1C: SAMPLE_1C_DB,
    operations: [op],
    dateFrom: '2025-04-01',
    dateTo: '2025-04-30',
    balanceAnchorOverride: 'auto',
    includeQueuedOperations: true,
  });
  const issues = runAuditDiagnostics({
    db1C: SAMPLE_1C_DB,
    operations: [op],
    osv,
  });
  assert.equal(
    issues.some((i) => i.id.startsWith('missing-inn-')),
    false,
    'Matched 1C ФизическоеЛицо must not trigger missing INN prompt'
  );
  assert.equal(
    issues.some((i) => i.id.includes('75.01')),
    false,
    'Account 75.01 (active-passive in 1C BP 3.0) must not trigger false-positive red balance on founder contribution'
  );
  assert.equal(computePendingNewCounterparties([op], SAMPLE_1C_DB).length, 0);
});

test('Sanitizes single-letter ("О", "о", "т") orphan counterparties on hydration and rejects <2-char names', () => {
  const op1 = bindAndGenerateOperation(
    {
      sourceFileName: 'test.txt',
      date: '2025-04-15',
      description: 'Оплата поставщику за материалы',
      amount: 50000,
      counterpartyName: 'О',
    },
    SAMPLE_1C_DB
  );
  // bindAndGenerateOperation itself strips <2-char names
  assert.equal(op1.counterpartyName, '');

  // Simulate legacy corrupted localStorage state where single-letter counterparties were persisted
  const corruptedOps = ['О', 'о', 'т'].map((letter, idx) => ({
    ...op1,
    id: `corrupt-${idx}`,
    counterpartyName: letter,
    bindings: {
      ...op1.bindings,
      counterparty: { status: 'new_for_1c' as const, note: 'Corrupted' },
    },
  }));

  const cleaned = sanitizeHydratedOperations(corruptedOps, SAMPLE_1C_DB);
  for (const c of cleaned) {
    assert.equal(c.counterpartyName, '');
    assert.equal(c.bindings.counterparty.status, 'missing');
  }

  // Pending new counterparties must be empty (no "ИНН контрагента: О / о / т")
  const pending = computePendingNewCounterparties(cleaned, SAMPLE_1C_DB);
  assert.equal(pending.length, 0);

  // Unified 1C autocomplete options contain both Контрагенты and ФизическиеЛица
  const options = get1CCounterpartyAndIndividualOptions(SAMPLE_1C_DB);
  assert.equal(options.length, 3);
  assert.ok(options.some((o) => o.source === 'Контрагенты' && o.name === 'ООО «СнабКомплект»'));
  assert.ok(options.some((o) => o.source === 'ФизическиеЛица' && o.name === 'Иванов Иван Иванович'));
});
