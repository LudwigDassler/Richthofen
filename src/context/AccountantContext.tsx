'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AiProviderConfig,
  ApplyImported1CPayload,
  BusinessOperation,
  ChatMessage,
  CounterpartyCard1C,
  DemoScenarioPreset,
  EmployeeCard1C,
  ExtractedDirectories1C,
  Full1CAuditReport,
  NomenclatureCard1C,
  OpeningBalanceEntry,
  OperationStatus,
  OrganizationCard,
  OsvReconciliationResult,
  OsvReport,
  RequisiteCheckReport,
  Synced1CSnapshot,
  UserOsvInputRow,
  WorkspaceTab,
} from '@/types/accounting';
import { DEFAULT_DEMO_SCENARIO, DEMO_SCENARIOS } from '@/data/demoScenario';
import {
  calculateOsv,
  checkRequisitesCompleteness,
  enrichOperationsWith1CMatch,
  extractDirectoriesFromTask,
  generateMonthEndClosingOperations,
  reconcileUserOsv,
  resolveOperationsWithSmartLinks,
  runFull1CAudit,
} from '@/lib/engine';
import {
  clearPersistedState,
  loadPersistedState,
  loadUploadedImageFromIdb,
  PersistedAccountantState,
  saveBackupSnapshotToIdb,
  savePersistedState,
  saveUploadedImageToIdb,
} from '@/lib/storage';

const INITIAL_WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome-msg-1',
  role: 'assistant',
  content:
    'Здравствуйте! Я ваш **Личный бухгалтер по 1С:Бухгалтерия 8.3 (ред. 3.0)**.\n\nРабочая область разделена на 3 понятные вкладки:\n1. **Что сделать в 1С (Пошагово):** список операций со статусами из вашей базы 1С (🟢 Сделано, 🟠 Нужна правка, ⚪ Нужно создать) и 4 четких блока инструкций.\n2. **Что уже есть в моей базе 1С:** живой обзор вашей организации, документов (`Проведен` / `Черновик`), справочников и остатков на 31.03.\n3. **Проверка ошибок и ОСВ:** автоматический поиск недочетов и сверка Оборотно-сальдовой ведомости.',
  timestamp: '2026-04-01T09:00:00.000Z',
};

const DEFAULT_AI_CONFIG: AiProviderConfig = {
  provider: 'demo-local',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gemini-2.0-flash',
};

export type { ApplyImported1CPayload };

export interface ImportTaskPayload {
  title?: string;
  organizationPatch?: Partial<OrganizationCard>;
  openingBalances?: OpeningBalanceEntry[];
  operations: BusinessOperation[];
  directories?: Partial<ExtractedDirectories1C>;
  uploadedImageDataUrl?: string | null;
}

export interface AccountantContextValue {
  // Core state
  isHydrated: boolean;
  activePresetId: string;
  demoScenarios: DemoScenarioPreset[];
  taskTitle: string;
  organization: OrganizationCard;
  effectiveOrganization: OrganizationCard;
  openingBalances: OpeningBalanceEntry[];
  rawOperations: BusinessOperation[];
  operations: BusinessOperation[];
  includeAutoClosing: boolean;
  directories: ExtractedDirectories1C;
  activeOperationId: string;
  activeOperation: BusinessOperation | null;
  activeTab: WorkspaceTab;
  osvMode: 'completed_only' | 'all_operations';
  osvReport: OsvReport;
  referenceOsvReport: OsvReport;
  userOsvInputs: Record<string, UserOsvInputRow>;
  reconciliation: OsvReconciliationResult;
  synced1C: Synced1CSnapshot | null;
  isSyncing1C: boolean;
  requisiteReport: RequisiteCheckReport;
  auditReport: Full1CAuditReport;
  chatMessages: ChatMessage[];
  aiConfig: AiProviderConfig;
  theme: 'light' | 'dark';
  lastSavedAt: string | null;
  uploadedImageDataUrl: string | null;

  // Organization & Opening balances actions
  setTaskTitle: (title: string) => void;
  setOrganization: React.Dispatch<React.SetStateAction<OrganizationCard>>;
  updateOrganization: (patch: Partial<OrganizationCard>) => void;
  setOpeningBalances: React.Dispatch<React.SetStateAction<OpeningBalanceEntry[]>>;
  addOpeningBalance: (entry: Omit<OpeningBalanceEntry, 'id'> & { id?: string }) => void;
  updateOpeningBalance: (id: string, patch: Partial<OpeningBalanceEntry>) => void;
  removeOpeningBalance: (id: string) => void;
  clearOpeningBalances: () => void;
  balanceOpeningDifferenceTo84: () => void;
  applyImported1CData: (payload: ApplyImported1CPayload) => void;

  // Live 1C Sync & Error Auditor actions
  refreshFrom1CSync: () => Promise<boolean>;
  simulate1CSyncWithSampleErrors: () => Promise<void>;
  clear1CSyncSnapshot: () => Promise<void>;

  // Operations & navigation actions
  setRawOperations: React.Dispatch<React.SetStateAction<BusinessOperation[]>>;
  setIncludeAutoClosing: (include: boolean) => void;
  setActiveOperationId: (id: string) => void;
  selectOperationAndNavigate: (id: string) => void;
  setOperationStatus: (id: string, status: OperationStatus) => void;
  toggleOperationDone: (id: string) => void;
  markAllOperationsDone: () => void;
  resetAllOperationsStatus: () => void;
  updateOperation: (id: string, patch: Partial<BusinessOperation>) => void;
  setActiveTab: (tab: WorkspaceTab) => void;

  // Directories actions
  toggleDirectoryItemCreated: (idOrCategory: string, maybeId?: string) => void;
  addCounterparty: (item: Omit<CounterpartyCard1C, 'id'> & { id?: string }) => void;
  addNomenclature: (item: Omit<NomenclatureCard1C, 'id'> & { id?: string }) => void;
  addEmployee: (item: Omit<EmployeeCard1C, 'id'> & { id?: string }) => void;

  // OSV & Reconciliation actions
  setOsvMode: (mode: 'completed_only' | 'all_operations') => void;
  setUserOsvInputs: React.Dispatch<React.SetStateAction<Record<string, UserOsvInputRow>>>;
  updateUserOsvInput: (accountCode: string, patch: Partial<UserOsvInputRow>) => void;
  clearUserOsvInputs: () => void;
  fillUserOsvFromReference: () => void;
  simulateTypicalAdvanceErrorInOsv: () => void;

