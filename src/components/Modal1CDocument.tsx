'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileCheck2,
  FileText,
  HelpCircle,
  Play,
  Printer,
  RefreshCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { Modal1CFormSavePatch, useAccountant } from '@/context/AccountantContext';
import {
  build1CNavigationBreadcrumbs,
  build1CWindowTitle,
  buildCreateBasedOnLinks1C,
  buildFieldHints1C,
  buildWalkthroughSteps1C,
  ReferenceEntityKind1C,
  resolveTaxi1CLayoutKind,
} from '@/lib/engine';
import { formatDateRu, formatMoney } from '@/lib/formatters';
import { Modal1CReferenceCard } from '@/components/Modal1CReferenceCard';
import { Taxi1CDtKtView } from '@/components/taxi1c/Taxi1CDtKtView';
import { Taxi1CLayouts } from '@/components/taxi1c/Taxi1CLayouts';

export function Modal1CDocument() {
  const {
    active1CModalOpId,
    initial1CModalMode,
    operations,
    db1C,
    virtual1CState,
    close1CModal,
    save1CModalFormChanges,
    create1CDocumentBasedOn,
    runSingleOperationAutoFix,
    rebuildSingleOperationPostings,
    jumpToOperation,
  } = useAccountant();

  const op = useMemo(
    () =>
      active1CModalOpId
        ? operations.find((item) => item.id === active1CModalOpId) || null
        : null,
    [active1CModalOpId, operations]
  );

  const [mode, setMode] = useState<'sample' | 'trainer'>(initial1CModalMode);
  const [hintsEnabled, setHintsEnabled] = useState<boolean>(true);
  const [showDtKt, setShowDtKt] = useState<boolean>(false);
  const [draft, setDraft] = useState<Modal1CFormSavePatch>({});
  const [openReferenceKind, setOpenReferenceKind] =
    useState<ReferenceEntityKind1C | null>(null);
  const [walkthroughStep, setWalkthroughStep] = useState<number | null>(null);
  const [activeAutoHintKey, setActiveAutoHintKey] = useState<string | null>(null);
  const [copiedBanner, setCopiedBanner] = useState<string | null>(null);
  const [showPrintMemo, setShowPrintMemo] = useState<boolean>(false);

  const [openMenu, setOpenMenu] = useState<'based_on' | 'print' | 'more' | null>(null);
  const toolbarMenuRef = useRef<HTMLDivElement | null>(null);

  // Reset modal internal state whenever active operation changes
  useEffect(() => {
    if (!active1CModalOpId) return;
    setMode(initial1CModalMode);
    setShowDtKt(false);
    setDraft({});
    setOpenReferenceKind(null);
    setWalkthroughStep(null);
    setActiveAutoHintKey(null);
    setShowPrintMemo(false);
    setOpenMenu(null);
  }, [active1CModalOpId, initial1CModalMode]);

  // Close toolbar dropdowns on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (!toolbarMenuRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openMenu]);

  // Escape closes nested reference card first (handled in capture phase inside Modal1CReferenceCard),
  // then closes open dropdowns/walkthrough, then closes Modal1CDocument.
  useEffect(() => {
    if (!op) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openReferenceKind) return;
      if (openMenu) {
        e.stopPropagation();
        setOpenMenu(null);
        return;
      }
      close1CModal();
    };
    window.addEventListener('keydown', onKeyDown, false);
    return () => window.removeEventListener('keydown', onKeyDown, false);
  }, [op, openReferenceKind, openMenu, close1CModal]);

  if (!op) return null;

  const layoutKind = resolveTaxi1CLayoutKind(op);
  const titleInfo = build1CWindowTitle({
    ...op,
    date: draft.date ?? op.date,
    docNumber: draft.docNumber ?? op.docNumber,
    includeInProcessing:
      draft.bankConfirmed !== undefined ? draft.bankConfirmed : op.includeInProcessing,
  });
  const breadcrumbs = build1CNavigationBreadcrumbs(op);
  const basedOnOptions = buildCreateBasedOnLinks1C(op, operations);
  const hints = buildFieldHints1C(op);
  const steps = buildWalkthroughSteps1C(op);

  const isEditable = mode === 'trainer';
  const currentStepObj =
    walkthroughStep !== null
      ? steps.find((s) => s.stepNumber === walkthroughStep) || null
      : null;

  const triggerCopiedToast = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    setCopiedBanner(trimmed.length > 52 ? `${trimmed.slice(0, 52)}…` : trimmed);
    setTimeout(() => {
      setCopiedBanner((curr) =>
        curr && curr.startsWith(trimmed.slice(0, 16)) ? null : curr
      );
    }, 1800);
  };

  const applyWalkthroughStep = (nextStep: number | null) => {
    if (nextStep === null) {
      setWalkthroughStep(null);
      setActiveAutoHintKey(null);
      return;
    }
    const clamped = Math.max(1, Math.min(steps.length, nextStep));
    const found = steps.find((s) => s.stepNumber === clamped);
    setWalkthroughStep(clamped);
    setHintsEnabled(true);
    if (found) {
      if (found.targetSection === 'dt_kt') {
        setShowDtKt(true);
      } else {
        setShowDtKt(false);
      }
      setActiveAutoHintKey(found.autoHintKey);
    }
  };

  const buildPrintableCheatSheetText = (): string => {
    const lines: string[] = [
      `ПАМЯТКА ПО ВВОДУ В 1С:БУХГАЛТЕРИЯ 8.3 (РЕД. 3.0, ИНТЕРФЕЙС «ТАКСИ»)`,
      `Документ: ${titleInfo.fullTitle}`,
      `Путь в меню 1С: ${breadcrumbs.section} -> ${breadcrumbs.journal} -> ${breadcrumbs.operationKind}`,
      `Исходная операция задания: ${op.description}`,
      `Сумма документа: ${formatMoney(op.amount, true)} ₽${
        op.vatRate > 0 ? ` (НДС ${op.vatRate}%: ${formatMoney(op.vatAmount || 0, true)} ₽)` : ' (Без НДС)'
      }`,
      ``,
      `ПОШАГОВЫЙ ПЛАН ЗАПОЛНЕНИЯ:`,
      ...steps.map((s) => `${s.shortTitle}: ${s.instructionSummary}`),
      ``,
      `ОЖИДАЕМЫЕ ПРОВОДКИ (Дт / Кт):`,
      ...(op.entries.length > 0
        ? op.entries.map(
            (e, idx) =>
              `${idx + 1}. Дт ${e.debit || '—'} (${e.debitSubconto || '—'})  Кт ${e.credit || '—'} (${
                e.creditSubconto || '—'
              }) — ${formatMoney(e.amount, true)} ₽`
          )
        : ['Документ не формирует бухгалтерских проводок в момент записи (движения в регистрах сведений).']),
    ];
    return lines.join('\n');
  };

  const handleCopyCheatSheet = async () => {
    try {
      await navigator.clipboard.writeText(buildPrintableCheatSheetText());
      triggerCopiedToast('Памятка по заполнению 1С');
      setOpenMenu(null);
    } catch {
      // Ignore clipboard error
    }
  };

  const handlePostAndClose = () => {
    save1CModalFormChanges(op.id, draft, 'post_and_close');
  };

  const handleSaveOnly = () => {
    save1CModalFormChanges(op.id, draft, 'save_only');
    setDraft({});
  };

  const handlePostKeepOpen = () => {
    save1CModalFormChanges(op.id, draft, 'post');
    setDraft({});
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titleInfo.fullTitle}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-2 sm:p-4 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !openReferenceKind) {
          close1CModal();
        }
      }}
    >
      <div className="w-full max-w-[1120px] max-h-[93vh] flex flex-col rounded-[4px] border border-[#9E9B91] bg-[#F6F5F0] text-[#1F1F1F] shadow-[0_22px_56px_rgba(15,23,42,0.38)] overflow-hidden">
        {/* 1. Authentic 1C:Enterprise 8.3 Window Title Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#EAE7DE] border-b border-[#CFCBC0] select-none">
          <div className="flex items-center gap-2 min-w-0">
            {/* 1C Document Posted Icon (sheet + green check) */}
            <span
              title={op.includeInProcessing ? 'Документ проведён' : 'Документ записан (не проведён)'}
              className="relative inline-flex items-center justify-center w-5 h-5 rounded-[2px] bg-white border border-[#B8B4A8] shrink-0"
            >
              {op.includeInProcessing ? (
                <FileCheck2 className="w-3.5 h-3.5 text-[#207828]" strokeWidth={2} />
              ) : (
                <FileText className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.8} />
              )}
            </span>

            <h2 className="text-[13px] font-semibold text-[#1F1F1F] truncate">
              {titleInfo.fullTitle}
            </h2>
          </div>

          {/* Right Controls: Hints On/Off + Mode Sample/Trainer + Close */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setHintsEnabled((v) => !v)}
              className={`inline-flex items-center gap-1 h-[24px] px-2 rounded-[3px] border text-[11px] font-medium whitespace-nowrap transition-colors ${
                hintsEnabled
                  ? 'border-[#C9A82C] bg-[#FFF4C2] text-[#523E00]'
                  : 'border-[#C4C4C4] bg-white text-[#555] hover:bg-[#F3F3F3]'
              }`}
            >
              <HelpCircle className="w-3 h-3" strokeWidth={1.9} />
              Подсказки 1С: {hintsEnabled ? 'Вкл' : 'Выкл'}
            </button>

            <div
              role="group"
              aria-label="Режим работы формы 1С"
              className="inline-flex items-center rounded-[3px] border border-[#BDB9AE] bg-[#DFDDD4] p-0.5 text-[11px]"
            >
              <button
                type="button"
                onClick={() => setMode('sample')}
                className={`h-[21px] px-2 rounded-[2px] font-medium whitespace-nowrap transition-colors ${
                  mode === 'sample'
                    ? 'bg-white text-[#1F1F1F] shadow-2xs font-semibold'
                    : 'text-[#555] hover:text-[#1F1F1F]'
                }`}
              >
                Образец
              </button>
              <button
                type="button"
                onClick={() => setMode('trainer')}
                className={`h-[21px] px-2 rounded-[2px] font-medium whitespace-nowrap transition-colors ${
                  mode === 'trainer'
                    ? 'bg-[#FFDC33] text-[#1F1F1F] font-semibold'
                    : 'text-[#555] hover:text-[#1F1F1F]'
                }`}
              >
                Тренажёр (правка)
              </button>
            </div>

            <button
              type="button"
              onClick={close1CModal}
              aria-label="Закрыть окно документа 1С"
              className="w-[25px] h-[24px] inline-flex items-center justify-center rounded-[2px] hover:bg-[#D9534F] hover:text-white text-[#444] transition-colors"
            >
              <X className="w-4 h-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>

        {/* 2. 1C Navigation Breadcrumb Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 bg-[#FBF7E8] border-b border-[#E4DEC9] text-[11.5px]">
          <div className="flex flex-wrap items-center gap-1.5 text-[#5C5338] min-w-0">
            <span className="font-semibold text-[#3F3822]">{breadcrumbs.section}</span>
            <span aria-hidden="true">▸</span>
            <span>{breadcrumbs.journal}</span>
            <span aria-hidden="true">▸</span>
            <span className="font-medium text-[#0055A6] truncate">
              {breadcrumbs.operationKind}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#6A624B] shrink-0">
            {mode === 'sample' ? (
              <span>Режим «Образец»: клик по любому полю копирует значение для 1С</span>
            ) : (
              <span className="font-medium text-[#7A5900]">
                Режим «Тренажёр»: изменения пересчитывают проводки и ОСВ
              </span>
            )}
          </div>
        </div>

        {/* 3. Authentic 1C «Такси» Command Toolbar */}
        <div
          ref={toolbarMenuRef}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#F2F0E8] border-b border-[#D8D5CA]"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Primary Yellow 1C Button: Провести и закрыть */}
            <button
              type="button"
              onClick={handlePostAndClose}
              className="h-[28px] px-3 rounded-[3px] border border-[#D6B018] bg-[#FFDC33] hover:bg-[#F2C924] active:bg-[#E8BE18] text-[12px] font-semibold text-[#1F1F1F] whitespace-nowrap transition-colors"
            >
              Провести и закрыть
            </button>

            {/* Записать */}
            <button
              type="button"
              onClick={handleSaveOnly}
              className="h-[28px] px-2.5 rounded-[3px] border border-[#C8C8C8] bg-white hover:bg-[#F7F7F7] text-[12px] text-[#1F1F1F] whitespace-nowrap transition-colors"
            >
              Записать
            </button>

            {/* Провести */}
            <button
              type="button"
              onClick={handlePostKeepOpen}
              className="h-[28px] px-2.5 rounded-[3px] border border-[#C8C8C8] bg-white hover:bg-[#F7F7F7] text-[12px] text-[#1F1F1F] whitespace-nowrap transition-colors"
            >
              Провести
            </button>

            {/* Дт/Кт Toggle Button */}
            <button
              type="button"
              onClick={() => setShowDtKt((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[3px] border text-[12px] font-medium whitespace-nowrap transition-colors ${
                showDtKt
                  ? 'border-[#0055A6] bg-[#EBF4FF] text-[#004488] font-semibold'
                  : 'border-[#C8C8C8] bg-white hover:bg-[#F7F7F7] text-[#1F1F1F]'
              }`}
            >
              <span className="font-mono font-bold text-[#1E7828]">Дт</span>
              <span className="text-[#888]">/</span>
              <span className="font-mono font-bold text-[#0055A6]">Кт</span>
              <span className="text-[11px] tabular-nums text-[#555]">
                ({op.entries.length})
              </span>
            </button>

            {/* Создать на основании ▾ */}
            {basedOnOptions.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenu((m) => (m === 'based_on' ? null : 'based_on'))
                  }
                  className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-[3px] border border-[#C8C8C8] bg-white hover:bg-[#F7F7F7] text-[12px] text-[#1F1F1F] whitespace-nowrap"
                >
                  Создать на основании
                  <ChevronDown className="w-3.5 h-3.5 text-[#555]" strokeWidth={1.8} />
                </button>

                {openMenu === 'based_on' && (
                  <div className="absolute left-0 top-[31px] z-[75] w-[350px] rounded-[3px] border border-[#B5B5B5] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] py-1 text-[12px]">
                    {basedOnOptions.map((opt) => (
                      <div
                        key={opt.id}
                        className="border-b border-[#F1F1F1] last:border-b-0 px-3 py-2 hover:bg-[#FFF8DB]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            create1CDocumentBasedOn(op.id, opt);
                          }}
                          className="w-full text-left"
                        >
                          <div className="font-semibold text-[#1F1F1F] flex items-center justify-between gap-2">
                            <span>{opt.label}</span>
                            {opt.existingLinkedLabel && (
                              <span className="text-[10.5px] font-medium text-[#1E7828] shrink-0">
                                Открыть {opt.existingLinkedLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#666] mt-0.5">
                            {opt.subLabel}
                          </div>
                        </button>
                        {opt.existingLinkedOpId && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenu(null);
                              create1CDocumentBasedOn(op.id, {
                                ...opt,
                                existingLinkedOpId: undefined,
                              });
                            }}
                            className="mt-1 text-[11px] text-[#0055A6] hover:underline"
                          >
                            + Создать ещё один документ на основании
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Печать ▾ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((m) => (m === 'print' ? null : 'print'))}
                className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-[3px] border border-[#C8C8C8] bg-white hover:bg-[#F7F7F7] text-[12px] text-[#1F1F1F] whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5 text-[#555]" strokeWidth={1.7} />
                Печать
                <ChevronDown className="w-3.5 h-3.5 text-[#555]" strokeWidth={1.8} />
              </button>

              {openMenu === 'print' && (
                <div className="absolute left-0 top-[31px] z-[75] w-[285px] rounded-[3px] border border-[#B5B5B5] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] py-1 text-[12px]">
                  <button
                    type="button"
                    onClick={() => void handleCopyCheatSheet()}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#FFF8DB] flex items-center gap-2"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.7} />
                    <span>Скопировать памятку по вводу в 1С</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPrintMemo((v) => !v);
                      setOpenMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#FFF8DB] flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.7} />
                    <span>
                      {showPrintMemo
                        ? 'Скрыть печатную карточку-шпаргалку'
                        : 'Показать карточку-шпаргалку на экране'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Toolbar Group: Еще ▾ */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === 'more' ? null : 'more'))}
              className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-[3px] border border-[#C8C8C8] bg-white hover:bg-[#F7F7F7] text-[12px] text-[#1F1F1F] whitespace-nowrap"
            >
              Еще
              <ChevronDown className="w-3.5 h-3.5 text-[#555]" strokeWidth={1.8} />
            </button>

            {openMenu === 'more' && (
              <div className="absolute right-0 top-[31px] z-[75] w-[270px] rounded-[3px] border border-[#B5B5B5] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] py-1 text-[12px]">
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    runSingleOperationAutoFix(op.id);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[#FFF8DB] flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#8A6800]" strokeWidth={1.7} />
                  <span>Автоподбор реквизитов из БД 1С</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    rebuildSingleOperationPostings(op.id);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[#FFF8DB] flex items-center gap-2"
                >
                  <RefreshCcw className="w-3.5 h-3.5 text-[#555]" strokeWidth={1.7} />
                  <span>Перепровести в хронологии</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetId = op.id;
                    setOpenMenu(null);
                    close1CModal();
                    jumpToOperation(targetId);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[#FFF8DB] flex items-center gap-2 border-t border-[#EFEFEF]"
                >
                  <FileText className="w-3.5 h-3.5 text-[#0055A6]" strokeWidth={1.7} />
                  <span>Показать строку в журнале операций</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Optional Copy Toast & Printable Memo */}
        {copiedBanner && (
          <div className="px-3 py-1 bg-[#E9F7EC] border-b border-[#BDE3C6] text-[11.5px] text-[#1B6628] flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            <span>
              Скопировано в буфер обмена: <strong>{copiedBanner}</strong>
            </span>
          </div>
        )}

        {showPrintMemo && (
          <div className="px-4 py-2.5 bg-[#FFFDF5] border-b border-[#E2D6A7] text-[11.5px] space-y-1.5">
            <div className="flex items-center justify-between">
              <strong className="text-[#4A3B00]">
                Шпаргалка студента для ввода в 1С:Бухгалтерия 8.3
              </strong>
              <button
                type="button"
                onClick={() => setShowPrintMemo(false)}
                className="text-[#666] hover:text-[#1F1F1F] text-[11px]"
              >
                Скрыть ×
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-[#222] bg-white p-2.5 rounded-[2px] border border-[#E6DFC5] max-h-40 overflow-y-auto">
              {buildPrintableCheatSheetText()}
            </pre>
          </div>
        )}

        {/* 4. Scrollable Form Body or Дт/Кт View */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-[#FAF9F5]">
          {showDtKt ? (
            <Taxi1CDtKtView
              op={op}
              isEditable={isEditable}
              customRows={draft.customPostings || []}
              onChangeCustomRows={(rows) =>
                setDraft((prev) => ({
                  ...prev,
                  customPostings: rows,
                  ...(op.docType1C === 'ОперацияБух'
                    ? {
                        amount: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
                      }
                    : {}),
                }))
              }
              hint={hints.dt_kt_check}
              hintsEnabled={hintsEnabled}
              forceOpenHint={activeAutoHintKey === 'dt_kt_check'}
              onDismissForceHint={() => setActiveAutoHintKey(null)}
            />
          ) : (
            <Taxi1CLayouts
              layoutKind={layoutKind}
              op={op}
              draft={draft}
              setDraft={setDraft}
              db1C={db1C}
              virtualState={virtual1CState.finalState}
              isEditable={isEditable}
              hints={hints}
              hintsEnabled={hintsEnabled}
              walkthroughStep={walkthroughStep}
              activeAutoHintKey={activeAutoHintKey}
              onDismissAutoHint={() => setActiveAutoHintKey(null)}
              onOpenReferenceCard={(kind) => setOpenReferenceKind(kind)}
              onCopiedNotice={triggerCopiedToast}
            />
          )}
        </div>

        {/* 5. Bottom Step-by-Step Walkthrough Strip («Провести по шагам») */}
        <div className="px-3 py-2 bg-[#ECE9DF] border-t border-[#CFCBC0] text-[11.5px] space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  walkthroughStep === null
                    ? applyWalkthroughStep(1)
                    : applyWalkthroughStep(null)
                }
                className={`inline-flex items-center gap-1 h-[26px] px-2.5 rounded-[3px] border font-medium whitespace-nowrap transition-colors ${
                  walkthroughStep !== null
                    ? 'border-[#C9A310] bg-[#FFDC33] text-[#1F1F1F] font-semibold'
                    : 'border-[#C4C4C4] bg-white hover:bg-[#FFF8DC] text-[#1F1F1F]'
                }`}
              >
                <Play className="w-3 h-3" strokeWidth={2} />
                {walkthroughStep !== null ? 'Обход включён' : 'Провести по шагам'}
              </button>

              {walkthroughStep !== null && (
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    disabled={walkthroughStep <= 1}
                    onClick={() => applyWalkthroughStep(walkthroughStep - 1)}
                    aria-label="Предыдущий шаг"
                    className="inline-flex items-center gap-0.5 h-[26px] px-2 rounded-[3px] border border-[#C4C4C4] bg-white hover:bg-[#F5F5F5] disabled:opacity-45 text-[#1F1F1F]"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
                    Назад
                  </button>
                  <button
                    type="button"
                    disabled={walkthroughStep >= steps.length}
                    onClick={() => applyWalkthroughStep(walkthroughStep + 1)}
                    aria-label="Следующий шаг"
                    className="inline-flex items-center gap-0.5 h-[26px] px-2 rounded-[3px] border border-[#C4C4C4] bg-white hover:bg-[#F5F5F5] disabled:opacity-45 text-[#1F1F1F]"
                  >
                    Далее
                    <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </button>
                </div>
              )}

              <div className="hidden md:flex flex-wrap items-center gap-1 pl-1">
                {steps.map((s) => {
                  const active = walkthroughStep === s.stepNumber;
                  return (
                    <button
                      key={s.stepNumber}
                      type="button"
                      onClick={() => applyWalkthroughStep(s.stepNumber)}
                      className={`h-[24px] px-2 rounded-[2px] border text-[11px] whitespace-nowrap transition-colors ${
                        active
                          ? 'border-[#B89514] bg-[#FFF2B2] text-[#1F1F1F] font-semibold'
                          : 'border-transparent hover:border-[#CCC8BC] hover:bg-white/70 text-[#555]'
                      }`}
                    >
                      {s.shortTitle}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="text-[11px] text-[#666] tabular-nums truncate max-w-md">
              Исходник: {op.sourceFileName || 'Журнал'} · {formatDateRu(op.date)}
            </div>
          </div>

          {currentStepObj && (
            <div className="px-2.5 py-1.5 rounded-[2px] border border-[#DFCE8B] bg-[#FFFDF2] text-[#2A2410] flex items-center justify-between gap-2">
              <div>
                <strong className="font-semibold">{currentStepObj.shortTitle}: </strong>
                <span>{currentStepObj.instructionSummary}</span>
              </div>
              <button
                type="button"
                onClick={() => applyWalkthroughStep(null)}
                className="text-[11px] text-[#6E5C1E] hover:underline shrink-0"
              >
                Завершить обход
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 6. Nested 1C Directory Reference Card (❐) */}
      {openReferenceKind !== null && (
        <Modal1CReferenceCard
          entityKind={openReferenceKind}
          op={op}
          draftPatch={draft}
          db1C={db1C}
          virtualState={virtual1CState.finalState}
          isEditable={isEditable}
          onSavePatch={(subPatch) =>
            setDraft((prev) => ({
              ...prev,
              ...subPatch,
            }))
          }
          onClose={() => setOpenReferenceKind(null)}
        />
      )}
    </div>
  );
}
