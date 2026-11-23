import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import {
  ALL_DOC_TYPES_1C,
  DOCUMENT_SPECS,
  OPERATION_CATEGORIES_LIST,
} from '@/lib/engine/documentSpecs1C';
import {
  AiRawBatchRowInput,
  ParsedOperationIntent,
  RollingAccountingContext1C,
  SEMANTIC_AMOUNT_MODES,
  SEMANTIC_NOMENCLATURE_ACCOUNTS,
  sanitizeAndValidateOperationIntent,
} from '@/types/semanticIntent';

const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MAX_BATCH_SIZE = 40;
const MAX_CACHE_ENTRIES = 1500;

function isTransientOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|rate limit/i.test(msg);
}

function formatCleanLlmError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(raw)) {
    return 'Сервис ИИ временно перегружен (503) — активен локальный резервный парсер 1С:БП 3.0';
  }
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) {
    return 'Превышен лимит запросов к API (429) — активен локальный резервный парсер 1С:БП 3.0';
  }
  if (/401|403|API_KEY_INVALID|invalid api key|permission/i.test(raw)) {
    return 'Недействительный серверный ключ API — проверьте конфигурацию переменных окружения';
  }
  return 'Сервис ИИ временно недоступен — активен локальный резервный парсер 1С:БП 3.0';
}

const serverIntentCache = new Map<string, ParsedOperationIntent>();

function putCache(key: string, val: ParsedOperationIntent): void {
  if (serverIntentCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = serverIntentCache.keys().next().value;
    if (oldest) serverIntentCache.delete(oldest);
  }
  serverIntentCache.set(key, val);
}