  // Scenarios, Import, Chat, AI, Theme & Persistence
  loadDemoScenario: (presetId: string) => void;
  resetToDefaultDemo: () => void;
  importParsedTask: (payload: ImportTaskPayload) => void;
  setUploadedImageDataUrl: (dataUrl: string | null) => void;
  addChatMessage: (
    msg: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ) => void;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  clearChatMessages: () => void;
  updateAiConfig: (patch: Partial<AiProviderConfig>) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  saveSnapshotNow: (label?: string) => Promise<void>;
}

const AccountantContext = createContext<AccountantContextValue | null>(null);

function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function normalizeEntityKey(str?: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(
      /\b(ооо|ао|пао|зао|оао|ип|общество с ограниченной ответственностью|акционерное общество)\b/g,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function AccountantProvider({ children }: { children: React.ReactNode }) {
  const existingParent = useContext(AccountantContext);
  if (existingParent) {
    return <>{children}</>;
  }

  return <AccountantProviderInner>{children}</AccountantProviderInner>;
}

function AccountantProviderInner({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string>(DEFAULT_DEMO_SCENARIO.id);
  const [taskTitle, setTaskTitle] = useState<string>(DEFAULT_DEMO_SCENARIO.title);
  const [organization, setOrganization] = useState<OrganizationCard>(
    DEFAULT_DEMO_SCENARIO.organization
  );
  const [openingBalances, setOpeningBalances] = useState<OpeningBalanceEntry[]>(
    DEFAULT_DEMO_SCENARIO.openingBalances
  );
  const [rawOperations, setRawOperations] = useState<BusinessOperation[]>(
    DEFAULT_DEMO_SCENARIO.operations
  );
  const [closingOperationStatuses, setClosingOperationStatuses] = useState<
    Record<string, OperationStatus>
  >({});
  const [includeAutoClosing, setIncludeAutoClosing] = useState<boolean>(false);
  const [baseDirectories, setBaseDirectories] = useState<ExtractedDirectories1C>(
    DEFAULT_DEMO_SCENARIO.directories
  );
  const [createdDirectoryMap, setCreatedDirectoryMap] = useState<Record<string, boolean>>({});
  const [activeOperationId, setActiveOperationId] = useState<string>(
    DEFAULT_DEMO_SCENARIO.operations[0]?.id ?? ''
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('navigator');
  const [osvMode, setOsvMode] = useState<'completed_only' | 'all_operations'>('all_operations');
  const [userOsvInputs, setUserOsvInputs] = useState<Record<string, UserOsvInputRow>>({});
  const [synced1C, setSynced1C] = useState<Synced1CSnapshot | null>(null);
  const [isSyncing1C, setIsSyncing1C] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([INITIAL_WELCOME_MESSAGE]);
  const [aiConfig, setAiConfig] = useState<AiProviderConfig>(DEFAULT_AI_CONFIG);
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [uploadedImageDataUrl, setUploadedImageState] = useState<string | null>(null);

  const hasLoadedStorageRef = useRef(false);
  const syncedRevisionRef = useRef<string | null>(null);
  const hasDoneInitialServerSyncRef = useRef(false);

  // Hydrate from localStorage + IndexedDB on mount
  useEffect(() => {
    const saved = loadPersistedState();
    if (saved) {
      setActivePresetId(saved.activePresetId || DEFAULT_DEMO_SCENARIO.id);
      setTaskTitle(saved.taskTitle || DEFAULT_DEMO_SCENARIO.title);
      setOrganization(saved.organization);
      setOpeningBalances(saved.openingBalances);
      setRawOperations(saved.rawOperations);
      setClosingOperationStatuses(saved.closingOperationStatuses || {});
      setIncludeAutoClosing(
        typeof saved.includeAutoClosing === 'boolean' ? saved.includeAutoClosing : false
      );
      setBaseDirectories(saved.baseDirectories || DEFAULT_DEMO_SCENARIO.directories);

      const map: Record<string, boolean> = {};
      for (const c of saved.baseDirectories?.counterparties ?? []) {
        if (c.createdIn1C) map[c.id] = true;
      }
      for (const n of saved.baseDirectories?.nomenclature ?? []) {
        if (n.createdIn1C) map[n.id] = true;
      }
      for (const e of saved.baseDirectories?.employees ?? []) {
        if (e.createdIn1C) map[e.id] = true;
      }
      setCreatedDirectoryMap(map);

      setActiveOperationId(saved.activeOperationId || saved.rawOperations[0]?.id || '');
      setActiveTab(saved.activeTab || 'navigator');
      setOsvMode(saved.osvMode || 'all_operations');
      setUserOsvInputs(saved.userOsvInputs || {});
      if (saved.synced1C) {
        setSynced1C(saved.synced1C);
        syncedRevisionRef.current = saved.synced1C.revision;
      }
      if (Array.isArray(saved.chatMessages) && saved.chatMessages.length > 0) {
        setChatMessages(saved.chatMessages);
      }
      if (saved.aiConfig) {
        setAiConfig(saved.aiConfig);
      }
      if (saved.theme === 'dark' || saved.theme === 'light') {
        setThemeState(saved.theme);
      }
      setLastSavedAt(saved.savedAt || null);
    }

    loadUploadedImageFromIdb().then((img) => {
      if (img) setUploadedImageState(img);
    });

    hasLoadedStorageRef.current = true;
    setIsHydrated(true);
  }, []);

  // Apply light/dark class on <html>
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Apply an incoming Synced1CSnapshot: IMMEDIATELY replaces organization, openingBalances, userOsvInputs, and directories!
  const applySyncedSnapshot = useCallback((snapshot: Synced1CSnapshot) => {
    syncedRevisionRef.current = snapshot.revision;
    setSynced1C(snapshot);

    // 1. IMMEDIATELY replace `organization` with real 1C organization + registers1C responsiblePersons/accountingPolicy
    const org1C = snapshot.organization;
    const resp1C = snapshot.registers1C?.responsiblePersons;
    const policy1C = snapshot.registers1C?.accountingPolicy;
    if (org1C || resp1C || policy1C) {
      setOrganization((prev) => {
        const incomingName = (org1C?.name || org1C?.shortName || '').trim();
        const incomingShort = (org1C?.shortName || org1C?.name || '').trim();
        const incomingInn = (org1C?.inn ?? '').trim();

        const isRealDifferentCompany =
          (incomingName.length > 0 &&
            normalizeEntityKey(incomingName) !==
              normalizeEntityKey(DEFAULT_DEMO_SCENARIO.organization.name) &&
            normalizeEntityKey(incomingName) !==
              normalizeEntityKey(DEFAULT_DEMO_SCENARIO.organization.shortName)) ||
          (incomingInn.length > 0 && incomingInn !== DEFAULT_DEMO_SCENARIO.organization.inn);

        const pickField = (val1C: string | undefined, fallbackPrev: string): string => {
          if (val1C !== undefined && val1C.trim() !== '') return val1C.trim();
          if (isRealDifferentCompany && val1C !== undefined) return val1C.trim();
          return fallbackPrev;
        };

        const resolvedDirector =
          (org1C?.directorName && org1C.directorName.trim()) ||
          (resp1C?.directorName && resp1C.directorName.trim()) ||
          (isRealDifferentCompany ? '' : prev.directorName);

        const resolvedAccountant =
          (org1C?.chiefAccountantName && org1C.chiefAccountantName.trim()) ||
          (resp1C?.chiefAccountantName && resp1C.chiefAccountantName.trim()) ||
          (isRealDifferentCompany ? '' : prev.chiefAccountantName);

        let resolvedTaxSystem = prev.taxSystem;
        if (org1C?.taxSystem) {
          resolvedTaxSystem = org1C.taxSystem;
        } else if (policy1C?.taxSystem) {
          const ts = policy1C.taxSystem.toUpperCase();
          if (ts.includes('15')) resolvedTaxSystem = 'USN_15';
          else if (ts.includes('6') || ts.includes('УСН')) resolvedTaxSystem = 'USN_6';
          else if (ts.includes('ОСН') || ts.includes('ОБЩ')) resolvedTaxSystem = 'OSNO';
        }

        const resolvedCosting =
          typeof policy1C?.directCosting === 'boolean'
            ? policy1C.directCosting
              ? 'direct-costing'
              : 'full-absorption'
            : org1C?.costingMethod || prev.costingMethod;

        return {
          ...prev,
          name: incomingName || prev.name,
          shortName: incomingShort || prev.shortName,
          inn: pickField(org1C?.inn, prev.inn),
          kpp: pickField(org1C?.kpp, prev.kpp),
          ogrn: pickField(org1C?.ogrn, prev.ogrn ?? ''),
          bankAccount: pickField(org1C?.bankAccount, prev.bankAccount),
          bankName: pickField(org1C?.bankName, prev.bankName),
          bik: pickField(org1C?.bik, prev.bik),
          corrAccount: pickField(org1C?.corrAccount, prev.corrAccount),
          address: pickField(org1C?.address, prev.address ?? ''),
          directorName: resolvedDirector,
          chiefAccountantName: resolvedAccountant,
          taxSystem: resolvedTaxSystem,
          costingMethod: resolvedCosting,
          substituteStudentInOrgName: incomingName ? false : prev.substituteStudentInOrgName,
          substituteStudentAsAccountant:
            resolvedAccountant && isRealDifferentCompany
              ? false
              : prev.substituteStudentAsAccountant,
        };
      });
    }

    // 2. IMMEDIATELY replace `openingBalances` from 1C `Остатки` (31.03.2026) so empty Q2 sums resolve automatically
    if (Array.isArray(snapshot.openingBalances) && snapshot.openingBalances.length > 0) {
      setOpeningBalances(
        snapshot.openingBalances.map((row, idx) => ({
          ...row,
          id: row.id || `ob-sync-${idx}`,
          accountCode: row.accountCode.trim(),
          debit: roundMoney(Number(row.debit) || 0),
          credit: roundMoney(Number(row.credit) || 0),
        }))
      );
    }

    // 3. Replace `userOsvInputs` cleanly from `snapshot.endBalances`
    if (snapshot.endBalances && Object.keys(snapshot.endBalances).length > 0) {
      const nextOsv: Record<string, UserOsvInputRow> = {};
      for (const [accountCode, bal] of Object.entries(snapshot.endBalances)) {
        const code = accountCode.trim();
        nextOsv[code] = {
          accountCode: code,
          endDebit: roundMoney(Number(bal.debit) || 0),
          endCredit: roundMoney(Number(bal.credit) || 0),
        };
      }
      setUserOsvInputs(nextOsv);
    }

    // 4. Merge 1C employees & counterparties into directories where applicable (keeping non-empty reference fields intact)
    const syncEmployees = snapshot.directories1C?.employees ?? [];
    const syncCounterparties =
      snapshot.directories1C?.counterparties?.length
        ? snapshot.directories1C.counterparties
        : (snapshot.counterparties ?? []);

    if (syncEmployees.length > 0 || syncCounterparties.length > 0) {
      setBaseDirectories((prev) => {
        const mergedCounterparties = [...prev.counterparties];
        for (const cp of syncCounterparties) {
          if (!cp.name?.trim()) continue;
          const cleanInn = (cp.inn || '').replace(/\D/g, '');
          const norm = normalizeEntityKey(cp.name);
          const idx = mergedCounterparties.findIndex((ex) => {
            const exInn = (ex.inn || '').replace(/\D/g, '');
            if (cleanInn.length >= 10 && exInn === cleanInn) return true;
            return norm.length > 0 && normalizeEntityKey(ex.name) === norm;
          });
          const firstContract = cp.contracts?.[0];
          const mappedKind: CounterpartyCard1C['contractKind'] =
            firstContract?.kind?.toLowerCase().includes('покупател')
              ? 'С покупателем'
              : firstContract?.kind?.toLowerCase().includes('проч')
                ? 'Прочее'
                : 'С поставщиком';

          if (idx >= 0) {
            const cur = mergedCounterparties[idx];
            mergedCounterparties[idx] = {
              ...cur,
              fullName: cp.fullName?.trim() || cur.fullName,
              inn: cleanInn.length >= 10 ? cp.inn!.trim() : cur.inn,
              kpp: cp.kpp?.trim() || cur.kpp,
              bankAccount: cp.bankAccount?.trim() || cur.bankAccount,
              bik: cp.bik?.trim() || cur.bik,
              bankName: cp.bankName?.trim() || cur.bankName,
              contractNumber: firstContract?.number?.trim() || cur.contractNumber,
              contractDate: firstContract?.date?.trim() || cur.contractDate,
              createdIn1C: true,
            };
          } else {
            mergedCounterparties.push({
              id: `cp-sync-${mergedCounterparties.length + 1}`,
              name: cp.name.trim(),
              fullName: cp.fullName?.trim() || cp.name.trim(),
              inn: cp.inn?.trim() || '',
              kpp: cp.kpp?.trim() || '',
              bankAccount: cp.bankAccount?.trim() || '',
              bankName: cp.bankName?.trim() || '',
              bik: cp.bik?.trim() || '',
              contractKind: mappedKind,
              contractNumber: firstContract?.number?.trim() || '',
              contractDate: firstContract?.date?.trim() || '',
              createdIn1C: true,
            });
          }
        }

        const mergedEmployees = [...prev.employees];
        for (const emp of syncEmployees) {
          if (!emp.fullName?.trim()) continue;
          const norm = normalizeEntityKey(emp.fullName);
          const idx = mergedEmployees.findIndex(
            (ex) => normalizeEntityKey(ex.fullName) === norm
          );
          if (idx >= 0) {
            mergedEmployees[idx] = {
              ...mergedEmployees[idx],
              position: emp.position || mergedEmployees[idx].position,
              department: emp.department || mergedEmployees[idx].department,
              salary: emp.salary && emp.salary > 0 ? emp.salary : mergedEmployees[idx].salary,
              hireDate: emp.hireDate || mergedEmployees[idx].hireDate,
              createdIn1C: true,
            };
          } else {
            mergedEmployees.push({
              id: emp.id || `emp-1c-${mergedEmployees.length + 1}`,
              fullName: emp.fullName.trim(),
              position: emp.position || 'Сотрудник',
              department: emp.department || 'Основное подразделение',
              salary: emp.salary ?? 0,
              hireDate: emp.hireDate || '2026-04-01',
              costAccount: '26',
              createdIn1C: true,
            });
          }
        }
        return {
          ...prev,
          counterparties: mergedCounterparties,
          employees: mergedEmployees,
        };
      });
    }
  }, []);

  // Manual refresh from GET /api/1c-sync (unconditionally applies when hasData is true!)
  const refreshFrom1CSync = useCallback(async (): Promise<boolean> => {
    setIsSyncing1C(true);
    try {
      const res = await fetch('/api/1c-sync', {
        method: 'GET',
        cache: 'no-store',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        status?: string;
        hasData?: boolean;
        snapshot?: Synced1CSnapshot | null;
      };
      if (data?.status === 'ok' && data.hasData && data.snapshot) {
        applySyncedSnapshot(data.snapshot);
        hasDoneInitialServerSyncRef.current = true;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setIsSyncing1C(false);
    }
  }, [applySyncedSnapshot]);

  // 1-click simulation of a realistic 1C April snapshot containing all student error types
  const simulate1CSyncWithSampleErrors = useCallback(async (): Promise<void> => {
    setIsSyncing1C(true);
    try {
      const res = await fetch('/api/1c-sync?demo=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        status?: string;
        snapshot?: Synced1CSnapshot;
      };
      if (data?.snapshot) {
        applySyncedSnapshot(data.snapshot);
        hasDoneInitialServerSyncRef.current = true;
      }
    } catch {
      // ignore network error in offline/SSR context
    } finally {
      setIsSyncing1C(false);
    }
  }, [applySyncedSnapshot]);

  // Clear active 1C sync snapshot
  const clear1CSyncSnapshot = useCallback(async (): Promise<void> => {
    setIsSyncing1C(true);
    try {
      await fetch('/api/1c-sync?clear=1', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      syncedRevisionRef.current = null;
      setSynced1C(null);
      setUserOsvInputs({});
      setIsSyncing1C(false);
    }
  }, []);

  // Initial mount unconditional sync + background polling of GET /api/1c-sync every 3000ms
  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;

    let cancelled = false;

    const pollOnce = async (forceApply: boolean) => {
      if (cancelled) return;
      if (
        !forceApply &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      try {
        const res = await fetch('/api/1c-sync', {
          method: 'GET',
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          status?: string;
          hasData?: boolean;
          snapshot?: Synced1CSnapshot | null;
        };
        if (cancelled) return;
        if (data?.status === 'ok' && data.hasData && data.snapshot) {
          if (
            forceApply ||
            !hasDoneInitialServerSyncRef.current ||
            data.snapshot.revision !== syncedRevisionRef.current
          ) {
            hasDoneInitialServerSyncRef.current = true;
            applySyncedSnapshot(data.snapshot);
          }
        }
      } catch {
        // silent background poll
      }
    };

    // Unconditional check & apply on mount so stale localStorage demo org never overrides live 1C!
    void pollOnce(true);

    const timer = window.setInterval(() => {
      void pollOnce(false);
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isHydrated, applySyncedSnapshot]);

  // Effective organization with student name substitution applied
  const effectiveOrganization = useMemo<OrganizationCard>(() => {
    const student = organization.studentName.trim();
    if (!student) return organization;

    return {
      ...organization,
      name: organization.substituteStudentInOrgName
        ? `${organization.name} (${student})`
        : organization.name,
      shortName: organization.substituteStudentInOrgName
        ? `${organization.shortName} (${student})`
        : organization.shortName,
      chiefAccountantName: organization.substituteStudentAsAccountant
        ? student
        : organization.chiefAccountantName,
    };
  }, [organization]);

  // Extracted + merged 1C directories with createdIn1C status and student name substitution applied
  const directories = useMemo<ExtractedDirectories1C>(() => {
    const extracted = extractDirectoriesFromTask(rawOperations, openingBalances, baseDirectories);
    const student = organization.studentName.trim();
    return {
      ...extracted,
      counterparties: extracted.counterparties.map((item) => ({
        ...item,
        createdIn1C: createdDirectoryMap[item.id] ?? item.createdIn1C ?? false,
      })),
      nomenclature: extracted.nomenclature.map((item) => ({
        ...item,
        createdIn1C: createdDirectoryMap[item.id] ?? item.createdIn1C ?? false,
      })),
      employees: extracted.employees.map((item) => {
        const isStudentSlot =
          item.id === 'emp-student-accountant' || /фио\s+студента/i.test(item.fullName);
        const resolvedName =
          isStudentSlot && organization.substituteStudentAsAccountant && student
            ? student
            : item.fullName;
        return {
          ...item,
          fullName: resolvedName,
          createdIn1C: createdDirectoryMap[item.id] ?? item.createdIn1C ?? false,
        };
      }),
    };
  }, [rawOperations, openingBalances, baseDirectories, createdDirectoryMap, organization]);

  // Requisite Completeness Control («Реквизит-контроль»)
  const requisiteReport = useMemo<RequisiteCheckReport>(() => {
    return checkRequisitesCompleteness(effectiveOrganization, directories, synced1C);
  }, [effectiveOrganization, directories, synced1C]);

  // Smart-linked main operations + optional Month-End Closing operations + Per-Operation 1C Matcher
  const resolvedMainOperations = useMemo<BusinessOperation[]>(() => {
    return resolveOperationsWithSmartLinks(rawOperations, openingBalances, effectiveOrganization);
  }, [rawOperations, openingBalances, effectiveOrganization]);

  const closingOperations = useMemo<BusinessOperation[]>(() => {
    if (!includeAutoClosing) return [];
    return generateMonthEndClosingOperations(
      resolvedMainOperations,
      openingBalances,
      directories,
      effectiveOrganization,
      closingOperationStatuses
    );
  }, [
    includeAutoClosing,
    resolvedMainOperations,
    openingBalances,
    directories,
    effectiveOrganization,
    closingOperationStatuses,
  ]);

  const operations = useMemo<BusinessOperation[]>(() => {
    const combined = [...resolvedMainOperations, ...closingOperations];
    return enrichOperationsWith1CMatch(combined, synced1C, requisiteReport);
  }, [resolvedMainOperations, closingOperations, synced1C, requisiteReport]);

  const activeOperation = useMemo<BusinessOperation | null>(() => {
    if (operations.length === 0) return null;
    return operations.find((op) => op.id === activeOperationId) ?? operations[0];
  }, [operations, activeOperationId]);

  // Live OSV & Reference OSV & Reconciliation
  const osvReport = useMemo<OsvReport>(() => {
    return calculateOsv(openingBalances, operations, osvMode);
  }, [openingBalances, operations, osvMode]);

  const referenceOsvReport = useMemo<OsvReport>(() => {
    return calculateOsv(openingBalances, operations, 'all_operations');
  }, [openingBalances, operations]);

  const reconciliation = useMemo<OsvReconciliationResult>(() => {
    return reconcileUserOsv(referenceOsvReport, userOsvInputs, operations);
  }, [referenceOsvReport, userOsvInputs, operations]);

  // Full 6-Category 1C Error Auditor
  const auditReport = useMemo<Full1CAuditReport>(() => {
    return runFull1CAudit(
      operations,
      referenceOsvReport,
      effectiveOrganization,
      directories,
      synced1C,
      userOsvInputs
    );
  }, [
    operations,
    referenceOsvReport,
    effectiveOrganization,
    directories,
    synced1C,
    userOsvInputs,
  ]);

  // Auto-save to localStorage whenever state changes
  useEffect(() => {
    if (!hasLoadedStorageRef.current) return;

    const savedAt = new Date().toISOString();
    const persistedDirectories: ExtractedDirectories1C = {
      ...baseDirectories,
      counterparties: directories.counterparties,
      nomenclature: directories.nomenclature,
      employees: directories.employees,
    };

    const payload: PersistedAccountantState = {
      version: 3,
      activePresetId,
      taskTitle,
      organization,
      openingBalances,
      rawOperations,
      closingOperationStatuses,
      includeAutoClosing,
      baseDirectories: persistedDirectories,
      activeOperationId,
      activeTab,
      osvMode,
      userOsvInputs,
      synced1C,
      chatMessages,
      aiConfig,
      theme,
      savedAt,
    };

    if (savePersistedState(payload)) {
      setLastSavedAt(savedAt);
    }
  }, [
    activePresetId,
    taskTitle,
    organization,
    openingBalances,
    rawOperations,
    closingOperationStatuses,
    includeAutoClosing,
    baseDirectories,
    directories,
    activeOperationId,
    activeTab,
    osvMode,
    userOsvInputs,
    synced1C,
    chatMessages,
    aiConfig,
    theme,
  ]);

  // Actions
  const updateOrganization = useCallback((patch: Partial<OrganizationCard>) => {
    setOrganization((prev) => ({ ...prev, ...patch }));
  }, []);

  const addOpeningBalance = useCallback(
    (entry: Omit<OpeningBalanceEntry, 'id'> & { id?: string }) => {
      const id = entry.id || `ob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setOpeningBalances((prev) => [...prev, { ...entry, id }]);
    },
    []
  );

  const updateOpeningBalance = useCallback((id: string, patch: Partial<OpeningBalanceEntry>) => {
    setOpeningBalances((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }, []);

  const removeOpeningBalance = useCallback((id: string) => {
    setOpeningBalances((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const clearOpeningBalances = useCallback(() => {
    setOpeningBalances([]);
  }, []);

  const balanceOpeningDifferenceTo84 = useCallback(() => {
    setOpeningBalances((prev) => {
      const totalDebit = roundMoney(prev.reduce((acc, r) => acc + (Number(r.debit) || 0), 0));
      const totalCredit = roundMoney(prev.reduce((acc, r) => acc + (Number(r.credit) || 0), 0));
      const diff = roundMoney(totalDebit - totalCredit);
      if (Math.abs(diff) < 0.01) return prev;

      const idx84 = prev.findIndex((r) => r.accountCode === '84.01');
      if (idx84 >= 0) {
        const current = prev[idx84];
        const currentNetCredit = roundMoney((current.credit || 0) - (current.debit || 0) + diff);
        const updated: OpeningBalanceEntry =
          currentNetCredit >= 0
            ? { ...current, debit: 0, credit: currentNetCredit }
            : { ...current, debit: Math.abs(currentNetCredit), credit: 0 };
        const copy = [...prev];
        copy[idx84] = updated;
        return copy;
      }

      return [
        ...prev,
        {
          id: `ob-84-auto-${Date.now()}`,
          accountCode: '84.01',
          subconto1: 'Нераспределенная прибыль (автобалансировка)',
          debit: diff < 0 ? Math.abs(diff) : 0,
          credit: diff > 0 ? diff : 0,
          comment: 'Автоматическое выравнивание валюты начального баланса',
        },
      ];
    });
  }, []);

  const applyImported1CData = useCallback((payload: ApplyImported1CPayload) => {
    if (payload.organizationPatch) {
      const cleanPatch: Partial<OrganizationCard> = {};
      for (const [key, val] of Object.entries(payload.organizationPatch)) {
        if (val !== undefined && val !== '') {
          (cleanPatch as Record<string, unknown>)[key] = val;
        }
      }
      if (cleanPatch.name || cleanPatch.shortName) {
        cleanPatch.substituteStudentInOrgName = false;
      }
      if (Object.keys(cleanPatch).length > 0) {
        setOrganization((prev) => ({ ...prev, ...cleanPatch }));
      }
    }

    let normalizedIncoming: OpeningBalanceEntry[] | undefined;
    if (payload.openingBalances && payload.openingBalances.length > 0) {
      normalizedIncoming = payload.openingBalances.map((row, idx) => ({
        ...row,
        id: row.id || `ob-1c-${Date.now()}-${idx}`,
        accountCode: row.accountCode.trim(),
        debit: roundMoney(Number(row.debit) || 0),
        credit: roundMoney(Number(row.credit) || 0),
      }));

      if (payload.mergeMode === 'merge') {
        const incList = normalizedIncoming;
        setOpeningBalances((prev) => {
          const incomingAccountsWithSubconto = new Set(
            incList.filter((r) => Boolean(r.subconto1 || r.subconto2)).map((r) => r.accountCode)
          );
          const incomingSingleAccounts = new Set(
            incList.filter((r) => !r.subconto1 && !r.subconto2).map((r) => r.accountCode)
          );

          const result: OpeningBalanceEntry[] = prev.filter((existing) => {
            if (
              incomingSingleAccounts.has(existing.accountCode) &&
              !existing.subconto1 &&
              !existing.subconto2
            ) {
              return false;
            }
            if (
              incomingAccountsWithSubconto.has(existing.accountCode) &&
              !existing.subconto1 &&
              !existing.subconto2
            ) {
              return false;
            }
            return true;
          });

          for (const inc of incList) {
            const matchIdx = result.findIndex(
              (r) =>
                r.accountCode === inc.accountCode &&
                normalizeEntityKey(r.subconto1) === normalizeEntityKey(inc.subconto1) &&
                normalizeEntityKey(r.subconto2) === normalizeEntityKey(inc.subconto2)
            );
            if (matchIdx >= 0) {
              result[matchIdx] = { ...result[matchIdx], ...inc, id: result[matchIdx].id };
            } else {
              result.push(inc);
            }
          }
          return result;
        });
      } else {
        setOpeningBalances(normalizedIncoming);
      }
    }

    if (
      (payload.counterparties && payload.counterparties.length > 0) ||
      (payload.employees && payload.employees.length > 0)
    ) {
      setBaseDirectories((prev) => {
        const mergedCounterparties = [...prev.counterparties];
        for (const incCp of payload.counterparties ?? []) {
          const cleanInn = (incCp.inn || '').replace(/\D/g, '');
          const normName = normalizeEntityKey(incCp.name);
          const idx = mergedCounterparties.findIndex((existing) => {
            const exInn = (existing.inn || '').replace(/\D/g, '');
            if (cleanInn.length >= 10 && exInn === cleanInn) return true;
            return normName.length > 0 && normalizeEntityKey(existing.name) === normName;
          });

          if (idx >= 0) {
            const cur = mergedCounterparties[idx];
            mergedCounterparties[idx] = {
              ...cur,
              name: incCp.name || cur.name,
              fullName: incCp.fullName || cur.fullName,
              inn: cleanInn.length >= 10 ? incCp.inn : cur.inn,
              kpp: incCp.kpp || cur.kpp,
              bankAccount: incCp.bankAccount || cur.bankAccount,
              bankName: incCp.bankName || cur.bankName,
              bik: incCp.bik || cur.bik,
              contractKind: incCp.contractKind || cur.contractKind,
              contractNumber: incCp.contractNumber || cur.contractNumber,
              contractDate: incCp.contractDate || cur.contractDate,
            };
          } else {
            mergedCounterparties.push({
              ...incCp,
              id: incCp.id || `cp-1c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            });
          }
        }

        const mergedEmployees = [...prev.employees];
        for (const incEmp of payload.employees ?? []) {
          const normEmpName = normalizeEntityKey(incEmp.fullName);
          const idx = mergedEmployees.findIndex(
            (existing) =>
              normEmpName.length > 0 && normalizeEntityKey(existing.fullName) === normEmpName
          );
          if (idx >= 0) {
            const cur = mergedEmployees[idx];
            mergedEmployees[idx] = {
              ...cur,
              position: incEmp.position || cur.position,
              department: incEmp.department || cur.department,
              salary: incEmp.salary > 0 ? incEmp.salary : cur.salary,
              hireDate: incEmp.hireDate || cur.hireDate,
              costAccount: incEmp.costAccount || cur.costAccount,
              nomenclatureGroup: incEmp.nomenclatureGroup || cur.nomenclatureGroup,
            };
          } else {
            mergedEmployees.push({
              ...incEmp,
              id: incEmp.id || `emp-1c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            });
          }
        }

        return {
          ...prev,
          counterparties: mergedCounterparties,
          employees: mergedEmployees,
        };
      });
    }

    if (payload.synced1CPatch) {
      const rev = payload.synced1CPatch.revision || `upload-${Date.now()}`;
      syncedRevisionRef.current = rev;
      setSynced1C((prev) => {
        const mappedCps =
          payload.synced1CPatch?.counterparties ??
          (payload.counterparties
            ? payload.counterparties.map((cp) => ({
                name: cp.name,
                fullName: cp.fullName,
                inn: cp.inn,
                kpp: cp.kpp,
                bankAccount: cp.bankAccount,
                bik: cp.bik,
                bankName: cp.bankName,
                contracts: cp.contractNumber
                  ? [{ number: cp.contractNumber, date: cp.contractDate, kind: cp.contractKind }]
                  : [],
              }))
            : (prev?.counterparties ?? []));

        return {
          revision: rev,
          syncedAt: payload.synced1CPatch?.syncedAt || new Date().toISOString(),
          source: payload.synced1CPatch?.source || 'file-upload',
          isNormalizedSnapshot: true,
          organization:
            payload.synced1CPatch?.organization ?? payload.organizationPatch ?? prev?.organization,
          counterparties: mappedCps,
          openingBalances:
            payload.synced1CPatch?.openingBalances ??
            normalizedIncoming ??
            prev?.openingBalances ??
            [],
          endBalances: payload.synced1CPatch?.endBalances ?? prev?.endBalances,
          aprilPostings: payload.synced1CPatch?.aprilPostings ?? prev?.aprilPostings ?? [],
          hasMonthEndClosing:
            payload.synced1CPatch?.hasMonthEndClosing ?? prev?.hasMonthEndClosing,
          allDocuments: payload.synced1CPatch?.allDocuments ?? prev?.allDocuments ?? [],
          directories1C: payload.synced1CPatch?.directories1C ?? {
            counterparties: mappedCps,
            nomenclature: prev?.directories1C?.nomenclature ?? [],
            employees: prev?.directories1C?.employees ?? [],
          },
          registers1C: payload.synced1CPatch?.registers1C ?? prev?.registers1C ?? {},
        };
      });
    }
  }, []);

  const selectOperationAndNavigate = useCallback((id: string) => {
    setActiveOperationId(id);
    setActiveTab('navigator');
  }, []);

  const setOperationStatus = useCallback((id: string, status: OperationStatus) => {
    setRawOperations((prev) => {
      const existsInRaw = prev.some((op) => op.id === id);
      if (!existsInRaw) return prev;
      return prev.map((op) => (op.id === id ? { ...op, status } : op));
    });
    setClosingOperationStatuses((prev) => ({
      ...prev,
      [id]: status,
    }));
  }, []);

  const toggleOperationDone = useCallback(
    (id: string) => {
      const target = operations.find((op) => op.id === id);
      if (!target) return;
      if (target.status === 'needs_data') return;
      const nextStatus: OperationStatus = target.status === 'done' ? 'pending' : 'done';
      setOperationStatus(id, nextStatus);
    },
    [operations, setOperationStatus]
  );

  const markAllOperationsDone = useCallback(() => {
    setRawOperations((prev) =>
      prev.map((op) => (op.status === 'needs_data' ? op : { ...op, status: 'done' }))
    );
    setClosingOperationStatuses((prev) => {
      const next = { ...prev };
      for (const cop of closingOperations) {
        next[cop.id] = 'done';
      }
      return next;
    });
  }, [closingOperations]);

  const resetAllOperationsStatus = useCallback(() => {
    setRawOperations((prev) =>
      prev.map((op) => (op.status === 'needs_data' ? op : { ...op, status: 'pending' }))
    );
    setClosingOperationStatuses({});
  }, []);

  const updateOperation = useCallback((id: string, patch: Partial<BusinessOperation>) => {
    setRawOperations((prev) => prev.map((op) => (op.id === id ? { ...op, ...patch } : op)));
  }, []);

  const toggleDirectoryItemCreated = useCallback((idOrCategory: string, maybeId?: string) => {
    const targetId = maybeId ?? idOrCategory;
    setCreatedDirectoryMap((prev) => ({
      ...prev,
      [targetId]: !prev[targetId],
    }));
  }, []);

  const addCounterparty = useCallback(
    (item: Omit<CounterpartyCard1C, 'id'> & { id?: string }) => {
      const id = item.id || `cp-custom-${Date.now()}`;
      setBaseDirectories((prev) => ({
        ...prev,
        counterparties: [...prev.counterparties, { ...item, id }],
      }));
    },
    []
  );

  const addNomenclature = useCallback(
    (item: Omit<NomenclatureCard1C, 'id'> & { id?: string }) => {
      const id = item.id || `nom-custom-${Date.now()}`;
      setBaseDirectories((prev) => ({
        ...prev,
        nomenclature: [...prev.nomenclature, { ...item, id }],
      }));
    },
    []
  );

  const addEmployee = useCallback((item: Omit<EmployeeCard1C, 'id'> & { id?: string }) => {
    const id = item.id || `emp-custom-${Date.now()}`;
    setBaseDirectories((prev) => ({
      ...prev,
      employees: [...prev.employees, { ...item, id }],
    }));
  }, []);

  const updateUserOsvInput = useCallback(
    (accountCode: string, patch: Partial<UserOsvInputRow>) => {
      setUserOsvInputs((prev) => {
        const existing = prev[accountCode] ?? { accountCode };
        return {
          ...prev,
          [accountCode]: {
            ...existing,
            ...patch,
            accountCode,
          },
        };
      });
    },
    []
  );

  const clearUserOsvInputs = useCallback(() => {
    setUserOsvInputs({});
  }, []);

  const fillUserOsvFromReference = useCallback(() => {
    const next: Record<string, UserOsvInputRow> = {};
    for (const row of referenceOsvReport.rows) {
      if (row.isGroup) continue;
      next[row.accountCode] = {
        accountCode: row.accountCode,
        turnoverDebit: row.turnoverDebit,
        turnoverCredit: row.turnoverCredit,
        endDebit: row.endDebit,
        endCredit: row.endCredit,
      };
    }
    setUserOsvInputs(next);
  }, [referenceOsvReport]);

  const simulateTypicalAdvanceErrorInOsv = useCallback(() => {
    const advanceAmount = 1236900;
    const next: Record<string, UserOsvInputRow> = {};
    for (const row of referenceOsvReport.rows) {
      if (row.isGroup) continue;
      next[row.accountCode] = {
        accountCode: row.accountCode,
        turnoverDebit: row.turnoverDebit,
        turnoverCredit: row.turnoverCredit,
        endDebit: row.endDebit,
        endCredit: row.endCredit,
      };
    }

    const ref6001 = next['60.01'] ?? {
      accountCode: '60.01',
      turnoverDebit: 0,
      turnoverCredit: 0,
      endDebit: 0,
      endCredit: 0,
    };
    const ref6002 = next['60.02'] ?? {
      accountCode: '60.02',
      turnoverDebit: 0,
      turnoverCredit: 0,
      endDebit: 0,
      endCredit: 0,
    };

    next['60.01'] = {
      ...ref6001,
      turnoverDebit: roundMoney(Math.max(0, (ref6001.turnoverDebit ?? 0) - advanceAmount)),
      endCredit: roundMoney((ref6001.endCredit ?? 0) + advanceAmount),
    };
    next['60.02'] = {
      ...ref6002,
      turnoverCredit: roundMoney(Math.max(0, (ref6002.turnoverCredit ?? 0) - advanceAmount)),
      endDebit: roundMoney((ref6002.endDebit ?? 0) + advanceAmount),
    };

    setUserOsvInputs(next);
  }, [referenceOsvReport]);

  const setUploadedImageDataUrl = useCallback((dataUrl: string | null) => {
    setUploadedImageState(dataUrl);
    void saveUploadedImageToIdb(dataUrl);
  }, []);

  const loadDemoScenario = useCallback((presetId: string) => {
    const preset =
      DEMO_SCENARIOS.find((p) => p.id === presetId) ?? DEFAULT_DEMO_SCENARIO;
    setActivePresetId(preset.id);
    setTaskTitle(preset.title);
    setOrganization(preset.organization);
    setOpeningBalances(preset.openingBalances);
    setRawOperations(preset.operations);
    setClosingOperationStatuses({});
    setIncludeAutoClosing(false);
    setBaseDirectories(preset.directories);
    setCreatedDirectoryMap({});
    setActiveOperationId(preset.operations[0]?.id ?? '');
    setUserOsvInputs({});
    syncedRevisionRef.current = null;
    setSynced1C(null);
    setUploadedImageState(null);
    void saveUploadedImageToIdb(null);
  }, []);

  const resetToDefaultDemo = useCallback(() => {
    clearPersistedState();
    loadDemoScenario(DEFAULT_DEMO_SCENARIO.id);
    setChatMessages([INITIAL_WELCOME_MESSAGE]);
    void fetch('/api/1c-sync?clear=1', { method: 'POST' }).catch(() => undefined);
  }, [loadDemoScenario]);

  const importParsedTask = useCallback(
    (payload: ImportTaskPayload) => {
      setActivePresetId('custom-imported-task');
      if (payload.title) {
        setTaskTitle(payload.title);
      }
      if (payload.organizationPatch) {
        setOrganization((prev) => ({ ...prev, ...payload.organizationPatch }));
      }
      if (payload.openingBalances) {
        setOpeningBalances(payload.openingBalances);
      }
      setRawOperations(payload.operations);
      setClosingOperationStatuses({});
      setIncludeAutoClosing(false);
      setBaseDirectories({
        counterparties: payload.directories?.counterparties ?? [],
        nomenclature: payload.directories?.nomenclature ?? [],
        nomenclatureGroups: payload.directories?.nomenclatureGroups ?? [],
        expenseItems: payload.directories?.expenseItems ?? [],
        cashFlowItems: payload.directories?.cashFlowItems ?? [],
        employees: payload.directories?.employees ?? [],
      });
      setCreatedDirectoryMap({});
      setActiveOperationId(payload.operations[0]?.id ?? '');
      setUserOsvInputs({});
      setActiveTab('navigator');
      if (payload.uploadedImageDataUrl !== undefined) {
        setUploadedImageDataUrl(payload.uploadedImageDataUrl);
      }
    },
    [setUploadedImageDataUrl]
  );

  const addChatMessage = useCallback(
    (msg: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => {
      const fullMsg: ChatMessage = {
        id: msg.id || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || new Date().toISOString(),
        relatedOperationNumber: msg.relatedOperationNumber,
      };
      setChatMessages((prev) => [...prev, fullMsg]);
    },
    []
  );

  const clearChatMessages = useCallback(() => {
    setChatMessages([INITIAL_WELCOME_MESSAGE]);
  }, []);

  const updateAiConfig = useCallback((patch: Partial<AiProviderConfig>) => {
    setAiConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const setTheme = useCallback((nextTheme: 'light' | 'dark') => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const saveSnapshotNow = useCallback(
    async (label?: string) => {
      const savedAt = new Date().toISOString();
      const snapshotState: PersistedAccountantState = {
        version: 3,
        activePresetId,
        taskTitle,
        organization,
        openingBalances,
        rawOperations,
        closingOperationStatuses,
        includeAutoClosing,
        baseDirectories: directories,
        activeOperationId,
        activeTab,
        osvMode,
        userOsvInputs,
        synced1C,
        chatMessages,
        aiConfig,
        theme,
        savedAt,
      };
      savePersistedState(snapshotState);
      setLastSavedAt(savedAt);
      await saveBackupSnapshotToIdb(
        `snap-${Date.now()}`,
        label || `${taskTitle} (${new Date().toLocaleTimeString('ru-RU')})`,
        snapshotState
      );
    },
    [
      activePresetId,
      taskTitle,
      organization,
      openingBalances,
      rawOperations,
      closingOperationStatuses,
      includeAutoClosing,
      directories,
      activeOperationId,
      activeTab,
      osvMode,
      userOsvInputs,
      synced1C,
      chatMessages,
      aiConfig,
      theme,
    ]
  );

  const value = useMemo<AccountantContextValue>(
    () => ({
      isHydrated,
      activePresetId,
      demoScenarios: DEMO_SCENARIOS,
      taskTitle,
      organization,
      effectiveOrganization,
      openingBalances,
      rawOperations,
      operations,
      includeAutoClosing,
      directories,
      activeOperationId,
      activeOperation,
      activeTab,
      osvMode,
      osvReport,
      referenceOsvReport,
      userOsvInputs,
      reconciliation,
      synced1C,
      isSyncing1C,
      requisiteReport,
      auditReport,
      chatMessages,
      aiConfig,
      theme,
      lastSavedAt,
      uploadedImageDataUrl,

      setTaskTitle,
      setOrganization,
      updateOrganization,
      setOpeningBalances,
      addOpeningBalance,
      updateOpeningBalance,
      removeOpeningBalance,
      clearOpeningBalances,
      balanceOpeningDifferenceTo84,
      applyImported1CData,

      refreshFrom1CSync,
      simulate1CSyncWithSampleErrors,
      clear1CSyncSnapshot,

      setRawOperations,
      setIncludeAutoClosing,
      setActiveOperationId,
      selectOperationAndNavigate,
      setOperationStatus,
      toggleOperationDone,
      markAllOperationsDone,
      resetAllOperationsStatus,
      updateOperation,
      setActiveTab,

      toggleDirectoryItemCreated,
      addCounterparty,
      addNomenclature,
      addEmployee,

      setOsvMode,
      setUserOsvInputs,
      updateUserOsvInput,
      clearUserOsvInputs,
      fillUserOsvFromReference,
      simulateTypicalAdvanceErrorInOsv,

      loadDemoScenario,
      resetToDefaultDemo,
      importParsedTask,
      setUploadedImageDataUrl,
      addChatMessage,
      setChatMessages,
      clearChatMessages,
      updateAiConfig,
      setTheme,
      toggleTheme,
      saveSnapshotNow,
    }),
    [
      isHydrated,
      activePresetId,
      taskTitle,
      organization,
      effectiveOrganization,
      openingBalances,
      rawOperations,
      operations,
      includeAutoClosing,
      directories,
      activeOperationId,
      activeOperation,
      activeTab,
      osvMode,
      osvReport,
      referenceOsvReport,
      userOsvInputs,
      reconciliation,
      synced1C,
      isSyncing1C,
      requisiteReport,
      auditReport,
      chatMessages,
      aiConfig,
      theme,
      lastSavedAt,
      uploadedImageDataUrl,
      updateOrganization,
      addOpeningBalance,
      updateOpeningBalance,
      removeOpeningBalance,
      clearOpeningBalances,
      balanceOpeningDifferenceTo84,
      applyImported1CData,
      refreshFrom1CSync,
      simulate1CSyncWithSampleErrors,
      clear1CSyncSnapshot,
      selectOperationAndNavigate,
      setOperationStatus,
      toggleOperationDone,
      markAllOperationsDone,
      resetAllOperationsStatus,
      updateOperation,
      toggleDirectoryItemCreated,
      addCounterparty,
      addNomenclature,
      addEmployee,
      updateUserOsvInput,
      clearUserOsvInputs,
      fillUserOsvFromReference,
      simulateTypicalAdvanceErrorInOsv,
      loadDemoScenario,
      resetToDefaultDemo,
      importParsedTask,
      setUploadedImageDataUrl,
      addChatMessage,
      clearChatMessages,
      updateAiConfig,
      setTheme,
      toggleTheme,
      saveSnapshotNow,
    ]
  );

  return <AccountantContext.Provider value={value}>{children}</AccountantContext.Provider>;
}

export function useAccountant(): AccountantContextValue {
  const ctx = useContext(AccountantContext);
  if (!ctx) {
    throw new Error('useAccountant must be used within an AccountantProvider');
  }
  return ctx;
}
