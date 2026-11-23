import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
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

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const FALLBACK_GEMINI_MODEL = 'gemini-2.0-flash';
const MAX_BATCH_SIZE = 40;
const MAX_CACHE_ENTRIES = 1500;

type LlmEndpointKind = 'gemini_developer' | 'vertex_express' | 'openai_compatible';

class UpstreamLlmError extends Error {
  readonly upstreamStatus: number;
  readonly upstreamMessage: string;
  readonly rawRedactedBody: string;
  readonly endpointKind: LlmEndpointKind;

  constructor(params: {
    upstreamStatus: number;
    upstreamMessage: string;
    rawRedactedBody?: string;
    endpointKind: LlmEndpointKind;
  }) {
    super(`HTTP ${params.upstreamStatus}: ${params.upstreamMessage}`);
    this.name = 'UpstreamLlmError';
    this.upstreamStatus = params.upstreamStatus;
    this.upstreamMessage = params.upstreamMessage;
    this.rawRedactedBody = params.rawRedactedBody ?? params.upstreamMessage;
    this.endpointKind = params.endpointKind;
  }
}

function redactSecrets(input: string, apiKey?: string): string {
  let out = input || '';
  if (apiKey && apiKey.trim().length >= 4) {
    const trimmed = apiKey.trim();
    const encoded = encodeURIComponent(trimmed);
    out = out.split(trimmed).join('[REDACTED]');
    if (encoded !== trimmed) {
      out = out.split(encoded).join('[REDACTED]');
    }
  }
  return out
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\bAQ\.[A-Za-z0-9._-]+/g, 'AQ.[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]+/g, 'AIza[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
}

function extractConciseUpstreamMessage(rawBody: string, statusText: string, apiKey?: string): string {
  const safeRaw = redactSecrets(rawBody.trim(), apiKey);
  if (!safeRaw) {
    return statusText || 'Пустой ответ от провайдера ИИ';
  }
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const errNode = Array.isArray(parsed)
      ? (parsed[0] as { error?: { message?: string; status?: string } } | undefined)?.error
      : (parsed as { error?: { message?: string; status?: string } | string } | undefined)?.error;
    if (typeof errNode === 'string' && errNode.trim()) {
      return redactSecrets(errNode.trim(), apiKey).slice(0, 360);
    }
    if (errNode && typeof errNode === 'object') {
      const msg = typeof errNode.message === 'string' ? errNode.message.trim() : '';
      const st = typeof errNode.status === 'string' ? errNode.status.trim() : '';
      const combined = st && msg && !msg.includes(st) ? `${st}: ${msg}` : msg || st;
      if (combined) {
        return redactSecrets(combined, apiKey).slice(0, 500);
      }
    }
  } catch {
    // Non-JSON upstream error payload
  }
  return safeRaw.replace(/\s+/g, ' ').slice(0, 500);
}

function extractUpstreamErrorDetails(
  err: unknown,
  apiKey?: string
): { upstreamStatus?: number; upstreamMessage: string } {
  if (err instanceof UpstreamLlmError) {
    return {
      upstreamStatus: err.upstreamStatus,
      upstreamMessage: redactSecrets(err.upstreamMessage, apiKey).slice(0, 800),
    };
  }
  const raw = err instanceof Error ? err.message : String(err ?? 'Неизвестная ошибка обращения к ИИ');
  return {
    upstreamMessage: redactSecrets(raw, apiKey).slice(0, 500),
  };
}

function isTransientServerOverloadError(err: unknown): boolean {
  if (err instanceof UpstreamLlmError) {
    return err.upstreamStatus === 503;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg);
}

