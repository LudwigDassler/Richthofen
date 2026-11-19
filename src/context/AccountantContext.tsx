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
  AuditIssue,
  BalanceAnchorOverride,
  Database1CSnapshot,
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
  bindAndGenerateOperation,
  calculateOsvReport,
  generatePeriodClosingOperations,
  normalizeEntityKey,
  rebindOperationsAgainst1CDb,
  runAuditDiagnostics,
} from '@/lib/engine';
import {
  BatchImportResult,
  normalize1CDatabaseExport,
  parseFreeTextOrDelimitedOperations,
  processBatchFiles,
} from '@/lib/import1c';

export type SyncStatus = 'idle' | 'syncing' | 'connected' | 'disconnected' | 'error';

export interface NoticeBanner {
  id: string;
  tone: 'success' | 'info' | 'error';
  message: string;
}

interface AccountantContextValue {
  hydrated: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
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
  autoFixLogs: string[];
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
  applyInlineAuditValue: (target: InlineFieldTarget, value: string) => void;
  resetWorkbench: () => Promise<void>;
}

const AccountantContext = createContext<AccountantContextValue | null>(null);

export function AccountantProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('db_osv');
  const [db1C, setDb1C] = useState<Database1CSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [balanceAnchorOverride, setBalanceAnchorOverride] =
    useState<BalanceAnchorOverride>('auto');
  const [includeQueuedInOsv, setIncludeQueuedInOsv] = useState<boolean>(true);
  const [periodFilter, setPeriodFilter] = useState<{ dateFrom: string; dateTo: string }>({
    dateFrom: '',
    dateTo: '',
  });
  const [operations, setOperations] = useState<QueuedOperation[]>([]);
  const [autoFixLogs, setAutoFixLogs] = useState<string[]>([]);
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
    if (saved) {
      setActiveTab(saved.activeTab);
      setDb1C(saved.db1C);
      setBalanceAnchorOverride(saved.balanceAnchorOverride);
      setIncludeQueuedInOsv(saved.includeQueuedInOsv);
      setPeriodFilter(saved.periodFilter);
      setOperations(saved.operations);
      setExportMode(saved.exportMode);
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
              setPeriodFilter({
                dateFrom: incoming.periodStart,
                dateTo: incoming.periodEnd,
              });
              setOperations((prevOps) => rebindOperationsAgainst1CDb(prevOps, incoming));
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
      db1C,
      balanceAnchorOverride,
      includeQueuedInOsv,
      periodFilter,
      operations,
      resolvedInlineNotes: {},
      exportMode,
    });
  }, [
    hydrated,
    activeTab,
    db1C,
    balanceAnchorOverride,
    includeQueuedInOsv,
    periodFilter,
    operations,
    exportMode,
  ]);

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
          setPeriodFilter({
            dateFrom: snapshot.periodStart,
            dateTo: snapshot.periodEnd,
          });
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
                'В .cache/1c_latest_raw.json пока нет выгрузки. Загрузите JSON-выгрузку 1С вручную или отправьте POST на /api/1c-sync.'
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
    [db1C, pushNotice]
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
        setPeriodFilter({
          dateFrom: snapshot.periodStart,
          dateTo: snapshot.periodEnd,
        });
        setOperations((prev) => rebindOperationsAgainst1CDb(prev, snapshot));
        setSyncStatus('connected');

        // Also mirror to /api/1c-sync server cache so refreshes or backend checks see it
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
    [db1C, pushNotice]
  );

  const importOperationFiles = useCallback(
    async (files: File[]): Promise<BatchImportResult> => {
      const inputs = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          buffer: await f.arrayBuffer(),
        }))
      );

      const result = processBatchFiles(inputs, db1C);

      if (result.updatedDb1C) {
        const nextDb = result.updatedDb1C;
        setDb1C(nextDb);
        setSyncStatus('connected');
        setPeriodFilter({
          dateFrom: nextDb.periodStart,
          dateTo: nextDb.periodEnd,
        });
        setOperations((prev) => [
          ...rebindOperationsAgainst1CDb(prev, nextDb),
          ...result.operations,
        ]);
      } else if (result.operations.length > 0) {
        setOperations((prev) => [...prev, ...result.operations]);
      }

      const totalOps = result.operations.length;
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
          `Разобрано файлов: ${files.length} · Операций добавлено: ${totalOps}${
            dupOps > 0 ? ` (дубликатов в БД 1С: ${dupOps})` : ''
          }`
        );
      }

      return result;
    },
    [db1C, pushNotice]
  );

  const importOperationsFromText = useCallback(
    (text: string, sourceLabel = 'Буфер обмена'): number => {
      const drafts = parseFreeTextOrDelimitedOperations(text, sourceLabel, db1C);
      if (drafts.length === 0) {
        pushNotice(
          'error',
          'Не удалось выделить операции из вставленного текста. Проверьте наличие сумм и описания.'
        );
        return 0;
      }
      const generated = drafts.map((d) => bindAndGenerateOperation(d, db1C));
      setOperations((prev) => [...prev, ...generated]);
      pushNotice('success', `Из текста разобрано и привязано операций: ${generated.length}`);
      return generated.length;
    },
    [db1C, pushNotice]
  );

  const addBlankOperation = useCallback(() => {
    const defaultDate =
      periodFilter.dateTo || db1C?.periodEnd || new Date().toISOString().slice(0, 10);
    const op = bindAndGenerateOperation(
      {
        sourceFileName: 'Ручной ввод',
        date: defaultDate,
        docNumber: '',
        description: 'Поступление услуг от поставщика',
        amount: 0,
        counterpartyName: '',
      },
      db1C
    );
    // Ensure at least one editable entry line even when amount is 0
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
  }, [db1C, periodFilter.dateTo]);

  const updateOperation = useCallback(
    (id: string, updater: (prev: QueuedOperation) => QueuedOperation) => {
      setOperations((prev) => prev.map((op) => (op.id === id ? updater(op) : op)));
    },
    []
  );

  const rebuildSingleOperationPostings = useCallback(
    (id: string) => {
      setOperations((prev) =>
        prev.map((op) => {
          if (op.id !== id) return op;
          return bindAndGenerateOperation(
            {
              sourceFileName: op.sourceFileName,
              date: op.date,
              docNumber: op.docNumber,
              description: op.description,
              amount: op.amount,
              vatRate: op.vatRate,
              vatRule: op.vatRule,
              hasInvoiceSF: op.hasInvoiceSF,
              quantity: op.quantity,
              counterpartyName: op.counterpartyName,
              counterpartyInn: op.counterpartyInn,
              counterpartyKpp: op.counterpartyKpp,
              contractName: op.contractName,
              nomenclatureName: op.nomenclatureName,
              warehouseName: op.warehouseName,
              expenseItemName: op.expenseItemName,
              cashFlowItemName: op.cashFlowItemName,
            },
            db1C,
            op.id
          );
        })
      );
      pushNotice('info', 'Проводки и привязки к БД 1С пересчитаны для выбранной операции.');
    },
    [db1C, pushNotice]
  );

  const removeOperation = useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }, []);

  const clearAllOperations = useCallback(() => {
    setOperations([]);
    setAutoFixLogs([]);
    pushNotice('info', 'Очередь загруженных операций очищена.');
  }, [pushNotice]);

  const osvReport = useMemo(
    () =>
      calculateOsvReport({
        db1C,
        operations,
        dateFrom: periodFilter.dateFrom,
        dateTo: periodFilter.dateTo,
        balanceAnchorOverride,
        includeQueuedOperations: includeQueuedInOsv,
      }),
    [db1C, operations, periodFilter.dateFrom, periodFilter.dateTo, balanceAnchorOverride, includeQueuedInOsv]
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

  const runSmartAutoFixAll = useCallback(() => {
    const endDate =
      periodFilter.dateTo || db1C?.periodEnd || new Date().toISOString().slice(0, 10);
    const res = autoFixAllBy1CDb({
      db1C,
      operations,
      calculateCurrentOsv: (ops) =>
        calculateOsvReport({
          db1C,
          operations: ops,
          dateFrom: periodFilter.dateFrom,
          dateTo: periodFilter.dateTo,
          balanceAnchorOverride,
          includeQueuedOperations: true,
        }),
      periodEndDate: endDate,
    });

    setOperations(res.operations);
    setIncludeQueuedInOsv(true);
    setAutoFixLogs(res.log);

    if (res.fixedCount > 0) {
      pushNotice(
        'success',
        `Автоисправление выполнено: исправлено замечаний и регламентных блоков — ${res.fixedCount}`
      );
    } else {
      pushNotice(
        'info',
        'Все доступные реквизиты из БД 1С и закрывающие проводки уже заполнены.'
      );
    }
    return { fixedCount: res.fixedCount, log: res.log };
  }, [db1C, operations, periodFilter.dateFrom, periodFilter.dateTo, balanceAnchorOverride, pushNotice]);

  const runClosingAndOffsetsOnly = useCallback(() => {
    const baseOps = operations.filter((op) => !op.autoGeneratedKind);
    const currentOsv = calculateOsvReport({
      db1C,
      operations: baseOps,
      dateFrom: periodFilter.dateFrom,
      dateTo: periodFilter.dateTo,
      balanceAnchorOverride,
      includeQueuedOperations: true,
    });
    const endDate =
      periodFilter.dateTo || db1C?.periodEnd || new Date().toISOString().slice(0, 10);
    const { newOperations, log } = generatePeriodClosingOperations({
      db1C,
      operations: baseOps,
      osv: currentOsv,
      periodEndDate: endDate,
    });
    setOperations([...baseOps, ...newOperations]);
    setAutoFixLogs(log);
    pushNotice(
      'success',
      newOperations.length > 0
        ? `Сформировано регламентных операций (зачёт авансов / НДС / закрытие счетов): ${newOperations.length}`
        : 'Нет незакрытых остатков по счетам 26, 90, 91 или авансам.'
    );
    return { addedCount: newOperations.length, log };
  }, [db1C, operations, periodFilter.dateFrom, periodFilter.dateTo, balanceAnchorOverride, pushNotice]);

  const applyInlineAuditValue = useCallback(
    (target: InlineFieldTarget, rawValue: string) => {
      const value = rawValue.trim();
      setOperations((prev) => {
        const sourceOp = prev.find((o) => o.id === target.operationId);
        const sameCpKey =
          sourceOp?.counterpartyName ? normalizeEntityKey(sourceOp.counterpartyName) : '';

        return prev.map((op) => {
          if (target.kind === 'entry_account') {
            if (op.id !== target.operationId) return op;
            return {
              ...op,
              entries: op.entries.map((e) =>
                e.id === target.entryId
                  ? { ...e, [target.side]: value }
                  : e
              ),
            };
          }

          // Propagate INN / KPP / Contract across all operations of the exact same counterparty!
          const isSameOp = op.id === target.operationId;
          const isPropagatableCpField =
            (target.field === 'counterpartyInn' ||
              target.field === 'counterpartyKpp' ||
              target.field === 'contractName') &&
            sameCpKey &&
            normalizeEntityKey(op.counterpartyName) === sameCpKey;

          if (!isSameOp && !isPropagatableCpField) return op;

          const updated = { ...op, bindings: { ...op.bindings } };
          if (target.field === 'counterpartyInn') {
            updated.counterpartyInn = value.replace(/\D/g, '');
          } else if (target.field === 'counterpartyKpp') {
            updated.counterpartyKpp = value.replace(/\D/g, '');
          } else if (target.field === 'contractName') {
            updated.contractName = value;
            updated.bindings.contract = value
              ? { status: 'new_for_1c', note: 'Заполнено вручную (будет создан при экспорте)' }
              : { status: 'missing', note: 'Не указан договор' };
          } else if (target.field === 'warehouseName') {
            updated.warehouseName = value;
            updated.bindings.warehouse = value
              ? { status: 'new_for_1c', note: 'Заполнено вручную' }
              : { status: 'missing' };
          } else if (target.field === 'expenseItemName') {
            updated.expenseItemName = value;
            updated.bindings.expenseItem = value
              ? { status: 'new_for_1c', note: 'Заполнено вручную' }
              : { status: 'missing' };
          } else {
            updated[target.field] = value;
          }

          return updated;
        });
      });
    },
    []
  );

  const resetWorkbench = useCallback(async () => {
    clearWorkbenchState();
    setDb1C(null);
    setOperations([]);
    setAutoFixLogs([]);
    setPeriodFilter({ dateFrom: '', dateTo: '' });
    setSyncStatus('disconnected');
    try {
      await fetch('/api/1c-sync', { method: 'DELETE' });
    } catch {
      // Ignore
    }
    pushNotice('info', 'Все локальные данные и кэш выгрузки 1С очищены.');
  }, [pushNotice]);

  const value = useMemo<AccountantContextValue>(
    () => ({
      hydrated,
      theme,
      toggleTheme,
      activeTab,
      setActiveTab,
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
      autoFixLogs,
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
      applyInlineAuditValue,
      resetWorkbench,
    }),
    [
      hydrated,
      theme,
      toggleTheme,
      activeTab,
      db1C,
      syncStatus,
      syncError,
      balanceAnchorOverride,
      includeQueuedInOsv,
      periodFilter,
      operations,
      osvReport,
      auditIssues,
      autoFixLogs,
      exportMode,
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
      applyInlineAuditValue,
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
