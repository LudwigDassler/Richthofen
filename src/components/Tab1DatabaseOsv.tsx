'use client';

import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileJson,
  FolderOpen,
  Layers,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { isOffBalanceAccountCode } from '@/data/chartOfAccounts';
import { BalanceAnchorOverride } from '@/types/accounting';
import { formatDateRu, formatMoney, formatMoneyWithCurrency } from '@/lib/formatters';

type SubView = 'osv' | 'explorer';
type ExplorerSection = 'org_policy' | 'directories' | 'documents' | 'postings' | 'raw_balances';

export function Tab1DatabaseOsv() {
  const {
    db1C,
    syncStatus,
    reportingYear,
    operations,
    osvReport,
    balanceAnchorOverride,
    setBalanceAnchorOverride,
    includeQueuedInOsv,
    setIncludeQueuedInOsv,
    periodFilter,
    load1CJsonFile,
    syncWith1CEndpoint,
    setActiveTab,
  } = useAccountant();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [subView, setSubView] = useState<SubView>('osv');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedAccountDrilldown, setSelectedAccountDrilldown] = useState<string | null>(null);

  // Explorer state
  const [explorerSection, setExplorerSection] = useState<ExplorerSection>('directories');
  const [selectedDirKey, setSelectedDirKey] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [docKindFilter, setDocKindFilter] = useState<string>('ALL');
  const [showHistoricalArchive, setShowHistoricalArchive] = useState<boolean>(false);

  const reportingYearCutoff = `${reportingYear}-01-01`;
  const historicalPostingsCount = useMemo(
    () => (db1C ? db1C.postings.filter((p) => p.date && p.date < reportingYearCutoff).length : 0),
    [db1C, reportingYearCutoff]
  );
  const historicalDocsCount = useMemo(
    () => (db1C ? db1C.documents.filter((d) => d.date && d.date < reportingYearCutoff).length : 0),
    [db1C, reportingYearCutoff]
  );

  const activeOpsCount = operations.filter((o) => o.includeInProcessing && !o.isDuplicateIn1C).length;

  const directoryKeys = useMemo(
    () => (db1C ? Object.keys(db1C.rawDirectories) : []),
    [db1C]
  );

  const activeDirKey =
    selectedDirKey && directoryKeys.includes(selectedDirKey)
      ? selectedDirKey
      : directoryKeys[0] || '';

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.name.toLowerCase().endsWith('.json')
    );
    if (file) {
      await load1CJsonFile(file);
    }
  };

  const toggleGroupCollapse = (code: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const setAllGroupsCollapsed = (collapsed: boolean) => {
    const next: Record<string, boolean> = {};
    for (const r of osvReport.rows) {
      if (r.isGroup) next[r.code] = collapsed;
    }
    setCollapsedGroups(next);
  };

  const visibleOsvRows = useMemo(() => {
    return osvReport.rows.filter((row) => {
      if (row.isGroup) return true;
      if (row.parentCode && collapsedGroups[row.parentCode]) {
        return false;
      }
      return true;
    });
  }, [osvReport.rows, collapsedGroups]);

  // Account card drilldown movements
  const drilldownMovements = useMemo(() => {
    if (!selectedAccountDrilldown) return [];
    const target = selectedAccountDrilldown;
    const matchesAcc = (code: string) => code === target || code.startsWith(`${target}.`);

    const items: Array<{
      id: string;
      date: string;
      source: 'БД 1С' | 'Очередь';
      doc: string;
      debit: string;
      credit: string;
      amount: number;
      description: string;
    }> = [];

    for (const p of db1C?.postings ?? []) {
      if (matchesAcc(p.debit) || matchesAcc(p.credit)) {
        if (p.date && p.date < reportingYearCutoff) continue;
        if (periodFilter.dateFrom && p.date && p.date < periodFilter.dateFrom) continue;
        if (periodFilter.dateTo && p.date && p.date > periodFilter.dateTo) continue;
        items.push({
          id: p.id,
          date: p.date,
          source: 'БД 1С',
          doc: p.documentLabel || `${p.documentType} №${p.documentNumber}`,
          debit: p.debit,
          credit: p.credit,
          amount: p.amount,
          description: p.description,
        });
      }
    }

    if (includeQueuedInOsv) {
      for (const op of operations) {
        if (!op.includeInProcessing || op.isDuplicateIn1C) continue;
        if (periodFilter.dateFrom && op.date && op.date < periodFilter.dateFrom) continue;
        if (periodFilter.dateTo && op.date && op.date > periodFilter.dateTo) continue;
        for (const e of op.entries) {
          if (matchesAcc(e.debit) || matchesAcc(e.credit)) {
            items.push({
              id: e.id,
              date: op.date,
              source: 'Очередь',
              doc: `${op.docType1C}${op.docNumber ? ` №${op.docNumber}` : ''}`,
              debit: e.debit,
              credit: e.credit,
              amount: e.amount,
              description: e.description || op.description,
            });
          }
        }
      }
    }

    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [
    selectedAccountDrilldown,
    db1C?.postings,
    includeQueuedInOsv,
    operations,
    periodFilter.dateFrom,
    periodFilter.dateTo,
    reportingYearCutoff,
  ]);

  const exportOsvToExcel = () => {
    const sheetData: Array<Array<string | number>> = [
      [
        `Оборотно-сальдовая ведомость — ${db1C?.organization.name || 'Организация'} (ИНН ${
          db1C?.organization.inn || '—'
        })`,
      ],
      [
        `Период: ${formatDateRu(periodFilter.dateFrom)} — ${formatDateRu(
          periodFilter.dateTo
        )} | ${osvReport.balanceModeDescription}`,
      ],
      [],
      [
        'Счёт',
        'Наименование счёта',
        'Сальдо нач. Дт',
        'Сальдо нач. Кт',
        'Обороты Дт',
        'Обороты Кт',
        'Сальдо кон. Дт',
        'Сальдо кон. Кт',
      ],
      ...osvReport.rows.map((r) => [
        r.code,
        r.name,
        r.startDebit,
        r.startCredit,
        r.turnoverDebit,
        r.turnoverCredit,
        r.endDebit,
        r.endCredit,
      ]),
      [
        'ИТОГО',
        'Контроль двойной записи по субсчетам',
        osvReport.totals.startDebit,
        osvReport.totals.startCredit,
        osvReport.totals.turnoverDebit,
        osvReport.totals.turnoverCredit,
        osvReport.totals.endDebit,
        osvReport.totals.endCredit,
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ОСВ_1С');
    XLSX.writeFile(
      wb,
      `OSV_${db1C?.organization.inn || '1C'}_${periodFilter.dateFrom || 'period'}.xlsx`
    );
  };

  // Empty State when no 1C DB and no operations are loaded yet
  if (!db1C && operations.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed p-8 sm:p-12 bg-white dark:bg-[#121418] transition-colors ${
            isDragging
              ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-zinc-300 dark:border-zinc-800'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await load1CJsonFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />

          <div className="max-w-xl mx-auto text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600">
              <FileJson className="w-6 h-6" />
            </div>

            <h1 className="text-xl font-semibold text-zinc-950 dark:text-white tracking-tight">
              Подключите выгрузку базы 1С:Предприятие 8.3
            </h1>

            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Перетащите сюда JSON-файл выгрузки из 1С (<code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Организация</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Остатки</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Проводки</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">ВсеСправочники</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">ВсеДокументы</code>) либо получите данные через HTTP-эндпоинт{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">/api/1c-sync</code>.
            </p>

            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Выбрать файл выгрузки 1С (.json)
              </button>

              <button
                type="button"
                onClick={() => syncWith1CEndpoint(false)}
                disabled={syncStatus === 'syncing'}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-zinc-800 dark:text-zinc-200 transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin text-amber-600' : ''}`}
                />
                Синхронизировать /api/1c-sync
              </button>
            </div>

            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Работаете с чистой базой без выгрузки?</span>
              <button
                type="button"
                onClick={() => setActiveTab('import_postings')}
                className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400 hover:underline"
              >
                Перейти сразу к загрузке первичных документов
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const allBalanced =
    osvReport.totals.isStartBalanced &&
    osvReport.totals.isTurnoverBalanced &&
    osvReport.totals.isEndBalanced;

  return (
    <div className="space-y-4">
      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Сальдо на начало (Дт)
          </div>
          <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-zinc-950 dark:text-white">
            {formatMoneyWithCurrency(osvReport.totals.startDebit)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            Кт: {formatMoneyWithCurrency(osvReport.totals.startCredit)}
          </div>
        </div>

        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Обороты за период
          </div>
          <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-zinc-950 dark:text-white">
            {formatMoneyWithCurrency(osvReport.totals.turnoverDebit)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            Проводок БД: {db1C?.postings.length ?? 0} · Новых оп.: {activeOpsCount}
          </div>
        </div>

        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Сальдо на конец (Дт)
          </div>
          <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-zinc-950 dark:text-white">
            {formatMoneyWithCurrency(osvReport.totals.endDebit)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            Кт: {formatMoneyWithCurrency(osvReport.totals.endCredit)}
          </div>
        </div>

        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Контроль баланса ОСВ
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {allBalanced ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Дт === Кт сходится
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  Расхождение {formatMoneyWithCurrency(osvReport.totals.endDiff)}
                </span>
              </>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
            Счетов с движением: {osvReport.leafRows.length}
          </div>
        </div>

        <div className="col-span-2 lg:col-span-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Объекты БД 1С
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-white font-mono tabular-nums">
            {db1C
              ? `${Object.keys(db1C.rawDirectories).length} справ. / ${db1C.documents.length} док.`
              : 'Нет БД'}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
            {db1C ? `Контрагентов: ${db1C.counterparties.length}` : 'Только загруженные файлы'}
          </div>
        </div>
      </div>

      {/* Sub-navigation: OSV vs 1C Database Explorer */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubView('osv')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subView === 'osv'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Оборотно-сальдовая ведомость (ОСВ)
          </button>
          <button
            type="button"
            onClick={() => setSubView('explorer')}
            disabled={!db1C}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
              subView === 'explorer'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Справочники, Документы и Регистры 1С
          </button>
        </div>

        {subView === 'osv' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700">
              <input
                type="checkbox"
                checked={includeQueuedInOsv}
                onChange={(e) => setIncludeQueuedInOsv(e.target.checked)}
                className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-zinc-700 dark:text-zinc-300">
                Включать новые операции ({activeOpsCount})
              </span>
            </label>

            {db1C && db1C.rawBalances.length > 0 && !db1C.rawBalances.some((b) => b.hasExplicitStart && b.hasExplicitEnd) && (
              <select
                aria-label="Режим трактовки секции Остатки"
                value={balanceAnchorOverride}
                onChange={(e) =>
                  setBalanceAnchorOverride(e.target.value as BalanceAnchorOverride)
                }
                className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300"
              >
                <option value="auto">Режим сальдо: Автоопределение</option>
                <option value="treat_raw_as_end">
                  Остатки в файле = Конец периода (обратный счёт Нач)
                </option>
                <option value="treat_raw_as_start">
                  Остатки в файле = Начало периода (прямой счёт Кон)
                </option>
              </select>
            )}

            <button
              type="button"
              onClick={() => setAllGroupsCollapsed(false)}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
            >
              Развернуть субсчета
            </button>
            <button
              type="button"
              onClick={() => setAllGroupsCollapsed(true)}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
            >
              Свернуть группы
            </button>
            <button
              type="button"
              onClick={exportOsvToExcel}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium text-zinc-800 dark:text-zinc-200"
            >
              <Download className="w-3.5 h-3.5 text-amber-600" />
              ОСВ (.xlsx)
            </button>
          </div>
        )}
      </div>

      {/* SUBVIEW 1: OSV TABLE + DRILLDOWN */}
      {subView === 'osv' && (
        <div className="space-y-4">
          {/* Balance calculation provenance bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-600 dark:text-zinc-400">
            <span>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                Методика расчёта сальдо ({reportingYear} г.):{' '}
              </strong>
              {osvReport.balanceModeDescription}
              {historicalPostingsCount > 0 && (
                <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                  · Архивные проводки до 01.01.{reportingYear} ({historicalPostingsCount} шт.) свёрнуты во входящее сальдо
                </span>
              )}
            </span>
            <span className="font-mono tabular-nums">
              {periodFilter.dateFrom || periodFilter.dateTo
                ? `Период отбора: ${formatDateRu(periodFilter.dateFrom)} — ${formatDateRu(
                    periodFilter.dateTo
                  )}`
                : `Отчётный ${reportingYear} год`}
            </span>
          </div>

          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 text-zinc-600 dark:text-zinc-400">
                  <th rowSpan={2} className="py-2.5 px-3 text-left font-semibold w-24 border-r border-zinc-200 dark:border-zinc-800">
                    Счёт
                  </th>
                  <th rowSpan={2} className="py-2.5 px-3 text-left font-semibold min-w-[220px] border-r border-zinc-200 dark:border-zinc-800">
                    Наименование счёта
                  </th>
                  <th colSpan={2} className="py-1.5 px-3 text-center font-semibold border-b border-r border-zinc-200 dark:border-zinc-800">
                    Сальдо на начало периода
                  </th>
                  <th colSpan={2} className="py-1.5 px-3 text-center font-semibold border-b border-r border-zinc-200 dark:border-zinc-800">
                    Обороты за период
                  </th>
                  <th colSpan={2} className="py-1.5 px-3 text-center font-semibold border-b border-zinc-200 dark:border-zinc-800">
                    Сальдо на конец периода
                  </th>
                </tr>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/50 text-[11px] text-zinc-500">
                  <th className="py-1.5 px-3 text-right font-medium border-r border-zinc-200 dark:border-zinc-800 w-32">
                    Дебет
                  </th>
                  <th className="py-1.5 px-3 text-right font-medium border-r border-zinc-200 dark:border-zinc-800 w-32">
                    Кредит
                  </th>
                  <th className="py-1.5 px-3 text-right font-medium border-r border-zinc-200 dark:border-zinc-800 w-32">
                    Дебет
                  </th>
                  <th className="py-1.5 px-3 text-right font-medium border-r border-zinc-200 dark:border-zinc-800 w-32">
                    Кредит
                  </th>
                  <th className="py-1.5 px-3 text-right font-medium border-r border-zinc-200 dark:border-zinc-800 w-32">
                    Дебет
                  </th>
                  <th className="py-1.5 px-3 text-right font-medium w-32">
                    Кредит
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {visibleOsvRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-500">
                      Нет движений и остатков за выбранный период. Проверьте даты фильтра выше.
                    </td>
                  </tr>
                ) : (
                  visibleOsvRows.map((row) => {
                    const isCollapsed = Boolean(collapsedGroups[row.code]);
                    const isSelected = selectedAccountDrilldown === row.code;

                    return (
                      <tr
                        key={row.code}
                        onClick={() =>
                          setSelectedAccountDrilldown(isSelected ? null : row.code)
                        }
                        className={`cursor-pointer transition-colors ${
                          row.isGroup
                            ? 'bg-zinc-50/90 dark:bg-zinc-900/40 font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
                            : isSelected
                              ? 'bg-amber-50/70 dark:bg-amber-950/30'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30 text-zinc-800 dark:text-zinc-200'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {row.isGroup ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleGroupCollapse(row.code);
                                }}
                                className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className={row.parentCode ? 'pl-5' : ''} />
                            )}
                            <span>{row.code}</span>
                          </div>
                        </td>

                        <td className="py-2 px-3 border-r border-zinc-100 dark:border-zinc-800/70">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{row.name}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isOffBalanceAccountCode(row.code) && (
                                <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono text-[10px] font-normal">
                                  забалансовый (не входит в итог Дт=Кт)
                                </span>
                              )}
                              {row.isCollapsedSynthetic && (
                                <span className="text-[10px] font-normal text-zinc-400">
                                  свёрнуто
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70 ${
                            row.hasRedStart && row.type === 'active'
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : ''
                          }`}
                        >
                          {formatMoney(row.startDebit)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70 ${
                            row.hasRedStart && row.type === 'passive'
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : ''
                          }`}
                        >
                          {formatMoney(row.startCredit)}
                        </td>

                        <td className="py-2 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70">
                          {formatMoney(row.turnoverDebit)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70">
                          {formatMoney(row.turnoverCredit)}
                        </td>

                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70 ${
                            row.hasRedEnd && row.type === 'active'
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : ''
                          }`}
                        >
                          {formatMoney(row.endDebit)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums ${
                            row.hasRedEnd && row.type === 'passive'
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : ''
                          }`}
                        >
                          {formatMoney(row.endCredit)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 bg-zinc-100/90 dark:bg-zinc-900 font-semibold text-zinc-950 dark:text-white">
                  <td colSpan={2} className="py-2.5 px-3 border-r border-zinc-200 dark:border-zinc-800">
                    ИТОГО (контроль по субсчетам)
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums border-r border-zinc-200 dark:border-zinc-800">
                    {formatMoney(osvReport.totals.startDebit, true)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums border-r border-zinc-200 dark:border-zinc-800">
                    {formatMoney(osvReport.totals.startCredit, true)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums border-r border-zinc-200 dark:border-zinc-800">
                    {formatMoney(osvReport.totals.turnoverDebit, true)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums border-r border-zinc-200 dark:border-zinc-800">
                    {formatMoney(osvReport.totals.turnoverCredit, true)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums border-r border-zinc-200 dark:border-zinc-800">
                    {formatMoney(osvReport.totals.endDebit, true)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {formatMoney(osvReport.totals.endCredit, true)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Account Card Drilldown Panel */}
          {selectedAccountDrilldown && (
            <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                    Карточка счёта {selectedAccountDrilldown} — проводки за период ({drilldownMovements.length})
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Нажмите на строку счёта повторно, чтобы скрыть карточку
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAccountDrilldown(null)}
                  className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-x-auto max-h-80 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                    <tr>
                      <th className="py-2 px-3 text-left">Дата</th>
                      <th className="py-2 px-3 text-left">Источник</th>
                      <th className="py-2 px-3 text-left">Документ</th>
                      <th className="py-2 px-3 text-left">Дт</th>
                      <th className="py-2 px-3 text-left">Кт</th>
                      <th className="py-2 px-3 text-right">Сумма</th>
                      <th className="py-2 px-3 text-left">Содержание</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {drilldownMovements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-zinc-500">
                          За выбранный период нет оборотов по счёту {selectedAccountDrilldown} (только входящий/исходящий остаток).
                        </td>
                      </tr>
                    ) : (
                      drilldownMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                          <td className="py-1.5 px-3 font-mono tabular-nums whitespace-nowrap">
                            {formatDateRu(m.date)}
                          </td>
                          <td className="py-1.5 px-3 whitespace-nowrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                m.source === 'БД 1С'
                                  ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {m.source}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 max-w-[220px] truncate">{m.doc}</td>
                          <td className="py-1.5 px-3 font-mono font-semibold">{m.debit}</td>
                          <td className="py-1.5 px-3 font-mono font-semibold">{m.credit}</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium">
                            {formatMoney(m.amount, true)}
                          </td>
                          <td className="py-1.5 px-3 text-zinc-600 dark:text-zinc-400">
                            {m.description}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW 2: FULL 1C DATABASE EXPLORER */}
      {subView === 'explorer' && db1C && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-hidden">
          {/* Section tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4 py-2.5 bg-zinc-50/70 dark:bg-zinc-900/40">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {(
                [
                  ['org_policy', 'Организация и Регистры'],
                  ['directories', `ВсеСправочники (${directoryKeys.length})`],
                  ['documents', `ВсеДокументы (${db1C.documents.length})`],
                  ['postings', `Проводки (${db1C.postings.length})`],
                  ['raw_balances', `Остатки в файле (${db1C.rawBalances.length})`],
                ] as Array<[ExplorerSection, string]>
              ).map(([sec, label]) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    setExplorerSection(sec);
                    setSearchQuery('');
                  }}
                  className={`px-3 py-1.5 rounded font-medium transition-colors ${
                    explorerSection === sec
                      ? 'bg-amber-600 text-white'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {explorerSection !== 'org_policy' && (
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по реквизитам, ИНН, сумме..."
                  className="w-full pl-8 pr-3 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:border-amber-600"
                />
              </div>
            )}
          </div>

          {/* 1. Organization & Registers */}
          {explorerSection === 'org_policy' && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="rounded border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                  Карточка организации в 1С
                </h3>
                <dl className="grid grid-cols-3 gap-y-2 gap-x-3">
                  <dt className="text-zinc-500">Сокращённое наим.:</dt>
                  <dd className="col-span-2 font-medium">{db1C.organization.name || '—'}</dd>
                  <dt className="text-zinc-500">Полное наим.:</dt>
                  <dd className="col-span-2">{db1C.organization.fullName || '—'}</dd>
                  <dt className="text-zinc-500">ИНН / КПП:</dt>
                  <dd className="col-span-2 font-mono tabular-nums">
                    {db1C.organization.inn || '—'} / {db1C.organization.kpp || '—'}
                  </dd>
                  <dt className="text-zinc-500">ОГРН:</dt>
                  <dd className="col-span-2 font-mono tabular-nums">{db1C.organization.ogrn || '—'}</dd>
                  <dt className="text-zinc-500">Расчётный счёт:</dt>
                  <dd className="col-span-2 font-mono tabular-nums">
                    {db1C.organization.bankAccount || '—'}
                  </dd>
                  <dt className="text-zinc-500">Банк / БИК:</dt>
                  <dd className="col-span-2">
                    {db1C.organization.bankName || '—'}{' '}
                    {db1C.organization.bik ? `(БИК ${db1C.organization.bik})` : ''}
                  </dd>
                  <dt className="text-zinc-500">Руководитель:</dt>
                  <dd className="col-span-2">{db1C.organization.director || '—'}</dd>
                  <dt className="text-zinc-500">Главный бухгалтер:</dt>
                  <dd className="col-span-2">{db1C.organization.chiefAccountant || '—'}</dd>
                </dl>
              </div>

              <div className="rounded border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                  Учётная политика и РегистрыСведений
                </h3>
                <dl className="grid grid-cols-2 gap-y-2 gap-x-3">
                  <dt className="text-zinc-500">Система налогообложения:</dt>
                  <dd className="font-semibold">{db1C.accountingPolicy.taxSystem}</dd>
                  <dt className="text-zinc-500">Основная ставка НДС:</dt>
                  <dd className="font-mono">{db1C.accountingPolicy.vatRate}%</dd>
                  <dt className="text-zinc-500">Закрытие счёта 26:</dt>
                  <dd>
                    {db1C.accountingPolicy.directCosting26To9008
                      ? 'Директ-костинг (в Дт 90.08.1)'
                      : 'В себестоимость производства (Дт 20.01)'}
                  </dd>
                  <dt className="text-zinc-500">Оценка МПЗ:</dt>
                  <dd>{db1C.accountingPolicy.inventoryValuationMethod}</dd>
                  <dt className="text-zinc-500">Источник выгрузки:</dt>
                  <dd className="font-mono truncate">{db1C.sourceFileName}</dd>
                </dl>

                {Object.keys(db1C.rawRegisters).length > 0 && (
                  <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="text-[11px] font-medium text-zinc-500 mb-1">
                      Данные РегистрыСведений из JSON:
                    </div>
                    <pre className="p-2.5 rounded bg-zinc-50 dark:bg-zinc-950 font-mono text-[11px] max-h-48 overflow-auto">
                      {JSON.stringify(db1C.rawRegisters, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. Dynamic ВсеСправочники Explorer */}
          {explorerSection === 'directories' && (
            <div className="grid grid-cols-1 md:grid-cols-12 min-h-[380px]">
              <div className="md:col-span-3 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 p-2 space-y-1 bg-zinc-50/40 dark:bg-zinc-900/20">
                {directoryKeys.length === 0 ? (
                  <div className="p-4 text-xs text-zinc-500">
                    В выгрузке отсутствует секция ВсеСправочники
                  </div>
                ) : (
                  directoryKeys.map((dirKey) => {
                    const count = db1C.rawDirectories[dirKey]?.length ?? 0;
                    const active = dirKey === activeDirKey;
                    return (
                      <button
                        key={dirKey}
                        type="button"
                        onClick={() => setSelectedDirKey(dirKey)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs text-left transition-colors ${
                          active
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-medium'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <span className="truncate">{dirKey}</span>
                        <span className="font-mono text-[11px] opacity-75 ml-2">{count}</span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="md:col-span-9 overflow-x-auto">
                <DirectoryDynamicTable
                  rows={db1C.rawDirectories[activeDirKey] ?? []}
                  searchQuery={searchQuery}
                />
              </div>
            </div>
          )}

          {/* 3. ВсеДокументы */}
          {explorerSection === 'documents' && (
            <div className="space-y-2">
              <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-zinc-500">Вид документа:</span>
                  <button
                    type="button"
                    onClick={() => setDocKindFilter('ALL')}
                    className={`px-2 py-1 rounded ${
                      docKindFilter === 'ALL'
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    Все ({db1C.documents.length})
                  </button>
                  {Array.from(new Set(db1C.documents.map((d) => d.documentKind))).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setDocKindFilter(kind)}
                      className={`px-2 py-1 rounded ${
                        docKindFilter === kind
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                {historicalDocsCount > 0 && (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={showHistoricalArchive}
                      onChange={(e) => setShowHistoricalArchive(e.target.checked)}
                      className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Показать архив до {reportingYear} г. ({historicalDocsCount})</span>
                  </label>
                )}
              </div>

              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                    <tr>
                      <th className="py-2 px-3 text-left">Статус</th>
                      <th className="py-2 px-3 text-left">Вид документа</th>
                      <th className="py-2 px-3 text-left">Номер</th>
                      <th className="py-2 px-3 text-left">Дата</th>
                      <th className="py-2 px-3 text-left">Контрагент</th>
                      <th className="py-2 px-3 text-left">Договор</th>
                      <th className="py-2 px-3 text-right">Сумма</th>
                      <th className="py-2 px-3 text-left">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {db1C.documents
                      .filter(
                        (d) =>
                          showHistoricalArchive || !d.date || d.date >= reportingYearCutoff
                      )
                      .filter((d) => docKindFilter === 'ALL' || d.documentKind === docKindFilter)
                      .filter((d) => {
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        return `${d.documentKind} ${d.number} ${d.counterparty} ${d.contract} ${d.comment} ${d.amount}`
                          .toLowerCase()
                          .includes(q);
                      })
                      .map((doc) => (
                        <tr key={doc.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                          <td className="py-1.5 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                doc.posted
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                              }`}
                            >
                              {doc.posted ? 'Проведён' : 'Не проведён'}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 font-medium">{doc.documentKind}</td>
                          <td className="py-1.5 px-3 font-mono tabular-nums">{doc.number || '—'}</td>
                          <td className="py-1.5 px-3 font-mono tabular-nums whitespace-nowrap">
                            {formatDateRu(doc.date)}
                          </td>
                          <td className="py-1.5 px-3">{doc.counterparty || '—'}</td>
                          <td className="py-1.5 px-3 text-zinc-500">{doc.contract || '—'}</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium">
                            {formatMoney(doc.amount, true)}
                          </td>
                          <td className="py-1.5 px-3 text-zinc-500 max-w-xs truncate">
                            {doc.comment || '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. Проводки */}
          {explorerSection === 'postings' && (
            <div className="space-y-2">
              {historicalPostingsCount > 0 && (
                <div className="px-4 pt-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                  <span>
                    По умолчанию отображаются проводки отчётного {reportingYear} года (архив до 01.01.{reportingYear} учтён во входящем сальдо ОСВ).
                  </span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={showHistoricalArchive}
                      onChange={(e) => setShowHistoricalArchive(e.target.checked)}
                      className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Показать архив до {reportingYear} г. ({historicalPostingsCount})</span>
                  </label>
                </div>
              )}
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                    <tr>
                      <th className="py-2 px-3 text-left">Дата</th>
                      <th className="py-2 px-3 text-left">Регистратор</th>
                      <th className="py-2 px-3 text-left">Дт</th>
                      <th className="py-2 px-3 text-left">Субконто Дт</th>
                      <th className="py-2 px-3 text-left">Кт</th>
                      <th className="py-2 px-3 text-left">Субконто Кт</th>
                      <th className="py-2 px-3 text-right">Сумма</th>
                      <th className="py-2 px-3 text-left">Содержание</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {db1C.postings
                      .filter(
                        (p) =>
                          showHistoricalArchive || !p.date || p.date >= reportingYearCutoff
                      )
                      .filter((p) => {
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        return `${p.date} ${p.debit} ${p.credit} ${p.documentLabel} ${p.description} ${p.debitSubconto.join(' ')} ${p.creditSubconto.join(' ')}`
                          .toLowerCase()
                          .includes(q);
                      })
                    .map((p) => (
                      <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                        <td className="py-1.5 px-3 font-mono tabular-nums whitespace-nowrap">
                          {formatDateRu(p.date)}
                        </td>
                        <td className="py-1.5 px-3 max-w-[220px] truncate">
                          {p.documentLabel || `${p.documentType} №${p.documentNumber}`}
                        </td>
                        <td className="py-1.5 px-3 font-mono font-semibold">{p.debit}</td>
                        <td className="py-1.5 px-3 text-zinc-500 max-w-[180px] truncate">
                          {p.debitSubconto.join(' / ') || '—'}
                        </td>
                        <td className="py-1.5 px-3 font-mono font-semibold">{p.credit}</td>
                        <td className="py-1.5 px-3 text-zinc-500 max-w-[180px] truncate">
                          {p.creditSubconto.join(' / ') || '—'}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium">
                          {formatMoney(p.amount, true)}
                        </td>
                        <td className="py-1.5 px-3 text-zinc-500">{p.description}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* 5. Исходные остатки из файла */}
          {explorerSection === 'raw_balances' && (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                  <tr>
                    <th className="py-2 px-3 text-left">Счёт</th>
                    <th className="py-2 px-3 text-left">Субконто</th>
                    <th className="py-2 px-3 text-right">Остаток Дт (файл)</th>
                    <th className="py-2 px-3 text-right">Остаток Кт (файл)</th>
                    <th className="py-2 px-3 text-right">Кол-во</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {db1C.rawBalances.map((b) => (
                    <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                      <td className="py-1.5 px-3 font-mono font-semibold">{b.account}</td>
                      <td className="py-1.5 px-3 text-zinc-500">{b.subconto || '—'}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {formatMoney(b.rawDebit || b.startDebit || b.endDebit)}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {formatMoney(b.rawCredit || b.startCredit || b.endCredit)}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {b.quantity ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DirectoryDynamicTable({
  rows,
  searchQuery,
}: {
  rows: Record<string, unknown>[];
  searchQuery: string;
}) {
  const columns = useMemo(() => {
    const colSet = new Set<string>();
    for (const r of rows.slice(0, 50)) {
      for (const k of Object.keys(r)) {
        if (k !== 'Ref_Key' && k !== 'Ссылка') {
          colSet.add(k);
        }
      }
    }
    return Array.from(colSet).slice(0, 8);
  }, [rows]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, searchQuery]);

  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-zinc-500">
        Справочник пуст в выгруженной базе 1С.
      </div>
    );
  }

  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
          <tr>
            {columns.map((col) => (
              <th key={col} className="py-2 px-3 text-left font-medium whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {filtered.map((row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
              {columns.map((col) => {
                const val = row[col];
                const str =
                  val === null || val === undefined
                    ? '—'
                    : typeof val === 'object'
                      ? JSON.stringify(val)
                      : String(val);
                return (
                  <td
                    key={col}
                    className={`py-1.5 px-3 max-w-[260px] truncate ${
                      /инн|кпп|код|номер|счет|бик/i.test(col) ? 'font-mono tabular-nums' : ''
                    }`}
                  >
                    {str || '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
