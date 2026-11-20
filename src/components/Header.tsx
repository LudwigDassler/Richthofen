'use client';

import React, { useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { WorkspaceTab } from '@/types/accounting';

export function Header() {
  const {
    theme,
    toggleTheme,
    activeTab,
    setActiveTab,
    db1C,
    syncStatus,
    reportingYear,
    setReportingYear,
    periodFilter,
    setPeriodFilter,
    operations,
    auditIssues,
    syncWith1CEndpoint,
    load1CJsonFile,
    resetWorkbench,
  } = useAccountant();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const activeOpsCount = operations.filter((o) => o.includeInProcessing).length;
  const errorIssuesCount = auditIssues.filter((i) => i.severity === 'error').length;
  const totalIssuesCount = auditIssues.length;

  const tabs: Array<{
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    badgeTone?: 'neutral' | 'amber' | 'red' | 'emerald';
  }> = [
    {
      id: 'db_osv',
      label: 'База 1С и ОСВ',
      icon: Database,
      badge: db1C ? db1C.rawBalances.length || db1C.postings.length : undefined,
      badgeTone: 'neutral',
    },
    {
      id: 'import_postings',
      label: 'Загрузка и автопроводки',
      icon: FileSpreadsheet,
      badge: operations.length > 0 ? activeOpsCount : undefined,
      badgeTone: 'neutral',
    },
    {
      id: 'audit_autofix',
      label: 'Проверка и автозаполнение',
      icon: ShieldCheck,
      badge: totalIssuesCount > 0 ? totalIssuesCount : operations.length > 0 || db1C ? 'OK' : undefined,
      badgeTone:
        errorIssuesCount > 0
          ? 'red'
          : totalIssuesCount > 0
            ? 'amber'
            : 'emerald',
    },
    {
      id: 'export_1c',
      label: 'Экспорт в 1С',
      icon: Download,
    },
  ];

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await load1CJsonFile(file);
    }
    e.target.value = '';
  };

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418]">
      {/* Top Organization & Period Bar */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
        {/* Left: Brand + Real 1C Org Identity */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-amber-600 text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">
            1С
          </div>

          {db1C && db1C.organization.name ? (
            <div className="min-w-0 flex items-center gap-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-zinc-950 dark:text-zinc-50 truncate">
                    {db1C.organization.name}
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    БД подключена
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums truncate">
                  <span>ИНН {db1C.organization.inn || '—'}</span>
                  {db1C.organization.kpp && <span>· КПП {db1C.organization.kpp}</span>}
                  <span className="hidden md:inline">
                    · {db1C.accountingPolicy.taxSystem} (НДС {db1C.accountingPolicy.vatRate}%)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0 text-xs text-zinc-600 dark:text-zinc-400">
              <Building2 className="w-4 h-4 text-zinc-400 shrink-0 hidden sm:block" />
              <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                База 1С не загружена
              </span>
              <span className="hidden lg:inline text-zinc-400 truncate">
                — загрузите JSON выгрузки 1С или синхронизируйте /api/1c-sync
              </span>
            </div>
          )}
        </div>

        {/* Right: Reporting Year + Period Filter + 1C Sync / Upload + Theme + Reset */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Reporting Year selector (default 2026) */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-amber-300/80 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/30 text-xs">
            <span className="text-zinc-600 dark:text-zinc-300 hidden sm:inline">
              Отчётный год:
            </span>
            <select
              aria-label="Отчётный год"
              value={reportingYear}
              onChange={(e) => setReportingYear(Number(e.target.value))}
              className="bg-transparent font-mono font-semibold tabular-nums text-amber-800 dark:text-amber-300 focus:outline-none text-xs cursor-pointer"
            >
              {Array.from(new Set([2024, 2025, 2026, 2027, reportingYear]))
                .sort((a, b) => a - b)
                .map((yr) => (
                  <option key={yr} value={yr} className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
                    {yr}
                  </option>
                ))}
            </select>
          </div>

          {/* Period selector */}
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">Период:</span>
            <input
              type="date"
              aria-label="Начало периода"
              value={periodFilter.dateFrom}
              onChange={(e) =>
                setPeriodFilter({ ...periodFilter, dateFrom: e.target.value })
              }
              className="bg-transparent font-mono tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none text-xs"
            />
            <span className="text-zinc-400">—</span>
            <input
              type="date"
              aria-label="Конец периода"
              value={periodFilter.dateTo}
              onChange={(e) =>
                setPeriodFilter({ ...periodFilter, dateTo: e.target.value })
              }
              className="bg-transparent font-mono tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none text-xs"
            />
            {(periodFilter.dateFrom || periodFilter.dateTo) && (
              <button
                type="button"
                onClick={() =>
                  setPeriodFilter({
                    dateFrom: `${reportingYear}-01-01`,
                    dateTo: `${reportingYear}-12-31`,
                  })
                }
                title={`Установить весь ${reportingYear} отчётный год`}
                className="ml-1 text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
              >
                весь {reportingYear}
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFilePick}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Выгрузка 1С (.json)</span>
          </button>

          <button
            type="button"
            onClick={() => syncWith1CEndpoint(false)}
            disabled={syncStatus === 'syncing'}
            title="Проверить и загрузить свежую выгрузку из /api/1c-sync"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin text-amber-600' : 'text-zinc-500'}`}
            />
            <span className="hidden md:inline">/api/1c-sync</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Переключить тему"
            className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {(db1C || operations.length > 0) && (
            confirmReset ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmReset(false);
                    await resetWorkbench();
                  }}
                  className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700"
                >
                  Сбросить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                title="Очистить загруженную базу и операции"
                className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </div>

      {/* 4-Tab Navigation Strip */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 flex items-center justify-between gap-4 border-t border-zinc-100 dark:border-zinc-800/80 overflow-x-auto">
        <nav className="flex items-center gap-1" aria-label="Разделы рабочего места">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-amber-600 text-zinc-950 dark:text-white'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    isActive ? 'text-amber-600 dark:text-amber-500' : 'text-zinc-400'
                  }`}
                />
                <span>
                  {idx + 1}. {tab.label}
                </span>
                {tab.badge !== undefined && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums ${
                      tab.badgeTone === 'red'
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300'
                        : tab.badgeTone === 'amber'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                          : tab.badgeTone === 'emerald'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                            : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Compact period inputs for smaller viewports */}
        <div className="flex xl:hidden items-center gap-1 text-xs py-1.5 shrink-0">
          <input
            type="date"
            aria-label="Период с"
            value={periodFilter.dateFrom}
            onChange={(e) =>
              setPeriodFilter({ ...periodFilter, dateFrom: e.target.value })
            }
            className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent font-mono text-[11px]"
          />
          <span className="text-zinc-400">—</span>
          <input
            type="date"
            aria-label="Период по"
            value={periodFilter.dateTo}
            onChange={(e) =>
              setPeriodFilter({ ...periodFilter, dateTo: e.target.value })
            }
            className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent font-mono text-[11px]"
          />
        </div>
      </div>
    </header>
  );
}
