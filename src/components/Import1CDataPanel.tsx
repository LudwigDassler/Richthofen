'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import {
  generateSample1CQ1Workbook,
  loadSample1CQ1Preview,
  parse1CExportFiles,
  Parsed1CAutoFillItem,
  Parsed1CImportResult,
} from '@/lib/import1c';
import { OpeningBalanceEntry } from '@/types/accounting';

function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ₽'
  );
}

function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function Import1CDataPanel({
  compact = false,
  onApplied,
}: {
  compact?: boolean;
  onApplied?: () => void;
}) {
  const {
    rawOperations,
    organization,
    openingBalances,
    applyImported1CData,
    clearOpeningBalances,
  } = useAccountant();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appliedSuccessMsg, setAppliedSuccessMsg] = useState<string | null>(null);

  const [preview, setPreview] = useState<Parsed1CImportResult | null>(null);
  const [editableBalances, setEditableBalances] = useState<OpeningBalanceEntry[]>([]);
  const [mergeMode, setMergeMode] = useState<'replace' | 'merge'>('replace');

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsLoading(true);
    setErrorMsg(null);
    setAppliedSuccessMsg(null);

    try {
      const result = await parse1CExportFiles(files, rawOperations, organization);
      if (
        result.openingBalances.length === 0 &&
        !result.organizationPatch &&
        result.counterparties.length === 0
      ) {
        setErrorMsg(
          result.warnings[0] ||
            'Не удалось обнаружить счета ОСВ, реквизиты организации или контрагентов в выбранных файлах 1С.'
        );
        setPreview(null);
      } else {
        setPreview(result);
        setEditableBalances(result.openingBalances);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Ошибка при чтении файлов выгрузки 1С:Бухгалтерия 8.3.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestSampleImport = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setAppliedSuccessMsg(null);

    try {
      const result = await loadSample1CQ1Preview(rawOperations, organization);
      setPreview(result);
      setEditableBalances(result.openingBalances);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Не удалось сформировать тестовую выгрузку 1С.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadSampleXlsx = () => {
    try {
      const { buffer, filename } = generateSample1CQ1Workbook();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Ошибка скачивания примера файла ОСВ 1С.'
      );
    }
  };

  const handleUpdateBalanceRow = (
    idx: number,
    patch: Partial<OpeningBalanceEntry>
  ) => {
    setEditableBalances((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };

  const handleApplyToTask = () => {
    if (!preview) return;

    applyImported1CData({
      openingBalances: editableBalances,
      mergeMode,
      organizationPatch: preview.organizationPatch,
      counterparties: preview.counterparties,
      employees: preview.employees,
    });

    const accCount = new Set(editableBalances.map((b) => b.accountCode)).size;
    setAppliedSuccessMsg(
      `Перенесено счетов: ${accCount}, контрагентов: ${preview.counterpartiesAndContractsCount}, автоматически рассчитано операций: ${preview.autoFilledOperationsCount}.`
    );
    setPreview(null);
    if (onApplied) {
      onApplied();
    }
  };

  const orgPatchEntries = preview?.organizationPatch
    ? Object.entries(preview.organizationPatch).filter(
        ([, val]) => val !== undefined && val !== ''
      )
    : [];

  return (
    <div className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Database className="w-4 h-4 text-zinc-600 dark:text-zinc-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Импорт данных из 1С:Бухгалтерия 8.3 за закрытый 1 квартал
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Поддерживаются: общая ОСВ (`.xlsx`, `.xls`, `.csv`), ОСВ по счетам 60, 62, 68, 69, 70 с договорами, XML (`EnterpriseData`) и Клиент-Банк (`1c_to_kl.txt`)
            </p>
          </div>
        </div>

        {openingBalances.length > 0 && !preview && (
          <button
            type="button"
            onClick={() => {
              clearOpeningBalances();
              setAppliedSuccessMsg(null);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-600 hover:text-rose-700 bg-[#FAFAFA] hover:bg-rose-50 dark:bg-[#09090B] dark:text-zinc-400 dark:hover:bg-rose-950/30 border border-zinc-200 dark:border-zinc-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Очистить остатки</span>
          </button>
        )}
      </div>

      {appliedSuccessMsg && (
        <div className="p-3 rounded-md bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 flex items-center gap-2 text-xs font-medium text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Данные из 1С применены: {appliedSuccessMsg}</span>
        </div>
      )}

      {!preview && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              void handleFilesSelected(e.dataTransfer.files);
            }
          }}
          className={`border border-dashed border-zinc-300 dark:border-zinc-700 rounded-md ${
            compact ? 'p-4' : 'p-5'
          } text-center bg-[#FAFAFA] dark:bg-[#09090B] space-y-3`}
        >
          <div className="flex justify-center">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
            ) : (
              <Upload className="w-5 h-5 text-zinc-500" />
            )}
          </div>

          <div>
            <p className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Перетащите сюда файлы выгрузки из 1С 8.3 (ОСВ за 1 кв. + ОСВ по счетам 60, 68, 70)
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              Конечное сальдо на 31.03 переносится как входящее на 01.04 без задвоения субсчетов
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Выбрать файлы 1С (.xlsx, .csv, .xml, .txt, .json)</span>
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.xml,.txt,.json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void handleFilesSelected(e.target.files);
                  }
                }}
              />
            </label>

            <button
              type="button"
              disabled={isLoading}
              onClick={handleTestSampleImport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Проверить на тестовой выгрузке 1С за 1 кв. (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadSampleXlsx}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать пример ОСВ 1 кв. (.xlsx)</span>
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-md bg-rose-50/70 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 flex items-start gap-2 text-xs text-rose-900 dark:text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Preview Screen After Upload */}
      {preview && (
        <div className="space-y-4 pt-1">
          <div className="p-3.5 rounded-md bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-300 dark:border-emerald-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950 dark:text-emerald-200 font-mono tabular-nums">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Распознано счетов: {new Set(editableBalances.map((b) => b.accountCode)).size}, контрагентов и договоров:{' '}
                  {preview.counterpartiesAndContractsCount}, автоматически заполнено пустых сумм в задаче:{' '}
                  {preview.autoFilledOperationsCount}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
              >
                ← Загрузить другие файлы
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {preview.detectedFormats.map((fmt: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded font-medium bg-white dark:bg-[#111113] text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
                >
                  {fmt}
                </span>
              ))}
              {preview.periodLabel && (
                <span className="px-2 py-0.5 rounded font-mono tabular-nums bg-white dark:bg-[#111113] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                  {preview.periodLabel}
                </span>
              )}
            </div>
          </div>

          {preview.autoFilledOperations.length > 0 && (
            <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-2">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Автоматически заполнены пустые суммы в операциях задачи:
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {preview.autoFilledOperations.map((item: Parsed1CAutoFillItem) => (
                  <div
                    key={item.operationId}
                    className="p-2.5 rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                        Оп. №{item.operationNumber}
                      </span>
                      <span className="text-xs font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                        {formatRub(item.resolvedAmount)}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1">
                      {item.description}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                      {item.explanation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {orgPatchEntries.length > 0 && (
            <div className="p-3 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <Building2 className="w-3.5 h-3.5" />
                <span>Распознаны реквизиты организации:</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                {preview.organizationPatch?.shortName && (
                  <span>{preview.organizationPatch.shortName}</span>
                )}
                {preview.organizationPatch?.inn && (
                  <span>ИНН {preview.organizationPatch.inn}</span>
                )}
                {preview.organizationPatch?.kpp && (
                  <span>КПП {preview.organizationPatch.kpp}</span>
                )}
                {preview.organizationPatch?.bankAccount && (
                  <span>р/сч {preview.organizationPatch.bankAccount}</span>
                )}
                {preview.organizationPatch?.bik && (
                  <span>БИК {preview.organizationPatch.bik}</span>
                )}
              </div>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="p-3 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 space-y-0.5">
              {preview.warnings.map((w: string, idx: number) => (
                <div key={idx}>• {w}</div>
              ))}
            </div>
          )}

          {editableBalances.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Входящие остатки на 01.04 (можно скорректировать перед применением):
                </span>

                <div className="flex items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="mergeMode1c"
                      checked={mergeMode === 'replace'}
                      onChange={() => setMergeMode('replace')}
                    />
                    <span>Заменить остатки</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="mergeMode1c"
                      checked={mergeMode === 'merge'}
                      onChange={() => setMergeMode('merge')}
                    />
                    <span>Дополнить текущие</span>
                  </label>
                </div>
              </div>

              <div className="max-h-72 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="py-2 px-2.5 font-semibold w-24">Счет</th>
                      <th className="py-2 px-2.5 font-semibold">Субконто 1</th>
                      <th className="py-2 px-2.5 font-semibold">Субконто 2</th>
                      <th className="py-2 px-2.5 font-semibold text-right w-32">Сальдо Дт, ₽</th>
                      <th className="py-2 px-2.5 font-semibold text-right w-32">Сальдо Кт, ₽</th>
                      <th className="py-2 px-2 font-semibold w-9" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {editableBalances.map((row, idx) => (
                      <tr key={row.id || idx} className="bg-white dark:bg-[#111113]">
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.accountCode}
                            onChange={(e) =>
                              handleUpdateBalanceRow(idx, { accountCode: e.target.value })
                            }
                            className="w-full px-2 py-1 rounded font-mono tabular-nums font-semibold text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.subconto1 || ''}
                            onChange={(e) =>
                              handleUpdateBalanceRow(idx, { subconto1: e.target.value })
                            }
                            placeholder="—"
                            className="w-full px-2 py-1 rounded text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.subconto2 || ''}
                            onChange={(e) =>
                              handleUpdateBalanceRow(idx, { subconto2: e.target.value })
                            }
                            placeholder="—"
                            className="w-full px-2 py-1 rounded font-mono tabular-nums text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.debit || ''}
                            placeholder="0,00"
                            onChange={(e) =>
                              handleUpdateBalanceRow(idx, {
                                debit: roundMoney(Math.max(0, Number(e.target.value) || 0)),
                              })
                            }
                            className="w-full px-2 py-1 rounded font-mono tabular-nums font-semibold text-right text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.credit || ''}
                            placeholder="0,00"
                            onChange={(e) =>
                              handleUpdateBalanceRow(idx, {
                                credit: roundMoney(Math.max(0, Number(e.target.value) || 0)),
                              })
                            }
                            className="w-full px-2 py-1 rounded font-mono tabular-nums font-semibold text-right text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setEditableBalances((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1 rounded text-zinc-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="px-3.5 py-2 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleApplyToTask}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Применить данные из 1С к задаче</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
