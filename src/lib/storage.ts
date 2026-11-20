import { sanitizeHydratedOperations } from '@/lib/engine/postingEngine';
import { PersistedWorkbenchStateV2 } from '@/types/accounting';

export const STORAGE_KEY_V2 = 'app_state_v2';

const LEGACY_KEYS_TO_PURGE = [
  '1c_personal_accountant_v3',
  '1c_personal_accountant_v2',
  '1c_personal_accountant_v1',
  '1c_ai_settings_v1',
  'accountant_state',
  'app_state_v1',
];

export function purgeLegacyStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_KEYS_TO_PURGE) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage restriction errors in private contexts
  }
}

export function loadWorkbenchState(): PersistedWorkbenchStateV2 | null {
  if (typeof window === 'undefined') return null;
  purgeLegacyStorage();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkbenchStateV2>;
    if (parsed.version !== 2) {
      window.localStorage.removeItem(STORAGE_KEY_V2);
      return null;
    }
    const db1C = parsed.db1C ?? null;
    const rawOperations = Array.isArray(parsed.operations) ? parsed.operations : [];
    const sanitizedOperations = sanitizeHydratedOperations(rawOperations, db1C);

    return {
      version: 2,
      activeTab: parsed.activeTab ?? 'db_osv',
      db1C,
      balanceAnchorOverride: parsed.balanceAnchorOverride ?? 'auto',
      includeQueuedInOsv: parsed.includeQueuedInOsv ?? true,
      periodFilter: parsed.periodFilter ?? {
        dateFrom: db1C?.periodStart ?? '',
        dateTo: db1C?.periodEnd ?? '',
      },
      operations: sanitizedOperations,
      resolvedInlineNotes: {},
      exportMode: parsed.exportMode ?? 'incremental',
    };
  } catch {
    return null;
  }
}

export function saveWorkbenchState(state: PersistedWorkbenchStateV2): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
  } catch {
    // Quota or private mode
  }
}

export function clearWorkbenchState(): void {
  if (typeof window === 'undefined') return;
  try {
    purgeLegacyStorage();
    window.localStorage.removeItem(STORAGE_KEY_V2);
  } catch {
    // Ignore
  }
}
