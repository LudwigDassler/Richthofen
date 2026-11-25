'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  FileCode2,
  FileJson,
  FolderOpen,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import {
  build1CTransferPackage,
  buildExportBundle,
  generateBslLoader,
  summarize1CPackageSections,
} from '@/lib/export1c';
import { formatDateRu } from '@/lib/formatters';
import { summarizeConnectedBase0 } from '@/lib/import1c';

type PreviewTab = 'none' | 'package_json' | 'loader_bsl';

export function Tab4Export1C() {
  const {
    db1C,
    reportingYear,
    operations,
    osvReport,
    virtual1CState,
    exportMode,
    activeTab,
    balanceAnchorOverride,
    includeQueuedInOsv,
    periodFilter,
    calculationProfile,
    monthlyProfitTax,
    lastImportStats,
    autoFixChanges,
    load1CJsonFile,
    disconnect1CDb,
  } = useAccountant();

  const base0InputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingBase0, setIsDraggingBase0] = useState(false);
  const [showEpfGuide, setShowEpfGuide] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('none');
  const [showXmlBlock, setShowXmlBlock] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'json' | 'bsl' | null>(null);

  const transferPackage = useMemo(
    () =>
      build1CTransferPackage(operations, db1C, virtual1CState.finalState, {
        calculationProfile,
        monthlyProfitTax,
      }),
    [operations, db1C, virtual1CState.finalState, calculationProfile, monthlyProfitTax]
  );

  const packageJsonString = useMemo(
    () => JSON.stringify(transferPackage, null, 2),
    [transferPackage]
  );

  const sectionCounts = useMemo(
    () => summarize1CPackageSections(transferPackage),
    [transferPackage]
  );

  const bslLoaderCode = useMemo(
    () =>
      generateBslLoader({
        defaultReportingYear: reportingYear,
        defaultPackageFileName: 'Richthofen_1C_Package.json',
        defaultBase0FileName: 'base0_1c.json',
      }),
    [reportingYear]
  );

  const diagnosticBundle = useMemo(
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
          calculationProfile,
          monthlyProfitTax,
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
      calculationProfile,
      monthlyProfitTax,
      lastImportStats,
      autoFixChanges,
    ]
  );

  const connectedBase0 = useMemo(() => summarizeConnectedBase0(db1C), [db1C]);

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

  const handleCopyText = async (content: string, target: 'json' | 'bsl') => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget(null), 2000);
    } catch {
      // Ignore clipboard errors in restricted frames
    }
  };

  const handleBase0Drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingBase0(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.name.toLowerCase().endsWith('.json')
    );
    if (file) {
      await load1CJsonFile(file);
    }
  };

  const sectionItems = [
    { label: 'Покупки', count: sectionCounts.purchases },
    { label: 'Продажи', count: sectionCounts.sales },
    { label: 'Банк и касса', count: sectionCounts.bankCash },
    { label: 'Склад и производство', count: sectionCounts.warehouse },
    { label: 'ОС и НМА', count: sectionCounts.osNma },
    { label: 'Зарплата и кадры', count: sectionCounts.hrPayroll },
    { label: 'Операции (Дт/Кт)', count: sectionCounts.manualOps },
    { label: 'Регламент в 1С', count: sectionCounts.reglamentIn1C },
  ];

  return (
    <div className="space-y-6">
      {/* BLOCK 1: Основной экспорт в 1С:БП 3.0 (все разделы через .epf) */}
      <section
        aria-labelledby="export-block-1-heading"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h2
              id="export-block-1-heading"
              className="text-base font-semibold text-slate-900 dark:text-white tracking-tight"
            >
              01. Основной экспорт в 1С:Бухгалтерия 8.3 (ред. 3.0) — все разделы через .epf
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Канонический JSON-пакет <code className="font-mono">Richthofen_1C_Package.json</code> и
              самособираемая управляемая обработка <code className="font-mono">RichthofenLoader_1C83.bsl</code>{' '}
              переносят чистые справочники, нативные документы БП 3.0 со счетами-фактурами, а также
              точные бухгалтерские и налоговые движения (включая постоянные разницы ст. 270 НК РФ).
            </p>
            <div className="pt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              <span>Схема {transferPackage.meta.schemaVersion}</span>
              <span aria-hidden="true">·</span>
              <span>
                Организация: {transferPackage.organization.name} (ИНН{' '}
                {transferPackage.organization.inn || '—'})
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Период: {formatDateRu(transferPackage.meta.periodFrom)} —{' '}
                {formatDateRu(transferPackage.meta.periodTo)}
              </span>
              <span aria-hidden="true">·</span>
              <span>Документов в пакете: {transferPackage.meta.totalDocuments}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  packageJsonString,
                  'Richthofen_1C_Package.json',
                  'application/json'
                )
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold whitespace-nowrap transition-colors"
            >
              <Download className="w-4 h-4 shrink-0" strokeWidth={1.7} />
              Скачать пакет для 1С (.json)
            </button>

            <button
              type="button"
              onClick={() =>
                triggerDownload(bslLoaderCode, 'RichthofenLoader_1C83.bsl', 'text/plain')
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold whitespace-nowrap transition-colors"
            >
              <Code2 className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.7} />
              Скачать код обработки 1С (.bsl)
            </button>
          </div>
        </div>

        {/* Compact 8-section summary */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Сводка документов пакета по разделам 1С:БП 3.0
            </span>
            <div className="flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400 tabular-nums">
              <span>Контрагенты: {transferPackage.catalogs.counterparties.length}</span>
              <span aria-hidden="true">·</span>
              <span>Договоры: {transferPackage.catalogs.contracts.length}</span>
              <span aria-hidden="true">·</span>
              <span>Номенклатура: {transferPackage.catalogs.nomenclature.length}</span>
              <span aria-hidden="true">·</span>
              <span>Сотрудники: {transferPackage.catalogs.employees.length}</span>
              <span aria-hidden="true">·</span>
              <span>ОС: {transferPackage.catalogs.fixedAssets.length}</span>
              <span aria-hidden="true">·</span>
              <span>РБП: {transferPackage.catalogs.deferredExpenses.length}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/70 dark:divide-slate-800 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
            {sectionItems.map((sec) => (
              <div key={sec.label} className="px-3.5 py-3 flex flex-col justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  {sec.label}
                </span>
                <span className="mt-1.5 text-base font-semibold tabular-nums text-slate-900 dark:text-white">
                  {sec.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Collapsible 4-step .epf instruction + Optional Code Preview */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <button
              type="button"
              aria-expanded={showEpfGuide}
              onClick={() => setShowEpfGuide((prev) => !prev)}
              className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
            >
              {showEpfGuide ? (
                <ChevronDown className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.7} />
              ) : (
                <ChevronRight className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.7} />
              )}
              <span>
                Как за 1 минуту собрать обработку .epf в Конфигураторе и запустить на копии базы (4 шага)
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setPreviewTab((prev) => (prev === 'package_json' ? 'none' : 'package_json'))
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                  previewTab === 'package_json'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <FileJson className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
                Предпросмотр .json
              </button>

              <button
                type="button"
                onClick={() =>
                  setPreviewTab((prev) => (prev === 'loader_bsl' ? 'none' : 'loader_bsl'))
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                  previewTab === 'loader_bsl'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Code2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} />
                Предпросмотр .bsl
              </button>
            </div>
          </div>

          {showEpfGuide && (
            <ol className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs text-slate-700 dark:text-slate-300">
              <li className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200/70 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Шаг 1. Сделайте резервную копию информационной базы
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  В 1С:БП 3.0 откройте «Администрирование → Обслуживание → Резервное копирование»
                  или выгрузите архив <code className="font-mono">.dt</code> через Конфигуратор.
                </p>
              </li>

              <li className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200/70 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Шаг 2. Вставьте код модуля и сохраните .epf
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  В Конфигураторе выберите «Файл → Новый → Внешняя обработка», задайте имя{' '}
                  <code className="font-mono">RichthofenLoader</code>, добавьте управляемую форму,
                  откройте вкладку «Модуль», вставьте код из{' '}
                  <code className="font-mono">RichthofenLoader_1C83.bsl</code> и сохраните{' '}
                  <code className="font-mono">RichthofenLoader.epf</code> (реквизиты и кнопки не
                  рисуем вручную — они создаются сами).
                </p>
              </li>

              <li className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200/70 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Шаг 3. Откройте обработку в режиме 1С:Предприятие («Такси»)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  В пользовательском режиме нажмите «Файл → Открыть» (или «Главное меню → Файл →
                  Открыть») и выберите <code className="font-mono">RichthofenLoader.epf</code>.
                </p>
              </li>

              <li className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200/70 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Шаг 4. Загрузите пакет (целиком или помесячно) и закройте месяц
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Укажите <code className="font-mono">Richthofen_1C_Package.json</code>, при
                  необходимости задайте «Период загрузки с / по» для помесячного шага, нажмите «2.
                  Загрузить пакет Richthofen в 1С», штатно начислите зарплату и закройте месяц в 1С —
                  уплата налогов и выплата ЗП подхватят живые остатки базы (включая релизы до ЕНС с
                  69.01 / 69.02.7 / 69.03.1).
                </p>
              </li>
            </ol>
          )}

          {previewTab !== 'none' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                  {previewTab === 'package_json'
                    ? 'Richthofen_1C_Package.json'
                    : 'RichthofenLoader_1C83.bsl'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        previewTab === 'package_json' ? packageJsonString : bslLoaderCode,
                        previewTab === 'package_json' ? 'json' : 'bsl'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    {copiedTarget === (previewTab === 'package_json' ? 'json' : 'bsl') ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={1.7} />
                        Скопировано
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" strokeWidth={1.6} />
                        Копировать
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Закрыть предпросмотр"
                    onClick={() => setPreviewTab('none')}
                    className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <X className="w-4 h-4" strokeWidth={1.6} />
                  </button>
                </div>
              </div>
              <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed overflow-auto max-h-[420px]">
                {previewTab === 'package_json' ? packageJsonString : bslLoaderCode}
              </pre>
            </div>
          )}
        </div>
      </section>

      {/* BLOCK 2: Подключение «Базы 0» из 1С (base0_1c.json) */}
      <section
        aria-labelledby="export-block-2-heading"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingBase0(true);
        }}
        onDragLeave={() => setIsDraggingBase0(false)}
        onDrop={handleBase0Drop}
        className={`rounded-2xl border p-6 space-y-4 transition-colors ${
          isDraggingBase0
            ? 'border-amber-500 bg-amber-50/30 dark:bg-amber-950/20'
            : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900'
        }`}
      >
        <input
          ref={base0InputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Загрузить файл Базы 0 (base0_1c.json)"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await load1CJsonFile(f);
            e.target.value = '';
          }}
          className="hidden"
        />

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h2
              id="export-block-2-heading"
              className="text-base font-semibold text-slate-900 dark:text-white tracking-tight"
            >
              02. Подключение «Базы 0» из 1С (base0_1c.json)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Нажмите в внешней обработке 1С кнопку{' '}
              <strong className="font-medium text-slate-800 dark:text-slate-200">
                «1. Выгрузить Базу 0 в JSON»
              </strong>{' '}
              и загрузите полученный <code className="font-mono">base0_1c.json</code> сюда.
              Richthofen автоматически свяжет существующих контрагентов, номенклатуру, ОС и
              сотрудников и учтёт входящие остатки на начало {reportingYear} года в ОСВ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => base0InputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold whitespace-nowrap transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.7} />
              {connectedBase0 ? 'Заменить base0_1c.json' : 'Подключить base0_1c.json'}
            </button>

            {connectedBase0 && (
              <button
                type="button"
                onClick={() => void disconnect1CDb()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium whitespace-nowrap transition-colors"
              >
                Отключить Базу 0
              </button>
            )}
          </div>
        </div>

        {connectedBase0 ? (
          <div
            data-testid="tab4-connected-base0-card"
            className="rounded-xl border border-emerald-200/90 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2 text-slate-800 dark:text-slate-200">
              <CheckCircle2
                className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                strokeWidth={1.7}
              />
              <span className="font-semibold text-emerald-900 dark:text-emerald-300">
                Подключена организация: {connectedBase0.organizationName}
              </span>
              <span aria-hidden="true" className="text-emerald-600/60">
                ·
              </span>
              <span className="tabular-nums">ИНН {connectedBase0.inn}</span>
              {connectedBase0.kpp && (
                <>
                  <span aria-hidden="true" className="text-emerald-600/60">
                    ·
                  </span>
                  <span className="tabular-nums">КПП {connectedBase0.kpp}</span>
                </>
              )}
              {connectedBase0.bik && (
                <>
                  <span aria-hidden="true" className="text-emerald-600/60">
                    ·
                  </span>
                  <span className="tabular-nums">БИК {connectedBase0.bik}</span>
                </>
              )}
              {connectedBase0.accountNumber && (
                <>
                  <span aria-hidden="true" className="text-emerald-600/60">
                    ·
                  </span>
                  <span className="tabular-nums font-mono">р/с {connectedBase0.accountNumber}</span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300 tabular-nums">
              {connectedBase0.usesLegacyPayrollAccounts && (
                <>
                  <span>Счета взносов: до ЕНС (69.01 / 69.02.7 / 69.03.1)</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>Элементов справочников: {connectedBase0.totalCatalogItems}</span>
              <span aria-hidden="true">·</span>
              <span>Строк начального сальдо: {connectedBase0.openingBalanceLinesCount}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 px-4 py-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.6} />
              База 0 сейчас не подключена — расчёт ОСВ и формирование пакета выполняются с нулевыми входящими остатками на 01.01.{reportingYear}.
            </span>
            <span>Можно перетащить файл .json прямо в этот блок</span>
          </div>
        )}
      </section>

      {/* BLOCK 3: Диагностический XML (EnterpriseData 1.8) */}
      <section
        aria-labelledby="export-block-3-heading"
        className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
      >
        <button
          type="button"
          aria-expanded={showXmlBlock}
          onClick={() => setShowXmlBlock((prev) => !prev)}
          className="w-full px-6 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {showXmlBlock ? (
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.7} />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.7} />
            )}
            <h2
              id="export-block-3-heading"
              className="text-sm font-semibold text-slate-800 dark:text-slate-200"
            >
              03. Диагностический XML (EnterpriseData 1.8)
            </h2>
            <span aria-hidden="true" className="text-slate-400 text-xs">
              ·
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Вспомогательный формат для внешнего аудита и типовой синхронизации торговли/банка
            </span>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            {showXmlBlock ? 'Свернуть' : 'Развернуть'}
          </span>
        </button>

        {showXmlBlock && (
          <div className="px-6 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
              Типовой формат <code className="font-mono">EnterpriseData 1.8</code> не передаёт
              бухгалтерские операции <code className="font-mono">ОперацияБух</code>, начисление
              зарплаты, принятие к учёту ОС и закрытие месяца. Для полной сквозной загрузки всех
              разделов в 1С:БП 3.0 используйте основной экспорт выше (пакет{' '}
              <code className="font-mono">.json</code> + обработка{' '}
              <code className="font-mono">.epf</code>).
            </p>

            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  diagnosticBundle.enterpriseDataXml,
                  'EnterpriseData_1C_Export.xml',
                  'application/xml'
                )
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" strokeWidth={1.6} />
              Скачать EnterpriseData_1C_Export.xml
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
