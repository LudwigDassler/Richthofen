'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  FileSpreadsheet,
  Layers,
  ListTree,
  Plus,
  RotateCcw,
  Sparkles,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { CHART_OF_ACCOUNTS, getAccountInfo } from '@/data/chartOfAccounts';
import { parsePastedOsvTable, roundMoney } from '@/lib/engine';
import { AccountType, OsvAccountCardMovement, OsvRow, UserOsvInputRow } from '@/types/accounting';

type OsvSubView = 'live' | 'reconcile';

function formatNumberRu(val: number): string {
  const abs = Math.abs(roundMoney(val));
  const formatted = abs.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return val < -0.004 ? `−${formatted}` : formatted;
}

function formatOsvCell(val: number): string {
  if (Math.abs(val) < 0.005) return '—';
  return formatNumberRu(val);
}

function formatDeltaRub(diff: number): string {
  const sign = diff > 0 ? '+' : '−';
  const abs = Math.abs(roundMoney(diff)).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Δ ${sign}${abs} ₽`;
}

function getAccountTypeBadge(type: AccountType): { label: string; title: string; className: string } {
  switch (type) {
    case 'active':
      return {
        label: 'А',
        title: 'Активный счет (остаток по Дебету)',
        className:
          'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
      };
    case 'passive':
      return {
        label: 'П',
        title: 'Пассивный счет (остаток по Кредиту)',
        className:
          'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
      };
    default:
      return {
        label: 'АП',
        title: 'Активно-пассивный счет',
        className:
          'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
      };
  }
}

function parseUserMoneyString(raw: string): number | null {
  let cleaned = raw
    .replace(/руб\.?|р\.?|₽/gi, '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/−/g, '-')
    .trim();

  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
  } else {
    cleaned = cleaned.replace(/,/g, '.');
  }

  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(parsed);
}

interface MoneyReconcileCellProps {
  value: number | null | undefined;
  referenceValue: number;
  pairEntered: boolean;
  diffValue: number;
  showReferenceHint: boolean;
  placeholder?: string;
  onChange: (nextVal: number | null) => void;
}

function MoneyReconcileCell({
  value,
  referenceValue,
  pairEntered,
  diffValue,
  showReferenceHint,
  placeholder = '0,00',
  onChange,
}: MoneyReconcileCellProps) {
  const hasVal = value !== null && value !== undefined && Number.isFinite(value);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => (hasVal ? String(value).replace('.', ',') : ''));

  useEffect(() => {
    if (!focused) {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        setDraft(
          value.toLocaleString('ru-RU', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        );
      } else {
        setDraft('');
      }
    }
  }, [value, focused]);

  const isMatched = pairEntered && Math.abs(diffValue) < 0.01;
  const isMismatched = pairEntered && Math.abs(diffValue) >= 0.01;

  const inputBorderClass = isMismatched
    ? 'border-red-400 bg-red-50/70 text-red-900 focus:border-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200'
    : isMatched
      ? 'border-emerald-400 bg-emerald-50/60 text-emerald-900 focus:border-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
      : 'border-zinc-200 bg-white text-zinc-900 focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400';

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={placeholder}
          onFocus={() => {
            setFocused(true);
            if (value !== null && value !== undefined && Number.isFinite(value)) {
              setDraft(String(value).replace('.', ','));
            }
          }}
          onBlur={() => {
            setFocused(false);
            const parsed = parseUserMoneyString(draft);
            onChange(parsed);
          }}
          onChange={(e) => {
            const nextText = e.target.value;
            setDraft(nextText);
            const parsed = parseUserMoneyString(nextText);
            if (nextText.trim() === '') {
              onChange(null);
            } else if (parsed !== null) {
              onChange(parsed);
            }
          }}
          className={`w-full rounded-md border px-2.5 py-1.5 text-right font-mono text-xs tabular-nums transition focus:outline-none ${inputBorderClass}`}
        />
        {isMatched && !focused && (
          <span
            title="Совпадает с эталоном до копейки"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-emerald-600 dark:text-emerald-400"
          >
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {isMismatched && (
        <div className="flex flex-col items-end gap-0.5 text-[11px] leading-tight">
          <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono font-semibold text-red-700 tabular-nums dark:border-red-900 dark:bg-red-950/70 dark:text-red-300">
            {formatDeltaRub(diffValue)}
          </span>
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums dark:text-zinc-400">
            Эталон: {formatNumberRu(referenceValue)} ₽
          </span>
        </div>
      )}

      {!isMismatched && showReferenceHint && (
        <span className="text-right font-mono text-[10px] text-zinc-400 tabular-nums dark:text-zinc-500">
          Эт.: {formatNumberRu(referenceValue)}
        </span>
      )}
    </div>
  );
}

export function OsvTab() {
  const {
    effectiveOrganization,
    openingBalances,
    operations,
    includeAutoClosing,
    setIncludeAutoClosing,
    osvMode,
    setOsvMode,
    osvReport,
    referenceOsvReport,
    userOsvInputs,
    setUserOsvInputs,
    updateUserOsvInput,
    clearUserOsvInputs,
    fillUserOsvFromReference,
    simulateTypicalAdvanceErrorInOsv,
    reconciliation,
    selectOperationAndNavigate,
    markAllOperationsDone,
  } = useAccountant();

  const [subView, setSubView] = useState<OsvSubView>('live');
  const [showSubaccounts, setShowSubaccounts] = useState<boolean>(true);
  const [selectedCardAccountCode, setSelectedCardAccountCode] = useState<string | null>(null);

  const [isPasteModalOpen, setIsPasteModalOpen] = useState<boolean>(false);
  const [pasteText, setPasteText] = useState<string>('');
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);

  const [showReferenceHints, setShowReferenceHints] = useState<boolean>(false);
  const [extraAccountCodeToAdd, setExtraAccountCodeToAdd] = useState<string>('');

  const doneOperationsCount = useMemo(
    () => operations.filter((op) => op.status === 'done').length,
    [operations]
  );

  const redLeafRows = useMemo(
    () => osvReport.rows.filter((r) => !r.isGroup && r.hasRedBalance),
    [osvReport.rows]
  );

  const visibleOsvRows = useMemo(() => {
    if (showSubaccounts) return osvReport.rows;
    return osvReport.rows.filter((row) => row.isGroup || !row.parentCode);
  }, [osvReport.rows, showSubaccounts]);

  const selectedCardData = useMemo(() => {
    if (!selectedCardAccountCode) return null;
    const row = osvReport.rows.find((r) => r.accountCode === selectedCardAccountCode);
    if (!row) return null;

    let movements: OsvAccountCardMovement[] = row.movements;
    if (row.isGroup) {
      const children = osvReport.rows.filter((r) => r.parentCode === row.accountCode);
      movements = children.flatMap((c) => c.movements);
    }

    const matchingOpening = openingBalances.filter(
      (ob) =>
        ob.accountCode === row.accountCode ||
        (row.isGroup && ob.accountCode.startsWith(`${row.accountCode}.`))
    );

    const info = getAccountInfo(row.accountCode);

    let runningNet =
      row.accountType === 'passive'
        ? roundMoney(row.startCredit - row.startDebit)
        : roundMoney(row.startDebit - row.startCredit);

    const enrichedMovements = movements.map((m) => {
      if (row.accountType === 'passive') {
        runningNet = roundMoney(runningNet + m.credit - m.debit);
      } else {
        runningNet = roundMoney(runningNet + m.debit - m.credit);
      }

      const isRedStep =
        (row.accountType === 'active' || row.accountType === 'passive') && runningNet < -0.004;

      let saldoLabel = '';
      if (row.accountType === 'active') {
        saldoLabel = `Дт ${formatNumberRu(runningNet)}`;
      } else if (row.accountType === 'passive') {
        saldoLabel = `Кт ${formatNumberRu(runningNet)}`;
      } else {
        saldoLabel =
          runningNet >= 0
            ? `Дт ${formatNumberRu(runningNet)}`
            : `Кт ${formatNumberRu(Math.abs(runningNet))}`;
      }

      return {
        ...m,
        runningNet,
        saldoLabel,
        isRedStep,
      };
    });

    return {
      row,
      info,
      matchingOpening,
      enrichedMovements,
    };
  }, [selectedCardAccountCode, osvReport.rows, openingBalances]);

  const reconcileRows = useMemo(() => {
    const leafReference = referenceOsvReport.rows.filter((r) => !r.isGroup);
    const seen = new Set(leafReference.map((r) => r.accountCode));
    const extras: OsvRow[] = [];

    for (const code of Object.keys(userOsvInputs)) {
      const normalized = code.trim();
      if (!normalized || seen.has(normalized)) continue;
      const info = getAccountInfo(normalized);
      if (info.isGroup) continue;
      seen.add(normalized);
      extras.push({
        accountCode: normalized,
        accountName: info.name,
        accountType: info.type,
        isGroup: false,
        parentCode: info.parentCode,
        startDebit: 0,
        startCredit: 0,
        turnoverDebit: 0,
        turnoverCredit: 0,
        endDebit: 0,
        endCredit: 0,
        hasRedBalance: false,
        movements: [],
      });
    }

    return [...leafReference, ...extras];
  }, [referenceOsvReport.rows, userOsvInputs]);

  const availableExtraAccounts = useMemo(() => {
    const existing = new Set(reconcileRows.map((r) => r.accountCode));
    return CHART_OF_ACCOUNTS.filter((acc) => !acc.isGroup && !existing.has(acc.code));
  }, [reconcileRows]);

  const pastedPreviewCount = useMemo(() => {
    if (!pasteText.trim()) return 0;
    return Object.keys(parsePastedOsvTable(pasteText)).length;
  }, [pasteText]);

  const handleApplyPastedOsv = () => {
    const parsed = parsePastedOsvTable(pasteText);
    const count = Object.keys(parsed).length;
    if (count === 0) {
      setPasteFeedback(
        'Не удалось распознать строки со счетами. Убедитесь, что в начале строки указан код счета (например: 60.01   1 236 900,00   1 236 900,00   0,00   0,00).'
      );
      return;
    }
    setUserOsvInputs((prev) => ({
      ...prev,
      ...parsed,
    }));
    setIsPasteModalOpen(false);
    setPasteText('');
    setPasteFeedback(null);
  };

  const handleAddExtraAccount = () => {
    if (!extraAccountCodeToAdd) return;
    updateUserOsvInput(extraAccountCodeToAdd, {
      accountCode: extraAccountCodeToAdd,
      endDebit: 0,
      endCredit: 0,
    });
    setExtraAccountCodeToAdd('');
  };

  const findOperationLabel = (opId?: string) => {
    if (!opId) return null;
    const found = operations.find((op) => op.id === opId);
    if (!found) return null;
    return `Оп. №${found.number} (${found.date})`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      {/* Top Sub-View Switcher */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-[#111113] sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setSubView('live')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium transition ${
              subView === 'live'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            <span>Живая Оборотно-сальдовая ведомость (ОСВ)</span>
            {redLeafRows.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                ! {redLeafRows.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubView('reconcile')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium transition ${
              subView === 'reconcile'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <Calculator className="h-3.5 w-3.5" />
            <span>Сверить мою ОСВ из 1С</span>
            {reconciliation.checkedAccountsCount > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                  reconciliation.isPerfectMatch
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                    : 'bg-red-600 text-white'
                }`}
              >
                {reconciliation.isPerfectMatch
                  ? `✓ ${reconciliation.checkedAccountsCount}`
                  : `Δ ${reconciliation.mismatchedAccountsCount}`}
              </span>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-700 tabular-nums dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Период: {effectiveOrganization.periodLabel}
          </span>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SUB-VIEW 1: LIVE 1C 8.3 OSV                                           */}
      {/* ===================================================================== */}
      {subView === 'live' && (
        <div className="space-y-4">
          {/* Mode & Display Controls */}
          <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#111113] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Режим:
              </span>
              <div className="inline-flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setOsvMode('completed_only')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    osvMode === 'completed_only'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  По выполненным операциям (
                  <span className="font-mono tabular-nums">
                    {doneOperationsCount}/{operations.length}
                  </span>
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setOsvMode('all_operations')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    osvMode === 'all_operations'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  Эталон по всей задаче
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={showSubaccounts}
                  onChange={(e) => setShowSubaccounts(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-0"
                />
                <ListTree className="h-3.5 w-3.5 text-zinc-500" />
                <span>Детализация по субсчетам</span>
              </label>

              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={includeAutoClosing}
                  onChange={(e) => setIncludeAutoClosing(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-0"
                />
                <Layers className="h-3.5 w-3.5 text-zinc-500" />
                <span>Включить закрытие месяца</span>
              </label>
            </div>
          </div>

          {/* Hint if mode === completed_only and 0 operations marked done */}
          {osvMode === 'completed_only' && doneOperationsCount === 0 && (
            <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-zinc-500" />
                <span>
                  Включен режим <strong>«По выполненным операциям»</strong>, и пока ни одна операция не отмечена проведенной — показаны только начальные остатки.
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={markAllOperationsDone}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Отметить все проведенными
                </button>
                <button
                  type="button"
                  onClick={() => setOsvMode('all_operations')}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  Показать эталон
                </button>
              </div>
            </div>
          )}

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#111113]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Сальдо на начало
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                    osvReport.isStartBalanced
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
                  }`}
                >
                  {osvReport.isStartBalanced ? 'Дт = Кт' : 'Счет 000!'}
                </span>
              </div>
              <div className="mt-2 font-mono text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {formatNumberRu(osvReport.totalStartDebit)} ₽
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                Кт: {formatNumberRu(osvReport.totalStartCredit)} ₽
              </div>
            </div>

            <div className="rounded-md border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#111113]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Обороты за период
                </span>
                <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  Дт = Кт
                </span>
              </div>
              <div className="mt-2 font-mono text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {formatNumberRu(osvReport.totalTurnoverDebit)} ₽
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                Кт: {formatNumberRu(osvReport.totalTurnoverCredit)} ₽
              </div>
            </div>

            <div className="rounded-md border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#111113]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Сальдо на конец
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                    osvReport.isEndBalanced
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
                  }`}
                >
                  {osvReport.isEndBalanced ? 'Дт = Кт' : 'Разбаланс!'}
                </span>
              </div>
              <div className="mt-2 font-mono text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {formatNumberRu(osvReport.totalEndDebit)} ₽
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                Кт: {formatNumberRu(osvReport.totalEndCredit)} ₽
              </div>
            </div>

            <div
              className={`rounded-md border p-3.5 ${
                redLeafRows.length > 0
                  ? 'border-red-300 bg-red-50/50 dark:border-red-900/70 dark:bg-red-950/25'
                  : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Контроль «красноты» 1С
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                    redLeafRows.length > 0
                      ? 'border-red-600 bg-red-600 text-white'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                  }`}
                >
                  {redLeafRows.length > 0 ? `! ${redLeafRows.length}` : 'ОК'}
                </span>
              </div>
              <div
                className={`mt-2 font-mono text-base font-semibold tabular-nums ${
                  redLeafRows.length > 0
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-zinc-900 dark:text-zinc-100'
                }`}
              >
                {redLeafRows.length > 0 ? `${redLeafRows.length} сч. с краснотой` : '0 ошибок'}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Клик по строке — Карточка счета
              </div>
            </div>
          </div>

          {/* Red Balance Alert Banner */}
          {redLeafRows.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50/70 p-3.5 text-xs text-red-950 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
              <div className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
                <AlertOctagon className="h-4 w-4 shrink-0" />
                <span>Обнаружена «краснота» (отрицательное сальдо) в ОСВ 1С 8.3:</span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {redLeafRows.map((r) => (
                  <li key={r.accountCode}>
                    <button
                      type="button"
                      onClick={() => setSelectedCardAccountCode(r.accountCode)}
                      className="font-mono font-semibold underline tabular-nums hover:text-red-600 dark:hover:text-red-100"
                    >
                      Счет {r.accountCode}
                    </button>
                    : {r.redBalanceHint || 'Отрицательный остаток на счете.'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Linear Pro-Fintech OSV Table */}
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
            <div className="flex flex-col justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-[#111113] sm:flex-row sm:items-center">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Оборотно-сальдовая ведомость за {effectiveOrganization.periodLabel}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Организация: <span className="font-medium text-zinc-700 dark:text-zinc-300">{effectiveOrganization.name}</span> · ИНН{' '}
                  <span className="font-mono tabular-nums">{effectiveOrganization.inn}</span> · руб.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSubView('reconcile')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Calculator className="h-3.5 w-3.5" />
                  <span>Сверить со своей 1С</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <th rowSpan={2} className="w-24 border-r border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      Счет
                    </th>
                    <th rowSpan={2} className="border-r border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      Наименование счета
                    </th>
                    <th
                      colSpan={2}
                      className="border-b border-r border-zinc-200 px-3 py-1.5 text-center dark:border-zinc-800"
                    >
                      Сальдо на начало периода
                    </th>
                    <th
                      colSpan={2}
                      className="border-b border-r border-zinc-200 px-3 py-1.5 text-center dark:border-zinc-800"
                    >
                      Обороты за период
                    </th>
                    <th
                      colSpan={2}
                      className="border-b border-zinc-200 px-3 py-1.5 text-center dark:border-zinc-800"
                    >
                      Сальдо на конец периода
                    </th>
                  </tr>
                  <tr className="border-b border-zinc-200 bg-zinc-50/70 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                    <th className="w-28 border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">
                      Дебет
                    </th>
                    <th className="w-28 border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">
                      Кредит
                    </th>
                    <th className="w-28 border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">
                      Дебет
                    </th>
                    <th className="w-28 border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">
                      Кредит
                    </th>
                    <th className="w-28 border-r border-zinc-200 px-2.5 py-1.5 text-right dark:border-zinc-800">
                      Дебет
                    </th>
                    <th className="w-28 px-2.5 py-1.5 text-right">Кредит</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                  {visibleOsvRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-xs text-zinc-500 dark:text-zinc-400"
                      >
                        Нет данных по счетам для отображения. Добавьте начальные остатки или операции.
                      </td>
                    </tr>
                  ) : (
                    visibleOsvRows.map((row) => {
                      const isIndentedSubaccount = !row.isGroup && Boolean(row.parentCode);
                      const badge = getAccountTypeBadge(row.accountType);
                      const isEndDebitRed = row.hasRedBalance && row.endDebit < -0.004;
                      const isEndCreditRed = row.hasRedBalance && row.endCredit < -0.004;
                      const isAux000Red = row.accountCode === '000' && row.hasRedBalance;

                      const rowBgClass =
                        row.hasRedBalance && !row.isGroup
                          ? 'bg-red-50/60 hover:bg-red-50 dark:bg-red-950/25 dark:hover:bg-red-950/40'
                          : row.isGroup
                            ? 'bg-zinc-50 font-semibold text-zinc-900 hover:bg-zinc-100/80 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-800/80'
                            : 'bg-white text-zinc-800 hover:bg-zinc-50/80 dark:bg-[#111113] dark:text-zinc-200 dark:hover:bg-zinc-900/50';

                      return (
                        <tr
                          key={row.accountCode}
                          onClick={() => setSelectedCardAccountCode(row.accountCode)}
                          title={`Открыть карточку счета ${row.accountCode} (${row.accountName})`}
                          className={`group cursor-pointer transition-colors ${rowBgClass}`}
                        >
                          <td className="border-r border-zinc-200/80 px-3 py-2 font-mono tabular-nums dark:border-zinc-800">
                            <div
                              className={`flex items-center gap-1.5 ${
                                isIndentedSubaccount ? 'pl-3.5' : ''
                              }`}
                            >
                              {isIndentedSubaccount && (
                                <span className="text-zinc-300 dark:text-zinc-600">└</span>
                              )}
                              <span
                                className={
                                  row.isGroup
                                    ? 'font-bold text-zinc-900 dark:text-zinc-100'
                                    : 'font-medium text-zinc-800 dark:text-zinc-200'
                                }
                              >
                                {row.accountCode}
                              </span>
                              {row.hasRedBalance && !row.isGroup && (
                                <span title={row.redBalanceHint || 'Отрицательное сальдо (краснота)'}>
                                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="border-r border-zinc-200/80 px-3 py-2 dark:border-zinc-800">
                            <div className="flex items-center justify-between gap-2">
                              <div
                                className={`flex items-center gap-2 ${
                                  isIndentedSubaccount ? 'pl-2' : ''
                                }`}
                              >
                                <span
                                  className={
                                    row.isGroup
                                      ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                                      : 'text-zinc-700 dark:text-zinc-300'
                                  }
                                >
                                  {row.accountName}
                                </span>
                                {(row.accountCode === '90' || row.accountCode === '91') &&
                                  row.isGroup && (
                                    <span
                                      title="В 1С 8.3 синтетические счета 90 и 91 показывают свернутое конечное сальдо по всем субсчетам"
                                      className="hidden rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 sm:inline-block"
                                    >
                                      свернуто
                                    </span>
                                  )}
                              </div>

                              <div className="flex shrink-0 items-center gap-1.5">
                                {!row.isGroup && (
                                  <span
                                    title={badge.title}
                                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                )}
                                <span className="hidden items-center gap-1 rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 opacity-0 transition group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 sm:inline-flex">
                                  <Eye className="h-3 w-3" />
                                  Карточка
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="border-r border-zinc-200/80 px-2.5 py-2 text-right font-mono tabular-nums dark:border-zinc-800">
                            {formatOsvCell(row.startDebit)}
                          </td>

                          <td className="border-r border-zinc-200 px-2.5 py-2 text-right font-mono tabular-nums dark:border-zinc-800">
                            {formatOsvCell(row.startCredit)}
                          </td>

                          <td className="border-r border-zinc-200/80 px-2.5 py-2 text-right font-mono tabular-nums text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {formatOsvCell(row.turnoverDebit)}
                          </td>

                          <td className="border-r border-zinc-200 px-2.5 py-2 text-right font-mono tabular-nums text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {formatOsvCell(row.turnoverCredit)}
                          </td>

                          <td
                            title={isEndDebitRed || isAux000Red ? row.redBalanceHint : undefined}
                            className={`border-r border-zinc-200/80 px-2.5 py-2 text-right font-mono tabular-nums dark:border-zinc-800 ${
                              isEndDebitRed || (isAux000Red && row.endDebit > 0)
                                ? 'bg-red-100/80 font-bold text-red-700 dark:bg-red-950/70 dark:text-red-300'
                                : 'font-medium'
                            }`}
                          >
                            {formatOsvCell(row.endDebit)}
                          </td>

                          <td
                            title={isEndCreditRed || isAux000Red ? row.redBalanceHint : undefined}
                            className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                              isEndCreditRed || (isAux000Red && row.endCredit > 0)
                                ? 'bg-red-100/80 font-bold text-red-700 dark:bg-red-950/70 dark:text-red-300'
                                : 'font-medium'
                            }`}
                          >
                            {formatOsvCell(row.endCredit)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                    <td colSpan={2} className="border-r border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wider">Итого по ведомости</span>
                        {osvReport.isEndBalanced ? (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Баланс сошелся
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Не сходится!
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="border-r border-zinc-200 px-2.5 py-2.5 text-right font-mono tabular-nums dark:border-zinc-800">
                      {formatNumberRu(osvReport.totalStartDebit)}
                    </td>
                    <td className="border-r border-zinc-200 px-2.5 py-2.5 text-right font-mono tabular-nums dark:border-zinc-800">
                      {formatNumberRu(osvReport.totalStartCredit)}
                    </td>
                    <td className="border-r border-zinc-200 px-2.5 py-2.5 text-right font-mono tabular-nums dark:border-zinc-800">
                      {formatNumberRu(osvReport.totalTurnoverDebit)}
                    </td>
                    <td className="border-r border-zinc-200 px-2.5 py-2.5 text-right font-mono tabular-nums dark:border-zinc-800">
                      {formatNumberRu(osvReport.totalTurnoverCredit)}
                    </td>
                    <td className="border-r border-zinc-200 px-2.5 py-2.5 text-right font-mono tabular-nums dark:border-zinc-800">
                      {formatNumberRu(osvReport.totalEndDebit)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-mono tabular-nums">
                      {formatNumberRu(osvReport.totalEndCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-VIEW 2: RECONCILE MY 1C OSV                                       */}
      {/* ===================================================================== */}
      {subView === 'reconcile' && (
        <div className="space-y-4">
          {/* Helper Toolbar */}
          <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Сверка вашей ОСВ из 1С:Бухгалтерия 8.3 с эталоном до копейки
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Введите обороты или конечное сальдо по счетам из своей базы 1С (или вставьте скопированную таблицу из 1С / Excel).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPasteFeedback(null);
                    setIsPasteModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  <span>Вставить таблицу из 1С / Excel</span>
                </button>

                <button
                  type="button"
                  onClick={simulateTypicalAdvanceErrorInOsv}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Смоделировать типичную ошибку (тест сверки)</span>
                </button>

                <button
                  type="button"
                  onClick={fillUserOsvFromReference}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Заполнить эталоном</span>
                </button>

                <button
                  type="button"
                  onClick={clearUserOsvInputs}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:text-red-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Очистить</span>
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={showReferenceHints}
                  onChange={(e) => setShowReferenceHints(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-0"
                />
                <span>Показывать подсказки эталонных сумм под всеми ячейками</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={extraAccountCodeToAdd}
                  onChange={(e) => setExtraAccountCodeToAdd(e.target.value)}
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-700 focus:border-zinc-900 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <option value="">+ Добавить другой счет из 1С...</option>
                  {availableExtraAccounts.map((acc) => (
                    <option key={acc.code} value={acc.code}>
                      {acc.code} — {acc.name}
                    </option>
                  ))}
                </select>
                {extraAccountCodeToAdd && (
                  <button
                    type="button"
                    onClick={handleAddExtraAccount}
                    className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Добавить</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Reconciliation Summary & Diagnostics */}
          {reconciliation.checkedAccountsCount === 0 ? (
            <div className="rounded-md border border-zinc-200 bg-white p-4 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-400">
              Введите хотя бы одно число в таблицу ниже или нажмите{' '}
              <button
                type="button"
                onClick={simulateTypicalAdvanceErrorInOsv}
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                «Смоделировать типичную ошибку (тест сверки)»
              </button>
              , чтобы протестировать диагностику незачтенного аванса по счетам <span className="font-mono tabular-nums">60.01</span> и <span className="font-mono tabular-nums">60.02</span> на сумму <span className="font-mono tabular-nums">1 236 900,00 ₽</span>.
            </div>
          ) : reconciliation.isPerfectMatch ? (
            <div className="flex items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50/60 p-4 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <div className="text-sm font-semibold">
                  Все проверенные счета (<span className="font-mono tabular-nums">{reconciliation.checkedAccountsCount}</span>) сходятся с эталоном до копейки (<span className="font-mono tabular-nums">0,00 ₽</span>).
                </div>
                <div className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                  Обороты, зачеты авансов, НДС и конечные остатки полностью соответствуют эталонному решению.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-300 bg-red-50/70 px-4 py-2.5 text-xs text-red-950 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertOctagon className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="font-mono tabular-nums">
                    Проверено: {reconciliation.checkedAccountsCount} · Расхождений: {reconciliation.mismatchedAccountsCount} · Причин: {reconciliation.diagnostics.length}
                  </span>
                </div>
                <span className="font-mono text-[11px] tabular-nums">Точность: 0,01 ₽</span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {reconciliation.diagnostics.map((diag) => {
                  const opLabel = findOperationLabel(diag.relatedOperationId);
                  const isError = diag.severity === 'error';

                  return (
                    <div
                      key={diag.id}
                      className={`rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113] ${
                        isError
                          ? 'border-l-2 border-l-red-600 dark:border-l-red-500'
                          : 'border-l-2 border-l-amber-600 dark:border-l-amber-500'
                      }`}
                    >
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${
                                isError
                                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
                                  : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                              }`}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {isError ? 'Ошибка в ОСВ' : 'Предупреждение'}
                            </span>

                            {diag.accountsAffected.map((acc) => (
                              <span
                                key={acc}
                                className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-900 tabular-nums dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                              >
                                Сч. {acc}
                              </span>
                            ))}

                            <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-xs font-semibold text-red-700 tabular-nums dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                              Δ {formatNumberRu(diag.diffAmount)} ₽
                            </span>
                          </div>

                          <h3 className="pt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {diag.title}
                          </h3>
                        </div>

                        {diag.relatedOperationId && (
                          <button
                            type="button"
                            onClick={() => selectOperationAndNavigate(diag.relatedOperationId!)}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                          >
                            <span>
                              Перейти к проблемной операции
                              {opLabel ? ` (${opLabel})` : ''}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                          <div className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">
                            Причина расхождения:
                          </div>
                          <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">
                            {diag.probableCause}
                          </p>
                        </div>

                        <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                          <div className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">
                            Как исправить в 1С 8.3:
                          </div>
                          <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">
                            {diag.howToFixIn1C}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Interactive Reconciliation Table */}
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <th className="w-24 px-3 py-2.5">Счет</th>
                    <th className="px-3 py-2.5">Наименование субсчета</th>
                    <th className="w-40 px-2.5 py-2.5 text-right font-mono">Обороты Дт (1С)</th>
                    <th className="w-40 px-2.5 py-2.5 text-right font-mono">Обороты Кт (1С)</th>
                    <th className="w-40 px-2.5 py-2.5 text-right font-mono">Сальдо кон. Дт</th>
                    <th className="w-40 px-2.5 py-2.5 text-right font-mono">Сальдо кон. Кт</th>
                    <th className="w-24 px-3 py-2.5 text-center">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                  {reconcileRows.map((row) => {
                    const userInput: UserOsvInputRow = userOsvInputs[row.accountCode] ?? {
                      accountCode: row.accountCode,
                    };
                    const rowDiff = reconciliation.rowDiffs[row.accountCode];

                    const enteredTurnoverPair =
                      (userInput.turnoverDebit !== null &&
                        userInput.turnoverDebit !== undefined &&
                        Number.isFinite(userInput.turnoverDebit)) ||
                      (userInput.turnoverCredit !== null &&
                        userInput.turnoverCredit !== undefined &&
                        Number.isFinite(userInput.turnoverCredit));

                    const enteredEndPair =
                      (userInput.endDebit !== null &&
                        userInput.endDebit !== undefined &&
                        Number.isFinite(userInput.endDebit)) ||
                      (userInput.endCredit !== null &&
                        userInput.endCredit !== undefined &&
                        Number.isFinite(userInput.endCredit));

                    const isRowChecked = Boolean(rowDiff);
                    const hasRowMismatch = Boolean(rowDiff?.hasMismatch);

                    return (
                      <tr
                        key={row.accountCode}
                        className={
                          hasRowMismatch
                            ? 'bg-red-50/35 dark:bg-red-950/15'
                            : isRowChecked
                              ? 'bg-emerald-50/25 dark:bg-emerald-950/10'
                              : 'hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50'
                        }
                      >
                        <td className="px-3 py-2.5 align-top font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                          {row.accountCode}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-medium text-zinc-800 dark:text-zinc-200">
                            {row.accountName}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-zinc-400 tabular-nums dark:text-zinc-500">
                            Нач. сальдо:{' '}
                            {row.startDebit > 0
                              ? `Дт ${formatNumberRu(row.startDebit)}`
                              : row.startCredit > 0
                                ? `Кт ${formatNumberRu(row.startCredit)}`
                                : '0,00'}
                          </div>
                        </td>

                        <td className="px-2 py-2 align-top">
                          <MoneyReconcileCell
                            value={userInput.turnoverDebit}
                            referenceValue={row.turnoverDebit}
                            pairEntered={enteredTurnoverPair}
                            diffValue={rowDiff?.turnoverDebitDiff ?? 0}
                            showReferenceHint={showReferenceHints}
                            onChange={(val) =>
                              updateUserOsvInput(row.accountCode, { turnoverDebit: val })
                            }
                          />
                        </td>

                        <td className="px-2 py-2 align-top">
                          <MoneyReconcileCell
                            value={userInput.turnoverCredit}
                            referenceValue={row.turnoverCredit}
                            pairEntered={enteredTurnoverPair}
                            diffValue={rowDiff?.turnoverCreditDiff ?? 0}
                            showReferenceHint={showReferenceHints}
                            onChange={(val) =>
                              updateUserOsvInput(row.accountCode, { turnoverCredit: val })
                            }
                          />
                        </td>

                        <td className="px-2 py-2 align-top">
                          <MoneyReconcileCell
                            value={userInput.endDebit}
                            referenceValue={row.endDebit}
                            pairEntered={enteredEndPair}
                            diffValue={rowDiff?.endDebitDiff ?? 0}
                            showReferenceHint={showReferenceHints}
                            onChange={(val) =>
                              updateUserOsvInput(row.accountCode, { endDebit: val })
                            }
                          />
                        </td>

                        <td className="px-2 py-2 align-top">
                          <MoneyReconcileCell
                            value={userInput.endCredit}
                            referenceValue={row.endCredit}
                            pairEntered={enteredEndPair}
                            diffValue={rowDiff?.endCreditDiff ?? 0}
                            showReferenceHint={showReferenceHints}
                            onChange={(val) =>
                              updateUserOsvInput(row.accountCode, { endCredit: val })
                            }
                          />
                        </td>

                        <td className="px-3 py-2.5 align-top text-center">
                          {!isRowChecked ? (
                            <span className="inline-block rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                              —
                            </span>
                          ) : hasRowMismatch ? (
                            <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
                              <AlertTriangle className="h-3 w-3" />
                              Ошибка
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                              <Check className="h-3 w-3" />
                              Верно
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: ACCOUNT CARD DRILL-DOWN («Карточка счета {code}»)              */}
      {/* ===================================================================== */}
      {selectedCardData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setSelectedCardAccountCode(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#111113]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-[#111113]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs font-semibold text-white tabular-nums dark:bg-zinc-100 dark:text-zinc-900">
                    Карточка счета {selectedCardData.row.accountCode}
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                      getAccountTypeBadge(selectedCardData.row.accountType).className
                    }`}
                  >
                    {getAccountTypeBadge(selectedCardData.row.accountType).title}
                  </span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:text-base">
                  {selectedCardData.row.accountName}
                </h3>
                {selectedCardData.info.subconto.length > 0 && (
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Субконто 1С 8.3:{' '}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {selectedCardData.info.subconto.join(' · ')}
                    </span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedCardAccountCode(null)}
                className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    Сальдо на начало периода (<span className="font-mono tabular-nums">{effectiveOrganization.periodStartDate}</span>)
                  </span>
                  <div className="flex items-center gap-4 font-mono font-semibold tabular-nums">
                    <span className="text-zinc-800 dark:text-zinc-200">
                      Дт: {formatNumberRu(selectedCardData.row.startDebit)} ₽
                    </span>
                    <span className="text-zinc-800 dark:text-zinc-200">
                      Кт: {formatNumberRu(selectedCardData.row.startCredit)} ₽
                    </span>
                  </div>
                </div>

                {selectedCardData.matchingOpening.length > 0 && (
                  <div className="mt-2.5 space-y-1 border-t border-zinc-200 pt-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                    {selectedCardData.matchingOpening.map((ob) => (
                      <div key={ob.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-mono font-semibold tabular-nums">{ob.accountCode}</span>
                          {ob.subconto1 ? ` · ${ob.subconto1}` : ''}
                          {ob.subconto2 ? ` (${ob.subconto2})` : ''}
                        </span>
                        <span className="font-mono tabular-nums">
                          {ob.debit > 0 ? `Дт ${formatNumberRu(ob.debit)} ₽` : ''}
                          {ob.credit > 0 ? `Кт ${formatNumberRu(ob.credit)} ₽` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        <th className="w-20 px-3 py-2">Дата</th>
                        <th className="px-3 py-2">Документ / Операция</th>
                        <th className="w-20 px-2.5 py-2 text-center">Корр. сч.</th>
                        <th className="w-28 px-2.5 py-2 text-right font-mono">Дебет</th>
                        <th className="w-28 px-2.5 py-2 text-right font-mono">Кредит</th>
                        <th className="w-32 px-2.5 py-2 text-right font-mono">Текущее сальдо</th>
                        <th className="w-28 px-3 py-2 text-right">Разбор 1С</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                      {selectedCardData.enrichedMovements.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400"
                          >
                            За выбранный период движений по этому счету нет.
                          </td>
                        </tr>
                      ) : (
                        selectedCardData.enrichedMovements.map((m, idx) => (
                          <tr
                            key={`${m.operationId}-${idx}`}
                            className={
                              m.isRedStep
                                ? 'bg-red-50/70 dark:bg-red-950/30'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                            }
                          >
                            <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-600 tabular-nums dark:text-zinc-400">
                              {m.date}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                <span className="font-mono tabular-nums">Оп. №{m.operationNumber}</span>: {m.description}
                              </div>
                              {m.subconto && (
                                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                  Субконто: {m.subconto}
                                </div>
                              )}
                            </td>
                            <td className="px-2.5 py-2.5 text-center">
                              <span className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-800 tabular-nums dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                {m.correspondentAccount}
                              </span>
                            </td>
                            <td className="px-2.5 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                              {m.debit > 0 ? formatNumberRu(m.debit) : '—'}
                            </td>
                            <td className="px-2.5 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                              {m.credit > 0 ? formatNumberRu(m.credit) : '—'}
                            </td>
                            <td
                              className={`px-2.5 py-2.5 text-right font-mono font-semibold tabular-nums ${
                                m.isRedStep
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-zinc-800 dark:text-zinc-200'
                              }`}
                            >
                              {m.saldoLabel}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  selectOperationAndNavigate(m.operationId);
                                  setSelectedCardAccountCode(null);
                                }}
                                className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              >
                                <span>К операции</span>
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-5 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                <span className="text-zinc-600 dark:text-zinc-300">
                  Обороты: <strong>Дт {formatNumberRu(selectedCardData.row.turnoverDebit)} ₽</strong>{' '}
                  / <strong>Кт {formatNumberRu(selectedCardData.row.turnoverCredit)} ₽</strong>
                </span>
                <span
                  className={
                    selectedCardData.row.hasRedBalance
                      ? 'font-semibold text-red-600 dark:text-red-400'
                      : 'font-semibold text-zinc-900 dark:text-zinc-100'
                  }
                >
                  Конечное сальдо: Дт {formatNumberRu(selectedCardData.row.endDebit)} ₽ / Кт{' '}
                  {formatNumberRu(selectedCardData.row.endCredit)} ₽
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCardAccountCode(null)}
                className="rounded-md bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: PASTE OSV TABLE FROM 1C / EXCEL                                */}
      {/* ===================================================================== */}
      {isPasteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setIsPasteModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-md border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-[#111113]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:text-base">
                  Вставить строки ОСВ из 1С 8.3 или Excel
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Скопируйте строки Оборотно-сальдовой ведомости из 1С или Excel. Поддерживаются 6 колонок (Нач Дт/Кт, Обор Дт/Кт, Кон Дт/Кт), 4 колонки или 2 колонки.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              rows={8}
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteFeedback(null);
              }}
              placeholder={`Пример строк из 1С / Excel:\n50.01\t15 000,00\t0,00\t130 000,00\t145 000,00\t0,00\t0,00\n60.01\t0,00\t120 000,00\t2 472 000,00\t3 588 900,00\t0,00\t1 236 900,00\n60.02\t0,00\t0,00\t1 236 900,00\t0,00\t1 236 900,00\t0,00`}
              className="mt-4 w-full rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-900 tabular-nums focus:border-zinc-900 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
            />

            {pasteFeedback && (
              <div className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                {pasteFeedback}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Распознано счетов:{' '}
                <span className="font-mono font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {pastedPreviewCount}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPasteText('')}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Очистить</span>
                </button>
                <button
                  type="button"
                  onClick={handleApplyPastedOsv}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  <span>Загрузить в таблицу сверки</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
