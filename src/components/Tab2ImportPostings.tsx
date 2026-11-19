'use client';

import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  CopyCheck,
  FilePlus2,
  FolderUp,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { CHART_OF_ACCOUNTS } from '@/data/chartOfAccounts';
import { DocType1CBP30, QueuedOperation } from '@/types/accounting';
import { parseRussianNumber } from '@/lib/import1c';

const DOC_TYPES_1C: DocType1CBP30[] = [
  'СписаниеСРасчетногоСчета',
  'ПоступлениеНаРасчетныйСчет',
  'ПоступлениеТоваровУслуг',
  'РеализацияТоваровУслуг',
  'СчетФактураПолученный',
  'СчетФактураВыданный',
  'ПоступлениеНаличных',
  'ВыдачаНаличных',
  'НачислениеЗарплаты',
  'КорректировкаДолга',
  'ОперацияБух',
  'ЗакрытиеМесяца',
];

export function Tab2ImportPostings() {
  const {
    db1C,
    operations,
    importOperationFiles,
    importOperationsFromText,
    addBlankOperation,
    updateOperation,
    rebuildSingleOperationPostings,
    removeOperation,
    clearAllOperations,
    setActiveTab,
  } = useAccountant();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'duplicates'>('all');

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

  const filteredOperations = operations.filter((op) => {
    if (filterMode === 'active') return op.includeInProcessing;
    if (filterMode === 'duplicates') return op.isDuplicateIn1C;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Datalists for fast autocomplete strictly from Chart of Accounts & 1C DB */}
      <datalist id="rsbu-accounts-list">
        {CHART_OF_ACCOUNTS.filter((a) => !a.isGroup).map((acc) => (
          <option key={acc.code} value={acc.code}>
            {acc.name}
          </option>
        ))}
      </datalist>
      <datalist id="db1c-counterparties-list">
        {(db1C?.counterparties ?? []).map((cp) => (
          <option key={cp.id} value={cp.name}>
            {cp.inn ? `ИНН ${cp.inn}` : ''}
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
        className={`rounded-lg border-2 border-dashed p-5 bg-white dark:bg-[#121418] transition-colors ${
          isDragging
            ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20'
            : 'border-zinc-300 dark:border-zinc-800'
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
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Пакетная загрузка первичных документов, выписок и реестров
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Перетащите сразу пачку файлов:{' '}
              <span className="font-mono">.xlsx / .xls</span> (таблицы операций),{' '}
              <span className="font-mono">.csv / .tsv</span>,{' '}
              <span className="font-mono">.txt</span> (выписки <span className="font-mono">1CClientBankExchange</span> и списки),{' '}
              <span className="font-mono">.xml</span> (<span className="font-mono">EnterpriseData / CommerceML</span>) или{' '}
              <span className="font-mono">.json</span> (база 1С / операции). Дубликаты с текущей БД 1С помечаются автоматически.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
            >
              <FolderUp className="w-4 h-4" />
              Загрузить файлы (пачкой)
            </button>

            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200"
            >
              <ClipboardPaste className="w-4 h-4 text-zinc-500" />
              Вставить текст / таблицу
            </button>

            <button
              type="button"
              onClick={addBlankOperation}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200"
            >
              <FilePlus2 className="w-4 h-4 text-zinc-500" />
              + Операция вручную
            </button>
          </div>
        </div>

        {showPasteBox && (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Вставьте скопированные строки из Excel, банковской выписки или текстовое описание операций (по одной на строке):
            </label>
            <textarea
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Пример: 15.04.2025 Поступили материалы от ООО «СнабТех» (ИНН 7708123456) по договору № 12 на сумму 180 000 руб., в т.ч. НДС 20%, УПД № 44"
              className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 p-2.5 text-xs font-mono focus:outline-none focus:border-amber-600"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasteBox(false)}
                className="px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300"
              >
                Скрыть
              </button>
              <button
                type="button"
                onClick={handlePasteSubmit}
                className="px-3.5 py-1.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-medium"
              >
                Разобрать и сформировать проводки
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Queue Controls Strip */}
      {operations.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] px-3.5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded font-medium ${
                filterMode === 'all'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              Все в очереди ({operations.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('active')}
              className={`px-2.5 py-1 rounded font-medium ${
                filterMode === 'active'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              К проведению ({activeCount})
            </button>
            {dupCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterMode('duplicates')}
                className={`px-2.5 py-1 rounded font-medium ${
                  filterMode === 'duplicates'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                Дубликаты в БД 1С ({dupCount})
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('audit_autofix')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Проверить и автозаполнить по БД 1С
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {confirmClear ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmClear(false);
                    clearAllOperations();
                  }}
                  className="px-2.5 py-1 rounded bg-red-600 text-white font-medium"
                >
                  Очистить всё
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-red-600"
              >
                Очистить очередь
              </button>
            )}
          </div>
        </div>
      )}

      {/* Operations Cards / High-Density Inline Editor */}
      {filteredOperations.length === 0 ? (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] py-12 text-center text-xs text-zinc-500">
          Очередь операций пуста. Загрузите файлы (.xlsx, .csv, .txt, .xml, .json) или вставьте текст выше.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOperations.map((op, index) => (
            <OperationEditorCard
              key={op.id}
              index={index + 1}
              op={op}
              dbConnected={Boolean(db1C)}
              onUpdate={(updater) => updateOperation(op.id, updater)}
              onRebuild={() => rebuildSingleOperationPostings(op.id)}
              onRemove={() => removeOperation(op.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OperationEditorCard({
  index,
  op,
  dbConnected,
  onUpdate,
  onRebuild,
  onRemove,
}: {
  index: number;
  op: QueuedOperation;
  dbConnected: boolean;
  onUpdate: (updater: (prev: QueuedOperation) => QueuedOperation) => void;
  onRebuild: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`rounded border bg-white dark:bg-[#121418] transition-opacity ${
        op.includeInProcessing
          ? 'border-zinc-200 dark:border-zinc-800'
          : 'border-zinc-200/70 dark:border-zinc-800/60 opacity-65'
      }`}
    >
      {/* Top Document Header Row */}
      <div className="px-3.5 py-2.5 border-b border-zinc-100 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/60 dark:bg-zinc-900/30">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-zinc-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={op.includeInProcessing}
              onChange={(e) =>
                onUpdate((prev) => ({ ...prev, includeInProcessing: e.target.checked }))
              }
              className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="font-mono text-zinc-500">#{index}</span>
          </label>

          <input
            type="date"
            aria-label="Дата операции"
            value={op.date}
            onChange={(e) => onUpdate((prev) => ({ ...prev, date: e.target.value }))}
            className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs"
          />

          <input
            type="text"
            value={op.docNumber}
            onChange={(e) => onUpdate((prev) => ({ ...prev, docNumber: e.target.value }))}
            placeholder="№ док."
            className="w-24 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs"
          />

          <select
            aria-label="Вид документа 1С"
            value={op.docType1C}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                docType1C: e.target.value as DocType1CBP30,
              }))
            }
            className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-medium text-xs text-zinc-900 dark:text-zinc-100"
          >
            {DOC_TYPES_1C.map((dt) => (
              <option key={dt} value={dt}>
                1С: {dt}
              </option>
            ))}
          </select>

          <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[180px]">
            {op.sourceFileName}
          </span>

          {op.isDuplicateIn1C && (
            <span
              title={op.duplicateReason}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-medium"
            >
              <CopyCheck className="w-3 h-3" />
              Уже в БД 1С (дубликат)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRebuild}
            title="Пересчитать автопроводки и сопоставление со справочниками 1С"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-medium text-zinc-700 dark:text-zinc-300"
          >
            <RefreshCcw className="w-3 h-3" />
            Пересчитать проводки
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Удалить операцию"
            className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Requisites & Amount Grid */}
      <div className="p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 text-xs">
        <div className="lg:col-span-5 space-y-2">
          <div>
            <label className="block text-[11px] text-zinc-500 mb-0.5">
              Содержание / Назначение платежа
            </label>
            <input
              type="text"
              value={op.description}
              onChange={(e) =>
                onUpdate((prev) => ({ ...prev, description: e.target.value }))
              }
              className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">
                Номенклатура / Услуга
              </label>
              <input
                type="text"
                value={op.nomenclatureName}
                onChange={(e) =>
                  onUpdate((prev) => ({ ...prev, nomenclatureName: e.target.value }))
                }
                placeholder="Наименование ТМЦ / услуги"
                className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">
                Склад / Статья затрат
              </label>
              <input
                type="text"
                value={op.warehouseName || op.expenseItemName}
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdate((prev) =>
                    ['purchase_goods', 'purchase_materials', 'sale_goods'].includes(prev.category)
                      ? { ...prev, warehouseName: v }
                      : { ...prev, expenseItemName: v }
                  );
                }}
                placeholder="Склад или статья затрат"
                className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Counterparty & 1C Binding Status */}
        <div className="lg:col-span-4 space-y-2">
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[11px] text-zinc-500">Контрагент</label>
              {op.counterpartyName && (
                op.bindings.counterparty.status === 'matched_1c' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />В базе 1С
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {dbConnected ? 'Новый элемент (создастся при экспорте)' : 'Новый элемент'}
                  </span>
                )
              )}
            </div>
            <input
              type="text"
              list="db1c-counterparties-list"
              value={op.counterpartyName}
              onChange={(e) =>
                onUpdate((prev) => ({ ...prev, counterpartyName: e.target.value }))
              }
              placeholder="ООО «...» / ИП ..."
              className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">ИНН</label>
              <input
                type="text"
                value={op.counterpartyInn}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    counterpartyInn: e.target.value.replace(/\D/g, ''),
                  }))
                }
                placeholder="ИНН"
                className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">КПП</label>
              <input
                type="text"
                value={op.counterpartyKpp}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    counterpartyKpp: e.target.value.replace(/\D/g, ''),
                  }))
                }
                placeholder="КПП"
                className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">Договор</label>
              <input
                type="text"
                value={op.contractName}
                onChange={(e) =>
                  onUpdate((prev) => ({ ...prev, contractName: e.target.value }))
                }
                placeholder="Договор"
                className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Amount & VAT Controls */}
        <div className="lg:col-span-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">Сумма документа, ₽</label>
              <input
                type="number"
                step="0.01"
                value={op.amount}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    amount: parseRussianNumber(e.target.value),
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums font-semibold text-right text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">НДС</label>
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
                        : Math.round(((prev.amount * rate) / 100) * 100) / 100;
                    return { ...prev, vatRate: rate, vatRule: rule, vatAmount: vatAmt };
                  });
                }}
                className="w-full px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              >
                <option value="20_included">В т.ч. НДС 20%</option>
                <option value="20_on_top">Сверху НДС 20%</option>
                <option value="10_included">В т.ч. НДС 10%</option>
                <option value="none">Без НДС</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={op.hasInvoiceSF}
                onChange={(e) =>
                  onUpdate((prev) => ({ ...prev, hasInvoiceSF: e.target.checked }))
                }
                className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
              />
              <span>Счёт-фактура / УПД</span>
            </label>
            <span className="font-mono tabular-nums text-[11px] text-zinc-500">
              НДС: {op.vatAmount.toFixed(2)} ₽
            </span>
          </div>
        </div>
      </div>

      {/* Inline Editable Accounting Postings Table */}
      <div className="border-t border-zinc-100 dark:border-zinc-800/80 px-3.5 py-2.5 bg-zinc-50/40 dark:bg-zinc-950/30">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-zinc-500">
            Бухгалтерские проводки (РСБУ 1С БП 3.0):
          </span>
          <button
            type="button"
            onClick={() =>
              onUpdate((prev) => ({
                ...prev,
                entries: [
                  ...prev.entries,
                  {
                    id: `${prev.id}-e${Date.now()}`,
                    debit: '26',
                    credit: '60.01',
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
            <Plus className="w-3 h-3" />
            Добавить проводку
          </button>
        </div>

        <div className="space-y-1.5">
          {op.entries.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-12 gap-2 items-center text-xs"
            >
              <div className="col-span-2 sm:col-span-1">
                <input
                  type="text"
                  list="rsbu-accounts-list"
                  aria-label="Счёт Дебета"
                  value={entry.debit}
                  onChange={(e) =>
                    onUpdate((prev) => ({
                      ...prev,
                      entries: prev.entries.map((x) =>
                        x.id === entry.id ? { ...x, debit: e.target.value.trim() } : x
                      ),
                    }))
                  }
                  placeholder="Дт"
                  className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono font-semibold text-xs"
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <input
                  type="text"
                  list="rsbu-accounts-list"
                  aria-label="Счёт Кредита"
                  value={entry.credit}
                  onChange={(e) =>
                    onUpdate((prev) => ({
                      ...prev,
                      entries: prev.entries.map((x) =>
                        x.id === entry.id ? { ...x, credit: e.target.value.trim() } : x
                      ),
                    }))
                  }
                  placeholder="Кт"
                  className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono font-semibold text-xs"
                />
              </div>

              <div className="col-span-4 sm:col-span-3">
                <input
                  type="text"
                  value={entry.debitSubconto}
                  onChange={(e) =>
                    onUpdate((prev) => ({
                      ...prev,
                      entries: prev.entries.map((x) =>
                        x.id === entry.id ? { ...x, debitSubconto: e.target.value } : x
                      ),
                    }))
                  }
                  placeholder="Субконто Дт"
                  className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300"
                />
              </div>

              <div className="hidden sm:block sm:col-span-3">
                <input
                  type="text"
                  value={entry.creditSubconto}
                  onChange={(e) =>
                    onUpdate((prev) => ({
                      ...prev,
                      entries: prev.entries.map((x) =>
                        x.id === entry.id ? { ...x, creditSubconto: e.target.value } : x
                      ),
                    }))
                  }
                  placeholder="Субконто Кт"
                  className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300"
                />
              </div>

              <div className="hidden sm:block sm:col-span-2">
                <input
                  type="text"
                  value={entry.description}
                  onChange={(e) =>
                    onUpdate((prev) => ({
                      ...prev,
                      entries: prev.entries.map((x) =>
                        x.id === entry.id ? { ...x, description: e.target.value } : x
                      ),
                    }))
                  }
                  placeholder="Содержание проводки"
                  className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300"
                />
              </div>

              <div className="col-span-4 sm:col-span-2 flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  value={entry.amount}
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
                  className="w-full px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono tabular-nums text-right font-medium text-xs"
                />
                {op.entries.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((prev) => ({
                        ...prev,
                        entries: prev.entries.filter((x) => x.id !== entry.id),
                      }))
                    }
                    className="p-1 text-zinc-400 hover:text-red-600"
                    title="Удалить строку проводки"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
