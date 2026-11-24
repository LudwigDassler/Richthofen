import {
  DocType1CBP30,
  OperationCategory,
  QueuedOperation,
} from '@/types/accounting';
import { formatDateRu, formatMoney } from '@/lib/formatters';
import { getDocumentSpecForOperation } from './documentSpecs1C';

export type Taxi1CLayoutKind =
  | 'ptu'
  | 'rtu'
  | 'bank'
  | 'cash_ao'
  | 'materials_writeoff'
  | 'os_nma'
  | 'hr_payroll'
  | 'invoice_prod_vat'
  | 'manual_closing';

export type ReferenceEntityKind1C =
  | 'counterparty'
  | 'contract'
  | 'nomenclature'
  | 'warehouse'
  | 'employee'
  | 'fixed_asset'
  | 'rpb_97'
  | 'expense_item'
  | 'cash_flow_item';

export interface SmartFieldHint1C {
  key: string;
  label: string;
  whereValueComesFrom: string;
  provenanceSteps?: string[];
  actionIn1C: string;
  commonMistake: string;
  copyValue?: string;
}

export interface WalkthroughStep1C {
  stepNumber: number;
  shortTitle: string;
  targetSection: 'header' | 'counterparty' | 'table' | 'footer_sf' | 'dt_kt';
  autoHintKey: string;
  instructionSummary: string;
}

export interface RegisterImpactRow1C {
  id: string;
  movementSign: '+' | '−' | 'ℹ';
  registerName: string;
  registerKind: string;
  analytics: string;
  amountOrValue: string;
  explanation: string;
}

export interface CreateDocumentPreset1C {
  id: string;
  label: string;
  subLabel: string;
  docType1C: DocType1CBP30;
  category: OperationCategory;
  defaultSubKind1C: string;
  defaultVatRate: number;
  defaultVatRule: 'included' | 'on_top' | 'none';
  defaultHasInvoiceSF: boolean;
  defaultMaterialAccount?: string;
  defaultCostAccount?: string;
  defaultDescription: string;
}

export interface CreateMenuSection1C {
  sectionId: string;
  sectionTitle: string;
  items: CreateDocumentPreset1C[];
}

export interface CreateBasedOnOption1C {
  id: string;
  label: string;
  subLabel: string;
  targetDocType1C: DocType1CBP30;
  targetCategory: OperationCategory;
  existingLinkedOpId?: string;
  existingLinkedLabel?: string;
}

