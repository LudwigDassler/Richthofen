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
    const reportingYear =
      typeof parsed.reportingYear === 'number' &&
      parsed.reportingYear >= 2000 &&
      parsed.reportingYear <= 2100
        ? parsed.reportingYear
        : 2026;
    const calculationProfile =
      parsed.calculationProfile === 'bp30_legacy_pre2023'
        ? 'bp30_legacy_pre2023'
        : db1C?.usesLegacyPayrollAccounts
          ? 'bp30_legacy_pre2023'
          : 'rf_2026';
    const monthlyProfitTax =
      typeof parsed.monthlyProfitTax === 'boolean'
        ? parsed.monthlyProfitTax
        : calculationProfile === 'bp30_legacy_pre2023';

    const rawOperations = Array.isArray(parsed.operations) ? parsed.operations : [];
    const sanitizedOperations = sanitizeHydratedOperations(rawOperations, db1C, {
      reportingYear,
      calculationProfile,
      monthlyProfitTax,
    });

    return {
      version: 2,
      activeTab: parsed.activeTab ?? 'db_osv',
      reportingYear,
      calculationProfile,
      monthlyProfitTax,
      db1C,
      balanceAnchorOverride: parsed.balanceAnchorOverride ?? 'auto',
      includeQueuedInOsv: parsed.includeQueuedInOsv ?? true,
      osvSourceMode:
        parsed.osvSourceMode ??
        (parsed.includeQueuedInOsv === false ? 'db_only' : 'combined'),
      periodFilter: parsed.periodFilter ?? {
        dateFrom: `${reportingYear}-01-01`,
        dateTo: `${reportingYear}-12-31`,
      },
      operations: sanitizedOperations,
      resolvedInlineNotes: {},
      exportMode: parsed.exportMode ?? 'incremental',
      lastImportStats: parsed.lastImportStats ?? null,
      autoFixChanges: Array.isArray(parsed.autoFixChanges) ? parsed.autoFixChanges : [],
      autoFixSummary: parsed.autoFixSummary ?? null,
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
