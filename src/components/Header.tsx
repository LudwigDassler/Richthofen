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
      label: 'Загрузка и автопроводки',
      shortLabel: 'Операции',
      icon: FileSpreadsheet,
      countText: operations.length > 0 ? String(activeOpsCount) : undefined,
      tone: 'neutral',
    },
    {
      id: 'audit_autofix',
      label: 'Проверка и автозаполнение',
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
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-[#111317]/95 backdrop-blur-sm">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-12 flex items-center justify-between gap-4">
        {/* Zone 1: Brand + Active Organization */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setActiveTab('db_osv')}
            className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 focus-visible:outline-none"
          >
            <span className="w-6 h-6 rounded bg-amber-600 text-white font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
              1С
            </span>
            <span className="font-semibold text-sm tracking-tight text-zinc-950 dark:text-zinc-50">
              <span className="sm:hidden">Контур 8.3</span>
              <span className="hidden sm:inline">Бухгалтерский Контур 8.3</span>
            </span>
          </button>

          {db1C && db1C.organization.name ? (
            <div className="hidden md:flex items-center gap-2 min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
              <span aria-hidden="true">·</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[220px]">
                {db1C.organization.name}
              </span>
              <span className="font-mono tabular-nums shrink-0">
                ИНН {db1C.organization.inn || '—'}
              </span>
              <span className="hidden xl:inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {db1C.accountingPolicy.taxSystem}
              </span>
            </div>
          ) : (
            <span className="hidden lg:inline text-xs text-zinc-500 dark:text-zinc-400 truncate">
              · {activeOpsCount > 0 ? `В работе операций: ${activeOpsCount}` : 'Чистый контур РСБУ (БП 3.0)'}
            </span>
          )}
        </div>

        {/* Zone 2: Desktop Single-Row Navigation */}
        <nav
          className="hidden xl:flex items-center gap-1"
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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 ${
                    isActive
                      ? 'text-amber-400 dark:text-amber-600'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                />
                <span>
                  {idx + 1}. {tab.label}
                </span>
                {tab.countText !== undefined && (
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      isActive
                        ? 'opacity-90'
                        : tab.tone === 'red'
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : tab.tone === 'amber'
                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                            : tab.tone === 'emerald'
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : 'text-zinc-400 dark:text-zinc-500'
                    }`}
                  >
                    · {tab.countText}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Year + 1C Upload + Theme + Reset */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400 hidden sm:inline">Год:</span>
            <select
              aria-label="Отчётный год"
              value={reportingYear}
              onChange={(e) => setReportingYear(Number(e.target.value))}
              className="bg-transparent font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none text-xs cursor-pointer"
            >
              {Array.from(new Set([2024, 2025, 2026, 2027, reportingYear]))
                .sort((a, b) => a - b)
                .map((yr) => (
                  <option
                    key={yr}
                    value={yr}
                    className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">База 1С (.json)</span>
          </button>

          <button
            type="button"
            onClick={() => syncWith1CEndpoint(false)}
            disabled={syncStatus === 'syncing'}
            aria-label="Синхронизировать с эндпоинтом 1С"
            title="Проверить выгрузку на /api/1c-sync"
            className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                syncStatus === 'syncing' ? 'animate-spin text-amber-600' : 'text-zinc-500'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Переключить тему"
            className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          {(db1C || operations.length > 0) &&
            (confirmReset ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmReset(false);
                    await resetWorkbench();
                  }}
                  className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 whitespace-nowrap"
                >
                  Сбросить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap"
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
                className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ))}
        </div>
      </div>

      {/* Compact Sub-126px Mobile/Tablet Tab Strip (hidden on xl where single-row nav is shown) */}
      <nav
        className="xl:hidden max-w-[1600px] mx-auto px-4 flex items-center gap-1 border-t border-zinc-100 dark:border-zinc-800/80 overflow-x-auto scrollbar-thin"
        aria-label="Разделы рабочего места (компактно)"
      >
        {tabs.map((tab, idx) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-2.5 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                isActive
                  ? 'border-amber-600 text-zinc-950 dark:text-white'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <span>
                {idx + 1}. <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </span>
              {tab.countText !== undefined && (
                <span
                  className={`ml-1 font-mono tabular-nums text-[11px] ${
                    tab.tone === 'red'
                      ? 'text-red-600 dark:text-red-400 font-semibold'
                      : tab.tone === 'amber'
                        ? 'text-amber-700 dark:text-amber-400 font-semibold'
                        : tab.tone === 'emerald'
                          ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          : 'text-zinc-400'
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