export const CREATE_MENU_1C_SECTIONS: CreateMenuSection1C[] = [
  {
    sectionId: 'purchases',
    sectionTitle: 'Покупки',
    items: [
      {
        id: 'ptu_materials',
        label: 'Поступление (акт, накладная, УПД) — Материалы',
        subLabel: 'Дт 10.01, 19.03 Кт 60.01',
        docType1C: 'ПоступлениеТоваровУслуг',
        category: 'purchase_materials',
        defaultSubKind1C: 'Товары (накладная, УПД)',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultMaterialAccount: '10.01',
        defaultDescription: 'Поступление материалов от поставщика',
      },
      {
        id: 'ptu_goods',
        label: 'Поступление (акт, накладная, УПД) — Товары',
        subLabel: 'Дт 41.01, 19.03 Кт 60.01',
        docType1C: 'ПоступлениеТоваровУслуг',
        category: 'purchase_goods',
        defaultSubKind1C: 'Товары (накладная, УПД)',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultMaterialAccount: '41.01',
        defaultDescription: 'Поступление товаров от поставщика',
      },
      {
        id: 'ptu_services',
        label: 'Поступление (акт, накладная, УПД) — Услуги',
        subLabel: 'Дт 26 / 20.01 / 44.01, 19.04 Кт 60.01',
        docType1C: 'ПоступлениеТоваровУслуг',
        category: 'purchase_services',
        defaultSubKind1C: 'Услуги (акт, УПД)',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultCostAccount: '26',
        defaultDescription: 'Оказаны услуги сторонней организацией',
      },
      {
        id: 'ptu_equipment',
        label: 'Поступление оборудования (08.04.1)',
        subLabel: 'Дт 08.04.1, 19.01 Кт 60.01',
        docType1C: 'ПоступлениеТоваровУслуг',
        category: 'purchase_equipment',
        defaultSubKind1C: 'Оборудование',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultMaterialAccount: '08.04.1',
        defaultDescription: 'Поступление объекта основных средств (оборудования)',
      },
    ],
  },
  {
    sectionId: 'sales',
    sectionTitle: 'Продажи',
    items: [
      {
        id: 'customer_invoice',
        label: 'Счет покупателю',
        subLabel: 'Выставлен счёт на оплату (без проводок)',
        docType1C: 'СчетПокупателю',
        category: 'customer_invoice',
        defaultSubKind1C: 'Счет на оплату покупателю',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Выставлен счет на оплату покупателю',
      },
      {
        id: 'rtu_goods',
        label: 'Реализация (акт, накладная, УПД) — Товары / Продукция',
        subLabel: 'Дт 62.01 Кт 90.01.1, Дт 90.03 Кт 68.02, Дт 90.02.1 Кт 41/43',
        docType1C: 'РеализацияТоваровУслуг',
        category: 'sale_goods',
        defaultSubKind1C: 'Товары (накладная, УПД)',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultMaterialAccount: '41.01',
        defaultDescription: 'Реализация товаров (готовой продукции) покупателю',
      },
      {
        id: 'rtu_services',
        label: 'Реализация (акт, накладная, УПД) — Услуги',
        subLabel: 'Дт 62.01 Кт 90.01.1, Дт 90.03 Кт 68.02',
        docType1C: 'РеализацияТоваровУслуг',
        category: 'sale_services',
        defaultSubKind1C: 'Услуги (акт, УПД)',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultDescription: 'Оказаны услуги заказчику',
      },
    ],
  },
  {
    sectionId: 'bank_cash',
    sectionTitle: 'Банк и касса',
    items: [
      {
        id: 'bank_in',
        label: 'Поступление на расчетный счет',
        subLabel: 'Дт 51 Кт 62.01 / 62.02 (оплата от покупателя)',
        docType1C: 'ПоступлениеНаРасчетныйСчет',
        category: 'bank_in',
        defaultSubKind1C: 'Оплата от покупателя',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Поступила оплата от покупателя на расчетный счет',
      },
      {
        id: 'bank_out',
        label: 'Списание с расчетного счета',
        subLabel: 'Дт 60.01 / 60.02 / 68 / 69 Кт 51',
        docType1C: 'СписаниеСРасчетногоСчета',
        category: 'bank_out',
        defaultSubKind1C: 'Оплата поставщику',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Перечислена оплата поставщику с расчетного счета',
      },
      {
        id: 'cash_in',
        label: 'Поступление наличных (ПКО)',
        subLabel: 'Дт 50.01 Кт 51 / 71.01 / 62.01',
        docType1C: 'ПоступлениеНаличных',
        category: 'cash_in',
        defaultSubKind1C: 'Прочий приход',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Приходный кассовый ордер',
      },
      {
        id: 'cash_out',
        label: 'Выдача наличных (РКО) — Подотчетнику',
        subLabel: 'Дт 71.01 Кт 50.01',
        docType1C: 'ВыдачаНаличных',
        category: 'accountable_issue',
        defaultSubKind1C: 'Выдача подотчетному лицу',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Выданы наличные из кассы под отчет сотруднику',
      },
      {
        id: 'advance_report',
        label: 'Авансовый отчет',
        subLabel: 'Дт 10.01 / 26, 19.03 Кт 71.01',
        docType1C: 'АвансовыйОтчет',
        category: 'expense_report',
        defaultSubKind1C: 'Авансовый отчет',
        defaultVatRate: 20,
        defaultVatRule: 'included',
        defaultHasInvoiceSF: true,
        defaultCostAccount: '26',
        defaultDescription: 'Утвержден авансовый отчет подотчетного лица',
      },
    ],
  },
  {
    sectionId: 'warehouse',
    sectionTitle: 'Склад и производство',
    items: [
      {
        id: 'materials_writeoff',
        label: 'Расход материалов (Требование-накладная)',
        subLabel: 'Дт 20.01 / 26 Кт 10.01 (по себестоимости 1С)',
        docType1C: 'РасходМатериалов',
        category: 'materials_writeoff',
        defaultSubKind1C: 'Использование материалов',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultMaterialAccount: '10.01',
        defaultCostAccount: '20.01',
        defaultDescription: 'Списаны материалы в основное производство',
      },
      {
        id: 'production_output',
        label: 'Отчет производства за смену (Выпуск продукции)',
        subLabel: 'Дт 43 Кт 20.01',
        docType1C: 'ВыпускПродукции',
        category: 'production_output',
        defaultSubKind1C: 'Выпуск продукции',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultMaterialAccount: '43',
        defaultCostAccount: '20.01',
        defaultDescription: 'Выпущена из производства готовая продукция на склад',
      },
    ],
  },
  {
    sectionId: 'os_nma',
    sectionTitle: 'ОС и НМА',
    items: [
      {
        id: 'os_commissioning',
        label: 'Принятие к учету ОС',
        subLabel: 'Дт 01.01 Кт 08.04.1 (ввод в эксплуатацию + СПИ)',
        docType1C: 'ПринятиеКУчетуОС',
        category: 'os_commissioning',
        defaultSubKind1C: 'Оборудование',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultCostAccount: '20.01',
        defaultDescription: 'Введен в эксплуатацию объект основных средств',
      },
    ],
  },
  {
    sectionId: 'payroll_hr',
    sectionTitle: 'Зарплата и кадры',
    items: [
      {
        id: 'hr_hire',
        label: 'Прием на работу',
        subLabel: 'Кадровый приказ (регистрация оклада и подразделения)',
        docType1C: 'ПриемНаРаботу',
        category: 'hr_hire',
        defaultSubKind1C: 'Прием на работу',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultCostAccount: '26',
        defaultDescription: 'Принят на работу сотрудник по трудовому договору',
      },
      {
        id: 'payroll_accrual',
        label: 'Начисление зарплаты и взносов',
        subLabel: 'Дт 20/26 Кт 70, Дт 70 Кт 68.01, Дт 20/26 Кт 69.09, 69.11',
        docType1C: 'НачислениеЗарплаты',
        category: 'payroll_accrual',
        defaultSubKind1C: 'Окончательный расчет за месяц',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultCostAccount: '26',
        defaultDescription: 'Начислена заработная плата, удержан НДФЛ и начислены взносы за месяц',
      },
    ],
  },
  {
    sectionId: 'operations_reg',
    sectionTitle: 'Операции',
    items: [
      {
        id: 'manual_op',
        label: 'Операция, введенная вручную',
        subLabel: 'Универсальный документ ОперацияБух (произвольные Дт/Кт)',
        docType1C: 'ОперацияБух',
        category: 'manual',
        defaultSubKind1C: 'Операция',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Бухгалтерская операция, введенная вручную',
      },
      {
        id: 'month_closing',
        label: 'Закрытие месяца (регламентная операция)',
        subLabel: 'Амортизация, списание 26/20, закрытие 90/91, налог на прибыль',
        docType1C: 'ЗакрытиеМесяца',
        category: 'closing',
        defaultSubKind1C: 'Закрытие месяца',
        defaultVatRate: 0,
        defaultVatRule: 'none',
        defaultHasInvoiceSF: false,
        defaultDescription: 'Регламентное закрытие месяца',
      },
    ],
  },
];

