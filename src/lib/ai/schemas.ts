import { z } from 'zod';
import type {
  BusinessOperation,
  CounterpartyCard1C,
  DocumentField1C,
  EmployeeCard1C,
  ExtractedDirectories1C,
  JournalPosting,
  NomenclatureCard1C,
  OpeningBalanceEntry,
  OrganizationCard,
  PitfallWarning,
  SmartLinkRule,
  VatMathBreakdown,
} from '@/types/accounting';

const optionalString = z
  .string()
  .nullish()
  .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined));

const optionalBoolean = z
  .boolean()
  .nullish()
  .transform((val) => (val === null ? undefined : val));

const optionalNumber = z
  .number()
  .nullish()
  .transform((val) => (val === null || Number.isNaN(val) ? undefined : val));

export const SmartLinkRuleSchema: z.ZodType<SmartLinkRule, z.ZodTypeDef, unknown> = z.object({
  accountCode: z.string().min(1),
  side: z.enum(['debit', 'credit', 'net']).catch('credit'),
  matchSubconto1: optionalString,
  matchContract: optionalString,
  description: z.string().default('Сумма определяется по данным начальных остатков'),
});

export const DocumentField1CSchema: z.ZodType<DocumentField1C, z.ZodTypeDef, unknown> = z.object({
  label: z.string().min(1),
  value: z.string().default('—'),
  copyable: z
    .boolean()
    .nullish()
    .transform((v) => v ?? true),
  highlight: optionalBoolean,
});

export const VatMathBreakdownSchema: z.ZodType<VatMathBreakdown, z.ZodTypeDef, unknown> = z.object({
  quantity: optionalNumber,
  unit: optionalString,
  unitPrice: optionalNumber,
  totalWithVat: z.number().default(0),
  vatRate: z.number().default(20),
  vatMode: z.enum(['included', 'on_top', 'none']).catch('included'),
  vatAmount: z.number().default(0),
  amountWithoutVat: z.number().default(0),
  steps: z.array(z.string()).default([]),
});

