import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAndGenerateOperation } from './postingEngine';
import {
  build1CNavigationBreadcrumbs,
  build1CRegistersImpact,
  build1CWindowTitle,
  buildCreateBasedOnLinks1C,
  buildFieldHints1C,
  buildWalkthroughSteps1C,
  CREATE_MENU_1C_SECTIONS,
  formatDocNumber1C,
  resolveTaxi1CLayoutKind,
} from './taxi1cFormMapper';

test('CREATE_MENU_1C_SECTIONS exposes all 7 authentic 1C:BP 3.0 sections', () => {
  assert.equal(CREATE_MENU_1C_SECTIONS.length, 7);
  const titles = CREATE_MENU_1C_SECTIONS.map((s) => s.sectionTitle);
  assert.deepEqual(titles, [
    'Покупки',
    'Продажи',
    'Банк и касса',
    'Склад и производство',
    'ОС и НМА',
    'Зарплата и кадры',
    'Операции',
  ]);
});

test('resolveTaxi1CLayoutKind maps all 9 specialized 1C Taxi form layouts accurately', () => {
  const ptu = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-09',
      docNumber: '15',
      description: 'Поступили материалы от ООО Альфа на сумму 120 000 руб. в т.ч. НДС 20%',
      amount: 120000,
      vatRate: 20,
      vatRule: 'included',
      hasInvoiceSF: true,
      counterpartyName: 'ООО "Альфа"',
      docTypeHint: 'ПоступлениеТоваровУслуг',
      categoryHint: 'purchase_materials',
    },
    null,
    'op-ptu'
  );
  assert.equal(resolveTaxi1CLayoutKind(ptu), 'ptu');

  const rtu = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-15',
      docNumber: '22',
      description: 'Реализованы услуги ООО Бета на сумму 240 000 руб. в т.ч. НДС 20%',
      amount: 240000,
      vatRate: 20,
      vatRule: 'included',
      hasInvoiceSF: true,
      counterpartyName: 'ООО "Бета"',
      docTypeHint: 'РеализацияТоваровУслуг',
      categoryHint: 'sale_services',
    },
    null,
    'op-rtu'
  );
  assert.equal(resolveTaxi1CLayoutKind(rtu), 'rtu');

  const bank = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-16',
      docNumber: '104',
      description: 'Поступила оплата от покупателя ООО Бета на расчетный счет',
      amount: 240000,
      counterpartyName: 'ООО "Бета"',
      docTypeHint: 'ПоступлениеНаРасчетныйСчет',
      categoryHint: 'bank_in',
    },
    null,
    'op-bank'
  );
  assert.equal(resolveTaxi1CLayoutKind(bank), 'bank');

  const cashAo = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-18',
      docNumber: '4',
      description: 'Утвержден авансовый отчет Иванова И.И. за канцтовары',
      amount: 6000,
      employeeName: 'Иванов И.И.',
      docTypeHint: 'АвансовыйОтчет',
      categoryHint: 'expense_report',
    },
    null,
    'op-ao'
  );
  assert.equal(resolveTaxi1CLayoutKind(cashAo), 'cash_ao');

  const matWriteoff = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-20',
      docNumber: '8',
      description: 'Списаны материалы в основное производство',
      amount: 50000,
      docTypeHint: 'РасходМатериалов',
      categoryHint: 'materials_writeoff',
    },
    null,
    'op-mat'
  );
  assert.equal(resolveTaxi1CLayoutKind(matWriteoff), 'materials_writeoff');

  const osComm = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-21',
      docNumber: '2',
      description: 'Введен в эксплуатацию станок ЧПУ, СПИ 60 мес.',
      amount: 300000,
      usefulLifeMonths: 60,
      docTypeHint: 'ПринятиеКУчетуОС',
      categoryHint: 'os_commissioning',
    },
    null,
    'op-os'
  );
  assert.equal(resolveTaxi1CLayoutKind(osComm), 'os_nma');

  const hire = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-01-12',
      docNumber: '1',
      description: 'Принят на работу директор Петров П.П. с окладом 90 000 руб.',
      amount: 0,
      monthlySalary: 90000,
      employeeName: 'Петров П.П.',
      docTypeHint: 'ПриемНаРаботу',
      categoryHint: 'hr_hire',
    },
    null,
    'op-hire'
  );
  assert.equal(resolveTaxi1CLayoutKind(hire), 'hr_payroll');

  const inv = bindAndGenerateOperation(
    {
      sourceFileName: 'test.csv',
      date: '2026-02-01',
      docNumber: '7',
      description: 'Выставлен счет на оплату покупателю ООО Бета',
      amount: 240000,
      counterpartyName: 'ООО "Бета"',
      docTypeHint: 'СчетПокупателю',
      categoryHint: 'customer_invoice',
    },
    null,
    'op-inv'
  );
  assert.equal(resolveTaxi1CLayoutKind(inv), 'invoice_prod_vat');

  const closing = {
    ...ptu,
    id: 'op-closing',
    docType1C: 'ЗакрытиеМесяца' as const,
    category: 'closing' as const,
    date: '2026-03-31',
  };
  assert.equal(resolveTaxi1CLayoutKind(closing), 'manual_closing');
});