export function resolveTaxi1CLayoutKind(op: QueuedOperation): Taxi1CLayoutKind {
  const dt = op.docType1C;
  const cat = op.category;

  if (dt === 'ЗакрытиеМесяца' || cat === 'closing') {
    return 'manual_closing';
  }
  if (dt === 'ПоступлениеТоваровУслуг') {
    return 'ptu';
  }
  if (dt === 'РеализацияТоваровУслуг') {
    return 'rtu';
  }
  if (
    dt === 'СписаниеСРасчетногоСчета' ||
    dt === 'ПоступлениеНаРасчетныйСчет' ||
    dt === 'ОперацияПоПлатежнойКарте' ||
    cat === 'bank_in' ||
    cat === 'bank_out' ||
    cat === 'tax_payment' ||
    cat === 'bank_fee' ||
    cat === 'acquiring_receipt' ||
    cat === 'special_bank_55'
  ) {
    return 'bank';
  }
  if (
    dt === 'ВыдачаНаличных' ||
    dt === 'ПоступлениеНаличных' ||
    dt === 'АвансовыйОтчет' ||
    cat === 'cash_in' ||
    cat === 'cash_out' ||
    cat === 'accountable_issue' ||
    cat === 'accountable_return' ||
    cat === 'expense_report'
  ) {
    return 'cash_ao';
  }
  if (
    dt === 'РасходМатериалов' ||
    dt === 'ПередачаМатериаловВЭксплуатацию' ||
    dt === 'ПеремещениеТоваров' ||
    dt === 'ИнвентаризацияТоваров' ||
    cat === 'materials_writeoff' ||
    cat === 'workwear_issue' ||
    cat === 'warehouse_transfer' ||
    cat === 'inventory_result'
  ) {
    return 'materials_writeoff';
  }
  if (
    dt === 'ПринятиеКУчетуОС' ||
    dt === 'ПринятиеКУчетуНМА' ||
    dt === 'ПередачаОС' ||
    dt === 'СписаниеОС' ||
    cat === 'os_commissioning' ||
    cat === 'os_disposal' ||
    cat === 'intangible_commissioning'
  ) {
    return 'os_nma';
  }
  if (
    dt === 'ПриемНаРаботу' ||
    dt === 'НачислениеЗарплаты' ||
    dt === 'ИсполнительныйЛист' ||
    dt === 'ВедомостьВБанк' ||
    dt === 'ВедомостьВКассу' ||
    cat === 'hr_hire' ||
    cat === 'payroll_accrual' ||
    cat === 'payroll_payout' ||
    cat === 'writ_of_execution'
  ) {
    return 'hr_payroll';
  }
  if (
    dt === 'СчетПокупателю' ||
    dt === 'СчетОтПоставщика' ||
    dt === 'ВыпускПродукции' ||
    dt === 'СчетФактураВыданный' ||
    dt === 'СчетФактураПолученный' ||
    cat === 'customer_invoice' ||
    cat === 'supplier_invoice' ||
    cat === 'production_output' ||
    cat === 'advance_vat' ||
    cat === 'vat_deduction'
  ) {
    return 'invoice_prod_vat';
  }
  return 'manual_closing';
}

export function formatDocNumber1C(rawNum?: string): string {
  const clean = (rawNum || '').trim();
  if (!clean) return '0000-000001';
  if (/^\d{1,6}$/.test(clean)) {
    return `0000-${clean.padStart(6, '0')}`;
  }
  return clean;
}

export function build1CWindowTitle(op: QueuedOperation): {
  titleBase: string;
  docNumberFormatted: string;
  dateFormatted: string;
  statusLabel: string;
  fullTitle: string;
} {
  const titleMap: Partial<Record<DocType1CBP30, string>> = {
    ПоступлениеТоваровУслуг: 'Поступление (акт, накладная, УПД)',
    РеализацияТоваровУслуг: 'Реализация (акт, накладная, УПД)',
    ПоступлениеНаРасчетныйСчет: 'Поступление на расчетный счет',
    СписаниеСРасчетногоСчета: 'Списание с расчетного счета',
    ПоступлениеНаличных: 'Поступление наличных (ПКО)',
    ВыдачаНаличных: 'Выдача наличных (РКО)',
    АвансовыйОтчет: 'Авансовый отчет',
    РасходМатериалов: 'Расход материалов (Требование-накладная)',
    ПередачаМатериаловВЭксплуатацию: 'Передача материалов в эксплуатацию',
    ПринятиеКУчетуОС: 'Принятие к учету ОС',
    ПринятиеКУчетуНМА: 'Принятие к учету НМА',
    ПередачаОС: 'Передача ОС',
    СписаниеОС: 'Списание ОС',
    ВыпускПродукции: 'Отчет производства за смену',
    ПеремещениеТоваров: 'Перемещение товаров',
    ИнвентаризацияТоваров: 'Инвентаризация товаров',
    ОперацияПоПлатежнойКарте: 'Операция по платежной карте',
    СчетПокупателю: 'Счет покупателю',
    СчетОтПоставщика: 'Счет от поставщика',
    СчетФактураПолученный: 'Счет-фактура полученный',
    СчетФактураВыданный: 'Счет-фактура выданный (на аванс)',
    ПриемНаРаботу: 'Прием на работу',
    НачислениеЗарплаты: 'Начисление зарплаты и взносов',
    ИсполнительныйЛист: 'Исполнительный лист',
    ВедомостьВБанк: 'Ведомость в банк',
    ВедомостьВКассу: 'Ведомость в кассу',
    КорректировкаДолга: 'Корректировка долга',
    ФинансовыеВложения: 'Операция с финансовыми вложениями',
    ОперацияБух: 'Операция, введенная вручную',
    ЗакрытиеМесяца: 'Закрытие месяца (регламентная обработка)',
    ВводОстатков: 'Ввод начальных остатков',
  };

  const titleBase = titleMap[op.docType1C] || op.docType1C;
  const docNumberFormatted = formatDocNumber1C(op.docNumber);
  const dateFormatted = formatDateRu(op.date);
  const isNonPostingOrder =
    op.docType1C === 'СчетПокупателю' ||
    op.docType1C === 'СчетОтПоставщика' ||
    op.docType1C === 'ПриемНаРаботу' ||
    op.docType1C === 'ИсполнительныйЛист';

  const statusLabel = !op.includeInProcessing
    ? '(помечен / не проведен)'
    : isNonPostingOrder
      ? '(записан / проведен в регистрах)'
      : op.docType1C === 'ЗакрытиеМесяца'
        ? '(выполнено)'
        : '(проведен)';

  const fullTitle =
    op.docType1C === 'ЗакрытиеМесяца'
      ? `${titleBase} за ${dateFormatted} ${statusLabel}`
      : `${titleBase} ${docNumberFormatted} от ${dateFormatted} ${statusLabel}`;

  return {
    titleBase,
    docNumberFormatted,
    dateFormatted,
    statusLabel,
    fullTitle,
  };
}

