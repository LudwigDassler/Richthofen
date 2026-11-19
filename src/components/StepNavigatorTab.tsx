'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  RefreshCw,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { getAccountInfo } from '@/data/chartOfAccounts';
import {
  BusinessOperation,
  DocumentTableRowGuide,
  Operation1CSyncStatus,
} from '@/types/accounting';

function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ₽'
  );
}

function buildFallbackPlainExplanation(op: BusinessOperation): string {
  if (op.postings.length === 0) {
    return 'Документ «Прием на работу» относится к кадровому учету: он регистрирует сотрудника, подразделение и месячный оклад, а бухгалтерские проводки по зарплате, НДФЛ и взносам программа 1С сформирует в конце месяца документом «Начисление зарплаты».';
  }

  const lines = op.postings.map((p) => {
    const dt = getAccountInfo(p.debitAccount);
    const kt = getAccountInfo(p.creditAccount);
    return `Дт ${p.debitAccount} (${dt.name}) — Кт ${p.creditAccount} (${kt.name}) на сумму ${formatRub(p.amount)}: ${p.comment}`;
  });

  return lines.join(' ');
}

export function StepNavigatorTab() {
  const {
    operations,
    activeOperation,
    setActiveOperationId,
    toggleOperationDone,
    setActiveTab,
    effectiveOrganization,
    synced1C,
    refreshFrom1CSync,
    resetToDefaultDemo,
  } = useAccountant();

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const q2Operations = useMemo(
    () => operations.filter((op) => !op.isMonthEndClosing),
    [operations]
  );

  const handleCopy = (key: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  if (!activeOperation) {
    return (
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Выберите хозяйственную операцию в списке слева.
        </p>
        <button
          type="button"
          onClick={resetToDefaultDemo}
          className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Восстановить задание
        </button>
      </div>
    );
  }

  const navList = activeOperation.isMonthEndClosing ? operations : q2Operations;
  const currentIndex = navList.findIndex((op) => op.id === activeOperation.id);
  const prevOp = currentIndex > 0 ? navList[currentIndex - 1] : null;
  const nextOp =
    currentIndex >= 0 && currentIndex < navList.length - 1
      ? navList[currentIndex + 1]
      : null;

  const substituteStudentText = (raw: string): string => {
    const student = effectiveOrganization.studentName.trim();
    if (!student) return raw;
    return raw.replace(/\(?\s*ФИО\s+студента\s*\)?/gi, student);
  };

  const match1C = activeOperation.match1C;
  const syncStatus: Operation1CSyncStatus =
    match1C?.syncStatus ??
    (activeOperation.status === 'done'
      ? 'done_in_1c'
      : activeOperation.status === 'needs_data'
        ? 'needs_fix_in_1c'
        : 'missing_in_1c');

  const matchedDocs = match1C?.matchedDocs ?? [];
  const matchedPostings = match1C?.matchedPostings ?? [];
  const issues = match1C?.issues ?? [];
  const missingCounterpartyFields = match1C?.missingCounterpartyFields ?? [];
  const tableRowsGuide: DocumentTableRowGuide[] = match1C?.tableRowsGuide ?? [];
  const plainExplanation =
    match1C?.plainExplanation?.trim() ||
    buildFallbackPlainExplanation(activeOperation);

  // Full breadcrumb route in 1C 8.3 (including Создать -> Вид операции when distinct)
  const fullMenuBreadcrumb = useMemo(() => {
    const steps = [...activeOperation.menuPath1C];
    const last = steps[steps.length - 1] || '';
    const opKind = activeOperation.operationKind1C?.trim();
    if (
      opKind &&
      !last.toLowerCase().includes(opKind.toLowerCase().slice(0, 12))
    ) {
      steps.push('Создать', opKind);
    }
    return steps;
  }, [activeOperation.menuPath1C, activeOperation.operationKind1C]);

  return (
    <div className="p-4 sm:p-7 max-w-4xl mx-auto space-y-6">
      {/* OPERATION HEADER */}
      <div className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-mono tabular-nums text-xs font-semibold">
              Операция №{activeOperation.number}
            </span>
            <span className="font-mono tabular-nums text-xs text-zinc-500 dark:text-zinc-400">
              от {activeOperation.date}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!synced1C && (
              <button
                type="button"
                disabled={activeOperation.status === 'needs_data'}
                onClick={() => toggleOperationDone(activeOperation.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  activeOperation.status === 'done'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                    : 'bg-[#FAFAFA] hover:bg-zinc-100 dark:bg-[#09090B] dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 disabled:opacity-40'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {activeOperation.status === 'done'
                    ? 'Отмечено выполненным'
                    : 'Отметить выполненным'}
                </span>
              </button>
            )}

            <div className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 divide-x divide-zinc-200 dark:divide-zinc-800">
              <button
                type="button"
                disabled={!prevOp}
                onClick={() => prevOp && setActiveOperationId(prevOp.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Пред.</span>
              </button>
              <button
                type="button"
                disabled={!nextOp}
                onClick={() => nextOp && setActiveOperationId(nextOp.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
              >
                <span>След.</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
          <p className="text-sm sm:text-base font-medium text-zinc-900 dark:text-zinc-100 leading-relaxed flex-1">
            {substituteStudentText(activeOperation.rawDescription)}
          </p>

          <div className="shrink-0 sm:text-right">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Сумма операции
            </div>
            {activeOperation.resolvedAmount > 0 ? (
              <div className="mt-0.5 inline-flex items-center gap-1.5">
                <span className="font-mono tabular-nums text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatRub(activeOperation.resolvedAmount)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      'hdr-sum',
                      activeOperation.resolvedAmount.toFixed(2).replace('.', ',')
                    )
                  }
                  title="Скопировать сумму"
                  className="p-1 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {copiedKey === 'hdr-sum' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <ClipboardCopy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('database1c')}
                className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
              >
                Укажите остатки на 31.03 →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* БЛОК А. СТАТУС В ВАШЕЙ БАЗЕ 1С */}
      <section className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Блок А. Статус в вашей базе 1С
          </h2>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${
                syncStatus === 'done_in_1c'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : syncStatus === 'needs_fix_in_1c'
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                    : 'bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <span
                className={`w-2 h-2 rounded ${
                  syncStatus === 'done_in_1c'
                    ? 'bg-emerald-500'
                    : syncStatus === 'needs_fix_in_1c'
                      ? 'bg-amber-500'
                      : 'bg-zinc-400'
                }`}
              />
              <span>
                {syncStatus === 'done_in_1c'
                  ? 'Сделано в 1С'
                  : syncStatus === 'needs_fix_in_1c'
                    ? 'Есть в 1С, нужна правка'
                    : 'Нужно создать'}
              </span>
            </span>

            <button
              type="button"
              onClick={() => void refreshFrom1CSync()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Проверить в 1С</span>
            </button>
          </div>
        </div>

        {matchedDocs.length > 0 ? (
          <div className="space-y-3">
            {matchedDocs.map((doc) => (
              <div
                key={doc.id}
                className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {doc.docType}{' '}
                    <span className="font-mono tabular-nums">
                      №{doc.number || 'б/н'} от {doc.date}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                        doc.posted
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                      }`}
                    >
                      {doc.posted ? 'Проведен' : 'Не проведен (черновик)'}
                    </span>
                    <span className="font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatRub(doc.amount)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {doc.operationKind && (
                    <span>
                      Вид операции: <strong className="text-zinc-800 dark:text-zinc-200">{doc.operationKind}</strong>
                    </span>
                  )}
                  {doc.counterparty && (
                    <span>
                      Контрагент: <strong className="text-zinc-800 dark:text-zinc-200">{doc.counterparty}</strong>
                    </span>
                  )}
                  {doc.contract && (
                    <span>
                      Договор: <strong className="font-mono text-zinc-800 dark:text-zinc-200">{doc.contract}</strong>
                    </span>
                  )}
                  {(doc.settlementAccount || doc.advanceAccount) && (
                    <span className="font-mono tabular-nums">
                      Счета: {[doc.settlementAccount, doc.advanceAccount].filter(Boolean).join(' / ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : matchedPostings.length > 0 ? (
          <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 space-y-1">
            <div className="font-medium text-zinc-900 dark:text-zinc-100">
              В базе 1С найдены проводки по этой операции ({matchedPostings.length} шт.):
            </div>
            {matchedPostings.map((mp) => (
              <div key={mp.id} className="font-mono tabular-nums">
                {mp.date}: Дт {mp.debitAccount} — Кт {mp.creditAccount} = {formatRub(mp.amount)}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-600 dark:text-zinc-300">
            В базе 1С этого документа еще нет — создайте его по шагам ниже.
          </div>
        )}

        {/* Issues to fix if 🟠 needs_fix_in_1c */}
        {issues.length > 0 && (
          <div className="p-3.5 rounded-md bg-amber-50/50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800/80 space-y-1.5">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Что нужно поправить в 1С:
            </div>
            <ul className="list-disc pl-4 space-y-1 text-xs text-amber-950 dark:text-amber-200/90 leading-relaxed">
              {issues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* БЛОК Б. КУДА ЗАЙТИ В 1С */}
      <section className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Блок Б. Куда зайти в 1С
        </h2>

        <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-2">
          {fullMenuBreadcrumb.map((step, idx) => {
            const isLast = idx === fullMenuBreadcrumb.length - 1;
            return (
              <React.Fragment key={`${step}-${idx}`}>
                <span
                  className={`text-xs sm:text-sm ${
                    isLast
                      ? 'font-semibold text-zinc-900 dark:text-zinc-100 px-2.5 py-1 rounded bg-white dark:bg-[#111113] border border-zinc-300 dark:border-zinc-700'
                      : 'font-medium text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {step}
                </span>
                {!isLast && (
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Документ в 1С: <strong className="text-zinc-800 dark:text-zinc-200">{activeOperation.documentType1C}</strong>
        </div>
      </section>

      {/* БЛОК В. ЧТО ЗАПОЛНИТЬ В ДОКУМЕНТЕ */}
      <section className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-5 space-y-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Блок В. Что заполнить в документе
        </h2>

        {/* 1) Поля шапки */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            1. Поля шапки документа
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {activeOperation.documentFields.map((field, idx) => {
              const resolvedVal = substituteStudentText(field.value);
              const copyId = `hdr-fld-${activeOperation.id}-${idx}`;
              const isCopied = copiedKey === copyId;

              return (
                <div
                  key={copyId}
                  className="px-3 py-2.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {field.label}
                    </div>
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 mt-0.5 break-words font-mono tabular-nums">
                      {resolvedVal}
                    </div>
                  </div>

                  {field.copyable !== false && (
                    <button
                      type="button"
                      onClick={() => handleCopy(copyId, resolvedVal)}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                        isCopied
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                          : 'bg-white hover:bg-zinc-100 dark:bg-[#111113] dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Скопировано</span>
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="w-3 h-3" />
                          <span>Скопировать</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 2) Компактная подсказка по пустым реквизитам контрагента в 1С */}
        {missingCounterpartyFields.length > 0 && (
          <div className="p-3.5 rounded-md bg-rose-50/40 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-800/80 space-y-2.5">
            <div className="flex items-start gap-2 text-xs font-semibold text-rose-800 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                В карточке контрагента в 1С пустые поля:{' '}
                {missingCounterpartyFields.map((f) => f.fieldLabel).join(', ')} — впишите эти значения:
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {missingCounterpartyFields.map((gap) => {
                const copyId = `cp-gap-${activeOperation.id}-${gap.fieldKey}`;
                const isCopied = copiedKey === copyId;
                return (
                  <div
                    key={gap.fieldKey}
                    className="px-3 py-2 rounded bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {gap.fieldLabel}
                      </div>
                      <div className="text-xs font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {gap.expectedValue}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(copyId, gap.expectedValue)}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Ок</span>
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="w-3 h-3" />
                          <span>Скопировать</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3) Табличная часть (когда есть строки табличной части) */}
        {tableRowsGuide.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              2. Табличная часть документа
            </div>
            <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 px-3 font-semibold">Номенклатура / Статья</th>
                    <th className="py-2 px-3 font-semibold text-right">Количество</th>
                    <th className="py-2 px-3 font-semibold text-right">Цена</th>
                    <th className="py-2 px-3 font-semibold text-right">Сумма</th>
                    <th className="py-2 px-3 font-semibold">НДС</th>
                    <th className="py-2 px-3 font-semibold">Счет учета</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {tableRowsGuide.map((row, idx) => {
                    const nameCopyKey = `tbl-name-${activeOperation.id}-${idx}`;
                    const sumCopyKey = `tbl-sum-${activeOperation.id}-${idx}`;
                    return (
                      <tr key={idx} className="bg-white dark:bg-[#111113]">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                {substituteStudentText(row.name)}
                              </div>
                              {row.subconto && (
                                <div className="text-[11px] text-zinc-500">
                                  Субконто: {row.subconto}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(nameCopyKey, substituteStudentText(row.name))
                              }
                              title="Скопировать наименование"
                              className="p-1 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                            >
                              {copiedKey === nameCopyKey ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <ClipboardCopy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                          {row.quantity || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                          {row.price || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <span>{row.amount}</span>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  sumCopyKey,
                                  row.amount.replace(/[^\d,.-]/g, '')
                                )
                              }
                              title="Скопировать сумму"
                              className="p-1 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                            >
                              {copiedKey === sumCopyKey ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <ClipboardCopy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                          {row.vat}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                          {row.account}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4) Счет-фактура / УПД */}
        <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Счет-фактура / УПД внизу документа:{' '}
              <span
                className={
                  activeOperation.hasUpdOrSf
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-zinc-500'
                }
              >
                {activeOperation.hasUpdOrSf
                  ? 'Обязательно зарегистрировать (тумблер УПД или кнопка «Зарегистрировать»)'
                  : 'Не требуется'}
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {activeOperation.updLabel ||
                (activeOperation.hasUpdOrSf
                  ? `Укажите дату ${activeOperation.date} и номер первичного документа, чтобы сформировалась проводка по НДС (счет 68.02).`
                  : 'Для банковских, кассовых и кадровых документов счет-фактура внизу формы не вводится.')}
            </p>
          </div>
        </div>
      </section>

      {/* БЛОК Г. КАКИЕ ПРОВОДКИ ДОЛЖНЫ ПОЛУЧИТЬСЯ (Дт/Кт) */}
      <section className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Блок Г. Какие проводки должны получиться (проверка по кнопке «Дт/Кт»)
          </h2>

          <button
            type="button"
            onClick={() => setActiveTab('audit_osv')}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:underline"
          >
            Открыть проверку ошибок и ОСВ →
          </button>
        </div>

        {activeOperation.postings.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 px-3 font-semibold w-28">Дебет</th>
                  <th className="py-2 px-3 font-semibold w-28">Кредит</th>
                  <th className="py-2 px-3 font-semibold text-right w-40">Сумма</th>
                  <th className="py-2 px-3 font-semibold">Субконто (аналитика)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {activeOperation.postings.map((p, idx) => {
                  const subcontos = [
                    ...p.debitSubconto.map((s) => `Дт: ${substituteStudentText(s)}`),
                    ...p.creditSubconto.map((s) => `Кт: ${substituteStudentText(s)}`),
                  ];
                  return (
                    <tr key={p.id || idx} className="bg-white dark:bg-[#111113]">
                      <td className="py-2.5 px-3 align-top font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                        {p.debitAccount}
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                        {p.creditAccount}
                      </td>
                      <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                        {formatRub(p.amount)}
                      </td>
                      <td className="py-2.5 px-3 align-top text-zinc-600 dark:text-zinc-300 space-y-0.5">
                        {subcontos.length > 0 ? (
                          subcontos.map((line, sIdx) => <div key={sIdx}>{line}</div>)
                        ) : (
                          <span>{substituteStudentText(p.comment)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300">
            {activeOperation.status === 'needs_data'
              ? 'Суммы проводок появятся автоматически после загрузки остатков на 31 марта.'
              : 'На дату кадрового приказа бухгалтерских проводок Дт/Кт нет — начисление зарплаты и взносов выполняется в конце месяца.'}
          </div>
        )}

        {/* Plain Human-Language Explanation */}
        <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-1">
          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            Почему используются именно эти счета:
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {plainExplanation}
          </p>
        </div>
      </section>
    </div>
  );
}
