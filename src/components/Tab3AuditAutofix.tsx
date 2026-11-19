'use client';

import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { InlineFieldTarget } from '@/types/accounting';

export function Tab3AuditAutofix() {
  const {
    auditIssues,
    autoFixLogs,
    operations,
    db1C,
    runSmartAutoFixAll,
    runClosingAndOffsetsOnly,
    applyInlineAuditValue,
    setActiveTab,
  } = useAccountant();

  const errorCount = auditIssues.filter((i) => i.severity === 'error').length;
  const warningCount = auditIssues.filter((i) => i.severity === 'warning').length;
  const autoFixableCount = auditIssues.filter((i) => i.canAutoFixBy1C).length;

  // Deduplicate inline requisite inputs (e.g. if same new counterparty appears in 3 operations, show 1 input row!)
  const manualInlineIssues = auditIssues.filter(
    (issue) => issue.inlineTarget && !issue.canAutoFixBy1C
  );

  const uniqueManualTargets: Array<{
    issueId: string;
    title: string;
    description: string;
    target: InlineFieldTarget;
  }> = [];
  const seenLabels = new Set<string>();
  for (const issue of manualInlineIssues) {
    if (!issue.inlineTarget) continue;
    const dedupKey = `${issue.inlineTarget.kind}:${issue.inlineTarget.label}`;
    if (seenLabels.has(dedupKey)) continue;
    seenLabels.add(dedupKey);
    uniqueManualTargets.push({
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      target: issue.inlineTarget,
    });
  }

  return (
    <div className="space-y-4">
      {/* Primary Action Panel */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-950 dark:text-white">
              Диагностика учёта, реквизит-контроль и автоисправление по базе 1С
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-3xl">
              Проверка выявляет только реальные ошибки: незаполненные ИНН/КПП/договоры/склады, красноту по активным и пассивным счетам, незачтённые авансы (60.02 / 62.02) и незакрытые счета периода (26, 44.01, 90, 91).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={runSmartAutoFixAll}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-semibold transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Автозаполнить и исправить всё по БД 1С
              {autoFixableCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-800/60 font-mono text-[11px]">
                  {autoFixableCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={runClosingAndOffsetsOnly}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200"
            >
              <Calculator className="w-4 h-4 text-zinc-500" />
              Зачёт авансов + Закрытие месяца
            </button>
          </div>
        </div>

        {/* Status Metrics */}
        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800">
            <div className="text-zinc-500">Критические ошибки</div>
            <div
              className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600'
              }`}
            >
              {errorCount}
            </div>
          </div>

          <div className="p-3 rounded bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800">
            <div className="text-zinc-500">Предупреждения учёта</div>
            <div
              className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                warningCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'
              }`}
            >
              {warningCount}
            </div>
          </div>

          <div className="p-3 rounded bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800">
            <div className="text-zinc-500">Доступно для автоисправления</div>
            <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-zinc-900 dark:text-white">
              {autoFixableCount}
            </div>
          </div>

          <div className="p-3 rounded bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 flex flex-col justify-between">
            <div className="text-zinc-500">Готовность к выгрузке</div>
            <button
              type="button"
              onClick={() => setActiveTab('export_1c')}
              className="mt-1 inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400 hover:underline"
            >
              Перейти к экспорту в 1С
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Auto-fix Execution Log */}
      {autoFixLogs.length > 0 && (
        <div className="rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Выполненные автоматические исправления по данным БД 1С ({autoFixLogs.length}):
          </div>
          <ul className="space-y-1 text-xs text-emerald-900/90 dark:text-emerald-200/90 pl-6 list-disc">
            {autoFixLogs.map((entry, idx) => (
              <li key={idx}>{entry}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Inline Manual Input List for Brand-New Entities (e.g., unknown INN/KPP not present anywhere in 1C) */}
      {uniqueManualTargets.length > 0 && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Реквизиты новых элементов для ручного дозаполнения ({uniqueManualTargets.length})
            </h3>
            <p className="text-xs text-zinc-500">
              Эти данные отсутствуют в справочниках 1С и первичных файлах. Введите значение прямо в строку — статус сразу обновится во всех связанных документах.
            </p>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {uniqueManualTargets.map((item) => (
              <div
                key={item.issueId}
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {item.target.label}
                  </div>
                  <div className="text-zinc-500">{item.description}</div>
                </div>

                <div className="flex items-center gap-2 shrink-0 sm:w-80">
                  <input
                    type="text"
                    value={item.target.currentValue}
                    onChange={(e) => applyInlineAuditValue(item.target, e.target.value)}
                    placeholder={item.target.placeholder}
                    className="w-full px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full Diagnostics List */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
            Результаты аудита ОСВ и очереди документов
          </h3>
          <span className="text-xs text-zinc-500 font-mono tabular-nums">
            Всего проверок: {auditIssues.length === 0 ? '0 замечаний' : `${auditIssues.length}`}
          </span>
        </div>

        {auditIssues.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <div className="text-sm font-semibold text-zinc-950 dark:text-white">
              Ошибок и расхождений не обнаружено
            </div>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              {db1C || operations.length > 0
                ? 'Двойная запись соблюдена, краснота по счетам отсутствует, обязательные реквизиты и закрывающие операции заполнены. Данные готовы к выгрузке в 1С 8.3.'
                : 'Загрузите базу 1С или файлы с операциями для запуска комплексной бухгалтерской проверки.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {auditIssues.map((issue) => (
              <div
                key={issue.id}
                className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
              >
                <div className="flex items-start gap-2.5">
                  {issue.severity === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {issue.title}
                      </span>
                      {issue.accountCode && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                          Счёт {issue.accountCode}
                        </span>
                      )}
                      {issue.canAutoFixBy1C && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-medium">
                          Автоисправление по БД 1С
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400">{issue.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 pl-6 md:pl-0">
                  {issue.inlineTarget && issue.canAutoFixBy1C && (
                    <input
                      type="text"
                      value={issue.inlineTarget.currentValue}
                      onChange={(e) =>
                        applyInlineAuditValue(issue.inlineTarget!, e.target.value)
                      }
                      placeholder={issue.inlineTarget.placeholder}
                      className="w-48 px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:border-amber-600"
                    />
                  )}
                  {issue.operationId && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('import_postings')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                    >
                      К документу
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
