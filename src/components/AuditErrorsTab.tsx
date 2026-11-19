'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileSearch,
  Info,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { AuditIssue, AuditIssueCategory } from '@/types/accounting';

type FilterCategory = 'all' | AuditIssueCategory;

const CATEGORY_META: Record<
  FilterCategory,
  { label: string; shortLabel: string }
> = {
  all: { label: 'Все', shortLabel: 'Все' },
  advance_unoffset: { label: 'Авансы 60/62', shortLabel: 'Авансы 60/62' },
  missing_sf_upd: { label: 'Счета-фактуры / 19', shortLabel: 'СФ / 19' },
  incomplete_requisites: { label: 'Неполные реквизиты', shortLabel: 'Реквизиты' },
  unclosed_month: { label: 'Закрытие месяца', shortLabel: 'Закрытие мес.' },
  posting_mismatch: { label: 'Суммы и счета', shortLabel: 'Суммы и счета' },
  missing_operation: { label: 'Пропущенные операции', shortLabel: 'Пропущенные' },
};

const CATEGORY_ORDER: FilterCategory[] = [
  'all',
  'advance_unoffset',
  'missing_sf_upd',
  'incomplete_requisites',
  'unclosed_month',
  'posting_mismatch',
  'missing_operation',
];

function formatMoneyMono(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val < -0.004 ? '−' : '';
  return `${sign}${Math.abs(val).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatDeltaMono(diff: number): string {
  if (Math.abs(diff) < 0.005) return '0,00 ₽';
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${Math.abs(diff).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatSyncTimestamp(iso?: string): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getSourceLabel(source?: string): string {
  switch (source) {
    case 'http-post':
      return 'POST /api/1c-sync';
    case 'downloads-file':
      return 'Downloads/1c_export.json';
    case 'file-upload':
      return 'Импорт файла 1С';
    case 'demo-simulation':
      return 'Тестовый снимок 1С';
    default:
      return '1С 8.3';
  }
}

function getSeverityMeta(severity: AuditIssue['severity']) {
  switch (severity) {
    case 'critical':
      return {
        label: 'Критично',
        icon: AlertOctagon,
        badgeClass:
          'border-red-300 bg-red-50 text-red-700 dark:border-red-900/80 dark:bg-red-950/40 dark:text-red-300',
        borderLeftClass: 'border-l-2 border-l-red-600 dark:border-l-red-500',
      };
    case 'warning':
      return {
        label: 'Внимание',
        icon: AlertTriangle,
        badgeClass:
          'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-300',
        borderLeftClass: 'border-l-2 border-l-amber-600 dark:border-l-amber-500',
      };
    default:
      return {
        label: 'Проверка',
        icon: Info,
        badgeClass:
          'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
        borderLeftClass: 'border-l-2 border-l-zinc-400 dark:border-l-zinc-600',
      };
  }
}

export function AuditErrorsTab() {
  const {
    auditReport,
    synced1C,
    isSyncing1C,
    refreshFrom1CSync,
    simulate1CSyncWithSampleErrors,
    clear1CSyncSnapshot,
    selectOperationAndNavigate,
    setActiveTab,
  } = useAccountant();

  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const handleCopy = (key: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  const handleRefreshSync = async () => {
    setSyncFeedback(null);
    const updated = await refreshFrom1CSync();
    setSyncFeedback(
      updated
        ? 'Снимок 1С успешно обновлен.'
        : synced1C
          ? 'Новых изменений в выгрузке 1С не обнаружено.'
          : 'Активный снимок 1С пока не найден (ожидается POST /api/1c-sync или 1c_export.json).'
    );
  };

  const handleSimulateErrors = async () => {
    setSyncFeedback(null);
    await simulate1CSyncWithSampleErrors();
    setSelectedCategory('all');
    setSyncFeedback('Загружен тестовый снимок 1С с типовыми ошибками по всем 6 категориям.');
  };

  const visibleIssues = useMemo<AuditIssue[]>(() => {
    if (selectedCategory === 'all') {
      return auditReport.allIssues;
    }
    return auditReport.issuesByCategory[selectedCategory] ?? [];
  }, [auditReport, selectedCategory]);

  const getCategoryCount = (cat: FilterCategory): number => {
    if (cat === 'all') return auditReport.allIssues.length;
    return auditReport.issuesByCategory[cat]?.length ?? 0;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      {/* Top Linear Control Bar */}
      <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-base">
                Автоматический аудитор ошибок в 1С:Бухгалтерия 8.3
              </h1>

              {synced1C ? (
                <span className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-800 tabular-nums dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-600 dark:bg-emerald-400" />
                  1С снимок от {formatSyncTimestamp(synced1C.syncedAt)} ({getSourceLabel(synced1C.source)})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-600 tabular-nums dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-[1px] bg-zinc-400" />
                  Ожидание снимка из 1С
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Проверка 6 категорий ошибок: незачтенные авансы <span className="font-mono">60/62</span>, забытые счета-фактуры на счете <span className="font-mono">19</span>, пустые реквизиты, закрытие месяца, расхождения сумм/счетов и пропущенные операции.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSyncing1C}
              onClick={() => void handleRefreshSync()}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing1C ? 'animate-spin' : ''}`} />
              <span>Обновить из 1С</span>
            </button>

            <button
              type="button"
              disabled={isSyncing1C}
              onClick={() => void handleSimulateErrors()}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Тест аудитора (снимок 1С с ошибками)</span>
            </button>

            {synced1C && (
              <button
                type="button"
                disabled={isSyncing1C}
                onClick={() => {
                  setSyncFeedback(null);
                  void clear1CSyncSnapshot();
                }}
                title="Очистить загруженный снимок 1С"
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:text-red-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-red-400"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Сбросить</span>
              </button>
            )}
          </div>
        </div>

        {syncFeedback && (
          <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {syncFeedback}
          </div>
        )}

        {/* KPI Metrics Strip */}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-zinc-200 pt-3.5 dark:border-zinc-800 sm:grid-cols-4">
          <div className="rounded border border-zinc-200 bg-[#FAFAFA] px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Всего замечаний</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
              {auditReport.totalIssuesCount}
            </div>
          </div>

          <div className="rounded border border-zinc-200 bg-[#FAFAFA] px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Критичные ошибки</div>
            <div
              className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${
                auditReport.criticalCount > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-zinc-900 dark:text-zinc-100'
              }`}
            >
              {auditReport.criticalCount}
            </div>
          </div>

          <div className="rounded border border-zinc-200 bg-[#FAFAFA] px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Предупреждения</div>
            <div
              className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${
                auditReport.warningCount > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-zinc-900 dark:text-zinc-100'
              }`}
            >
              {auditReport.warningCount}
            </div>
          </div>

          <div className="rounded border border-zinc-200 bg-[#FAFAFA] px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Сверено операций</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
              {auditReport.matchedOperationsCount} / {auditReport.totalOperationsCount}
            </div>
          </div>
        </div>

        {/* Category Filter Bar */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {CATEGORY_ORDER.map((cat) => {
            const count = getCategoryCount(cat);
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-300 dark:hover:bg-zinc-900'
                }`}
              >
                <span>{CATEGORY_META[cat].label}</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                    active
                      ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
                      : count > 0
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty / Onboarding State when no 1C data and 0 issues */}
      {!auditReport.has1CData && auditReport.allIssues.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-[#111113]">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <FileSearch className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Данные из 1С еще не переданы для аудита
                </h2>
                <p className="max-w-2xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Отправьте JSON-выгрузку из 1С на{' '}
                  <code className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
                    POST http://localhost:3000/api/1c-sync
                  </code>
                  , сохраните файл{' '}
                  <code className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
                    Downloads\1c_export.json
                  </code>{' '}
                  или запустите демонстрационный снимок с 6 типовыми ошибками студентов в 1 клик.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSimulateErrors()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Загрузить снимок 1С с ошибками</span>
            </button>
          </div>
        </div>
      ) : visibleIssues.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50/60 p-4 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-200">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <div className="text-sm font-semibold">
              {selectedCategory === 'all'
                ? 'Ошибок в базе 1С не обнаружено — все реквизиты, счета-фактуры и проводки совпадают с эталоном!'
                : `В категории «${CATEGORY_META[selectedCategory].label}» ошибок не найдено.`}
            </div>
            <div className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
              Все проверенные показатели соответствуют эталонному решению до 0,01 ₽.
            </div>
          </div>
        </div>
      ) : (
        /* Diagnostic Cards List */
        <div className="space-y-3">
          {visibleIssues.map((issue) => {
            const sev = getSeverityMeta(issue.severity);
            const SevIcon = sev.icon;

            return (
              <article
                key={issue.id}
                className={`rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113] ${sev.borderLeftClass}`}
              >
                {/* Card Header */}
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${sev.badgeClass}`}
                      >
                        <SevIcon className="h-3 w-3" />
                        <span>{sev.label}</span>
                      </span>

                      <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                        {CATEGORY_META[issue.category].label}
                      </span>

                      {issue.relatedOperationNumber !== undefined && (
                        <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-800 tabular-nums dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                          Оп. №{issue.relatedOperationNumber}
                        </span>
                      )}

                      {issue.affectedAccounts?.map((acc) => (
                        <span
                          key={acc}
                          className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-900 tabular-nums dark:border-zinc-700 dark:bg-zinc-800 dark:text-amber-300"
                        >
                          Сч. {acc}
                        </span>
                      ))}
                    </div>

                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {issue.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {issue.summary}
                    </p>
                  </div>

                  {/* Contextual Jump Button */}
                  <div className="flex shrink-0 items-center gap-2">
                    {issue.category === 'incomplete_requisites' ? (
                      <button
                        type="button"
                        onClick={() => setActiveTab('directories')}
                        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        <span>Открыть Реквизит-контроль</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    ) : issue.relatedOperationId ? (
                      <button
                        type="button"
                        onClick={() => selectOperationAndNavigate(issue.relatedOperationId!)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        <span>
                          Перейти к операции
                          {issue.relatedOperationNumber !== undefined
                            ? ` №${issue.relatedOperationNumber}`
                            : ''}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Side-by-Side Comparison Table («В вашей 1С» vs «Эталон») */}
                {issue.comparisonRows && issue.comparisonRows.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                          <th rowSpan={2} className="border-r border-zinc-200 px-3 py-2 dark:border-zinc-800">
                            Проводка / Показатель
                          </th>
                          <th
                            colSpan={4}
                            className="border-b border-r border-zinc-200 bg-red-50/50 px-3 py-1.5 text-center text-red-800 dark:border-zinc-800 dark:bg-red-950/20 dark:text-red-300"
                          >
                            В вашей 1С
                          </th>
                          <th
                            colSpan={4}
                            className="border-b border-r border-zinc-200 bg-emerald-50/50 px-3 py-1.5 text-center text-emerald-800 dark:border-zinc-800 dark:bg-emerald-950/20 dark:text-emerald-300"
                          >
                            Эталон
                          </th>
                          <th rowSpan={2} className="px-3 py-2 text-right font-mono">
                            Δ Разница
                          </th>
                        </tr>
                        <tr className="border-b border-zinc-200 bg-zinc-50/80 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                          <th className="border-r border-zinc-200 px-2 py-1.5 dark:border-zinc-800">Дт</th>
                          <th className="border-r border-zinc-200 px-2 py-1.5 dark:border-zinc-800">Кт</th>
                          <th className="border-r border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">Субконто</th>
                          <th className="border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">Сумма</th>
                          <th className="border-r border-zinc-200 px-2 py-1.5 dark:border-zinc-800">Дт</th>
                          <th className="border-r border-zinc-200 px-2 py-1.5 dark:border-zinc-800">Кт</th>
                          <th className="border-r border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">Субконто</th>
                          <th className="border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">Сумма</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {issue.comparisonRows.map((row, idx) => {
                          const debitMismatch =
                            row.in1CDebit && row.in1CDebit !== row.expectedDebit;
                          const creditMismatch =
                            row.in1CCredit && row.in1CCredit !== row.expectedCredit;
                          const hasAmountDiff = Math.abs(row.diffAmount) >= 0.01;

                          return (
                            <tr
                              key={`${issue.id}-cmp-${idx}`}
                              className="bg-white dark:bg-[#111113]"
                            >
                              <td className="border-r border-zinc-200 px-3 py-2 font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                                {row.label}
                              </td>

                              {/* В вашей 1С */}
                              <td
                                className={`border-r border-zinc-200 px-2 py-2 font-mono font-semibold tabular-nums dark:border-zinc-800 ${
                                  debitMismatch
                                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                    : 'text-zinc-800 dark:text-zinc-200'
                                }`}
                              >
                                {row.in1CDebit || '—'}
                              </td>
                              <td
                                className={`border-r border-zinc-200 px-2 py-2 font-mono font-semibold tabular-nums dark:border-zinc-800 ${
                                  creditMismatch
                                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                    : 'text-zinc-800 dark:text-zinc-200'
                                }`}
                              >
                                {row.in1CCredit || '—'}
                              </td>
                              <td className="border-r border-zinc-200 px-2.5 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                                {row.in1CSubconto || '—'}
                              </td>
                              <td
                                className={`border-r border-zinc-200 px-2.5 py-2 text-right font-mono font-semibold tabular-nums dark:border-zinc-800 ${
                                  hasAmountDiff || row.in1CAmount === null
                                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                    : 'text-zinc-800 dark:text-zinc-200'
                                }`}
                              >
                                {formatMoneyMono(row.in1CAmount)}
                              </td>

                              {/* Эталон */}
                              <td className="border-r border-zinc-200 px-2 py-2 font-mono font-semibold text-emerald-800 tabular-nums dark:border-zinc-800 dark:text-emerald-300">
                                {row.expectedDebit || '—'}
                              </td>
                              <td className="border-r border-zinc-200 px-2 py-2 font-mono font-semibold text-emerald-800 tabular-nums dark:border-zinc-800 dark:text-emerald-300">
                                {row.expectedCredit || '—'}
                              </td>
                              <td className="border-r border-zinc-200 px-2.5 py-2 text-[11px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                                {row.expectedSubconto || '—'}
                              </td>
                              <td className="border-r border-zinc-200 px-2.5 py-2 text-right font-mono font-semibold text-emerald-800 tabular-nums dark:border-zinc-800 dark:text-emerald-300">
                                {formatMoneyMono(row.expectedAmount)}
                              </td>

                              {/* Delta */}
                              <td
                                className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                                  hasAmountDiff
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-zinc-400 dark:text-zinc-500'
                                }`}
                              >
                                {formatDeltaMono(row.diffAmount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Red Missing Requisites List with 1-Click Copy Buttons */}
                {issue.missingRequisites && issue.missingRequisites.length > 0 && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50/40 p-3 dark:border-red-900/60 dark:bg-red-950/20">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-800 dark:text-red-300">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span>Незаполненные или неверные реквизиты в вашей базе 1С:</span>
                    </div>
                    <div className="divide-y divide-red-200/70 rounded border border-red-200 bg-white dark:divide-red-900/50 dark:border-red-900/60 dark:bg-[#111113]">
                      {issue.missingRequisites.map((gap, idx) => {
                        const copyId = `${issue.id}-req-${gap.fieldKey}-${idx}`;
                        const isCopied = copiedKey === copyId;

                        return (
                          <div
                            key={copyId}
                            className="flex flex-col justify-between gap-2 px-3 py-2 text-xs sm:flex-row sm:items-center"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {gap.fieldLabel}:
                              </span>
                              <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono text-[11px] text-red-700 tabular-nums dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                                {gap.reason === 'empty'
                                  ? 'Пусто в 1С'
                                  : `В 1С: ${gap.actualValueIn1C || '—'}`}
                              </span>
                              <span className="text-zinc-400">→</span>
                              <span className="font-mono text-xs font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                                {gap.expectedValue}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCopy(copyId, gap.expectedValue)}
                              className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                  <span className="text-emerald-700 dark:text-emerald-300">
                                    Скопировано
                                  </span>
                                </>
                              ) : (
                                <>
                                  <ClipboardCopy className="h-3 w-3" />
                                  <span>Копировать</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* How to Fix in 1C 8.3 Block */}
                <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/70">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Как исправить в 1С 8.3:{' '}
                  </span>
                  <span className="leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {issue.howToFixIn1C}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
