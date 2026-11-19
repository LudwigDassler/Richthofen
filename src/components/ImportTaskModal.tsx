'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Database,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { BusinessOperation, ExtractedDirectories1C } from '@/types/accounting';
import { Import1CDataPanel } from '@/components/Import1CDataPanel';

type ImportTab = 'import1c' | 'excel' | 'screenshot' | 'text' | 'presets';

const SKIP_SHEET_NAME_RE =
  /осв|оборотн|остатк|справочник|реквизит|1\s*кв|i\s*кв|перв\S*\s*кварт|план\s*счет/i;
const PREFER_Q2_SHEET_NAME_RE =
  /2\s*кв|ii\s*кв|втор\S*\s*кварт|апрел|задан|операц|журнал/i;

const SAMPLE_TEXT_TASK = `1 | 01.04.2026 | Перечислены в бюджет задолженности по налогам и взносам в МИ ФНС №10 по СПб (ИНН 7841000019, КПП 783901001, р/сч 40101810200000010001, БИК 044030001). | 
2 | 02.04.2026 | Перечислен с расчетного счета 100% аванс в ООО "Конкурент" по счету за оконный блок в кол-ве 133 шт по 9300 руб за шт с НДС, для дальнейшей продажи. | 1 236 900
3 | 03.04.2026 | Поступили от ООО "Конкурент" оконные блоки 133 шт. на основании счета, накладной и счет-фактуры. | 
4 | 04.04.2026 | На основании исполнительного листа по договору 177 начислены неустойка = 3000 (Д 91.02) и штраф = 5000 (Д 99.02.3). Списаны с р/сч средства в пользу ООО "Сбыт" в размере задолженности по дог.177. | 
5 | 05.04.2026 | Принят на работу главный бухгалтер (ФИО студента) с окладом | 72 200
6 | 15.04.2026 | Выплачена заработная плата сотрудникам за предыдущий месяц через кассу. | 
7 | 22.04.2026 | Реализованы оконные блоки 133 шт по 10300 за шт в ООО "СП-171". | 1 369 900
8 | 24.04.2026 | Получена оплата за оконные блоки от ООО "СП-171" (ИНН 7810192328, КПП 781401001). | 1 369 900
9 | 25.04.2026 | ООО "Управление" выполнило субподрядные строительно-монтажные работы по ремонту кровли на объекте "Ремонт кровли с установкой кирпичной трубы". На основании счета, акта и счет-фактуры произведена оплата. | 2 352 000`;

function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ₽'
  );
}

