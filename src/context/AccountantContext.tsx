'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AccompanyingAction1C,
  AuditIssue,
  AutoFixChangeRecord,
  BalanceAnchorOverride,
  BatchImportCompletenessStats,
  Database1CSnapshot,
  DEFAULT_REPORTING_YEAR,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_CORR,
  DEFAULT_SBERBANK_NAME,
  DirectoryAutocompleteOption1C,
  EgrulCandidate,
  ExportMode1C,
  InlineFieldTarget,
  OsvReport,
  QueuedOperation,
  WorkspaceTab,
} from '@/types/accounting';
import {
  clearWorkbenchState,
  loadWorkbenchState,
  saveWorkbenchState,
} from '@/lib/storage';
import {
  autoFixAllBy1CDb,
  BatchSequentialContext,
  bindAndGenerateOperation,
  buildAccompanyingActions1C,
  calculateOsvReport,
  computePendingNewCounterparties,
  generatePeriodClosingOperations,
  get1CCounterpartyAndIndividualOptions,
  getCounterpartyGroupKey,
  inferCounterpartyKind,
  isValidRussianInnFormat,
  matchPersonOrCounterpartyIn1C,
  normalizeEntityKey,
  PendingNewCounterpartyInfo,
  rebindOperationsAgainst1CDb,
  runAuditDiagnostics,
  sanitizeHydratedOperations,
} from '@/lib/engine';
import {
  BatchImportResult,
  normalize1CDatabaseExport,
  normalizeOperationDateToReportingYear,
  parseFreeTextOrDelimitedOperations,
  parseRussianNumber,
  processBatchFiles,
} from '@/lib/import1c';

export type SyncStatus = 'idle' | 'syncing' | 'connected' | 'disconnected' | 'error';

export interface NoticeBanner {
  id: string;
  tone: 'success' | 'info' | 'error';
  message: string;
}

interface EgrulBatchResultItem {
  found: boolean;
  query: string;
  candidates: EgrulCandidate[];
  error?: string;
}

function buildDefaultPeriodForYear(
  snapshot: Database1CSnapshot | null,
  year: number
): { dateFrom: string; dateTo: string } {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!snapshot) {
    return { dateFrom: yearStart, dateTo: yearEnd };
  }
  const startInYear =
    snapshot.periodStart && snapshot.periodStart.startsWith(`${year}-`)
      ? snapshot.periodStart
      : yearStart;
  const endInYear =
    snapshot.periodEnd && snapshot.periodEnd.startsWith(`${year}-`)
      ? snapshot.periodEnd
      : yearEnd;
  return { dateFrom: startInYear, dateTo: endInYear };
}

interface AccountantContextValue {
  hydrated: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  reportingYear: number;
  setReportingYear: (year: number) => void;
  db1C: Database1CSnapshot | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  balanceAnchorOverride: BalanceAnchorOverride;
  setBalanceAnchorOverride: (val: BalanceAnchorOverride) => void;
  includeQueuedInOsv: boolean;
  setIncludeQueuedInOsv: (val: boolean) => void;
  periodFilter: { dateFrom: string; dateTo: string };
  setPeriodFilter: (filter: { dateFrom: string; dateTo: string }) => void;
  operations: QueuedOperation[];
  osvReport: OsvReport;
  auditIssues: AuditIssue[];
  directoryOptions1C: DirectoryAutocompleteOption1C[];
  pendingNewCounterparties: PendingNewCounterpartyInfo[];
  accompanyingActions: AccompanyingAction1C[];
  lastImportStats: BatchImportCompletenessStats | null;
  autoFixLogs: string[];
  autoFixChanges: AutoFixChangeRecord[];
  isLookingUpEgrul: boolean;
  exportMode: ExportMode1C;
  setExportMode: (mode: ExportMode1C) => void;
  notice: NoticeBanner | null;
  dismissNotice: () => void;

  // Actions
  syncWith1CEndpoint: (silent?: boolean) => Promise<void>;
  load1CJsonFile: (file: File) => Promise<void>;
  importOperationFiles: (files: File[]) => Promise<BatchImportResult>;
  importOperationsFromText: (text: string, sourceLabel?: string) => number;
  addBlankOperation: () => void;
  updateOperation: (id: string, updater: (prev: QueuedOperation) => QueuedOperation) => void;
  rebuildSingleOperationPostings: (id: string) => void;
  removeOperation: (id: string) => void;
  clearAllOperations: () => void;
  runSmartAutoFixAll: () => { fixedCount: number; log: string[] };
  runClosingAndOffsetsOnly: () => { addedCount: number; log: string[] };
  lookupCounterpartiesInEgrul: (targetGroupKey?: string) => Promise<number>;
  selectEgrulCandidateForCounterparty: (
    groupKey: string,
    candidate: EgrulCandidate
  ) => void;
  applyInlineAuditValue: (
    target: InlineFieldTarget,
    value: string
  ) => { ok: boolean; error?: string };
  bindOperationTo1CDirectoryItem: (
    operationId: string,
    item: DirectoryAutocompleteOption1C
  ) => void;
  resetNewCounterparty: (counterpartyNameOrKey: string) => number;
  resetWorkbench: () => Promise<void>;
}

const AccountantContext = createContext<AccountantContextValue | null>(null);