export function build1CNavigationBreadcrumbs(op: QueuedOperation): {
  section: string;
  journal: string;
  operationKind: string;
} {
  const spec = getDocumentSpecForOperation(op);
  const parts = spec.menuPath1C
    .split(/→|▸|>/)
    .map((s) => s.trim())
    .filter(Boolean);
  const section = parts[0] || 'Операции';
  const journal = parts[1] || spec.label;
  const operationKind = op.documentSubKind1C || spec.documentKind1C || spec.label;
  return { section, journal, operationKind };
}

export function buildCreateBasedOnLinks1C(
  op: QueuedOperation,
  allOps: QueuedOperation[]
): CreateBasedOnOption1C[] {
  const out: CreateBasedOnOption1C[] = [];
  const cpLower = (op.counterpartyName || '').trim().toLowerCase();

  const findRelated = (
    predicate: (cand: QueuedOperation) => boolean
  ): QueuedOperation | undefined =>
    allOps.find(
      (cand) =>
        cand.id !== op.id &&
        cand.includeInProcessing &&
        predicate(cand)
    );

  if (op.docType1C === 'СчетПокупателю' || op.category === 'customer_invoice') {
    const linkedBank = findRelated(
      (c) =>
        c.docType1C === 'ПоступлениеНаРасчетныйСчет' &&
        Boolean(
          (cpLower && c.counterpartyName.toLowerCase().includes(cpLower)) ||
            c.linkedSourceOpIds?.includes(op.id)
        )
    );
    const linkedRtu = findRelated(
      (c) =>
        c.docType1C === 'РеализацияТоваровУслуг' &&
        Boolean(
          (cpLower && c.counterpartyName.toLowerCase().includes(cpLower)) ||
            c.linkedSourceOpIds?.includes(op.id)
        )
    );
    out.push({
      id: 'based_on_bank_in',
      label: 'Поступление на расчетный счет',
      subLabel: 'Отразить оплату по этому счету (Дт 51 Кт 62.01 / 62.02)',
      targetDocType1C: 'ПоступлениеНаРасчетныйСчет',
      targetCategory: 'bank_in',
      existingLinkedOpId: linkedBank?.id,
      existingLinkedLabel: linkedBank
        ? `№ ${linkedBank.docNumber || 'б/н'} от ${formatDateRu(linkedBank.date)}`
        : undefined,
    });
    out.push({
      id: 'based_on_rtu',
      label: 'Реализация (акт, накладная, УПД)',
      subLabel: 'Отгрузить товары или оказать услуги по счету',
      targetDocType1C: 'РеализацияТоваровУслуг',
      targetCategory: 'sale_goods',
      existingLinkedOpId: linkedRtu?.id,
      existingLinkedLabel: linkedRtu
        ? `№ ${linkedRtu.docNumber || 'б/н'} от ${formatDateRu(linkedRtu.date)}`
        : undefined,
    });
  } else if (op.docType1C === 'ПоступлениеТоваровУслуг') {
    const linkedPay = findRelated(
      (c) =>
        c.docType1C === 'СписаниеСРасчетногоСчета' &&
        Boolean(cpLower && c.counterpartyName.toLowerCase().includes(cpLower)) &&
        c.date >= op.date
    );
    out.push({
      id: 'based_on_bank_out',
      label: 'Списание с расчетного счета',
      subLabel: 'Оплатить поставщику по документу поступления (Дт 60.01 Кт 51)',
      targetDocType1C: 'СписаниеСРасчетногоСчета',
      targetCategory: 'bank_out',
      existingLinkedOpId: linkedPay?.id,
      existingLinkedLabel: linkedPay
        ? `№ ${linkedPay.docNumber || 'б/н'} от ${formatDateRu(linkedPay.date)}`
        : undefined,
    });

    if (op.category === 'purchase_equipment') {
      const linkedOs = findRelated((c) => c.docType1C === 'ПринятиеКУчетуОС');
      out.push({
        id: 'based_on_os_comm',
        label: 'Принятие к учету ОС',
        subLabel: 'Ввести оборудование со счёта 08.04.1 в эксплуатацию на 01.01',
        targetDocType1C: 'ПринятиеКУчетуОС',
        targetCategory: 'os_commissioning',
        existingLinkedOpId: linkedOs?.id,
        existingLinkedLabel: linkedOs
          ? `№ ${linkedOs.docNumber || 'б/н'} от ${formatDateRu(linkedOs.date)}`
          : undefined,
      });
    } else if (op.category === 'purchase_materials') {
      const linkedWriteoff = findRelated(
        (c) => c.docType1C === 'РасходМатериалов' && c.date >= op.date
      );
      out.push({
        id: 'based_on_mat_writeoff',
        label: 'Расход материалов (Требование-накладная)',
        subLabel: 'Передать поступившие материалы со склада в производство',
        targetDocType1C: 'РасходМатериалов',
        targetCategory: 'materials_writeoff',
        existingLinkedOpId: linkedWriteoff?.id,
        existingLinkedLabel: linkedWriteoff
          ? `№ ${linkedWriteoff.docNumber || 'б/н'} от ${formatDateRu(linkedWriteoff.date)}`
          : undefined,
      });
    }
  } else if (op.docType1C === 'РеализацияТоваровУслуг') {
    const linkedBankIn = findRelated(
      (c) =>
        c.docType1C === 'ПоступлениеНаРасчетныйСчет' &&
        Boolean(cpLower && c.counterpartyName.toLowerCase().includes(cpLower)) &&
        c.date >= op.date
    );
    out.push({
      id: 'based_on_bank_in_rtu',
      label: 'Поступление на расчетный счет',
      subLabel: 'Принять оплату от покупателя за отгрузку (Дт 51 Кт 62.01)',
      targetDocType1C: 'ПоступлениеНаРасчетныйСчет',
      targetCategory: 'bank_in',
      existingLinkedOpId: linkedBankIn?.id,
      existingLinkedLabel: linkedBankIn
        ? `№ ${linkedBankIn.docNumber || 'б/н'} от ${formatDateRu(linkedBankIn.date)}`
        : undefined,
    });
  } else if (op.docType1C === 'ПоступлениеНаРасчетныйСчет') {
    const linkedAdvVat = findRelated(
      (c) =>
        c.docType1C === 'СчетФактураВыданный' &&
        (c.linkedSourceOpIds?.includes(op.id) ||
          Boolean(cpLower && c.counterpartyName.toLowerCase().includes(cpLower)))
    );
    out.push({
      id: 'based_on_sf_advance',
      label: 'Счет-фактура выданный (на аванс)',
      subLabel: 'Начислить НДС с полученного аванса (Дт 76.АВ Кт 68.02)',
      targetDocType1C: 'СчетФактураВыданный',
      targetCategory: 'advance_vat',
      existingLinkedOpId: linkedAdvVat?.id,
      existingLinkedLabel: linkedAdvVat
        ? `№ ${linkedAdvVat.docNumber || 'б/н'} от ${formatDateRu(linkedAdvVat.date)}`
        : undefined,
    });
  } else if (op.docType1C === 'ВыдачаНаличных' && op.category === 'accountable_issue') {
    const linkedAo = findRelated(
      (c) => c.docType1C === 'АвансовыйОтчет' && c.date >= op.date
    );
    out.push({
      id: 'based_on_ao',
      label: 'Авансовый отчет',
      subLabel: 'Оформить отчет подотчетного лица по выданному авансу (Кт 71.01)',
      targetDocType1C: 'АвансовыйОтчет',
      targetCategory: 'expense_report',
      existingLinkedOpId: linkedAo?.id,
      existingLinkedLabel: linkedAo
        ? `№ ${linkedAo.docNumber || 'б/н'} от ${formatDateRu(linkedAo.date)}`
        : undefined,
    });
  } else if (op.docType1C === 'ВыпускПродукции') {
    const linkedSale = findRelated(
      (c) => c.docType1C === 'РеализацияТоваровУслуг' && c.date >= op.date
    );
    out.push({
      id: 'based_on_sale_prod',
      label: 'Реализация (акт, накладная, УПД)',
      subLabel: 'Реализовать выпущенную готовую продукцию со счёта 43',
      targetDocType1C: 'РеализацияТоваровУслуг',
      targetCategory: 'sale_goods',
      existingLinkedOpId: linkedSale?.id,
      existingLinkedLabel: linkedSale
        ? `№ ${linkedSale.docNumber || 'б/н'} от ${formatDateRu(linkedSale.date)}`
        : undefined,
    });
  } else if (op.docType1C === 'ПриемНаРаботу') {
    const linkedPayroll = findRelated(
      (c) => c.docType1C === 'НачислениеЗарплаты' && c.date >= op.date
    );
    out.push({
      id: 'based_on_payroll',
      label: 'Начисление зарплаты и взносов',
      subLabel: 'Рассчитать зарплату за месяц с учётом оклада по приказу',
      targetDocType1C: 'НачислениеЗарплаты',
      targetCategory: 'payroll_accrual',
      existingLinkedOpId: linkedPayroll?.id,
      existingLinkedLabel: linkedPayroll
        ? `№ ${linkedPayroll.docNumber || 'б/н'} от ${formatDateRu(linkedPayroll.date)}`
        : undefined,
    });
  } else if (op.docType1C === 'НачислениеЗарплаты') {
    out.push({
      id: 'based_on_pay_bank',
      label: 'Списание с расчетного счета (Выплата зарплаты)',
      subLabel: 'Перечислить зарплату по ведомости на карты (Дт 70 Кт 51)',
      targetDocType1C: 'СписаниеСРасчетногоСчета',
      targetCategory: 'payroll_payout',
    });
  }

  return out;
}