function computeRowCacheKey(
  row: AiRawBatchRowInput,
  rollingContext: RollingAccountingContext1C,
  modelId: string
): string {
  const payload = JSON.stringify({
    v: 1,
    modelId,
    d: row.date,
    desc: row.description.trim(),
    amt: row.rawExcelAmount,
    hint: row.actionSequenceHint || '',
    cpCell: row.counterpartyCell || '',
    own: rollingContext.ownOrganization?.name || '',
    cps: rollingContext.counterparties.map((c) => `${c.canonicalName}:${c.inn}`).slice(-25),
    ords: rollingContext.openOrders.map((o) => `${o.counterpartyName}:${o.totalAmount}:${o.remainingAmount}`),
    emps: rollingContext.employees.map((e) => `${e.fullName}:${e.monthlySalary}:${e.costAccount}`),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function isDisallowedInternalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata 169.254.169.254
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function validateSafeExternalBaseUrl(rawUrl: string): { ok: boolean; normalizedUrl?: string; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'Некорректный формат LLM_BASE_URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'LLM_BASE_URL должен использовать протокол https: или http:' };
  }
  if (isDisallowedInternalHost(parsed.hostname)) {
    return { ok: false, error: 'LLM_BASE_URL указывает на недопустимый локальный или внутренний адрес' };
  }
  return { ok: true, normalizedUrl: parsed.toString().replace(/\/+$/, '') };
}

type ActiveProviderConfig =
  | {
      available: true;
      provider: 'gemini';
      model: string;
      apiKey: string;
    }
  | {
      available: true;
      provider: 'openai_compatible';
      model: string;
      apiKey: string;
      baseUrl: string;
    }
  | {
      available: false;
      provider: 'none';
      model: string;
      reason: string;
    };

function resolveActiveServerProvider(preferredHeader?: string | null): ActiveProviderConfig & {
  geminiConfigured: boolean;
  openaiCompatibleConfigured: boolean;
} {
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const geminiModel = (process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL;
  const geminiConfigured = geminiKey.length > 5;

  const customBaseRaw = (process.env.LLM_BASE_URL || '').trim();
  const customKey = (process.env.LLM_API_KEY || '').trim();
  const customModel = (process.env.LLM_MODEL || '').trim() || 'deepseek-chat';
  const baseCheck = customBaseRaw ? validateSafeExternalBaseUrl(customBaseRaw) : { ok: false };
  const openaiCompatibleConfigured = Boolean(baseCheck.ok && customKey.length > 3);

  const pref = (preferredHeader || 'auto').trim().toLowerCase();

  if (pref === 'openai_compatible' && openaiCompatibleConfigured && baseCheck.normalizedUrl) {
    return {
      available: true,
      provider: 'openai_compatible',
      model: customModel,
      apiKey: customKey,
      baseUrl: baseCheck.normalizedUrl,
      geminiConfigured,
      openaiCompatibleConfigured,
    };
  }

  if ((pref === 'gemini' || pref === 'auto') && geminiConfigured) {
    return {
      available: true,
      provider: 'gemini',
      model: geminiModel,
      apiKey: geminiKey,
      geminiConfigured,
      openaiCompatibleConfigured,
    };
  }

  if (openaiCompatibleConfigured && baseCheck.normalizedUrl) {
    return {
      available: true,
      provider: 'openai_compatible',
      model: customModel,
      apiKey: customKey,
      baseUrl: baseCheck.normalizedUrl,
      geminiConfigured,
      openaiCompatibleConfigured,
    };
  }

  return {
    available: false,
    provider: 'none',
    model: geminiModel,
    reason: 'Серверный ключ ИИ-провайдера не задан в переменных окружения (.env)',
    geminiConfigured,
    openaiCompatibleConfigured,
  };
}

function buildChiefAccountantSystemPrompt(): string {
  const specLines = OPERATION_CATEGORIES_LIST.map((cat) => {
    const s = DOCUMENT_SPECS[cat];
    return `- category="${cat}" -> docType1C="${s.docType}" (${s.label}; zeroPostings=${s.allowsZeroPostings})`;
  }).join('\n');

  return [
    'Ты — главный бухгалтер 1С:Бухгалтерия 8.3 (ред. 3.0, РСБУ, ОСНО, РФ, 2026 год).',
    'Твоя задача — выполнить ТОЛЬКО семантический разбор строк хозяйственных операций в строгий JSON-массив `intents` по контракту `ParsedOperationIntent`.',
    'КРИТИЧЕСКИЙ ЗАПРЕТ: НИКОГДА не вычисляй самостоятельно суммы НДС, амортизацию, ФОТ, НДФЛ, остатки на складах или ОСВ — всю арифметику считает детерминированное математическое ядро Слоя 2!',
    '',
    'ДОПУСТИМЫЕ КАТЕГОРИИ И ДОКУМЕНТЫ 1С (DOCUMENT_SPECS):',
    specLines,
    '(Для выплаты ЗП payroll_payout: если через банк — СписаниеСРасчетногоСчета, если через кассу — ВыдачаНаличных. Для выдачи под отчёт accountable_issue: касса — ВыдачаНаличных, банк — СписаниеСРасчетногоСчета.)',
    '',
    'ЖЁСТКИЕ ПРАВИЛА БУХГАЛТЕРСКОЙ КЛАССИФИКАЦИИ 1С:БП 3.0:',
    '1. Различай счёт на оплату (`customer_invoice` / `СчетПокупателю`, `supplier_invoice` / `СчетОтПоставщика` -> `isNonPostingEvent: true`, `amountIntent.mode: "non_posting"`, `orderTotalAmount` если указана сумма заказа), получение/оплату денег (`bank_in` / `ПоступлениеНаРасчетныйСчет`, `bank_out` / `СписаниеСРасчетногоСчета`) и фактическую отгрузку/приход по акту/накладной (`sale_goods`, `sale_services`, `purchase_materials`, `purchase_goods`, `purchase_services`, `purchase_equipment`).',
    '2. Если в одной строке написано «Выставлен счет ... и получен аванс по п/п» — это РЕАЛЬНОЕ поступление денег `bank_in` (`ПоступлениеНаРасчетныйСчет`, `isNonPostingEvent: false`), а если аванс частичный (например, счёт на 284*34400, а получен аванс 4 884 800) — запиши полную сумму счёта в `amountIntent.orderTotalAmount`!',
    '3. Собственную организацию (при формировании УК «Сформирован Уставный капитал ООО "Завод" ИНН ... — Иванов 30%, Сидоров 70%») записывай ТОЛЬКО в `ownOrganization`, а доли учредителей — в `founderShares` (ФИО в именительном падеже). Поле `counterparty` у `charter_capital` оставь не заданным!',
    '4. Приём на работу (`hr_hire` / `ПриемНаРаботу`): `isNonPostingEvent: true`, оклад из колонки Excel запиши в `employee.monthlySalary`, извлеки чистое ФИО в именительном падеже (даже после «ген.директор», «фрезеровщик», «каменщик», «маляр», «главный бухгалтер»), должность в `employee.position`, дату начала работы (если есть «с 01/02») в `employee.hireStartDate` в формате YYYY-MM-DD, счёт затрат: производственные рабочие (фрезеровщик, каменщик, маляр, слесарь, рабочий) -> `costAccount: "20.01"`, АУП (ген.директор, главный бухгалтер, менеджер) -> `costAccount: "26"`. Стандартные вычеты на детей -> `childDeductionCount`, `isSingleParent`. Уведомление об имущественном вычете -> `policy_event`, `employee.propertyDeductionAmount`.',
    '5. Исполнительный лист об алиментах -> `writ_of_execution` (`ИсполнительныйЛист`, `isNonPostingEvent: true`), заполни `employee.fullName` (плательщик) и `employee.alimony` (`recipientName` в именительном падеже, `fixedAmount` или `sharePercent`, `startDate`). Перечисление алиментов -> `alimony_payout`.',
    '6. Вступительный взнос в СРО, лицензии, ПО, страховки на длительный срок (или подсказка `Д 97 К 76`) -> `deferred_expense_97`, заполни `rpbIntent` (`assetName`, `termMonths`: если не указан явно — 12, `costAccount: "26"` или `"20.01"`, `settlementAccount: "76.09"` или `"60.01"`), и если одновременно перечислен с р/сч — `paidImmediately: { enabled: true, via: "bank_51" }`.',
    '7. Покупка оборудования / станков / лесов / техники для использования как ОС или сдачи в аренду -> `purchase_equipment` (`nomenclature.account: "08.04.1"`). Доставка/монтаж/настройка к этому ОС («включена в стоимость ОС / плоттера») -> `purchase_equipment` с `osIntent.isAdditionalCostToLastOs: true`. Ввод в эксплуатацию -> `os_commissioning` (`ПринятиеКУчетуОС`) с `osIntent.spiMonths` (переведи годы+месяцы в месяцы: например 6 лет 11 мес = 83). Продажа ОС -> `os_disposal` (`ПередачаОС`).',
    '8. Спецодежда и хозинвентарь: покупка -> `purchase_materials` (`nomenclature.account: "10.10"` для спецодежды, `"10.09"` для принтера/мебели/канцтоваров/хозтоваров). Выдача спецодежды/инвентаря в эксплуатацию -> `workwear_issue` (`ПередачаМатериаловВЭксплуатацию`). Стройматериалы (кирпич, цемент, бетон, доски, обои, краска, паркет, раствор, плиты) -> `10.08`, сырьё (МДФ, ПВХ, клей) -> `10.01`.',
    '9. Незавершённое производство («Отразить незавершенное производство по объекту ...») -> `policy_event` (`isNonPostingEvent: true`), а название объекта запиши в `nomenclature.nomenclatureGroup` (например `"Ремонт помещений"`, `"Кирпичная кладка"`). Для списания материалов и сдачи работ по конкретному объекту также указывай единое каноническое `nomenclature.nomenclatureGroup`!',
    '10. Векселя третьих лиц: покупка -> `financial_investment` (`billIntent.action: "buy"`, массив `bills` с номиналом и годовой ставкой `%`), оплата векселя -> `bank_out` (`billIntent.action: "pay"`), начисление процентов -> `financial_interest_accrual` (`billIntent.action: "accrue_interest"`), передача векселя поставщику в счёт оплаты долга -> `financial_disposal` (`billIntent.action: "endorse_to_supplier"`).',
    '11. СТОП ГАЛЛЮЦИНАЦИЯМ И ИНН КАК ДЕНЬГАМ: 9–20-значные коды ИНН, КПП, БИК, ОГРН и расчётных счетов НИКОГДА не являются рублями! Если в строке не назван контрагент, разрешено подставить его ТОЛЬКО из переданного `rollingContext` (по открытому счёту/договору/долгу); выдумывать новые компании строго запрещено!',
    '12. Все названия компаний приводи к каноническому именительному падежу («ООО «Стабильность»»), ФИО — к именительному падежу («Федоров Ф.Ф.»), номенклатуру — в единственном/каноническом виде без предлогов и имён поставщиков («Плита ПВХ», «Кирпич», «Строительные материалы»).',
  ].join('\n');
}

const GEMINI_BATCH_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intents: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          rowIndex: { type: Type.INTEGER },
          category: { type: Type.STRING, enum: OPERATION_CATEGORIES_LIST },
          docType1C: { type: Type.STRING, enum: ALL_DOC_TYPES_1C },
          isNonPostingEvent: { type: Type.BOOLEAN },
          ownOrganization: {
            type: Type.OBJECT,
            properties: {
              canonicalName: { type: Type.STRING },
              inn: { type: Type.STRING },
              kpp: { type: Type.STRING },
            },
            required: ['canonicalName'],
          },
          founderShares: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                founderName: { type: Type.STRING },
                sharePercent: { type: Type.NUMBER },
                amount: { type: Type.NUMBER },
              },
              required: ['founderName'],
            },
          },
          counterparty: {
            type: Type.OBJECT,
            properties: {
              canonicalName: { type: Type.STRING },
              inn: { type: Type.STRING },
              kpp: { type: Type.STRING },
              kind: { type: Type.STRING, enum: ['legal', 'individual', 'tax_authority', 'bank'] },
              role: {
                type: Type.STRING,
                enum: ['supplier', 'buyer', 'founder', 'lender', 'other'],
              },
            },
            required: ['canonicalName', 'kind', 'role'],
          },
          employee: {
            type: Type.OBJECT,
            properties: {
              fullName: { type: Type.STRING },
              position: { type: Type.STRING },
              monthlySalary: { type: Type.NUMBER },
              hireStartDate: { type: Type.STRING },
              costAccount: { type: Type.STRING, enum: ['20.01', '26', '44.01'] },
              nomenclatureGroup: { type: Type.STRING },
              childDeductionCount: { type: Type.INTEGER },
              isSingleParent: { type: Type.BOOLEAN },
              propertyDeductionAmount: { type: Type.NUMBER },
              alimony: {
                type: Type.OBJECT,
                properties: {
                  recipientName: { type: Type.STRING },
                  recipientInn: { type: Type.STRING },
                  sharePercent: { type: Type.NUMBER },
                  fixedAmount: { type: Type.NUMBER },
                  startDate: { type: Type.STRING },
                },
                required: ['recipientName'],
              },
            },
            required: ['fullName'],
          },
          nomenclature: {
            type: Type.OBJECT,
            properties: {
              canonicalName: { type: Type.STRING },
              quantity: { type: Type.NUMBER },
              unit: { type: Type.STRING },
              unitPrice: { type: Type.NUMBER },
              account: { type: Type.STRING, enum: [...SEMANTIC_NOMENCLATURE_ACCOUNTS] },
              nomenclatureGroup: { type: Type.STRING },
            },
            required: ['canonicalName', 'account'],
          },
          amountIntent: {
            type: Type.OBJECT,
            properties: {
              mode: { type: Type.STRING, enum: [...SEMANTIC_AMOUNT_MODES] },
              advancePercent: { type: Type.NUMBER },
              orderTotalAmount: { type: Type.NUMBER },
            },
            required: ['mode'],
          },
          vatIntent: {
            type: Type.OBJECT,
            properties: {
              rule: {
                type: Type.STRING,
                enum: ['included', 'on_top', 'exempt', 'not_applicable'],
              },
              rate: { type: Type.INTEGER },
            },
            required: ['rule', 'rate'],
          },
          rpbIntent: {
            type: Type.OBJECT,
            properties: {
              assetName: { type: Type.STRING },
              termMonths: { type: Type.INTEGER },
              costAccount: { type: Type.STRING, enum: ['26', '20.01'] },
              settlementAccount: { type: Type.STRING, enum: ['76.09', '60.01'] },
            },
            required: ['assetName', 'termMonths', 'costAccount', 'settlementAccount'],
          },
          osIntent: {
            type: Type.OBJECT,
            properties: {
              assetName: { type: Type.STRING },
              spiMonths: { type: Type.INTEGER },
              costAccount: { type: Type.STRING, enum: ['20.01', '26'] },
              isAdditionalCostToLastOs: { type: Type.BOOLEAN },
            },
            required: ['assetName', 'costAccount'],
          },
          billIntent: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                enum: ['buy', 'pay', 'accrue_interest', 'endorse_to_supplier'],
              },
              bills: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nominal: { type: Type.NUMBER },
                    annualRatePercent: { type: Type.NUMBER },
                  },
                  required: ['nominal', 'annualRatePercent'],
                },
              },
              interestDays: { type: Type.INTEGER },
            },
            required: ['action'],
          },
          paidImmediately: {
            type: Type.OBJECT,
            properties: {
              enabled: { type: Type.BOOLEAN },
              via: { type: Type.STRING, enum: ['bank_51', 'cash_50', 'accountable_71'] },
            },
            required: ['enabled', 'via'],
          },
          explicitEntries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                debit: { type: Type.STRING },
                credit: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                comment: { type: Type.STRING },
              },
              required: ['debit', 'credit'],
            },
          },
          studentExplanation: { type: Type.STRING },
        },
        required: [
          'rowIndex',
          'category',
          'docType1C',
          'isNonPostingEvent',
          'amountIntent',
          'vatIntent',
          'studentExplanation',
        ],
      },
    },
  },
  required: ['intents'],
};

