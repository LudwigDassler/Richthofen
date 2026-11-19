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
  Layers,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { buildExportBundle } from '@/lib/export1c';
import { ExportFormat1C } from '@/types/accounting';

export function Tab4Export1C() {
  const {
    db1C,
    operations,
    osvReport,
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
        fullState: {
          version: 2,
          activeTab,
          db1C,
          balanceAnchorOverride,
          includeQueuedInOsv,
          periodFilter,
          operations,
          resolvedInlineNotes: {},
          exportMode,
        },
      }),
    [
      exportMode,
      db1C,
      operations,
      osvReport,
      activeTab,
      balanceAnchorOverride,
      includeQueuedInOsv,
      periodFilter,
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
    <div className="space-y-4">
      {/* Mode A vs Mode B Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setExportMode('incremental')}
          className={`text-left p-4 rounded border transition-colors ${
            exportMode === 'incremental'
              ? 'border-amber-600 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] hover:border-zinc-300 dark:hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-950 dark:text-white">
              Режим А: Дозагрузить в текущую БД 1С
            </span>
            <Layers
              className={`w-4 h-4 ${
                exportMode === 'incremental' ? 'text-amber-600' : 'text-zinc-400'
              }`}
            />
          </div>
          <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Создаёт только недостающие элементы справочников (без дублей, с проверкой по ИНН и наименованию) и проводит новые документы и регламентные операции периода.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setExportMode('clean_db')}
          className={`text-left p-4 rounded border transition-colors ${
            exportMode === 'clean_db'
              ? 'border-amber-600 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] hover:border-zinc-300 dark:hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-950 dark:text-white">
              Режим Б: Развернуть с нуля в чистую БД 1С
            </span>
            <DatabaseBackup
              className={`w-4 h-4 ${
                exportMode === 'clean_db' ? 'text-amber-600' : 'text-zinc-400'
              }`}
            />
          </div>
          <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Создаёт Организацию со всеми реквизитами, переносит полные справочники, формирует начальные остатки через счёт 000 на начало периода и проводит все документы.
          </p>
        </button>
      </div>

      {/* Export Package Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3">
          <div className="text-zinc-500">Контрагенты</div>
          <div className="mt-1 text-base font-mono font-semibold tabular-nums">
            {bundle.stats.counterpartiesCount}
          </div>
        </div>
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3">
          <div className="text-zinc-500">Договоры</div>
          <div className="mt-1 text-base font-mono font-semibold tabular-nums">
            {bundle.stats.contractsCount}
          </div>
        </div>
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3">
          <div className="text-zinc-500">Номенклатура</div>
          <div className="mt-1 text-base font-mono font-semibold tabular-nums">
            {bundle.stats.nomenclatureCount}
          </div>
        </div>
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3">
          <div className="text-zinc-500">Строк нач. остатков</div>
          <div className="mt-1 text-base font-mono font-semibold tabular-nums">
            {bundle.stats.openingBalanceLinesCount}
          </div>
        </div>
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3">
          <div className="text-zinc-500">Документов 1С</div>
          <div className="mt-1 text-base font-mono font-semibold tabular-nums">
            {bundle.stats.documentsToPostCount}
          </div>
        </div>
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] p-3">
          <div className="text-zinc-500">Проводок Дт/Кт</div>
          <div className="mt-1 text-base font-mono font-semibold tabular-nums">
            {bundle.stats.entriesCount}
          </div>
        </div>
      </div>

      {/* Format Tabs + Download Actions + Code Preview */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121418] overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFormat('bsl')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium ${
                format === 'bsl'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              1. Модуль 1С 8.3 (.bsl / .txt)
            </button>

            <button
              type="button"
              onClick={() => setFormat('xml_edo')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium ${
                format === 'xml_edo'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              2. XML EnterpriseData 1.8 (.xml)
            </button>

            <button
              type="button"
              onClick={() => setFormat('json')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium ${
                format === 'json'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              3. Полный слепок JSON (.json)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium text-zinc-800 dark:text-zinc-200"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
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
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  Скачать Import_To_1C_BSL.bsl
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(bundle.bslCode, 'Import_To_1C_BSL.txt', 'text/plain')
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium"
                >
                  <HardDriveDownload className="w-3.5 h-3.5" />
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
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
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
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Скачать 1c_workbench_snapshot.json
              </button>
            )}
          </div>
        </div>

        {/* Format Usage Hint */}
        <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 bg-white dark:bg-[#121418]">
          {format === 'bsl' && (
            <span>
              Готовый серверный код для <strong>1С:Бухгалтерия 8.3 (ред. 3.0)</strong>: включает процедуру{' '}
              <code className="font-mono">ВыполнитьЗагрузку()</code>, идемпотентный поиск по ИНН/наименованию, проведение документов БП 3.0 и обработку исключений <code className="font-mono">Попытка ... Исключение</code>.
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

        <pre className="p-4 bg-zinc-950 text-zinc-100 font-mono text-xs leading-relaxed overflow-auto max-h-[540px]">
          {activeContent}
        </pre>
      </div>
    </div>
  );
}