export function buildFieldHints1C(op: QueuedOperation): Record<string, SmartFieldHint1C> {
  const nav = build1CNavigationBreadcrumbs(op);
  const formattedDate = formatDateRu(op.date);
  const amountStr = formatMoney(op.amount, true);
  const vatStr = op.vatAmount ? formatMoney(op.vatAmount, true) : '0,00';

  const provenanceSummary =
    op.calculationProvenance ||
    op.amountCalculationNote ||
    op.resolverTrace?.summaryFormula ||
    `Из строки задания${op.sourceFileName ? ` (${op.sourceFileName})` : ''}: ${amountStr} ₽`;

  const provenanceSteps: string[] = [];
  if (op.resolverTrace?.resolverLevelName) {
    const lvlName = op.resolverTrace.resolverLevelName;
    provenanceSteps.push(
      lvlName.startsWith('Уровень')
        ? lvlName
        : `Уровень расчёта ${op.resolverTrace.resolverLevel}: ${lvlName}`
    );
  }
  if (op.resolverTrace?.steps && op.resolverTrace.steps.length > 0) {
    for (const stepText of op.resolverTrace.steps.slice(0, 3)) {
      if (stepText && stepText !== provenanceSummary) {
        provenanceSteps.push(stepText);
      }
    }
  } else if (op.stockSourceNote) {
    provenanceSteps.push(op.stockSourceNote);
  }

  const hints: Record<string, SmartFieldHint1C> = {
    header_date: {
      key: 'header_date',
      label: 'Дата, номер и вид операции',
      whereValueComesFrom: `Дата документа: ${formattedDate}, вх. № ${op.incomingDocNumber || op.docNumber || 'б/н'}. Раздел в 1С: «${nav.section} → ${nav.journal}».`,
      actionIn1C: `Создайте документ вида «${nav.operationKind}» строго датой ${formattedDate}. Входящий номер первички поставщика укажите в поле «Накладная, УПД №» / «Вх. номер».`,
      commonMistake:
        'Оставляют текущую рабочую дату компьютера вместо даты операции из задания — из-за этого сбиваются зачёт авансов (60.02/62.02) и списание партий со склада.',
      copyValue: formattedDate,
    },
    counterparty: {
      key: 'counterparty',
      label: 'Контрагент и договор',
      whereValueComesFrom: op.counterpartyName
        ? `Контрагент «${op.counterpartyName}»${op.counterpartyInn ? ` (ИНН ${op.counterpartyInn})` : ''}, договор «${op.contractName || 'Основной договор'}».`
        : 'Выбирается из справочника «Контрагенты» (или создаётся через карточку элемента справа от поля).',
      actionIn1C: `Выберите элемент справочника «Контрагенты» и проверьте вид договора («${op.category.startsWith('sale') || op.category === 'bank_in' || op.category === 'customer_invoice' ? 'С покупателем' : 'С поставщиком'}»). Нажмите кнопку открытия карточки справа от поля, чтобы сверить ИНН/КПП.`,
      commonMistake:
        'Создают дубль контрагента или выбирают «Прочий» вид договора — тогда 1С блокирует автоматический зачёт аванса по субсчетам 60.02 / 62.02.',
      copyValue: op.counterpartyName || undefined,
    },
    employee: {
      key: 'employee',
      label: 'Сотрудник / подотчётное лицо',
      whereValueComesFrom: op.employeeName
        ? `Сотрудник из задания / штата 1С: ${op.employeeName}${op.employeePosition ? ` (${op.employeePosition})` : ''}.`
        : 'Выбирается из справочника «Сотрудники» / «Физические лица».',
      actionIn1C:
        'Выберите сотрудника из справочника (кнопка со стрелкой) или откройте карточку сотрудника справа от поля для проверки должности, вычетов НДФЛ и счёта затрат (20.01 / 26 / 44.01).',
      commonMistake:
        'Путают справочники «Контрагенты» и «Физические лица» при выдаче под отчёт (71.01) или начислении зарплаты (70).',
      copyValue: op.employeeName || undefined,
    },
    amount_vat: {
      key: 'amount_vat',
      label: 'Сумма, цена и режим НДС',
      whereValueComesFrom: `${provenanceSummary}${op.vatRate > 0 ? ` · Ставка НДС ${op.vatRate}% (${op.vatRule === 'on_top' ? 'НДС сверху' : 'НДС в сумме'}), сумма НДС: ${vatStr} ₽.` : ' · Операция без НДС.'}`,
      provenanceSteps: provenanceSteps.length > 0 ? provenanceSteps : undefined,
      actionIn1C:
        op.docType1C === 'РасходМатериалов'
          ? 'В документе «Расход материалов» укажите ТОЛЬКО количество и счёт затрат (20.01 / 26) — сумму себестоимости 1С рассчитает сама по ФИФО / средней при проведении!'
          : op.vatRate > 0
            ? `Перед вводом цены проверьте синюю ссылку «${op.vatRule === 'on_top' ? `НДС сверху (${op.vatRate}%)` : `НДС в сумме (${op.vatRate}%)`}» над табличной частью.`
            : 'Убедитесь, что выбрано «Без НДС», и проверьте итоговую сумму и счёт учёта затрат/активов.',
      commonMistake:
        op.docType1C === 'РасходМатериалов'
          ? 'Пытаются искать колонку «Цена» в «Расходе материалов» или проводят списание через ручную «Операцию», ломая партионный регистр склада.'
          : 'Оставляют «НДС сверху», когда в задании дана сумма «в т.ч. НДС 20%» — сумма документа завышается ровно на 20%.',
      copyValue: op.amount > 0 ? String(op.amount) : undefined,
    },
    footer_sf: {
      key: 'footer_sf',
      label: 'УПД и регистрация счёта-фактуры',
      whereValueComesFrom: op.hasInvoiceSF
        ? `В первичном документе указан счёт-фактура / УПД № ${op.incomingDocNumber || op.docNumber || 'б/н'} от ${formattedDate}.`
        : 'Счёт-фактура не предъявлен или операция без НДС.',
      actionIn1C: op.hasInvoiceSF
        ? 'В подвале формы переключите тумблер «УПД» в зелёное положение (или нажмите «Зарегистрировать счет-фактуру»). Проверьте галочку «Отразить вычет НДС в книге покупок датой получения».'
        : 'Оставьте тумблер УПД выключенным и не регистрируйте счёт-фактуру.',
      commonMistake:
        'Проводят поступление с НДС на счёт 19.03/19.04, но забывают зарегистрировать счёт-фактуру внизу формы — НДС зависает на счёте 19 и не попадает в вычет (Дт 68.02 Кт 19).',
    },
    bank_confirmed: {
      key: 'bank_confirmed',
      label: 'Подтверждено выпиской банка',
      whereValueComesFrom: `Банковская выписка за ${formattedDate} по расчётному счёту организации (счёт 51).`,
      actionIn1C:
        'Обязательно установите флажок «Подтверждено выпиской банка» в правом верхнем углу документа и сверьте статью ДДС (для Отчёта о движении денежных средств).',
      commonMistake:
        'Снимают галочку «Подтверждено выпиской банка» — в 1С:БП 3.0 такой документ записывается, но даёт НОЛЬ проводок по счёту 51!',
    },
    dt_kt_check: {
      key: 'dt_kt_check',
      label: 'Проверка движений Дт/Кт и регистров',
      whereValueComesFrom: `Сформировано проводок: ${op.entries.length} шт. на оборот ${formatMoney(
        op.entries.filter((e) => !e.isOffBalance).reduce((s, e) => s + e.amount, 0),
        true
      )} ₽.`,
      actionIn1C:
        'После нажатия «Провести» откройте кнопку «Дт/Кт» в командной панели 1С и сверьте субсчета, субконто 1–3 и движения по регистрам с образцом.',
      commonMistake:
        'Включают «Ручную корректировку (разрешить редактирование движений)» в типовых документах без необходимости — тогда регламентное «Закрытие месяца» перестаёт видеть аналитику.',
    },
  };

  return hints;
}