function isGeminiApiKeyInvalidError(err: UpstreamLlmError): boolean {
  const haystack = `${err.upstreamMessage}\n${err.rawRedactedBody}`;
  return /API_KEY_INVALID|API key not valid/i.test(haystack);
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
    '4. Кадровый цикл и зарплата (`hr_hire`, `payroll_accrual`, `payroll_payout`):',
    '   - Приём на работу (`hr_hire` / `ПриемНаРаботу`, `employee.hrAction: "hire"`): `isNonPostingEvent: true`, оклад в `employee.monthlySalary`, чистое ФИО в именительном падеже, должность в `employee.position`, дату начала (`employee.hireStartDate`, YYYY-MM-DD), счёт затрат: рабочие -> `"20.01"`, АУП -> `"26"`, торговля -> `"44.01"`.',
    '   - Кадровый перевод (изменение оклада/должности без проводки) -> `hr_hire` (`employee.hrAction: "transfer"`, новый `monthlySalary`, дата с `hireStartDate`).',
    '   - Увольнение: если это кадровый приказ об увольнении без суммы начисления -> `hr_hire` (`isNonPostingEvent: true`, `employee.hrAction: "dismissal"`, `employee.terminationDate` YYYY-MM-DD). Если в строке сразу начисляется расчёт при увольнении / компенсация неиспользованного отпуска с суммой -> `payroll_accrual` (`employee.hrAction: "dismissal"`, `employee.terminationDate`, `unusedVacationDays` если указано).',
    '   - Отпускные, премии, материальная помощь -> `payroll_accrual`. Больничный лист (пособие по временной нетрудоспособности, первые 3 дня за счёт работодателя) -> `payroll_accrual` с `employee.isSickLeave: true`.',
    '   - Аванс по зарплате за первую половину месяца -> `payroll_payout` с `employee.isSalaryAdvance: true`. Выплата окончательного расчёта ЗП за месяц -> `payroll_payout`.',
    '   - Стандартные вычеты на детей -> `childDeductionCount`, `isSingleParent`. Уведомление об имущественном вычете -> `policy_event`, `employee.propertyDeductionAmount`.',
    '5. Исполнительный лист об алиментах -> `writ_of_execution` (`ИсполнительныйЛист`, `isNonPostingEvent: true`), заполни `employee.fullName` (плательщик) и `employee.alimony` (`recipientName` в именительном падеже, `fixedAmount` или `sharePercent`, `startDate`). Перечисление алиментов -> `alimony_payout`.',
    '6. Вступительный взнос в СРО, лицензии, ПО, страховки на длительный срок (`97.21`) -> `deferred_expense_97`, заполни `rpbIntent` (`assetName`, `termMonths`: по умолчанию 12, `writeOffMethod`: `"calendar_days"` по умолчанию в 1С:БП 3.0 или при наличии дат начала/окончания, `"monthly"` — если явно сказано «равными долями / по месяцам», `startDate`/`endDate` YYYY-MM-DD если указаны, `costAccount: "26"` или `"20.01"`, `settlementAccount: "76.09"` или `"60.01"`), и если одновременно перечислен с р/сч — `paidImmediately: { enabled: true, via: "bank_51" }`.',
    '7. Полный цикл ОС и НМА: покупка оборудования/компонентов ОС -> `purchase_equipment` (`nomenclature.account: "08.04.1"`). Доп. расходы до ввода -> `purchase_equipment` с `osIntent.isAdditionalCostToLastOs: true`. Ввод ОС в эксплуатацию -> `os_commissioning` (`ПринятиеКУчетуОС`) с `osIntent.spiMonths` (годы*12 + месяцы). Модернизация введённого ОС -> `os_commissioning` с `osIntent.isModernization: true`. Продажа или списание ОС -> `os_disposal` (`ПередачаОС` или `СписаниеОС`). Покупка/ввод/амортизация НМА -> `intangible_acquisition` (`08.05`), `intangible_commissioning` (`04.01`), `intangible_amortization` (`05`).',
    '8. Спецодежда и хозинвентарь: покупка -> `purchase_materials` (`nomenclature.account: "10.10"` для спецодежды, `"10.09"` для принтера/мебели/канцтоваров/хозтоваров). Выдача спецодежды/инвентаря в эксплуатацию -> `workwear_issue` (`ПередачаМатериаловВЭксплуатацию`). Стройматериалы -> `10.08`, ГСМ -> `10.03`, сырьё -> `10.01`, товары для перепродажи -> `purchase_goods` (`41.01`). Доставка материалов на стройобъект -> `purchase_services` с `costAccount: "20.01"` (через `nomenclatureGroup`).',
    '9. Незавершённое производство («Отразить незавершенное производство по объекту ...») -> `policy_event` (`isNonPostingEvent: true`), а название объекта запиши в `nomenclature.nomenclatureGroup` (например `"Ремонт помещений"`). Для списания материалов и сдачи работ по конкретному объекту указывай единое каноническое `nomenclature.nomenclatureGroup`!',
    '10. Кредиты, займы, векселя, инвентаризация, резервы, дивиденды, закрытие года:',
    '    - Кредиты и займы полученные/погашенные/выданные/проценты -> `loan_received` (`66.01/66.03/67.01/67.03`), `loan_repaid`, `loan_issued` (`58.03`), `loan_interest_accrual` (`66.02/66.04/67.02/67.04` или `76.09`).',
    '    - Векселя третьих лиц (`58.02`): покупка -> `financial_investment` (`billIntent.action: "buy"`), оплата -> `bank_out` (`billIntent.action: "pay"`), проценты -> `financial_interest_accrual`, передача в оплату поставщику -> `financial_disposal` (`billIntent.action: "endorse_to_supplier"`).',
    '    - Излишки / недостачи при инвентаризации -> `inventory_result` (`94`, `91.01`, `73.02`). Резерв по сомнительным долгам -> `reserve_doubtful_63` (`63`). Начисление/выплата дивидендов -> `dividends_accrual` (`84.01 -> 75.02/70`), `dividends_payout`. Штрафы/пени контрагентам и налоговые санкции (`99.02.3`) -> `penalty_claim`.',
    '    - Закрытие месяца и реформация баланса 31 декабря (`closing` / `ЗакрытиеМесяца`, `amountIntent.mode: "closing_auto"`).',
    '11. ЗАЩИТНЫЙ КЛАПАН `customPostings`: если встретилась редкая нетиповая хозяйственная операция (например, безвозмездное получение имущества `Дт 08/10 Кт 98.02`, прощение долга, цессия, вклад в имущество `83`), которая не покрывается стандартным шаблоном, ставь `category: "manual"`, `docType1C: "ОперацияБух"` и заполни `customPostings` точными листовыми субсчетами Плана счетов 1С:БП 3.0 (`debit`, `credit`, `amount` если известен, `debitSubconto`, `creditSubconto`, `description`). Для всех стандартных операций `customPostings` НЕ заполняй!',
    '12. СТОП ГАЛЛЮЦИНАЦИЯМ И ИНН КАК ДЕНЬГАМ: 9–20-значные коды ИНН, КПП, БИК, ОГРН и расчётных счетов НИКОГДА не являются рублями! Если в строке не назван контрагент, разрешено подставить его ТОЛЬКО из `rollingContext`; выдумывать новые компании строго запрещено! Все названия ЮЛ, ФИО и номенклатуры приводи к каноническому именительному падежу.',
    '',
    'СТРОГАЯ JSON-СХЕМА ОТВЕТА: {"intents": [ParsedOperationIntent, ...]}',
    `Поля каждого элемента intents:`,
    `- rowIndex: integer (точно совпадает со входной строкой)`,
    `- category: string из списка выше`,
    `- docType1C: string из [${ALL_DOC_TYPES_1C.join(', ')}]`,
    `- isNonPostingEvent: boolean`,
    `- amountIntent: { mode: "${SEMANTIC_AMOUNT_MODES.join('" | "')}", advancePercent?: number, orderTotalAmount?: number }`,
    `- vatIntent: { rule: "included" | "on_top" | "exempt" | "not_applicable", rate: 20 | 10 | 0 }`,
    `- ownOrganization?: { canonicalName: string, inn?: string, kpp?: string }`,
    `- founderShares?: [{ founderName: string, sharePercent?: number, amount?: number }]`,
    `- counterparty?: { canonicalName: string, inn?: string, kpp?: string, kind: "legal" | "individual" | "tax_authority" | "bank", role: "supplier" | "buyer" | "founder" | "lender" | "other" }`,
    `- employee?: { fullName: string, hrAction?: "hire" | "transfer" | "dismissal", position?: string, monthlySalary?: number, hireStartDate?: string, terminationDate?: string, unusedVacationDays?: number, isSalaryAdvance?: boolean, isSickLeave?: boolean, costAccount?: "20.01" | "26" | "44.01", nomenclatureGroup?: string, childDeductionCount?: integer, isSingleParent?: boolean, propertyDeductionAmount?: number, alimony?: { recipientName: string, recipientInn?: string, sharePercent?: number, fixedAmount?: number, startDate?: string } }`,
    `- nomenclature?: { canonicalName: string, quantity?: number, unit?: string, unitPrice?: number, account: "${SEMANTIC_NOMENCLATURE_ACCOUNTS.join('" | "')}", nomenclatureGroup?: string }`,
    `- rpbIntent?: { assetName: string, termMonths: integer, writeOffMethod?: "calendar_days" | "monthly", startDate?: string, endDate?: string, costAccount: "26" | "20.01", settlementAccount: "76.09" | "60.01" }`,
    `- osIntent?: { assetName: string, spiMonths?: integer, costAccount: "20.01" | "26", isAdditionalCostToLastOs?: boolean, isModernization?: boolean }`,
    `- billIntent?: { action: "buy" | "pay" | "accrue_interest" | "endorse_to_supplier", bills?: [{ nominal: number, annualRatePercent: number }], interestDays?: integer }`,
    `- paidImmediately?: { enabled: boolean, via: "bank_51" | "cash_50" | "accountable_71" }`,
    `- explicitEntries?: [{ debit: string, credit: string, amount?: number, comment?: string }]`,
    `- customPostings?: [{ debit: string, credit: string, amount?: number, debitSubconto?: string, creditSubconto?: string, description?: string }]`,
    `- studentExplanation: string (1-2 предложения с пояснением сути проводки, минимум 5 символов)`,
  ].join('\n');
}

