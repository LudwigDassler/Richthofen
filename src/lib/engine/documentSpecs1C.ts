import {
  DocType1CBP30,
  DocumentSpec1C,
  OperationCardProfile,
  OperationCategory,
  QueuedOperation,
} from '@/types/accounting';

/**
 * Invariant 1: Single Source of Truth Registry (`DOCUMENT_SPECS`) for 1С:Бухгалтерия 8.3 (ред. 3.0).
 * Every module in the codebase (postingEngine, mentorGuide1C, auditAndAutofix, export1c, Tab2, Tab3)
 * MUST derive document metadata, 1C navigation paths, counterparty/individual requirements,
 * zero-posting allowances, VAT policies, default subaccounts, and BSL export mappings from here.
 */

function makeSpec(spec: DocumentSpec1C): DocumentSpec1C {
  return spec;
}

export const DOCUMENT_SPECS: Record<OperationCategory, DocumentSpec1C> = {
  customer_invoice: makeSpec({
    docType: 'СчетПокупателю',
    category: 'customer_invoice',
    label: '1С: Счёт покупателю (на оплату, без проводок)',
    uiProfile: 'trade_services',
    menuPath1C: 'Продажи → Счета покупателям → кнопка «Создать»',
    documentKind1C: 'Счёт покупателю на оплату (проводок не формирует, основание для Реализации и Поступления на р/с)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: { debit: '', credit: '' },
    auditGuidanceTemplate: {
      repostInstruction: 'Запишите и проведите «Счёт покупателю» (кнопка «Провести и закрыть»)',
      verifyInOsv: 'Продажи → Счета покупателям (проводок в ОСВ не формирует до отгрузки или оплаты)',
      defaultCheckPoints: [
        'Проверьте покупателя, договор с покупателем, сумму счёта и ставку НДС',
        'При отгрузке нажмите «Создать на основании → Реализация (акт, накладная, УПД)»',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  supplier_invoice: makeSpec({
    docType: 'СчетОтПоставщика',
    category: 'supplier_invoice',
    label: '1С: Счёт от поставщика (на оплату, без проводок)',
    uiProfile: 'trade_services',
    menuPath1C: 'Покупки → Счета от поставщиков → кнопка «Создать»',
    documentKind1C: 'Счёт от поставщика на оплату (проводок не формирует, основание для Оплаты и Поступления)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: { debit: '', credit: '' },
    auditGuidanceTemplate: {
      repostInstruction: 'Запишите «Счёт от поставщика» (кнопка «Записать и закрыть»)',
      verifyInOsv: 'Покупки → Счета от поставщиков (проводок в ОСВ не формирует до оплаты или поступления)',
      defaultCheckPoints: [
        'Проверьте поставщика, договор с поставщиком, сумму счёта и ставку НДС',
        'При оплате нажмите «Создать на основании → Списание с расчётного счёта»',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  contract_event: makeSpec({
    docType: 'ОперацияБух',
    category: 'contract_event',
    label: 'Регистрация договора (Справочники → Договоры)',
    uiProfile: 'trade_services',
    menuPath1C: 'Справочники → Покупки и продажи → Договоры (или из карточки Контрагента)',
    documentKind1C: 'Элемент справочника «Договоры» (без бухгалтерских проводок)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'forbidden',
    defaultSubaccounts: { debit: '', credit: '' },
    auditGuidanceTemplate: {
      repostInstruction: 'Запишите карточку договора по кнопке «Записать и закрыть»',
      verifyInOsv: 'Справочники → Контрагенты → Договоры (проводок в ОСВ не формирует)',
      defaultCheckPoints: [
        'Проверьте Вид договора (С поставщиком / С покупателем / Прочее)',
        'Укажите номер и дату заключённого договора для последующих актов и оплат',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  policy_event: makeSpec({
    docType: 'ОперацияБух',
    category: 'policy_event',
    label: 'Учётная политика / организационный приказ (без проводок)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'Главное → Настройки → Учетная политика (или Налоги и отчеты)',
    documentKind1C: 'Настройка регистра сведений «Учетная политика» (без проводок)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'forbidden',
    defaultSubaccounts: { debit: '', credit: '' },
    auditGuidanceTemplate: {
      repostInstruction: 'Сохраните настройки учётной политики с начала отчётного периода',
      verifyInOsv: 'Главное → Учетная политика (проводок в ОСВ не формирует)',
      defaultCheckPoints: [
        'Проверьте систему налогообложения (ОСНО) и способ списания счёта 26 (Директ-костинг → 90.08.1)',
        'Проверьте способ оценки МПЗ (ФИФО или по средней себестоимости)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  purchase_goods: makeSpec({
    docType: 'ПоступлениеТоваровУслуг',
    category: 'purchase_goods',
    label: '1С: Поступление (Товары — накладная / УПД)',
    uiProfile: 'trade_services',
    menuPath1C: 'Покупки → Поступление (акты, накладные, УПД) → Товары (накладная, УПД)',
    documentKind1C: 'Поступление товаров (накладная, УПД)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'standard_included_20',
    defaultSubaccounts: {
      debit: '41.01',
      credit: '60.01',
      vatAccount: '19.03',
      advanceAccount: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Зарегистрируйте счёт-фактуру в подвале документа (или включите переключатель «УПД») и нажмите «Провести и закрыть»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 41.01, 19.03 и 60',
      defaultCheckPoints: [
        'Проверьте контрагента-поставщика, договор «С поставщиком» и склад оприходования',
        'Проверьте счета учёта в табличной части: 41.01 и счёт НДС 19.03',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'purchase_ptu',
  }),

  purchase_materials: makeSpec({
    docType: 'ПоступлениеТоваровУслуг',
    category: 'purchase_materials',
    label: '1С: Поступление (Материалы — накладная / УПД)',
    uiProfile: 'trade_services',
    menuPath1C: 'Покупки → Поступление (акты, накладные, УПД) → Материалы (накладная, УПД)',
    documentKind1C: 'Поступление материалов и инвентаря (накладная, УПД)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'standard_included_20',
    defaultSubaccounts: {
      debit: '10.01',
      credit: '60.01',
      vatAccount: '19.03',
      advanceAccount: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Зарегистрируйте счёт-фактуру поставщика (или УПД) и нажмите «Провести и закрыть»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 10, 19.03 и 60',
      defaultCheckPoints: [
        'Убедитесь, что в карточке номенклатуры установлен вид «Материалы» (счёт 10.01 / 10.08 / 10.10)',
        'Проверьте контрагента, договор «С поставщиком» и склад хранения',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'purchase_ptu',
  }),

  purchase_equipment: makeSpec({
    docType: 'ПоступлениеТоваровУслуг',
    category: 'purchase_equipment',
    label: '1С: Поступление оборудования (счёт 08.04.1)',
    uiProfile: 'trade_services',
    menuPath1C: 'ОС и НМА → Поступление основных средств → Поступление оборудования',
    documentKind1C: 'Поступление оборудования (вложения во внеоборотные активы 08.04.1)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'standard_included_20',
    defaultSubaccounts: {
      debit: '08.04.1',
      credit: '60.01',
      vatAccount: '19.01',
      advanceAccount: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Зарегистрируйте счёт-фактуру для счёта 19.01 и проведите документ перед вводом в эксплуатацию',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 08.04.1, 19.01 и 60',
      defaultCheckPoints: [
        'Проверьте вкладку «Оборудование»: счёт учёта 08.04.1 и счёт НДС 19.01',
        'После проведения оформите «Принятие к учету ОС» для переноса с 08.04.1 на 01.01',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: true,
    },
    exportBslKind: 'purchase_ptu',
  }),

  purchase_services: makeSpec({
    docType: 'ПоступлениеТоваровУслуг',
    category: 'purchase_services',
    label: '1С: Поступление (Услуги — акт / УПД)',
    uiProfile: 'trade_services',
    menuPath1C: 'Покупки → Поступление (акты, накладные, УПД) → Услуги (акт, УПД)',
    documentKind1C: 'Поступление услуг (акт, УПД)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'standard_included_20',
    defaultSubaccounts: {
      debit: '26',
      credit: '60.01',
      vatAccount: '19.04',
      advanceAccount: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проверьте счёт затрат (20.01 / 25 / 26 / 44.01), зарегистрируйте счёт-фактуру и нажмите «Провести и закрыть»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 20/26/44.01, 19.04 и 60',
      defaultCheckPoints: [
        'Проверьте поставщика услуг и договор с видом «С поставщиком»',
        'Откройте гиперссылку в колонке «Счета учета» и проверьте счёт затрат (26 / 20.01 / 44.01) и статью затрат',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'purchase_ptu',
  }),

  sale_goods: makeSpec({
    docType: 'РеализацияТоваровУслуг',
    category: 'sale_goods',
    label: '1С: Реализация (Товары и продукция — накладная / УПД)',
    uiProfile: 'trade_services',
    menuPath1C: 'Продажи → Реализация (акты, накладные, УПД) → Товары (накладная, УПД)',
    documentKind1C: 'Реализация товаров и готовой продукции (накладная, УПД)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'standard_included_20',
    defaultSubaccounts: {
      debit: '62.01',
      credit: '90.01.1',
      vatAccount: '90.03',
      advanceAccount: '62.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Нажмите «Выписать счет-фактуру» в подвале документа (или включите «УПД») и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 62, 90.01.1, 90.02.1, 90.03 и 41.01/43',
      defaultCheckPoints: [
        'Проверьте покупателя, договор с видом «С покупателем» и склад отгрузки',
        'Проверьте правило расчёта НДС («НДС в сумме» либо «НДС сверху», если указана цена без НДС)',
        'Убедитесь, что товар/продукция оприходованы хронологически раньше момента отгрузки',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'sale_rtu',
  }),

  sale_services: makeSpec({
    docType: 'РеализацияТоваровУслуг',
    category: 'sale_services',
    label: '1С: Реализация (Услуги и работы — акт / УПД)',
    uiProfile: 'trade_services',
    menuPath1C: 'Продажи → Реализация (акты, накладные, УПД) → Услуги (акт, УПД)',
    documentKind1C: 'Реализация услуг и выполненных работ (акт, УПД)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'standard_included_20',
    defaultSubaccounts: {
      debit: '62.01',
      credit: '90.01.1',
      vatAccount: '90.03',
      advanceAccount: '62.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Нажмите «Выписать счет-фактуру» (или включите «УПД») и проведите акт оказанных услуг',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 62, 90.01.1 и 90.03',
      defaultCheckPoints: [
        'Проверьте покупателя и договор с видом «С покупателем»',
        'Проверьте номенклатурную группу выручки (субконто счёта 90.01.1) для совпадения со счётом 20.01',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'sale_rtu',
  }),

  bank_out: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'bank_out',
    label: '1С: Списание с расчётного счёта (оплата поставщику)',
    uiProfile: 'trade_services',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → кнопка «Списание»',
    documentKind1C: 'Оплата поставщику (Списание с расчётного счёта)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '60.01',
      credit: '51',
      advanceAccount: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Установите флажок «Подтверждено выпиской банка» и нажмите «Провести и закрыть»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 51 и 60 (60.01 / 60.02)',
      defaultCheckPoints: [
        'Проверьте Вид операции = «Оплата поставщику», получателя и договор',
        'Проверьте Погашение задолженности = «Автоматически» (счета расчётов 60.01 и авансов 60.02)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  bank_in: makeSpec({
    docType: 'ПоступлениеНаРасчетныйСчет',
    category: 'bank_in',
    label: '1С: Поступление на расчётный счёт (оплата от покупателя)',
    uiProfile: 'trade_services',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → кнопка «Поступление»',
    documentKind1C: 'Оплата от покупателя (Поступление на расчётный счёт)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '51',
      credit: '62.01',
      advanceAccount: '62.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите банковское поступление; при получении предоплаты зарегистрируйте счёт-фактуру на аванс (76.АВ)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 51 и 62 (62.01 / 62.02)',
      defaultCheckPoints: [
        'Проверьте Вид операции = «Оплата от покупателя», плательщика и договор «С покупателем»',
        'Проверьте счёт расчётов 62.01 и счёт авансов 62.02 (режим «Погашать задолженность автоматически»)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_in',
  }),

  materials_writeoff: makeSpec({
    docType: 'РасходМатериалов',
    category: 'materials_writeoff',
    label: '1С: Расход материалов (Требование-накладная)',
    uiProfile: 'warehouse_production',
    menuPath1C: 'Склад → Расход материалов (Требования-накладные)',
    documentKind1C: 'Использование материалов (Передача материалов в производство)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '20.01',
      credit: '10.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите «Расход материалов» — себестоимость спишется со счёта 10 без НДС по партиям/средней',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 10 и 20.01 / 25 / 26',
      defaultCheckPoints: [
        'В документе указывается только номенклатура и количество (контрагент и НДС отсутствуют)',
        'На вкладке «Счет затрат» проверьте счёт 20.01 / 25 / 26, номенклатурную группу и статью затрат «Материальные расходы»',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'materials_writeoff',
  }),

  workwear_issue: makeSpec({
    docType: 'ПередачаМатериаловВЭксплуатацию',
    category: 'workwear_issue',
    label: '1С: Передача материалов в эксплуатацию (спецодежда / инвентарь)',
    uiProfile: 'warehouse_production',
    menuPath1C: 'Склад → Спецодежда и инвентарь → Передача материалов в эксплуатацию (или Расход материалов)',
    documentKind1C: 'Передача спецодежды и инвентаря в эксплуатацию (закрепление за МОЛ на МЦ)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '20.01',
      credit: '10.10',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите документ — стоимость спишется в расходы без НДС, а количество встанет на забалансовый счёт МЦ.02 / МЦ.04',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 10.10 / 10.09, 20.01 и забалансовому МЦ.02 / МЦ.04',
      defaultCheckPoints: [
        'Укажите склад выдачи, номенклатуру, количество и физическое лицо (сотрудника — МОЛ)',
        'Проверьте способ отражения расходов (Дт 20.01 / 25 / 26) и постановку на забалансовый учёт МЦ',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'workwear_issue',
  }),

  os_commissioning: makeSpec({
    docType: 'ПринятиеКУчетуОС',
    category: 'os_commissioning',
    label: '1С: Принятие к учёту ОС (ввод в эксплуатацию 08.04.1 → 01.01)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'ОС и НМА → Поступление основных средств → Принятие к учету ОС',
    documentKind1C: 'Оборудование (Ввод основного средства в эксплуатацию)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '01.01',
      credit: '08.04.1',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите срок полезного использования (СПИ в месяцах), установите флажок «Начислять амортизацию» и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 08.04.1 и 01.01',
      defaultCheckPoints: [
        'На вкладке «Внеоборотный актив» выберите оборудование на счёте 08.04.1 и склад',
        'На вкладках БУ и НУ укажите линейный способ и СПИ в месяцах (амортизация начнётся со следующего месяца)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: true,
    },
    exportBslKind: 'os_commissioning',
  }),

  os_disposal: makeSpec({
    docType: 'ПередачаОС',
    category: 'os_disposal',
    label: '1С: Передача / Списание ОС (выбытие через 01.09)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'ОС и НМА → Выбытие основных средств → Передача ОС (или Списание ОС)',
    documentKind1C: 'Реализация или списание объекта основных средств (счёт 01.09)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '01.09',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите документ выбытия ОС — первоначальная стоимость и накопленная амортизация закроются через счёт 01.09, а остаточная стоимость спишется в Дт 91.02',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 01.01, 01.09, 02.01 и 91',
      defaultCheckPoints: [
        'Проверьте списание первоначальной стоимости (Дт 01.09 Кт 01.01) и накопленной амортизации (Дт 02.01 Кт 01.09)',
        'При продаже ОС проверьте выручку Дт 62.01 Кт 91.01 и НДС Дт 91.02 Кт 68.02',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: true,
    },
    exportBslKind: 'manual_operation',
  }),

  intangible_acquisition: makeSpec({
    docType: 'ПоступлениеТоваровУслуг',
    category: 'intangible_acquisition',
    label: '1С: Поступление НМА (счёт 08.05)',
    uiProfile: 'trade_services',
    menuPath1C: 'ОС и НМА → Нематериальные активы → Поступление НМА',
    documentKind1C: 'Поступление нематериальных активов (вложения на счёт 08.05)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '08.05',
      credit: '60.01',
      vatAccount: '19.02',
      advanceAccount: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите «Поступление НМА» и при наличии счёта-фактуры зарегистрируйте НДС на счёте 19.02',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 08.05, 19.02 и 60',
      defaultCheckPoints: [
        'Проверьте правообладателя (поставщика), договор и карточку объекта в справочнике «Нематериальные активы»',
        'Проверьте счёт вложений 08.05 (при освобождении по пп. 26 п. 2 ст. 149 НК РФ — «Без НДС»)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'purchase_ptu',
  }),

  intangible_commissioning: makeSpec({
    docType: 'ПринятиеКУчетуНМА',
    category: 'intangible_commissioning',
    label: '1С: Принятие к учёту НМА (08.05 → 04.01)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'ОС и НМА → Нематериальные активы → Принятие к учету НМА',
    documentKind1C: 'Принятие к учёту нематериального актива (счёт 04.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '04.01',
      credit: '08.05',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Заполните СПИ нематериального актива, счёт начисления амортизации 05 и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 08.05 и 04.01',
      defaultCheckPoints: [
        'Проверьте перенос сформированной стоимости с кредита 08.05 в дебет 04.01',
        'Укажите линейный способ амортизации на счёте 05 и СПИ в месяцах',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  intangible_amortization: makeSpec({
    docType: 'ЗакрытиеМесяца',
    category: 'intangible_amortization',
    label: '1С: Амортизация НМА (счёт 05)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'Операции → Закрытие периода → Закрытие месяца → Регламентная операция «Амортизация НМА и списание расходов по НИОКР»',
    documentKind1C: 'Регламентная операция «Амортизация НМА» (счёт 05)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '26',
      credit: '05',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выполните регламентную операцию «Амортизация НМА» в обработке «Закрытие месяца»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 04.01, 05 и 20.01/26/44.01',
      defaultCheckPoints: [
        'Проверьте ежемесячную норму амортизации НМА (первоначальная стоимость 04.01 / СПИ)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  production_output: makeSpec({
    docType: 'ВыпускПродукции',
    category: 'production_output',
    label: '1С: Выпуск продукции (Отчёт производства за смену)',
    uiProfile: 'warehouse_production',
    menuPath1C: 'Производство → Выпуск продукции (Отчеты производства за смену)',
    documentKind1C: 'Отчёт производства за смену (оприходование продукции Дт 43 Кт 20.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '43',
      credit: '20.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите «Выпуск продукции» — при закрытии месяца 1С скорректирует плановую себестоимость до фактической',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 43 и 20.01',
      defaultCheckPoints: [
        'Укажите склад готовой продукции, счёт затрат 20.01 и номенклатурную группу выпуска',
        'Контрагент и НДС во внутреннем выпуске продукции не заполняются',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'production_output',
  }),

  warehouse_transfer: makeSpec({
    docType: 'ПеремещениеТоваров',
    category: 'warehouse_transfer',
    label: '1С: Перемещение товаров / материалов между складами',
    uiProfile: 'warehouse_production',
    menuPath1C: 'Склад → Перемещение товаров, материалов',
    documentKind1C: 'Внутреннее перемещение ТМЦ между складами',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '10.01',
      credit: '10.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите Склад-отправитель и Склад-получатель и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 10 / 41 (с группировкой по складам)',
      defaultCheckPoints: [
        'Проверьте аналитику складов отправителя и получателя (контрагент и НДС не участвуют)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'warehouse_transfer',
  }),

  inventory_result: makeSpec({
    docType: 'ИнвентаризацияТоваров',
    category: 'inventory_result',
    label: '1С: Инвентаризация ТМЦ (списание недостач 94 / оприходование излишков)',
    uiProfile: 'warehouse_production',
    menuPath1C: 'Склад → Инвентаризация → Инвентаризация товаров (далее Списание товаров / Оприходование товаров)',
    documentKind1C: 'Инвентаризация ТМЦ (отражение недостач на счёте 94 или излишков на счёте 91.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '94',
      credit: '10.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'На основании «Инвентаризации товаров» введите «Списание товаров» (Дт 94) или «Оприходование товаров» (Кт 91.01)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 94, 10/41, 73.02 и 91',
      defaultCheckPoints: [
        'Недостача отражается по себестоимости в Дт 94 Кт 10/41, затем закрывается в Дт 91.02 (в пределах норм / при отсутствии виновных) или Дт 73.02 (на виновное лицо)',
        'Излишки ТМЦ приходуются по рыночной стоимости проводкой Дт 10/41 Кт 91.01',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  cash_bank_internal: makeSpec({
    docType: 'ПоступлениеНаличных',
    category: 'cash_bank_internal',
    label: '1С: Касса ↔ Расчётный счёт (Снятие по чеку / Взнос наличными)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Касса → Кассовые документы → кнопка «Поступление» (ПКО) или «Выдача» (РКО)',
    documentKind1C: 'Получение наличных в банке / Взнос наличными в банк (единый кассовый ордер)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '50.01',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите только кассовый ордер (ПКО или РКО) — банковскую выписку в 1С проводить НЕ нужно во избежание задвоения оборота 50.01—51',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 50.01 и 51',
      defaultCheckPoints: [
        'Для снятия наличных по чеку выберите ПКО с видом «Получение наличных в банке» (Дт 50.01 Кт 51)',
        'Для сдачи выручки в банк выберите РКО с видом «Взнос наличными в банк» (Дт 51 Кт 50.01; либо через 57.01 при инкассации)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'cash_in',
  }),

  acquiring_receipt: makeSpec({
    docType: 'ПоступлениеНаРасчетныйСчет',
    category: 'acquiring_receipt',
    label: '1С: Эквайринг / зачисление выручки по платёжным картам (счёт 57.03)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Поступление (Вид операции: Поступление от продаж по платежным картам)',
    documentKind1C: 'Поступление от продаж по платёжным картам и банковским кредитам (эквайринг)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '51',
      credit: '57.03',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите сумму зачисления на счёт 51 и сумму комиссии банка-эквайера (Дт 91.02 Кт 57.03) и проведите выписку',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 51, 57.03 и 91.02',
      defaultCheckPoints: [
        'Оплата картой покупателя отражается документом «Операция по платежной карте» (Дт 57.03 Кт 62.01 / 90.01.1)',
        'Зачисление от банка закрывает счёт 57.03: Дт 51 Кт 57.03 (нетто) и Дт 91.02 Кт 57.03 (удержанная комиссия эквайринга)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_in',
  }),

  special_bank_55: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'special_bank_55',
    label: '1С: Специальные счета в банках (аккредитивы / депозиты / корп. карты — счёт 55)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание / Поступление (Перевод на другой счет организации)',
    documentKind1C: 'Перевод денежных средств на специальный банковский счёт (55.01 / 55.03 / 55.04)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '55.04',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите Вид операции = «Перевод на другой счет организации» и укажите субсчёт 55.01 / 55.03 / 55.04',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 51 и 55 (55.01 / 55.03 / 55.04)',
      defaultCheckPoints: [
        'Проверьте открытый специальный банковский счёт организации (аккредитив 55.01, депозит 55.03 или корп. карта 55.04)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  accountable_issue: makeSpec({
    docType: 'ВыдачаНаличных',
    category: 'accountable_issue',
    label: '1С: Выдача подотчётному лицу (счёт 71.01)',
    uiProfile: 'accountable_71',
    menuPath1C: 'Банк и касса → Касса → Кассовые документы → Выдача (РКО) / Банковские выписки → Списание',
    documentKind1C: 'Выдача подотчётному лицу (Дт 71.01 — Кт 50.01 / 51)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '71.01',
      credit: '50.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите Вид операции = «Выдача подотчетному лицу», укажите сотрудника из справочника «Физические лица» и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 71.01 (по работникам организации)',
      defaultCheckPoints: [
        'Подотчётный сотрудник выбирается строго из справочника «Физические лица» (НЕ «Контрагенты», ИНН/КПП и НДС не требуются)',
        'При выдаче наличными убедитесь, что в кассе (счёт 50.01) достаточно средств на начало дня',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'cash_out',
  }),

  expense_report: makeSpec({
    docType: 'АвансовыйОтчет',
    category: 'expense_report',
    label: '1С: Авансовый отчёт (списание подотчётных сумм с 71.01)',
    uiProfile: 'accountable_71',
    menuPath1C: 'Банк и касса → Касса → Авансовые отчеты → кнопка «Создать» → Авансовый отчет',
    documentKind1C: 'Авансовый отчёт подотчётного лица (Кт 71.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: true,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '10.09',
      credit: '71.01',
      vatAccount: '19.03',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Заполните вкладки «Авансы» и «Товары» / «Прочее» по чекам сотрудника и нажмите «Провести и закрыть»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 71.01 и счетам 10.09 / 26',
      defaultCheckPoints: [
        'Укажите подотчётное лицо из справочника «Физические лица»',
        'Без отдельного счёта-фактуры кассовый чек принимается к учёту «Без НДС» (п. 7 ст. 168, ст. 172 НК РФ)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'expense_report',
  }),

  accountable_return: makeSpec({
    docType: 'ПоступлениеНаличных',
    category: 'accountable_return',
    label: '1С: Возврат неизрасходованных подотчётных сумм (Кт 71.01)',
    uiProfile: 'accountable_71',
    menuPath1C: 'Банк и касса → Касса → Кассовые документы → Поступление (ПКО) / Банковские выписки → Поступление',
    documentKind1C: 'Возврат от подотчётного лица (Дт 50.01 / 51 — Кт 71.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '50.01',
      credit: '71.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите Вид операции = «Возврат от подотчетного лица», укажите сотрудника и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 71.01 (остаток по сотруднику должен закрыться в 0,00 ₽)',
      defaultCheckPoints: [
        'Проверьте сумму неизрасходованного остатка по счёту 71.01: Выдано − Израсходовано по АО',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'cash_in',
  }),

  employee_settlement_73: makeSpec({
    docType: 'ОперацияБух',
    category: 'employee_settlement_73',
    label: '1С: Расчёты с персоналом по прочим операциям (счёт 73)',
    uiProfile: 'hr_payroll',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную (или Банк и касса при выдаче/погашении займа сотруднику)',
    documentKind1C: 'Расчёты с персоналом по займам и возмещению ущерба (73.01 / 73.02 / 73.03)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '73.03',
      credit: '50.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите работника организации в субконто счёта 73.01 / 73.02 / 73.03 и запишите операцию',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 73 (по работникам и субсчетам)',
      defaultCheckPoints: [
        'Займы работникам учитываются на субсчёте 73.01, возмещение материального ущерба/недостач — на 73.02, прочие расчёты — на 73.03',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  loan_received: makeSpec({
    docType: 'ПоступлениеНаРасчетныйСчет',
    category: 'loan_received',
    label: '1С: Получение кредита / займа (счёт 66.03 / 67.03)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Поступление (Вид операции: Получение займа от контрагента / Получение кредита в банке)',
    documentKind1C: 'Получение кредита / займа на расчётный счёт',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '51',
      credit: '66.03',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите договор займа (вид «Прочее»), счёт расчётов 66.03 / 66.01 (или 67.03 / 67.01) и проведите выписку',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 51 и 66 / 67',
      defaultCheckPoints: [
        'Получение и возврат тела кредита/займа НДС не облагаются (пп. 15 п. 3 ст. 149 НК РФ)',
        'Срок до 12 мес. отражается на счёте 66, свыше 12 мес. — на счёте 67',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_in',
  }),

  loan_repaid: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'loan_repaid',
    label: '1С: Возврат кредита / займа и уплата процентов (66 / 67)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание (Вид операции: Возврат займа контрагенту / Возврат кредита банку)',
    documentKind1C: 'Погашение кредита / займа и процентов',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '66.03',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите тип платежа («Погашение основного долга» — 66.03/66.01 или «Уплата процентов» — 66.04/66.02) и проведите списание',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 66 / 67 и 51',
      defaultCheckPoints: [
        'Основной долг и проценты учитываются на разных субсчетах (66.03 vs 66.04; 66.01 vs 66.02)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  loan_issued: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'loan_issued',
    label: '1С: Выдача процентного займа контрагенту (счёт 58.03)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание (Вид операции: Выдача займа контрагенту)',
    documentKind1C: 'Предоставление процентного займа (Дт 58.03 Кт 51)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '58.03',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите заёмщика, договор выданного займа и счёт 58.03, затем проведите списание',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 58.03',
      defaultCheckPoints: [
        'Процентные займы сторонним организациям учитываются в составе финансовых вложений на счёте 58.03 (ПБУ 19/02)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  loan_interest_accrual: makeSpec({
    docType: 'ОперацияБух',
    category: 'loan_interest_accrual',
    label: '1С: Начисление процентов по кредитам и займам (91.02 / 66.04)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную',
    documentKind1C: 'Начисление процентов по кредиту / займу (Дт 91.02 — Кт 66.04 / 66.02 / 67.04)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '66.04',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проверьте расчёт процентов по дням пользования займом и запишите ручную операцию',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 91.02 и 66.04 / 67.04',
      defaultCheckPoints: [
        'В Дт 91.02 укажите статью прочих доходов и расходов «Проценты к уплате (получению)»',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  depreciation_accrual: makeSpec({
    docType: 'ЗакрытиеМесяца',
    category: 'depreciation_accrual',
    label: '1С: Амортизация и износ основных средств (счёт 02.01)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'Операции → Закрытие периода → Закрытие месяца → Регламентная операция «Амортизация и износ основных средств»',
    documentKind1C: 'Регламентная операция «Амортизация и износ основных средств» (Кт 02.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '20.01',
      credit: '02.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выполните регламентную операцию «Амортизация и износ основных средств» в обработке «Закрытие месяца»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 01.01, 02.01 и 20.01/25/26/44.01',
      defaultCheckPoints: [
        'По ФСБУ 6/2020 амортизация начисляется ежемесячно в размере Первоначальная стоимость / СПИ (со следующего месяца после ввода в эксплуатацию)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  insurance_accrual: makeSpec({
    docType: 'НачислениеЗарплаты',
    category: 'insurance_accrual',
    label: '1С: Начисление страховых взносов с ФОТ (69.09 / 69.11)',
    uiProfile: 'hr_payroll',
    menuPath1C: 'Зарплата и кадры → Зарплата → Все начисления → Начисление зарплаты (вкладка «Взносы»)',
    documentKind1C: 'Расчёт страховых взносов 30% + травматизм 0,2% в документе «Начисление зарплаты»',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '26',
      credit: '69.09',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проведите «Начисление зарплаты» — вкладка «Взносы» автоматически сформирует проводки Кт 69.09 и Кт 69.11',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 69.09 и 69.11',
      defaultCheckPoints: [
        'Проверьте тариф страховых взносов в «Настройках налогов и отчетов → Страховые взносы» (единый тариф 30% + НС и ПЗ 0,2%)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'payroll_accrual',
  }),

  cash_out: makeSpec({
    docType: 'ВыдачаНаличных',
    category: 'cash_out',
    label: '1С: Выдача наличных (Расходный кассовый ордер — РКО)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Касса → Кассовые документы → кнопка «Выдача»',
    documentKind1C: 'Расходный кассовый ордер (Выдача наличных из кассы 50.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '60.01',
      credit: '50.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проверьте остаток наличных в кассе на начало дня, выберите вид операции РКО и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 50.01 (без отрицательного сальдо внутри дня)',
      defaultCheckPoints: [
        'Счёт 50.01 — строго активный: перед выдачей наличных проверьте наличие дебетового остатка в кассе',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'cash_out',
  }),

  cash_in: makeSpec({
    docType: 'ПоступлениеНаличных',
    category: 'cash_in',
    label: '1С: Поступление наличных (Приходный кассовый ордер — ПКО)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Касса → Кассовые документы → кнопка «Поступление»',
    documentKind1C: 'Приходный кассовый ордер (Поступление наличных в кассу 50.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '50.01',
      credit: '62.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите вид операции ПКО (Розничная выручка / Оплата от покупателя / Прочий приход) и проведите документ',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 50.01',
      defaultCheckPoints: [
        'Проверьте лимит остатка кассы по Указанию Банка России № 3210-У и статью ДДС',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'cash_in',
  }),

  hr_hire: makeSpec({
    docType: 'ПриемНаРаботу',
    category: 'hr_hire',
    label: '1С: Приём на работу (кадровый приказ — без проводок)',
    uiProfile: 'hr_payroll',
    menuPath1C: 'Зарплата и кадры → Кадры → Кадровые документы → Создать → Прием на работу',
    documentKind1C: 'Кадровый приказ «Приём на работу» (регистрация сотрудника и оклада)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'forbidden',
    defaultSubaccounts: { debit: '', credit: '' },
    auditGuidanceTemplate: {
      repostInstruction: 'Заполните сотрудника, должность, подразделение, оклад и нажмите «Провести и закрыть»',
      verifyInOsv: 'Зарплата и кадры → Кадры → Сотрудники (кадровый документ проводок в ОСВ не формирует)',
      defaultCheckPoints: [
        'Проверьте дату приёма, должность, вид начисления «Оклад по дням» и месячный размер оклада',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'hr_hire',
  }),

  writ_of_execution: makeSpec({
    docType: 'ИсполнительныйЛист',
    category: 'writ_of_execution',
    label: '1С: Исполнительный лист (регистрация удержания — без проводок)',
    uiProfile: 'hr_payroll',
    menuPath1C: 'Зарплата и кадры → Зарплата → Исполнительные листы → кнопка «Создать»',
    documentKind1C: 'Регистрация удержания по исполнительному листу (алименты, счёт 76.41)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'forbidden',
    defaultSubaccounts: { debit: '', credit: '' },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите сотрудника, получателя алиментов, способ расчёта доли (1/4 = 25%, 1/3 = 33,33%, 1/2 = 50%) и проведите документ',
      verifyInOsv: 'Зарплата и кадры → Исполнительные листы (проводка Дт 70 Кт 76.41 появится при Начислении зарплаты)',
      defaultCheckPoints: [
        'Проверьте сотрудника-должника, получателя удержаний и период действия исполнительного листа',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  alimony_payout: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'alimony_payout',
    label: '1С: Перечисление удержанных алиментов получателю (счёт 76.41)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание (Вид операции: Прочее списание → счёт 76.41)',
    documentKind1C: 'Перечисление удержаний по исполнительному листу (Дт 76.41 Кт 51 / 50.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '76.41',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите счёт дебета 76.41, получателя алиментов в субконто и проведите списание',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 76.41 (кредитовое сальдо закрывается в 0,00 ₽)',
      defaultCheckPoints: [
        'Сумма перечисления алиментов равна сумме, удержанной при начислении ЗП (Дт 70 Кт 76.41): (Оклад − НДФЛ 13%) × доля',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  payroll_accrual: makeSpec({
    docType: 'НачислениеЗарплаты',
    category: 'payroll_accrual',
    label: '1С: Начисление зарплаты, НДФЛ, удержаний и взносов',
    uiProfile: 'hr_payroll',
    menuPath1C: 'Зарплата и кадры → Зарплата → Все начисления → Создать → Начисление зарплаты',
    documentKind1C: 'Начисление зарплаты за месяц (ФОТ + НДФЛ 13% + удержания 76.41 + взносы 30,2%)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '26',
      credit: '70',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Нажмите кнопку «Заполнить» по кадровым данным и проведите документ последним числом месяца',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 70, 68.01, 69.09, 69.11 и 20.01/26',
      defaultCheckPoints: [
        'Проверьте вкладки «Начисления» (Кт 70), «Удержания» (Кт 76.41 при наличии исп. листов), «НДФЛ» (Кт 68.01 — 13%) и «Взносы» (Кт 69.09 — 30%, Кт 69.11 — 0,2%)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'payroll_accrual',
  }),

  payroll_payout: makeSpec({
    docType: 'ВедомостьВБанк',
    category: 'payroll_payout',
    label: '1С: Выплата заработной платы (Ведомость + списание 70)',
    uiProfile: 'hr_payroll',
    menuPath1C: 'Зарплата и кадры → Зарплата → Ведомости в банк (или Ведомости в кассу) → Выплатить зарплату',
    documentKind1C: 'Выплата зарплаты / аванса на руки за вычетом НДФЛ и удержаний (Дт 70 Кт 51 / 50.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: true,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '70',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Заполните ведомость по кнопке «Заполнить» и оформите документ «Выплатить зарплату» (Списание с р/с или РКО)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 70 (кредитовый остаток закрывается)',
      defaultCheckPoints: [
        'К выплате на руки идёт сумма за минусом НДФЛ 13% и алиментов 76.41 (не путать с начисленным окладом брутто)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: true,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  tax_payment: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'tax_payment',
    label: '1С: Уплата налогов и страховых взносов в бюджет (ЕНС / ИФНС / СФР)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание (Вид операции: Уплата налога)',
    documentKind1C: 'Уплата налога / страховых взносов (Дт 68 / 69 — Кт 51)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '68.90',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите Вид операции = «Уплата налога», укажите субсчёт 68 / 69, вид платежа «Налог (взносы): начислено / уплачено» и проведите выписку',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 68 и 69 (и счету 51)',
      defaultCheckPoints: [
        'Проверьте соответствие субсчёта налога (68.01 НДФЛ, 68.02 НДС, 68.04.1 Прибыль, 68.90 ЕНС, 69.09 Единый тариф, 69.11 Травматизм)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  bank_fee: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'bank_fee',
    label: '1С: Комиссия банка за РКО (счёт 91.02 — без НДС)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание (Вид операции: Комиссия банка)',
    documentKind1C: 'Комиссия банка за расчётно-кассовое обслуживание (Дт 91.02 Кт 51)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выберите Вид операции = «Комиссия банка» и статью прочих расходов «Расходы на услуги банков» (без НДС по ст. 149 НК РФ)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 91.02 и 51',
      defaultCheckPoints: [
        'Банковская комиссия за РКО списывается напрямую в Дт 91.02 Кт 51 без использования счёта 60 и без НДС',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  charter_capital: makeSpec({
    docType: 'ОперацияБух',
    category: 'charter_capital',
    label: '1С: Формирование уставного / резервного / добавочного капитала (80 / 82 / 83)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Формирование уставного капитала (или Операции, введенные вручную)',
    documentKind1C: 'Формирование уставного капитала (Дт 75.01 Кт 80.09) и операции с капиталом',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '75.01',
      credit: '80.09',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите учредителей и номинальную стоимость их долей (Дт 75.01 Кт 80.09) на дату государственной регистрации общества',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 80.09 и 75.01 (по учредителям)',
      defaultCheckPoints: [
        'Кредитовое сальдо счёта 80.09 должно строго соответствовать размеру уставного капитала по Уставу и ЕГРЮЛ',
        'Дебетовое сальдо 75.01 показывает неоплаченную часть долей учредителей (погашается при внесении на 51/50/10/08)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  founder_contribution: makeSpec({
    docType: 'ПоступлениеНаРасчетныйСчет',
    category: 'founder_contribution',
    label: '1С: Внесение вклада учредителя в уставный капитал (Кт 75.01)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Поступление (Прочее поступление → счёт 75.01) / Касса → ПКО (Взнос в УК)',
    documentKind1C: 'Оплата доли учредителем в уставном капитале (Дт 51 / 50.01 / 10 / 08 — Кт 75.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '51',
      credit: '75.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите счёт расчётов 75.01 и выберите учредителя в субконто (без НДС по пп. 4 п. 3 ст. 39 НК РФ)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 75.01 (задолженность учредителя закрывается)',
      defaultCheckPoints: [
        'Проверьте совпадение карточки учредителя на счёте 75.01 с документом формирования УК (Дт 75.01 Кт 80.09)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_in',
  }),

  dividends_accrual: makeSpec({
    docType: 'ОперацияБух',
    category: 'dividends_accrual',
    label: '1С: Начисление дивидендов из чистой прибыли (Дт 84.01 Кт 75.02 / 70)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Зарплата и кадры → Зарплата → Дивиденды (или Операции → Операции, введенные вручную)',
    documentKind1C: 'Распределение чистой прибыли на выплату дивидендов (Дт 84.01 Кт 75.02)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '84.01',
      credit: '75.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'На основании решения общего собрания участников отразите Дт 84.01 Кт 75.02 (или 70 для штатных участников) и удержание НДФЛ Дт 75.02 Кт 68.01',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 84.01, 75.02 и 68.01',
      defaultCheckPoints: [
        'Проверьте наличие чистой прибыли по Кт 84.01 и удержание НДФЛ налоговым агентом при выплате физлицу',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  dividends_payout: makeSpec({
    docType: 'СписаниеСРасчетногоСчета',
    category: 'dividends_payout',
    label: '1С: Выплата дивидендов учредителям (Дт 75.02 Кт 51)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Банк → Банковские выписки → Списание (Вид операции: Перечисление дивидендов / Прочее списание → 75.02)',
    documentKind1C: 'Выплата дивидендов участникам общества (Дт 75.02 Кт 51)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: true,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '75.02',
      credit: '51',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите счёт дебета 75.02, получателя дивидендов и проведите банковское списание (за вычетом удержанного налога)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 75.02 и 51',
      defaultCheckPoints: [
        'Убедитесь, что выплата производится за вычетом удержанного НДФЛ / налога на прибыль с дивидендов',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'bank_out',
  }),

  financial_investment: makeSpec({
    docType: 'ФинансовыеВложения',
    category: 'financial_investment',
    label: '1С: Приобретение ценных бумаг / векселей / акций (счёт 58)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную (субконто «Ценные бумаги» счёта 58)',
    documentKind1C: 'Принятие к учёту финансовых вложений (Дт 58.02 / 58.01.2 — Кт 76.09 / 51)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '58.02',
      credit: '76.09',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Создайте элементы справочника «Ценные бумаги» и отразите оприходование на счёт 58.02 (векселя/облигации) или 58.01.2 (акции)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 58 (с разбивкой по ценным бумагам)',
      defaultCheckPoints: [
        'Операции с ценными бумагами не подлежат налогообложению НДС (пп. 12 п. 2 ст. 149 НК РФ, ПБУ 19/02)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  financial_interest_accrual: makeSpec({
    docType: 'ОперацияБух',
    category: 'financial_interest_accrual',
    label: '1С: Начисление процентного дохода по финвложениям (Дт 76.09 Кт 91.01)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную',
    documentKind1C: 'Начисление процентов (дисконта) к получению по векселям и займам (Дт 76.09 Кт 91.01)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '76.09',
      credit: '91.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Отразите начисленный процентный доход по формуле Номинал × Ставка% / 365 × Дни в Кт 91.01',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 76.09 и 91.01',
      defaultCheckPoints: [
        'Проверьте количество календарных дней владения векселем/займом и статью прочих доходов «Проценты к получению»',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  financial_disposal: makeSpec({
    docType: 'ОперацияБух',
    category: 'financial_disposal',
    label: '1С: Погашение / продажа ценных бумаг и векселей (Кт 58.02)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную (плюс Банковские выписки → Поступление при оплате)',
    documentKind1C: 'Выбытие / предъявление к оплате ценной бумаги через счёт 91 (Дт 76.09 Кт 91.01; Дт 91.02 Кт 58.02)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '58.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Спишите учётную стоимость бумаги Дт 91.02 Кт 58.02 и отразите доход от погашения/реализации Дт 76.09 Кт 91.01 (без НДС)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 58.02, 76.09 и 91',
      defaultCheckPoints: [
        'Проверьте закрытие конкретного векселя/ценной бумаги на счёте 58.02 по его учётной стоимости',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  deferred_expense_97: makeSpec({
    docType: 'ПоступлениеТоваровУслуг',
    category: 'deferred_expense_97',
    label: '1С: Расходы будущих периодов и страхование (счёт 97.21 / 76.01.9)',
    uiProfile: 'trade_services',
    menuPath1C: 'Покупки → Поступление (акты, накладные, УПД) → Услуги (счёт затрат 97.21 / 76.01.9)',
    documentKind1C: 'Учёт расходов будущих периодов (счёт 97.21) и страховых премий (76.01.9)',
    requiresCommercialCounterparty: true,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'optional_by_text',
    defaultSubaccounts: {
      debit: '97.21',
      credit: '60.01',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Заполните элемент справочника «Расходы будущих периодов» (период списания с/по и счёт затрат) и проведите акт',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 97.21 / 76.01.9 и 60 / 76',
      defaultCheckPoints: [
        'В карточке РБП укажите даты начала и окончания списания для автоматического ежемесячного закрытия в «Закрытии месяца»',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'purchase_ptu',
  }),

  reserve_doubtful_63: makeSpec({
    docType: 'ОперацияБух',
    category: 'reserve_doubtful_63',
    label: '1С: Резервы по сомнительным долгам (счёт 63)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную (или Закрытие месяца → Расчет резервов по сомнительным долгам)',
    documentKind1C: 'Формирование / использование резерва по сомнительным долгам (счёт 63)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '63',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Укажите контрагента-должника и договор в аналитике счёта 63 и запишите операцию',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 63 и 91.02',
      defaultCheckPoints: [
        'Формирование резерва отражается проводкой Дт 91.02 Кт 63, списание безнадёжного долга за счёт резерва — Дт 63 Кт 62.01 (с постановкой на забаланс 007)',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  off_balance_op: makeSpec({
    docType: 'ОперацияБух',
    category: 'off_balance_op',
    label: '1С: Забалансовый учёт (счета 001, 002, 003.01, 004.01, 008, 009, МЦ)',
    uiProfile: 'warehouse_production',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную (односторонняя запись по забалансовому счёту)',
    documentKind1C: 'Забалансовая операция (приём на хранение / в аренду / в переработку без двойной записи)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '001',
      credit: '',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'В ручной операции укажите только Дт забалансового счёта (при приёмке) или только Кт (при возврате/списании)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость (включите показ забалансовых счетов в настройках)',
      defaultCheckPoints: [
        'По забалансовым счетам (001–011, МЦ) записи ведутся по простой (односторонней) схеме и не входят в итог балансовых счетов ОСВ',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: true,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  vat_deduction: makeSpec({
    docType: 'СчетФактураПолученный',
    category: 'vat_deduction',
    label: '1С: Регламентная операция НДС (Формирование записей книги покупок и книги продаж)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Закрытие периода → Регламентные операции НДС → Формирование записей книги покупок',
    documentKind1C: 'Формирование записей книги покупок и книги продаж (регламентная операция НДС 19 → 68.02)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: true,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '68.02',
      credit: '19.03',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Нажмите «Заполнить документ» в «Формировании записей книги покупок» или установите галочку «Отразить вычет НДС в книге покупок» в счёте-фактуре',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 19 и 68.02',
      defaultCheckPoints: [
        'После принятия к вычету дебетовый остаток на субсчетах счёта 19 по зарегистрированным счётам-фактурам закрывается в 0,00 ₽',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  penalty_claim: makeSpec({
    docType: 'ОперацияБух',
    category: 'penalty_claim',
    label: '1С: Штрафы, пени, неустойки и претензии (счета 91.02 / 99.02.3 / 76.02)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную (или Продажи → Начисление пеней)',
    documentKind1C: 'Начисление штрафов, пеней и претензий (76.02 / 68.10)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: true,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '76.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Договорные неустойки отразите на счёте 91 (Дт 91.02 Кт 76.02 или Дт 76.02 Кт 91.01), налоговые санкции ИФНС — Дт 99.02.3 Кт 68.10',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 76.02, 68.10 и 91 / 99',
      defaultCheckPoints: [
        'Штрафы и неустойки по хоздоговорам и налоговые санкции НДС не облагаются',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: true,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  advance_offset: makeSpec({
    docType: 'КорректировкаДолга',
    category: 'advance_offset',
    label: '1С: Зачёт авансов поставщикам и покупателям (60.01—60.02 / 62.02—62.01)',
    uiProfile: 'trade_services',
    menuPath1C: 'Продажи / Покупки → Расчеты с контрагентами → Корректировка долга (Вид операции: Зачет авансов)',
    documentKind1C: 'Корректировка долга — Зачёт авансов',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '60.01',
      credit: '60.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Нажмите «Заполнить» на обеих вкладках или перепроведите документы оплаты и накладной в хронологическом порядке',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счетам 60 и 62 (отсутствие зависших встречных сальдо 60.01/60.02 и 62.01/62.02)',
      defaultCheckPoints: [
        'Проверьте идентичность Контрагента и Договора в документе оплаты и документе поступления/реализации',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  advance_vat: makeSpec({
    docType: 'СчетФактураВыданный',
    category: 'advance_vat',
    label: '1С: Счёт-фактура на аванс полученный (Дт 76.АВ Кт 68.02)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Банк и касса → Регистрация счетов-фактур → Счета-фактуры на аванс → кнопка «Заполнить» → «Выполнить»',
    documentKind1C: 'Счёт-фактура выданный на аванс (Дт 76.АВ Кт 68.02, ставка 20/120)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: true,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '76.АВ',
      credit: '68.02',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Выполните обработку «Счета-фактуры на аванс» по остатку счёта 62.02 (п. 3 ст. 168, п. 4 ст. 164 НК РФ)',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по счету 76.АВ (остаток 76.АВ = Кт 62.02 × 20 / 120)',
      defaultCheckPoints: [
        'При последующей отгрузке в счёт аванса НДС с 76.АВ принимается к вычету в книге покупок (Дт 68.02 Кт 76.АВ)',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  closing: makeSpec({
    docType: 'ЗакрытиеМесяца',
    category: 'closing',
    label: '1С: Закрытие месяца / Реформация баланса (20, 25, 26, 44 → 90, 91 → 99 → 84)',
    uiProfile: 'os_regulatory',
    menuPath1C: 'Операции → Закрытие периода → Закрытие месяца → кнопка «Выполнить закрытие месяца»',
    documentKind1C: 'Регламентная операция «Закрытие месяца» (закрытие затрат, финрезультат, налог на прибыль 20%, реформация баланса)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: false,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '90.09',
      credit: '99.01.1',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Запустите помощник «Закрытие месяца»: перепроведите документы в хронологической последовательности и выполните все регламентные операции',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость (нулевое конечное сальдо по 25, 26, 44.01, синтетическим 90 и 91; в декабре — закрытие 99 на 84)',
      defaultCheckPoints: [
        'Счета 25, 26, 44.01 и синтетические счета 90 и 91 на конец каждого месяца не имеют сальдо',
        'При реформации баланса 31 декабря субсчета 90.01/90.02/90.03/90.08 закрываются на 90.09, 91.01/91.02 — на 91.09, а счёт 99.01.1 — на 84.01/84.02',
      ],
    },
    masterDataRules: {
      createsCounterparty: false,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),

  manual: makeSpec({
    docType: 'ОперацияБух',
    category: 'manual',
    label: '1С: Операция, введённая вручную (Бухгалтерская справка)',
    uiProfile: 'taxes_bank_founders',
    menuPath1C: 'Операции → Бухгалтерский учет → Операции, введенные вручную → Создать → Операция',
    documentKind1C: 'Операция, введённая вручную (Бухгалтерская справка)',
    requiresCommercialCounterparty: false,
    acceptsCounterpartySubconto: true,
    requiresIndividual: false,
    needsContract: false,
    needsWarehouse: false,
    needsExpenseItem: false,
    needsCashFlowItem: false,
    allowsZeroPostings: false,
    vatPolicy: 'forbidden',
    defaultSubaccounts: {
      debit: '91.02',
      credit: '76.09',
    },
    auditGuidanceTemplate: {
      repostInstruction: 'Проверьте корреспонденцию конечных субсчетов, заполнение аналитики (Субконто 1–3) и нажмите «Записать и закрыть»',
      verifyInOsv: 'Отчеты → Оборотно-сальдовая ведомость по задействованным субсчетам',
      defaultCheckPoints: [
        'Используйте только рабочие конечные субсчета (не счета-группы) и заполняйте обязательные субконто для корректной ОСВ',
        'Не накручивайте НДС 20% без прямого указания в первичном документе',
      ],
    },
    masterDataRules: {
      createsCounterparty: true,
      createsContract: false,
      createsNomenclature: false,
      createsEmployee: false,
      createsFixedAsset: false,
    },
    exportBslKind: 'manual_operation',
  }),
};

/**
 * Canonical mapping from every `DocType1CBP30` to its primary `OperationCategory` and display label.
 */
export const DOC_TYPE_TO_DEFAULT_CATEGORY_1C: Record<DocType1CBP30, OperationCategory> = {
  СписаниеСРасчетногоСчета: 'bank_out',
  ПоступлениеНаРасчетныйСчет: 'bank_in',
  ПоступлениеТоваровУслуг: 'purchase_goods',
  РеализацияТоваровУслуг: 'sale_goods',
  РасходМатериалов: 'materials_writeoff',
  ПередачаМатериаловВЭксплуатацию: 'workwear_issue',
  ПринятиеКУчетуОС: 'os_commissioning',
  ПринятиеКУчетуНМА: 'intangible_commissioning',
  ПередачаОС: 'os_disposal',
  СписаниеОС: 'os_disposal',
  ВыпускПродукции: 'production_output',
  ПеремещениеТоваров: 'warehouse_transfer',
  ИнвентаризацияТоваров: 'inventory_result',
  ОперацияПоПлатежнойКарте: 'acquiring_receipt',
  СчетФактураПолученный: 'vat_deduction',
  СчетФактураВыданный: 'advance_vat',
  СчетПокупателю: 'customer_invoice',
  СчетОтПоставщика: 'supplier_invoice',
  ВыдачаНаличных: 'cash_out',
  ПоступлениеНаличных: 'cash_in',
  НачислениеЗарплаты: 'payroll_accrual',
  ПриемНаРаботу: 'hr_hire',
  ИсполнительныйЛист: 'writ_of_execution',
  ВедомостьВБанк: 'payroll_payout',
  ВедомостьВКассу: 'payroll_payout',
  АвансовыйОтчет: 'expense_report',
  КорректировкаДолга: 'advance_offset',
  ФинансовыеВложения: 'financial_investment',
  ОперацияБух: 'manual',
  ЗакрытиеМесяца: 'closing',
  ВводОстатков: 'manual',
};

export const DOC_TYPE_LABELS_1C: Record<DocType1CBP30, string> = {
  СписаниеСРасчетногоСчета: '1С: Списание с расчётного счёта',
  ПоступлениеНаРасчетныйСчет: '1С: Поступление на расчётный счёт',
  ПоступлениеТоваровУслуг: '1С: Поступление (акты, накладные, УПД)',
  РеализацияТоваровУслуг: '1С: Реализация (акты, накладные, УПД)',
  СчетПокупателю: '1С: Счёт покупателю (на оплату)',
  СчетОтПоставщика: '1С: Счёт от поставщика (на оплату)',
  РасходМатериалов: '1С: Расход материалов (Требование-накладная)',
  ПередачаМатериаловВЭксплуатацию: '1С: Передача материалов в эксплуатацию (МОЛ)',
  ПринятиеКУчетуОС: '1С: Принятие к учёту ОС',
  ПринятиеКУчетуНМА: '1С: Принятие к учёту НМА',
  ПередачаОС: '1С: Передача ОС (реализация ОС)',
  СписаниеОС: '1С: Списание ОС',
  ВыпускПродукции: '1С: Выпуск продукции (Отчёт производства)',
  ПеремещениеТоваров: '1С: Перемещение товаров / материалов',
  ИнвентаризацияТоваров: '1С: Инвентаризация товаров (списание / оприходование)',
  ОперацияПоПлатежнойКарте: '1С: Операция по платёжной карте (эквайринг)',
  СчетФактураПолученный: '1С: Счёт-фактура полученный (вычет НДС)',
  СчетФактураВыданный: '1С: Счёт-фактура выданный (НДС с аванса)',
  ВыдачаНаличных: '1С: Выдача наличных (РКО)',
  ПоступлениеНаличных: '1С: Поступление наличных (ПКО)',
  НачислениеЗарплаты: '1С: Начисление зарплаты и взносов',
  ПриемНаРаботу: '1С: Приём на работу (кадровый приказ)',
  ИсполнительныйЛист: '1С: Исполнительный лист (удержание алиментов)',
  ВедомостьВБанк: '1С: Ведомость в банк (выплата ЗП)',
  ВедомостьВКассу: '1С: Ведомость в кассу (выплата ЗП)',
  АвансовыйОтчет: '1С: Авансовый отчёт (счёт 71.01)',
  КорректировкаДолга: '1С: Корректировка долга (зачёт авансов)',
  ФинансовыеВложения: '1С: Приобретение ценных бумаг / векселей (счёт 58)',
  ОперацияБух: '1С: Операция, введённая вручную',
  ЗакрытиеМесяца: '1С: Закрытие месяца (регламентная операция)',
  ВводОстатков: '1С: Ввод начальных остатков',
};

export const ALL_DOC_TYPES_1C: DocType1CBP30[] = [
  'СписаниеСРасчетногоСчета',
  'ПоступлениеНаРасчетныйСчет',
  'ПоступлениеТоваровУслуг',
  'РеализацияТоваровУслуг',
  'СчетПокупателю',
  'СчетОтПоставщика',
  'ПоступлениеНаличных',
  'ВыдачаНаличных',
  'АвансовыйОтчет',
  'РасходМатериалов',
  'ПередачаМатериаловВЭксплуатацию',
  'ПеремещениеТоваров',
  'ИнвентаризацияТоваров',
  'ВыпускПродукции',
  'ПринятиеКУчетуОС',
  'ПринятиеКУчетуНМА',
  'ПередачаОС',
  'СписаниеОС',
  'ПриемНаРаботу',
  'ИсполнительныйЛист',
  'НачислениеЗарплаты',
  'ВедомостьВБанк',
  'ВедомостьВКассу',
  'ФинансовыеВложения',
  'ОперацияПоПлатежнойКарте',
  'СчетФактураПолученный',
  'СчетФактураВыданный',
  'КорректировкаДолга',
  'ОперацияБух',
  'ЗакрытиеМесяца',
  'ВводОстатков',
];

export function getDocumentSpecByCategory(category: OperationCategory): DocumentSpec1C {
  return DOCUMENT_SPECS[category] ?? DOCUMENT_SPECS.manual;
}

export function getDocumentSpecByDocType(
  docType: DocType1CBP30,
  fallbackCategory?: OperationCategory
): DocumentSpec1C {
  if (fallbackCategory && DOCUMENT_SPECS[fallbackCategory]?.docType === docType) {
    return DOCUMENT_SPECS[fallbackCategory];
  }
  const cat = DOC_TYPE_TO_DEFAULT_CATEGORY_1C[docType] ?? 'manual';
  return DOCUMENT_SPECS[cat] ?? DOCUMENT_SPECS.manual;
}

/**
 * Resolves the exact `DocumentSpec1C` for a `QueuedOperation`, accounting for
 * cash/bank sub-variants (e.g., accountable issue via bank `51` vs cash `50.01`,
 * cash withdrawal from bank via PKO vs deposit to bank via RKO, payroll payout via RKO/Bank).
 */
export function getDocumentSpecForOperation(
  op: Pick<QueuedOperation, 'category' | 'docType1C'> & {
    documentSubKind1C?: string;
    entries?: Array<{ debit: string; credit: string }>;
  }
): DocumentSpec1C {
  const base = getDocumentSpecByCategory(op.category);

  // Refine menuPath1C when docType1C overrides transport (e.g. bank vs cash for 71.01 or 70 or 75.01)
  if (op.category === 'accountable_issue') {
    if (op.docType1C === 'СписаниеСРасчетногоСчета') {
      return {
        ...base,
        docType: 'СписаниеСРасчетногоСчета',
        menuPath1C:
          'Банк и касса → Банк → Банковские выписки → кнопка «Списание» (Вид операции: Перечисление подотчетному лицу)',
        documentKind1C: 'Перечисление подотчётному лицу на карту (Дт 71.01 Кт 51)',
        exportBslKind: 'bank_out',
      };
    }
    return {
      ...base,
      docType: 'ВыдачаНаличных',
      menuPath1C:
        'Банк и касса → Касса → Кассовые документы → кнопка «Выдача» (РКО: Выдача подотчетному лицу)',
      documentKind1C: 'Выдача наличных подотчётному лицу из кассы (Дт 71.01 Кт 50.01)',
      exportBslKind: 'cash_out',
    };
  }

  if (op.category === 'accountable_return') {
    if (op.docType1C === 'ПоступлениеНаРасчетныйСчет') {
      return {
        ...base,
        docType: 'ПоступлениеНаРасчетныйСчет',
        menuPath1C:
          'Банк и касса → Банк → Банковские выписки → кнопка «Поступление» (Вид операции: Возврат от подотчетного лица)',
        documentKind1C: 'Возврат неизрасходованных подотчётных средств на р/с (Дт 51 Кт 71.01)',
        exportBslKind: 'bank_in',
      };
    }
    return {
      ...base,
      docType: 'ПоступлениеНаличных',
      menuPath1C:
        'Банк и касса → Касса → Кассовые документы → кнопка «Поступление» (ПКО: Возврат от подотчетного лица)',
      documentKind1C: 'Возврат неизрасходованных подотчётных сумм в кассу (Дт 50.01 Кт 71.01)',
      exportBslKind: 'cash_in',
    };
  }

  if (op.category === 'cash_bank_internal') {
    if (op.docType1C === 'ВыдачаНаличных') {
      return {
        ...base,
        docType: 'ВыдачаНаличных',
        menuPath1C:
          'Банк и касса → Касса → Кассовые документы → кнопка «Выдача» (РКО: Взнос наличными в банк / Инкассация)',
        documentKind1C: op.documentSubKind1C || 'Взнос наличными в банк (РКО, Дт 51 Кт 50.01)',
        exportBslKind: 'cash_out',
      };
    }
    if (op.docType1C === 'ПоступлениеНаРасчетныйСчет') {
      return {
        ...base,
        docType: 'ПоступлениеНаРасчетныйСчет',
        menuPath1C:
          'Банк и касса → Банк → Банковские выписки → кнопка «Поступление» (Инкассация — зачисление со счёта 57.01)',
        documentKind1C: 'Зачисление инкассированной выручки на расчётный счёт (Дт 51 Кт 57.01)',
        exportBslKind: 'bank_in',
      };
    }
    return {
      ...base,
      docType: 'ПоступлениеНаличных',
      menuPath1C:
        'Банк и касса → Касса → Кассовые документы → кнопка «Поступление» (ПКО: Получение наличных в банке)',
      documentKind1C: op.documentSubKind1C || 'Получение наличных в банке по чеку (ПКО, Дт 50.01 Кт 51)',
      exportBslKind: 'cash_in',
    };
  }

  if (op.category === 'founder_contribution') {
    if (op.docType1C === 'ПоступлениеНаличных') {
      return {
        ...base,
        docType: 'ПоступлениеНаличных',
        menuPath1C:
          'Банк и касса → Касса → Кассовые документы → кнопка «Поступление» (ПКО: Взнос в уставный капитал)',
        documentKind1C: 'Внесение вклада учредителя наличными в кассу (Дт 50.01 Кт 75.01)',
        exportBslKind: 'cash_in',
      };
    }
    if (op.docType1C === 'ОперацияБух') {
      return {
        ...base,
        docType: 'ОперацияБух',
        menuPath1C:
          'Операции → Бухгалтерский учет → Операции, введенные вручную (имущественный вклад в УК)',
        documentKind1C: 'Имущественный вклад учредителя в уставный капитал (Дт 10 / 08 / 41 — Кт 75.01)',
        exportBslKind: 'manual_operation',
      };
    }
  }

  if (op.category === 'payroll_payout') {
    if (op.docType1C === 'ВыдачаНаличных' || op.docType1C === 'ВедомостьВКассу') {
      return {
        ...base,
        docType: op.docType1C,
        menuPath1C:
          'Зарплата и кадры → Зарплата → Ведомости в кассу → кнопка «Оплатить ведомость» (РКО)',
        documentKind1C: 'Выплата заработной платы через кассу (Дт 70 Кт 50.01)',
        exportBslKind: 'cash_out',
      };
    }
    return {
      ...base,
      docType: op.docType1C,
      menuPath1C:
        'Зарплата и кадры → Зарплата → Ведомости в банк → кнопка «Выплатить зарплату» (Списание с р/с)',
      documentKind1C: 'Перечисление заработной платы по реестру в банк (Дт 70 Кт 51)',
      exportBslKind: 'bank_out',
    };
  }

  // If user manually changed docType1C to something different from base.docType, respect docType1C's menu path
  if (op.docType1C && op.docType1C !== base.docType) {
    const byDoc = getDocumentSpecByDocType(op.docType1C, op.category);
    return {
      ...base,
      docType: op.docType1C,
      menuPath1C: byDoc.menuPath1C,
      documentKind1C: op.documentSubKind1C || byDoc.documentKind1C,
      uiProfile: byDoc.uiProfile,
      exportBslKind: byDoc.exportBslKind,
    };
  }

  return base;
}

export function doesSpecRequireCommercialCounterparty(category: OperationCategory): boolean {
  return Boolean(DOCUMENT_SPECS[category]?.requiresCommercialCounterparty);
}

export function doesSpecAcceptCounterpartySubconto(category: OperationCategory): boolean {
  return Boolean(DOCUMENT_SPECS[category]?.acceptsCounterpartySubconto);
}

export function doesSpecAllowZeroPostings(
  opOrCategory: OperationCategory | Pick<QueuedOperation, 'category' | 'docType1C'>
): boolean {
  if (typeof opOrCategory === 'string') {
    return Boolean(DOCUMENT_SPECS[opOrCategory]?.allowsZeroPostings);
  }
  if (
    opOrCategory.docType1C === 'ПриемНаРаботу' ||
    opOrCategory.docType1C === 'ИсполнительныйЛист' ||
    opOrCategory.docType1C === 'СчетПокупателю' ||
    opOrCategory.docType1C === 'СчетОтПоставщика'
  ) {
    return true;
  }
  return Boolean(DOCUMENT_SPECS[opOrCategory.category]?.allowsZeroPostings);
}

export function resolveCardProfileFromSpec(
  op: Pick<QueuedOperation, 'category' | 'docType1C'> & {
    entries?: QueuedOperation['entries'];
  }
): OperationCardProfile {
  if (
    op.category === 'accountable_issue' ||
    op.category === 'expense_report' ||
    op.category === 'accountable_return' ||
    op.docType1C === 'АвансовыйОтчет' ||
    op.entries?.some((e) => e.debit.startsWith('71') || e.credit.startsWith('71'))
  ) {
    return 'accountable_71';
  }
  return getDocumentSpecForOperation(op).uiProfile;
}

export const OPERATION_CATEGORIES_LIST: OperationCategory[] = Object.keys(
  DOCUMENT_SPECS
) as OperationCategory[];

