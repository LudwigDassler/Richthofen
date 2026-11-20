'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  CopyCheck,
  FilePlus2,
  FolderUp,
  Info,
  Layers,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { CHART_OF_ACCOUNTS, isOffBalanceAccountCode } from '@/data/chartOfAccounts';
import {
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  DocType1CBP30,
  EgrulCandidate,
  OperationCardProfile,
  OperationReadinessStatus,
  QueuedOperation,
} from '@/types/accounting';
import {
  buildOperationMentorGuide1C,
  DOC_TYPE_LABELS_1C,
  doesOperationRequireCounterparty,
  getCounterpartyGroupKey,
  getOperationCardProfile,
  getOperationStatusBadgeText,
  isInternalWarehouseOrProductionOp,
} from '@/lib/engine';
import { formatDateRu, formatMoney } from '@/lib/formatters';
import { parseRussianNumber } from '@/lib/import1c';

const DOC_TYPES_1C: DocType1CBP30[] = [
  'СписаниеСРасчетногоСчета',
  'ПоступлениеНаРасчетныйСчет',
  'ПоступлениеТоваровУслуг',
  'РеализацияТоваровУслуг',
  'ПоступлениеНаличных',
  'ВыдачаНаличных',
  'АвансовыйОтчет',
  'РасходМатериалов',
  'ПередачаМатериаловВЭксплуатацию',
  'ПеремещениеТоваров',
  'ВыпускПродукции',
  'ПринятиеКУчетуОС',
  'ПриемНаРаботу',
  'НачислениеЗарплаты',
  'ВедомостьВБанк',
  'ВедомостьВКассу',
  'СчетФактураПолученный',
  'СчетФактураВыданный',
  'КорректировкаДолга',
  'ОперацияБух',
  'ЗакрытиеМесяца',
];

const COST_ACCOUNT_OPTIONS = [
  { code: '20.01', label: '20.01 — Основное производство' },
  { code: '25', label: '25 — Общепроизводственные расходы' },
  { code: '26', label: '26 — Общехозяйственные расходы' },
  { code: '44.01', label: '44.01 — Издержки обращения' },
  { code: '91.02', label: '91.02 — Прочие расходы' },
];

const PAYROLL_COST_ACCOUNTS = [
  { code: '20.01', label: '20.01 — Основное производство' },
  { code: '26', label: '26 — Общехозяйственные расходы (АУП)' },
  { code: '25', label: '25 — Общепроизводственные расходы' },
  { code: '44.01', label: '44.01 — Издержки обращения' },
];

const ACCOUNTABLE_EXPENSE_ACCOUNTS = [
  { code: '10.09', label: '10.09 — Инвентарь и хозяйственные принадлежности' },
  { code: '10.01', label: '10.01 — Сырьё и материалы' },
  { code: '10.03', label: '10.03 — Топливо (ГСМ)' },
  { code: '26', label: '26 — Общехозяйственные / командировочные расходы' },
  { code: '20.01', label: '20.01 — Основное производство' },
];

const PROFILE_LABELS: Record<OperationCardProfile, string> = {
  trade_services: 'Покупки / Продажи / Контрагенты',
  accountable_71: 'Подотчётные лица (счёт 71.01)',
  warehouse_production: 'Склад и производство',
  hr_payroll: 'Зарплата и кадры',
  os_regulatory: 'ОС и закрытие периода',
  taxes_bank_founders: 'Налоги, касса, банк, займы, учредители',
};

interface QuickPickCounterpartyChip {
  name: string;
  inn: string;
  kpp: string;
  hint: string;
}

function deriveReadinessStatus(op: QueuedOperation): OperationReadinessStatus {
  if (op.category === 'hr_hire' || op.docType1C === 'ПриемНаРаботу') {
    return 'ready';
  }
  if (op.readinessStatus) return op.readinessStatus;
  if (op.amountMode === 'calculated_by_1c') return 'calculated_1c';
  if (op.amountMode === 'required_missing' || op.needsAmount) return 'critical_error';
  if (
    doesOperationRequireCounterparty(op.category) &&
    op.counterpartyName.trim().length < 2
  ) {
    return 'critical_error';
  }
  return 'ready';
}

function getQuarterFromIsoDate(iso: string): 'q1' | 'q2' | 'q3' | 'q4' | '' {
  const m = Number((iso || '').slice(5, 7));
  if (!m) return '';
  if (m <= 3) return 'q1';
  if (m <= 6) return 'q2';
  if (m <= 9) return 'q3';
  return 'q4';
}