export function ImportTaskModal({
  isOpen,
  onClose,
  onOpenAiSettings,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenAiSettings: () => void;
}) {
  const {
    organization,
    openingBalances,
    aiConfig,
    demoScenarios,
    loadDemoScenario,
    importParsedTask,
    synced1C,
    isSyncing1C,
    refreshFrom1CSync,
  } = useAccountant();

  const [tab, setTab] = useState<ImportTab>('import1c');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string>('');
  const [excelFileName, setExcelFileName] = useState<string>('');
  const [selectedSheetsInfo, setSelectedSheetsInfo] = useState<string>('');
  const [excelSheetRows, setExcelSheetRows] = useState<string[][]>([]);
  const [rawText, setRawText] = useState<string>('');

  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [requiresApiKeyError, setRequiresApiKeyError] = useState(false);

  const [parsedTitle, setParsedTitle] = useState<string>('');
  const [parsedOps, setParsedOps] = useState<BusinessOperation[] | null>(null);
  const [parsedDirs, setParsedDirs] = useState<Partial<ExtractedDirectories1C> | undefined>(
    undefined
  );
  const [parsedMode, setParsedMode] = useState<string>('');
  const [parsedWarnings, setParsedWarnings] = useState<string[]>([]);

  const readImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
        setImageFileName(file.name || 'Скриншот буфера обмена');
        setParseError(null);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            setTab('screenshot');
            readImageFile(file);
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, readImageFile]);

  if (!isOpen) return null;

  const handleExcelUpload = async (file: File) => {
    try {
      setParseError(null);
      setExcelFileName(file.name);
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });

      // Filter out ОСВ, Остатки, Справочники, 1 квартал sheets
      const candidateSheets = workbook.SheetNames.filter(
        (name) => !SKIP_SHEET_NAME_RE.test(name.trim())
      );
      const skippedSheets = workbook.SheetNames.filter((name) =>
        SKIP_SHEET_NAME_RE.test(name.trim())
      );

      // Prefer explicit Q2 / April / Task sheets if present, otherwise use candidateSheets
      const preferredSheets = candidateSheets.filter((name) =>
        PREFER_Q2_SHEET_NAME_RE.test(name.trim())
      );
      const sheetsToRead =
        preferredSheets.length > 0
          ? preferredSheets
          : candidateSheets.length > 0
            ? candidateSheets
            : [workbook.SheetNames[0]];

      const allCleanRows: string[][] = [];
      const tsvBlocks: string[] = [];

      for (const sheetName of sheetsToRead) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(worksheet, {
          header: 1,
          defval: '',
          raw: false,
        });

        // Keep column positions intact (including empty cells) so column headers
        // (№ п/п, Номер документа, Дата, Содержание, Сумма) align strictly!
        const nonEmptyRows = rows
          .map((r) =>
            r.map((cell) =>
              String(cell ?? '')
                .replace(/[\r\n\t]+/g, ' ')
                .trim()
            )
          )
          .filter((r) => r.some((cell) => cell.length > 0));

        if (nonEmptyRows.length > 0) {
          allCleanRows.push(...nonEmptyRows);
          tsvBlocks.push(nonEmptyRows.map((r) => r.join('\t')).join('\n'));
        }
      }

      const infoParts = [`Листы задания: ${sheetsToRead.join(', ')}`];
      if (skippedSheets.length > 0) {
        infoParts.push(`пропущены вспомогательные листы: ${skippedSheets.join(', ')}`);
      }
      setSelectedSheetsInfo(infoParts.join(' • '));
      setExcelSheetRows(allCleanRows.slice(0, 30));
      setRawText(tsvBlocks.join('\n'));
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Ошибка чтения файла Excel/CSV: ${err.message}`
          : 'Не удалось прочитать файл таблицы.'
      );
    }
  };

  const handleLoadBuiltInScreenshot = async () => {
    try {
      setParseError(null);
      const resp = await fetch('/demo-task-screenshot.jpg');
      if (!resp.ok) {
        setImageDataUrl('/demo-task-screenshot.jpg');
        setImageFileName('demo-task-screenshot.jpg');
        return;
      }
      const blob = await resp.blob();
      const file = new File([blob], 'demo-task-screenshot.jpg', {
        type: blob.type || 'image/jpeg',
      });
      readImageFile(file);
    } catch {
      setImageDataUrl('/demo-task-screenshot.jpg');
      setImageFileName('demo-task-screenshot.jpg');
    }
  };

  const handleRunParse = async () => {
    setIsParsing(true);
    setParseError(null);
    setRequiresApiKeyError(false);

    try {
      const payload: Record<string, unknown> = {
        organization,
        openingBalances,
        aiConfig,
      };

      if (tab === 'screenshot') {
        if (!imageDataUrl) {
          setParseError('Прикрепите скриншот таблицы или нажмите Ctrl+V.');
          setIsParsing(false);
          return;
        }
        payload.imageBase64 = imageDataUrl;
        if (rawText.trim()) payload.rawText = rawText.trim();
      } else {
        if (!rawText.trim()) {
          setParseError('Введите текст операций или загрузите таблицу Excel/CSV.');
          setIsParsing(false);
          return;
        }
        payload.rawText = rawText.trim();
      }

      const res = await fetch('/api/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setRequiresApiKeyError(Boolean(data.requiresApiKey));
        setParseError(data.error || data.message || 'Ошибка при разборе задачи.');
        setIsParsing(false);
        return;
      }

      setParsedTitle(data.title || 'Задание на 2 квартал');
      setParsedOps(data.operations || []);
      setParsedDirs(data.directories);
      setParsedMode(data.usedMode || 'local-smart-parser');
      setParsedWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Сетевая ошибка при обращении к /api/parse-task'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleUpdatePreviewOp = (
    idx: number,
    patch: Partial<BusinessOperation>
  ) => {
    setParsedOps((prev) =>
      prev ? prev.map((op, i) => (i === idx ? { ...op, ...patch } : op)) : prev
    );
  };

  const handleConfirmImport = () => {
    if (!parsedOps || parsedOps.length === 0) return;
    importParsedTask({
      title: parsedTitle.trim() || 'Задание на 2 квартал',
      operations: parsedOps,
      directories: parsedDirs,
      uploadedImageDataUrl: tab === 'screenshot' ? imageDataUrl : null,
    });
    setParsedOps(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-[#FAFAFA] dark:bg-[#09090B] shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Загрузить задание или подключить файл базы 1С
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Выгрузка из 1С (JSON / Excel ОСВ / XML) или условие операций 2 квартала
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-2 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-1 bg-white dark:bg-[#111113] shrink-0">
          {(
            [
              { id: 'import1c', label: 'База / файл из 1С', icon: Database },
              { id: 'excel', label: 'Excel / CSV задания', icon: FileSpreadsheet },
              { id: 'screenshot', label: 'Скриншот задания', icon: ImageIcon },
              { id: 'text', label: 'Текст / Таблица', icon: FileText },
              { id: 'presets', label: 'Демо-задание (9 оп.)', icon: Layers },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setParseError(null);
                  setParsedOps(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          {/* TAB 1: LIVE SYNC URL + UPLOAD 1C EXPORT FILE */}
          {tab === 'import1c' && (
            <div className="space-y-4">
              <div className="rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Автоматическое подключение к 1С:Бухгалтерия 8.3
                  </div>
                  <button
                    type="button"
                    disabled={isSyncing1C}
                    onClick={async () => {
                      const ok = await refreshFrom1CSync();
                      if (ok) onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncing1C ? 'animate-spin' : ''}`}
                    />
                    <span>Проверить снимок 1С сейчас</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800">
                    <div className="text-[11px] text-zinc-500 mb-0.5">
                      Адрес для внешней обработки 1С (`HTTPСоединение`):
                    </div>
                    <div className="font-mono text-zinc-900 dark:text-zinc-100 select-all">
                      POST http://localhost:3000/api/1c-sync
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800">
                    <div className="text-[11px] text-zinc-500 mb-0.5">
                      Локальный файл выгрузки (авточтение каждые 3 сек.):
                    </div>
                    <div className="font-mono text-zinc-900 dark:text-zinc-100 select-all">
                      C:\Users\Ludwig\Downloads\1c_export.json
                    </div>
                  </div>
                </div>

                {synced1C && (
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    База 1С подключена: организация {organization.shortName || organization.name}, документов в снимке — {synced1C.allDocuments?.length ?? 0}.
                  </div>
                )}
              </div>

              <Import1CDataPanel compact onApplied={onClose} />
            </div>
          )}

          {/* TAB 2: EXCEL / CSV TASK READER (SKIPS ОСВ / 1 КВАРТАЛ / СПРАВОЧНИКИ) */}
          {tab === 'excel' && !parsedOps && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleExcelUpload(file);
                }}
                className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-md p-6 text-center bg-[#FAFAFA] dark:bg-[#09090B] space-y-3"
              >
                <FileSpreadsheet className="w-6 h-6 text-zinc-500 mx-auto" />
                <div>
                  <p className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Загрузите Excel / CSV файл с журналом операций задания (.xlsx, .xls, .csv)
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Листы «ОСВ», «Остатки», «Справочники» и операции за 1 квартал (до 1 апреля) автоматически пропускаются
                  </p>
                </div>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Выбрать Excel / CSV файл</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.tsv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleExcelUpload(f);
                    }}
                  />
                </label>
              </div>

              {excelSheetRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-zinc-700 dark:text-zinc-300">
                      {excelFileName}
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {selectedSheetsInfo}
                    </span>
                  </div>
                  <div className="max-h-48 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {excelSheetRows.slice(0, 12).map((row, rIdx) => (
                          <tr key={rIdx} className="bg-white dark:bg-[#111113]">
                            {row.slice(0, 6).map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className="py-1.5 px-2.5 border-r border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 truncate max-w-[240px]"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SCREENSHOT OCR */}
          {tab === 'screenshot' && !parsedOps && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file && file.type.startsWith('image/')) {
                    readImageFile(file);
                  }
                }}
                className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-md p-6 text-center bg-[#FAFAFA] dark:bg-[#09090B] space-y-3"
              >
                <Upload className="w-5 h-5 text-zinc-500 mx-auto" />
                <div>
                  <p className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Перетащите фото таблицы сюда или нажмите{' '}
                    <kbd className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 font-mono text-xs">
                      Ctrl+V
                    </kbd>
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Выбрать изображение</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) readImageFile(f);
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleLoadBuiltInScreenshot}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-zinc-100 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
                  >
                    <span>Показать фото исходного задания (9 операций)</span>
                  </button>
                </div>
              </div>

              {imageDataUrl && (
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 bg-[#FAFAFA] dark:bg-[#09090B] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-700 dark:text-zinc-300 font-mono">
                      {imageFileName}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setImageDataUrl(null);
                        setImageFileName('');
                      }}
                      className="text-rose-600 hover:underline"
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="max-h-60 overflow-auto rounded bg-white dark:bg-[#111113] p-2 flex justify-center border border-zinc-200 dark:border-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageDataUrl}
                      alt="Предпросмотр скриншота"
                      className="max-h-52 w-auto rounded object-contain"
                    />
                  </div>
                </div>
              )}

              {aiConfig.provider === 'demo-local' && !aiConfig.apiKey && (
                <div className="p-3 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">
                    Для распознавания новых изображений укажите API-ключ Gemini или OpenAI, либо загрузите Excel / текст задания.
                  </div>
                  <button
                    type="button"
                    onClick={onOpenAiSettings}
                    className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Настройки ИИ
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: TEXT / TABLE */}
          {tab === 'text' && !parsedOps && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Вставьте таблицу или список операций 2 квартала:
                </label>
                <button
                  type="button"
                  onClick={() => setRawText(SAMPLE_TEXT_TASK)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[#FAFAFA] hover:bg-zinc-100 dark:bg-[#09090B] dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Подставить 9 операций из задания</span>
                </button>
              </div>

              <textarea
                rows={10}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="1 | 02.04 | Перечислен 100% аванс ООО Конкурент... | 1 236 900"
                className="w-full p-3 rounded-md text-xs font-mono tabular-nums leading-relaxed bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-400"
              />
            </div>
          )}

          {/* TAB 5: PRESETS */}
          {tab === 'presets' && (
            <div className="space-y-4">
              {demoScenarios.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-[#FAFAFA] dark:bg-[#09090B] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {preset.operations.length} операций
                      </span>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {preset.title}
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {preset.subtitle}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      loadDemoScenario(preset.id);
                      onClose();
                    }}
                    className="shrink-0 px-3.5 py-2 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
                  >
                    Загрузить заново
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Error Banner */}
          {parseError && (
            <div className="p-3 rounded-md bg-rose-50/70 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2 text-xs text-rose-900 dark:text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
              {requiresApiKeyError && (
                <button
                  type="button"
                  onClick={onOpenAiSettings}
                  className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white"
                >
                  Настройки ИИ
                </button>
              )}
            </div>
          )}

          {/* Parsed Operations Preview */}
          {parsedOps && (
            <div className="space-y-3">
              <div className="p-3 rounded-md bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-300 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950 dark:text-emerald-200 font-mono tabular-nums">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    Распознано операций 2 квартала: {parsedOps.length} ({parsedMode})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setParsedOps(null)}
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
                >
                  ← Назад к исходным данным
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                  Название задания
                </label>
                <input
                  type="text"
                  value={parsedTitle}
                  onChange={(e) => setParsedTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-md text-xs font-medium bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                />
              </div>

              {parsedWarnings.length > 0 && (
                <div className="p-2.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 space-y-0.5">
                  {parsedWarnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="py-2 px-2.5 font-semibold w-14">№</th>
                      <th className="py-2 px-2.5 font-semibold w-28">Дата</th>
                      <th className="py-2 px-2.5 font-semibold">Содержание операции</th>
                      <th className="py-2 px-2.5 font-semibold w-44">Документ 1С</th>
                      <th className="py-2 px-2.5 font-semibold text-right w-36">Сумма, ₽</th>
                      <th className="py-2 px-2 font-semibold w-9" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {parsedOps.map((op, idx) => (
                      <tr key={op.id || idx} className="bg-white dark:bg-[#111113]">
                        <td className="py-2 px-2 align-top">
                          <input
                            type="text"
                            value={String(op.number)}
                            onChange={(e) =>
                              handleUpdatePreviewOp(idx, { number: e.target.value })
                            }
                            className="w-full px-1.5 py-1 rounded text-xs font-mono tabular-nums font-semibold text-center bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-2 px-2 align-top">
                          <input
                            type="text"
                            value={op.date}
                            onChange={(e) =>
                              handleUpdatePreviewOp(idx, { date: e.target.value })
                            }
                            className="w-full px-2 py-1 rounded text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-2 px-2 align-top">
                          <textarea
                            rows={2}
                            value={op.rawDescription}
                            onChange={(e) =>
                              handleUpdatePreviewOp(idx, {
                                rawDescription: e.target.value,
                              })
                            }
                            className="w-full px-2 py-1 rounded text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                          />
                        </td>
                        <td className="py-2 px-2 align-top">
                          <div className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                            {op.documentType1C}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-zinc-500 mt-0.5">
                            {op.postings.length > 0
                              ? op.postings
                                  .map((p) => `${p.debitAccount}/${p.creditAccount}`)
                                  .join(', ')
                              : 'Кадровый приказ'}
                          </div>
                        </td>
                        <td className="py-2 px-2 align-top text-right">
                          {op.explicitAmount === null ? (
                            <div className="space-y-1">
                              <span className="inline-block px-1.5 py-0.5 rounded bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 text-[10px]">
                                Из остатков 1С
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Авто"
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  handleUpdatePreviewOp(idx, {
                                    explicitAmount: v ? Number(v) : null,
                                    resolvedAmount: v ? Number(v) : 0,
                                  });
                                }}
                                className="w-full px-2 py-1 rounded text-xs font-mono tabular-nums text-right bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                              />
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <input
                                type="number"
                                step="0.01"
                                value={op.explicitAmount}
                                onChange={(e) => {
                                  const num = Number(e.target.value) || 0;
                                  handleUpdatePreviewOp(idx, {
                                    explicitAmount: num,
                                    resolvedAmount: num,
                                  });
                                }}
                                className="w-full px-2 py-1 rounded text-xs font-mono tabular-nums font-semibold text-right bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
                              />
                              <div className="text-[10px] font-mono tabular-nums text-zinc-400">
                                {formatRub(op.explicitAmount)}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 align-top text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setParsedOps((prev) =>
                                prev ? prev.filter((_, i) => i !== idx) : prev
                              )
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
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-[#FAFAFA] dark:bg-[#09090B] flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
          >
            Закрыть
          </button>

          {tab !== 'presets' && tab !== 'import1c' && !parsedOps && (
            <button
              type="button"
              disabled={isParsing}
              onClick={handleRunParse}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 disabled:opacity-50"
            >
              {isParsing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Распознаем операции...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Распознать операции 2 квартала</span>
                </>
              )}
            </button>
          )}

          {parsedOps && (
            <button
              type="button"
              disabled={parsedOps.length === 0}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Применить задание ({parsedOps.length} оп.)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
