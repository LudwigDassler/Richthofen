'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  RotateCcw,
  Sparkles,
  User,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import {
  DirectoryAutocompleteOption1C,
  InlineFieldTarget,
} from '@/types/accounting';

export function Tab3AuditAutofix() {
  const {
    auditIssues,
    directoryOptions1C,
    pendingNewCounterparties,
    autoFixLogs,
    operations,
    db1C,
    runSmartAutoFixAll,
    runClosingAndOffsetsOnly,
    applyInlineAuditValue,
    bindOperationTo1CDirectoryItem,
    resetNewCounterparty,
    setActiveTab,
  } = useAccountant();

  // Local draft values & validation messages — NEVER mutate global state on onChange
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const errorCount = auditIssues.filter((i) => i.severity === 'error').length;
  const warningCount = auditIssues.filter((i) => i.severity === 'warning').length;
  const autoFixableCount = auditIssues.filter((i) => i.canAutoFixBy1C).length;

  const setDraft = (key: string, value: string) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearDraftKeys = (keys: string[]) => {
    setDraftValues((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  const commitTargetValue = (
    draftKey: string,
    target: InlineFieldTarget,
    fallbackCurrent: string
  ) => {
    const raw =
      draftValues[draftKey] !== undefined ? draftValues[draftKey] : fallbackCurrent;

    if (target.kind === 'operation_field' && target.field === 'counterpartyName') {
      if (raw.trim().length < 2) {
        setFieldErrors((prev) => ({
          ...prev,
          [draftKey]: 'Наименование контрагента должно содержать минимум 2 символа.',
        }));
        return;
      }
    }

    if (target.kind === 'operation_field' && target.field === 'counterpartyInn') {
      const digits = raw.replace(/\D/g, '');
      if (digits.length !== 10 && digits.length !== 12) {
        setFieldErrors((prev) => ({
          ...prev,
          [draftKey]: `Введите ровно 10 или 12 цифр ИНН (сейчас введено: ${digits.length}).`,
        }));
        return;
      }
    }

    if (target.kind === 'operation_field' && target.field === 'counterpartyKpp') {
      const digits = raw.replace(/\D/g, '');
      if (digits.length !== 9) {
        setFieldErrors((prev) => ({
          ...prev,
          [draftKey]: `Введите ровно 9 цифр КПП (сейчас введено: ${digits.length}).`,
        }));
        return;
      }
    }

    const res = applyInlineAuditValue(target, raw);
    if (!res.ok) {
      setFieldErrors((prev) => ({
        ...prev,
        [draftKey]: res.error || 'Проверьте корректность введённого значения.',
      }));
      return;
    }

    clearDraftKeys([draftKey]);
  };

  // 1. Operations missing counterparty name (kept distinct per operationId so typing never jumps between docs)
  const missingCounterpartyNameIssues = auditIssues.filter(
    (issue) =>
      !issue.canAutoFixBy1C &&
      issue.inlineTarget?.kind === 'operation_field' &&
      issue.inlineTarget.field === 'counterpartyName'
  );

  // 2. Dynamically computed new counterparties (absent in 1C Контрагенты & ФизическиеЛица) requiring INN or KPP
  const newCounterpartiesNeedingRequisites = pendingNewCounterparties.filter(
    (cp) => cp.needsInn || cp.needsKpp
  );

  // 3. Other manual inline targets (e.g. missing debit/credit account code in manual posting)
  const otherManualTargets = auditIssues.filter(
    (issue) =>
      !issue.canAutoFixBy1C &&
      issue.inlineTarget &&
      !(
        issue.inlineTarget.kind === 'operation_field' &&
        (issue.inlineTarget.field === 'counterpartyName' ||
          issue.inlineTarget.field === 'counterpartyInn' ||
          issue.inlineTarget.field === 'counterpartyKpp')
      )
  );

  const totalManualBlockCount =
    missingCounterpartyNameIssues.length +
    newCounterpartiesNeedingRequisites.reduce(
      (acc, cp) => acc + (cp.needsInn ? 1 : 0) + (cp.needsKpp ? 1 : 0),
      0
    ) +
    otherManualTargets.length;

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

      {/* Manual Requisites Block — Local Drafts + 1C Combobox + Delete/Reset */}
      {totalManualBlockCount > 0 && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418]">
          <div className="px-4 py-3 rounded-t border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Реквизиты новых элементов для ручного дозаполнения ({totalManualBlockCount})
            </h3>
            <p className="text-xs text-zinc-500">
              Выберите существующий элемент из справочников 1С («Контрагенты» / «ФизическиеЛица») или введите реквизит и нажмите «Применить» (либо клавишу Enter).
            </p>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* A. Operations missing counterparty name — with live 1C Combobox */}
            {missingCounterpartyNameIssues.map((issue) => {
              const target = issue.inlineTarget!;
              const draftKey = `cp-name:${target.operationId}`;
              const draftVal =
                draftValues[draftKey] !== undefined
                  ? draftValues[draftKey]
                  : target.currentValue;
              const errorMsg = fieldErrors[draftKey];

              return (
                <CounterpartyComboboxDraftRow
                  key={issue.id}
                  label={target.label}
                  description={issue.description}
                  placeholder={target.placeholder}
                  value={draftVal}
                  errorMsg={errorMsg}
                  directoryOptions1C={directoryOptions1C}
                  onChangeDraft={(val) => setDraft(draftKey, val)}
                  onCommitManual={() => commitTargetValue(draftKey, target, target.currentValue)}
                  onSelect1CItem={(opt) => {
                    bindOperationTo1CDirectoryItem(target.operationId, opt);
                    clearDraftKeys([draftKey]);
                  }}
                />
              );
            })}

            {/* B. Dynamically derived new counterparties (absent in 1C) needing INN / KPP */}
            {newCounterpartiesNeedingRequisites.map((cp) => {
              const innDraftKey = `new-cp-inn:${cp.key}`;
              const kppDraftKey = `new-cp-kpp:${cp.key}`;
              const innDraft =
                draftValues[innDraftKey] !== undefined
                  ? draftValues[innDraftKey]
                  : cp.currentInn;
              const kppDraft =
                draftValues[kppDraftKey] !== undefined
                  ? draftValues[kppDraftKey]
                  : cp.currentKpp;

              const innTarget: InlineFieldTarget = {
                kind: 'operation_field',
                operationId: cp.primaryOperationId,
                field: 'counterpartyInn',
                label: `ИНН контрагента: ${cp.name}`,
                placeholder: '10 или 12 цифр ИНН',
                currentValue: cp.currentInn,
              };

              const kppTarget: InlineFieldTarget = {
                kind: 'operation_field',
                operationId: cp.primaryOperationId,
                field: 'counterpartyKpp',
                label: `КПП контрагента: ${cp.name}`,
                placeholder: '9 цифр КПП',
                currentValue: cp.currentKpp,
              };

              const innDigitsLen = innDraft.replace(/\D/g, '').length;
              const isInnReady = innDigitsLen === 10 || innDigitsLen === 12;
              const kppDigitsLen = kppDraft.replace(/\D/g, '').length;
              const isKppReady = kppDigitsLen === 9;

              return (
                <React.Fragment key={cp.key}>
                  {cp.needsInn && (
                    <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            ИНН контрагента: {cp.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                            Операций: {cp.operationIds.length}
                          </span>
                        </div>
                        <div className="text-zinc-500">
                          Новый контрагент отсутствует в справочнике 1С. Введите 10 или 12 цифр ИНН и нажмите «Применить» (или Enter).
                        </div>
                        {fieldErrors[innDraftKey] && (
                          <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            {fieldErrors[innDraftKey]}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`ИНН контрагента: ${cp.name}`}
                          value={innDraft}
                          onChange={(e) =>
                            setDraft(innDraftKey, e.target.value.replace(/[^\d\s-]/g, ''))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitTargetValue(innDraftKey, innTarget, cp.currentInn);
                            }
                          }}
                          placeholder="10 или 12 цифр ИНН"
                          className="w-48 sm:w-52 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />

                        <button
                          type="button"
                          disabled={!isInnReady}
                          onClick={() =>
                            commitTargetValue(innDraftKey, innTarget, cp.currentInn)
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Применить
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            clearDraftKeys([innDraftKey, kppDraftKey]);
                            resetNewCounterparty(cp.name);
                          }}
                          title="Удалить ошибочно созданного контрагента и очистить привязку в затронутых операциях"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:border-red-300 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30 text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 text-xs transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Сбросить
                        </button>
                      </div>
                    </div>
                  )}

                  {cp.needsKpp && (
                    <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          КПП контрагента: {cp.name}
                        </div>
                        <div className="text-zinc-500">
                          Для юридического лица (ИНН {cp.currentInn}) укажите 9 цифр КПП и нажмите «Применить».
                        </div>
                        {fieldErrors[kppDraftKey] && (
                          <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            {fieldErrors[kppDraftKey]}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`КПП контрагента: ${cp.name}`}
                          value={kppDraft}
                          onChange={(e) =>
                            setDraft(kppDraftKey, e.target.value.replace(/[^\d\s-]/g, ''))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitTargetValue(kppDraftKey, kppTarget, cp.currentKpp);
                            }
                          }}
                          placeholder="9 цифр КПП"
                          className="w-48 sm:w-52 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />

                        <button
                          type="button"
                          disabled={!isKppReady}
                          onClick={() =>
                            commitTargetValue(kppDraftKey, kppTarget, cp.currentKpp)
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Применить
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            clearDraftKeys([innDraftKey, kppDraftKey]);
                            resetNewCounterparty(cp.name);
                          }}
                          title="Удалить ошибочно созданного контрагента и очистить привязку в затронутых операциях"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:border-red-300 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30 text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 text-xs transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Сбросить
                        </button>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* C. Other manual requisite fields (e.g. missing debit/credit account code) */}
            {otherManualTargets.map((issue) => {
              const target = issue.inlineTarget!;
              const draftKey = `other:${issue.id}`;
              const draftVal =
                draftValues[draftKey] !== undefined
                  ? draftValues[draftKey]
                  : target.currentValue;

              return (
                <div
                  key={issue.id}
                  className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {target.label}
                    </div>
                    <div className="text-zinc-500">{issue.description}</div>
                    {fieldErrors[draftKey] && (
                      <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
                        {fieldErrors[draftKey]}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      aria-label={target.label}
                      value={draftVal}
                      onChange={(e) => setDraft(draftKey, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitTargetValue(draftKey, target, target.currentValue);
                        }
                      }}
                      placeholder={target.placeholder}
                      className="w-52 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      disabled={draftVal.trim().length < 2}
                      onClick={() =>
                        commitTargetValue(draftKey, target, target.currentValue)
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Применить
                    </button>
                  </div>
                </div>
              );
            })}
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
            {auditIssues.map((issue) => {
              const diagKey = `diag:${issue.id}`;
              const diagTarget = issue.inlineTarget;
              const diagVal =
                diagTarget && draftValues[diagKey] !== undefined
                  ? draftValues[diagKey]
                  : diagTarget?.currentValue ?? '';

              return (
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
                      {fieldErrors[diagKey] && (
                        <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                          {fieldErrors[diagKey]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 pl-6 md:pl-0">
                    {diagTarget && issue.canAutoFixBy1C && (
                      <>
                        <input
                          type="text"
                          aria-label={diagTarget.label}
                          value={diagVal}
                          onChange={(e) => setDraft(diagKey, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitTargetValue(diagKey, diagTarget, diagTarget.currentValue);
                            }
                          }}
                          placeholder={diagTarget.placeholder}
                          className="w-44 px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:border-amber-600"
                        />
                        <button
                          type="button"
                          disabled={diagVal.trim().length < 2}
                          onClick={() =>
                            commitTargetValue(diagKey, diagTarget, diagTarget.currentValue)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 disabled:opacity-40 text-xs font-medium"
                        >
                          Сохранить
                        </button>
                      </>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CounterpartyComboboxDraftRow({
  label,
  description,
  placeholder,
  value,
  errorMsg,
  directoryOptions1C,
  onChangeDraft,
  onCommitManual,
  onSelect1CItem,
}: {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  errorMsg?: string;
  directoryOptions1C: DirectoryAutocompleteOption1C[];
  onChangeDraft: (val: string) => void;
  onCommitManual: () => void;
  onSelect1CItem: (opt: DirectoryAutocompleteOption1C) => void;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredOptions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) {
      return directoryOptions1C.slice(0, 12);
    }
    return directoryOptions1C
      .filter(
        (opt) =>
          opt.name.toLowerCase().includes(q) ||
          (opt.fullName && opt.fullName.toLowerCase().includes(q)) ||
          (opt.inn && opt.inn.includes(q)) ||
          (opt.code1C && opt.code1C.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [directoryOptions1C, value]);

  const canSave = value.trim().length >= 2;

  return (
    <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
      <div className="space-y-0.5 min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">{label}</div>
        <div className="text-zinc-500">{description}</div>
        {errorMsg && (
          <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
        <div className="relative w-64 sm:w-72">
          <input
            type="text"
            role="combobox"
            aria-controls={listboxId}
            aria-expanded={open && filteredOptions.length > 0}
            aria-autocomplete="list"
            aria-label={label}
            value={value}
            onFocus={() => {
              if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
              setOpen(true);
            }}
            onBlur={() => {
              blurTimerRef.current = setTimeout(() => setOpen(false), 160);
            }}
            onChange={(e) => {
              onChangeDraft(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setOpen(false);
                onCommitManual();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="w-full pl-3 pr-7 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
          />

          {directoryOptions1C.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Открыть список контрагентов и физлиц из базы 1С"
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen((prev) => !prev);
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}

          {open && filteredOptions.length > 0 && (
            <div
              id={listboxId}
              role="listbox"
              className="absolute left-0 right-0 mt-1 z-30 max-h-56 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg divide-y divide-zinc-100 dark:divide-zinc-800"
            >
              {filteredOptions.map((opt) => (
                <button
                  key={`${opt.source}:${opt.id}`}
                  type="button"
                  role="option"
                  aria-selected={opt.name === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    onSelect1CItem(opt);
                  }}
                  className="w-full px-2.5 py-2 text-left hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-start justify-between gap-2 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {opt.name}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">
                      {opt.inn
                        ? `ИНН ${opt.inn}${opt.kpp ? ` · КПП ${opt.kpp}` : ''}`
                        : opt.code1C
                          ? `Код 1С: ${opt.code1C}`
                          : 'Без ИНН в карточке 1С'}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      opt.source === 'ФизическиеЛица'
                        ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    }`}
                  >
                    {opt.source === 'ФизическиеЛица' ? (
                      <>
                        <User className="w-2.5 h-2.5" />
                        Физлица 1С
                      </>
                    ) : (
                      <>
                        <Building2 className="w-2.5 h-2.5" />
                        Контрагенты 1С
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={!canSave}
          onClick={onCommitManual}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          Применить
        </button>
      </div>
    </div>
  );
}