export function AccountantProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('db_osv');
  const [reportingYear, setReportingYearState] = useState<number>(DEFAULT_REPORTING_YEAR);
  const [db1C, setDb1C] = useState<Database1CSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [balanceAnchorOverride, setBalanceAnchorOverride] =
    useState<BalanceAnchorOverride>('auto');
  const [includeQueuedInOsv, setIncludeQueuedInOsv] = useState<boolean>(true);
  const [periodFilter, setPeriodFilter] = useState<{ dateFrom: string; dateTo: string }>({
    dateFrom: `${DEFAULT_REPORTING_YEAR}-01-01`,
    dateTo: `${DEFAULT_REPORTING_YEAR}-12-31`,
  });
  const [operations, setOperations] = useState<QueuedOperation[]>([]);
  const [lastImportStats, setLastImportStats] =
    useState<BatchImportCompletenessStats | null>(null);
  const [autoFixLogs, setAutoFixLogs] = useState<string[]>([]);
  const [autoFixChanges, setAutoFixChanges] = useState<AutoFixChangeRecord[]>([]);
  const [isLookingUpEgrul, setIsLookingUpEgrul] = useState<boolean>(false);
  const [exportMode, setExportMode] = useState<ExportMode1C>('incremental');
  const [notice, setNotice] = useState<NoticeBanner | null>(null);

  const pushNotice = useCallback((tone: NoticeBanner['tone'], message: string) => {
    setNotice({
      id: `${Date.now()}`,
      tone,
      message,
    });
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const setReportingYear = useCallback(
    (rawYear: number) => {
      const nextYear = Math.max(2000, Math.min(2100, Math.trunc(rawYear) || DEFAULT_REPORTING_YEAR));
      setReportingYearState(nextYear);
      setPeriodFilter((prev) => {
        const nextFrom = prev.dateFrom
          ? `${nextYear}${prev.dateFrom.slice(4)}`
          : `${nextYear}-01-01`;
        const nextTo = prev.dateTo
          ? `${nextYear}${prev.dateTo.slice(4)}`
          : `${nextYear}-12-31`;
        return { dateFrom: nextFrom, dateTo: nextTo };
      });
      setOperations((prev) =>
        prev.map((op) => {
          const normDate = normalizeOperationDateToReportingYear(op.date, nextYear);
          return normDate && normDate !== op.date ? { ...op, date: normDate } : op;
        })
      );
      setLastImportStats((prev) =>
        prev
          ? {
              ...prev,
              sheetDefaults: { ...prev.sheetDefaults, reportingYear: nextYear },
            }
          : prev
      );
    },
    []
  );

  // Theme initialization
  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem('workbench_theme_v2');
      if (savedTheme === 'dark') {
        setTheme('dark');
        document.documentElement.classList.add('dark');
      } else {
        setTheme('light');
        document.documentElement.classList.remove('dark');
      }
    } catch {
      // Ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem('workbench_theme_v2', next);
      } catch {
        // Ignore
      }
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return next;
    });
  }, []);

  // Hydrate app_state_v2 and check /api/1c-sync
  useEffect(() => {
    const saved = loadWorkbenchState();
    const initialYear = saved?.reportingYear ?? DEFAULT_REPORTING_YEAR;
    if (saved) {
      setActiveTab(saved.activeTab);
      setReportingYearState(initialYear);
      setDb1C(saved.db1C);
      setBalanceAnchorOverride(saved.balanceAnchorOverride);
      setIncludeQueuedInOsv(saved.includeQueuedInOsv);
      const savedFrom = saved.periodFilter?.dateFrom || '';
      const savedTo = saved.periodFilter?.dateTo || '';
      if (savedFrom && savedFrom >= `${initialYear}-01-01`) {
        setPeriodFilter({ dateFrom: savedFrom, dateTo: savedTo || `${initialYear}-12-31` });
      } else {
        setPeriodFilter(buildDefaultPeriodForYear(saved.db1C, initialYear));
      }
      setOperations(saved.operations);
      setExportMode(saved.exportMode);
      setLastImportStats(saved.lastImportStats ?? null);
      setAutoFixChanges(saved.autoFixChanges ?? []);
      if (saved.db1C) {
        setSyncStatus('connected');
      }
    }
    setHydrated(true);

    // Check live /api/1c-sync endpoint on startup
    (async () => {
      try {
        const res = await fetch('/api/1c-sync', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.connected && data.snapshot) {
          const incoming = data.snapshot as Database1CSnapshot;
          setDb1C((current) => {
            if (!current) {
              setPeriodFilter(buildDefaultPeriodForYear(incoming, initialYear));
              setOperations((prevOps) =>
                rebindOperationsAgainst1CDb(sanitizeHydratedOperations(prevOps, incoming), incoming)
              );
              return incoming;
            }
            return current;
          });
          setSyncStatus('connected');
        } else if (!saved?.db1C) {
          setSyncStatus('disconnected');
        }
      } catch {
        if (!saved?.db1C) {
          setSyncStatus('disconnected');
        }
      }
    })();
  }, []);

  // Persist app_state_v2
  useEffect(() => {
    if (!hydrated) return;
    saveWorkbenchState({
      version: 2,
      activeTab,
      reportingYear,
      db1C,
      balanceAnchorOverride,
      includeQueuedInOsv,
      periodFilter,
      operations,
      resolvedInlineNotes: {},
      exportMode,
      lastImportStats,
      autoFixChanges,
    });
  }, [
    hydrated,
    activeTab,
    reportingYear,
    db1C,
    balanceAnchorOverride,
    includeQueuedInOsv,
    periodFilter,
    operations,
    exportMode,
    lastImportStats,
    autoFixChanges,
  ]);

  const executeEgrulLookupInternal = useCallback(
    async (
      sourceOperations: QueuedOperation[],
      targetGroupKey?: string,
      recordInAutoFixLog = false
    ): Promise<number> => {
      const queriesMap = new Map<string, { key: string; name: string; inn?: string }>();

      for (const op of sourceOperations) {
        if (!op.includeInProcessing || op.autoGeneratedKind) continue;
        const needsCp = ![
          'closing',
          'payroll_accrual',
          'payroll_payout',
          'bank_fee',
        ].includes(op.category);
        if (!needsCp) continue;

        const trimmedName = op.counterpartyName.trim();
        if (trimmedName.length < 2) continue;
        if (op.counterpartyKind === 'ФизическоеЛицо') continue;
        if (op.bindings.counterparty.status === 'matched_1c') continue;

        const groupKey = getCounterpartyGroupKey(trimmedName);
        if (targetGroupKey && groupKey !== targetGroupKey) continue;

        if (!targetGroupKey) {
          if (
            op.counterpartySource === 'excel_explicit' ||
            op.counterpartySource === 'manual' ||
            op.counterpartySource === 'egrul_verified' ||
            op.counterpartySource === 'educational_unverified'
          ) {
            continue;
          }
          const validInn = isValidRussianInnFormat(op.counterpartyInn);
          const hasKpp = op.counterpartyKpp.replace(/\D/g, '').length === 9;
          if (validInn && (op.counterpartyKind !== 'ЮридическоеЛицо' || hasKpp)) {
            continue;
          }
        }

        if (!queriesMap.has(groupKey)) {
          queriesMap.set(groupKey, {
            key: groupKey,
            name: trimmedName,
            inn: isValidRussianInnFormat(op.counterpartyInn) ? op.counterpartyInn : undefined,
          });
        }
      }

      const queries = Array.from(queriesMap.values());
      if (queries.length === 0) return 0;

      setIsLookingUpEgrul(true);
      try {
        const res = await fetch('/api/egrul-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries, regionHint: '78' }),
        });
        if (!res.ok) return 0;
        const data = (await res.json()) as {
          results?: Record<string, EgrulBatchResultItem>;
        };
        const results = data.results ?? {};

        let resolvedCount = 0;
        const extraChanges: AutoFixChangeRecord[] = [];
        const extraLogs: string[] = [];

        setOperations((prev) =>
          prev.map((op) => {
            if (op.autoGeneratedKind) return op;
            const trimmedName = op.counterpartyName.trim();
            if (trimmedName.length < 2) return op;
            const groupKey = getCounterpartyGroupKey(trimmedName);
            const lookup = results[groupKey];
            if (!lookup) return op;

            // Never overwrite manual or matched_1c bindings unless explicitly requested via targetGroupKey
            if (
              !targetGroupKey &&
              (op.bindings.counterparty.status === 'matched_1c' ||
                op.counterpartySource === 'manual' ||
                op.counterpartySource === 'excel_explicit')
            ) {
              return op;
            }

            if (lookup.found && lookup.candidates.length > 0) {
              const best = lookup.candidates[0];
              return {
                ...op,
                counterpartyInn: best.inn || op.counterpartyInn,
                counterpartyKpp: best.kpp || op.counterpartyKpp,
                counterpartyOgrn: best.ogrn || op.counterpartyOgrn,
                counterpartyKind: best.kind,
                counterpartySource: 'egrul_verified',
                egrulCandidates: lookup.candidates,
                bindings: {
                  ...op.bindings,
                  counterparty: {
                    ...op.bindings.counterparty,
                    note: `Проверено по ЕГРЮЛ ФНС (ИНН ${best.inn}${
                      best.kpp ? ` / КПП ${best.kpp}` : ''
                    })`,
                  },
                },
              };
            }

            return {
              ...op,
              counterpartySource: 'educational_unverified',
              egrulCandidates: [],
              bindings: {
                ...op.bindings,
                counterparty: {
                  ...op.bindings.counterparty,
                  note: 'Учебный контрагент (не найден в ЕГРЮЛ)',
                },
              },
            };
          })
        );

        for (const q of queries) {
          const lookup = results[q.key];
          if (!lookup) continue;
          if (lookup.found && lookup.candidates.length > 0) {
            resolvedCount++;
            const best = lookup.candidates[0];
            extraLogs.push(
              `ЕГРЮЛ ФНС: для «${q.name}» подтверждены реальные реквизиты ИНН ${best.inn}${
                best.kpp ? `, КПП ${best.kpp}` : ''
              }`
            );
            extraChanges.push({
              id: `egrul-ok-${q.key}-${Date.now()}`,
              whatWas: `Контрагент «${q.name}»: ИНН/КПП не заполнены`,
              whatBecame: `ИНН ${best.inn}${best.kpp ? `, КПП ${best.kpp}` : ''}${
                best.ogrn ? `, ОГРН ${best.ogrn}` : ''
              }`,
              basis: 'Официальный реестр ЕГРЮЛ ФНС России (egrul.nalog.ru)',
              category: 'counterparty_requisites',
            });
          } else {
            extraLogs.push(
              `ЕГРЮЛ ФНС: «${q.name}» отсутствует в госреестре — присвоен статус «Учебный контрагент (не найден в ЕГРЮЛ)» без выдуманного ИНН`
            );
            extraChanges.push({
              id: `egrul-edu-${q.key}-${Date.now()}`,
              whatWas: `Контрагент «${q.name}»: статус не определён`,
              whatBecame: 'Статус «Учебный контрагент (не найден в ЕГРЮЛ)»',
              basis:
                'Проверка по ЕГРЮЛ ФНС России — организация не зарегистрирована, фейковый ИНН не генерируется',
              category: 'counterparty_requisites',
            });
          }
        }

        if (recordInAutoFixLog && extraChanges.length > 0) {
          setAutoFixLogs((prev) => [...prev, ...extraLogs]);
          setAutoFixChanges((prev) => [...prev, ...extraChanges]);
        }

        if (targetGroupKey) {
          const single = results[targetGroupKey];
          if (single?.found && single.candidates.length > 0) {
            const best = single.candidates[0];
            pushNotice(
              'success',
              `Найдено в ЕГРЮЛ ФНС: ${best.name} — ИНН ${best.inn}${
                best.kpp ? `, КПП ${best.kpp}` : ''
              }`
            );
          } else {
            pushNotice(
              'info',
              'Организация не найдена в ЕГРЮЛ ФНС — помечена как «Учебный контрагент (не найден в ЕГРЮЛ)».'
            );
          }
        }

        return resolvedCount;
      } catch {
        return 0;
      } finally {
        setIsLookingUpEgrul(false);
      }
    },
    [pushNotice]
  );

  const lookupCounterpartiesInEgrul = useCallback(
    async (targetGroupKey?: string): Promise<number> => {
      return executeEgrulLookupInternal(operations, targetGroupKey, false);
    },
    [operations, executeEgrulLookupInternal]
  );

  const selectEgrulCandidateForCounterparty = useCallback(
    (groupKey: string, candidate: EgrulCandidate) => {
      setOperations((prev) =>
        prev.map((op) => {
          if (op.autoGeneratedKind) return op;
          if (getCounterpartyGroupKey(op.counterpartyName) !== groupKey) return op;
          return {
            ...op,
            counterpartyInn: candidate.inn,
            counterpartyKpp: candidate.kpp || op.counterpartyKpp,
            counterpartyOgrn: candidate.ogrn || op.counterpartyOgrn,
            counterpartyKind: candidate.kind,
            counterpartySource: 'egrul_verified',
            bindings: {
              ...op.bindings,
              counterparty: {
                ...op.bindings.counterparty,
                note: `Выбрано подразделение ЕГРЮЛ ФНС (ИНН ${candidate.inn}${
                  candidate.kpp ? ` / КПП ${candidate.kpp}` : ''
                })`,
              },
            },
          };
        })
      );
      pushNotice(
        'success',
        `Выбраны реквизиты ЕГРЮЛ: ИНН ${candidate.inn}${
          candidate.kpp ? `, КПП ${candidate.kpp}` : ''
        }`
      );
    },
    [pushNotice]
  );

  const syncWith1CEndpoint = useCallback(
    async (silent = false) => {
      setSyncStatus('syncing');
      setSyncError(null);
      try {
        const res = await fetch('/api/1c-sync', { cache: 'no-store' });
        const data = await res.json();
        if (res.ok && data.connected && data.snapshot) {
          const snapshot = data.snapshot as Database1CSnapshot;
          setDb1C(snapshot);
          setPeriodFilter(buildDefaultPeriodForYear(snapshot, reportingYear));
          setOperations((prev) => rebindOperationsAgainst1CDb(prev, snapshot));
          setSyncStatus('connected');
          if (!silent) {
            pushNotice(
              'success',
              `База 1С синхронизирована: ${snapshot.organization.name || 'Организация'} (счетов: ${snapshot.rawBalances.length}, проводок: ${snapshot.postings.length})`
            );
          }
        } else {
          setSyncStatus(db1C ? 'connected' : 'disconnected');
          if (!silent) {
            pushNotice(
              'info',
              data.message ||
                'На сервере /api/1c-sync пока нет сохранённой выгрузки. Загрузите JSON-выгрузку 1С вручную или отправьте POST на /api/1c-sync.'
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка соединения с /api/1c-sync';
        setSyncError(msg);
        setSyncStatus(db1C ? 'connected' : 'error');
        if (!silent) {
          pushNotice('error', msg);
        }
      }
    },
    [db1C, reportingYear, pushNotice]
  );

  const load1CJsonFile = useCallback(
    async (file: File) => {
      setSyncStatus('syncing');
      setSyncError(null);
      try {
        const rawText = await file.text();
        const cleanText = rawText.replace(/^\uFEFF/, '');
        const parsed = JSON.parse(cleanText);
        const snapshot = normalize1CDatabaseExport(parsed, file.name);

        setDb1C(snapshot);
        setBalanceAnchorOverride('auto');
        setPeriodFilter(buildDefaultPeriodForYear(snapshot, reportingYear));
        setOperations((prev) => rebindOperationsAgainst1CDb(prev, snapshot));
        setSyncStatus('connected');

        try {
          await fetch('/api/1c-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: cleanText,
          });
        } catch {
          // Local state is already updated
        }

        pushNotice(
          'success',
          `Загружена база 1С «${snapshot.organization.name || file.name}»: ИНН ${
            snapshot.organization.inn || 'не указан'
          }, проводок ${snapshot.postings.length}, справочников ${
            Object.keys(snapshot.rawDirectories).length
          }`
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Не удалось прочитать JSON-файл выгрузки 1С';
        setSyncError(msg);
        setSyncStatus(db1C ? 'connected' : 'error');
        pushNotice('error', msg);
      }
    },
    [db1C, reportingYear, pushNotice]
  );

  const importOperationFiles = useCallback(
    async (files: File[]): Promise<BatchImportResult> => {
      const inputs = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          buffer: await f.arrayBuffer(),
        }))
      );

      const result = processBatchFiles(inputs, db1C, {
        reportingYear,
        priorOperations: operations,
      });

      let mergedOps: QueuedOperation[] = operations;

      if (result.updatedDb1C) {
        const nextDb = result.updatedDb1C;
        setDb1C(nextDb);
        setSyncStatus('connected');
        setPeriodFilter(buildDefaultPeriodForYear(nextDb, reportingYear));
        mergedOps = [
          ...rebindOperationsAgainst1CDb(operations, nextDb),
          ...result.operations,
        ];
        setOperations(mergedOps);
      } else if (result.operations.length > 0) {
        mergedOps = [...operations, ...result.operations];
        setOperations(mergedOps);
      }

      if (result.completenessStats.filesUploaded > 0) {
        setLastImportStats((prev) => {
          if (!prev || operations.length === 0) {
            return result.completenessStats;
          }
          return {
            filesUploaded: prev.filesUploaded + result.completenessStats.filesUploaded,
            excelOperationRowsTotal:
              prev.excelOperationRowsTotal +
              result.completenessStats.excelOperationRowsTotal,
            importedOperationsCount:
              prev.importedOperationsCount +
              result.completenessStats.importedOperationsCount,
            generatedPostingsCount:
              prev.generatedPostingsCount +
              result.completenessStats.generatedPostingsCount,
            skippedRowsCount:
              prev.skippedRowsCount + result.completenessStats.skippedRowsCount,
            skippedReasons: [
              ...prev.skippedReasons,
              ...result.completenessStats.skippedReasons,
            ],
            sheetDefaults: result.completenessStats.sheetDefaults,
          };
        });
      }

      const totalOps = result.operations.length;
      const totalPostings = result.completenessStats.generatedPostingsCount;
      const dupOps = result.operations.filter((o) => o.isDuplicateIn1C).length;

      if (result.errors.length > 0) {
        pushNotice('error', result.errors.join('; '));
      } else if (result.updatedDb1C && totalOps === 0) {
        pushNotice(
          'success',
          `База 1С обновлена из файла (${result.updatedDb1C.organization.name || 'Организация'})`
        );
      } else {
        pushNotice(
          'success',
          `Загружено файлов: ${result.completenessStats.filesUploaded} · Импортировано операций: ${totalOps} · Сформировано проводок: ${totalPostings}${
            dupOps > 0 ? ` (дубликатов в БД 1С: ${dupOps})` : ''
          }`
        );
      }

      if (result.operations.length > 0) {
        void executeEgrulLookupInternal(mergedOps, undefined, false);
      }

      return result;
    },
    [db1C, reportingYear, operations, pushNotice, executeEgrulLookupInternal]
  );

  const importOperationsFromText = useCallback(
    (text: string, sourceLabel = 'Буфер обмена'): number => {
      const drafts = parseFreeTextOrDelimitedOperations(text, sourceLabel, db1C, {
        reportingYear,
      });
      if (drafts.length === 0) {
        pushNotice(
          'error',
          'Не удалось выделить операции из вставленного текста. Проверьте наличие описания хозяйственной операции.'
        );
        return 0;
      }

      const defaultBik =
        lastImportStats?.sheetDefaults.defaultBik ||
        db1C?.organization.bik ||
        DEFAULT_SBERBANK_BIK;
      const defaultBankName =
        lastImportStats?.sheetDefaults.defaultBankName ||
        db1C?.organization.bankName ||
        DEFAULT_SBERBANK_NAME;

      const generated: QueuedOperation[] = [];
      drafts.forEach((d, idx) => {
        const seqCtx: BatchSequentialContext = {
          priorOperations: [...operations, ...generated],
          reportingYear,
          defaultBik,
          defaultBankName,
          assumeInvoiceOnVatPurchase: true,
        };
        const op = bindAndGenerateOperation(
          d,
          db1C,
          `op-txt-${reportingYear}-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
          seqCtx
        );
        generated.push(op);
      });

      const nextOps = [...operations, ...generated];
      setOperations(nextOps);

      const addedPostings = generated.reduce((s, o) => s + o.entries.length, 0);
      setLastImportStats((prev) => {
        const base = prev && operations.length > 0 ? prev : null;
        return {
          filesUploaded: (base?.filesUploaded ?? 0) + 1,
          excelOperationRowsTotal:
            (base?.excelOperationRowsTotal ?? 0) + generated.length,
          importedOperationsCount:
            (base?.importedOperationsCount ?? 0) + generated.length,
          generatedPostingsCount: (base?.generatedPostingsCount ?? 0) + addedPostings,
          skippedRowsCount: base?.skippedRowsCount ?? 0,
          skippedReasons: base?.skippedReasons ?? [],
          sheetDefaults: base?.sheetDefaults ?? {
            defaultBik,
            defaultBankName,
            defaultCorrAccount: DEFAULT_SBERBANK_CORR,
            reportingYear,
            rawHeaderNotes: [],
          },
        };
      });

      pushNotice(
        'success',
        `Из текста импортировано операций: ${generated.length} · Сформировано проводок: ${addedPostings}`
      );
      void executeEgrulLookupInternal(nextOps, undefined, false);
      return generated.length;
    },
    [db1C, reportingYear, operations, lastImportStats, pushNotice, executeEgrulLookupInternal]
  );

  const addBlankOperation = useCallback(() => {
    const defaultDate = `${reportingYear}-04-01`;
    const op = bindAndGenerateOperation(
      {
        sourceFileName: 'Ручной ввод',
        date: defaultDate,
        docNumber: '',
        description: 'Поступление услуг от поставщика',
        amount: 0,
        needsAmount: true,
        counterpartyName: '',
      },
      db1C
    );
    if (op.entries.length === 0) {
      op.entries = [
        {
          id: `${op.id}-e1`,
          debit: '26',
          credit: '60.01',
          debitSubconto: '',
          creditSubconto: '',
          amount: 0,
          description: 'Ручная проводка',
        },
      ];
    }
    setOperations((prev) => [op, ...prev]);
  }, [db1C, reportingYear]);

  const updateOperation = useCallback(
    (id: string, updater: (prev: QueuedOperation) => QueuedOperation) => {
      setOperations((prev) => prev.map((op) => (op.id === id ? updater(op) : op)));
    },
    []
  );

  const rebuildSingleOperationPostings = useCallback(
    (id: string) => {
      const defaultBik =
        lastImportStats?.sheetDefaults.defaultBik ||
        db1C?.organization.bik ||
        DEFAULT_SBERBANK_BIK;
      const defaultBankName =
        lastImportStats?.sheetDefaults.defaultBankName ||
        db1C?.organization.bankName ||
        DEFAULT_SBERBANK_NAME;

      setOperations((prev) => {
        const idx = prev.findIndex((o) => o.id === id);
        if (idx === -1) return prev;
        const op = prev[idx];
        const priorOps = prev.slice(0, idx);
        const rebuilt = bindAndGenerateOperation(
          {
            rowKey: op.rowKey,
            sourceFileName: op.sourceFileName,
            date: normalizeOperationDateToReportingYear(op.date, reportingYear) || op.date,
            docNumber: op.docNumber,
            description: op.description,
            amount: op.amount,
            vatRate: op.vatRate,
            vatRule: op.vatRule,
            hasInvoiceSF: op.hasInvoiceSF,
            quantity: op.quantity,
            unitPrice: op.unitPrice,
            counterpartyName: op.counterpartyName,
            counterpartyInn: op.counterpartyInn,
            counterpartyKpp: op.counterpartyKpp,
            counterpartyBankAccount: op.counterpartyBankAccount,
            counterpartyBik: op.counterpartyBik,
            counterpartyBankName: op.counterpartyBankName,
            counterpartySource: op.counterpartySource,
            contractName: op.contractName,
            nomenclatureName: op.nomenclatureName,
            warehouseName: op.warehouseName,
            expenseItemName: op.expenseItemName,
            cashFlowItemName: op.cashFlowItemName,
          },
          db1C,
          op.id,
          {
            priorOperations: priorOps,
            reportingYear,
            defaultBik,
            defaultBankName,
            assumeInvoiceOnVatPurchase: op.hasInvoiceSF,
          }
        );
        return prev.map((item, i) => (i === idx ? rebuilt : item));
      });
      pushNotice('info', 'Проводки и привязки к БД 1С пересчитаны для выбранной операции.');
    },
    [db1C, reportingYear, lastImportStats, pushNotice]
  );

  const removeOperation = useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }, []);

  const clearAllOperations = useCallback(() => {
    setOperations([]);
    setLastImportStats(null);
    setAutoFixLogs([]);
    setAutoFixChanges([]);
    pushNotice('info', 'Очередь загруженных операций очищена.');
  }, [pushNotice]);

  const osvReport = useMemo(
    () =>
      calculateOsvReport({
        db1C,
        operations,
        dateFrom: periodFilter.dateFrom,
        dateTo: periodFilter.dateTo,
        reportingYear,
        balanceAnchorOverride,
        includeQueuedOperations: includeQueuedInOsv,
      }),
    [
      db1C,
      operations,
      periodFilter.dateFrom,
      periodFilter.dateTo,
      reportingYear,
      balanceAnchorOverride,
      includeQueuedInOsv,
    ]
  );

  const auditIssues = useMemo(
    () =>
      runAuditDiagnostics({
        db1C,
        operations,
        osv: osvReport,
      }),
    [db1C, operations, osvReport]
  );

  const directoryOptions1C = useMemo(
    () => get1CCounterpartyAndIndividualOptions(db1C),
    [db1C]
  );

  const pendingNewCounterparties = useMemo(
    () => computePendingNewCounterparties(operations, db1C),
    [operations, db1C]
  );

  const accompanyingActions = useMemo(
    () =>
      buildAccompanyingActions1C(
        operations,
        db1C,
        lastImportStats?.sheetDefaults.defaultBik || DEFAULT_SBERBANK_BIK,
        lastImportStats?.sheetDefaults.defaultBankName || DEFAULT_SBERBANK_NAME
      ),
    [operations, db1C, lastImportStats]
  );

  const runSmartAutoFixAll = useCallback(() => {
    const activeDates = operations
      .filter((o) => o.includeInProcessing && !o.autoGeneratedKind && o.date.startsWith(`${reportingYear}-`))
      .map((o) => o.date)
      .sort();
    const lastOpMonthEnd = (() => {
      const lastOp = activeDates[activeDates.length - 1];
      if (!lastOp) return `${reportingYear}-12-31`;
      const [, mStr] = lastOp.split('-');
      const month = Number(mStr) || 12;
      const lastDay = new Date(Date.UTC(reportingYear, month, 0)).getUTCDate();
      return `${reportingYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    })();

    const endDate =
      periodFilter.dateTo && periodFilter.dateTo.startsWith(`${reportingYear}-`)
        ? activeDates.length > 0
          ? lastOpMonthEnd
          : periodFilter.dateTo
        : lastOpMonthEnd;

    const defaultBik =
      lastImportStats?.sheetDefaults.defaultBik ||
      db1C?.organization.bik ||
      DEFAULT_SBERBANK_BIK;

    const res = autoFixAllBy1CDb({
      db1C,
      operations,
      calculateCurrentOsv: (ops) =>
        calculateOsvReport({
          db1C,
          operations: ops,
          dateFrom: periodFilter.dateFrom,
          dateTo: periodFilter.dateTo,
          reportingYear,
          balanceAnchorOverride,
          includeQueuedOperations: true,
        }),
      periodEndDate: endDate,
      reportingYear,
      defaultBik,
    });

    setOperations(res.operations);
    setIncludeQueuedInOsv(true);
    setAutoFixLogs(res.log);
    setAutoFixChanges(res.structuredChanges);

    // Also run official FNS EGRUL verification for any remaining unresolved counterparties
    void executeEgrulLookupInternal(res.operations, undefined, true);

    if (res.fixedCount > 0) {
      pushNotice(
        'success',
        `Автоисправление выполнено: исправлено замечаний и регламентных блоков — ${res.fixedCount}`
      );
    } else {
      pushNotice(
        'info',
        'Все доступные реквизиты из БД 1С, ЕГРЮЛ и закрывающие проводки проверены.'
      );
    }
    return { fixedCount: res.fixedCount, log: res.log };
  }, [
    db1C,
    operations,
    periodFilter.dateFrom,
    periodFilter.dateTo,
    reportingYear,
    balanceAnchorOverride,
    lastImportStats,
    pushNotice,
    executeEgrulLookupInternal,
  ]);

  const runClosingAndOffsetsOnly = useCallback(() => {
    const baseOps = operations.filter((op) => !op.autoGeneratedKind);
    const currentOsv = calculateOsvReport({
      db1C,
      operations: baseOps,
      dateFrom: periodFilter.dateFrom,
      dateTo: periodFilter.dateTo,
      reportingYear,
      balanceAnchorOverride,
      includeQueuedOperations: true,
    });
    const activeDates = baseOps
      .filter((o) => o.includeInProcessing && o.date.startsWith(`${reportingYear}-`))
      .map((o) => o.date)
      .sort();
    const endDate = (() => {
      const lastOp = activeDates[activeDates.length - 1];
      if (!lastOp) return periodFilter.dateTo || `${reportingYear}-12-31`;
      const [, mStr] = lastOp.split('-');
      const month = Number(mStr) || 12;
      const lastDay = new Date(Date.UTC(reportingYear, month, 0)).getUTCDate();
      return `${reportingYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    })();

    const { newOperations, log, structuredChanges } = generatePeriodClosingOperations({
      db1C,
      operations: baseOps,
      osv: currentOsv,
      periodEndDate: endDate,
    });
    setOperations([...baseOps, ...newOperations]);
    setAutoFixLogs(log);
    setAutoFixChanges(structuredChanges);
    pushNotice(
      'success',
      newOperations.length > 0
        ? `Сформировано регламентных операций (зачёт авансов / НДС / закрытие счетов): ${newOperations.length}`
        : 'Нет незакрытых остатков по счетам 20, 26, 44, 90, 91 или авансам.'
    );
    return { addedCount: newOperations.length, log };
  }, [
    db1C,
    operations,
    periodFilter.dateFrom,
    periodFilter.dateTo,
    reportingYear,
    balanceAnchorOverride,
    pushNotice,
  ]);

  const bindOperationTo1CDirectoryItem = useCallback(
    (operationId: string, item: DirectoryAutocompleteOption1C) => {
      setOperations((prev) =>
        prev.map((op) => {
          if (op.id !== operationId) return op;

          const needsCtr = [
            'bank_out',
            'bank_in',
            'purchase_goods',
            'purchase_materials',
            'purchase_services',
            'sale_goods',
            'sale_services',
            'advance_offset',
          ].includes(op.category);

          let contractName = op.contractName;
          let contractNumber = op.contractNumber;
          let contractDate = op.contractDate;
          let contractBinding = op.bindings.contract;

          if (needsCtr && !contractName) {
            const matchedCtr =
              db1C?.contracts.find(
                (c) =>
                  (item.inn && c.counterpartyInn?.replace(/\D/g, '') === item.inn) ||
                  normalizeEntityKey(c.counterpartyName) === normalizeEntityKey(item.name)
              ) ?? null;

            if (matchedCtr) {
              contractName = matchedCtr.name;
              contractNumber = matchedCtr.number || contractNumber;
              contractDate = matchedCtr.date || contractDate;
              contractBinding = {
                status: 'matched_1c',
                matchedName: matchedCtr.name,
                matchedCode1C: matchedCtr.code1C,
              };
            } else if (item.defaultContract) {
              contractName = item.defaultContract;
              contractBinding = {
                status: 'matched_1c',
                matchedName: item.defaultContract,
              };
            }
          }

          const cpSubconto = [item.name, contractName].filter(Boolean).join(' / ');
          const updatedEntries = op.entries.map((e) => ({
            ...e,
            debitSubconto:
              e.debit.startsWith('60') || e.debit.startsWith('62') || e.debit.startsWith('76')
                ? cpSubconto || item.name
                : e.debit === '75.01'
                  ? item.name
                  : e.debitSubconto,
            creditSubconto:
              e.credit.startsWith('60') || e.credit.startsWith('62') || e.credit.startsWith('76')
                ? cpSubconto || item.name
                : e.credit === '75.01'
                  ? item.name
                  : e.creditSubconto,
          }));

          return {
            ...op,
            counterpartyName: item.name,
            counterpartyInn: item.inn || '',
            counterpartyKpp: item.kpp || '',
            counterpartyKind: item.kind,
            counterpartySource: 'db_1c',
            contractName,
            contractNumber,
            contractDate,
            bindings: {
              ...op.bindings,
              counterparty: {
                status: 'matched_1c',
                matchedName: item.name,
                matchedCode1C: item.code1C,
                matchedInn: item.inn,
                note:
                  item.source === 'ФизическиеЛица'
                    ? 'Привязано к справочнику 1С «ФизическиеЛица»'
                    : 'Привязано к справочнику 1С «Контрагенты»',
              },
              contract: contractBinding,
            },
            entries: updatedEntries,
          };
        })
      );
      pushNotice(
        'success',
        `Привязан элемент из БД 1С (${item.source}): «${item.name}»`
      );
    },
    [db1C, pushNotice]
  );

  const resetNewCounterparty = useCallback(
    (counterpartyNameOrKey: string): number => {
      const targetKey = getCounterpartyGroupKey(counterpartyNameOrKey);
      const rawLower = counterpartyNameOrKey.trim().toLowerCase();
      let clearedCount = 0;

      setOperations((prev) =>
        prev.map((op) => {
          if (op.autoGeneratedKind) return op;
          if (op.bindings.counterparty.status === 'matched_1c') return op;

          const opTrimmed = op.counterpartyName.trim();
          if (!opTrimmed) return op;

          const opKey = getCounterpartyGroupKey(opTrimmed);
          if (opKey !== targetKey && opTrimmed.toLowerCase() !== rawLower) {
            return op;
          }

          clearedCount++;
          const needsCp = ![
            'closing',
            'payroll_accrual',
            'payroll_payout',
            'bank_fee',
            'tax_payment',
          ].includes(op.category);

          const shouldResetContract = op.bindings.contract.status === 'new_for_1c';

          const cleanedEntries = op.entries.map((e) => ({
            ...e,
            debitSubconto:
              e.debit.startsWith('60') ||
              e.debit.startsWith('62') ||
              e.debit === '75.01' ||
              e.debit === '76.АВ'
                ? ''
                : e.debitSubconto,
            creditSubconto:
              e.credit.startsWith('60') ||
              e.credit.startsWith('62') ||
              e.credit === '75.01'
                ? ''
                : e.creditSubconto,
          }));

          return {
            ...op,
            counterpartyName: '',
            counterpartyInn: '',
            counterpartyKpp: '',
            counterpartySource: 'unresolved',
            egrulCandidates: undefined,
            contractName: shouldResetContract ? '' : op.contractName,
            bindings: {
              ...op.bindings,
              counterparty: needsCp
                ? { status: 'missing', note: 'Не указан контрагент' }
                : { status: 'not_required' },
              contract: shouldResetContract
                ? { status: 'missing', note: 'Не указан договор' }
                : op.bindings.contract,
            },
            entries: cleanedEntries,
          };
        })
      );

      if (clearedCount > 0) {
        pushNotice(
          'info',
          `Контрагент «${counterpartyNameOrKey.trim()}» сброшен (очищена привязка в операциях: ${clearedCount}).`
        );
      }
      return clearedCount;
    },
    [pushNotice]
  );

  const applyInlineAuditValue = useCallback(
    (
      target: InlineFieldTarget,
      rawValue: string
    ): { ok: boolean; error?: string } => {
      const value = rawValue.trim();

      if (target.kind === 'entry_account') {
        if (value.length < 2) {
          return { ok: false, error: 'Укажите корректный код счёта РСБУ (например, 26 или 60.01).' };
        }
        setOperations((prev) =>
          prev.map((op) => {
            if (op.id !== target.operationId) return op;
            return {
              ...op,
              entries: op.entries.map((e) =>
                e.id === target.entryId ? { ...e, [target.side]: value } : e
              ),
            };
          })
        );
        return { ok: true };
      }

      if (target.field === 'amount') {
        const parsedAmt = parseRussianNumber(value);
        if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
          return {
            ok: false,
            error: 'Введите положительную сумму операции в рублях (например: 120000).',
          };
        }

        const defaultBik =
          lastImportStats?.sheetDefaults.defaultBik ||
          db1C?.organization.bik ||
          DEFAULT_SBERBANK_BIK;
        const defaultBankName =
          lastImportStats?.sheetDefaults.defaultBankName ||
          db1C?.organization.bankName ||
          DEFAULT_SBERBANK_NAME;

        setOperations((prev) => {
          const idx = prev.findIndex((o) => o.id === target.operationId);
          if (idx === -1) return prev;
          const op = prev[idx];
          const rebuilt = bindAndGenerateOperation(
            {
              rowKey: op.rowKey,
              sourceFileName: op.sourceFileName,
              date: op.date,
              docNumber: op.docNumber,
              description: op.description,
              amount: parsedAmt,
              vatRate: op.vatRate,
              vatRule: op.vatRule,
              hasInvoiceSF: op.hasInvoiceSF,
              quantity: op.quantity,
              unitPrice: op.unitPrice,
              counterpartyName: op.counterpartyName,
              counterpartyInn: op.counterpartyInn,
              counterpartyKpp: op.counterpartyKpp,
              counterpartyBankAccount: op.counterpartyBankAccount,
              counterpartyBik: op.counterpartyBik,
              counterpartyBankName: op.counterpartyBankName,
              counterpartySource: op.counterpartySource,
              contractName: op.contractName,
              nomenclatureName: op.nomenclatureName,
              warehouseName: op.warehouseName,
              expenseItemName: op.expenseItemName,
              cashFlowItemName: op.cashFlowItemName,
              amountCalculationNote: 'Заполнено вручную пользователем',
            },
            db1C,
            op.id,
            {
              priorOperations: prev.slice(0, idx),
              reportingYear,
              defaultBik,
              defaultBankName,
              assumeInvoiceOnVatPurchase: op.hasInvoiceSF,
            }
          );
          return prev.map((item, i) => (i === idx ? rebuilt : item));
        });
        return { ok: true };
      }

      if (target.field === 'counterpartyName') {
        if (value.length < 2) {
          return {
            ok: false,
            error: 'Наименование контрагента должно содержать не менее 2 символов.',
          };
        }
        const matched1C = matchPersonOrCounterpartyIn1C(value, '', db1C);
        if (matched1C) {
          bindOperationTo1CDirectoryItem(target.operationId, matched1C);
          return { ok: true };
        }

        setOperations((prev) =>
          prev.map((op) => {
            if (op.id !== target.operationId) return op;
            const cpSub = [value, op.contractName].filter(Boolean).join(' / ');
            return {
              ...op,
              counterpartyName: value,
              counterpartyKind: inferCounterpartyKind(value, op.counterpartyInn),
              counterpartySource: 'unresolved',
              bindings: {
                ...op.bindings,
                counterparty: {
                  status: 'new_for_1c',
                  note: 'Новый элемент (будет создан при экспорте в 1С)',
                },
              },
              entries: op.entries.map((e) => ({
                ...e,
                debitSubconto:
                  e.debit.startsWith('60') || e.debit.startsWith('62')
                    ? cpSub
                    : e.debit === '75.01'
                      ? value
                      : e.debitSubconto,
                creditSubconto:
                  e.credit.startsWith('60') || e.credit.startsWith('62')
                    ? cpSub
                    : e.credit === '75.01'
                      ? value
                      : e.creditSubconto,
              })),
            };
          })
        );
        return { ok: true };
      }

      if (target.field === 'counterpartyInn') {
        const digits = value.replace(/\D/g, '');
        if (digits.length !== 10 && digits.length !== 12) {
          return {
            ok: false,
            error: 'Введите ровно 10 (юрлицо) или 12 (ИП / физлицо) цифр ИНН.',
          };
        }

        setOperations((prev) => {
          const sourceOp = prev.find((o) => o.id === target.operationId);
          const sameCpKey = sourceOp?.counterpartyName
            ? getCounterpartyGroupKey(sourceOp.counterpartyName)
            : '';
          const matchedByInn = matchPersonOrCounterpartyIn1C(
            sourceOp?.counterpartyName ?? '',
            digits,
            db1C
          );

          return prev.map((op) => {
            const isSameOp = op.id === target.operationId;
            const isSameCp =
              Boolean(sameCpKey) &&
              getCounterpartyGroupKey(op.counterpartyName) === sameCpKey;
            if (!isSameOp && !isSameCp) return op;

            if (matchedByInn) {
              return {
                ...op,
                counterpartyName: matchedByInn.name,
                counterpartyInn: matchedByInn.inn || digits,
                counterpartyKpp: matchedByInn.kpp || op.counterpartyKpp,
                counterpartyKind: matchedByInn.kind,
                counterpartySource: 'db_1c',
                bindings: {
                  ...op.bindings,
                  counterparty: {
                    status: 'matched_1c',
                    matchedName: matchedByInn.name,
                    matchedCode1C: matchedByInn.code1C,
                    matchedInn: matchedByInn.inn || digits,
                  },
                },
              };
            }

            return {
              ...op,
              counterpartyInn: digits,
              counterpartyKind: inferCounterpartyKind(op.counterpartyName, digits),
              counterpartySource: 'manual',
            };
          });
        });
        return { ok: true };
      }

      if (target.field === 'counterpartyKpp') {
        const digits = value.replace(/\D/g, '');
        if (digits.length !== 9) {
          return { ok: false, error: 'Введите ровно 9 цифр КПП.' };
        }
        setOperations((prev) => {
          const sourceOp = prev.find((o) => o.id === target.operationId);
          const sameCpKey = sourceOp?.counterpartyName
            ? getCounterpartyGroupKey(sourceOp.counterpartyName)
            : '';
          return prev.map((op) => {
            const isSameOp = op.id === target.operationId;
            const isSameCp =
              Boolean(sameCpKey) &&
              getCounterpartyGroupKey(op.counterpartyName) === sameCpKey;
            if (!isSameOp && !isSameCp) return op;
            return { ...op, counterpartyKpp: digits, counterpartySource: 'manual' };
          });
        });
        return { ok: true };
      }

      if (!value) {
        return { ok: false, error: 'Поле не может быть пустым.' };
      }

      const stringField = target.field;

      setOperations((prev) => {
        const sourceOp = prev.find((o) => o.id === target.operationId);
        const sameCpKey = sourceOp?.counterpartyName
          ? getCounterpartyGroupKey(sourceOp.counterpartyName)
          : '';

        return prev.map((op) => {
          const isSameOp = op.id === target.operationId;
          const isPropagatableCpField =
            stringField === 'contractName' &&
            Boolean(sameCpKey) &&
            getCounterpartyGroupKey(op.counterpartyName) === sameCpKey;

          if (!isSameOp && !isPropagatableCpField) return op;

          const updated = { ...op, bindings: { ...op.bindings } };
          if (stringField === 'contractName') {
            updated.contractName = value;
            updated.bindings.contract = {
              status: 'new_for_1c',
              note: 'Заполнено вручную (будет создан при экспорте)',
            };
          } else if (stringField === 'warehouseName') {
            updated.warehouseName = value;
            updated.bindings.warehouse = {
              status: 'new_for_1c',
              note: 'Заполнено вручную',
            };
          } else if (stringField === 'expenseItemName') {
            updated.expenseItemName = value;
            updated.bindings.expenseItem = {
              status: 'new_for_1c',
              note: 'Заполнено вручную',
            };
          } else {
            updated[stringField] = value;
          }

          return updated;
        });
      });

      return { ok: true };
    },
    [db1C, reportingYear, lastImportStats, bindOperationTo1CDirectoryItem]
  );

  const resetWorkbench = useCallback(async () => {
    clearWorkbenchState();
    setDb1C(null);
    setOperations([]);
    setLastImportStats(null);
    setAutoFixLogs([]);
    setAutoFixChanges([]);
    setPeriodFilter({
      dateFrom: `${reportingYear}-01-01`,
      dateTo: `${reportingYear}-12-31`,
    });
    setSyncStatus('disconnected');
    try {
      await fetch('/api/1c-sync', { method: 'DELETE' });
    } catch {
      // Ignore
    }
    pushNotice('info', 'Все локальные данные и кэш выгрузки 1С очищены.');
  }, [reportingYear, pushNotice]);

  const value = useMemo<AccountantContextValue>(
    () => ({
      hydrated,
      theme,
      toggleTheme,
      activeTab,
      setActiveTab,
      reportingYear,
      setReportingYear,
      db1C,
      syncStatus,
      syncError,
      balanceAnchorOverride,
      setBalanceAnchorOverride,
      includeQueuedInOsv,
      setIncludeQueuedInOsv,
      periodFilter,
      setPeriodFilter,
      operations,
      osvReport,
      auditIssues,
      directoryOptions1C,
      pendingNewCounterparties,
      accompanyingActions,
      lastImportStats,
      autoFixLogs,
      autoFixChanges,
      isLookingUpEgrul,
      exportMode,
      setExportMode,
      notice,
      dismissNotice,
      syncWith1CEndpoint,
      load1CJsonFile,
      importOperationFiles,
      importOperationsFromText,
      addBlankOperation,
      updateOperation,
      rebuildSingleOperationPostings,
      removeOperation,
      clearAllOperations,
      runSmartAutoFixAll,
      runClosingAndOffsetsOnly,
      lookupCounterpartiesInEgrul,
      selectEgrulCandidateForCounterparty,
      applyInlineAuditValue,
      bindOperationTo1CDirectoryItem,
      resetNewCounterparty,
      resetWorkbench,
    }),
    [
      hydrated,
      theme,
      toggleTheme,
      activeTab,
      reportingYear,
      setReportingYear,
      db1C,
      syncStatus,
      syncError,
      balanceAnchorOverride,
      includeQueuedInOsv,
      periodFilter,
      operations,
      osvReport,
      auditIssues,
      directoryOptions1C,
      pendingNewCounterparties,
      accompanyingActions,
      lastImportStats,
      autoFixLogs,
      autoFixChanges,
      isLookingUpEgrul,
      exportMode,
      setExportMode,
      notice,
      dismissNotice,
      syncWith1CEndpoint,
      load1CJsonFile,
      importOperationFiles,
      importOperationsFromText,
      addBlankOperation,
      updateOperation,
      rebuildSingleOperationPostings,
      removeOperation,
      clearAllOperations,
      runSmartAutoFixAll,
      runClosingAndOffsetsOnly,
      lookupCounterpartiesInEgrul,
      selectEgrulCandidateForCounterparty,
      applyInlineAuditValue,
      bindOperationTo1CDirectoryItem,
      resetNewCounterparty,
      resetWorkbench,
    ]
  );

  return (
    <AccountantContext.Provider value={value}>
      {children}
    </AccountantContext.Provider>
  );
}

export function useAccountant(): AccountantContextValue {
  const ctx = useContext(AccountantContext);
  if (!ctx) {
    throw new Error('useAccountant must be used within AccountantProvider');
  }
  return ctx;
}