test('build1CWindowTitle, breadcrumbs, hints, walkthrough, based-on links, and registers work cleanly', () => {
  assert.equal(formatDocNumber1C('15'), '0000-000015');
  assert.equal(formatDocNumber1C('БП-0042'), 'БП-0042');

  const ptu = bindAndGenerateOperation(
    {
      sourceFileName: 'Q1.csv',
      date: '2026-02-09',
      docNumber: '15',
      incomingDocNumber: 'УПД-77',
      description: 'Поступили материалы от ООО Альфа на сумму 120 000 руб. в т.ч. НДС 20%',
      amount: 120000,
      vatRate: 20,
      vatRule: 'included',
      hasInvoiceSF: true,
      counterpartyName: 'ООО "Альфа"',
      docTypeHint: 'ПоступлениеТоваровУслуг',
      categoryHint: 'purchase_materials',
    },
    null,
    'op-ptu-15'
  );

  const bankOut = bindAndGenerateOperation(
    {
      sourceFileName: 'Q1.csv',
      date: '2026-02-12',
      docNumber: '28',
      description: 'Оплачено поставщику ООО Альфа с расчетного счета',
      amount: 120000,
      counterpartyName: 'ООО "Альфа"',
      docTypeHint: 'СписаниеСРасчетногоСчета',
      categoryHint: 'bank_out',
    },
    null,
    'op-bank-28'
  );

  const title = build1CWindowTitle(ptu);
  assert.equal(
    title.fullTitle,
    'Поступление (акт, накладная, УПД) 0000-000015 от 09.02.2026 (проведен)'
  );

  const nav = build1CNavigationBreadcrumbs(ptu);
  assert.ok(nav.section.length > 0);
  assert.ok(nav.journal.length > 0);

  const hints = buildFieldHints1C(ptu);
  assert.ok(hints.header_date.whereValueComesFrom.includes('09.02.2026'));
  assert.ok(hints.counterparty.whereValueComesFrom.includes('Альфа'));
  assert.ok(hints.amount_vat.actionIn1C.includes('НДС'));
  assert.ok(hints.footer_sf.actionIn1C.includes('УПД'));

  const steps = buildWalkthroughSteps1C(ptu);
  assert.equal(steps.length, 5);
  assert.equal(steps[4].targetSection, 'dt_kt');

  const basedOn = buildCreateBasedOnLinks1C(ptu, [ptu, bankOut]);
  assert.ok(basedOn.length >= 2);
  assert.equal(basedOn[0].existingLinkedOpId, 'op-bank-28');

  const regs = build1CRegistersImpact(ptu);
  assert.ok(regs.some((r) => r.registerName.includes('Хозрасчетный')));
  assert.ok(regs.some((r) => r.registerName.includes('НДС предъявленный')));
  assert.ok(regs.some((r) => r.registerName.includes('НДС Покупки')));
  assert.ok(regs.some((r) => r.registerName.includes('МПЗ')));
});