export function Tab2ImportPostings() {
  const {
    db1C,
    reportingYear,
    operations,
    auditIssues,
    directoryOptions1C,
    lastImportStats,
    isLookingUpEgrul,
    focusedOperationId,
    setFocusedOperationId,
    importOperationFiles,
    importOperationsFromText,
    addBlankOperation,
    updateOperation,
    changeOperationDocType1C,
    bindOperationTo1CDirectoryItem,
    assignCounterpartyToOperation,
    selectEgrulCandidateForCounterparty,
    rebuildSingleOperationPostings,
    runSingleOperationAutoFix,
    updateOperationPayrollParams,
    updateOperationOsParams,
    runSmartAutoFixAll,
    removeOperation,
    clearAllOperations,
    setActiveTab,
  } = useAccountant();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showSkippedDetails, setShowSkippedDetails] = useState(false);

  // Scannability & filtering state
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'issues' | 'active' | 'duplicates'>('all');
  const [quarterFilter, setQuarterFilter] = useState<'all' | 'q1' | 'q2' | 'q3' | 'q4'>('all');
  const [profileFilter, setProfileFilter] = useState<'all' | OperationCardProfile>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGuides, setExpandedGuides] = useState<Record<string, boolean>>({});

  // Auto-expand and scroll when jumping from OSV Card or Audit
  useEffect(() => {
    if (!focusedOperationId) return;
    setFilterMode('all');
    setQuarterFilter('all');
    setProfileFilter('all');
    setSearchQuery('');
    setExpandedCards((prev) => ({ ...prev, [focusedOperationId]: true }));

    const timer = setTimeout(() => {
      const el = document.getElementById(`op-card-${focusedOperationId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [focusedOperationId]);

  const issueOperationIds = useMemo(() => {
    const s = new Set<string>();
    for (const iss of auditIssues) {
      if (iss.operationId) s.add(iss.operationId);
    }
    return s;
  }, [auditIssues]);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    await importOperationFiles(Array.from(fileList));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await importOperationFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;
    const count = importOperationsFromText(pasteText, 'Вставка текста');
    if (count > 0) {
      setPasteText('');
      setShowPasteBox(false);
    }
  };

  const dupCount = operations.filter((o) => o.isDuplicateIn1C).length;
  const activeCount = operations.filter((o) => o.includeInProcessing).length;
  const opsWithIssuesCount = operations.filter((o) => {
    const st = deriveReadinessStatus(o);
    return issueOperationIds.has(o.id) || st === 'critical_error' || st === 'needs_clarification';
  }).length;
  const livePostingsCount = operations.reduce((s, o) => s + o.entries.length, 0);

  const filesUploadedStat =
    lastImportStats?.filesUploaded ??
    new Set(operations.filter((o) => !o.autoGeneratedKind).map((o) => o.sourceFileName)).size;
  const excelRowsStat =
    lastImportStats?.excelOperationRowsTotal ??
    operations.filter((o) => !o.autoGeneratedKind).length;
  const importedOpsStat =
    lastImportStats?.importedOperationsCount ??
    operations.filter((o) => !o.autoGeneratedKind).length;
  const skippedStat = lastImportStats?.skippedRowsCount ?? 0;
  const defaultBik =
    lastImportStats?.sheetDefaults.defaultBik ||
    db1C?.organization.bik ||
    DEFAULT_SBERBANK_BIK;
  const defaultBankName =
    lastImportStats?.sheetDefaults.defaultBankName ||
    db1C?.organization.bankName ||
    DEFAULT_SBERBANK_NAME;

  const filteredOperations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return operations.filter((op) => {
      if (filterMode === 'active' && !op.includeInProcessing) return false;
      if (filterMode === 'duplicates' && !op.isDuplicateIn1C) return false;
      if (filterMode === 'issues') {
        const st = deriveReadinessStatus(op);
        const hasAttention =
          issueOperationIds.has(op.id) ||
          st === 'critical_error' ||
          st === 'needs_clarification';
        if (!hasAttention) return false;
      }
      if (quarterFilter !== 'all' && getQuarterFromIsoDate(op.date) !== quarterFilter) {
        return false;
      }
      if (profileFilter !== 'all' && getOperationCardProfile(op) !== profileFilter) {
        return false;
      }
      if (q) {
        const accountsStr = op.entries.map((e) => `${e.debit} ${e.credit}`).join(' ');
        const hay = `${op.date} ${op.docType1C} ${DOC_TYPE_LABELS_1C[op.docType1C] || ''} ${op.description} ${op.counterpartyName} ${op.counterpartyInn} ${op.employeeName} ${op.nomenclatureName} ${accountsStr}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    operations,
    filterMode,
    quarterFilter,
    profileFilter,
    searchQuery,
    issueOperationIds,
  ]);

  const toggleCardExpanded = (id: string) => {
    if (focusedOperationId === id) {
      setFocusedOperationId(null);
    }
    setExpandedCards((prev) => {
      const currentlyOpen =
        prev[id] !== undefined ? prev[id] : viewMode === 'detailed';
      return { ...prev, [id]: !currentlyOpen };
    });
  };

  const toggleSingleGuide = (id: string) => {
    setExpandedGuides((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const autoFixableBadgeCount = auditIssues.filter((i) => i.canAutoFixBy1C).length;

  return (
    <div className="space-y-4">
      {/* Datalists for fast autocomplete from Chart of Accounts & 1C DB */}
      <datalist id="rsbu-accounts-list">
        {CHART_OF_ACCOUNTS.filter((a) => !a.isGroup).map((acc) => (
          <option key={acc.code} value={acc.code}>
            {acc.name}
          </option>
        ))}
      </datalist>
      <datalist id="db1c-counterparties-list">
        {directoryOptions1C.map((opt) => (
          <option key={`${opt.source}:${opt.id}`} value={opt.name}>
            {opt.source === 'ФизическиеЛица'
              ? `Физлица 1С${opt.inn ? ` · ИНН ${opt.inn}` : ''}`
              : opt.inn
                ? `Контрагенты 1С · ИНН ${opt.inn}`
                : 'Контрагенты 1С'}
          </option>
        ))}
      </datalist>

      {/* Multi-file Dropzone + Quick Paste Bar */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed p-5 sm:p-6 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors ${
          isDragging
            ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20'
            : 'border-slate-300/80 dark:border-slate-800'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.tsv,.txt,.json,.xml"
          onChange={async (e) => {
            await handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
          className="hidden"
        />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Пакетная загрузка файлов задания, кассовых, кадровых и складских операций ({reportingYear} г.)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-4xl leading-relaxed">
              Загрузите сразу все Excel-файлы (.xlsx / .xls), выписки (.txt / .csv) или .xml. Операции выстраиваются в единую хронологию: снятие наличных по чеку, выдача в подотчёт (71.01), оклады сотрудников, выпуск продукции, реализация с НДС 20% сверху и зачёт авансов рассчитываются автоматически.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium whitespace-nowrap transition-colors"
            >
              <FolderUp className="w-4 h-4" strokeWidth={1.6} />
              Загрузить файлы (пачкой)
            </button>

            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap transition-colors"
            >
              <ClipboardPaste className="w-4 h-4 text-slate-500" strokeWidth={1.6} />
              Вставить текст / таблицу
            </button>

            <button
              type="button"
              onClick={addBlankOperation}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap transition-colors"
            >
              <FilePlus2 className="w-4 h-4 text-slate-500" strokeWidth={1.6} />
              + Операция вручную
            </button>
          </div>
        </div>

        {showPasteBox && (
          <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Вставьте строки из Excel, журнала хозяйственных операций или выписки (по одной на строке):
            </label>
            <textarea
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`Примеры:\n10.01.${reportingYear} По чеку сняли денежные средства с расчетного счета 50 000 руб.\n12.01.${reportingYear} Выдано Федорову Ф.Ф. подотчет 15 000 руб.\n25.01.${reportingYear} Поставлена продукция 226 шт Панель из ПВХ и МДФ по цене без НДС 1 500 руб.`}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 text-xs tabular-nums focus:outline-none focus:border-amber-600"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasteBox(false)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Скрыть
              </button>
              <button
                type="button"
                onClick={handlePasteSubmit}
                className="px-4 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 text-xs font-medium hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
              >
                Разобрать и сформировать проводки
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Completeness Reconciliation Bar */}
      {(lastImportStats || operations.length > 0) && (
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-5 py-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 tabular-nums text-slate-700 dark:text-slate-300">
              <span>
                Файлов: <strong>{filesUploadedStat}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Строк в Excel: <strong>{excelRowsStat}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 dark:text-emerald-400">
                Импортировано: <strong>{importedOpsStat}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Проводок: <strong>{livePostingsCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  skippedStat > 0
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-slate-500'
                }
              >
                Пропущено: <strong>{skippedStat}</strong>
              </span>

              {skippedStat > 0 && lastImportStats && lastImportStats.skippedReasons.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSkippedDetails((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
                >
                  Причины пропуска
                  {showSkippedDetails ? (
                    <ChevronUp className="w-3 h-3" strokeWidth={1.6} />
                  ) : (
                    <ChevronDown className="w-3 h-3" strokeWidth={1.6} />
                  )}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="tabular-nums">
                Банк по умолчанию: {defaultBankName} (БИК {defaultBik})
              </span>
              {isLookingUpEgrul && (
                <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
                  <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.6} />
                  Сверка с ЕГРЮЛ ФНС...
                </span>
              )}
            </div>
          </div>

          {showSkippedDetails &&
            lastImportStats &&
            lastImportStats.skippedReasons.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[11px]">
                {lastImportStats.skippedReasons.map((sk, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400"
                  >
                    <span className="tabular-nums text-slate-800 dark:text-slate-200">
                      {sk.fileName}
                      {sk.sheetName ? ` [${sk.sheetName}]` : ''} стр. {sk.rowNumber}:
                    </span>
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      {sk.reason}
                    </span>
                    {sk.rawPreview && (
                      <span className="text-slate-400 truncate max-w-xl">
                        «{sk.rawPreview}»
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {/* Desktop Sticky Queue Toolbar */}
      {operations.length > 0 && (
        <div className="md:sticky md:top-14 z-20 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-3 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Left: Compact/Detailed + Status Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Режим отображения карточек"
                className="flex items-center gap-0.5 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/80"
              >
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('compact');
                    setExpandedCards({});
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                    viewMode === 'compact'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Компактный
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('detailed');
                    setExpandedCards({});
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                    viewMode === 'detailed'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Подробный
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1 rounded-full font-medium tabular-nums whitespace-nowrap transition-colors ${
                    filterMode === 'all'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  Все ({operations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('issues')}
                  className={`px-3 py-1 rounded-full font-medium tabular-nums whitespace-nowrap transition-colors ${
                    filterMode === 'issues'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                      : opsWithIssuesCount > 0
                        ? 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  С вопросами ({opsWithIssuesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('active')}
                  className={`px-3 py-1 rounded-full font-medium tabular-nums whitespace-nowrap transition-colors ${
                    filterMode === 'active'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  К проведению ({activeCount})
                </button>
                {dupCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilterMode('duplicates')}
                    className={`px-3 py-1 rounded-full font-medium tabular-nums whitespace-nowrap transition-colors ${
                      filterMode === 'duplicates'
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    Дубликаты ({dupCount})
                  </button>
                )}
              </div>
            </div>

            {/* Right: Primary Actions (Auto-fix All + Open OSV + Clear) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('db_osv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap transition-colors"
              >
                <Layers className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.6} />
                Открыть ОСВ
              </button>

              <button
                type="button"
                onClick={() => runSmartAutoFixAll()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-medium whitespace-nowrap transition-colors"
              >
                <span>Исправить всё автоматически</span>
                {autoFixableBadgeCount > 0 && (
                  <span className="tabular-nums">({autoFixableBadgeCount})</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('audit_autofix')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap transition-colors"
              >
                Аудит и ИНН
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.6} />
              </button>

              {confirmClear ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmClear(false);
                      clearAllOperations();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 text-white font-medium whitespace-nowrap"
                  >
                    Подтвердить
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 whitespace-nowrap"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 whitespace-nowrap transition-colors"
                >
                  Очистить
                </button>
              )}
            </div>
          </div>

          {/* Second compact filter row: Quarter + Profile + Search */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Фильтр по кварталам"
                value={quarterFilter}
                onChange={(e) =>
                  setQuarterFilter(e.target.value as 'all' | 'q1' | 'q2' | 'q3' | 'q4')
                }
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200"
              >
                <option value="all">Все кварталы {reportingYear}</option>
                <option value="q1">1 квартал (янв–мар)</option>
                <option value="q2">2 квартал (апр–июн)</option>
                <option value="q3">3 квартал (июл–сен)</option>
                <option value="q4">4 квартал (окт–дек)</option>
              </select>

              <select
                aria-label="Фильтр по разделу учёта"
                value={profileFilter}
                onChange={(e) =>
                  setProfileFilter(e.target.value as 'all' | OperationCardProfile)
                }
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200"
              >
                <option value="all">Все разделы учёта</option>
                <option value="trade_services">Покупки / Продажи / Авансы</option>
                <option value="accountable_71">Подотчётные лица (счёт 71.01)</option>
                <option value="warehouse_production">Склад и производство</option>
                <option value="hr_payroll">Зарплата и кадры</option>
                <option value="os_regulatory">ОС и закрытие месяца</option>
                <option value="taxes_bank_founders">Налоги, касса, банк, займы, учредители</option>
              </select>
            </div>

            <div className="relative w-full sm:w-72">
              <Search
                strokeWidth={1.6}
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              />
              <input
                type="text"
                aria-label="Поиск операции"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по тексту, счёту, ИНН, ФИО..."
                className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Очистить поиск операции"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.6} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Operations List */}
      {filteredOperations.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] py-12 text-center text-xs text-slate-500 dark:text-slate-400">
          {operations.length === 0
            ? 'Очередь операций пуста. Загрузите Excel-файлы (.xlsx, .xls, .csv, .txt, .xml) или вставьте текст выше.'
            : 'Нет операций, подходящих под выбранный фильтр. Сбросьте фильтры квартала или раздела выше.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredOperations.map((op, index) => {
            const isExpanded =
              expandedCards[op.id] !== undefined
                ? expandedCards[op.id]
                : viewMode === 'detailed' || focusedOperationId === op.id;
            const isGuideOpen = Boolean(expandedGuides[op.id]);
            const hasAuditIssue = issueOperationIds.has(op.id);

            return (
              <OperationEditorCard
                key={op.id}
                index={index + 1}
                op={op}
                allOperations={operations}
                db1C={db1C}
                dbConnected={Boolean(db1C)}
                directoryOptions1C={directoryOptions1C}
                isExpanded={isExpanded}
                isFocused={focusedOperationId === op.id}
                hasAuditIssue={hasAuditIssue}
                isGuideOpen={isGuideOpen}
                onToggleExpand={() => toggleCardExpanded(op.id)}
                onToggleGuide={() => toggleSingleGuide(op.id)}
                onUpdate={(updater) => updateOperation(op.id, updater)}
                onChangeDocType={(dt) => changeOperationDocType1C(op.id, dt)}
                onBind1C={(item) => bindOperationTo1CDirectoryItem(op.id, item)}
                onQuickAssignCounterparty={(name, inn, kpp) =>
                  assignCounterpartyToOperation(op.id, name, inn, kpp)
                }
                onSelectEgrulCandidate={(cand) =>
                  selectEgrulCandidateForCounterparty(
                    getCounterpartyGroupKey(op.counterpartyName),
                    cand
                  )
                }
                onUpdatePayroll={(params) => updateOperationPayrollParams(op.id, params)}
                onUpdateOs={(params) => updateOperationOsParams(op.id, params)}
                onAutoFixSingle={() => runSingleOperationAutoFix(op.id)}
                onRebuild={() => rebuildSingleOperationPostings(op.id)}
                onRemove={() => removeOperation(op.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function OperationEditorCard({
  index,
  op,
  allOperations,
  db1C,
  dbConnected,
  directoryOptions1C,
  isExpanded,
  isFocused,
  hasAuditIssue,
  isGuideOpen,
  onToggleExpand,
  onToggleGuide,
  onUpdate,
  onChangeDocType,
  onBind1C,
  onQuickAssignCounterparty,
  onSelectEgrulCandidate,
  onUpdatePayroll,
  onUpdateOs,
  onAutoFixSingle,
  onRebuild,
  onRemove,
}: {
  index: number;
  op: QueuedOperation;
  allOperations: QueuedOperation[];
  db1C: import('@/types/accounting').Database1CSnapshot | null;
  dbConnected: boolean;
  directoryOptions1C: import('@/types/accounting').DirectoryAutocompleteOption1C[];
  isExpanded: boolean;
  isFocused: boolean;
  hasAuditIssue: boolean;
  isGuideOpen: boolean;
  onToggleExpand: () => void;
  onToggleGuide: () => void;
  onUpdate: (updater: (prev: QueuedOperation) => QueuedOperation) => void;
  onChangeDocType: (dt: DocType1CBP30) => void;
  onBind1C: (item: import('@/types/accounting').DirectoryAutocompleteOption1C) => void;
  onQuickAssignCounterparty: (name: string, inn?: string, kpp?: string) => void;
  onSelectEgrulCandidate: (cand: EgrulCandidate) => void;
  onUpdatePayroll: (params: {
    monthlySalary?: number;
    costAccount?: string;
    injuryInsuranceRate?: number;
    employeeName?: string;
    employeePosition?: string;
  }) => void;
  onUpdateOs: (params: {
    usefulLifeMonths?: number;
    costAccount?: string;
    nomenclatureName?: string;
    depreciationBaseAmount?: number;
  }) => void;
  onAutoFixSingle: () => void;
  onRebuild: () => void;
  onRemove: () => void;
}) {
  const profile = getOperationCardProfile(op);
  const isInternalWarehouse = isInternalWarehouseOrProductionOp(op);
  const status = deriveReadinessStatus(op);
  const statusLabel = getOperationStatusBadgeText(op);

  const isHireOrder = op.category === 'hr_hire' || op.docType1C === 'ПриемНаРаботу';
  const isPayrollAccrual =
    op.category === 'payroll_accrual' ||
    op.category === 'insurance_accrual' ||
    op.docType1C === 'НачислениеЗарплаты';
  const isPayrollPayout =
    op.category === 'payroll_payout' ||
    op.docType1C === 'ВедомостьВБанк' ||
    op.docType1C === 'ВедомостьВКассу';

  const isCriticalMissingAmount =
    !isHireOrder &&
    !isPayrollAccrual &&
    (op.amountMode === 'required_missing' ||
      (Boolean(op.needsAmount) && op.amountMode !== 'calculated_by_1c'));

  const [salaryDraft, setSalaryDraft] = useState<string>(() =>
    op.monthlySalary && op.monthlySalary > 0
      ? String(op.monthlySalary)
      : isPayrollAccrual && op.amount > 0
        ? String(op.amount)
        : ''
  );
  const [injuryDraft, setInjuryDraft] = useState<string>(() =>
    String(op.injuryInsuranceRate ?? 0.2)
  );
  const [spiDraft, setSpiDraft] = useState<string>(() =>
    String(op.usefulLifeMonths ?? 60)
  );

  useEffect(() => {
    if (op.monthlySalary && op.monthlySalary > 0) {
      setSalaryDraft(String(op.monthlySalary));
    } else if (isPayrollAccrual && op.amount > 0) {
      setSalaryDraft(String(op.amount));
    }
  }, [op.monthlySalary, op.amount, isPayrollAccrual]);

  useEffect(() => {
    if (op.usefulLifeMonths && op.usefulLifeMonths > 0) {
      setSpiDraft(String(op.usefulLifeMonths));
    }
  }, [op.usefulLifeMonths]);

  const mentorGuide = useMemo(
    () => op.mentorGuide1C ?? buildOperationMentorGuide1C(op, db1C),
    [op, db1C]
  );

  const provenanceText =
    op.calculationProvenance || op.amountCalculationNote || op.stockSourceNote || '';

  const primaryPostingPreview = useMemo(() => {
    if (isHireOrder) {
      return op.monthlySalary && op.monthlySalary > 0
        ? `Оклад ${formatMoney(op.monthlySalary, true)} ₽`
        : 'Кадровый приказ';
    }
    if (op.entries.length === 0) return '0 проводок';
    const first = op.entries[0];
    const base = first.isOffBalance
      ? `Дт ${first.debit}`
      : `Дт ${first.debit} Кт ${first.credit}`;
    return op.entries.length > 1 ? `${base} (+${op.entries.length - 1})` : base;
  }, [op.entries, op.monthlySalary, isHireOrder]);

  const entityDisplaySummary = useMemo(() => {
    if (profile === 'accountable_71') {
      return op.employeeName
        ? `${op.employeeName} (71.01) · ${op.description}`
        : op.description;
    }
    if (profile === 'hr_payroll') {
      if (isHireOrder) {
        return [op.employeeName, op.employeePosition].filter(Boolean).join(' · ') || op.description;
      }
      if (op.payrollStaffSummary && op.payrollStaffSummary.length > 0) {
        return `${op.description} · Штат: ${op.payrollStaffSummary.length} сотр.`;
      }
      return op.employeeName ? `${op.employeeName} · ${op.description}` : op.description;
    }
    if (op.counterpartyName) {
      return `${op.counterpartyName} · ${op.description}`;
    }
    if (
      op.nomenclatureName &&
      !op.description.toLowerCase().includes(op.nomenclatureName.toLowerCase())
    ) {
      return `${op.nomenclatureName} · ${op.description}`;
    }
    return op.description;
  }, [profile, isHireOrder, op]);

  // 1-Click Quick-Pick Counterparty Chips for commercial operations missing counterpartyName
  const quickPickChips = useMemo<QuickPickCounterpartyChip[]>(() => {
    if (profile !== 'trade_services' || op.counterpartyName.trim().length >= 2) {
      return [];
    }
    const isSaleSide =
      op.category === 'sale_goods' ||
      op.category === 'sale_services' ||
      op.category === 'bank_in' ||
      op.category === 'cash_in';

    const seen = new Set<string>();
    const candidates: QuickPickCounterpartyChip[] = [];

    const pushCandidate = (name: string, inn: string, kpp: string, hint: string) => {
      const clean = name.trim();
      if (clean.length < 2) return;
      const key = getCounterpartyGroupKey(clean);
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push({ name: clean, inn: inn || '', kpp: kpp || '', hint });
    };

    // 1. Prioritize matching side from queued operations (e.g., 62.02 buyer advances for sales, 60 supplier advances for purchases)
    for (const other of allOperations) {
      if (other.id === op.id || !other.includeInProcessing) continue;
      if (!doesOperationRequireCounterparty(other.category)) continue;
      if (other.counterpartyKind === 'ФизическоеЛицо') continue;
      const otherName = other.counterpartyName.trim();
      if (!otherName) continue;

      const otherIsBuyer =
        other.category === 'bank_in' ||
        other.category === 'cash_in' ||
        other.category === 'sale_goods' ||
        other.category === 'sale_services' ||
        other.entries.some((e) => e.credit.startsWith('62') || e.debit.startsWith('62'));
      const otherIsSupplier =
        other.category.startsWith('purchase_') ||
        other.category === 'bank_out' ||
        other.category === 'cash_out' ||
        other.entries.some((e) => e.debit.startsWith('60') || e.credit.startsWith('60'));

      if (isSaleSide && otherIsBuyer) {
        pushCandidate(
          otherName,
          other.counterpartyInn,
          other.counterpartyKpp,
          other.entries.some((e) => e.credit === '62.02') ? 'аванс 62.02' : 'покупатель'
        );
      } else if (!isSaleSide && otherIsSupplier) {
        pushCandidate(otherName, other.counterpartyInn, other.counterpartyKpp, 'поставщик');
      }
    }

    // 2. Add commercial counterparties from 1C DB
    for (const dir of directoryOptions1C) {
      if (dir.source !== 'Контрагенты') continue;
      pushCandidate(dir.name, dir.inn, dir.kpp, 'БД 1С');
      if (candidates.length >= 6) break;
    }

    // 3. Fallback: any remaining commercial counterparties from queue
    if (candidates.length < 6) {
      for (const other of allOperations) {
        if (other.id === op.id || !other.counterpartyName.trim()) continue;
        if (!doesOperationRequireCounterparty(other.category)) continue;
        if (other.counterpartyKind === 'ФизическоеЛицо') continue;
        pushCandidate(other.counterpartyName, other.counterpartyInn, other.counterpartyKpp, 'из операций');
        if (candidates.length >= 6) break;
      }
    }

    return candidates.slice(0, 6);
  }, [profile, op.id, op.category, op.counterpartyName, allOperations, directoryOptions1C]);

  const commitPayrollSalary = () => {
    const parsed = parseRussianNumber(salaryDraft);
    const parsedInjury = parseRussianNumber(injuryDraft);
    onUpdatePayroll({
      monthlySalary: parsed >= 0 ? parsed : 0,
      injuryInsuranceRate: parsedInjury >= 0 ? parsedInjury : 0.2,
    });
  };

  const commitOsSpi = () => {
    const parsedSpi = Math.max(1, Math.round(parseRussianNumber(spiDraft) || 60));
    setSpiDraft(String(parsedSpi));
    onUpdateOs({ usefulLifeMonths: parsedSpi });
  };

  // Payroll live math preview
  const payrollGross =
    op.entries.find((e) => e.credit === '70')?.amount ??
    (op.monthlySalary && op.monthlySalary > 0 ? op.monthlySalary : op.amount);
  const payrollNdfl =
    op.entries.find((e) => e.debit === '70' && e.credit === '68.01')?.amount ??
    Math.round(payrollGross * 0.13 * 100) / 100;
  const payrollNet70 = Math.max(0, Math.round((payrollGross - payrollNdfl) * 100) / 100);
  const payrollIns30 =
    op.entries.find((e) => e.credit === '69.09')?.amount ??
    Math.round(payrollGross * 0.3 * 100) / 100;
  const payrollInj =
    op.entries.find((e) => e.credit === '69.11')?.amount ??
    Math.round(payrollGross * ((op.injuryInsuranceRate ?? 0.2) / 100) * 100) / 100;

  return (
    <div
      id={`op-card-${op.id}`}
      className={`rounded-2xl border bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors ${
        isFocused
          ? 'border-amber-500 ring-2 ring-amber-500/25'
          : op.includeInProcessing
            ? 'border-slate-200/70 dark:border-slate-800'
            : 'border-slate-200/50 dark:border-slate-800/60 opacity-65'
      }`}
    >
      {/* Compact Single-Row Summary Header */}
      <div
        onClick={onToggleExpand}
        className="px-4 py-3 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/30 rounded-2xl text-xs transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <input
            type="checkbox"
            aria-label={`Включить операцию #${index} в обработку`}
            checked={Boolean(op.includeInProcessing)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onUpdate((prev) => ({ ...prev, includeInProcessing: e.target.checked }))
            }
            className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 shrink-0"
          />

          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Свернуть операцию #${index}` : `Развернуть операцию #${index}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" strokeWidth={1.6} />
            ) : (
              <ChevronRight className="w-4 h-4" strokeWidth={1.6} />
            )}
          </button>

          <span className="tabular-nums text-slate-400 w-7 shrink-0">
            #{index}
          </span>

          <span className="tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
            {formatDateRu(op.date)}
          </span>

          <span className="font-medium text-amber-800 dark:text-amber-300 whitespace-nowrap shrink-0 hidden sm:inline">
            {op.docType1C}
          </span>

          <span className="text-slate-900 dark:text-slate-100 truncate min-w-0">
            {entityDisplaySummary}
          </span>
        </div>

        {/* Right side of compact row: Posting summary + Amount + Soft Status Badge + Crisp Fix Button */}
        <div
          className="flex items-center gap-2.5 shrink-0 pl-7 lg:pl-0"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="hidden xl:inline tabular-nums text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {primaryPostingPreview}
          </span>

          <span
            className={`font-semibold tabular-nums whitespace-nowrap w-28 text-right ${
              isCriticalMissingAmount
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {isHireOrder
              ? op.monthlySalary
                ? `${formatMoney(op.monthlySalary, true)} ₽/мес`
                : 'приказ'
              : op.amount >= 0.01
                ? `${formatMoney(op.amount, true)} ₽`
                : op.amountMode === 'calculated_by_1c'
                  ? 'авто 1С'
                  : '0,00 ₽'}
          </span>

          {/* Soft rounded-full status pill */}
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
              status === 'critical_error'
                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                : status === 'needs_clarification'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                  : status === 'calculated_1c'
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            {status === 'critical_error' ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
            ) : status === 'needs_clarification' ? (
              <Info className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
            ) : status === 'calculated_1c' ? (
              <Calculator className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
            )}
            <span className="hidden md:inline">{statusLabel}</span>
          </span>

          {(hasAuditIssue || status === 'critical_error' || status === 'needs_clarification') && (
            <button
              type="button"
              onClick={onAutoFixSingle}
              title="Переклассифицировать, подтянуть реквизиты и пересчитать операцию"
              className="px-2.5 py-1 rounded-xl border border-amber-300/90 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/70 text-[11px] font-medium text-amber-900 dark:text-amber-200 whitespace-nowrap transition-colors"
            >
              Исправить
            </button>
          )}
        </div>
      </div>

      {/* Expanded Contextual Editor + Postings + 1C Mentor Guide */}
      {isExpanded && (
        <div className="border-t border-slate-100 dark:border-slate-800/80">
          {/* Document Control Bar */}
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Дата операции"
                value={op.date ?? ''}
                onChange={(e) => onUpdate((prev) => ({ ...prev, date: e.target.value }))}
                className="px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
              />

              <input
                type="text"
                aria-label="Номер документа"
                value={op.docNumber ?? ''}
                onChange={(e) => onUpdate((prev) => ({ ...prev, docNumber: e.target.value }))}
                placeholder="№ док."
                className="w-24 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
              />

              <select
                aria-label="Вид документа 1С"
                value={op.docType1C}
                onChange={(e) => onChangeDocType(e.target.value as DocType1CBP30)}
                className="max-w-xs sm:max-w-md px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-xs text-slate-900 dark:text-slate-100"
              >
                {DOC_TYPES_1C.map((dt) => (
                  <option key={dt} value={dt}>
                    1С: {dt} — {DOC_TYPE_LABELS_1C[dt]}
                  </option>
                ))}
              </select>

              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                · Профиль: {PROFILE_LABELS[profile]}
              </span>

              {op.isDuplicateIn1C && (
                <span
                  title={op.duplicateReason}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300"
                >
                  · <CopyCheck className="w-3.5 h-3.5" strokeWidth={1.6} /> Уже в БД 1С
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="hidden xl:inline text-[11px] text-slate-400 tabular-nums truncate max-w-[180px]">
                {op.sourceFileName}
                {op.rowKey ? ` · [${op.rowKey}]` : ''}
              </span>
              <button
                type="button"
                onClick={onRebuild}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap transition-colors"
              >
                <RefreshCcw className="w-3 h-3" strokeWidth={1.6} />
                Пересчитать цепочку
              </button>
              <button
                type="button"
                aria-label="Удалить операцию"
                onClick={onRemove}
                className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.6} />
              </button>
            </div>
          </div>

          {/* Provenance Strip («Откуда цифра») */}
          {provenanceText && (
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 bg-amber-50/40 dark:bg-amber-950/15 text-[11px] text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong className="font-semibold text-slate-900 dark:text-slate-100">
                  Откуда цифра:{' '}
                </strong>
                <span>{provenanceText}</span>
              </div>
              {op.documentSubKind1C && (
                <span className="text-slate-500 dark:text-slate-400">
                  Вид операции 1С: {op.documentSubKind1C}
                </span>
              )}
            </div>
          )}

          {/* CONTEXTUAL EDITOR BY PROFILE */}
          {profile === 'accountable_71' && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-3.5 text-xs">
              <div className="lg:col-span-5 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Содержание операции с подотчётным лицом (счёт 71.01)
                  </label>
                  <input
                    type="text"
                    value={op.description ?? ''}
                    onChange={(e) =>
                      onUpdate((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Подотчётное лицо (ФИО сотрудника)
                    </label>
                    <input
                      type="text"
                      list="db1c-counterparties-list"
                      value={op.employeeName ?? ''}
                      onChange={(e) => {
                        const fio = e.target.value;
                        onUpdate((prev) => ({
                          ...prev,
                          employeeName: fio,
                          entries: prev.entries.map((en) => ({
                            ...en,
                            debitSubconto: en.debit === '71.01' ? fio : en.debitSubconto,
                            creditSubconto: en.credit === '71.01' ? fio : en.creditSubconto,
                          })),
                        }));
                      }}
                      placeholder="Федоров Ф.Ф."
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Назначение / Номенклатура расхода
                    </label>
                    <input
                      type="text"
                      value={op.nomenclatureName || op.expenseItemName || ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          nomenclatureName: e.target.value,
                          expenseItemName: e.target.value,
                        }))
                      }
                      placeholder="Хознужды / Командировочные"
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Вид операции по счёту 71.01
                  </label>
                  <select
                    aria-label="Вид подотчётной операции"
                    value={op.category}
                    onChange={(e) => {
                      const nextCat = e.target.value as
                        | 'accountable_issue'
                        | 'expense_report'
                        | 'accountable_return';
                      if (nextCat === 'expense_report') {
                        onChangeDocType('АвансовыйОтчет');
                      } else if (nextCat === 'accountable_return') {
                        onChangeDocType('ПоступлениеНаличных');
                      } else {
                        onChangeDocType('ВыдачаНаличных');
                      }
                    }}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="accountable_issue">
                      Выдача подотчётнику (Дт 71.01 — Кт 50.01 / 51)
                    </option>
                    <option value="expense_report">
                      Авансовый отчёт (Дт 10 / 26 — Кт 71.01)
                    </option>
                    <option value="accountable_return">
                      Возврат остатка подотчётных сумм (Дт 50.01 — Кт 71.01)
                    </option>
                  </select>
                </div>

                {op.category === 'expense_report' ? (
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Счёт отнесения расхода по авансовому отчёту
                    </label>
                    <select
                      aria-label="Счёт расхода авансового отчёта"
                      value={op.materialAccount || op.costAccount || '10.09'}
                      onChange={(e) => {
                        const acc = e.target.value;
                        onUpdate((prev) => ({
                          ...prev,
                          materialAccount: acc.startsWith('10') ? acc : '',
                          costAccount: !acc.startsWith('10') ? acc : prev.costAccount,
                          entries: prev.entries.map((en) =>
                            en.credit === '71.01' ? { ...en, debit: acc } : en
                          ),
                        }));
                      }}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                    >
                      {ACCOUNTABLE_EXPENSE_ACCOUNTS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Способ расчётов с сотрудником
                    </label>
                    <select
                      aria-label="Способ расчётов с подотчётным лицом"
                      value={
                        op.entries.some((e) => e.credit === '51' || e.debit === '51')
                          ? 'bank_51'
                          : 'cash_50'
                      }
                      onChange={(e) => {
                        const viaBank = e.target.value === 'bank_51';
                        onUpdate((prev) => ({
                          ...prev,
                          docType1C:
                            prev.category === 'accountable_return'
                              ? viaBank
                                ? 'ПоступлениеНаРасчетныйСчет'
                                : 'ПоступлениеНаличных'
                              : viaBank
                                ? 'СписаниеСРасчетногоСчета'
                                : 'ВыдачаНаличных',
                          entries: prev.entries.map((en) =>
                            prev.category === 'accountable_return'
                              ? { ...en, debit: viaBank ? '51' : '50.01' }
                              : { ...en, credit: viaBank ? '51' : '50.01' }
                          ),
                        }));
                      }}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    >
                      <option value="cash_50">Через кассу (счёт 50.01, РКО / ПКО)</option>
                      <option value="bank_51">На карту сотрудника (счёт 51)</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="lg:col-span-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Сумма подотчёта, ₽
                  </label>
                  <span className="text-[10px] text-slate-500">Без НДС · Юрлицо не требуется</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={op.amount ?? 0}
                  onChange={(e) => {
                    const nextAmt = parseRussianNumber(e.target.value);
                    onUpdate((prev) => ({
                      ...prev,
                      amount: nextAmt,
                      amountMode: nextAmt < 0.01 ? 'required_missing' : 'explicit',
                      readinessStatus: nextAmt < 0.01 ? 'critical_error' : 'ready',
                      needsAmount: nextAmt < 0.01 ? true : undefined,
                      entries: prev.entries.map((en) => ({ ...en, amount: nextAmt })),
                    }));
                  }}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-right text-xs"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  Расчёты с подотчётным лицом ведутся в справочнике «Физические лица» без НДС и без карточки контрагента.
                </p>
              </div>
            </div>
          )}

          {profile === 'hr_payroll' && (
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
                <div className="lg:col-span-5 space-y-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Содержание кадровой / зарплатной операции
                    </label>
                    <input
                      type="text"
                      value={op.description ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, description: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>

                  {isHireOrder ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Сотрудник (ФИО)
                        </label>
                        <input
                          type="text"
                          list="db1c-counterparties-list"
                          value={op.employeeName ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, employeeName: e.target.value }))
                          }
                          onBlur={(e) =>
                            onUpdatePayroll({ employeeName: e.target.value.trim() })
                          }
                          placeholder="Иванов И.И."
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Должность
                        </label>
                        <input
                          type="text"
                          value={op.employeePosition ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              employeePosition: e.target.value,
                            }))
                          }
                          onBlur={(e) =>
                            onUpdatePayroll({ employeePosition: e.target.value.trim() })
                          }
                          placeholder="Директор / Бухгалтер / Инженер"
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        />
                      </div>
                    </div>
                  ) : isPayrollPayout ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Получатель / Ведомость
                        </label>
                        <input
                          type="text"
                          value={op.employeeName ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, employeeName: e.target.value }))
                          }
                          placeholder="Штатные сотрудники по ведомости"
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Способ выплаты 1С
                        </label>
                        <select
                          aria-label="Способ выплаты зарплаты"
                          value={
                            op.entries.some((e) => e.credit === '50.01')
                              ? 'cash_50'
                              : 'bank_51'
                          }
                          onChange={(e) => {
                            const viaCash = e.target.value === 'cash_50';
                            onUpdate((prev) => ({
                              ...prev,
                              docType1C: viaCash
                                ? 'ВыдачаНаличных'
                                : 'СписаниеСРасчетногоСчета',
                              entries: prev.entries.map((en) =>
                                en.debit === '70'
                                  ? { ...en, credit: viaCash ? '50.01' : '51' }
                                  : en
                              ),
                            }));
                          }}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        >
                          <option value="bank_51">На карты (Списание с р/с, счёт 51)</option>
                          <option value="cash_50">Через кассу (РКО, счёт 50.01)</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    /* НачислениеЗарплаты: Staff Roster Summary */
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
                      <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        Штатный состав и оклады на дату начисления:
                      </div>
                      {op.payrollStaffSummary && op.payrollStaffSummary.length > 0 ? (
                        <ul className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                          {op.payrollStaffSummary.map((st, idx) => (
                            <li key={idx} className="flex items-center justify-between gap-2">
                              <span className="truncate">
                                {st.name}
                                {st.position ? ` (${st.position})` : ''}
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                                {formatMoney(st.salary, true)} ₽
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-amber-800 dark:text-amber-300">
                          В предыдущих строках не найден приказ о приёме с окладом. Укажите месячный ФОТ справа и нажмите «Рассчитать» — система автоматически сформирует начисление ЗП, НДФЛ 13%, взносы 30% и травматизм 0,2%.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Column 2: Cost Account & Insurance Tariff */}
                <div className="lg:col-span-4 space-y-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Счёт учёта затрат по оплате труда
                    </label>
                    <select
                      aria-label="Счёт учёта затрат по зарплате"
                      value={op.costAccount || '26'}
                      onChange={(e) => onUpdatePayroll({ costAccount: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                    >
                      {PAYROLL_COST_ACCOUNTS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isPayrollAccrual && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          НДФЛ (счёт 68.01)
                        </label>
                        <div className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          13% ({formatMoney(payrollNdfl, true)} ₽)
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Травматизм (69.11), %
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label="Тариф взносов на травматизм, %"
                          value={injuryDraft}
                          onChange={(e) => setInjuryDraft(e.target.value)}
                          onBlur={commitPayrollSalary}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitPayrollSalary();
                            }
                          }}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums text-xs text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  )}

                  {isHireOrder && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Кадровый приказ ПриемНаРаботу не создаёт бухгалтерских проводок сам по себе — он регистрирует сотрудника и оклад для автоматического расчёта ЗП в конце каждого месяца.
                    </p>
                  )}
                </div>

                {/* Column 3: Salary / ФОТ / Payout Input */}
                <div className="lg:col-span-3 space-y-2">
                  {isHireOrder || isPayrollAccrual ? (
                    <>
                      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        {isHireOrder
                          ? 'Оклад сотрудника в месяц, ₽'
                          : 'Штатный ФОТ для расчёта за месяц, ₽'}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={
                            isHireOrder
                              ? 'Оклад сотрудника в месяц'
                              : 'Штатный ФОТ для расчёта за месяц'
                          }
                          value={salaryDraft}
                          onChange={(e) => setSalaryDraft(e.target.value)}
                          onBlur={commitPayrollSalary}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitPayrollSalary();
                            }
                          }}
                          placeholder="Например: 120000"
                          className="w-full px-3 py-1.5 rounded-xl border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 tabular-nums font-semibold text-right text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <button
                          type="button"
                          onClick={commitPayrollSalary}
                          className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs whitespace-nowrap transition-colors"
                        >
                          Рассчитать
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Сумма выплаты на руки (Дт 70), ₽
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={op.amount ?? 0}
                        onChange={(e) => {
                          const nextAmt = parseRussianNumber(e.target.value);
                          onUpdate((prev) => ({
                            ...prev,
                            amount: nextAmt,
                            amountMode: nextAmt >= 0.01 ? 'explicit' : 'from_account_balance',
                            readinessStatus: 'ready',
                            entries: prev.entries.map((en) => ({ ...en, amount: nextAmt })),
                          }));
                        }}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums font-semibold text-right text-xs text-slate-900 dark:text-slate-100"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Calculated Payroll Breakdown Strip */}
              {isPayrollAccrual && (
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 px-3.5 py-2.5 grid grid-cols-2 sm:grid-cols-5 gap-2 tabular-nums text-[11px]">
                  <div>
                    <div className="text-slate-500">Начислено ФОТ (Кт 70)</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {formatMoney(payrollGross, true)} ₽
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">НДФЛ 13% (Кт 68.01)</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {formatMoney(payrollNdfl, true)} ₽
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">К выплате (сальдо 70)</div>
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatMoney(payrollNet70, true)} ₽
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Взносы 30% (Кт 69.09)</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {formatMoney(payrollIns30, true)} ₽
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">
                      Травматизм {op.injuryInsuranceRate ?? 0.2}% (69.11)
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {formatMoney(payrollInj, true)} ₽
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {profile === 'os_regulatory' && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-3.5 text-xs">
              <div className="lg:col-span-5 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    {op.category === 'closing'
                      ? 'Наименование регламентной операции 1С'
                      : 'Содержание операции с основным средством'}
                  </label>
                  <input
                    type="text"
                    value={op.description ?? ''}
                    onChange={(e) =>
                      onUpdate((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  />
                </div>
                {op.category !== 'closing' && (
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Объект основных средств (счёт 01.01)
                    </label>
                    <input
                      type="text"
                      value={op.nomenclatureName ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, nomenclatureName: e.target.value }))
                      }
                      onBlur={(e) => onUpdateOs({ nomenclatureName: e.target.value.trim() })}
                      placeholder="Например: Станок с ЧПУ / Сервер / Здание"
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 space-y-2">
                {op.category === 'closing' ? (
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Номенклатурная группа закрытия
                    </label>
                    <input
                      type="text"
                      value={op.nomenclatureGroupName ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          nomenclatureGroupName: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Закрывает счета затрат (20.01, 25, 26, 44.01), определяет финансовый результат (90.09, 91.09 → 99.01.1) и начисляет налог на прибыль 20% (68.04.1).
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        СПИ, месяцев
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        aria-label="Срок полезного использования ОС в месяцах"
                        value={spiDraft}
                        onChange={(e) => setSpiDraft(e.target.value)}
                        onBlur={commitOsSpi}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitOsSpi();
                          }
                        }}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Счёт амортизации
                      </label>
                      <select
                        value={op.costAccount || '20.01'}
                        onChange={(e) => onUpdateOs({ costAccount: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums text-xs text-slate-900 dark:text-slate-100"
                      >
                        {COST_ACCOUNT_OPTIONS.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-3 space-y-1.5">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                  {op.category === 'os_commissioning'
                    ? 'Первоначальная стоимость (08.04.1 → 01.01), ₽'
                    : op.category === 'depreciation_accrual'
                      ? 'Амортизация за месяц (Кт 02.01), ₽'
                      : 'Сумма регламентных проводок, ₽'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={op.amount ?? 0}
                  onChange={(e) => {
                    const nextAmt = parseRussianNumber(e.target.value);
                    onUpdate((prev) => ({
                      ...prev,
                      amount: nextAmt,
                      amountMode: nextAmt >= 0.01 ? 'explicit' : 'calculated_by_1c',
                      readinessStatus: 'ready',
                      entries:
                        prev.entries.length === 1
                          ? prev.entries.map((en) => ({ ...en, amount: nextAmt }))
                          : prev.entries,
                    }));
                  }}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums font-semibold text-right text-xs text-slate-900 dark:text-slate-100"
                />
                {op.depreciationBaseAmount && op.usefulLifeMonths && (
                  <div className="text-[11px] tabular-nums text-slate-500">
                    Норма: {formatMoney(op.depreciationBaseAmount, true)} ₽ / {op.usefulLifeMonths} мес.
                  </div>
                )}
              </div>
            </div>
          )}

          {profile === 'warehouse_production' && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-3.5 text-xs">
              <div className="lg:col-span-5 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Содержание складской / производственной операции
                  </label>
                  <input
                    type="text"
                    value={op.description ?? ''}
                    onChange={(e) =>
                      onUpdate((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  />
                </div>

                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      {op.category === 'production_output'
                        ? 'Готовая продукция'
                        : op.category === 'workwear_issue'
                          ? 'Спецодежда / Инвентарь'
                          : 'Номенклатура (ТМЦ)'}
                    </label>
                    <input
                      type="text"
                      value={op.nomenclatureName ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, nomenclatureName: e.target.value }))
                      }
                      placeholder="Кирпич / Спецодежда"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Кол-во
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={op.quantity ?? 1}
                      onChange={(e) => {
                        const q = parseRussianNumber(e.target.value);
                        onUpdate((prev) => ({ ...prev, quantity: q > 0 ? q : 1 }));
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Счёт ТМЦ
                    </label>
                    <input
                      type="text"
                      list="rsbu-accounts-list"
                      value={
                        op.materialAccount ||
                        (op.category === 'production_output'
                          ? '43'
                          : op.entries[0]?.credit || '10.01')
                      }
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          materialAccount: e.target.value.trim(),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-2">
                {op.category === 'workwear_issue' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Сотрудник (МОЛ)
                        </label>
                        <input
                          type="text"
                          list="db1c-counterparties-list"
                          value={op.employeeName ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, employeeName: e.target.value }))
                          }
                          placeholder="ФИО или должность"
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Склад выдачи
                        </label>
                        <input
                          type="text"
                          value={op.warehouseName ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, warehouseName: e.target.value }))
                          }
                          placeholder="Основной склад"
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Счёт затрат (ФСБУ 5/2019)
                        </label>
                        <select
                          value={op.costAccount || '20.01'}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, costAccount: e.target.value }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                        >
                          {COST_ACCOUNT_OPTIONS.map((opt) => (
                            <option key={opt.code} value={opt.code}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Забалансовый контроль
                        </label>
                        <div className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 tabular-nums text-xs text-slate-800 dark:text-slate-200">
                          Дт {op.offBalanceAccount || 'МЦ.02'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : op.category === 'warehouse_transfer' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Склад-отправитель
                      </label>
                      <input
                        type="text"
                        value={op.warehouseName ?? ''}
                        onChange={(e) =>
                          onUpdate((prev) => ({ ...prev, warehouseName: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Склад-получатель
                      </label>
                      <input
                        type="text"
                        value={op.warehouseToName ?? ''}
                        onChange={(e) =>
                          onUpdate((prev) => ({ ...prev, warehouseToName: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Счёт затрат
                        </label>
                        <select
                          value={op.costAccount || '20.01'}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, costAccount: e.target.value }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                        >
                          {COST_ACCOUNT_OPTIONS.map((opt) => (
                            <option key={opt.code} value={opt.code}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Склад
                        </label>
                        <input
                          type="text"
                          value={op.warehouseName ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({ ...prev, warehouseName: e.target.value }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Номенклатурная группа / Объект
                      </label>
                      <input
                        type="text"
                        value={op.nomenclatureGroupName ?? ''}
                        onChange={(e) =>
                          onUpdate((prev) => ({
                            ...prev,
                            nomenclatureGroupName: e.target.value,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="lg:col-span-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Себестоимость партии, ₽
                  </label>
                  <span className="text-[10px] text-slate-500">Без НДС</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={op.amount ?? 0}
                  onChange={(e) => {
                    const nextAmt = parseRussianNumber(e.target.value);
                    onUpdate((prev) => ({
                      ...prev,
                      amount: nextAmt,
                      amountMode: nextAmt >= 0.01 ? 'explicit' : 'calculated_by_1c',
                      readinessStatus: nextAmt >= 0.01 ? 'ready' : 'calculated_1c',
                      needsAmount: undefined,
                      entries: prev.entries.map((en) =>
                        en.isOffBalance ? en : { ...en, amount: nextAmt }
                      ),
                    }));
                  }}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-right text-xs"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  {op.amountMode === 'calculated_by_1c'
                    ? `В 1С списывается количество (${op.quantity ?? 1}), а сумма рассчитывается автоматически по партиям счёта ${op.materialAccount || '10'}.`
                    : 'Себестоимость определена по партии поступления без НДС.'}
                </p>
              </div>
            </div>
          )}

          {profile === 'taxes_bank_founders' && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-3.5 text-xs">
              <div className="lg:col-span-5 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Назначение платежа / Содержание операции
                  </label>
                  <input
                    type="text"
                    value={op.description ?? ''}
                    onChange={(e) =>
                      onUpdate((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Статья движения ДС (ДДС)
                    </label>
                    <input
                      type="text"
                      value={op.cashFlowItemName ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, cashFlowItemName: e.target.value }))
                      }
                      placeholder="Снятие наличных / Уплата налогов / Вклад в УК"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      БИК банка
                    </label>
                    <input
                      type="text"
                      value={op.counterpartyBik || op.organizationBik || DEFAULT_SBERBANK_BIK}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          counterpartyBik: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-2">
                {op.category === 'cash_bank_internal' ? (
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      Внутреннее перемещение денежных средств (Касса ↔ Банк)
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                      В 1С:БП 3.0 отражается кассовым ордером ({op.docType1C}) с видом «{op.documentSubKind1C || 'Получение наличных в банке'}». Контрагент и НДС не заполняются.
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        {op.category === 'tax_payment'
                          ? 'Налоговый орган / ЕНС (УФК / ФНС)'
                          : op.category === 'founder_contribution'
                            ? 'Учредитель (субконто счёта 75.01)'
                            : op.category === 'loan_received' || op.category === 'loan_repaid'
                              ? 'Займодавец / Банк (счёт 66.03 / 67.03)'
                              : 'Банк / Аналитика'}
                      </label>
                      <input
                        type="text"
                        list="db1c-counterparties-list"
                        value={op.counterpartyName ?? ''}
                        onChange={(e) =>
                          onUpdate((prev) => ({ ...prev, counterpartyName: e.target.value }))
                        }
                        placeholder={
                          op.category === 'tax_payment'
                            ? 'УФК по г. Санкт-Петербургу (ИФНС)'
                            : op.category === 'founder_contribution'
                              ? 'ФИО учредителя'
                              : DEFAULT_SBERBANK_NAME
                        }
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          ИНН (необяз.)
                        </label>
                        <input
                          type="text"
                          value={op.counterpartyInn ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              counterpartyInn: e.target.value.replace(/\D/g, ''),
                              counterpartySource: 'manual',
                            }))
                          }
                          placeholder="Необязательно"
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums text-xs text-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          КПП
                        </label>
                        <input
                          type="text"
                          value={op.counterpartyKpp ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              counterpartyKpp: e.target.value.replace(/\D/g, ''),
                              counterpartySource: 'manual',
                            }))
                          }
                          placeholder="КПП"
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 tabular-nums text-xs text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="lg:col-span-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Сумма операции, ₽
                  </label>
                  <span className="text-[10px] text-slate-500">Без НДС</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={op.amount ?? 0}
                  onChange={(e) => {
                    const nextAmt = parseRussianNumber(e.target.value);
                    onUpdate((prev) => ({
                      ...prev,
                      amount: nextAmt,
                      amountMode: nextAmt < 0.01 ? 'required_missing' : 'explicit',
                      readinessStatus: nextAmt < 0.01 ? 'critical_error' : 'ready',
                      needsAmount: nextAmt < 0.01 ? true : undefined,
                      entries: prev.entries.map((en) => ({ ...en, amount: nextAmt })),
                    }));
                  }}
                  className={`w-full px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-right text-xs ${
                    isCriticalMissingAmount
                      ? 'border-rose-400 dark:border-rose-700'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
              </div>
            </div>
          )}

          {profile === 'trade_services' && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-3.5 text-xs">
              <div className="lg:col-span-5 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Содержание хозяйственной операции
                  </label>
                  <input
                    type="text"
                    value={op.description ?? ''}
                    onChange={(e) =>
                      onUpdate((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      {op.category === 'purchase_equipment'
                        ? 'Оборудование (счёт 08.04.1)'
                        : 'Номенклатура / Услуга'}
                    </label>
                    <input
                      type="text"
                      value={op.nomenclatureName ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, nomenclatureName: e.target.value }))
                      }
                      placeholder="Наименование ТМЦ / продукции / услуги"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Склад / Статья затрат
                    </label>
                    <input
                      type="text"
                      value={op.warehouseName || op.expenseItemName || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        onUpdate((prev) =>
                          [
                            'purchase_goods',
                            'purchase_materials',
                            'purchase_equipment',
                            'sale_goods',
                          ].includes(prev.category)
                            ? { ...prev, warehouseName: v }
                            : { ...prev, expenseItemName: v }
                        );
                      }}
                      placeholder="Склад или статья затрат"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Counterparty & 1-Click Quick-Pick Chips */}
              <div className="lg:col-span-4 space-y-2">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400">
                      {op.category === 'sale_goods' || op.category === 'sale_services'
                        ? 'Покупатель (счёт 62)'
                        : 'Контрагент'}
                    </label>
                    {op.counterpartyName && (
                      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                        {op.bindings.counterparty.status === 'matched_1c'
                          ? 'В базе 1С'
                          : op.counterpartySource === 'egrul_verified'
                            ? 'ЕГРЮЛ ФНС'
                            : op.counterpartySource === 'educational_generated'
                              ? 'Учебные реквизиты (ФНС OK)'
                              : op.counterpartySource === 'educational_unverified'
                                ? 'Учебный (без ИНН)'
                                : dbConnected
                                  ? 'Новый элемент'
                                  : 'Контрагент'}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    list="db1c-counterparties-list"
                    value={op.counterpartyName ?? ''}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      const exact1C = directoryOptions1C.find(
                        (d) => d.name.toLowerCase() === nextVal.trim().toLowerCase()
                      );
                      if (exact1C) {
                        onBind1C(exact1C);
                        return;
                      }
                      onUpdate((prev) => ({ ...prev, counterpartyName: nextVal }));
                    }}
                    placeholder="ООО «...» / АО «...» / ИП ..."
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                  />

                  {quickPickChips.length > 0 && (
                    <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">Быстрый выбор:</span>
                      {quickPickChips.map((chip) => (
                        <button
                          key={`${chip.name}-${chip.inn}`}
                          type="button"
                          onClick={() =>
                            onQuickAssignCounterparty(chip.name, chip.inn, chip.kpp)
                          }
                          className="px-2.5 py-0.5 rounded-full border border-amber-300/80 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/60 text-[11px] font-medium text-amber-900 dark:text-amber-200 transition-colors"
                        >
                          {chip.name}
                          {chip.hint ? ` (${chip.hint})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      ИНН
                    </label>
                    <input
                      type="text"
                      value={op.counterpartyInn ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          counterpartyInn: e.target.value.replace(/\D/g, ''),
                          counterpartySource: 'manual',
                        }))
                      }
                      placeholder="10/12 цифр"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      КПП
                    </label>
                    <input
                      type="text"
                      value={op.counterpartyKpp ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({
                          ...prev,
                          counterpartyKpp: e.target.value.replace(/\D/g, ''),
                          counterpartySource: 'manual',
                        }))
                      }
                      placeholder="9 цифр"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Договор
                    </label>
                    <input
                      type="text"
                      value={op.contractName ?? ''}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, contractName: e.target.value }))
                      }
                      placeholder="Договор"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    />
                  </div>
                </div>

                {op.egrulCandidates && op.egrulCandidates.length > 1 && (
                  <select
                    aria-label="Выбор филиала из ЕГРЮЛ"
                    value={`${op.counterpartyInn}:${op.counterpartyKpp}`}
                    onChange={(e) => {
                      const found = op.egrulCandidates?.find(
                        (c) => `${c.inn}:${c.kpp}` === e.target.value
                      );
                      if (found) onSelectEgrulCandidate(found);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 text-slate-900 dark:text-slate-100 text-[11px] tabular-nums"
                  >
                    {op.egrulCandidates.map((c, idx) => (
                      <option key={`${c.inn}-${c.kpp}-${idx}`} value={`${c.inn}:${c.kpp}`}>
                        ЕГРЮЛ: ИНН {c.inn}
                        {c.kpp ? ` / КПП ${c.kpp}` : ''} — {c.region || c.address || c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Amount & VAT Controls */}
              <div className="lg:col-span-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Сумма документа, ₽
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={op.amount ?? 0}
                      onChange={(e) => {
                        const nextAmt = parseRussianNumber(e.target.value);
                        onUpdate((prev) => ({
                          ...prev,
                          amount: nextAmt,
                          amountMode: nextAmt < 0.01 ? 'required_missing' : 'explicit',
                          readinessStatus: nextAmt < 0.01 ? 'critical_error' : 'ready',
                          needsAmount: nextAmt < 0.01 ? true : undefined,
                        }));
                      }}
                      className={`w-full px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-right text-xs ${
                        isCriticalMissingAmount
                          ? 'border-rose-400 dark:border-rose-700'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      НДС
                    </label>
                    <select
                      value={op.vatRule === 'none' ? 'none' : `${op.vatRate}_${op.vatRule}`}
                      onChange={(e) => {
                        const val = e.target.value;
                        onUpdate((prev) => {
                          if (val === 'none') {
                            return { ...prev, vatRule: 'none', vatRate: 0, vatAmount: 0 };
                          }
                          const [rateStr, ruleStr] = val.split('_');
                          const rate = Number(rateStr);
                          const rule = ruleStr as 'included' | 'on_top';
                          const vatAmt =
                            rule === 'included'
                              ? Math.round(((prev.amount * rate) / (100 + rate)) * 100) / 100
                              : Math.round(((prev.amount * rate) / (100 + rate)) * 100) / 100;
                          return { ...prev, vatRate: rate, vatRule: rule, vatAmount: vatAmt };
                        });
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
                    >
                      <option value="20_included">В т.ч. НДС 20%</option>
                      <option value="20_on_top">Сверху НДС 20%</option>
                      <option value="10_included">В т.ч. НДС 10%</option>
                      <option value="none">Без НДС</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(op.hasInvoiceSF)}
                      onChange={(e) =>
                        onUpdate((prev) => ({ ...prev, hasInvoiceSF: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Счёт-фактура / УПД</span>
                  </label>
                  <span className="tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                    НДС: {formatMoney(op.vatAmount, true)} ₽
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Inline Editable Accounting Postings Table */}
          {(!isHireOrder || op.entries.length > 0) && (
            <div className="border-t border-slate-100 dark:border-slate-800/80 px-4 py-3 bg-slate-50/40 dark:bg-slate-950/30">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <span className="font-medium tabular-nums">
                    Бухгалтерские проводки (РСБУ 1С:БП 3.0) · строк: {op.entries.length}
                  </span>
                  {op.entries.some((e) => e.isOffBalance || isOffBalanceAccountCode(e.debit)) && (
                    <span>+ забалансовый учёт МЦ</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate((prev) => ({
                      ...prev,
                      entries: [
                        ...prev.entries,
                        {
                          id: `${prev.id}-e${prev.entries.length + 1}-${Date.now()}`,
                          debit: isInternalWarehouse ? prev.costAccount || '20.01' : '26',
                          credit: isInternalWarehouse
                            ? prev.materialAccount || '10.01'
                            : isPayrollAccrual
                              ? '70'
                              : '60.01',
                          debitSubconto: '',
                          creditSubconto: '',
                          amount: prev.amount,
                          description: prev.description,
                        },
                      ],
                    }))
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
                >
                  <Plus className="w-3 h-3" strokeWidth={1.6} />
                  Добавить проводку
                </button>
              </div>

              <div className="space-y-1.5">
                {op.entries.map((entry) => {
                  const isOffBal =
                    Boolean(entry.isOffBalance) ||
                    isOffBalanceAccountCode(entry.debit) ||
                    isOffBalanceAccountCode(entry.credit);
                  const showAuto1CHint =
                    op.amountMode === 'calculated_by_1c' && entry.amount < 0.01;

                  return (
                    <div
                      key={entry.id}
                      className="grid grid-cols-12 gap-2 items-center text-xs"
                    >
                      <div className="col-span-2 sm:col-span-1">
                        <input
                          type="text"
                          list="rsbu-accounts-list"
                          aria-label="Счёт Дебета"
                          value={entry.debit ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              entries: prev.entries.map((x) =>
                                x.id === entry.id ? { ...x, debit: e.target.value.trim() } : x
                              ),
                            }))
                          }
                          placeholder="Дт"
                          className="w-full px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-xs"
                        />
                      </div>

                      <div className="col-span-2 sm:col-span-1">
                        {isOffBal && !entry.credit ? (
                          <div
                            title="Односторонняя забалансовая запись"
                            className="w-full px-1.5 py-1 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60 text-[10px] text-center text-slate-500 dark:text-slate-400"
                          >
                            забаланс
                          </div>
                        ) : (
                          <input
                            type="text"
                            list="rsbu-accounts-list"
                            aria-label="Счёт Кредита"
                            value={entry.credit ?? ''}
                            onChange={(e) =>
                              onUpdate((prev) => ({
                                ...prev,
                                entries: prev.entries.map((x) =>
                                  x.id === entry.id
                                    ? { ...x, credit: e.target.value.trim() }
                                    : x
                                ),
                              }))
                            }
                            placeholder="Кт"
                            className="w-full px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums font-semibold text-xs"
                          />
                        )}
                      </div>

                      <div className="col-span-4 sm:col-span-3">
                        <input
                          type="text"
                          value={entry.debitSubconto ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              entries: prev.entries.map((x) =>
                                x.id === entry.id ? { ...x, debitSubconto: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="Субконто Дт"
                          className="w-full px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300"
                        />
                      </div>

                      <div className="hidden sm:block sm:col-span-3">
                        <input
                          type="text"
                          value={entry.creditSubconto ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              entries: prev.entries.map((x) =>
                                x.id === entry.id
                                  ? { ...x, creditSubconto: e.target.value }
                                  : x
                              ),
                            }))
                          }
                          placeholder={isOffBal ? 'Односторонний учёт МЦ' : 'Субконто Кт'}
                          className="w-full px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300"
                        />
                      </div>

                      <div className="hidden sm:block sm:col-span-2">
                        <input
                          type="text"
                          value={entry.description ?? ''}
                          onChange={(e) =>
                            onUpdate((prev) => ({
                              ...prev,
                              entries: prev.entries.map((x) =>
                                x.id === entry.id ? { ...x, description: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="Содержание проводки"
                          className="w-full px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300"
                        />
                      </div>

                      <div className="col-span-4 sm:col-span-2 flex items-center gap-1">
                        <div className="relative w-full">
                          <input
                            type="number"
                            step="0.01"
                            value={entry.amount ?? 0}
                            onChange={(e) =>
                              onUpdate((prev) => ({
                                ...prev,
                                entries: prev.entries.map((x) =>
                                  x.id === entry.id
                                    ? { ...x, amount: parseRussianNumber(e.target.value) }
                                    : x
                                ),
                              }))
                            }
                            className="w-full px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums text-right font-medium text-xs"
                          />
                          {showAuto1CHint && (
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-sky-700 dark:text-sky-400">
                              авто 1С
                            </span>
                          )}
                        </div>
                        {op.entries.length > 1 && (
                          <button
                            type="button"
                            aria-label="Удалить проводку"
                            onClick={() =>
                              onUpdate((prev) => ({
                                ...prev,
                                entries: prev.entries.filter((x) => x.id !== entry.id),
                              }))
                            }
                            className="p-1 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3 h-3" strokeWidth={1.6} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Collapsible Step-by-Step 1C:Бухгалтерия 8.3 (ред. 3.0) Mentor Panel */}
          <div className="border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              aria-expanded={isGuideOpen}
              onClick={onToggleGuide}
              className="w-full px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-b-2xl transition-colors"
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <BookOpenCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" strokeWidth={1.6} />
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  Пошаговая инструкция по проведению в 1С:Бухгалтерия 8.3
                </span>
                <span className="hidden md:inline text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  · {mentorGuide.navigationPath1C}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 shrink-0">
                {isGuideOpen ? 'Свернуть инструкцию' : 'Открыть разбор 1С'}
                {isGuideOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.6} />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.6} />
                )}
              </span>
            </button>

            {isGuideOpen && (
              <div className="px-4 py-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40 rounded-b-2xl space-y-3.5 text-xs">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                  <div className="lg:col-span-7 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      01. Бухгалтерский смысл операции (РСБУ / ФСБУ)
                    </div>
                    <p className="text-slate-900 dark:text-slate-100 leading-relaxed">
                      {mentorGuide.accountingMeaning}
                    </p>
                    <p className="text-sky-800 dark:text-sky-300 leading-relaxed">
                      <strong className="font-semibold">Правило суммы и НДС: </strong>
                      {mentorGuide.whyAmountOrVatRule}
                    </p>
                  </div>

                  <div className="lg:col-span-5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      02. Где создать документ в 1С:БП 3.0
                    </div>
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Путь в меню: </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {mentorGuide.navigationPath1C}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Документ: </span>
                        <span className="text-amber-800 dark:text-amber-300 font-medium">
                          {mentorGuide.documentOperationKind1C}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      03. Заполнение шапки документа
                    </div>
                    <div className="divide-y divide-slate-200/70 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                      {mentorGuide.headerFieldsSteps.map((hf, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1"
                        >
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            {hf.field}
                          </span>
                          <div className="sm:text-right min-w-0">
                            <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                              {hf.value}
                            </span>
                            {hf.hint && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                {hf.hint}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      04. Табличные части и вкладки
                    </div>
                    <div className="divide-y divide-slate-200/70 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                      {mentorGuide.tabularAndTabsSteps.map((tf, idx) => (
                        <div key={idx} className="px-3 py-2 space-y-0.5">
                          <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                            {tf.tabName}
                          </div>
                          <div className="text-slate-700 dark:text-slate-300 leading-snug">
                            {tf.instruction}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
                  <div className="lg:col-span-6 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      05. Эталонные проводки по кнопке «Дт/Кт»
                    </div>
                    <div className="divide-y divide-slate-200/70 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                      {mentorGuide.referencePostings.map((rp, i) => (
                        <div key={i} className="px-3 py-2 space-y-0.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums text-[11px]">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              Дт {rp.debit}{' '}
                              {rp.isOffBalance ? '· забаланс' : `→ Кт ${rp.credit}`}
                            </span>
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {rp.amountRule}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {rp.purpose}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-6 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      06. Самопроверка по ОСВ и частые ошибки на защите
                    </div>
                    <ul className="space-y-1 text-[11px] text-emerald-800 dark:text-emerald-300">
                      {mentorGuide.selfCheckOsv.map((chk, i) => (
                        <li key={i} className="leading-snug">
                          — {chk}
                        </li>
                      ))}
                    </ul>
                    {mentorGuide.commonStudentMistakes.length > 0 && (
                      <div className="pt-1 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          Частые ошибки студентов:
                        </div>
                        <ul className="space-y-0.5">
                          {mentorGuide.commonStudentMistakes.map((warn, i) => (
                            <li key={i} className="leading-snug">
                              — {warn}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
