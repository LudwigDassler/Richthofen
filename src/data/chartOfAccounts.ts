import { AccountInfo } from '@/types/accounting';

export const CHART_OF_ACCOUNTS: AccountInfo[] = [
  // Раздел I. Внеоборотные активы
  {
    code: '01',
    name: 'Основные средства',
    type: 'active',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: true,
  },
  {
    code: '01.01',
    name: 'Основные средства в организации',
    parentCode: '01',
    type: 'active',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '01.09',
    name: 'Выбытие основных средств',
    parentCode: '01',
    type: 'active-passive',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '02',
    name: 'Амортизация основных средств',
    type: 'passive',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: true,
  },
  {
    code: '02.01',
    name: 'Амортизация основных средств, учитываемых на счете 01',
    parentCode: '02',
    type: 'passive',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '04',
    name: 'Нематериальные активы',
    type: 'active',
    subconto: ['Нематериальные активы'],
    category: 'Внеоборотные активы',
    isGroup: true,
  },
  {
    code: '04.01',
    name: 'Нематериальные активы организации',
    parentCode: '04',
    type: 'active',
    subconto: ['Нематериальные активы'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '05',
    name: 'Амортизация нематериальных активов',
    type: 'passive',
    subconto: ['Нематериальные активы'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '08',
    name: 'Вложения во внеоборотные активы',
    type: 'active',
    subconto: ['Номенклатура', 'Склады'],
    category: 'Внеоборотные активы',
    isGroup: true,
  },
  {
    code: '08.04',
    name: 'Приобретение объектов основных средств',
    parentCode: '08',
    type: 'active',
    subconto: ['Основные средства', 'Номенклатура', 'Склады'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },

  // Раздел II. Производственные запасы
  {
    code: '10',
    name: 'Материалы',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: true,
  },
  {
    code: '10.01',
    name: 'Сырье и материалы',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.03',
    name: 'Топливо',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.04',
    name: 'Тара и тарные материалы',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.05',
    name: 'Запасные части',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.08',
    name: 'Строительные материалы',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.09',
    name: 'Инвентарь и хозяйственные принадлежности',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '19',
    name: 'Налог на добавленную стоимость по приобретенным ценностям',
    type: 'active',
    subconto: ['Контрагенты', 'Счета-фактуры полученные', 'Способы учета НДС'],
    category: 'Производственные запасы',
    isGroup: true,
  },
  {
    code: '19.01',
    name: 'НДС при приобретении основных средств',
    parentCode: '19',
    type: 'active',
    subconto: ['Контрагенты', 'Счета-фактуры полученные', 'Способы учета НДС'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '19.03',
    name: 'НДС по приобретенным материально-производственным запасам',
    parentCode: '19',
    type: 'active',
    subconto: ['Контрагенты', 'Счета-фактуры полученные', 'Способы учета НДС'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '19.04',
    name: 'НДС по приобретенным услугам',
    parentCode: '19',
    type: 'active',
    subconto: ['Контрагенты', 'Счета-фактуры полученные', 'Способы учета НДС'],
    category: 'Производственные запасы',
    isGroup: false,
  },

  // Раздел III. Затраты на производство
  {
    code: '20',
    name: 'Основное производство',
    type: 'active',
    subconto: ['Номенклатурные группы', 'Статьи затрат', 'Продукция'],
    category: 'Затраты на производство',
    isGroup: true,
  },
  {
    code: '20.01',
    name: 'Основное производство',
    parentCode: '20',
    type: 'active',
    subconto: ['Номенклатурные группы', 'Статьи затрат', 'Продукция'],
    category: 'Затраты на производство',
    isGroup: false,
  },
  {
    code: '25',
    name: 'Общепроизводственные расходы',
    type: 'active',
    subconto: ['Подразделения', 'Статьи затрат'],
    category: 'Затраты на производство',
    isGroup: false,
  },
  {
    code: '26',
    name: 'Общехозяйственные расходы',
    type: 'active',
    subconto: ['Статьи затрат', 'Подразделения'],
    category: 'Затраты на производство',
    isGroup: false,
  },

  // Раздел IV. Готовая продукция и товары
  {
    code: '41',
    name: 'Товары',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Готовая продукция и товары',
    isGroup: true,
  },
  {
    code: '41.01',
    name: 'Товары на складах',
    parentCode: '41',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '43',
    name: 'Готовая продукция',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '44',
    name: 'Расходы на продажу',
    type: 'active',
    subconto: ['Статьи затрат'],
    category: 'Готовая продукция и товары',
    isGroup: true,
  },
  {
    code: '44.01',
    name: 'Издержки обращения в организациях, осуществляющих торговую деятельность',
    parentCode: '44',
    type: 'active',
    subconto: ['Статьи затрат'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },

  // Раздел V. Денежные средства
  {
    code: '50',
    name: 'Касса',
    type: 'active',
    subconto: ['Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: true,
  },
  {
    code: '50.01',
    name: 'Касса организации',
    parentCode: '50',
    type: 'active',
    subconto: ['Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '51',
    name: 'Расчетные счета',
    type: 'active',
    subconto: ['Банковские счета', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '55',
    name: 'Специальные счета в банках',
    type: 'active',
    subconto: ['Банковские счета', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: true,
  },
  {
    code: '55.04',
    name: 'Прочие специальные счета',
    parentCode: '55',
    type: 'active',
    subconto: ['Банковские счета', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '57',
    name: 'Переводы в пути',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: true,
  },
  {
    code: '57.01',
    name: 'Переводы в пути',
    parentCode: '57',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '58',
    name: 'Финансовые вложения',
    type: 'active',
    subconto: ['Контрагенты', 'Ценные бумаги / Договоры'],
    category: 'Денежные средства и финансовые вложения',
    isGroup: true,
  },
  {
    code: '58.02',
    name: 'Долговые ценные бумаги',
    parentCode: '58',
    type: 'active',
    subconto: ['Контрагенты', 'Ценные бумаги'],
    category: 'Денежные средства и финансовые вложения',
    isGroup: false,
  },
  {
    code: '58.03',
    name: 'Предоставленные займы',
    parentCode: '58',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Денежные средства и финансовые вложения',
    isGroup: false,
  },

  // Раздел VI. Расчеты
  {
    code: '60',
    name: 'Расчеты с поставщиками и подрядчиками',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '60.01',
    name: 'Расчеты с поставщиками и подрядчиками',
    parentCode: '60',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '60.02',
    name: 'Расчеты по авансам выданным',
    parentCode: '60',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '62',
    name: 'Расчеты с покупателями и заказчиками',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '62.01',
    name: 'Расчеты с покупателями и заказчиками',
    parentCode: '62',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '62.02',
    name: 'Расчеты по авансам полученным',
    parentCode: '62',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '66',
    name: 'Расчеты по краткосрочным кредитам и займам',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '66.01',
    name: 'Краткосрочные кредиты',
    parentCode: '66',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '66.02',
    name: 'Проценты по краткосрочным кредитам',
    parentCode: '66',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '66.03',
    name: 'Краткосрочные займы',
    parentCode: '66',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '66.04',
    name: 'Проценты по краткосрочным займам',
    parentCode: '66',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '67',
    name: 'Расчеты по долгосрочным кредитам и займам',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '67.01',
    name: 'Долгосрочные кредиты',
    parentCode: '67',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '67.02',
    name: 'Проценты по долгосрочным кредитам',
    parentCode: '67',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '67.03',
    name: 'Долгосрочные займы',
    parentCode: '67',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '67.04',
    name: 'Проценты по долгосрочным займам',
    parentCode: '67',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '68',
    name: 'Расчеты по налогам и сборам',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: true,
  },
  {
    code: '68.01',
    name: 'НДФЛ при исполнении обязанностей налогового агента',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '68.02',
    name: 'Налог на добавленную стоимость',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '68.04.1',
    name: 'Расчеты с бюджетом (Налог на прибыль)',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)', 'Уровни бюджетов'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '68.10',
    name: 'Прочие налоги и сборы (штрафы и санкции ИФНС)',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '68.90',
    name: 'Единый налоговый счет',
    parentCode: '68',
    type: 'active-passive',
    subconto: [],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '69',
    name: 'Расчеты по социальному страхованию и обеспечению',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: true,
  },
  {
    code: '69.01',
    name: 'Расчеты по социальному страхованию',
    parentCode: '69',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '69.02.7',
    name: 'Обязательное пенсионное страхование',
    parentCode: '69',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '69.09',
    name: 'Страховые взносы по единому тарифу',
    parentCode: '69',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '69.11',
    name: 'Расчеты по обязательному социальному страхованию от НС и ПЗ',
    parentCode: '69',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '70',
    name: 'Расчеты с персоналом по оплате труда',
    type: 'active-passive',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '71',
    name: 'Расчеты с подотчетными лицами',
    type: 'active-passive',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: true,
  },
  {
    code: '71.01',
    name: 'Расчеты с подотчетными лицами',
    parentCode: '71',
    type: 'active-passive',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '73',
    name: 'Расчеты с персоналом по прочим операциям',
    type: 'active-passive',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: true,
  },
  {
    code: '73.01',
    name: 'Расчеты по предоставленным займам',
    parentCode: '73',
    type: 'active',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '73.02',
    name: 'Расчеты по возмещению материального ущерба',
    parentCode: '73',
    type: 'active',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '73.03',
    name: 'Расчеты по прочим операциям с персоналом',
    parentCode: '73',
    type: 'active-passive',
    subconto: ['Работники организаций'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '75',
    name: 'Расчеты с учредителями',
    type: 'active-passive',
    subconto: ['Контрагенты'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '75.01',
    name: 'Расчеты по вкладам в уставный (складочный) капитал',
    parentCode: '75',
    type: 'active-passive',
    subconto: ['Контрагенты'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76',
    name: 'Расчеты с разными дебиторами и кредиторами',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '76.02',
    name: 'Расчеты по претензиям',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.09',
    name: 'Прочие расчеты с разными дебиторами и кредиторами',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.41',
    name: 'Расчеты по исполнительным документам работников',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Контрагенты (получатели удержаний)'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '76.АВ',
    name: 'НДС по авансам и предоплатам полученным',
    parentCode: '76',
    type: 'active',
    subconto: ['Контрагенты', 'Счета-фактуры выданные'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.ВА',
    name: 'НДС по авансам и предоплатам выданным',
    parentCode: '76',
    type: 'passive',
    subconto: ['Контрагенты', 'Счета-фактуры полученные'],
    category: 'Расчеты',
    isGroup: false,
  },

  // Раздел VII. Капитал
  {
    code: '80',
    name: 'Уставный капитал',
    type: 'passive',
    subconto: ['Контрагенты'],
    category: 'Капитал',
    isGroup: true,
  },
  {
    code: '80.09',
    name: 'Прочий капитал (Уставный капитал ООО)',
    parentCode: '80',
    type: 'passive',
    subconto: ['Контрагенты'],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '82',
    name: 'Резервный капитал',
    type: 'passive',
    subconto: [],
    category: 'Капитал',
    isGroup: true,
  },
  {
    code: '82.01',
    name: 'Резервный капитал',
    parentCode: '82',
    type: 'passive',
    subconto: [],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '83',
    name: 'Добавочный капитал',
    type: 'passive',
    subconto: [],
    category: 'Капитал',
    isGroup: true,
  },
  {
    code: '83.09',
    name: 'Другие источники добавочного капитала',
    parentCode: '83',
    type: 'passive',
    subconto: [],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '84',
    name: 'Нераспределенная прибыль (непокрытый убыток)',
    type: 'active-passive',
    subconto: [],
    category: 'Капитал',
    isGroup: true,
  },
  {
    code: '84.01',
    name: 'Прибыль, подлежащая распределению',
    parentCode: '84',
    type: 'active-passive',
    subconto: [],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '84.02',
    name: 'Убыток, подлежащий покрытию',
    parentCode: '84',
    type: 'active-passive',
    subconto: [],
    category: 'Капитал',
    isGroup: false,
  },

  // Раздел VIII. Финансовые результаты
  {
    code: '90',
    name: 'Продажи',
    type: 'active-passive',
    subconto: ['Номенклатурные группы'],
    category: 'Финансовые результаты',
    isGroup: true,
  },
  {
    code: '90.01.1',
    name: 'Выручка по деятельности с основной системой налогообложения',
    parentCode: '90',
    type: 'passive',
    subconto: ['Номенклатурные группы', 'Ставки НДС'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '90.02.1',
    name: 'Себестоимость продаж по деятельности с основной системой налогообложения',
    parentCode: '90',
    type: 'active',
    subconto: ['Номенклатурные группы'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '90.03',
    name: 'Налог на добавленную стоимость',
    parentCode: '90',
    type: 'active',
    subconto: ['Номенклатурные группы'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '90.08.1',
    name: 'Управленческие расходы по деятельности с основной системой налогообложения',
    parentCode: '90',
    type: 'active',
    subconto: [],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '90.09',
    name: 'Прибыль / убыток от продаж',
    parentCode: '90',
    type: 'active-passive',
    subconto: [],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '91',
    name: 'Прочие доходы и расходы',
    type: 'active-passive',
    subconto: ['Прочие доходы и расходы'],
    category: 'Финансовые результаты',
    isGroup: true,
  },
  {
    code: '91.01',
    name: 'Прочие доходы',
    parentCode: '91',
    type: 'passive',
    subconto: ['Прочие доходы и расходы'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '91.02',
    name: 'Прочие расходы',
    parentCode: '91',
    type: 'active',
    subconto: ['Прочие доходы и расходы'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '91.09',
    name: 'Сальдо прочих доходов и расходов',
    parentCode: '91',
    type: 'active-passive',
    subconto: [],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '99',
    name: 'Прибыли и убытки',
    type: 'active-passive',
    subconto: ['Прибыли и убытки'],
    category: 'Финансовые результаты',
    isGroup: true,
  },
  {
    code: '99.01.1',
    name: 'Прибыли и убытки по деятельности с основной системой налогообложения',
    parentCode: '99',
    type: 'active-passive',
    subconto: ['Прибыли и убытки'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '99.02.1',
    name: 'Текущий налог на прибыль',
    parentCode: '99',
    type: 'active-passive',
    subconto: ['Прибыли и убытки'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '99.02.3',
    name: 'Постоянное налоговое обязательство (налоговые санкции)',
    parentCode: '99',
    type: 'active',
    subconto: ['Прибыли и убытки'],
    category: 'Финансовые результаты',
    isGroup: false,
  },

  // Рабочие субсчета ОС, спецодежды и малоценного инвентаря 1С:БП 3.0 (ФСБУ 5/2019, ФСБУ 6/2020)
  {
    code: '08.04.1',
    name: 'Приобретение компонентов основных средств',
    parentCode: '08',
    type: 'active',
    subconto: ['Номенклатура', 'Склады', 'Партии'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '10.10',
    name: 'Специальная оснастка и специальная одежда на складе',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Склады', 'Партии'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.11.1',
    name: 'Специальная одежда в эксплуатации',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Материально ответственные лица'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.21.1',
    name: 'Приобретение малоценного оборудования и запасов',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Склады', 'Партии'],
    category: 'Производственные запасы',
    isGroup: false,
  },

  // Забалансовые счета контроля ТМЦ в эксплуатации 1С:БП 3.0
  {
    code: 'МЦ',
    name: 'Материальные ценности в эксплуатации (забалансовый)',
    type: 'active',
    subconto: ['Номенклатура', 'Работники организаций'],
    category: 'Забалансовые счета',
    isGroup: true,
    isOffBalance: true,
  },
  {
    code: 'МЦ.02',
    name: 'Спецодежда в эксплуатации (забалансовый учёт по МОЛ)',
    parentCode: 'МЦ',
    type: 'active',
    subconto: ['Номенклатура', 'Партии материалов в эксплуатации', 'Работники организаций'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: 'МЦ.04',
    name: 'Инвентарь и хозяйственные принадлежности в эксплуатации (забалансовый)',
    parentCode: 'МЦ',
    type: 'active',
    subconto: ['Номенклатура', 'Работники организаций'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },

  // Дополнительные субсчета полного Плана счетов 1С:БП 3.0 (разделы I–VIII + забаланс)
  {
    code: '02.02',
    name: 'Амортизация основных средств, учитываемых на счете 03',
    parentCode: '02',
    type: 'passive',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '03',
    name: 'Доходные вложения в материальные ценности',
    type: 'active',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: true,
  },
  {
    code: '03.01',
    name: 'Материальные ценности в организации',
    parentCode: '03',
    type: 'active',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '07',
    name: 'Оборудование к установке',
    type: 'active',
    subconto: ['Номенклатура', 'Склады', 'Партии'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '08.01',
    name: 'Приобретение земельных участков',
    parentCode: '08',
    type: 'active',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '08.03',
    name: 'Строительство объектов основных средств',
    parentCode: '08',
    type: 'active',
    subconto: ['Объекты строительства', 'Статьи затрат'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '08.04.2',
    name: 'Приобретение основных средств',
    parentCode: '08',
    type: 'active',
    subconto: ['Основные средства'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '08.05',
    name: 'Приобретение нематериальных активов',
    parentCode: '08',
    type: 'active',
    subconto: ['Нематериальные активы'],
    category: 'Внеоборотные активы',
    isGroup: false,
  },
  {
    code: '10.02',
    name: 'Покупные полуфабрикаты и комплектующие изделия',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.06',
    name: 'Прочие материалы',
    parentCode: '10',
    type: 'active',
    subconto: ['Номенклатура', 'Партии', 'Склады'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '10.07',
    name: 'Материалы, переданные в переработку на сторону',
    parentCode: '10',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура', 'Партии'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '11',
    name: 'Животные на выращивании и откорме',
    type: 'active',
    subconto: ['Номенклатура'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '14',
    name: 'Резервы под снижение стоимости материальных ценностей',
    type: 'passive',
    subconto: ['Номенклатура'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '15',
    name: 'Заготовление и приобретение материальных ценностей',
    type: 'active',
    subconto: ['Номенклатура'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '16',
    name: 'Отклонение в стоимости материальных ценностей',
    type: 'active-passive',
    subconto: ['Номенклатура'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '19.02',
    name: 'НДС по приобретенным нематериальным активам',
    parentCode: '19',
    type: 'active',
    subconto: ['Контрагенты', 'Счета-фактуры полученные', 'Способы учета НДС'],
    category: 'Производственные запасы',
    isGroup: false,
  },
  {
    code: '21',
    name: 'Полуфабрикаты собственного производства',
    type: 'active',
    subconto: ['Номенклатура', 'Склады', 'Партии'],
    category: 'Затраты на производство',
    isGroup: false,
  },
  {
    code: '23',
    name: 'Вспомогательные производства',
    type: 'active',
    subconto: ['Номенклатурные группы', 'Статьи затрат'],
    category: 'Затраты на производство',
    isGroup: true,
  },
  {
    code: '23.01',
    name: 'Основное вспомогательное производство',
    parentCode: '23',
    type: 'active',
    subconto: ['Номенклатурные группы', 'Статьи затрат'],
    category: 'Затраты на производство',
    isGroup: false,
  },
  {
    code: '28',
    name: 'Брак в производстве',
    type: 'active',
    subconto: ['Подразделения', 'Номенклатура', 'Статьи затрат'],
    category: 'Затраты на производство',
    isGroup: false,
  },
  {
    code: '29',
    name: 'Обслуживающие производства и хозяйства',
    type: 'active',
    subconto: ['Подразделения', 'Статьи затрат'],
    category: 'Затраты на производство',
    isGroup: false,
  },
  {
    code: '40',
    name: 'Выпуск продукции (работ, услуг)',
    type: 'active-passive',
    subconto: ['Номенклатурные группы'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '41.02',
    name: 'Товары в розничной торговле (по покупной стоимости)',
    parentCode: '41',
    type: 'active',
    subconto: ['Номенклатура', 'Склады'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '42',
    name: 'Торговая наценка',
    type: 'passive',
    subconto: ['Склады'],
    category: 'Готовая продукция и товары',
    isGroup: true,
  },
  {
    code: '42.01',
    name: 'Торговая наценка в автоматизированных торговых точках',
    parentCode: '42',
    type: 'passive',
    subconto: ['Номенклатура', 'Склады'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '44.02',
    name: 'Коммерческие расходы в организациях, осуществляющих промышленную и иную производственную деятельность',
    parentCode: '44',
    type: 'active',
    subconto: ['Статьи затрат'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '45',
    name: 'Товары отгруженные',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура', 'Договоры'],
    category: 'Готовая продукция и товары',
    isGroup: true,
  },
  {
    code: '45.01',
    name: 'Покупные товары отгруженные',
    parentCode: '45',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура', 'Договоры'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '46',
    name: 'Выполненные этапы по незавершенным работам',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Готовая продукция и товары',
    isGroup: false,
  },
  {
    code: '50.02',
    name: 'Операционная касса',
    parentCode: '50',
    type: 'active',
    subconto: ['Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '50.03',
    name: 'Денежные документы',
    parentCode: '50',
    type: 'active',
    subconto: ['Денежные документы'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '52',
    name: 'Валютные счета',
    type: 'active',
    subconto: ['Банковские счета', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '55.01',
    name: 'Аккредитивы',
    parentCode: '55',
    type: 'active',
    subconto: ['Банковские счета', 'Статьи движения денежных средств'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '55.03',
    name: 'Депозитные счета',
    parentCode: '55',
    type: 'active',
    subconto: ['Банковские счета', 'Договоры'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '57.02',
    name: 'Приобретение иностранной валюты',
    parentCode: '57',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '57.03',
    name: 'Продажи по платежным картам (эквайринг)',
    parentCode: '57',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры эквайринга'],
    category: 'Денежные средства',
    isGroup: false,
  },
  {
    code: '58.01.1',
    name: 'Паи',
    parentCode: '58',
    type: 'active',
    subconto: ['Контрагенты'],
    category: 'Денежные средства и финансовые вложения',
    isGroup: false,
  },
  {
    code: '58.01.2',
    name: 'Акции',
    parentCode: '58',
    type: 'active',
    subconto: ['Контрагенты', 'Ценные бумаги'],
    category: 'Денежные средства и финансовые вложения',
    isGroup: false,
  },
  {
    code: '59',
    name: 'Резервы под обесценение финансовых вложений',
    type: 'passive',
    subconto: ['Контрагенты'],
    category: 'Денежные средства и финансовые вложения',
    isGroup: false,
  },
  {
    code: '60.03',
    name: 'Векселя выданные',
    parentCode: '60',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '62.03',
    name: 'Векселя полученные',
    parentCode: '62',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '63',
    name: 'Резервы по сомнительным долгам',
    type: 'passive',
    subconto: ['Контрагенты', 'Договоры', 'Документы расчетов с контрагентами'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '68.07',
    name: 'Транспортный налог',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '68.08',
    name: 'Налог на имущество',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '68.12',
    name: 'Налог при упрощенной системе налогообложения',
    parentCode: '68',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '69.03.1',
    name: 'Федеральный фонд обязательного медицинского страхования',
    parentCode: '69',
    type: 'active-passive',
    subconto: ['Виды платежей в бюджет (фонды)'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '75.02',
    name: 'Расчеты по выплате доходов (дивидендов)',
    parentCode: '75',
    type: 'active-passive',
    subconto: ['Контрагенты'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.01.9',
    name: 'Платежи (взносы) по прочим видам страхования',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры', 'Расходы будущих периодов'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.05',
    name: 'Расчеты с прочими поставщиками и подрядчиками',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.06',
    name: 'Расчеты с прочими покупателями и заказчиками',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '76.10',
    name: 'Прочие расчеты с физическими лицами (ГПХ)',
    parentCode: '76',
    type: 'active-passive',
    subconto: ['Физические лица', 'Договоры'],
    category: 'Расчеты с персоналом',
    isGroup: false,
  },
  {
    code: '77',
    name: 'Отложенные налоговые обязательства',
    type: 'passive',
    subconto: ['Виды активов и обязательств'],
    category: 'Расчеты по налогам и взносам',
    isGroup: false,
  },
  {
    code: '79',
    name: 'Внутрихозяйственные расчеты',
    type: 'active-passive',
    subconto: ['Подразделения'],
    category: 'Расчеты',
    isGroup: true,
  },
  {
    code: '79.01',
    name: 'Расчеты по выделенному имуществу',
    parentCode: '79',
    type: 'active-passive',
    subconto: ['Подразделения'],
    category: 'Расчеты',
    isGroup: false,
  },
  {
    code: '80.01',
    name: 'Обыкновенные акции',
    parentCode: '80',
    type: 'passive',
    subconto: ['Контрагенты'],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '81',
    name: 'Собственные акции (доли)',
    type: 'active',
    subconto: ['Контрагенты'],
    category: 'Капитал',
    isGroup: true,
  },
  {
    code: '81.09',
    name: 'Прочий капитал (выкупленные доли)',
    parentCode: '81',
    type: 'active',
    subconto: ['Контрагенты'],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '86',
    name: 'Целевое финансирование',
    type: 'passive',
    subconto: ['Назначение целевых средств'],
    category: 'Капитал',
    isGroup: true,
  },
  {
    code: '86.01',
    name: 'Целевое финансирование из бюджета',
    parentCode: '86',
    type: 'passive',
    subconto: ['Назначение целевых средств'],
    category: 'Капитал',
    isGroup: false,
  },
  {
    code: '90.07.1',
    name: 'Расходы на продажу по деятельности с основной системой налогообложения',
    parentCode: '90',
    type: 'active',
    subconto: ['Номенклатурные группы'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '94',
    name: 'Недостачи и потери от порчи ценностей',
    type: 'active',
    subconto: [],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '96',
    name: 'Резервы предстоящих расходов',
    type: 'passive',
    subconto: ['Оценочные обязательства и резервы'],
    category: 'Финансовые результаты',
    isGroup: true,
  },
  {
    code: '96.01',
    name: 'Оценочные обязательства по вознаграждениям работникам',
    parentCode: '96',
    type: 'passive',
    subconto: ['Оценочные обязательства и резервы'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '97',
    name: 'Расходы будущих периодов',
    type: 'active',
    subconto: ['Расходы будущих периодов'],
    category: 'Финансовые результаты',
    isGroup: true,
  },
  {
    code: '97.21',
    name: 'Прочие расходы будущих периодов',
    parentCode: '97',
    type: 'active',
    subconto: ['Расходы будущих периодов'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '98',
    name: 'Доходы будущих периодов',
    type: 'passive',
    subconto: ['Доходы будущих периодов'],
    category: 'Финансовые результаты',
    isGroup: true,
  },
  {
    code: '98.01',
    name: 'Доходы, полученные в счет будущих периодов',
    parentCode: '98',
    type: 'passive',
    subconto: ['Доходы будущих периодов'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '98.02',
    name: 'Безвозмездные поступления',
    parentCode: '98',
    type: 'passive',
    subconto: ['Безвозмездные поступления'],
    category: 'Финансовые результаты',
    isGroup: false,
  },
  {
    code: '001',
    name: 'Арендованные основные средства (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Основные средства'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: '002',
    name: 'Товарно-материальные ценности, принятые на ответственное хранение (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: '003',
    name: 'Материалы, принятые в переработку (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура'],
    category: 'Забалансовые счета',
    isGroup: true,
    isOffBalance: true,
  },
  {
    code: '003.01',
    name: 'Материалы на складе, принятые в переработку (забалансовый)',
    parentCode: '003',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура', 'Склады'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: '004.01',
    name: 'Товары на складе, принятые на комиссию (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Номенклатура', 'Склады'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: '007',
    name: 'Списанная в убыток задолженность неплатежеспособных дебиторов (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: '008',
    name: 'Обеспечения обязательств и платежей полученные (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: '009',
    name: 'Обеспечения обязательств и платежей выданные (забалансовый)',
    type: 'active',
    subconto: ['Контрагенты', 'Договоры'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },
  {
    code: 'МЦ.03',
    name: 'Спецоснастка в эксплуатации (забалансовый)',
    parentCode: 'МЦ',
    type: 'active',
    subconto: ['Номенклатура', 'Работники организаций'],
    category: 'Забалансовые счета',
    isGroup: false,
    isOffBalance: true,
  },

  // Вспомогательный счет 1С 8.3
  {
    code: '000',
    name: 'Вспомогательный счет (для ввода начальных остатков в 1С 8.3)',
    type: 'active-passive',
    subconto: [],
    category: 'Вспомогательный',
    isGroup: false,
  },
];

export const ACCOUNT_MAP: Record<string, AccountInfo> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((acc) => [acc.code, acc])
);

export const GROUP_TO_DEFAULT_SUBACCOUNT_1C: Record<string, string> = {
  '01': '01.01',
  '02': '02.01',
  '03': '03.01',
  '04': '04.01',
  '08': '08.04.1',
  '10': '10.01',
  '19': '19.03',
  '20': '20.01',
  '23': '23.01',
  '41': '41.01',
  '42': '42.01',
  '44': '44.01',
  '45': '45.01',
  '50': '50.01',
  '55': '55.04',
  '57': '57.01',
  '58': '58.02',
  '60': '60.01',
  '62': '62.01',
  '66': '66.03',
  '67': '67.03',
  '68': '68.02',
  '69': '69.09',
  '71': '71.01',
  '73': '73.03',
  '75': '75.01',
  '76': '76.09',
  '79': '79.01',
  '80': '80.09',
  '81': '81.09',
  '82': '82.01',
  '83': '83.09',
  '84': '84.01',
  '86': '86.01',
  '90': '90.01.1',
  '91': '91.02',
  '96': '96.01',
  '97': '97.21',
  '98': '98.02',
  '99': '99.01.1',
  '003': '003.01',
  '004': '004.01',
  'МЦ': 'МЦ.04',
};

export function normalizeAccountToLeaf1C(
  rawCode: string,
  side?: 'debit' | 'credit',
  textHint = ''
): string {
  const clean = (rawCode ?? '')
    .trim()
    .replace(/^MC\b/i, 'МЦ')
    .replace(/^76\.(?:AB|ab)$/i, '76.АВ')
    .replace(/^76\.(?:BA|ba)$/i, '76.ВА');
  if (!clean) return '';

  const lower = textHint.toLowerCase();

  // Context-aware disambiguation for group accounts before default fallback
  if (clean === '08') {
    if (/нма|нематериал|лиценз|программ|патент|товарн\w+\s+знак/i.test(lower)) return '08.05';
    if (/строител|подряд\w+\s+смр/i.test(lower)) return '08.03';
    return '08.04.1';
  }
  if (clean === '10') {
    if (/спецодежд|каск|перчат|жилет|сиз/i.test(lower)) return '10.10';
    if (/гсм|бензин|дизел|топлив/i.test(lower)) return '10.03';
    if (/кирпич|цемент|бетон|песок|щебен|арматур|плитк|гипсокартон/i.test(lower)) return '10.08';
    if (/запчаст|подшипник|фильтр|шин/i.test(lower)) return '10.05';
    if (/канцтовар|бумаг|картридж|инвентар|хозтовар/i.test(lower)) return '10.09';
    return '10.01';
  }
  if (clean === '19') {
    if (/нма|нематериал/i.test(lower)) return '19.02';
    if (/основн\w+\s+средств|оборудован|станок/i.test(lower)) return '19.01';
    if (/услуг|аренд|связ|доставк|консультац/i.test(lower)) return '19.04';
    return '19.03';
  }
  if (clean === '55') {
    if (/аккредитив/i.test(lower)) return '55.01';
    if (/депозит/i.test(lower)) return '55.03';
    return '55.04';
  }
  if (clean === '57') {
    if (/эквайринг|карт|терминал/i.test(lower)) return '57.03';
    return '57.01';
  }
  if (clean === '58') {
    if (/займ\s+выдан|предоставлен\w+\s+займ/i.test(lower)) return '58.03';
    if (/акци[ийя]/i.test(lower)) return '58.01.2';
    if (/па[ий]/i.test(lower)) return '58.01.1';
    return '58.02';
  }
  if (clean === '60') {
    if (/аванс|предоплат/i.test(lower)) return '60.02';
    return '60.01';
  }
  if (clean === '62') {
    if (/аванс|предоплат/i.test(lower)) return '62.02';
    return '62.01';
  }
  if (clean === '66') {
    if (/процент/i.test(lower)) return /кредит/i.test(lower) ? '66.02' : '66.04';
    if (/кредит\s+банк|банковск\w+\s+кредит/i.test(lower)) return '66.01';
    return '66.03';
  }
  if (clean === '67') {
    if (/процент/i.test(lower)) return /кредит/i.test(lower) ? '67.02' : '67.04';
    if (/кредит\s+банк|банковск\w+\s+кредит/i.test(lower)) return '67.01';
    return '67.03';
  }
  if (clean === '68') {
    if (/ндфл|подоходн/i.test(lower)) return '68.01';
    if (/прибыл/i.test(lower)) return '68.04.1';
    if (/имуществ/i.test(lower)) return '68.08';
    if (/транспорт/i.test(lower)) return '68.07';
    if (/енс|един\w+\s+налог/i.test(lower)) return '68.90';
    return '68.02';
  }
  if (clean === '69') {
    if (/несчастн|травматизм|нс\s*и\s*пз/i.test(lower)) return '69.11';
    return '69.09';
  }
  if (clean === '73') {
    if (/займ|ссуд/i.test(lower)) return '73.01';
    if (/недостач|ущерб|порч|виновн/i.test(lower)) return '73.02';
    return '73.03';
  }
  if (clean === '75') {
    if (/дивиденд|доход\w+\s+учредит|распределен\w+\s+прибыл/i.test(lower)) return '75.02';
    return '75.01';
  }
  if (clean === '76') {
    if (/алимент|исполнительн\w+\s+лист/i.test(lower)) return '76.41';
    if (/претенз|штраф|пен[ия]|неустойк/i.test(lower)) return '76.02';
    if (/страхован\w+\s+имуществ|осаго|каско|дмс/i.test(lower)) return '76.01.9';
    return '76.09';
  }
  if (clean === '84') {
    if (/убыт/i.test(lower) && side === 'debit' && !/распределен|дивиденд/i.test(lower)) {
      return '84.02';
    }
    return '84.01';
  }
  if (clean === '90') {
    if (side === 'credit') return '90.01.1';
    if (/ндс/i.test(lower)) return '90.03';
    if (/управленческ/i.test(lower)) return '90.08.1';
    if (/расход\w+\s+на\s+продаж|коммерческ/i.test(lower)) return '90.07.1';
    return '90.02.1';
  }
  if (clean === '91') {
    return side === 'credit' ? '91.01' : '91.02';
  }
  if (clean === 'МЦ') {
    return /спецодежд|каск|перчат|сиз/i.test(lower) ? 'МЦ.02' : 'МЦ.04';
  }
  if (clean === '90.01' || clean === '90.1') return '90.01.1';
  if (clean === '90.02' || clean === '90.2') return '90.02.1';
  if (clean === '90.3') return '90.03';
  if (clean === '90.07' || clean === '90.7') return '90.07.1';
  if (clean === '90.08' || clean === '90.8') return '90.08.1';
  if (clean === '90.9') return '90.09';
  if (clean === '91.1') return '91.01';
  if (clean === '91.2') return '91.02';
  if (clean === '91.9') return '91.09';
  if (clean === '99.01' || clean === '99.1') return '99.01.1';
  if (clean === '99.02' || clean === '99.2') return '99.02.1';
  if (clean === '68.04' || clean === '68.4') return '68.04.1';
  if (clean === '20.1') return '20.01';
  if (clean === '51.01' || clean === '51.1') return '51';
  if (clean === '50.1') return '50.01';
  if (clean === '71.1') return '71.01';
  if (clean === '73.1') return '73.01';
  if (clean === '73.2') return '73.02';
  if (clean === '73.3') return '73.03';
  if (clean === '76.2') return '76.02';
  if (clean === '76.9') return '76.09';

  if (GROUP_TO_DEFAULT_SUBACCOUNT_1C[clean]) {
    return GROUP_TO_DEFAULT_SUBACCOUNT_1C[clean];
  }
  const info = ACCOUNT_MAP[clean];
  if (info?.isGroup) {
    const child = CHART_OF_ACCOUNTS.find((a) => a.parentCode === clean && !a.isGroup);
    if (child) return child.code;
  }
  return clean;
}

export function isOffBalanceAccountCode(rawCode: string): boolean {
  const clean = (rawCode ?? '').trim().toUpperCase();
  if (!clean) return false;
  if (
    clean.startsWith('МЦ') ||
    clean.startsWith('MC') ||
    clean.startsWith('ГТД') ||
    clean.startsWith('РВ')
  ) {
    return true;
  }
  if (/^00[1-9](?:\.|$)|^01[01](?:\.|$)/.test(clean)) {
    return true;
  }
  return Boolean(ACCOUNT_MAP[clean]?.isOffBalance);
}

export function getAccountInfo(code: string): AccountInfo {
  const normalized = code.trim();
  if (ACCOUNT_MAP[normalized]) {
    return ACCOUNT_MAP[normalized];
  }

  const upper = normalized.toUpperCase();
  if (ACCOUNT_MAP[upper]) {
    return ACCOUNT_MAP[upper];
  }

  if (isOffBalanceAccountCode(upper)) {
    return {
      code: upper,
      name: `Забалансовый счёт ${upper}`,
      type: 'active',
      subconto: ['Номенклатура', 'Работники организаций'],
      category: 'Забалансовые счета',
      isGroup: false,
      isOffBalance: true,
    };
  }

  const rootCode = normalized.includes('.') ? normalized.split('.')[0] : undefined;
  const parentInfo = rootCode ? ACCOUNT_MAP[rootCode] : undefined;

  return {
    code: normalized,
    name: parentInfo ? `${parentInfo.name} (${normalized})` : `Счет ${normalized}`,
    parentCode: parentInfo?.isGroup ? rootCode : undefined,
    type: parentInfo?.type ?? 'active-passive',
    subconto: parentInfo?.subconto ?? [],
    category: parentInfo?.category ?? 'Прочие счета',
    isGroup: false,
  };
}