async function invokeGeminiJson(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: params.apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const callModel = async (targetModel: string): Promise<string> => {
    const isGemini3Or4 = /^gemini-(?:3|4)/i.test(targetModel);
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: params.userPrompt,
      config: {
        systemInstruction: params.systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_BATCH_RESPONSE_SCHEMA,
        seed: 42,
        ...(isGemini3Or4
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : { temperature: 0 }),
      },
    });
    return (response.text ?? '').trim();
  };

  try {
    return await callModel(params.model);
  } catch (err) {
    if (params.model !== FALLBACK_GEMINI_MODEL && isTransientOverloadError(err)) {
      return await callModel(FALLBACK_GEMINI_MODEL);
    }
    throw err;
  }
}

async function invokeOpenAiCompatibleJson(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const endpoint = params.baseUrl.endsWith('/chat/completions')
    ? params.baseUrl
    : `${params.baseUrl}/chat/completions`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 220)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(trimmed);
}

const RequestBodySchema = z.object({
  rows: z
    .array(
      z.object({
        rowIndex: z.number().int().nonnegative(),
        date: z.string(),
        docNumber: z.string().optional(),
        description: z.string(),
        rawExcelAmount: z.number(),
        actionSequenceHint: z.string().optional(),
        counterpartyCell: z.string().optional(),
      })
    )
    .min(1)
    .max(MAX_BATCH_SIZE),
  rollingContext: z.object({
    ownOrganization: z
      .object({
        name: z.string(),
        inn: z.string(),
        kpp: z.string().optional(),
      })
      .optional(),
    counterparties: z.array(
      z.object({
        canonicalName: z.string(),
        inn: z.string(),
        kpp: z.string().optional(),
        roleHint: z.string().optional(),
      })
    ),
    employees: z.array(
      z.object({
        fullName: z.string(),
        position: z.string(),
        monthlySalary: z.number(),
        costAccount: z.enum(['20.01', '26', '44.01']),
        hireDate: z.string().optional(),
      })
    ),
    openOrders: z.array(
      z.object({
        direction: z.enum(['buyer', 'supplier']),
        counterpartyName: z.string(),
        subjectSummary: z.string(),
        totalAmount: z.number(),
        remainingAmount: z.number(),
      })
    ),
    openSettlements: z.array(
      z.object({
        account: z.string(),
        counterpartyName: z.string(),
        subjectSummary: z.string(),
        remainingAmount: z.number(),
      })
    ),
    fixedAssets: z.array(
      z.object({
        name: z.string(),
        status: z.string(),
        initialCost: z.number(),
        spiMonths: z.number(),
      })
    ),
    financialBills: z.array(
      z.object({
        name: z.string(),
        nominal: z.number(),
        ratePercent: z.number().optional(),
        status: z.string().optional(),
      })
    ),
    deferredExpenses: z.array(
      z.object({
        name: z.string(),
        totalAmount: z.number(),
        remainingAmount: z.number(),
        termMonths: z.number(),
      })
    ),
    stockItems: z.array(z.string()),
  }),
});

