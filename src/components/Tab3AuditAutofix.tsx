'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Landmark,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Wand2,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { validateRussianInnChecksum } from '@/lib/egrul/egrulLookup';
import {
  DirectoryAutocompleteOption1C,
  InlineFieldTarget,
} from '@/types/accounting';
import { parseRussianNumber } from '@/lib/import1c';

export function Tab3AuditAutofix() {
  const {
    auditIssues,
    osvReport,
    directoryOptions1C,
    pendingNewCounterparties,
    accompanyingActions,
    autoFixLogs,
    autoFixChanges,
    isLookingUpEgrul,
    operations,
    db1C,
    reportingYear,
    runSmartAutoFixAll,
    runClosingAndOffsetsOnly,
    lookupCounterpartiesInEgrul,
    fillAllCounterpartiesAutomatically,
    fillEducationalRequisitesForUnverified,
    selectEgrulCandidateForCounterparty,
    applyInlineAuditValue,
    bindOperationTo1CDirectoryItem,
    resetNewCounterparty,
    jumpToOperation,
    setActiveTab,
  } = useAccountant();

  // Local draft values & validation messages — NEVER mutate global state on onChange
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const innCenterRef = useRef<HTMLDivElement | null>(null);

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

    if (target.kind === 'operation_field' && target.field === 'amount') {
      const amt = parseRussianNumber(raw);
      if (!Number.isFinite(amt) || amt <= 0) {
        setFieldErrors((prev) => ({
          ...prev,
          [draftKey]: 'Введите положительную сумму операции в рублях.',
        }));
        return;
      }
    }

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

  // 1. Operations missing counterparty name
  const missingCounterpartyNameIssues = auditIssues.filter(
    (issue) =>
      !issue.canAutoFixBy1C &&
      issue.inlineTarget?.kind === 'operation_field' &&
      issue.inlineTarget.field === 'counterpartyName'
  );

  // 2. Dynamically computed new counterparties (absent in 1C) requiring INN or KPP
  const newCounterpartiesNeedingRequisites = pendingNewCounterparties.filter(
    (cp) => cp.needsInn || cp.needsKpp
  );

  // 3. Other manual inline targets
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

  // 6-Step Coursework Readiness Checklist computation
  const checklistSteps = useMemo(() => {
    const activeImportedOps = operations.filter(
      (o) => o.includeInProcessing && !o.autoGeneratedKind
    );
    const hasStep1DbOrData = Boolean(db1C) || activeImportedOps.length > 0;
    const hasStep2Ops = activeImportedOps.length > 0;
    const hasStep3Inns =
      hasStep2Ops &&
      missingCounterpartyNameIssues.length === 0 &&
      newCounterpartiesNeedingRequisites.length === 0;

    const payrollNeedsFot = operations.find(
      (o) =>
        o.includeInProcessing &&
        (o.category === 'payroll_accrual' || o.docType1C === 'НачислениеЗарплаты') &&
        o.readinessStatus === 'needs_clarification'
    );
    const hasOs01 = osvReport.leafRows.some(
      (r) => (r.code === '01.01' || r.code === '01') && r.endDebit > 0.01
    );
    const hasDepr02 = osvReport.leafRows.some(
      (r) => (r.code === '02.01' || r.code === '02') && r.endCredit > 0.01
    );
    const hasStep4PayrollAndDepr =
      hasStep2Ops && !payrollNeedsFot && (!hasOs01 || hasDepr02);

    const hasUnclosedOrAdvance = auditIssues.some(
      (i) => i.category === 'unclosed_period' || i.category === 'unoffset_advance'
    );
    const hasStep5Closing = hasStep2Ops && !hasUnclosedOrAdvance;

    const hasRedLeaf = osvReport.leafRows.some((r) => r.hasRedEnd);
    const hasStep6BalancedOsv =
      (Boolean(db1C) || hasStep2Ops) &&
      osvReport.totals.isTurnoverBalanced &&
      osvReport.totals.isEndBalanced &&
      !hasRedLeaf &&
      errorCount === 0;

    return [
      {
        num: 1,
        title: 'База 1С или начальные данные',
        detail: db1C
          ? `Подключена ${db1C.organization.name || 'база 1С'}`
          : hasStep2Ops
            ? 'Учёт с нуля по загруженным файлам'
            : 'Загрузите JSON 1С или файлы задания',
        done: hasStep1DbOrData,
        onClick: () => setActiveTab('db_osv'),
      },
      {
        num: 2,
        title: 'Импорт всех операций задания',
        detail: hasStep2Ops
          ? `В очереди операций: ${activeImportedOps.length}`
          : 'Загрузите Excel-файлы с операциями',
        done: hasStep2Ops,
        onClick: () => setActiveTab('import_postings'),
      },
      {
        num: 3,
        title: 'ИНН и КПП всех контрагентов',
        detail: hasStep3Inns
          ? 'Все контрагенты заполнены и проверены'
          : `Требуют ИНН/КПП: ${newCounterpartiesNeedingRequisites.length + missingCounterpartyNameIssues.length}`,
        done: hasStep3Inns,
        onClick: () => {
          innCenterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },
      },
      {
        num: 4,
        title: 'Зарплата, взносы и амортизация ОС',
        detail: payrollNeedsFot
          ? 'Уточните штатный ФОТ в Начислении ЗП'
          : hasOs01 && !hasDepr02
            ? 'Требуется начислить амортизацию 02.01'
            : hasStep2Ops
              ? 'Расчёты ФОТ и ОС проверены'
              : 'Ожидает операций',
        done: hasStep4PayrollAndDepr,
        onClick: () => {
          if (payrollNeedsFot) {
            jumpToOperation(payrollNeedsFot.id);
          } else {
            setActiveTab('import_postings');
          }
        },
      },
      {
        num: 5,
        title: 'Зачёт авансов и закрытие месяца',
        detail: hasStep5Closing
          ? 'Счета 20, 26, 44, 90, 91 и авансы закрыты'
          : 'Нажмите «Зачёт авансов + Закрытие месяца»',
        done: hasStep5Closing,
        onClick: () => {
          if (hasStep2Ops && !hasStep5Closing) {
            runClosingAndOffsetsOnly();
          }
        },
      },
      {
        num: 6,
        title: 'ОСВ сходится без красноты (Σ Дт = Σ Кт)',
        detail: hasStep6BalancedOsv
          ? 'Готово к выгрузке в 1С:БП 3.0'
          : hasRedLeaf
            ? 'Есть отрицательное сальдо (краснота) в ОСВ'
            : `Замечаний к проверке: ${errorCount}`,
        done: hasStep6BalancedOsv,
        onClick: () => setActiveTab(hasStep6BalancedOsv ? 'export_1c' : 'db_osv'),
      },
    ];
  }, [
    db1C,
    operations,
    missingCounterpartyNameIssues.length,
    newCounterpartiesNeedingRequisites.length,
    osvReport,
    auditIssues,
    errorCount,
    setActiveTab,
    jumpToOperation,
    runClosingAndOffsetsOnly,
  ]);

  const completedStepsCount = checklistSteps.filter((s) => s.done).length;

  return (
    <div className="space-y-4">
      {/* 6-Step Coursework / Lab Readiness Checklist */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Чек-лист готовности лабораторной / курсовой работы по 1С:Бухгалтерия 8.3
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Нажмите на любой шаг для быстрого перехода или автоматического выполнения регламентной процедуры
            </p>
          </div>
          <span className="font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Выполнено шагов: {completedStepsCount} из 6
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {checklistSteps.map((step) => (
            <button
              key={step.num}
              type="button"
              onClick={step.onClick}
              className="text-left p-3 rounded border border-zinc-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-700 bg-zinc-50/50 dark:bg-zinc-900/30 hover:bg-zinc-50 dark:hover:bg-zinc-900/70 transition-colors flex items-start gap-2.5"
            >
              {step.done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  0{step.num}. {step.title}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {step.detail}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Primary Action Panel */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-950 dark:text-white">
              Экспертный аудит главбуха, автоисправление и закрытие периода ({reportingYear} г.)
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-3xl">
              Проверяет двойную запись, хронологию счетов (60, 62, 68, 69, 70), вычеты НДС (19 → 68.02), линейную амортизацию (02.01), закрытие затратных счетов (20, 26, 44 → 90 → 99) и налог на прибыль 20% (68.04.1).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={runSmartAutoFixAll}
              disabled={isLookingUpEgrul}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors"
            >
              {isLookingUpEgrul ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Исправить всё автоматически
              {autoFixableCount > 0 && (
                <span className="font-mono tabular-nums text-xs opacity-90">
                  ({autoFixableCount})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={runClosingAndOffsetsOnly}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap"
            >
              <Calculator className="w-4 h-4 text-zinc-500" />
              Зачёт авансов + Закрытие месяца
            </button>
          </div>
        </div>

        {/* Status Metrics */}
        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
            <div className="text-zinc-500 dark:text-zinc-400">Критические ошибки</div>
            <div
              className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                errorCount > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {errorCount}
            </div>
          </div>

          <div className="p-3 rounded border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
            <div className="text-zinc-500 dark:text-zinc-400">Предупреждения и уточнения</div>
            <div
              className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                warningCount > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {warningCount}
            </div>
          </div>

          <div className="p-3 rounded border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
            <div className="text-zinc-500 dark:text-zinc-400">Новых контрагентов без ИНН</div>
            <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-zinc-900 dark:text-white">
              {newCounterpartiesNeedingRequisites.length}
            </div>
          </div>

          <div className="p-3 rounded border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex flex-col justify-between">
            <div className="text-zinc-500 dark:text-zinc-400">Выгрузка в 1С:БП 3.0</div>
            <button
              type="button"
              onClick={() => setActiveTab('export_1c')}
              className="mt-1 inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
            >
              Перейти к экспорту (.bsl / .xml)
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* One-Click INN/KPP Center & Manual Requisites Block */}
      <div
        ref={innCenterRef}
        className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418]"
      >
        <div className="px-4 py-3.5 rounded-t border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Центр заполнения ИНН/КПП контрагентов и обязательных реквизитов ({totalManualBlockCount})
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Реальные компании сверяются с ЕГРЮЛ ФНС; для вымышленных компаний из методички («ООО Конкурент», «ООО Ромашка») можно в 1 клик подставить учебные валидные ИНН/КПП с контрольной суммой ФНС РФ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isLookingUpEgrul || operations.length === 0}
              onClick={() => void fillAllCounterpartiesAutomatically()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-sky-300 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 hover:bg-sky-100/80 dark:hover:bg-sky-950/60 text-xs font-medium text-sky-900 dark:text-sky-200 disabled:opacity-50 whitespace-nowrap transition-colors"
            >
              {isLookingUpEgrul ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              Заполнить по БД 1С + ЕГРЮЛ ФНС
            </button>

            <button
              type="button"
              disabled={newCounterpartiesNeedingRequisites.length === 0}
              onClick={() => fillEducationalRequisitesForUnverified()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950 text-xs font-medium disabled:opacity-45 whitespace-nowrap transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600" />
              Подставить учебные валидные ИНН/КПП (ФНС checksum)
            </button>
          </div>
        </div>

        {totalManualBlockCount === 0 ? (
          <div className="px-4 py-6 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Все обязательные реквизиты, ИНН и КПП контрагентов заполнены и прошли проверку формата ФНС.
            </span>
          </div>
        ) : (
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

            {/* B. Dynamically derived new counterparties needing INN / KPP */}
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

              const innDigits = innDraft.replace(/\D/g, '');
              const isInnReady = innDigits.length === 10 || innDigits.length === 12;
              const liveChecksum = isInnReady
                ? validateRussianInnChecksum(innDigits)
                : null;
              const kppDigitsLen = kppDraft.replace(/\D/g, '').length;
              const isKppReady = kppDigitsLen === 9;

              return (
                <React.Fragment key={cp.key}>
                  {cp.needsInn && (
                    <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            ИНН контрагента: {cp.name}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500">
                            · операций: {cp.operationIds.length}
                          </span>
                          {cp.source === 'educational_unverified' && (
                            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              · Учебный контрагент (не найден в ЕГРЮЛ)
                            </span>
                          )}
                          {cp.source === 'educational_generated' && (
                            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                              · Учебные реквизиты (ФНС checksum OK)
                            </span>
                          )}
                          {cp.source === 'egrul_verified' && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400">
                              · <ShieldCheck className="w-3 h-3" /> Проверено ЕГРЮЛ
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-500">
                          Нажмите «ЕГРЮЛ» для поиска реального ИНН, «Учебный ИНН» для валидного учебного реквизита (регион 78) или введите ИНН вручную и нажмите «Применить» / Enter.
                        </div>

                        {liveChecksum && (
                          <div
                            className={`text-[11px] font-mono ${
                              liveChecksum.valid
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {liveChecksum.valid
                              ? `Контрольная цифра ФНС для ${liveChecksum.cleanInn} корректна`
                              : liveChecksum.reason}
                          </div>
                        )}

                        {cp.egrulCandidates.length > 1 && (
                          <div className="pt-0.5">
                            <select
                              aria-label={`Выбор подразделения ЕГРЮЛ для ${cp.name}`}
                              onChange={(e) => {
                                const found = cp.egrulCandidates.find(
                                  (c) => `${c.inn}:${c.kpp}` === e.target.value
                                );
                                if (found) {
                                  selectEgrulCandidateForCounterparty(cp.key, found);
                                }
                              }}
                              className="px-2 py-1 rounded border border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 font-mono text-[11px]"
                            >
                              {cp.egrulCandidates.map((cand, idx) => (
                                <option
                                  key={`${cand.inn}-${cand.kpp}-${idx}`}
                                  value={`${cand.inn}:${cand.kpp}`}
                                >
                                  {cand.name} — ИНН {cand.inn}
                                  {cand.kpp ? ` / КПП ${cand.kpp}` : ''} ({cand.region || 'РФ'})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {fieldErrors[innDraftKey] && (
                          <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            {fieldErrors[innDraftKey]}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        {cp.kind !== 'ФизическоеЛицо' && (
                          <button
                            type="button"
                            disabled={isLookingUpEgrul}
                            onClick={() => void lookupCounterpartiesInEgrul(cp.key)}
                            title="Найти реальные ИНН и КПП в официальном реестре ЕГРЮЛ ФНС"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-sky-300 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-950/60 text-sky-800 dark:text-sky-300 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                          >
                            {isLookingUpEgrul ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Search className="w-3.5 h-3.5" />
                            )}
                            ЕГРЮЛ
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            clearDraftKeys([innDraftKey, kppDraftKey]);
                            fillEducationalRequisitesForUnverified(cp.key);
                          }}
                          title="Подставить валидный учебный ИНН/КПП региона 78 с проверкой контрольной суммы ФНС"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-medium whitespace-nowrap"
                        >
                          <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                          Учебный ИНН
                        </button>

                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`ИНН контрагента: ${cp.name}`}
                          value={innDraft}
                          onChange={(e) =>
                            setDraft(innDraftKey, e.target.value.replace(/[^\d\s-]/g, ''))
                          }
                          onBlur={() => {
                            if (isInnReady && draftValues[innDraftKey] !== undefined) {
                              commitTargetValue(innDraftKey, innTarget, cp.currentInn);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitTargetValue(innDraftKey, innTarget, cp.currentInn);
                            }
                          }}
                          placeholder="10 или 12 цифр ИНН"
                          className="w-40 sm:w-44 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />

                        <button
                          type="button"
                          disabled={!isInnReady}
                          onClick={() =>
                            commitTargetValue(innDraftKey, innTarget, cp.currentInn)
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs whitespace-nowrap transition-colors"
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
                          title="Сбросить контрагента в затронутых операциях"
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:border-red-300 dark:hover:border-red-800 text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 text-xs whitespace-nowrap transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {cp.needsKpp && (
                    <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          КПП контрагента: {cp.name}
                        </div>
                        <div className="text-zinc-500">
                          Для юридического лица (ИНН {cp.currentInn}) укажите 9 цифр КПП или нажмите «Учебный ИНН/КПП».
                        </div>
                        {fieldErrors[kppDraftKey] && (
                          <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            {fieldErrors[kppDraftKey]}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            clearDraftKeys([innDraftKey, kppDraftKey]);
                            fillEducationalRequisitesForUnverified(cp.key);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 text-xs font-medium whitespace-nowrap"
                        >
                          <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                          Учебный КПП
                        </button>

                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`КПП контрагента: ${cp.name}`}
                          value={kppDraft}
                          onChange={(e) =>
                            setDraft(kppDraftKey, e.target.value.replace(/[^\d\s-]/g, ''))
                          }
                          onBlur={() => {
                            if (isKppReady && draftValues[kppDraftKey] !== undefined) {
                              commitTargetValue(kppDraftKey, kppTarget, cp.currentKpp);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitTargetValue(kppDraftKey, kppTarget, cp.currentKpp);
                            }
                          }}
                          placeholder="9 цифр КПП"
                          className="w-40 sm:w-44 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />

                        <button
                          type="button"
                          disabled={!isKppReady}
                          onClick={() =>
                            commitTargetValue(kppDraftKey, kppTarget, cp.currentKpp)
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs whitespace-nowrap transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Применить
                        </button>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* C. Other manual requisite fields */}
            {otherManualTargets.map((issue) => {
              const target = issue.inlineTarget!;
              const draftKey = `other:${issue.id}`;
              const draftVal =
                draftValues[draftKey] !== undefined
                  ? draftValues[draftKey]
                  : target.currentValue;
              const isAmountField =
                target.kind === 'operation_field' && target.field === 'amount';
              const canCommitOther = isAmountField
                ? parseRussianNumber(draftVal) > 0
                : draftVal.trim().length >= 2;

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
                      inputMode={isAmountField ? 'decimal' : 'text'}
                      aria-label={target.label}
                      value={draftVal}
                      onChange={(e) => setDraft(draftKey, e.target.value)}
                      onBlur={() => {
                        if (canCommitOther && draftValues[draftKey] !== undefined) {
                          commitTargetValue(draftKey, target, target.currentValue);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitTargetValue(draftKey, target, target.currentValue);
                        }
                      }}
                      placeholder={target.placeholder}
                      className="w-48 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      disabled={!canCommitOther}
                      onClick={() =>
                        commitTargetValue(draftKey, target, target.currentValue)
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs whitespace-nowrap transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Применить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Structured Auto-Fix Audit Trail */}
      {(autoFixChanges.length > 0 || autoFixLogs.length > 0) && (
        <div className="rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-emerald-200/80 dark:border-emerald-900/50 flex items-center justify-between gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>
                Протокол автоматических исправлений (Что было → Что стало → Основание):{' '}
                {autoFixChanges.length || autoFixLogs.length}
              </span>
            </div>
          </div>

          {autoFixChanges.length > 0 ? (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-emerald-100/60 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-b border-emerald-200/70 dark:border-emerald-900/50">
                  <tr>
                    <th className="py-2 px-3 text-left font-semibold w-1/4">Что было</th>
                    <th className="py-2 px-3 text-left font-semibold w-1/3">Что стало</th>
                    <th className="py-2 px-3 text-left font-semibold">Основание (1С / РСБУ / ФНС)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-200/50 dark:divide-emerald-900/40 bg-white/70 dark:bg-zinc-950/40">
                  {autoFixChanges.map((rec) => (
                    <tr key={rec.id}>
                      <td className="py-2 px-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                        {rec.whatWas}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                        {rec.whatBecame}
                      </td>
                      <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300">
                        {rec.basis}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="p-4 space-y-1 text-xs text-emerald-900/90 dark:text-emerald-200/90 pl-8 list-disc">
              {autoFixLogs.map((entry, idx) => (
                <li key={idx}>{entry}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Accompanying 1C BP 3.0 Actions Summary */}
      {accompanyingActions.length > 0 && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
              <Landmark className="w-4 h-4 text-amber-600" />
              <span>
                Сопутствующие объекты и регламентные операции для 1С:Бухгалтерия 8.3 ({accompanyingActions.length})
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">
              Формируются автоматически при выгрузке в .bsl / .xml
            </span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-60 overflow-y-auto">
            {accompanyingActions.map((act) => (
              <div
                key={act.id}
                className="px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {act.title}
                    </span>
                    {act.bik && (
                      <span className="font-mono text-[11px] text-amber-800 dark:text-amber-300">
                        · БИК {act.bik}
                      </span>
                    )}
                    {act.accountNumber && (
                      <span className="font-mono text-[11px] text-zinc-500">
                        · р/с {act.accountNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">{act.details}</div>
                </div>
                <div className="text-[11px] font-mono text-zinc-500 shrink-0">
                  {act.menuPath1C}
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
            Результаты экспертного аудита ОСВ и пошаговые инструкции 1С:БП 3.0
          </h3>
          <span className="text-xs text-zinc-500 font-mono tabular-nums">
            Замечаний: {auditIssues.length}
          </span>
        </div>

        {auditIssues.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              Ошибок и расхождений не обнаружено
            </div>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              {db1C || operations.length > 0
                ? 'Двойная запись соблюдена, краснота по счетам отсутствует, обязательные реквизиты, зарплата, амортизация и закрывающие операции проверены. Данные готовы к выгрузке в 1С 8.3.'
                : 'Загрузите базу 1С или файлы с операциями для запуска комплексной бухгалтерской проверки.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
            {auditIssues.map((issue) => {
              const diagKey = `diag:${issue.id}`;
              const diagTarget = issue.inlineTarget;
              const diagVal =
                diagTarget && draftValues[diagKey] !== undefined
                  ? draftValues[diagKey]
                  : diagTarget?.currentValue ?? '';
              const isAmountTarget =
                diagTarget?.kind === 'operation_field' && diagTarget.field === 'amount';
              const canSaveDiag = isAmountTarget
                ? parseRussianNumber(diagVal) > 0
                : diagVal.trim().length >= 2;

              return (
                <div
                  key={issue.id}
                  className="p-4 space-y-3 text-xs hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                            {issue.title}
                          </span>
                          {issue.accountCode && (
                            <span className="font-mono text-[11px] text-zinc-500">
                              · Счёт {issue.accountCode}
                            </span>
                          )}
                          {issue.canAutoFixBy1C && (
                            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              · Доступно автоисправление
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-700 dark:text-zinc-300">{issue.description}</p>
                        {issue.accountingReason && (
                          <p className="text-zinc-500 dark:text-zinc-400">
                            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                              Бухгалтерская причина:{' '}
                            </strong>
                            {issue.accountingReason}
                          </p>
                        )}
                        {fieldErrors[diagKey] && (
                          <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            {fieldErrors[diagKey]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0 pl-6 lg:pl-0">
                      {diagTarget && (
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
                            disabled={!canSaveDiag}
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
                          onClick={() => jumpToOperation(issue.operationId!)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 whitespace-nowrap"
                        >
                          К операции
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {issue.guide1C && (
                    <div className="ml-6 rounded border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/50 p-3 space-y-1.5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2 font-semibold text-zinc-800 dark:text-zinc-200">
                        <BookOpenCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>Как исправить в 1С:Бухгалтерия 8.3:</span>
                        <span className="font-mono font-normal text-zinc-600 dark:text-zinc-300">
                          {issue.guide1C.menuPath} · {issue.guide1C.documentKind}
                        </span>
                      </div>
                      <ul className="pl-5 list-disc space-y-0.5 text-zinc-600 dark:text-zinc-400">
                        {issue.guide1C.checkPoints.map((pt, idx) => (
                          <li key={idx}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}
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
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
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
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-medium text-xs whitespace-nowrap transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          Применить
        </button>
      </div>
    </div>
  );
}
