'use client';

import React, { useRef, useState } from 'react';
import {
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
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    countText?: string;
    tone?: 'neutral' | 'amber' | 'red' | 'emerald';
  }> = [
    {
      id: 'db_osv',
      label: 'ОСВ и база 1С',
      shortLabel: 'ОСВ и 1С',
      icon: Database,
      countText:
        db1C || activeOpsCount > 0
          ? String((db1C ? db1C.rawBalances.length || db1C.postings.length : 0) + activeOpsCount)
          : undefined,
      tone: 'neutral',
    },
    {
      id: 'import_postings',
      label: 'Загрузка и проводки',
      shortLabel: 'Операции',
      icon: FileSpreadsheet,
      countText: operations.length > 0 ? String(activeOpsCount) : undefined,
      tone: 'neutral',
    },
    {
      id: 'audit_autofix',
      label: 'Аудит и автоисправление',
      shortLabel: 'Аудит',
      icon: ShieldCheck,
      countText:
        totalIssuesCount > 0
          ? String(totalIssuesCount)
          : operations.length > 0 || db1C
            ? 'OK'
            : undefined,
      tone: errorIssuesCount > 0 ? 'red' : totalIssuesCount > 0 ? 'amber' : 'emerald',
    },
    {
      id: 'export_1c',
      label: 'Экспорт в 1С',
      shortLabel: 'Экспорт',
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
    <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
        {/* Zone 1: Brand (+ Organization on wide 2xl screens) */}
        <div className="flex items-center gap-2.5 shrink-0 min-w-0">
          <button
            type="button"
            onClick={() => setActiveTab('db_osv')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-none"
          >
            <span className="w-7 h-7 rounded-xl bg-amber-500 text-white font-semibold text-xs flex items-center justify-center shrink-0 shadow-sm">
              1С
            </span>
            <span className="font-semibold text-sm tracking-tight text-slate-900 dark:text-slate-50">
              <span className="sm:hidden">Контур 8.3</span>
              <span className="hidden sm:inline">Бухгалтерский Контур 8.3</span>
            </span>
          </button>

          {db1C && db1C.organization.name && (
            <div className="hidden 2xl:flex items-center gap-2 min-w-0 text-xs text-slate-500 dark:text-slate-400">
              <span aria-hidden="true">·</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                {db1C.organization.name}
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.6} />
                {db1C.accountingPolicy.taxSystem}
              </span>
            </div>
          )}
        </div>

        {/* Zone 2: Desktop Single-Row Navigation */}
        <nav
          className="hidden xl:flex items-center gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 shrink-0"
          aria-label="Разделы рабочего места"
        >
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 ${
                    isActive
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                <span>
                  {idx + 1}. {tab.label}
                </span>
                {tab.countText !== undefined && (
                  <span
                    className={`tabular-nums text-[11px] px-1.5 py-0.5 rounded-full ${
                      tab.tone === 'red'
                        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 font-semibold'
                        : tab.tone === 'amber'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-semibold'
                          : tab.tone === 'emerald'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-semibold'
                            : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {tab.countText}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Year + 1C Upload + Theme + Reset */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs">
            <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">Год:</span>
            <select
              aria-label="Отчётный год"
              value={reportingYear}
              onChange={(e) => setReportingYear(Number(e.target.value))}
              className="bg-transparent font-semibold tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none text-xs cursor-pointer"
            >
              {Array.from(new Set([2024, 2025, 2026, 2027, reportingYear]))
                .sort((a, b) => a - b)
                .map((yr) => (
                  <option
                    key={yr}
                    value={yr}
                    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    {yr}
                  </option>
                ))}
            </select>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.6} />
            <span className="hidden sm:inline">База 1С (.json)</span>
          </button>

          <button
            type="button"
            onClick={() => syncWith1CEndpoint(false)}
            disabled={syncStatus === 'syncing'}
            aria-label="Синхронизировать с эндпоинтом 1С"
            title="Проверить выгрузку на /api/1c-sync"
            className="hidden sm:inline-flex items-center gap-1.5 p-2 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              strokeWidth={1.6}
              className={`w-3.5 h-3.5 ${
                syncStatus === 'syncing' ? 'animate-spin text-amber-600' : 'text-slate-500'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Переключить тему"
            className="p-2 rounded-xl border border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5" strokeWidth={1.6} />
            ) : (
              <Moon className="w-3.5 h-3.5" strokeWidth={1.6} />
            )}
          </button>

          {(db1C || operations.length > 0) &&
            (confirmReset ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmReset(false);
                    await resetWorkbench();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 whitespace-nowrap transition-colors"
                >
                  Сбросить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap transition-colors"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                aria-label="Очистить загруженную базу и операции"
                title="Очистить загруженную базу и операции"
                className="p-2 rounded-xl border border-slate-200/80 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:border-rose-200 dark:hover:border-rose-800 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.6} />
              </button>
            ))}
        </div>
      </div>

      {/* Compact Mobile/Tablet Tab Strip */}
      <nav
        className="xl:hidden max-w-[1600px] mx-auto px-2 sm:px-4 flex items-center justify-between sm:justify-start gap-0.5 sm:gap-1 border-t border-slate-100 dark:border-slate-800/80 overflow-x-auto scrollbar-thin"
        aria-label="Разделы рабочего места (компактно)"
      >
        {tabs.map((tab, idx) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-2 sm:px-3 text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                isActive
                  ? 'border-amber-500 text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>
                {idx + 1}. <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </span>
              {tab.countText !== undefined && (
                <span
                  className={`ml-1 tabular-nums text-[10px] sm:text-[11px] ${
                    tab.tone === 'red'
                      ? 'text-rose-600 dark:text-rose-400 font-semibold'
                      : tab.tone === 'amber'
                        ? 'text-amber-700 dark:text-amber-400 font-semibold'
                        : tab.tone === 'emerald'
                          ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          : 'text-slate-400'
                  }`}
                >
                  ({tab.countText})
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