export async function GET(req: NextRequest) {
  const preferred = req.headers.get('x-llm-provider');
  const active = resolveActiveServerProvider(preferred);
  const probe = req.nextUrl.searchParams.get('probe') === '1';

  if (!active.available || !probe) {
    const providerLabel =
      active.provider === 'gemini' ? 'Google Gemini API' : 'OpenAI-совместимый API';
    return NextResponse.json({
      available: active.available,
      provider: active.provider,
      model: active.model,
      geminiConfigured: active.geminiConfigured,
      openaiCompatibleConfigured: active.openaiCompatibleConfigured,
      message: active.available
        ? `Серверный провайдер готов (${providerLabel})`
        : active.reason,
    });
  }

  try {
    if (active.provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: active.apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const pingModel = async (targetModel: string) => {
        const isGemini3Or4 = /^gemini-(?:3|4)/i.test(targetModel);
        return ai.models.generateContent({
          model: targetModel,
          contents: 'Верни JSON {"ok": true}',
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: { ok: { type: Type.BOOLEAN } },
              required: ['ok'],
            },
            ...(isGemini3Or4
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : { temperature: 0 }),
          },
        });
      };

      let usedModel = active.model;
      let ping;
      try {
        ping = await pingModel(active.model);
      } catch (err) {
        if (active.model !== FALLBACK_GEMINI_MODEL && isTransientOverloadError(err)) {
          usedModel = FALLBACK_GEMINI_MODEL;
          ping = await pingModel(FALLBACK_GEMINI_MODEL);
        } else {
          throw err;
        }
      }
      const parsed = extractJsonObject(ping.text ?? '{}') as { ok?: boolean };
      return NextResponse.json({
        available: true,
        probeSuccess: Boolean(parsed.ok ?? true),
        provider: active.provider,
        model: usedModel,
        geminiConfigured: active.geminiConfigured,
        openaiCompatibleConfigured: active.openaiCompatibleConfigured,
        message: 'Подключение к серверному ИИ успешно проверено (Google Gemini API)',
      });
    }

    const pingText = await invokeOpenAiCompatibleJson({
      baseUrl: active.baseUrl,
      apiKey: active.apiKey,
      model: active.model,
      systemPrompt: 'Respond strictly with JSON {"ok": true}',
      userPrompt: 'Ping',
    });
    const parsed = extractJsonObject(pingText) as { ok?: boolean };
    return NextResponse.json({
      available: true,
      probeSuccess: Boolean(parsed.ok ?? true),
      provider: active.provider,
      model: active.model,
      geminiConfigured: active.geminiConfigured,
      openaiCompatibleConfigured: active.openaiCompatibleConfigured,
      message: 'Подключение к серверному ИИ успешно проверено (OpenAI-совместимый API)',
    });
  } catch (err) {
    return NextResponse.json({
      available: false,
      probeSuccess: false,
      provider: active.provider,
      model: active.model,
      geminiConfigured: active.geminiConfigured,
      openaiCompatibleConfigured: active.openaiCompatibleConfigured,
      message: formatCleanLlmError(err),
    });
  }
}