export const JournalPostingSchema: z.ZodType<JournalPosting, z.ZodTypeDef, unknown> = z
  .object({
    id: optionalString,
    debitAccount: z.string().min(1),
    debitSubconto: z.array(z.string()).default([]),
    creditAccount: z.string().min(1),
    creditSubconto: z.array(z.string()).default([]),
    amount: z.number().default(0),
    comment: z.string().default(''),
    formulaHint: optionalString,
    proportionOfTotal: z
      .enum(['full', 'net_without_vat', 'vat_only', 'custom'])
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .transform((p, ctx): JournalPosting => {
    const fallbackId = `post-${p.debitAccount}-${p.creditAccount}-${ctx.path.join('-') || '0'}`;
    return {
      id: p.id ?? fallbackId,
      debitAccount: p.debitAccount.trim(),
      debitSubconto: p.debitSubconto,
      creditAccount: p.creditAccount.trim(),
      creditSubconto: p.creditSubconto,
      amount: Math.round((p.amount + Number.EPSILON) * 100) / 100,
      comment: p.comment,
      formulaHint: p.formulaHint,
      proportionOfTotal: p.proportionOfTotal,
    };
  });

export const PitfallWarningSchema: z.ZodType<PitfallWarning, z.ZodTypeDef, unknown> = z.object({
  severity: z.enum(['info', 'warning', 'critical']).catch('info'),
  title: z.string().min(1),
  description: z.string().min(1),
  checkType: z
    .enum([
      'cash_balance',
      'bank_balance',
      'advance_offset',
      'penalty_split',
      'closing_subconto',
      'general',
    ])
    .nullish()
    .transform((v) => v ?? 'general'),
});

export const ParsedOperationSchema: z.ZodType<BusinessOperation, z.ZodTypeDef, unknown> = z
  .object({
    id: optionalString,
    number: z.union([z.number(), z.string()]),
    date: z.string().default('01.04.2026'),
    shortTitle: optionalString,
    rawDescription: z.string().min(1),
    explicitAmount: z
      .number()
      .nullable()
      .catch(null)
      .transform((v) => (v === null || Number.isNaN(v) ? null : Math.round((v + Number.EPSILON) * 100) / 100)),
    resolvedAmount: optionalNumber,
    isMonthEndClosing: optionalBoolean,
    status: z
      .enum(['pending', 'in_progress', 'done', 'needs_data'])
      .nullish()
      .transform((v) => v ?? undefined),
    missingDataReason: optionalString,
    smartLink: SmartLinkRuleSchema.nullish().transform((v) => v ?? undefined),
    menuPath1C: z.array(z.string()).min(1).catch(['Операции', 'Бухгалтерский учет', 'Операции, введенные вручную']),
    documentType1C: z.string().default('Операция, введенная вручную'),
    operationKind1C: z.string().default('Прочее'),
    hasUpdOrSf: z.boolean().default(false),
    updLabel: optionalString,
    documentFields: z.array(DocumentField1CSchema).default([]),
    vatBreakdown: VatMathBreakdownSchema.nullish().transform((v) => v ?? undefined),
    postings: z.array(JournalPostingSchema).default([]),
    pitfalls: z.array(PitfallWarningSchema).default([]),
  })
  .transform((op, ctx): BusinessOperation => {
    const indexKey = ctx.path.join('-') || String(op.number);
    const id = op.id ?? `op-parsed-${indexKey}-${String(op.number)}`;
    const resolvedAmount =
      op.resolvedAmount !== undefined
        ? Math.round((op.resolvedAmount + Number.EPSILON) * 100) / 100
        : op.explicitAmount ?? 0;
    const effectiveSmartLink = op.explicitAmount === null ? op.smartLink : undefined;
    const status =
      op.status ?? (op.explicitAmount === null && resolvedAmount <= 0 ? 'needs_data' : 'pending');

    const postingsWithIds = op.postings.map((posting, idx) => ({
      ...posting,
      id: posting.id || `${id}-p${idx + 1}`,
    }));

    return {
      id,
      number: op.number,
      date: op.date,
      shortTitle: op.shortTitle,
      rawDescription: op.rawDescription,
      explicitAmount: op.explicitAmount,
      resolvedAmount,
      isMonthEndClosing: op.isMonthEndClosing,
      status,
      missingDataReason:
        op.missingDataReason ??
        (status === 'needs_data'
          ? effectiveSmartLink?.description ||
            'Сумма не указана в условии — проверьте связанные начальные остатки.'
          : undefined),
      smartLink: effectiveSmartLink,
      menuPath1C: op.menuPath1C,
      documentType1C: op.documentType1C,
      operationKind1C: op.operationKind1C,
      hasUpdOrSf: op.hasUpdOrSf,
      updLabel: op.updLabel,
      documentFields: op.documentFields,
      vatBreakdown: op.vatBreakdown,
      postings: postingsWithIds,
      pitfalls: op.pitfalls,
    };
  });

export const CounterpartyCard1CSchema: z.ZodType<CounterpartyCard1C, z.ZodTypeDef, unknown> = z
  .object({
    id: optionalString,
    name: z.string().min(1),
    fullName: optionalString,
    inn: z.string().default('7701234560'),
    kpp: z.string().default('770101001'),
    bankAccount: z.string().default('40702810400000010203'),
    bankName: z.string().default('ПАО Сбербанк'),
    bik: z.string().default('044525225'),
    contractKind: z.enum(['С поставщиком', 'С покупателем', 'Прочее']).catch('С поставщиком'),
    contractNumber: z.string().default('Договор №1'),
    contractDate: z.string().default('01.04.2026'),
    createdIn1C: optionalBoolean,
  })
  .transform((cp, ctx): CounterpartyCard1C => ({
    id: cp.id ?? `cp-parsed-${ctx.path.join('-') || cp.name}`,
    name: cp.name,
    fullName: cp.fullName ?? cp.name,
    inn: cp.inn,
    kpp: cp.kpp,
    bankAccount: cp.bankAccount,
    bankName: cp.bankName,
    bik: cp.bik,
    contractKind: cp.contractKind,
    contractNumber: cp.contractNumber,
    contractDate: cp.contractDate,
    createdIn1C: cp.createdIn1C ?? false,
  }));

export const NomenclatureCard1CSchema: z.ZodType<NomenclatureCard1C, z.ZodTypeDef, unknown> = z
  .object({
    id: optionalString,
    name: z.string().min(1),
    kind: z
      .enum(['Товары', 'Материалы', 'Услуги / Субподрядные работы', 'Продукция / СМР'])
      .catch('Товары'),
    unit: z.string().default('шт'),
    accountCode: z.string().default('41.01'),
    vatAccountCode: z.string().default('19.03'),
    nomenclatureGroup: optionalString,
    expenseItem: optionalString,
    defaultVatRate: z.number().default(20),
    createdIn1C: optionalBoolean,
  })
  .transform((nom, ctx): NomenclatureCard1C => ({
    id: nom.id ?? `nom-parsed-${ctx.path.join('-') || nom.name}`,
    name: nom.name,
    kind: nom.kind,
    unit: nom.unit,
    accountCode: nom.accountCode,
    vatAccountCode: nom.vatAccountCode,
    nomenclatureGroup: nom.nomenclatureGroup,
    expenseItem: nom.expenseItem,
    defaultVatRate: nom.defaultVatRate,
    createdIn1C: nom.createdIn1C ?? false,
  }));

export const EmployeeCard1CSchema: z.ZodType<EmployeeCard1C, z.ZodTypeDef, unknown> = z
  .object({
    id: optionalString,
    fullName: z.string().min(1),
    position: z.string().default('Специалист'),
    department: z.string().default('Основное подразделение'),
    salary: z.number().default(65000),
    hireDate: z.string().default('01.01.2026'),
    costAccount: z.string().default('26'),
    nomenclatureGroup: optionalString,
    createdIn1C: optionalBoolean,
  })
  .transform((emp, ctx): EmployeeCard1C => ({
    id: emp.id ?? `emp-parsed-${ctx.path.join('-') || emp.fullName}`,
    fullName: emp.fullName,
    position: emp.position,
    department: emp.department,
    salary: emp.salary,
    hireDate: emp.hireDate,
    costAccount: emp.costAccount,
    nomenclatureGroup: emp.nomenclatureGroup,
    createdIn1C: emp.createdIn1C ?? false,
  }));

export const ExtractedDirectoriesSchema: z.ZodType<
  ExtractedDirectories1C,
  z.ZodTypeDef,
  unknown
> = z.object({
  counterparties: z.array(CounterpartyCard1CSchema).default([]),
  nomenclature: z.array(NomenclatureCard1CSchema).default([]),
  nomenclatureGroups: z.array(z.string()).default([]),
  expenseItems: z.array(z.string()).default([]),
  cashFlowItems: z.array(z.string()).default([]),
  employees: z.array(EmployeeCard1CSchema).default([]),
});

export const ParsedTaskResponseSchema = z.object({
  title: z.string().default('Распознанный журнал хозяйственных операций (1С 8.3)'),
  operations: z.array(ParsedOperationSchema).min(1),
  directories: ExtractedDirectoriesSchema.default({
    counterparties: [],
    nomenclature: [],
    nomenclatureGroups: [],
    expenseItems: [],
    cashFlowItems: [],
    employees: [],
  }),
  warnings: z.array(z.string()).default([]),
});

export type ParsedTaskResponse = z.infer<typeof ParsedTaskResponseSchema>;

export const TASK_PARSER_JSON_SCHEMA_DESCRIPTION = `{
  "title": "string — название учебной задачи или организации и периода",
  "operations": [
    {
      "number": "number | string — порядковый номер операции (1, 2, 3...)",
      "date": "string — дата операции в формате ДД.ММ.ГГГГ",
      "rawDescription": "string — полный исходный текст содержания операции",
      "explicitAmount": "number | null — явная итоговая сумма в рублях (или null, если в таблице пусто / '?' / нужно взять из начальных остатков!)",
      "smartLink": {
        "accountCode": "string — код счета начальных остатков, например '68.02', '70', '62.01', '60.01'",
        "side": "'debit' | 'credit' | 'net'",
        "matchSubconto1": "string | undefined — наименование контрагента или налога (опционально)",
        "matchContract": "string | undefined — номер договора, например '177' (опционально)",
        "description": "string — пояснение на русском языке, откуда берется сумма"
      },
      "menuPath1C": ["Раздел 1С 8.3 Такси", "Подраздел", "Журнал документов", "Вид документа"],
      "documentType1C": "string — точное название документа в 1С:Бухгалтерия 8.3 (редакция 3.0)",
      "operationKind1C": "string — точный Вид операции внутри документа 1С 8.3",
      "hasUpdOrSf": "boolean — требуется ли включить тумблер УПД / зарегистрировать Счет-фактуру",
      "updLabel": "string | undefined — подпись к тумблеру УПД / СФ (например, 'Тумблер «УПД» ВКЛ — №415')",
      "documentFields": [
        {
          "label": "string — название поля документа 1С",
          "value": "string — значение для копирования в 1С",
          "copyable": true,
          "highlight": "boolean | undefined"
        }
      ],
      "vatBreakdown": {
        "quantity": "number | undefined",
        "unit": "string | undefined",
        "unitPrice": "number | undefined",
        "totalWithVat": "number — итоговая сумма с НДС",
        "vatRate": "number — ставка НДС (например 20, 22, 10, 0)",
        "vatMode": "'included' | 'on_top' | 'none'",
        "vatAmount": "number — сумма НДС с точностью до копеек",
        "amountWithoutVat": "number — сумма без НДС",
        "steps": ["string — пошаговые формулы расчета для студента"]
      },
      "postings": [
        {
          "debitAccount": "string — точный субсчет Дт по Плану счетов 1С 8.3 (например '41.01', '19.03', '20.01', '60.02', '68.02', '91.02', '99.02.3')",
          "debitSubconto": ["Субконто 1", "Субконто 2"],
          "creditAccount": "string — точный субсчет Кт (например '51', '50.01', '60.01', '90.01.1')",
          "creditSubconto": ["Субконто 1", "Субконто 2"],
          "amount": "number — сумма проводки в рублях до копеек",
          "comment": "string — экономический смысл проводки",
          "formulaHint": "string | undefined",
          "proportionOfTotal": "'full' | 'net_without_vat' | 'vat_only' | 'custom'"
        }
      ],
      "pitfalls": [
        {
          "severity": "'info' | 'warning' | 'critical'",
          "title": "string — краткий заголовок проверки / подводного камня 1С 8.3",
          "description": "string — подробное объяснение для студента",
          "checkType": "'cash_balance' | 'bank_balance' | 'advance_offset' | 'penalty_split' | 'closing_subconto' | 'general'"
        }
      ]
    }
  ],
  "directories": {
    "counterparties": [
      {
        "name": "ООО «ПромКомплект»",
        "fullName": "Общество с ограниченной ответственностью «ПромКомплект»",
        "inn": "7714852963",
        "kpp": "771401001",
        "bankAccount": "40702810538000124578",
        "bankName": "ПАО Сбербанк",
        "bik": "044525225",
        "contractKind": "'С поставщиком' | 'С покупателем' | 'Прочее'",
        "contractNumber": "Договор №12-ПК",
        "contractDate": "01.04.2026"
      }
    ],
    "nomenclature": [
      {
        "name": "Кровельные аэраторы",
        "kind": "'Товары' | 'Материалы' | 'Услуги / Субподрядные работы' | 'Продукция / СМР'",
        "unit": "шт",
        "accountCode": "41.01",
        "vatAccountCode": "19.03",
        "nomenclatureGroup": "Оптовая торговля",
        "expenseItem": "Материальные расходы",
        "defaultVatRate": 20
      }
    ],
    "nomenclatureGroups": ["string"],
    "expenseItems": ["string"],
    "cashFlowItems": ["string"],
    "employees": [
      {
        "fullName": "Соколов Алексей Викторович",
        "position": "Прораб",
        "department": "Строительный участок",
        "salary": 95000,
        "hireDate": "10.01.2026",
        "costAccount": "20.01",
        "nomenclatureGroup": "Ремонт кровли с установкой кирпичной трубы"
      }
    ]
  },
  "warnings": ["string — предупреждения парсера, если в условии есть неоднозначности"]
}`;

export function buildTaskParserSystemPrompt(
  organization?: OrganizationCard,
  openingBalances?: OpeningBalanceEntry[]
): string {
  const vatRate = organization?.defaultVatRate ?? 20;
  const taxSystem = organization?.taxSystem ?? 'OSNO';
  const orgName = organization?.name ?? 'ООО «Учебная организация»';
  const periodLabel = organization?.periodLabel ?? 'Апрель 2026';

  const balancesText =
    openingBalances && openingBalances.length > 0
      ? openingBalances
          .map(
            (b) =>
              `- Счет ${b.accountCode}${b.subconto1 ? ` (${b.subconto1}${b.subconto2 ? `, ${b.subconto2}` : ''})` : ''}: Дт ${b.debit} ₽ / Кт ${b.credit} ₽`
          )
          .join('\n')
      : 'Начальные остатки не переданы или будут введены отдельно.';

  return `Ты — главный методолог 1С:Бухгалтерия 8.3 (редакция 3.0, интерфейс «Такси») и эксперт по РСБУ.
Твоя задача: распознать журнал хозяйственных операций (из текста, таблицы Excel/CSV или скриншота методички) и вернуть СТРОГО валидный JSON без markdown-обертки по заданной схеме.

ПАРАМЕТРЫ ОРГАНИЗАЦИИ:
- Организация: ${orgName}
- Система налогообложения: ${taxSystem}
- Базовая ставка НДС: ${vatRate}%
- Период учета: ${periodLabel}

ТЕКУЩИЕ НАЧАЛЬНЫЕ ОСТАТКИ (ДЛЯ УМНОЙ СВЯЗКИ ПУСТЫХ СУММ):
${balancesText}

КРИТИЧЕСКИЕ ПРАВИЛА БУХГАЛТЕРСКОГО УЧЕТА В 1С:БУХГАЛТЕРИЯ 8.3 (РЕД. 3.0, ТАКСИ):
1. ТОЧНЫЕ СУБСЧЕТА 1С 8.3:
   - Товары для перепродажи («для дальнейшей продажи»): счет 41.01 + НДС 19.03 (НЕ 10.01 и НЕ 20.01!).
   - Материалы: поступление на 10.01 + НДС 19.03; отпуск в производство — документ «Расход материалов (Требование-накладная)» Дт 20.01 (или 26) Кт 10.01 с обязательным указанием Номенклатурной группы (объекта) и Статьи затрат.
   - Субподрядные работы / производственные услуги на объекте: Дт 20.01 Кт 60.01 + НДС Дт 19.04 Кт 60.01 (счет 19.04 для услуг!). Общехозяйственные услуги (аренда офиса, связь): счет 26 + 19.04.
   - Предоплата (аванс) поставщику: Дт 60.02 Кт 51. При последующем поступлении от этого же поставщика по тому же договору ОБЯЗАТЕЛЬНО добавляй проводку зачета аванса Дт 60.01 Кт 60.02!
   - Тумблер УПД / Счет-фактура полученный: если в операции указан УПД или счет-фактура при ОСНО, включай hasUpdOrSf: true и проводку вычета НДС Дт 68.02 Кт 19.03 (или 19.04).
   - Снятие наличных из банка в кассу (Дт 50.01 Кт 51): в 1С 8.3 оформляется ТОЛЬКО документом «Поступление наличных (ПКО)» с видом операции «Получение наличных в банке»! Обязательно добавляй pitfall о том, что «Списание с расчетного счета» проводить нельзя, иначе проводка задвоится.
   - Пустые суммы / '?' / 'определить по остаткам': если сумма явно не написана числом (например, перечислены задолженности по налогам и взносам -> accountCode '68+69', выплачена зарплата за прошлый месяц -> '70', списан или уплачен долг по договору №177 -> '60.01' или '62.01' с matchContract '177'), ставь "explicitAmount": null и заполняй "smartLink"! Но если поступление товаров без указанной суммы идет сразу после 100% аванса тому же поставщику за то же количество, вычисли и подставь сумму из аванса!
   - Кадровые операции («Принят на работу главный бухгалтер (ФИО студента) с окладом 72 200»): это кадровый документ «Прием на работу» (Зарплата и кадры → Приемы, переводы, увольнения), ставь explicitAmount = оклад, postings = [] (в дату приема проводок Дт/Кт нет!), и обязательно добавляй сотрудника в directories.employees со счетом затрат 26 (или 20.01 для рабочих).
   - Если в одной операции указаны одновременно акт выполненных работ/услуг И оплата с р/сч («На основании счета, акта и счет-фактуры произведена оплата»), включай проводки обоих документов (20.01/60.01, 19.04/60.01, 68.02/19.04 И оплату 60.01/51)!
   - Штрафы, пени, исполнительные листы: строго разделяй договорные неустойки (Дт 91.02 Кт 76.02) и штрафы/санкции на счете 99.02.3!
   - Все денежные суммы округляй строго до копеек (2 знака после запятой).

ФОРМАТ ОТВЕТА (ТОЛЬКО JSON, БЕЗ \`\`\`json):
${TASK_PARSER_JSON_SCHEMA_DESCRIPTION}`;
}
