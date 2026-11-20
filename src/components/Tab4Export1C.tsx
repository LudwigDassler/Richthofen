'use client';

import React, { useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  DatabaseBackup,
  Download,
  FileCode2,
  FileJson,
  HardDriveDownload,
  Landmark,
  Layers,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { buildExportBundle } from '@/lib/export1c';
import { ExportFormat1C } from '@/types/accounting';

export function Tab4Export1C() {
  const {
    db1C,
    reportingYear,
    operations,
    osvReport,
    accompanyingActions,
    lastImportStats,
    autoFixChanges,
    exportMode,
    setExportMode,
    activeTab,
    balanceAnchorOverride,
    includeQueuedInOsv,
    periodFilter,
  } = useAccountant();

  const [format, setFormat] = useState<ExportFormat1C>('bsl');
  const [copied, setCopied] = useState(false);

  const bundle = useMemo(
    () =>
      buildExportBundle({
        mode: exportMode,
        db1C,
        operations,
        osv: osvReport,
        reportingYear,
        fullState: {
          version: 2,
          activeTab,
          reportingYear,
          db1C,
          balanceAnchorOverride,
          includeQueuedInOsv,
          periodFilter,
          operations,
          resolvedInlineNotes: {},
          exportMode,
          lastImportStats,
          autoFixChanges,
        },
      }),
    [
      exportMode,
      db1C,
      operations,
      osvReport,
      reportingYear,
      activeTab,
      balanceAnchorOverride,
      includeQueuedInOsv,
      periodFilter,
      lastImportStats,
      autoFixChanges,
    ]
  );

  const activeContent =
    format === 'bsl'
      ? bundle.bslCode
      : format === 'xml_edo'
        ? bundle.enterpriseDataXml
        : bundle.jsonSnapshot;

  const triggerDownload = (content: string, fileName: string, mime: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <div className="space-y-5">
      {/* Mode A vs Mode B Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setExportMode('incremental')}
          className={`text-left p-5 rounded-2xl border transition-all shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
            exportMode === 'incremental'
              ? 'border-amber-500/80 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              Режим А: Дозагрузить в текущую БД 1С ({reportingYear} г.)
            </span>
            <Layers
              strokeWidth={1.6}
              className={`w-4 h-4 ${
                exportMode === 'incremental' ? 'text-amber-600' : 'text-slate-400'
              }`}
            />
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Создаёт недостающие элементы справочников, договоры и банковские счета (с БИК Сбербанка 044030653 или явными реквизитами из операций) и проводит новые документы {reportingYear} года.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setExportMode('clean_db')}
          className={`text-left p-5 rounded-2xl border transition-all shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
            exportMode === 'clean_db'
              ? 'border-amber-500/80 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              Режим Б: Развернуть с нуля в чистую БД 1С ({reportingYear} г.)
            </span>
            <DatabaseBackup
              strokeWidth={1.6}
              className={`w-4 h-4 ${
                exportMode === 'clean_db' ? 'text-amber-600' : 'text-slate-400'
              }`}
            />
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Создаёт Организацию, банковские счета, полные справочники, формирует начальные остатки через счёт 000 на начало {reportingYear} года и проводит все документы.
          </p>
        </button>
      </div>

      {/* Export Package Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Контрагенты</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {bundle.stats.counterpartiesCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Договоры</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {bundle.stats.contractsCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Банк. счета (БИК)</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {bundle.stats.bankAccountsCount ?? 0}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Номенклатура</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {bundle.stats.nomenclatureCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Строк нач. остатков</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {bundle.stats.openingBalanceLinesCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Документов 1С</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {bundle.stats.documentsToPostCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-slate-500">Проводок Дт/Кт</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {bundle.stats.entriesCount}
          </div>
        </div>
      </div>

      {accompanyingActions.length > 0 && (
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <span className="inline-flex items-center gap-2">
            <Landmark className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.6} />
            В пакет выгрузки включены сопутствующие объекты 1С БП 3.0 ({accompanyingActions.length}): банковские счета (НайтиИлиСоздатьБанковскийСчет), договоры, счёта-фактуры и зачёты авансов.
          </span>
          <span className="tabular-nums font-medium text-slate-500">Отчётный год: {reportingYear}</span>
        </div>
      )}

      {/* Format Tabs + Download Actions + Code Preview */}
      <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="px-5 py-3.5 border-b border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFormat('bsl')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium transition-colors ${
                format === 'bsl'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" strokeWidth={1.6} />
              1. Модуль 1С 8.3 (.bsl / .txt)
            </button>

            <button
              type="button"
              onClick={() => setFormat('xml_edo')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium transition-colors ${
                format === 'xml_edo'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" strokeWidth={1.6} />
              2. XML EnterpriseData 1.8 (.xml)
            </button>

            <button
              type="button"
              onClick={() => setFormat('json')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium transition-colors ${
                format === 'json'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" strokeWidth={1.6} />
              3. Полный слепок JSON (.json)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={1.6} />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" strokeWidth={1.6} />
                  Копировать код
                </>
              )}
            </button>

            {format === 'bsl' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(bundle.bslCode, 'Import_To_1C_BSL.bsl', 'text/plain')
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-sm transition-colors"
                >
                  <Download className="w-3.5 h-3.5" strokeWidth={1.6} />
                  Скачать Import_To_1C_BSL.bsl
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(bundle.bslCode, 'Import_To_1C_BSL.txt', 'text/plain')
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium transition-colors"
                >
                  <HardDriveDownload className="w-3.5 h-3.5" strokeWidth={1.6} />
                  .txt
                </button>
              </>
            )}

            {format === 'xml_edo' && (
              <button
                type="button"
                onClick={() =>
                  triggerDownload(
                    bundle.enterpriseDataXml,
                    'EnterpriseData_1C_Export.xml',
                    'application/xml'
                  )
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.6} />
                Скачать EnterpriseData_1C_Export.xml
              </button>
            )}

            {format === 'json' && (
              <button
                type="button"
                onClick={() =>
                  triggerDownload(
                    bundle.jsonSnapshot,
                    '1c_workbench_snapshot.json',
                    'application/json'
                  )
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.6} />
                Скачать 1c_workbench_snapshot.json
              </button>
            )}
          </div>
        </div>

        {/* Format Usage Hint */}
        <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900">
          {format === 'bsl' && (
            <span>
              Готовый серверный код для <strong>1С:Бухгалтерия 8.3 (ред. 3.0)</strong>: включает процедуру{' '}
              <code className="font-mono">ВыполнитьЗагрузку()</code>, идемпотентный поиск по ИНН/наименованию, регистрацию банковских счетов (<code className="font-mono">НайтиИлиСоздатьБанковскийСчет</code>), проведение документов БП 3.0 и обработку исключений <code className="font-mono">Попытка ... Исключение</code>.
            </span>
          )}
          {format === 'xml_edo' && (
            <span>
              Универсальный формат обмена <strong>1С EnterpriseData 1.8</strong> для типовой обработки «Универсальный обмен данными в формате XML» / синхронизации БП 3.0.
            </span>
          )}
          {format === 'json' && (
            <span>
              Полный резервный слепок рабочей сессии (совместим с повторной загрузкой на вкладках 1 и 2).
            </span>
          )}
        </div>

        <pre className="p-5 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed overflow-auto max-h-[540px]">
          {activeContent}
        </pre>
      </div>
    </div>
  );
}
