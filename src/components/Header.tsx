'use client';

import React, { useMemo, useState } from 'react';
import {
  Building2,
  FileUp,
  Info,
  MessageSquareText,
  Moon,
  RefreshCw,
  Sun,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';

export function Header({
  onOpenImportModal,
  onOpenAiSettings,
  onToggleMobileChat,
}: {
  onOpenImportModal: () => void;
  onOpenAiSettings: () => void;
  onToggleMobileChat?: () => void;
}) {
  const {
    effectiveOrganization,
    operations,
    theme,
    toggleTheme,
    setActiveTab,
    synced1C,
    isSyncing1C,
    refreshFrom1CSync,
    simulate1CSyncWithSampleErrors,
    clear1CSyncSnapshot,
  } = useAccountant();

  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);

  const q2Operations = useMemo(
    () => operations.filter((op) => !op.isMonthEndClosing),
    [operations]
  );

  const doneIn1CCount = useMemo(
    () =>
      q2Operations.filter((op) => {
        const st =
          op.match1C?.syncStatus ??
          (op.status === 'done' ? 'done_in_1c' : 'missing_in_1c');
        return st === 'done_in_1c';
      }).length,
    [q2Operations]
  );

  const orgDisplayName =
    effectiveOrganization.shortName?.trim() ||
    effectiveOrganization.name?.trim() ||
    'Организация не указана';

  return (
    <header className="sticky top-0 z-30 h-12 bg-white dark:bg-[#111113] border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-5 flex items-center justify-between gap-3 select-none">
      {/* Left: App Brand + Real Organization & INN */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center font-mono font-bold text-xs">
            1С
          </div>
          <span className="font-semibold text-sm tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            1С:Личный Бухгалтер
          </span>
        </div>

        <div className="hidden md:block h-4 w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />

        {/* Real Organization & INN (immediately reflects synced 1C Организация) */}
        <button
          type="button"
          onClick={() => setActiveTab('database1c')}
          title="Открыть карточку организации и реквизиты из базы 1С"
          className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#FAFAFA] hover:bg-zinc-100 dark:bg-[#09090B] dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs transition-colors min-w-0 max-w-[360px]"
        >
          <Building2 className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
          <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {orgDisplayName}
          </span>
          {effectiveOrganization.inn && (
            <span className="font-mono tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
              ИНН {effectiveOrganization.inn}
            </span>
          )}
        </button>
      </div>

      {/* Right: 1C Connection Status + Refresh | Progress | Load Task / 1C File + Theme */}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        {/* 1C Connection Indicator + Compact Refresh */}
        <div className="relative flex items-center">
          <div className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-[#FAFAFA] dark:bg-[#09090B] divide-x divide-zinc-200 dark:divide-zinc-800">
            <button
              type="button"
              onClick={() => setSyncPopoverOpen((v) => !v)}
              title="Параметры подключения к 1С:Бухгалтерия 8.3"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              <span
                className={`w-2 h-2 rounded ${
                  synced1C
                    ? 'bg-emerald-500'
                    : 'bg-zinc-400 dark:bg-zinc-600'
                }`}
              />
              <span
                className={
                  synced1C
                    ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                    : 'text-zinc-600 dark:text-zinc-400'
                }
              >
                {synced1C ? '1С: Подключено' : '1С: Ожидание'}
              </span>
              <Info className="w-3 h-3 text-zinc-400 hidden sm:inline" />
            </button>

            <button
              type="button"
              onClick={() => void refreshFrom1CSync()}
              disabled={isSyncing1C}
              title="Обновить данные из 1С (/api/1c-sync или Downloads/1c_export.json)"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3 h-3 ${isSyncing1C ? 'animate-spin' : ''}`}
              />
              <span className="hidden lg:inline">Обновить</span>
            </button>
          </div>

          {syncPopoverOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setSyncPopoverOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1.5 w-96 rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 shadow-lg z-50 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Связь с базой 1С:Бухгалтерия 8.3</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSyncPopoverOpen(false)}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <div>Отправка из внешней обработки 1С (`HTTPСоединение`):</div>
                  <div className="px-2 py-1 rounded bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-900 dark:text-zinc-200 select-all">
                    POST http://localhost:3000/api/1c-sync
                  </div>
                  <div className="pt-1">Или авточтение файла выгрузки (каждые 3 сек.):</div>
                  <div className="px-2 py-1 rounded bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-900 dark:text-zinc-200 select-all">
                    C:\Users\Ludwig\Downloads\1c_export.json
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={async () => {
                      await simulate1CSyncWithSampleErrors();
                      setSyncPopoverOpen(false);
                    }}
                    className="flex-1 inline-flex items-center justify-center px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-colors"
                  >
                    Загрузить демо-снимок базы 1С
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSyncPopoverOpen(false);
                      onOpenAiSettings();
                    }}
                    className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Настройки ИИ
                  </button>

                  {synced1C && (
                    <button
                      type="button"
                      onClick={async () => {
                        await clear1CSyncSnapshot();
                        setSyncPopoverOpen(false);
                      }}
                      title="Очистить загруженный снимок 1С"
                      className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-rose-600 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Progress Pill */}
        <div
          className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-[#FAFAFA] dark:bg-[#09090B] text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300"
          title="Операции, полностью проведенные в 1С без ошибок"
        >
          Готово {doneIn1CCount} из {q2Operations.length}
        </div>

        {/* Primary Button: Load Task / 1C File */}
        <button
          type="button"
          onClick={onOpenImportModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-colors"
        >
          <FileUp className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Загрузить задание / файл 1С</span>
          <span className="sm:hidden">Загрузить</span>
        </button>

        {/* Subtle Theme Switch */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Переключить тему"
          title={theme === 'dark' ? 'Светлая тема' : 'Темная тема'}
          className="inline-flex items-center justify-center p-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </button>

        {onToggleMobileChat && (
          <button
            type="button"
            onClick={onToggleMobileChat}
            title="Личный бухгалтер"
            className="lg:hidden inline-flex items-center justify-center p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
          >
            <MessageSquareText className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  );
}