export function buildWalkthroughSteps1C(op: QueuedOperation): WalkthroughStep1C[] {
  const layout = resolveTaxi1CLayoutKind(op);
  const nav = build1CNavigationBreadcrumbs(op);

  const step2Title =
    layout === 'hr_payroll' || layout === 'cash_ao'
      ? '2. Сотрудник и подразделение'
      : layout === 'materials_writeoff' || layout === 'os_nma'
        ? '2. Склад и счёт затрат'
        : '2. Контрагент и договор';

  const step2Hint =
    layout === 'hr_payroll' || layout === 'cash_ao'
      ? 'employee'
      : layout === 'bank'
        ? 'counterparty'
        : 'counterparty';

  const step4Title =
    layout === 'ptu' || layout === 'rtu'
      ? '4. СФ / УПД в подвале'
      : layout === 'bank'
        ? '4. Выписка и статья ДДС'
        : '4. Реквизиты и аналитика';

  const step4Hint =
    layout === 'ptu' || layout === 'rtu'
      ? 'footer_sf'
      : layout === 'bank'
        ? 'bank_confirmed'
        : 'amount_vat';

  return [
    {
      stepNumber: 1,
      shortTitle: '1. Раздел и шапка',
      targetSection: 'header',
      autoHintKey: 'header_date',
      instructionSummary: `Откройте раздел «${nav.section} → ${nav.journal}», создайте «${nav.operationKind}» и выставьте дату ${formatDateRu(op.date)}.`,
    },
    {
      stepNumber: 2,
      shortTitle: step2Title,
      targetSection: 'counterparty',
      autoHintKey: step2Hint,
      instructionSummary:
        layout === 'hr_payroll' || layout === 'cash_ao'
          ? 'Выберите сотрудника из справочника (при необходимости откройте его карточку кнопкой справа от поля).'
          : 'Выберите контрагента, проверьте договор и счета расчётов (зачёт авансов: Автоматически).',
    },
    {
      stepNumber: 3,
      shortTitle: '3. Табличная часть и НДС',
      targetSection: 'table',
      autoHintKey: 'amount_vat',
      instructionSummary:
        'Проверьте настройку цен/НДС, заполните номенклатуру, количество, цену и счета учёта.',
    },
    {
      stepNumber: 4,
      shortTitle: step4Title,
      targetSection: 'footer_sf',
      autoHintKey: step4Hint,
      instructionSummary:
        layout === 'ptu' || layout === 'rtu'
          ? 'Проверьте тумблер УПД / регистрацию счёта-фактуры для Книги покупок / Книги продаж.'
          : layout === 'bank'
            ? 'Убедитесь, что стоит флажок «Подтверждено выпиской банка» и заполнено назначение платежа.'
            : 'Проверьте аналитику субконто и основание документа перед проведением.',
    },
    {
      stepNumber: 5,
      shortTitle: '5. Проверка Дт/Кт',
      targetSection: 'dt_kt',
      autoHintKey: 'dt_kt_check',
      instructionSummary:
        'Нажмите «Провести» и сверьте проводки на вкладке «Дт/Кт» и влияние на регистры 1С.',
    },
  ];
}

