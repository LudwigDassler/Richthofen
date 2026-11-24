'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Copy, HelpCircle, Play, X } from 'lucide-react';
import { SmartFieldHint1C, WalkthroughStep1C } from '@/lib/engine';
import { formatDateRu } from '@/lib/formatters';

export interface FieldHintPopover1CProps {
  hint?: SmartFieldHint1C;
  enabled: boolean;
  forceOpen?: boolean;
  onDismissForce?: () => void;
  compact?: boolean;
}

export function FieldHintPopover1C({
  hint,
  enabled,
  forceOpen = false,
  onDismissForce,
  compact = false,
}: FieldHintPopover1CProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hoveredOrPinned, setHoveredOrPinned] = useState(false);
  const [pinnedByClick, setPinnedByClick] = useState(false);
  const [copied, setCopied] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placement: 'bottom' | 'top';
  }>({ top: 0, left: 0, placement: 'bottom' });

  const isOpen = enabled && Boolean(hint) && (hoveredOrPinned || pinnedByClick || forceOpen);

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popWidth = 368;
    const popEstHeight = popoverRef.current?.offsetHeight || 244;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left - 12;
    if (left + popWidth > vw - 14) {
      left = Math.max(12, vw - popWidth - 14);
    }
    if (left < 12) left = 12;

    const spaceBelow = vh - rect.bottom;
    if (spaceBelow < popEstHeight + 18 && rect.top > popEstHeight + 18) {
      setCoords({
        top: Math.max(10, rect.top - popEstHeight - 8),
        left,
        placement: 'top',
      });
    } else {
      setCoords({
        top: Math.min(vh - popEstHeight - 10, rect.bottom + 7),
        left,
        placement: 'bottom',
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    const onWinChange = () => updatePosition();
    window.addEventListener('resize', onWinChange);
    window.addEventListener('scroll', onWinChange, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWinChange);
      window.removeEventListener('scroll', onWinChange, true);
    };
  }, [isOpen, updatePosition, hint]);

  useEffect(() => {
    if (!pinnedByClick) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setPinnedByClick(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pinnedByClick]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!enabled || !hint) return null;

  const scheduleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHoveredOrPinned(false);
    }, 140);
  };

  const cancelClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setHoveredOrPinned(true);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hint.copyValue) return;
    try {
      await navigator.clipboard.writeText(hint.copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Подсказка 1С: ${hint.label}`}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onFocus={cancelClose}
        onBlur={scheduleClose}
        onClick={(e) => {
          e.stopPropagation();
          if (forceOpen && onDismissForce) {
            onDismissForce();
            return;
          }
          setPinnedByClick((v) => !v);
        }}
        className={`inline-flex items-center justify-center shrink-0 rounded-full border transition-colors ${
          compact ? 'w-4 h-4 text-[10px]' : 'w-[18px] h-[18px] text-[11px]'
        } ${
          isOpen
            ? 'bg-[#FFDC33] border-[#C9A310] text-[#1F1F1F] font-bold shadow-xs'
            : 'bg-[#FFF9DF] hover:bg-[#FFEC99] border-[#E0C252] text-[#7A5B00]'
        }`}
      >
        <HelpCircle className="w-3 h-3" strokeWidth={2} />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[90] w-[368px] max-w-[calc(100vw-24px)] rounded-[4px] border border-[#D4B43B] bg-[#FFFDF4] text-[#1F1F1F] shadow-[0_8px_24px_rgba(15,23,42,0.18)] text-[11.5px] leading-snug"
          >
            {/* Header bar */}
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#FFF4C2] border-b border-[#E8D06B] rounded-t-[3px]">
              <span className="font-semibold text-[#1F1F1F] truncate">
                Подсказка 1С · {hint.label}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {hint.copyValue && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] border border-[#C9A82C] bg-white hover:bg-[#FFF9E2] text-[10.5px] font-medium text-[#1F1F1F] whitespace-nowrap transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-700" strokeWidth={2} />
                        Скопировано
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-[#6E5600]" strokeWidth={1.8} />
                        Скопировать
                      </>
                    )}
                  </button>
                )}
                {(pinnedByClick || forceOpen) && (
                  <button
                    type="button"
                    aria-label="Закрыть подсказку"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPinnedByClick(false);
                      setHoveredOrPinned(false);
                      onDismissForce?.();
                    }}
                    className="p-0.5 rounded-[2px] text-[#5C4A00] hover:bg-black/10"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </div>

            {/* 3 structured pedagogical blocks */}
            <div className="p-2.5 space-y-2">
              <div>
                <div className="text-[10.5px] font-semibold text-[#6E5600]">
                  1. Откуда это значение:
                </div>
                <div className="text-[#1F1F1F] tabular-nums mt-0.5">
                  {hint.whereValueComesFrom}
                </div>
                {hint.provenanceSteps && hint.provenanceSteps.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-3 list-disc text-[10.5px] text-[#52461D] tabular-nums">
                    {hint.provenanceSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pt-1.5 border-t border-[#EFE3B0]">
                <div className="text-[10.5px] font-semibold text-[#0F5499]">
                  2. Что сделать в 1С 8.3:
                </div>
                <div className="text-[#1F1F1F] mt-0.5">{hint.actionIn1C}</div>
              </div>

              <div className="pt-1.5 border-t border-[#EFE3B0]">
                <div className="text-[10.5px] font-semibold text-[#9F2B2B]">
                  3. Частая ошибка студентов:
                </div>
                <div className="text-[#3A2A2A] mt-0.5">{hint.commonMistake}</div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export interface DocumentWalkthroughBar1CProps {
  steps: WalkthroughStep1C[];
  walkthroughStep: number | null;
  onChangeStep: (nextStep: number | null) => void;
  sourceFileName?: string;
  operationDate: string;
}

export function DocumentWalkthroughBar1C({
  steps,
  walkthroughStep,
  onChangeStep,
  sourceFileName,
  operationDate,
}: DocumentWalkthroughBar1CProps) {
  const currentStepObj =
    walkthroughStep !== null
      ? steps.find((s) => s.stepNumber === walkthroughStep) || null
      : null;

  return (
    <div className="px-3 py-2 bg-[#ECE9DF] border-t border-[#CFCBC0] text-[11.5px] space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              walkthroughStep === null ? onChangeStep(1) : onChangeStep(null)
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
                onClick={() => onChangeStep(walkthroughStep - 1)}
                aria-label="Предыдущий шаг"
                className="inline-flex items-center gap-0.5 h-[26px] px-2 rounded-[3px] border border-[#C4C4C4] bg-white hover:bg-[#F5F5F5] disabled:opacity-45 text-[#1F1F1F]"
              >
                <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
                Назад
              </button>
              <button
                type="button"
                disabled={walkthroughStep >= steps.length}
                onClick={() => onChangeStep(walkthroughStep + 1)}
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
                  onClick={() => onChangeStep(s.stepNumber)}
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
          Исходник: {sourceFileName || 'Журнал'} · {formatDateRu(operationDate)}
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
            onClick={() => onChangeStep(null)}
            className="text-[11px] text-[#6E5C1E] hover:underline shrink-0"
          >
            Завершить обход
          </button>
        </div>
      )}
    </div>
  );
}