export async function POST(req: NextRequest) {
  const preferred = req.headers.get('x-llm-provider');
  const active = resolveActiveServerProvider(preferred);
  if (!active.available) {
    return NextResponse.json(
      {
        ok: false,
        available: false,
        fallbackToOffline: true,
        error: active.reason,
      },
      { status: 503 }
    );
  }

  let parsedBody: z.infer<typeof RequestBodySchema>;
  try {
    const rawJson = await req.json();
    const checked = RequestBodySchema.safeParse(rawJson);
    if (!checked.success) {
      return NextResponse.json(
        {
          ok: false,
          error: `Некорректный формат пачки: ${checked.error.issues.map((i) => i.message).join('; ')}`,
        },
        { status: 400 }
      );
    }
    parsedBody = checked.data;
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректный JSON тела запроса' }, { status: 400 });
  }

  const { rows, rollingContext } = parsedBody;
  const cachedMap = new Map<number, ParsedOperationIntent>();
  const uncachedRows: AiRawBatchRowInput[] = [];
  const cacheKeysByRowIndex = new Map<number, string>();

  for (const row of rows) {
    const cKey = computeRowCacheKey(row, rollingContext, `${active.provider}:${active.model}`);
    cacheKeysByRowIndex.set(row.rowIndex, cKey);
    const hit = serverIntentCache.get(cKey);
    if (hit) {
      cachedMap.set(row.rowIndex, { ...hit, rowIndex: row.rowIndex });
    } else {
      uncachedRows.push(row);
    }
  }

  if (uncachedRows.length === 0) {
    return NextResponse.json({
      ok: true,
      provider: active.provider,
      model: active.model,
      fromCacheCount: rows.length,
      warnings: [],
      intents: rows.map((r) => cachedMap.get(r.rowIndex)!),
    });
  }

  const systemPrompt = buildChiefAccountantSystemPrompt();
  const baseUserPrompt = JSON.stringify(
    {
      task: 'Разбери каждую строку массива rows в объект ParsedOperationIntent и верни JSON {"intents": [...]}. Для каждой входной строки верни ровно один элемент с тем же rowIndex.',
      rollingContext,
      rows: uncachedRows,
    },
    null,
    2
  );

  const runValidationPass = (rawText: string) => {
    const obj = extractJsonObject(rawText) as { intents?: unknown[] } | unknown[];
    const list = Array.isArray(obj)
      ? obj
      : obj && typeof obj === 'object' && Array.isArray((obj as { intents?: unknown[] }).intents)
        ? (obj as { intents: unknown[] }).intents
        : null;

    if (!list) {
      return {
        ok: false as const,
        errors: ['Ответ модели не содержит массив intents'],
        validated: new Map<number, ParsedOperationIntent>(),
        warnings: [] as string[],
      };
    }

    const validated = new Map<number, ParsedOperationIntent>();
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const row of uncachedRows) {
      const candidate = list.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          (item as { rowIndex?: number }).rowIndex === row.rowIndex
      );
      if (!candidate) {
        errors.push(`Отсутствует intent для rowIndex=${row.rowIndex}`);
        continue;
      }
      const res = sanitizeAndValidateOperationIntent(candidate, row, rollingContext);
      if (!res.ok || !res.intent) {
        errors.push(`rowIndex=${row.rowIndex}: ${res.error || 'validation failed'}`);
      } else {
        validated.set(row.rowIndex, res.intent);
        warnings.push(...res.warnings.map((w) => `[#${row.rowIndex}] ${w}`));
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      validated,
      warnings,
    };
  };

  try {
    const callProvider = async (userPrompt: string) => {
      if (active.provider === 'gemini') {
        return invokeGeminiJson({
          apiKey: active.apiKey,
          model: active.model,
          systemPrompt,
          userPrompt,
        });
      }
      return invokeOpenAiCompatibleJson({
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        model: active.model,
        systemPrompt,
        userPrompt,
      });
    };

    const firstRaw = await callProvider(baseUserPrompt);
    let checkResult: ReturnType<typeof runValidationPass>;
    try {
      checkResult = runValidationPass(firstRaw);
    } catch (jsonErr) {
      checkResult = {
        ok: false,
        errors: [jsonErr instanceof Error ? jsonErr.message : 'Invalid JSON syntax'],
        validated: new Map(),
        warnings: [],
      };
    }

    // Automatic 1-retry with explicit validation error feedback if any row failed schema check
    if (!checkResult.ok) {
      const retryPrompt = `${baseUserPrompt}\n\nВНИМАНИЕ! Предыдущий JSON не прошёл строгую валидацию схемы ParsedOperationIntent:\n${checkResult.errors.join('\n')}\nИсправь указанные ошибки и верни полный валидный JSON {"intents": [...]} для всех запрошенных rowIndex.`;
      const retryRaw = await callProvider(retryPrompt);
      const retryCheck = runValidationPass(retryRaw);
      // Merge any rows that succeeded on first pass if retry missed one, preferring retryCheck
      for (const [rIdx, intent] of retryCheck.validated.entries()) {
        checkResult.validated.set(rIdx, intent);
      }
      checkResult.warnings.push(...retryCheck.warnings);
      checkResult.ok = uncachedRows.every((r) => checkResult.validated.has(r.rowIndex));
      checkResult.errors = retryCheck.errors;
    }

    const finalIntents: ParsedOperationIntent[] = [];
    const missingRowIndices: number[] = [];

    for (const row of rows) {
      const fromCache = cachedMap.get(row.rowIndex);
      if (fromCache) {
        finalIntents.push(fromCache);
        continue;
      }
      const fromLlm = checkResult.validated.get(row.rowIndex);
      if (fromLlm) {
        const cKey = cacheKeysByRowIndex.get(row.rowIndex);
        if (cKey) putCache(cKey, fromLlm);
        finalIntents.push(fromLlm);
      } else {
        missingRowIndices.push(row.rowIndex);
      }
    }

    return NextResponse.json({
      ok: true,
      provider: active.provider,
      model: active.model,
      fromCacheCount: cachedMap.size,
      missingRowIndices,
      warnings: checkResult.warnings,
      validationErrors: checkResult.errors,
      intents: finalIntents,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        available: true,
        fallbackToOffline: true,
        provider: active.provider,
        model: active.model,
        error: formatCleanLlmError(err),
      },
      { status: 503 }
    );
  }
}