export function build1CRegistersImpact(op: QueuedOperation): RegisterImpactRow1C[] {
  const rows: RegisterImpactRow1C[] = [];
  const amtFmt = `${formatMoney(op.amount, true)} ₽`;
  const vatFmt = `${formatMoney(op.vatAmount || 0, true)} ₽`;

  // 1. Хозрасчетный (Журнал проводок БУ и НУ)
  if (op.entries.length > 0) {
    const corrList = op.entries
      .slice(0, 4)
      .map((e) => (e.isOffBalance ? `Забаланс ${e.debit || e.credit}` : `Дт ${e.debit} Кт ${e.credit}`))
      .join(', ');
    rows.push({
      id: 'reg-hozraschetny',
      movementSign: '+',
      registerName: 'Регистр бухгалтерии «Хозрасчетный»',
      registerKind: 'Бухгалтерский и налоговый учет (ОСНО)',
      analytics: corrList,
      amountOrValue: `${op.entries.length} пров.`,
      explanation:
        'Формирует обороты и сальдо в Оборотно-сальдовой ведомости (ОСВ), Балансе и Отчёте о финансовых результатах.',
    });
  } else {
    rows.push({
      id: 'reg-no-hoz',
      movementSign: 'ℹ',
      registerName: 'Регистр бухгалтерии «Хозрасчетный»',
      registerKind: 'Без бухгалтерских проводок в момент записи',
      analytics: op.docType1C,
      amountOrValue: '0,00 ₽',
      explanation:
        'В 1С:БП 3.0 счёта на оплату и кадровые приказы не делают проводок сразу, но записывают параметры для следующих документов цепочки.',
    });
  }

  // 2. НДС Предъявленный / НДС Покупки / НДС Продажи
  if (op.docType1C === 'ПоступлениеТоваровУслуг' && op.vatRate > 0) {
    rows.push({
      id: 'reg-nds-pred',
      movementSign: '+',
      registerName: 'Регистр накопления «НДС предъявленный»',
      registerKind: 'Учет входящего НДС (счёт 19)',
      analytics: `${op.counterpartyName || 'Поставщик'} · СФ № ${op.incomingDocNumber || op.docNumber || 'б/н'}`,
      amountOrValue: vatFmt,
      explanation:
        'Фиксирует право на налоговый вычет НДС от поставщика.',
    });
    if (op.hasInvoiceSF) {
      rows.push({
        id: 'reg-nds-pokupki',
        movementSign: '−',
        registerName: 'Регистр накопления «НДС Покупки»',
        registerKind: 'Книга покупок (Раздел 8 декларации по НДС)',
        analytics: `Код вида операции 01 · Дт 68.02 Кт 19`,
        amountOrValue: vatFmt,
        explanation:
          'Автоматически переносит входной НДС в Книгу покупок и уменьшает налог к уплате в бюджет (счёт 68.02).',
      });
    }
  }

  if (
    (op.docType1C === 'РеализацияТоваровУслуг' || op.docType1C === 'СчетФактураВыданный') &&
    op.vatRate > 0
  ) {
    rows.push({
      id: 'reg-nds-prodazhi',
      movementSign: '+',
      registerName: 'Регистр накопления «НДС Продажи»',
      registerKind: 'Книга продаж (Раздел 9 декларации по НДС)',
      analytics: `${op.counterpartyName || 'Покупатель'} · Код ${op.docType1C === 'СчетФактураВыданный' ? '02 (аванс)' : '01 (реализация)'}`,
      amountOrValue: vatFmt,
      explanation:
        'Формирует запись Книги продаж и начисляет НДС к уплате в бюджет по кредиту 68.02.',
    });
  }

  // 3. Партионный / количественный складской учёт МПЗ
  if (
    op.category === 'purchase_materials' ||
    op.category === 'purchase_goods' ||
    op.category === 'materials_writeoff' ||
    op.category === 'production_output' ||
    op.category === 'sale_goods'
  ) {
    const isOut =
      op.category === 'materials_writeoff' || op.category === 'sale_goods';
    rows.push({
      id: 'reg-mpz-fifo',
      movementSign: isOut ? '−' : '+',
      registerName: 'Партионный и количественный учёт МПЗ (счета 10 / 41 / 43)',
      registerKind: 'Складской учёт запасов (ФСБУ 5/2019)',
      analytics: `${op.warehouseName || 'Основной склад'} · ${op.nomenclatureName || 'Номенклатура'} (${op.quantity || 1} ед.)`,
      amountOrValue: amtFmt,
      explanation: isOut
        ? 'Списывает количество и себестоимость со склада по методу учётной политики (ФИФО / по средней).'
        : 'Приходует партию ТМЦ на склад (без НДС) для последующего списания в производство или реализации.',
    });
  }

  // 4. Регистры сведений по ОС / РБП / Кадрам
  if (op.docType1C === 'ПринятиеКУчетуОС' || op.category === 'os_commissioning') {
    const spi = op.usefulLifeMonths || 60;
    const monthlyDepr = op.amount > 0 ? Math.round((op.amount / spi) * 100) / 100 : 0;
    rows.push({
      id: 'reg-os-params',
      movementSign: 'ℹ',
      registerName: 'Регистры сведений «Параметры амортизации ОС (БУ и НУ)»',
      registerKind: 'ФСБУ 6/2020 · Линейный способ',
      analytics: `СПИ: ${spi} мес. · Счёт затрат: ${op.costAccount || '20.01'}`,
      amountOrValue: `${formatMoney(monthlyDepr, true)} ₽/мес`,
      explanation:
        'Со следующего месяца обработка «Закрытие месяца» автоматически начисляет амортизацию Дт 20/26 Кт 02.01.',
    });
  }

  if (op.category === 'deferred_expense_97' || op.entries.some((e) => e.debit.startsWith('97'))) {
    rows.push({
      id: 'reg-rpb-97',
      movementSign: 'ℹ',
      registerName: 'Справочник / Регистр параметров списания «Расходы будущих периодов»',
      registerKind: 'Счёт 97.21 · Равномерное признание расходов',
      analytics: `Срок: ${op.rpbTermMonths || 12} мес. (${op.rpbWriteOffMethod === 'monthly' ? 'по месяцам' : 'по календарным дням'})`,
      amountOrValue: amtFmt,
      explanation:
        'Ежемесячно в «Закрытии месяца» списывает долю РБП со счёта 97.21 на счета затрат (20.01 / 26 / 44.01).',
    });
  }

  if (
    op.docType1C === 'ПриемНаРаботу' ||
    op.docType1C === 'НачислениеЗарплаты' ||
    op.category === 'hr_hire' ||
    op.category === 'payroll_accrual'
  ) {
    rows.push({
      id: 'reg-zarplata-ndfl',
      movementSign: op.docType1C === 'ПриемНаРаботу' ? 'ℹ' : '+',
      registerName:
        op.docType1C === 'ПриемНаРаботу'
          ? 'Регистры сведений «Кадровая история» и «Плановые начисления»'
          : 'Регистры накопления «Взаиморасчеты с сотрудниками», «Учет доходов для НДФЛ», «Страховые взносы»',
      registerKind: 'Кадровый учет, 6-НДФЛ и РСВ',
      analytics: `${op.employeeName || 'Штат сотрудников'} · Счёт затрат ${op.costAccount || '26'}`,
      amountOrValue:
        op.docType1C === 'ПриемНаРаботу'
          ? `${formatMoney(op.monthlySalary || op.amount, true)} ₽/мес`
          : amtFmt,
      explanation:
        op.docType1C === 'ПриемНаРаботу'
          ? 'Регистрирует плановый оклад и подразделение сотрудника, чтобы «Начисление зарплаты» заполнилось по кнопке «Заполнить».'
          : 'Формирует базу для ведомостей на выплату, расчёта 6-НДФЛ (с вычетами на детей ст. 218 НК РФ) и РСВ (30% + травматизм).',
    });
  }

  return rows;
}
