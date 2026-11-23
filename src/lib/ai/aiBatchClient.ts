import {
  AiRawBatchRowInput,
  ParsedOperationIntent,
  RollingAccountingContext1C,
  sanitizeAndValidateOperationIntent,
} from '@/types/semanticIntent';

export type ParserMode1C = 'ai_json' | 'offline';
export type PreferredLlmProvider1C = 'auto' | 'gemini' | 'openai_compatible';

export interface AiProviderStatus1C {
  checked: boolean;
  available: boolean;
  provider: 'gemini' | 'openai_compatible' | 'none';
  model: string;
  geminiConfigured: boolean;
  openaiCompatibleConfigured: boolean;
  message: string;
}

export interface AiBatchProgressState1C {
  currentBatch: number;
  totalBatches: number;
  processedRows: number;
  totalRows: number;
}

export interface AiBatchFetchFunction {
  (
    input: string,
    init?: RequestInit
  ): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}

const CLIENT_INTENT_CACHE_STORAGE_KEY = 'workbench_ai_intent_cache_v1';
const MAX_CLIENT_CACHE_ITEMS = 600;
export const DEFAULT_AI_BATCH_CHUNK_SIZE = 30;

function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function buildClientIntentCacheKey(
  row: AiRawBatchRowInput,
  rollingContext: RollingAccountingContext1C
): string {
  const sig = JSON.stringify({
    d: row.date,
    desc: row.description.trim(),
    amt: row.rawExcelAmount,
    hint: row.actionSequenceHint || '',
    cp: row.counterpartyCell || '',
    own: rollingContext.ownOrganization?.name || '',
    cps: rollingContext.counterparties.length,
    ords: rollingContext.openOrders.length,
  });
  return `intent_${fnv1aHash(sig)}_${row.description.trim().length}`;
}

function loadClientIntentCache(): Record<string, ParsedOperationIntent> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CLIENT_INTENT_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveClientIntentCache(cache: Record<string, ParsedOperationIntent>): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = Object.keys(cache);
    if (keys.length > MAX_CLIENT_CACHE_ITEMS) {
      const trimmed: Record<string, ParsedOperationIntent> = {};
      for (const k of keys.slice(-MAX_CLIENT_CACHE_ITEMS)) {
        trimmed[k] = cache[k];
      }
      window.localStorage.setItem(CLIENT_INTENT_CACHE_STORAGE_KEY, JSON.stringify(trimmed));
    } else {
      window.localStorage.setItem(CLIENT_INTENT_CACHE_STORAGE_KEY, JSON.stringify(cache));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export async function checkAiProviderStatus(options?: {
  probe?: boolean;
  preferredProvider?: PreferredLlmProvider1C;
  fetchImpl?: AiBatchFetchFunction;
}): Promise<AiProviderStatus1C> {
  const fetchFn = options?.fetchImpl ?? (globalThis.fetch as AiBatchFetchFunction);
  const url = options?.probe ? '/api/ai-parse-batch?probe=1' : '/api/ai-parse-batch';
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        ...(options?.preferredProvider
          ? { 'x-llm-provider': options.preferredProvider }
          : {}),
      },
      cache: 'no-store',
    });
    const data = (await res.json()) as Partial<AiProviderStatus1C>;
    return {
      checked: true,
      available: Boolean(data.available),
      provider: data.provider ?? 'none',
      model: data.model || 'gemini-4-hydrogen',
      geminiConfigured: Boolean(data.geminiConfigured),
      openaiCompatibleConfigured: Boolean(data.openaiCompatibleConfigured),
      message:
        data.message ||
        (data.available
          ? 'Серверный ИИ-главбух активен'
          : 'Ключ провайдера не настроен — активен офлайн-парсер'),
    };
  } catch (err) {
    return {
      checked: true,
      available: false,
      provider: 'none',
      model: 'offline',
      geminiConfigured: false,
      openaiCompatibleConfigured: false,
      message:
        err instanceof Error
          ? `Сервер ИИ недоступен (${err.message}) — активен офлайн-парсер`
          : 'Сервер ИИ недоступен — активен офлайн-парсер',
    };
  }
}

