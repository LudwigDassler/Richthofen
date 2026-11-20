'use client';

import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FolderOpen,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { isOffBalanceAccountCode } from '@/data/chartOfAccounts';
import {
  BalanceAnchorOverride,
  OsvAccountMovement,
  OsvSourceMode,
} from '@/types/accounting';
import { formatDateRu, formatMoney, formatMoneyWithCurrency } from '@/lib/formatters';

type SubView = 'osv' | 'explorer';
type ExplorerSection = 'org_policy' | 'directories' | 'documents' | 'postings' | 'raw_balances';

const MONTH_OPTIONS = [
  { num: 1, label: 'Январь' },
  { num: 2, label: 'Февраль' },
  { num: 3, label: 'Март' },
  { num: 4, label: 'Апрель' },
  { num: 5, label: 'Май' },
  { num: 6, label: 'Июнь' },
  { num: 7, label: 'Июль' },
  { num: 8, label: 'Август' },
  { num: 9, label: 'Сентябрь' },
  { num: 10, label: 'Октябрь' },
  { num: 11, label: 'Ноябрь' },
  { num: 12, label: 'Декабрь' },
];

function getMonthRange(year: number, month1To12: number): { dateFrom: string; dateTo: string } {
  const m = String(month1To12).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
  return {
    dateFrom: `${year}-${m}-01`,
    dateTo: `${year}-${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function Tab1DatabaseOsv() {
  const {
    db1C,
    syncStatus,
    reportingYear,
    operations,
    osvReport,
    balanceAnchorOverride,
    setBalanceAnchorOverride,
    osvSourceMode,
    setOsvSourceMode,
    periodFilter,
    setPeriodFilter,
    load1CJsonFile,
    syncWith1CEndpoint,
    runSmartAutoFixAll,
    jumpToOperation,
    setActiveTab,
  } = useAccountant();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [subView, setSubView] = useState<SubView>('osv');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [expandSubconto, setExpandSubconto] = useState<boolean>(false);
  const [showOffBalance, setShowOffBalance] = useState<boolean>(true);
  const [osvAccountSearch, setOsvAccountSearch] = useState<string>('');
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

  const activeOpsCount = operations.filter(
    (o) => o.includeInProcessing && !o.isDuplicateIn1C
  ).length;

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

  const periodPresets = useMemo(
    () => [
      {
        id: 'q1',
        label: `1 кв. ${reportingYear}`,
        dateFrom: `${reportingYear}-01-01`,
        dateTo: `${reportingYear}-03-31`,
      },
      {
        id: 'q2',
        label: `2 кв. ${reportingYear}`,
        dateFrom: `${reportingYear}-04-01`,
        dateTo: `${reportingYear}-06-30`,
      },
      {
        id: 'q3',
        label: `3 кв. ${reportingYear}`,
        dateFrom: `${reportingYear}-07-01`,
        dateTo: `${reportingYear}-09-30`,
      },
      {
        id: 'h1',
        label: 'Полугодие',
        dateFrom: `${reportingYear}-01-01`,
        dateTo: `${reportingYear}-06-30`,
      },
      {
        id: '9m',
        label: '9 месяцев',
        dateFrom: `${reportingYear}-01-01`,
        dateTo: `${reportingYear}-09-30`,
      },
      {
        id: 'year',
        label: `Год ${reportingYear}`,
        dateFrom: `${reportingYear}-01-01`,
        dateTo: `${reportingYear}-12-31`,
      },
    ],
    [reportingYear]
  );

  const selectedMonthValue = useMemo(() => {
    for (const m of MONTH_OPTIONS) {
      const range = getMonthRange(reportingYear, m.num);
      if (periodFilter.dateFrom === range.dateFrom && periodFilter.dateTo === range.dateTo) {
        return String(m.num);
      }
    }
    return '';
  }, [periodFilter.dateFrom, periodFilter.dateTo, reportingYear]);

  const visibleOsvRows = useMemo(() => {
    const q = osvAccountSearch.trim().toLowerCase();
    return osvReport.rows.filter((row) => {
      if (!showOffBalance && isOffBalanceAccountCode(row.code)) {
        return false;
      }
      if (q) {
        const subRows = osvReport.subcontoRowsByAccount?.[row.code] ?? [];
        const matchesSubconto = subRows.some((s) =>
          s.subcontoLabel.toLowerCase().includes(q)
        );
        return (
          row.code.toLowerCase().includes(q) ||
          row.name.toLowerCase().includes(q) ||
          matchesSubconto
        );
      }
      if (row.isGroup) return true;
      if (row.parentCode && collapsedGroups[row.parentCode]) {
        return false;
      }
      return true;
    });
  }, [
    osvReport.rows,
    osvReport.subcontoRowsByAccount,
    collapsedGroups,
    showOffBalance,
    osvAccountSearch,
  ]);

  const selectedOsvRow = useMemo(
    () =>
      selectedAccountDrilldown
        ? osvReport.rows.find((r) => r.code === selectedAccountDrilldown) ?? null
        : null,
    [osvReport.rows, selectedAccountDrilldown]
  );

  const drilldownMovements: OsvAccountMovement[] = useMemo(() => {
    if (!selectedAccountDrilldown) return [];
    const direct = osvReport.movementsByAccount?.[selectedAccountDrilldown];
    if (direct && direct.length > 0) return direct;

    // Fallback aggregation if synthetic group row (e.g. '60' or '90') was clicked
    const byChildren: OsvAccountMovement[] = [];
    const map = osvReport.movementsByAccount ?? {};
    for (const [accCode, list] of Object.entries(map)) {
      if (
        accCode === selectedAccountDrilldown ||
        accCode.startsWith(`${selectedAccountDrilldown}.`)
      ) {
        byChildren.push(...list);
      }
    }
    return byChildren.sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedAccountDrilldown, osvReport.movementsByAccount]);

  const exportOsvToExcel = () => {
    const sourceLabel =
      osvSourceMode === 'combined'
        ? 'База 1С + новые операции'
        : osvSourceMode === 'queued_only'
          ? 'Только новые операции'
          : 'Только база 1С';

    const bodyRows: Array<Array<string | number>> = [];
    for (const r of visibleOsvRows) {
      bodyRows.push([
        r.code,
        r.name,
        r.startDebit,
        r.startCredit,
        r.turnoverDebit,
        r.turnoverCredit,
        r.endDebit,
        r.endCredit,
      ]);
      if (expandSubconto && !r.isGroup) {
        const subs = osvReport.subcontoRowsByAccount?.[r.code] ?? [];
        for (const sub of subs) {
          bodyRows.push([
            `  ↳ субконто`,
            sub.subcontoLabel,
            sub.startDebit,
            sub.startCredit,
            sub.turnoverDebit,
            sub.turnoverCredit,
            sub.endDebit,
            sub.endCredit,
          ]);
        }
      }
    }

    const sheetData: Array<Array<string | number>> = [
      [
        `Оборотно-сальдовая ведомость — ${db1C?.organization.name || 'Учебная организация'} (ИНН ${
          db1C?.organization.inn || '—'
        })`,
      ],
      [
        `Период: ${formatDateRu(periodFilter.dateFrom)} — ${formatDateRu(
          periodFilter.dateTo
        )} · Режим: ${sourceLabel}`,
      ],
      [`Методика: ${osvReport.balanceModeDescription}`],
      [],
      [
        'Счёт',
        'Наименование счёта / Субконто',
        'Сальдо нач. Дт',
        'Сальдо нач. Кт',
        'Обороты Дт',
        'Обороты Кт',
        'Сальдо кон. Дт',
        'Сальдо кон. Кт',
      ],
      ...bodyRows,
      [
        'ИТОГО',
        'Контроль двойной записи по балансовым субсчетам',
        osvReport.totals.startDebit,
        osvReport.totals.startCredit,
        osvReport.totals.turnoverDebit,
        osvReport.totals.turnoverCredit,
        osvReport.totals.endDebit,
        osvReport.totals.endCredit,
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 46 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ОСВ_1С_8_3');
    XLSX.writeFile(
      wb,
      `OSV_${db1C?.organization.inn || reportingYear}_${periodFilter.dateFrom || 'start'}_${
        periodFilter.dateTo || 'end'
      }.xlsx`
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
              Оборотно-сальдовая ведомость и база 1С:Бухгалтерия 8.3
            </h1>

            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Перетащите сюда JSON-выгрузку базы 1С (<code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Организация</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Остатки</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Проводки</code>,{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">ВсеСправочники</code>) либо сразу загрузите Excel-файлы учебного задания во вкладке «Загрузка и автопроводки» — сводная ОСВ построится автоматически.
            </p>

            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Выбрать выгрузку базы 1С (.json)
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('import_postings')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition-colors"
              >
                Загрузить Excel-файлы с операциями
                <ArrowRight className="w-4 h-4 text-amber-600" />
              </button>
            </div>

            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Подключена внешняя публикация 1С?</span>
              <button
                type="button"
                onClick={() => syncWith1CEndpoint(false)}
                disabled={syncStatus === 'syncing'}
                className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin text-amber-600' : ''}`}
                />
                Проверить /api/1c-sync
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

  const auditorHints = osvReport.auditorHints ?? [];

  return (
    <div className="space-y-4">
      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
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
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Обороты за период
          </div>
          <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-zinc-950 dark:text-white">
            {formatMoneyWithCurrency(osvReport.totals.turnoverDebit)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            БД: {db1C?.postings.length ?? 0} · Новых оп.: {activeOpsCount}
          </div>
        </div>

        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
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
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Контроль двойной записи
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {allBalanced ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Σ Дт = Σ Кт сходится
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span className="text-sm font-semibold font-mono tabular-nums text-red-600 dark:text-red-400">
                  Δ {formatMoneyWithCurrency(osvReport.totals.endDiff)}
                </span>
              </>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
            Счетов с движением: {osvReport.leafRows.length}
          </div>
        </div>

        <div className="col-span-2 lg:col-span-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3.5 flex flex-col justify-between">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Быстрые переходы
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('import_postings')}
              className="font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
            >
              Операции ({operations.length}) →
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit_autofix')}
              className="font-medium text-zinc-700 dark:text-zinc-300 hover:underline whitespace-nowrap"
            >
              Аудит →
            </button>
          </div>
        </div>
      </div>

      {/* Sub-navigation + Source Segmented Control */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-zinc-100 dark:bg-zinc-900 max-w-full">
            <button
              type="button"
              onClick={() => setSubView('osv')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                subView === 'osv'
                  ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="sm:hidden">Ведомость (ОСВ)</span>
              <span className="hidden sm:inline">Оборотно-сальдовая ведомость (ОСВ)</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('explorer')}
              disabled={!db1C}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 ${
                subView === 'explorer'
                  ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Справочники, Документы и Регистры 1С
            </button>
          </div>

          {/* 3-Way Source Segmented Control */}
          {subView === 'osv' && (
            <div
              role="group"
              aria-label="Источник данных ОСВ"
              className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-zinc-100 dark:bg-zinc-900 text-xs"
            >
              {(
                [
                  ['combined', `База 1С + новые операции (${activeOpsCount})`],
                  ['queued_only', 'Только новые операции'],
                  ['db_only', 'Только база 1С'],
                ] as Array<[OsvSourceMode, string]>
              ).map(([mode, label]) => {
                const active = osvSourceMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setOsvSourceMode(mode)}
                    className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Flexible Period Bar + Quick Presets + Search & Toggles */}
        {subView === 'osv' && (
          <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Arbitrary Date Inputs + Month Dropdown */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                  <Calendar className="w-3.5 h-3.5 text-amber-600" />
                  Период ОСВ:
                </span>
                <input
                  type="date"
                  aria-label="ОСВ с даты"
                  value={periodFilter.dateFrom}
                  onChange={(e) =>
                    setPeriodFilter({ ...periodFilter, dateFrom: e.target.value })
                  }
                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-amber-600"
                />
                <span className="text-zinc-400">—</span>
                <input
                  type="date"
                  aria-label="ОСВ по дату"
                  value={periodFilter.dateTo}
                  onChange={(e) =>
                    setPeriodFilter({ ...periodFilter, dateTo: e.target.value })
                  }
                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-amber-600"
                />

                <select
                  aria-label="Быстрый выбор месяца"
                  value={selectedMonthValue}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val >= 1 && val <= 12) {
                      setPeriodFilter(getMonthRange(reportingYear, val));
                    } else {
                      setPeriodFilter({
                        dateFrom: `${reportingYear}-01-01`,
                        dateTo: `${reportingYear}-12-31`,
                      });
                    }
                  }}
                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200"
                >
                  <option value="">По месяцам ({reportingYear})...</option>
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.num} value={m.num}>
                      {m.label} {reportingYear}
                    </option>
                  ))}
                </select>
              </div>

              {/* 1-Click Quarter / Half-year / Year Presets */}
              <div className="flex flex-wrap items-center gap-1">
                {periodPresets.map((preset) => {
                  const isCurrent =
                    periodFilter.dateFrom === preset.dateFrom &&
                    periodFilter.dateTo === preset.dateTo;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setPeriodFilter({
                          dateFrom: preset.dateFrom,
                          dateTo: preset.dateTo,
                        })
                      }
                      className={`px-2 py-1 rounded border text-[11px] font-medium whitespace-nowrap transition-colors ${
                        isCurrent
                          ? 'border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search + Subconto / Off-balance Toggles + Excel Export */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-56 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Поиск счёта или субконто в ОСВ"
                    value={osvAccountSearch}
                    onChange={(e) => setOsvAccountSearch(e.target.value)}
                    placeholder="Код счёта, название или субконто..."
                    className="w-full pl-8 pr-7 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-amber-600"
                  />
                  {osvAccountSearch && (
                    <button
                      type="button"
                      aria-label="Очистить поиск счёта"
                      onClick={() => setOsvAccountSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-900/50">
                  <input
                    type="checkbox"
                    checked={expandSubconto}
                    onChange={(e) => setExpandSubconto(e.target.checked)}
                    className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-zinc-800 dark:text-zinc-200 font-medium whitespace-nowrap">
                    Развернуть по субконто
                  </span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-900/50">
                  <input
                    type="checkbox"
                    checked={showOffBalance}
                    onChange={(e) => setShowOffBalance(e.target.checked)}
                    className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                    Забалансовые (МЦ.02, МЦ.04)
                  </span>
                </label>

                {db1C &&
                  db1C.rawBalances.length > 0 &&
                  !db1C.rawBalances.some((b) => b.hasExplicitStart && b.hasExplicitEnd) && (
                    <select
                      aria-label="Режим трактовки секции Остатки"
                      value={balanceAnchorOverride}
                      onChange={(e) =>
                        setBalanceAnchorOverride(e.target.value as BalanceAnchorOverride)
                      }
                      className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300"
                    >
                      <option value="auto">Сальдо БД: Авто</option>
                      <option value="treat_raw_as_end">Остатки файла = Конец периода</option>
                      <option value="treat_raw_as_start">Остатки файла = Начало периода</option>
                    </select>
                  )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAllGroupsCollapsed(false)}
                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 whitespace-nowrap"
                >
                  Развернуть субсчета
                </button>
                <button
                  type="button"
                  onClick={() => setAllGroupsCollapsed(true)}
                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 whitespace-nowrap"
                >
                  Свернуть группы
                </button>
                <button
                  type="button"
                  onClick={exportOsvToExcel}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950 font-medium whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600" />
                  Скачать ОСВ в Excel (.xlsx)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SUBVIEW 1: INTERACTIVE OSV + 5 SMART AUDITOR HINTS + SLIDE-OVER ACCOUNT CARD */}
      {subView === 'osv' && (
        <div className="space-y-4">
          {/* 5 Smart Auditor Hints Block */}
          {auditorHints.length > 0 && (
            <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] divide-y divide-zinc-100 dark:divide-zinc-800/80">
              <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/70 dark:bg-zinc-900/40 text-xs">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Умные подсказки главного бухгалтера по текущей ОСВ ({formatDateRu(periodFilter.dateFrom)} — {formatDateRu(periodFilter.dateTo)})
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  Нажмите на любой счёт в таблице ниже, чтобы открыть «Карточку счёта»
                </span>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {auditorHints.map((hint) => (
                  <div
                    key={hint.id}
                    className="px-4 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 text-xs"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {hint.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      ) : hint.severity === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {hint.title}
                          </span>
                          {hint.accountCode && (
                            <button
                              type="button"
                              onClick={() => setSelectedAccountDrilldown(hint.accountCode!)}
                              className="font-mono text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
                            >
                              · Карточка счёта {hint.accountCode}
                            </button>
                          )}
                        </div>
                        <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          {hint.explanation}
                        </p>
                        {hint.howToFix1C && (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                              В 1С:БП 3.0:{' '}
                            </strong>
                            {hint.howToFix1C}
                          </p>
                        )}
                      </div>
                    </div>

                    {(hint.quickAction === 'run_autofix' ||
                      (hint.quickAction === 'jump_operation' && hint.operationId)) && (
                      <div className="flex items-center gap-2 shrink-0 pl-6 lg:pl-0">
                        {hint.quickAction === 'run_autofix' && (
                          <button
                            type="button"
                            onClick={() => runSmartAutoFixAll()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs whitespace-nowrap transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {hint.quickActionLabel || 'Исправить автоматически'}
                          </button>
                        )}
                        {hint.quickAction === 'jump_operation' && hint.operationId && (
                          <button
                            type="button"
                            onClick={() => jumpToOperation(hint.operationId!)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-medium text-xs whitespace-nowrap transition-colors"
                          >
                            {hint.quickActionLabel || 'Перейти к операции'}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Balance calculation provenance bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-600 dark:text-zinc-400">
            <span>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                Методика расчёта ({reportingYear} г.):{' '}
              </strong>
              {osvReport.balanceModeDescription}
              {historicalPostingsCount > 0 && osvSourceMode !== 'queued_only' && (
                <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                  · Архив до 01.01.{reportingYear} ({historicalPostingsCount} провод.) свёрнут во входящее сальдо
                </span>
              )}
            </span>
            <span className="font-mono tabular-nums">
              {formatDateRu(periodFilter.dateFrom)} — {formatDateRu(periodFilter.dateTo)}
            </span>
          </div>

          {/* Main OSV Table */}
          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 text-zinc-600 dark:text-zinc-400">
                  <th
                    rowSpan={2}
                    className="py-2.5 px-3 text-left font-semibold w-28 border-r border-zinc-200 dark:border-zinc-800"
                  >
                    Счёт
                  </th>
                  <th
                    rowSpan={2}
                    className="py-2.5 px-3 text-left font-semibold min-w-[240px] border-r border-zinc-200 dark:border-zinc-800"
                  >
                    Наименование счёта {expandSubconto ? '/ Субконто' : ''}
                  </th>
                  <th
                    colSpan={2}
                    className="py-1.5 px-3 text-center font-semibold border-b border-r border-zinc-200 dark:border-zinc-800"
                  >
                    Сальдо на начало периода
                  </th>
                  <th
                    colSpan={2}
                    className="py-1.5 px-3 text-center font-semibold border-b border-r border-zinc-200 dark:border-zinc-800"
                  >
                    Обороты за период
                  </th>
                  <th
                    colSpan={2}
                    className="py-1.5 px-3 text-center font-semibold border-b border-zinc-200 dark:border-zinc-800"
                  >
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
                  <th className="py-1.5 px-3 text-right font-medium w-32">Кредит</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {visibleOsvRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-500">
                      Нет движений и остатков за выбранный период ({formatDateRu(periodFilter.dateFrom)} — {formatDateRu(periodFilter.dateTo)}).
                    </td>
                  </tr>
                ) : (
                  visibleOsvRows.map((row) => {
                    const isCollapsed = Boolean(collapsedGroups[row.code]);
                    const isSelected = selectedAccountDrilldown === row.code;
                    const subRows =
                      expandSubconto && !row.isGroup
                        ? osvReport.subcontoRowsByAccount?.[row.code] ?? []
                        : [];

                    return (
                      <React.Fragment key={row.code}>
                        <tr
                          onClick={() => setSelectedAccountDrilldown(row.code)}
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
                                  aria-label={`Свернуть или развернуть счёт ${row.code}`}
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
                              <div className="flex items-center gap-2 shrink-0 text-[11px] text-zinc-400">
                                {isOffBalanceAccountCode(row.code) && (
                                  <span className="font-mono">забаланс</span>
                                )}
                                {row.isCollapsedSynthetic && <span>свёрнуто</span>}
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

                        {/* Subconto Expansion Rows */}
                        {subRows.map((sub) => (
                          <tr
                            key={`${row.code}:sub:${sub.subcontoKey}`}
                            onClick={() => setSelectedAccountDrilldown(row.code)}
                            className="cursor-pointer bg-zinc-50/40 dark:bg-zinc-900/20 hover:bg-zinc-100/60 dark:hover:bg-zinc-900/50 text-[11px] text-zinc-600 dark:text-zinc-400"
                          >
                            <td className="py-1.5 px-3 pl-9 font-mono text-zinc-400 border-r border-zinc-100 dark:border-zinc-800/70">
                              ↳ субконто
                            </td>
                            <td className="py-1.5 px-3 pl-6 border-r border-zinc-100 dark:border-zinc-800/70 truncate">
                              {sub.subcontoLabel}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70">
                              {formatMoney(sub.startDebit)}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70">
                              {formatMoney(sub.startCredit)}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70">
                              {formatMoney(sub.turnoverDebit)}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70">
                              {formatMoney(sub.turnoverCredit)}
                            </td>
                            <td
                              className={`py-1.5 px-3 text-right font-mono tabular-nums border-r border-zinc-100 dark:border-zinc-800/70 ${
                                sub.hasRedEnd ? 'text-red-600 dark:text-red-400 font-semibold' : ''
                              }`}
                            >
                              {formatMoney(sub.endDebit)}
                            </td>
                            <td
                              className={`py-1.5 px-3 text-right font-mono tabular-nums ${
                                sub.hasRedEnd ? 'text-red-600 dark:text-red-400 font-semibold' : ''
                              }`}
                            >
                              {formatMoney(sub.endCredit)}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 bg-zinc-100/90 dark:bg-zinc-900 font-semibold text-zinc-950 dark:text-white">
                  <td
                    colSpan={2}
                    className="py-2.5 px-3 border-r border-zinc-200 dark:border-zinc-800"
                  >
                    ИТОГО по балансовым субсчетам
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

          {/* Slide-Over Drawer: Карточка счёта 1С */}
          {selectedAccountDrilldown && (
            <div
              className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[1px]"
              onClick={() => setSelectedAccountDrilldown(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Карточка счёта ${selectedAccountDrilldown}`}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-4xl h-full bg-white dark:bg-[#121418] border-l border-zinc-200 dark:border-zinc-800 shadow-xl flex flex-col"
              >
                {/* Drawer Header */}
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                        1С:БП 3.0 · Карточка счёта
                      </span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">
                        {formatDateRu(periodFilter.dateFrom)} — {formatDateRu(periodFilter.dateTo)}
                      </span>
                      {selectedOsvRow && (
                        <>
                          <span>·</span>
                          <span>
                            Вид счёта:{' '}
                            {selectedOsvRow.type === 'active'
                              ? 'Активный'
                              : selectedOsvRow.type === 'passive'
                                ? 'Пассивный'
                                : 'Активно-пассивный'}
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="text-base font-semibold text-zinc-950 dark:text-white">
                      Счёт {selectedAccountDrilldown} — {selectedOsvRow?.name || 'Движения по счёту'}
                    </h2>
                  </div>

                  <button
                    type="button"
                    aria-label="Закрыть карточку счёта"
                    onClick={() => setSelectedAccountDrilldown(null)}
                    className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Drawer Summary Balances */}
                {selectedOsvRow && (
                  <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">Сальдо на начало</div>
                      <div className="mt-0.5 font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        Дт {formatMoney(selectedOsvRow.startDebit, true)} · Кт{' '}
                        {formatMoney(selectedOsvRow.startCredit, true)}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">Обороты за период</div>
                      <div className="mt-0.5 font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        Дт {formatMoney(selectedOsvRow.turnoverDebit, true)} · Кт{' '}
                        {formatMoney(selectedOsvRow.turnoverCredit, true)}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">Сальдо на конец</div>
                      <div
                        className={`mt-0.5 font-mono font-semibold tabular-nums ${
                          selectedOsvRow.hasRedEnd
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        Дт {formatMoney(selectedOsvRow.endDebit, true)} · Кт{' '}
                        {formatMoney(selectedOsvRow.endCredit, true)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Chronological Movements Table */}
                <div className="flex-1 overflow-auto p-5">
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                        <tr>
                          <th className="py-2 px-3 text-left font-medium">Дата</th>
                          <th className="py-2 px-3 text-left font-medium">Документ и аналитика</th>
                          <th className="py-2 px-3 text-left font-medium">Корр. счёт</th>
                          <th className="py-2 px-3 text-right font-medium">Дебет</th>
                          <th className="py-2 px-3 text-right font-medium">Кредит</th>
                          <th className="py-2 px-3 text-right font-medium">Текущее сальдо</th>
                          <th className="py-2 px-3 text-right font-medium">Действие</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {drilldownMovements.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-10 text-center text-zinc-500">
                              За выбранный период нет оборотов по счёту {selectedAccountDrilldown} (только входящий/исходящий остаток).
                            </td>
                          </tr>
                        ) : (
                          drilldownMovements.map((m) => (
                            <tr
                              key={m.id}
                              className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                            >
                              <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap align-top">
                                {formatDateRu(m.date)}
                                <div className="text-[10px] text-zinc-400 font-sans">
                                  {m.source === 'db' ? 'База 1С' : 'Новая оп.'}
                                </div>
                              </td>
                              <td className="py-2 px-3 align-top max-w-[280px]">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                  {m.docLabel}
                                </div>
                                {m.subconto && (
                                  <div className="text-[11px] text-amber-800 dark:text-amber-300 truncate">
                                    {m.subconto}
                                  </div>
                                )}
                                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2">
                                  {m.description}
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono font-semibold align-top">
                                {m.corrAccount || 'забаланс'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums align-top">
                                {m.debitAmount > 0 ? formatMoney(m.debitAmount, true) : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums align-top">
                                {m.creditAmount > 0 ? formatMoney(m.creditAmount, true) : '—'}
                              </td>
                              <td
                                className={`py-2 px-3 text-right font-mono tabular-nums font-medium align-top whitespace-nowrap ${
                                  m.isRedRunning
                                    ? 'text-red-600 dark:text-red-400 font-semibold'
                                    : 'text-zinc-900 dark:text-zinc-100'
                                }`}
                              >
                                {m.runningDebit > 0
                                  ? `Дт ${formatMoney(m.runningDebit, true)}`
                                  : m.runningCredit > 0
                                    ? `Кт ${formatMoney(m.runningCredit, true)}`
                                    : '0,00'}
                              </td>
                              <td className="py-2 px-3 text-right align-top whitespace-nowrap">
                                {m.operationId ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const targetOpId = m.operationId!;
                                      setSelectedAccountDrilldown(null);
                                      jumpToOperation(targetOpId);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                                  >
                                    Перейти к операции
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-zinc-400">Архив БД</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW 2: FULL 1C DATABASE EXPLORER */}
      {subView === 'explorer' && db1C && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-hidden">
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
                              className={`text-[11px] font-medium ${
                                doc.posted
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-zinc-500'
                              }`}
                            >
                              {doc.posted ? 'Проведён' : 'Черновик'}
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

          {explorerSection === 'postings' && (
            <div className="space-y-2">
              {historicalPostingsCount > 0 && (
                <div className="px-4 pt-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                  <span>
                    Отображаются проводки отчётного {reportingYear} года (архив до 01.01.{reportingYear} свёрнут во входящее сальдо ОСВ).
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
