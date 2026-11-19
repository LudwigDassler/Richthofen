'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Database,
  Edit3,
  FileText,
  FolderKanban,
  Play,
  Plus,
  RefreshCw,
  Scale,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { CHART_OF_ACCOUNTS, getAccountInfo } from '@/data/chartOfAccounts';
import { roundMoney } from '@/lib/engine';
import { Import1CDataPanel } from '@/components/Import1CDataPanel';
import {
  EntityRequisiteCheck,
  Synced1CCounterparty,
  Synced1CDocument,
  Synced1CEmployeeRecord,
  Synced1CNomenclatureRecord,
} from '@/types/accounting';

export type Database1CSubTab = 'org' | 'documents' | 'directories' | 'balances';

const SECTION_ORDER = [
  'Банк и касса',
  'Покупки',
  'Продажи',
  'Зарплата и кадры',
  'Операции',
];

function formatMoney(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  const sign = val < -0.004 ? '−' : '';
  return `${sign}${Math.abs(roundMoney(val)).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatSyncTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function CopyValueButton({
  value,
  copyKey,
  copiedKey,
  onCopy,
  label = 'Скопировать',
}: {
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, val: string) => void;
  label?: string;
}) {
  if (!value || value === '—') return null;
  const isCopied = copiedKey === copyKey;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, value)}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {isCopied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span className="text-emerald-700 dark:text-emerald-300">Скопировано</span>
        </>
      ) : (
        <>
          <ClipboardCopy className="h-3 w-3 text-zinc-400" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

export function Database1CTab({
  initialSection,
}: {
  initialSection?: Database1CSubTab;
}) {
  const {
    organization,
    effectiveOrganization,
    updateOrganization,
    openingBalances,
    addOpeningBalance,
    updateOpeningBalance,
    removeOpeningBalance,
    balanceOpeningDifferenceTo84,
    directories,
    synced1C,
    isSyncing1C,
    requisiteReport,
    refreshFrom1CSync,
    simulate1CSyncWithSampleErrors,
  } = useAccountant();

  const [subTab, setSubTab] = useState<Database1CSubTab>(initialSection ?? 'org');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sub-tab 1: Organization manual edit toggle
  const [isEditingOrg, setIsEditingOrg] = useState(false);

  // Sub-tab 2: Documents filters & expanded rows
  const [docSectionFilter, setDocSectionFilter] = useState<string>('all');
  const [docPostedFilter, setDocPostedFilter] = useState<'all' | 'posted' | 'draft'>('all');
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>({});

  // Sub-tab 3: Directories inner view
  const [dirSubView, setDirSubView] = useState<'counterparties' | 'nomenclature' | 'employees'>(
    'counterparties'
  );

  // Sub-tab 4: Opening balances uploader / add row state
  const [showBalanceUploader, setShowBalanceUploader] = useState(false);
  const [newObAccount, setNewObAccount] = useState('60.01');
  const [newObSub1, setNewObSub1] = useState('');
  const [newObSub2, setNewObSub2] = useState('');
  const [newObDebit, setNewObDebit] = useState('');
  const [newObCredit, setNewObCredit] = useState('');

  useEffect(() => {
    if (initialSection) {
      setSubTab(initialSection);
    }
  }, [initialSection]);

  const handleCopy = (key: string, val: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(val);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1500);
  };

  const allDocs: Synced1CDocument[] = useMemo(
    () => synced1C?.allDocuments ?? [],
    [synced1C]
  );

  const unpostedDocsCount = useMemo(
    () => allDocs.filter((d) => !d.posted && !d.deletionMark).length,
    [allDocs]
  );

  const filteredDocs = useMemo(() => {
    return allDocs.filter((doc) => {
      if (docSectionFilter !== 'all' && doc.section1C !== docSectionFilter) {
        return false;
      }
      if (docPostedFilter === 'posted' && (!doc.posted || doc.deletionMark)) {
        return false;
      }
      if (docPostedFilter === 'draft' && (doc.posted || doc.deletionMark)) {
        return false;
      }
      return true;
    });
  }, [allDocs, docSectionFilter, docPostedFilter]);

  const groupedDocs = useMemo(() => {
    const groups = new Map<string, Synced1CDocument[]>();
    for (const sec of SECTION_ORDER) {
      groups.set(sec, []);
    }
    for (const doc of filteredDocs) {
      const sec = doc.section1C || 'Операции';
      const arr = groups.get(sec) ?? [];
      arr.push(doc);
      groups.set(sec, arr);
    }
    return Array.from(groups.entries()).filter(([, list]) => list.length > 0);
  }, [filteredDocs]);

  const syncedCounterparties: Synced1CCounterparty[] = useMemo(
    () => synced1C?.directories1C?.counterparties ?? synced1C?.counterparties ?? [],
    [synced1C]
  );

  const syncedNomenclature: Synced1CNomenclatureRecord[] = useMemo(
    () => synced1C?.directories1C?.nomenclature ?? [],
    [synced1C]
  );

  const syncedEmployees: Synced1CEmployeeRecord[] = useMemo(
    () => synced1C?.directories1C?.employees ?? synced1C?.registers1C?.hrHistory ?? [],
    [synced1C]
  );

  const checkByCounterpartyId = useMemo(() => {
    const map = new Map<string, EntityRequisiteCheck>();
    for (const chk of requisiteReport.counterpartyChecks) {
      map.set(chk.entityId, chk);
    }
    return map;
  }, [requisiteReport.counterpartyChecks]);

  const balanceTotals = useMemo(() => {
    const debit = roundMoney(openingBalances.reduce((s, r) => s + (Number(r.debit) || 0), 0));
    const credit = roundMoney(openingBalances.reduce((s, r) => s + (Number(r.credit) || 0), 0));
    const isBalanced = Math.abs(debit - credit) < 0.01;
    return { debit, credit, isBalanced };
  }, [openingBalances]);

  const leafAccounts = useMemo(
    () => CHART_OF_ACCOUNTS.filter((a) => !a.isGroup),
    []
  );

  const handleAddBalanceRow = (e: React.FormEvent) => {
    e.preventDefault();
    const db = Number(newObDebit.replace(/\s+/g, '').replace(',', '.')) || 0;
    const cr = Number(newObCredit.replace(/\s+/g, '').replace(',', '.')) || 0;
    if (db === 0 && cr === 0) return;
    addOpeningBalance({
      accountCode: newObAccount,
      subconto1: newObSub1.trim() || undefined,
      subconto2: newObSub2.trim() || undefined,
      debit: roundMoney(db),
      credit: roundMoney(cr),
    });
    setNewObSub1('');
    setNewObSub2('');
    setNewObDebit('');
    setNewObCredit('');
  };

  const toggleDocExpanded = (id: string) => {
    setExpandedDocIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const respPersons = synced1C?.registers1C?.responsiblePersons;
  const accPolicy = synced1C?.registers1C?.accountingPolicy;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Calm Sync Header Card */}
      <div className="flex flex-col justify-between gap-3 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113] sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Database className="h-4 w-4 text-zinc-500" />
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:text-base">
              Состояние вашей базы 1С:Бухгалтерия 8.3
            </h1>
            {synced1C ? (
              <span className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-800 tabular-nums dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-600 dark:bg-emerald-400" />
                Подключено · {formatSyncTime(synced1C.syncedAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                Автономный режим (данные задачи)
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {synced1C
              ? `Загружено из 1С: документов — ${allDocs.length}, контрагентов — ${syncedCounterparties.length}, строк входящих остатков — ${openingBalances.length}.`
              : 'Когда 1С отправляет JSON-снимок через /api/1c-sync или 1c_export.json, здесь автоматически отображаются ваша организация, все документы (включая черновики), справочники и остатки.'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isSyncing1C}
            onClick={() => void refreshFrom1CSync()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing1C ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>

          {!synced1C && (
            <button
              type="button"
              disabled={isSyncing1C}
              onClick={() => void simulate1CSyncWithSampleErrors()}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Загрузить демо-снимок базы 1С</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 Sub-Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setSubTab('org')}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            subTab === 'org'
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-[#111113] dark:hover:text-zinc-100'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>Организация и учетная политика</span>
          {requisiteReport.organizationCheck.missingFields.length > 0 && (
            <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
              {requisiteReport.organizationCheck.missingFields.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('documents')}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            subTab === 'documents'
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-[#111113] dark:hover:text-zinc-100'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Документы в базе 1С</span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
              unpostedDocsCount > 0
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                : subTab === 'documents'
                  ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {allDocs.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('directories')}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            subTab === 'directories'
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-[#111113] dark:hover:text-zinc-100'
          }`}
        >
          <FolderKanban className="h-3.5 w-3.5" />
          <span>Справочники</span>
          {requisiteReport.incompleteCount > 0 && (
            <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
              {requisiteReport.incompleteCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('balances')}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            subTab === 'balances'
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-[#111113] dark:hover:text-zinc-100'
          }`}
        >
          <Scale className="h-3.5 w-3.5" />
          <span>Входящие остатки на 31.03</span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
              !balanceTotals.isBalanced
                ? 'bg-red-600 text-white'
                : subTab === 'balances'
                  ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {openingBalances.length}
          </span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* SUB-TAB 1: ОРГАНИЗАЦИЯ И УЧЕТНАЯ ПОЛИТИКА                           */}
      {/* =================================================================== */}
      {subTab === 'org' && (
        <div className="space-y-4">
          {requisiteReport.organizationCheck.missingFields.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3.5 text-xs dark:border-red-900/60 dark:bg-red-950/20">
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-red-800 dark:text-red-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>В карточке нашей организации в 1С не заполнены поля:</span>
              </div>
              <div className="space-y-1.5">
                {requisiteReport.organizationCheck.missingFields.map((gap) => (
                  <div
                    key={gap.fieldKey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-white px-3 py-1.5 dark:border-red-900/50 dark:bg-[#111113]"
                  >
                    <div>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {gap.fieldLabel}:{' '}
                      </span>
                      <span className="font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                        {gap.expectedValue}
                      </span>
                    </div>
                    <CopyValueButton
                      value={gap.expectedValue}
                      copyKey={`org-gap-${gap.fieldKey}`}
                      copiedKey={copiedKey}
                      onCopy={handleCopy}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Organization Requisites Card */}
            <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113]">
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-zinc-200 pb-2.5 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Реквизиты организации
                </h2>
                <button
                  type="button"
                  onClick={() => setIsEditingOrg((v) => !v)}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <Edit3 className="h-3 w-3" />
                  <span>{isEditingOrg ? 'Готово' : 'Изменить вручную'}</span>
                </button>
              </div>

              {!isEditingOrg ? (
                <dl className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800/80">
                  {[
                    { label: 'Наименование', val: effectiveOrganization.name, mono: false },
                    { label: 'Краткое наименование', val: effectiveOrganization.shortName, mono: false },
                    { label: 'ИНН', val: effectiveOrganization.inn, mono: true },
                    { label: 'КПП', val: effectiveOrganization.kpp, mono: true },
                    { label: 'ОГРН', val: effectiveOrganization.ogrn || '—', mono: true },
                    { label: 'Расчетный счет', val: effectiveOrganization.bankAccount, mono: true },
                    { label: 'Банк', val: effectiveOrganization.bankName, mono: false },
                    { label: 'БИК', val: effectiveOrganization.bik, mono: true },
                    { label: 'Корр. счет', val: effectiveOrganization.corrAccount, mono: true },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <dt className="text-zinc-500 dark:text-zinc-400">{item.label}</dt>
                      <dd className="flex items-center gap-2 text-right">
                        <span
                          className={`font-medium text-zinc-900 dark:text-zinc-100 ${
                            item.mono ? 'font-mono tabular-nums' : ''
                          }`}
                        >
                          {item.val || '—'}
                        </span>
                        <CopyValueButton
                          value={item.val}
                          copyKey={`org-f-${item.label}`}
                          copiedKey={copiedKey}
                          onCopy={handleCopy}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-zinc-500">Наименование организации</span>
                    <input
                      type="text"
                      value={organization.name}
                      onChange={(e) =>
                        updateOrganization({ name: e.target.value, shortName: e.target.value })
                      }
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-zinc-500">ИНН</span>
                    <input
                      type="text"
                      value={organization.inn}
                      onChange={(e) => updateOrganization({ inn: e.target.value })}
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono tabular-nums dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-zinc-500">КПП</span>
                    <input
                      type="text"
                      value={organization.kpp}
                      onChange={(e) => updateOrganization({ kpp: e.target.value })}
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono tabular-nums dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-zinc-500">Расчетный счет</span>
                    <input
                      type="text"
                      value={organization.bankAccount}
                      onChange={(e) => updateOrganization({ bankAccount: e.target.value })}
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono tabular-nums dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-zinc-500">БИК</span>
                    <input
                      type="text"
                      value={organization.bik}
                      onChange={(e) => updateOrganization({ bik: e.target.value })}
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono tabular-nums dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-zinc-500">Банк</span>
                    <input
                      type="text"
                      value={organization.bankName}
                      onChange={(e) => updateOrganization({ bankName: e.target.value })}
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-zinc-500">ФИО студента (для подстановки)</span>
                    <input
                      type="text"
                      value={organization.studentName}
                      onChange={(e) => updateOrganization({ studentName: e.target.value })}
                      placeholder="Например: Иванов И.И."
                      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Responsible Persons & Accounting Policy Card */}
            <div className="space-y-4">
              <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113]">
                <h2 className="mb-3 border-b border-zinc-200 pb-2.5 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
                  Ответственные лица (Регистр сведений)
                </h2>
                <dl className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800/80">
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">
                      Руководитель{respPersons?.directorPosition ? ` (${respPersons.directorPosition})` : ''}
                    </dt>
                    <dd className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                      <span>{respPersons?.directorName || effectiveOrganization.directorName || '—'}</span>
                      <CopyValueButton
                        value={respPersons?.directorName || effectiveOrganization.directorName}
                        copyKey="resp-dir"
                        copiedKey={copiedKey}
                        onCopy={handleCopy}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Главный бухгалтер</dt>
                    <dd className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                      <span>
                        {respPersons?.chiefAccountantName ||
                          effectiveOrganization.chiefAccountantName ||
                          '—'}
                      </span>
                      <CopyValueButton
                        value={
                          respPersons?.chiefAccountantName ||
                          effectiveOrganization.chiefAccountantName
                        }
                        copyKey="resp-acc"
                        copiedKey={copiedKey}
                        onCopy={handleCopy}
                      />
                    </dd>
                  </div>
                  {respPersons?.cashierName && (
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-zinc-500 dark:text-zinc-400">Кассир</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                        {respPersons.cashierName}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113]">
                <h2 className="mb-3 border-b border-zinc-200 pb-2.5 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
                  Учетная политика организации
                </h2>
                <dl className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800/80">
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Система налогообложения</dt>
                    <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                      {accPolicy?.taxSystem ||
                        (effectiveOrganization.taxSystem === 'OSNO'
                          ? 'Общая (ОСНО, плательщик НДС)'
                          : effectiveOrganization.taxSystem)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Основная ставка НДС</dt>
                    <dd className="font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {effectiveOrganization.defaultVatRate}%
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Основной счет затрат</dt>
                    <dd className="font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {accPolicy?.mainCostAccount || '20.01'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Списание счета 26</dt>
                    <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                      {accPolicy?.directCosting !== undefined
                        ? accPolicy.directCosting
                          ? 'Директ-костинг (на счет 90.08.1)'
                          : 'В себестоимость (на счет 20.01)'
                        : effectiveOrganization.costingMethod === 'direct-costing'
                          ? 'Директ-костинг (на счет 90.08.1)'
                          : 'Полная себестоимость (на счет 20.01)'}
                    </dd>
                  </div>
                  {accPolicy?.valuationMethod && (
                    <div className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-zinc-500 dark:text-zinc-400">Оценка МПЗ при выбытии</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                        {accPolicy.valuationMethod}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 2: ДОКУМЕНТЫ В БАЗЕ 1С (ВсеДокументы)                       */}
      {/* =================================================================== */}
      {subTab === 'documents' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#111113] sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-1">
              {['all', ...SECTION_ORDER].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setDocSectionFilter(sec)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    docSectionFilter === sec
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'
                  }`}
                >
                  {sec === 'all' ? 'Все разделы' : sec}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
              {[
                { id: 'all' as const, label: 'Все' },
                { id: 'posted' as const, label: 'Проведенные' },
                { id: 'draft' as const, label: `Черновики (${unpostedDocsCount})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setDocPostedFilter(f.id)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    docPostedFilter === f.id
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {allDocs.length === 0 ? (
            <div className="rounded-md border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-[#111113]">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Список документов из базы 1С пока пуст
              </p>
              <p className="mx-auto mt-1 max-w-xl text-xs text-zinc-500 dark:text-zinc-400">
                Подключите живую синхронизацию 1С или загрузите JSON-снимок базы — здесь появятся все созданные вами документы (списания с р/сч, поступления, реализации, кадровые приказы), включая непроведенные черновики.
              </p>
            </div>
          ) : groupedDocs.length === 0 ? (
            <div className="rounded-md border border-zinc-200 bg-white p-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-[#111113]">
              По выбранному фильтру документов не найдено.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedDocs.map(([sectionName, docs]) => (
                <div
                  key={sectionName}
                  className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]"
                >
                  <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      Раздел 1С: {sectionName}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                      Документов: {docs.length}
                    </span>
                  </div>

                  <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                    {docs.map((doc) => {
                      const isExpanded = Boolean(expandedDocIds[doc.id]);
                      const hasLines = doc.lines && doc.lines.length > 0;

                      return (
                        <div key={doc.id}>
                          <div
                            onClick={() => hasLines && toggleDocExpanded(doc.id)}
                            className={`flex flex-col justify-between gap-2 px-4 py-3 text-xs sm:flex-row sm:items-center ${
                              hasLines
                                ? 'cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-900/50'
                                : ''
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              {hasLines ? (
                                <span className="mt-0.5 text-zinc-400">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </span>
                              ) : (
                                <span className="w-4" />
                              )}

                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                    {doc.docType}
                                  </span>
                                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                                    № {doc.number || 'б/н'} от {doc.date}
                                  </span>

                                  {doc.deletionMark ? (
                                    <span className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                                      На удаление
                                    </span>
                                  ) : doc.posted ? (
                                    <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                                      <CheckCircle2 className="h-3 w-3" />
                                      Проведен
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                                      <AlertTriangle className="h-3 w-3" />
                                      Не проведен (черновик)
                                    </span>
                                  )}
                                </div>

                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                  {doc.operationKind && <span>Вид: {doc.operationKind}</span>}
                                  {doc.counterparty && <span>Контрагент: {doc.counterparty}</span>}
                                  {doc.contract && <span>Договор: {doc.contract}</span>}
                                  {doc.settlementAccount && (
                                    <span className="font-mono tabular-nums">
                                      Сч. расчетов: {doc.settlementAccount}
                                      {doc.advanceAccount ? ` / ${doc.advanceAccount}` : ''}
                                    </span>
                                  )}
                                  {doc.hasSfOrUpd !== undefined && (
                                    <span>
                                      СФ/УПД:{' '}
                                      {doc.hasSfOrUpd
                                        ? `Зарегистрирован${doc.sfNumber ? ` №${doc.sfNumber}` : ''}`
                                        : 'Нет'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-3 pl-6 sm:pl-0">
                              <div className="text-right font-mono tabular-nums">
                                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                  {formatMoney(doc.amount)}
                                </div>
                                {doc.vatAmount !== undefined && doc.vatAmount > 0 && (
                                  <div className="text-[10px] text-zinc-500">
                                    в т.ч. НДС: {formatMoney(doc.vatAmount)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {isExpanded && hasLines && (
                            <div className="border-t border-zinc-100 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                              <div className="mb-1.5 text-[11px] font-medium text-zinc-500">
                                Табличная часть документа ({doc.lines.length} стр.):
                              </div>
                              <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
                                <table className="w-full min-w-[600px] border-collapse text-left text-[11px]">
                                  <thead>
                                    <tr className="border-b border-zinc-200 bg-zinc-50 font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                                      <th className="px-2.5 py-1.5">Номенклатура / Расшифровка</th>
                                      <th className="px-2 py-1.5 text-right font-mono">Кол-во</th>
                                      <th className="px-2 py-1.5 text-right font-mono">Цена</th>
                                      <th className="px-2.5 py-1.5 text-right font-mono">Сумма</th>
                                      <th className="px-2 py-1.5">НДС</th>
                                      <th className="px-2 py-1.5 font-mono">Счет учета</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {doc.lines.map((ln, idx) => (
                                      <tr key={idx}>
                                        <td className="px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200">
                                          {ln.nomenclature || ln.subconto || '—'}
                                        </td>
                                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                                          {ln.quantity ?? '—'}
                                        </td>
                                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                                          {ln.price !== undefined ? formatMoney(ln.price) : '—'}
                                        </td>
                                        <td className="px-2.5 py-1.5 text-right font-mono font-medium tabular-nums">
                                          {ln.amount !== undefined ? formatMoney(ln.amount) : '—'}
                                        </td>
                                        <td className="px-2 py-1.5 font-mono tabular-nums">
                                          {ln.vatRate || '—'}
                                        </td>
                                        <td className="px-2 py-1.5 font-mono font-semibold tabular-nums">
                                          {ln.accountCode || '—'}
                                          {ln.vatAccountCode ? ` / ${ln.vatAccountCode}` : ''}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 3: СПРАВОЧНИКИ (ВсеСправочники)                             */}
      {/* =================================================================== */}
      {subTab === 'directories' && (
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-[#111113]">
            {[
              {
                id: 'counterparties' as const,
                label: `Контрагенты и договоры (${directories.counterparties.length})`,
              },
              {
                id: 'nomenclature' as const,
                label: `Номенклатура (${
                  syncedNomenclature.length || directories.nomenclature.length
                })`,
              },
              {
                id: 'employees' as const,
                label: `Сотрудники и кадры (${
                  syncedEmployees.length || directories.employees.length
                })`,
              },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setDirSubView(t.id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                  dirSubView === t.id
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {dirSubView === 'counterparties' && (
            <div className="grid grid-cols-1 gap-3">
              {directories.counterparties.map((cp) => {
                const reqCheck = checkByCounterpartyId.get(cp.id);
                const hasGaps =
                  reqCheck &&
                  (reqCheck.status === 'incomplete_in_1c' || reqCheck.status === 'missing_in_1c');

                return (
                  <div
                    key={cp.id}
                    className={`rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113] ${
                      hasGaps ? 'border-l-2 border-l-red-600' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2.5 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {cp.name}
                        </h3>
                        <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                          {cp.contractKind}
                        </span>
                      </div>

                      {reqCheck?.status === 'missing_in_1c' ? (
                        <span className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                          Нет в базе 1С
                        </span>
                      ) : reqCheck?.status === 'incomplete_in_1c' ? (
                        <span className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                          Пустые реквизиты в 1С ({reqCheck.missingFields.length})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Заполнено ({reqCheck?.filledCount ?? 7}/{reqCheck?.totalRequired ?? 7})
                        </span>
                      )}
                    </div>

                    {hasGaps && reqCheck && reqCheck.missingFields.length > 0 && (
                      <div className="mt-3 rounded border border-red-200 bg-red-50/40 p-2.5 text-xs dark:border-red-900/60 dark:bg-red-950/20">
                        <div className="mb-1.5 font-medium text-red-800 dark:text-red-300">
                          Дозаполните в карточке контрагента в 1С:
                        </div>
                        <div className="space-y-1">
                          {reqCheck.missingFields.map((gap) => (
                            <div
                              key={gap.fieldKey}
                              className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-200/80 bg-white px-2.5 py-1 dark:border-red-900/50 dark:bg-[#111113]"
                            >
                              <span>
                                <span className="text-zinc-500">{gap.fieldLabel}: </span>
                                <span className="font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                                  {gap.expectedValue}
                                </span>
                              </span>
                              <CopyValueButton
                                value={gap.expectedValue}
                                copyKey={`cp-gap-${cp.id}-${gap.fieldKey}`}
                                copiedKey={copiedKey}
                                onCopy={handleCopy}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                      {[
                        { label: 'ИНН', val: cp.inn, mono: true },
                        { label: 'КПП', val: cp.kpp, mono: true },
                        { label: 'Расчетный счет', val: cp.bankAccount, mono: true },
                        { label: 'БИК', val: cp.bik, mono: true },
                        { label: 'Банк', val: cp.bankName, mono: false },
                        {
                          label: 'Договор',
                          val: `${cp.contractNumber}${cp.contractDate ? ` от ${cp.contractDate}` : ''}`,
                          mono: false,
                        },
                      ].map((f) => (
                        <div
                          key={f.label}
                          className="flex items-center justify-between gap-2 border-b border-zinc-100 py-1 dark:border-zinc-800/60"
                        >
                          <span className="text-zinc-500 dark:text-zinc-400">{f.label}</span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-medium text-zinc-900 dark:text-zinc-100 ${
                                f.mono ? 'font-mono tabular-nums' : ''
                              }`}
                            >
                              {f.val || '—'}
                            </span>
                            <CopyValueButton
                              value={f.val}
                              copyKey={`cp-${cp.id}-${f.label}`}
                              copiedKey={copiedKey}
                              onCopy={handleCopy}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {dirSubView === 'nomenclature' && (
            <div className="space-y-3">
              {syncedNomenclature.length > 0 && (
                <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
                  <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                    Номенклатура в вашей базе 1С ({syncedNomenclature.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50/60 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                          <th className="px-3 py-2 font-mono">Код 1С</th>
                          <th className="px-3 py-2">Наименование</th>
                          <th className="px-3 py-2">Вид</th>
                          <th className="px-2.5 py-2">Ед.</th>
                          <th className="px-2.5 py-2 font-mono">Ставка НДС</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                        {syncedNomenclature.map((sn) => (
                          <tr key={sn.id}>
                            <td className="px-3 py-2 font-mono text-zinc-500 tabular-nums">
                              {sn.code || '—'}
                            </td>
                            <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                              {sn.name}
                            </td>
                            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                              {sn.kind || '—'}
                            </td>
                            <td className="px-2.5 py-2 font-mono tabular-nums">{sn.unit || '—'}</td>
                            <td className="px-2.5 py-2 font-mono tabular-nums">
                              {sn.vatRate || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
                <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  Эталонная номенклатура по задаче ({directories.nomenclature.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50/60 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                        <th className="px-3 py-2.5">Наименование</th>
                        <th className="px-3 py-2.5">Вид номенклатуры</th>
                        <th className="px-2.5 py-2.5">Ед.</th>
                        <th className="px-2.5 py-2.5 font-mono">Счет учета</th>
                        <th className="px-2.5 py-2.5 font-mono">НДС</th>
                        <th className="px-3 py-2.5 text-right">Копирование</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                      {directories.nomenclature.map((nom) => (
                        <tr key={nom.id}>
                          <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                            <div>{nom.name}</div>
                            {nom.nomenclatureGroup && (
                              <div className="text-[11px] text-zinc-500">
                                Номенклатурная группа: {nom.nomenclatureGroup}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{nom.kind}</td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums">{nom.unit}</td>
                          <td className="px-2.5 py-2.5 font-mono font-semibold tabular-nums">
                            {nom.accountCode} / {nom.vatAccountCode}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums">
                            {nom.defaultVatRate}%
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <CopyValueButton
                              value={nom.name}
                              copyKey={`nom-${nom.id}`}
                              copiedKey={copiedKey}
                              onCopy={handleCopy}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {dirSubView === 'employees' && (
            <div className="space-y-3">
              {syncedEmployees.length > 0 && (
                <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
                  <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                    Сотрудники и кадровая история в базе 1С ({syncedEmployees.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50/60 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                          <th className="px-3 py-2 font-mono">Таб. №</th>
                          <th className="px-3 py-2">ФИО сотрудника</th>
                          <th className="px-3 py-2">Должность / Подразделение</th>
                          <th className="px-2.5 py-2 font-mono">Дата приема</th>
                          <th className="px-2.5 py-2 text-right font-mono">Оклад</th>
                          <th className="px-3 py-2 font-mono">ИНН / СНИЛС</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                        {syncedEmployees.map((se) => (
                          <tr key={se.id}>
                            <td className="px-3 py-2 font-mono text-zinc-500 tabular-nums">
                              {se.personnelNumber || '—'}
                            </td>
                            <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                              {se.fullName}
                            </td>
                            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                              {se.position || '—'}
                              {se.department ? ` · ${se.department}` : ''}
                            </td>
                            <td className="px-2.5 py-2 font-mono tabular-nums">
                              {se.hireDate || '—'}
                            </td>
                            <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums">
                              {se.salary !== undefined ? formatMoney(se.salary) : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 tabular-nums">
                              {[se.inn, se.snils].filter(Boolean).join(' / ') || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
                <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  Штат и кадры по условию задачи ({directories.employees.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50/60 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                        <th className="px-3 py-2.5">ФИО сотрудника</th>
                        <th className="px-3 py-2.5">Должность</th>
                        <th className="px-3 py-2.5">Подразделение</th>
                        <th className="px-2.5 py-2.5 font-mono">Дата приема</th>
                        <th className="px-2.5 py-2.5 text-right font-mono">Оклад</th>
                        <th className="px-2.5 py-2.5 font-mono">Счет затрат</th>
                        <th className="px-3 py-2.5 text-right">Копирование</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                      {directories.employees.map((emp) => (
                        <tr key={emp.id}>
                          <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                            {emp.fullName}
                          </td>
                          <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">
                            {emp.position}
                          </td>
                          <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">
                            {emp.department}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums">{emp.hireDate}</td>
                          <td className="px-2.5 py-2.5 text-right font-mono font-semibold tabular-nums">
                            {formatMoney(emp.salary)}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono font-semibold tabular-nums">
                            {emp.costAccount}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <CopyValueButton
                              value={emp.fullName}
                              copyKey={`emp-${emp.id}`}
                              copiedKey={copiedKey}
                              onCopy={handleCopy}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 4: ВХОДЯЩИЕ ОСТАТКИ НА 31.03 (Остатки)                      */}
      {/* =================================================================== */}
      {subTab === 'balances' && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#111113] sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Контроль баланса на 31.03 / 01.04:
              </span>
              <span className="font-mono tabular-nums">
                Дт <strong>{formatMoney(balanceTotals.debit)}</strong> = Кт{' '}
                <strong>{formatMoney(balanceTotals.credit)}</strong>
              </span>
              {balanceTotals.isBalanced ? (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Баланс сходится
                </span>
              ) : (
                <button
                  type="button"
                  onClick={balanceOpeningDifferenceTo84}
                  className="rounded border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                >
                  Выровнять разницу на счет 84.01
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowBalanceUploader((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>
                {showBalanceUploader
                  ? 'Скрыть загрузчик файлов 1С'
                  : 'Загрузить ОСВ 1 кв. из файла (.xlsx / .xml / .txt)'}
              </span>
            </button>
          </div>

          {showBalanceUploader && (
            <Import1CDataPanel compact onApplied={() => setShowBalanceUploader(false)} />
          )}

          {/* Opening Balances Table */}
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <th className="w-24 px-3 py-2.5 font-mono">Счет</th>
                    <th className="px-3 py-2.5">Наименование счета</th>
                    <th className="px-3 py-2.5">Субконто 1 (Контрагент / Налог)</th>
                    <th className="px-3 py-2.5">Субконто 2 (Договор)</th>
                    <th className="w-36 px-2.5 py-2.5 text-right font-mono">Дебет</th>
                    <th className="w-36 px-2.5 py-2.5 text-right font-mono">Кредит</th>
                    <th className="w-12 px-2.5 py-2.5 text-center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                  {openingBalances.map((row) => {
                    const info = getAccountInfo(row.accountCode);
                    return (
                      <tr key={row.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
                        <td className="px-3 py-2 font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                          {row.accountCode}
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{info.name}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.subconto1 || ''}
                            placeholder="—"
                            onChange={(e) =>
                              updateOpeningBalance(row.id, { subconto1: e.target.value })
                            }
                            className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-zinc-800 hover:border-zinc-200 focus:border-zinc-400 focus:bg-white focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-800 dark:focus:bg-zinc-900"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.subconto2 || ''}
                            placeholder="—"
                            onChange={(e) =>
                              updateOpeningBalance(row.id, { subconto2: e.target.value })
                            }
                            className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-zinc-800 hover:border-zinc-200 focus:border-zinc-400 focus:bg-white focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-800 dark:focus:bg-zinc-900"
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                          <input
                            type="number"
                            step="0.01"
                            value={row.debit || ''}
                            placeholder="0,00"
                            onChange={(e) =>
                              updateOpeningBalance(row.id, {
                                debit: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-zinc-900 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                          <input
                            type="number"
                            step="0.01"
                            value={row.credit || ''}
                            placeholder="0,00"
                            onChange={(e) =>
                              updateOpeningBalance(row.id, {
                                credit: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-zinc-900 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                          />
                        </td>
                        <td className="px-2.5 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeOpeningBalance(row.id)}
                            title="Удалить строку"
                            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Compact Add Balance Row Form */}
            <form
              onSubmit={handleAddBalanceRow}
              className="flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900"
            >
              <select
                value={newObAccount}
                onChange={(e) => setNewObAccount(e.target.value)}
                className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-[#111113]"
              >
                {leafAccounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newObSub1}
                onChange={(e) => setNewObSub1(e.target.value)}
                placeholder="Контрагент / субконто 1"
                className="w-44 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-800 dark:bg-[#111113]"
              />
              <input
                type="text"
                value={newObSub2}
                onChange={(e) => setNewObSub2(e.target.value)}
                placeholder="Договор"
                className="w-36 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-800 dark:bg-[#111113]"
              />
              <input
                type="text"
                value={newObDebit}
                onChange={(e) => setNewObDebit(e.target.value)}
                placeholder="Дебет"
                className="w-28 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-right font-mono tabular-nums dark:border-zinc-800 dark:bg-[#111113]"
              />
              <input
                type="text"
                value={newObCredit}
                onChange={(e) => setNewObCredit(e.target.value)}
                placeholder="Кредит"
                className="w-28 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-right font-mono tabular-nums dark:border-zinc-800 dark:bg-[#111113]"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Добавить остаток</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