export interface RequestAiBatchChunkResult {
  ok: boolean;
  fallbackToOffline: boolean;
  intentsByRowIndex: Map<number, ParsedOperationIntent>;
  warnings: string[];
  error?: string;
}

/**
 * Requests semantic JSON intents for a single chunk of rows (up to 35 rows),
 * checks local cache (unless bypassCache=true), validates via Sanity Guard,
 * and signals graceful offline fallback if the server LLM is unavailable or unreachable.
 */
export async function requestAiSemanticChunk(params: {
  rows: AiRawBatchRowInput[];
  rollingContext: RollingAccountingContext1C;
  preferredProvider?: PreferredLlmProvider1C;
  bypassCache?: boolean;
  fetchImpl?: AiBatchFetchFunction;
}): Promise<RequestAiBatchChunkResult> {
  const { rows, rollingContext, preferredProvider, bypassCache = false } = params;
  const fetchFn = params.fetchImpl ?? (globalThis.fetch as AiBatchFetchFunction);

  const intentsByRowIndex = new Map<number, ParsedOperationIntent>();
  const warnings: string[] = [];
  const clientCache = bypassCache ? {} : loadClientIntentCache();
  const rowsToFetch: AiRawBatchRowInput[] = [];

  for (const row of rows) {
    if (!bypassCache) {
      const cKey = buildClientIntentCacheKey(row, rollingContext);
      const cached = clientCache[cKey];
      if (cached) {
        const revalidated = sanitizeAndValidateOperationIntent(
          { ...cached, rowIndex: row.rowIndex },
          row,
          rollingContext
        );
        if (revalidated.ok && revalidated.intent) {
          intentsByRowIndex.set(row.rowIndex, revalidated.intent);
          continue;
        }
      }
    }
    rowsToFetch.push(row);
  }

  if (rowsToFetch.length === 0) {
    return {
      ok: true,
      fallbackToOffline: false,
      intentsByRowIndex,
      warnings,
    };
  }

  try {
    const res = await fetchFn('/api/ai-parse-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(preferredProvider ? { 'x-llm-provider': preferredProvider } : {}),
      },
      body: JSON.stringify({
        rows: rowsToFetch,
        rollingContext,
      }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      fallbackToOffline?: boolean;
      intents?: unknown[];
      warnings?: string[];
      error?: string;
    };

    if (!res.ok || !data.ok || !Array.isArray(data.intents)) {
      return {
        ok: false,
        fallbackToOffline: true,
        intentsByRowIndex,
        warnings,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    let cacheMutated = false;
    for (const rawItem of data.intents) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const rIdx = (rawItem as { rowIndex?: number }).rowIndex;
      const sourceRow = rowsToFetch.find((r) => r.rowIndex === rIdx);
      if (!sourceRow) continue;

      const checked = sanitizeAndValidateOperationIntent(rawItem, sourceRow, rollingContext);
      if (checked.ok && checked.intent) {
        intentsByRowIndex.set(sourceRow.rowIndex, checked.intent);
        warnings.push(...checked.warnings);
        if (!bypassCache) {
          const cKey = buildClientIntentCacheKey(sourceRow, rollingContext);
          clientCache[cKey] = checked.intent;
          cacheMutated = true;
        }
      }
    }

    if (cacheMutated) {
      saveClientIntentCache(clientCache);
    }

    if (Array.isArray(data.warnings)) {
      warnings.push(...data.warnings);
    }

    return {
      ok: true,
      fallbackToOffline: false,
      intentsByRowIndex,
      warnings,
    };
  } catch (err) {
    return {
      ok: false,
      fallbackToOffline: true,
      intentsByRowIndex,
      warnings,
      error: err instanceof Error ? err.message : 'Сетевая ошибка при обращении к /api/ai-parse-batch',
    };
  }
}