function parseGoogleGenerateContentPayload(
  data: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    promptFeedback?: {
      blockReason?: string;
      blockReasonMessage?: string;
    };
  },
  endpointKind: 'gemini_developer' | 'vertex_express',
  safeUrl: string
): string {
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim() ?? '';

  if (!text && data.promptFeedback?.blockReason) {
    const blockMsg = data.promptFeedback.blockReasonMessage
      ? `${data.promptFeedback.blockReason}: ${data.promptFeedback.blockReasonMessage}`
      : `Blocked (${data.promptFeedback.blockReason})`;
    console.error(`[ai-parse-batch] Google ${endpointKind} blocked response (${safeUrl}): ${blockMsg}`);
    throw new UpstreamLlmError({
      upstreamStatus: 400,
      upstreamMessage: blockMsg,
      endpointKind,
    });
  }

  return text;
}

async function executeGeminiDeveloperRest(params: {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`;

  const requestBody: Record<string, unknown> = {
    ...(params.systemPrompt && params.systemPrompt.trim().length > 0
      ? {
          systemInstruction: {
            parts: [{ text: params.systemPrompt }],
          },
        }
      : {}),
    contents: [
      {
        role: 'user',
        parts: [{ text: params.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const rawErrBody = await res.text().catch(() => '');
    const safeRawBody = redactSecrets(rawErrBody, params.apiKey);
    const upstreamMessage = extractConciseUpstreamMessage(rawErrBody, res.statusText, params.apiKey);
    console.error(
      `[ai-parse-batch] Google gemini_developer HTTP ${res.status} (${url}): ${safeRawBody.slice(0, 1000)}`
    );
    throw new UpstreamLlmError({
      upstreamStatus: res.status,
      upstreamMessage,
      rawRedactedBody: safeRawBody,
      endpointKind: 'gemini_developer',
    });
  }

  const data = (await res.json()) as Parameters<typeof parseGoogleGenerateContentPayload>[0];
  return parseGoogleGenerateContentPayload(data, 'gemini_developer', url);
}

async function executeVertexExpressRest(params: {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<string> {
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
  const safeUrl = redactSecrets(url, params.apiKey);

  const requestBody: Record<string, unknown> = {
    ...(params.systemPrompt && params.systemPrompt.trim().length > 0
      ? {
          systemInstruction: {
            role: 'system',
            parts: [{ text: params.systemPrompt }],
          },
        }
      : {}),
    contents: [
      {
        role: 'user',
        parts: [{ text: params.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const rawErrBody = await res.text().catch(() => '');
    const safeRawBody = redactSecrets(rawErrBody, params.apiKey);
    const upstreamMessage = extractConciseUpstreamMessage(rawErrBody, res.statusText, params.apiKey);
    console.error(
      `[ai-parse-batch] Google vertex_express fallback HTTP ${res.status} (${safeUrl}): ${safeRawBody.slice(0, 1000)}`
    );
    throw new UpstreamLlmError({
      upstreamStatus: res.status,
      upstreamMessage,
      rawRedactedBody: safeRawBody,
      endpointKind: 'vertex_express',
    });
  }

  const data = (await res.json()) as Parameters<typeof parseGoogleGenerateContentPayload>[0];
  return parseGoogleGenerateContentPayload(data, 'vertex_express', safeUrl);
}

async function invokeGeminiJsonWithFallback(params: {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<{ text: string; usedModel: string; endpointLabel: string }> {
  try {
    const text = await executeGeminiDeveloperRest(params);
    return { text, usedModel: params.model, endpointLabel: 'Google Gemini API' };
  } catch (primaryErr) {
    // Only if AQ.* key AND generativelanguage explicitly returned API_KEY_INVALID / API key not valid -> 1 fallback attempt to Vertex AI Express
    if (
      params.apiKey.startsWith('AQ.') &&
      primaryErr instanceof UpstreamLlmError &&
      isGeminiApiKeyInvalidError(primaryErr)
    ) {
      try {
        const text = await executeVertexExpressRest(params);
        return { text, usedModel: params.model, endpointLabel: 'Vertex AI Express' };
      } catch (vertexErr) {
        const vStatus = vertexErr instanceof UpstreamLlmError ? vertexErr.upstreamStatus : undefined;
        const vMsg =
          vertexErr instanceof UpstreamLlmError
            ? vertexErr.upstreamMessage
            : redactSecrets(
                vertexErr instanceof Error ? vertexErr.message : String(vertexErr),
                params.apiKey
              ).slice(0, 400);
        const combinedMessage = `[generativelanguage HTTP ${primaryErr.upstreamStatus}] ${primaryErr.upstreamMessage} | [aiplatform fallback${vStatus ? ` HTTP ${vStatus}` : ''}] ${vMsg}`;
        throw new UpstreamLlmError({
          upstreamStatus: primaryErr.upstreamStatus,
          upstreamMessage: combinedMessage,
          endpointKind: 'gemini_developer',
        });
      }
    }

    if (params.model !== FALLBACK_GEMINI_MODEL && isTransientServerOverloadError(primaryErr)) {
      const text = await executeGeminiDeveloperRest({
        ...params,
        model: FALLBACK_GEMINI_MODEL,
      });
      return { text, usedModel: FALLBACK_GEMINI_MODEL, endpointLabel: 'Google Gemini API' };
    }

    throw primaryErr;
  }
}

async function invokeGeminiJson(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const { text } = await invokeGeminiJsonWithFallback({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
  });
  return text;
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
  const safeEndpoint = redactSecrets(endpoint, params.apiKey);

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
    const upstreamMessage = extractConciseUpstreamMessage(errText, res.statusText, params.apiKey);
    console.error(
      `[ai-parse-batch] OpenAI-compatible HTTP ${res.status} (${safeEndpoint}): ${redactSecrets(errText, params.apiKey).slice(0, 1000)}`
    );
    throw new UpstreamLlmError({
      upstreamStatus: res.status,
      upstreamMessage,
      endpointKind: 'openai_compatible',
    });
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
      const { text: pingText, usedModel, endpointLabel } = await invokeGeminiJsonWithFallback({
        apiKey: active.apiKey,
        model: active.model,
        systemPrompt: 'Respond strictly with valid JSON {"ok": true}.',
        userPrompt: 'Верни JSON {"ok": true}',
      });
      const parsed = extractJsonObject(pingText || '{}') as { ok?: boolean };
      return NextResponse.json({
        available: true,
        probeSuccess: Boolean(parsed.ok ?? true),
        provider: active.provider,
        model: usedModel,
        geminiConfigured: active.geminiConfigured,
        openaiCompatibleConfigured: active.openaiCompatibleConfigured,
        message: `Подключение успешно проверено (${endpointLabel} · ${usedModel})`,
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
      message: `Подключение успешно проверено (OpenAI-совместимый API · ${active.model})`,
    });
  } catch (err) {
    const { upstreamStatus, upstreamMessage } = extractUpstreamErrorDetails(err, active.apiKey);
    console.error('[ai-parse-batch] Probe failed:', {
      provider: active.provider,
      model: active.model,
      upstreamStatus,
      upstreamMessage,
    });
    const formattedMsg = upstreamStatus
      ? `Ошибка провайдера (HTTP ${upstreamStatus}): ${upstreamMessage}`
      : `Ошибка провайдера: ${upstreamMessage}`;
    return NextResponse.json(
      {
        available: false,
        probeSuccess: false,
        provider: active.provider,
        model: active.model,
        geminiConfigured: active.geminiConfigured,
        openaiCompatibleConfigured: active.openaiCompatibleConfigured,
        upstreamStatus,
        upstreamMessage,
        message: formattedMsg,
      },
      { status: 503 }
    );
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
    const { upstreamStatus, upstreamMessage } = extractUpstreamErrorDetails(err, active.apiKey);
    console.error('[ai-parse-batch] Batch parse failed:', {
      provider: active.provider,
      model: active.model,
      upstreamStatus,
      upstreamMessage,
    });
    const errorText = upstreamStatus
      ? `Ошибка провайдера ИИ (HTTP ${upstreamStatus}): ${upstreamMessage}`
      : `Ошибка провайдера ИИ: ${upstreamMessage}`;
    return NextResponse.json(
      {
        ok: false,
        available: true,
        fallbackToOffline: true,
        provider: active.provider,
        model: active.model,
        upstreamStatus,
        upstreamMessage,
        error: errorText,
      },
      { status: 503 }
    );
  }
}
