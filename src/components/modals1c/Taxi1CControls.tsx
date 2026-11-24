'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SquareStack } from 'lucide-react';
import { ReferenceEntityKind1C, SmartFieldHint1C } from '@/lib/engine';
import { formatMoney } from '@/lib/formatters';
import { FieldHintPopover1C } from './FieldHintPopover1C';

export interface ReferencePickerOption1C {
  value: string;
  subLabel?: string;
  inn?: string;
  kpp?: string;
  contract?: string;
}

interface ReferenceField1CProps {
  label?: string;
  value: string;
  placeholder?: string;
  isEditable: boolean;
  entityKind: ReferenceEntityKind1C;
  options?: ReferencePickerOption1C[];
  onChange: (val: string, picked?: ReferencePickerOption1C) => void;
  onOpenReferenceCard: (kind: ReferenceEntityKind1C) => void;
  hint?: SmartFieldHint1C;
  hintsEnabled: boolean;
  forceOpenHint?: boolean;
  onDismissForceHint?: () => void;
  onCopiedNotice?: (val: string) => void;
  compact?: boolean;
}

export function ReferenceField1C({
  label,
  value,
  placeholder,
  isEditable,
  entityKind,
  options = [],
  onChange,
  onOpenReferenceCard,
  hint,
  hintsEnabled,
  forceOpenHint,
  onDismissForceHint,
  onCopiedNotice,
  compact = false,
}: ReferenceField1CProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [dropdownOpen]);

  const filteredOptions = options
    .filter((o) => o.value.trim().length > 0)
    .slice(0, 24);

  const handleSampleCopy = async () => {
    if (isEditable || !value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLocal(true);
      onCopiedNotice?.(value);
      setTimeout(() => setCopiedLocal(false), 1200);
    } catch {
      // Ignore
    }
  };

  const control = (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <div
        className={`flex items-stretch h-[27px] rounded-[2px] border bg-white transition-colors ${
          dropdownOpen
            ? 'border-[#E6B800]'
            : 'border-[#C4C4C4] focus-within:border-[#E6B800]'
        }`}
      >
        <input
          type="text"
          readOnly={!isEditable}
          value={value}
          placeholder={placeholder}
          onClick={handleSampleCopy}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label || placeholder || entityKind}
          className={`flex-1 min-w-0 px-2 text-[12px] text-[#1F1F1F] bg-transparent focus:outline-none truncate ${
            !isEditable && value ? 'cursor-pointer hover:bg-[#FFFDF3]' : ''
          }`}
        />

        {copiedLocal && (
          <span className="inline-flex items-center px-1 text-[10px] text-emerald-700 bg-emerald-50 shrink-0">
            <Check className="w-3 h-3" strokeWidth={2} />
          </span>
        )}

        {/* ▾ Dropdown select from live 1C directory */}
        <button
          type="button"
          title="Выбрать из справочника 1С (▾)"
          aria-label={`Выбрать из справочника: ${label || entityKind}`}
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen((v) => !v);
          }}
          className="w-[22px] flex items-center justify-center border-l border-[#DCDCDC] bg-[#FBFBFB] hover:bg-[#EFEFEF] text-[#444] text-[11px] shrink-0"
        >
          <ChevronDown className="w-3 h-3" strokeWidth={1.8} />
        </button>

        {/* Open nested 1C reference card */}
        <button
          type="button"
          title="Открыть карточку элемента справочника 1С"
          aria-label={`Открыть карточку справочника: ${label || entityKind}`}
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(false);
            onOpenReferenceCard(entityKind);
          }}
          className="w-[24px] flex items-center justify-center border-l border-[#DCDCDC] bg-[#FBFBFB] hover:bg-[#FFF4C2] text-[#333] shrink-0"
        >
          <SquareStack className="w-3 h-3" strokeWidth={1.8} />
        </button>
      </div>

      {dropdownOpen && (
        <div className="absolute left-0 right-0 top-[29px] z-[65] max-h-52 overflow-y-auto rounded-[2px] border border-[#B5B5B5] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.16)] text-[12px]">
          {filteredOptions.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] text-[#666]">
              В справочнике пока нет других элементов — нажмите иконку карточки справа для открытия.
            </div>
          ) : (
            filteredOptions.map((opt, idx) => (
              <button
                key={`${opt.value}-${idx}`}
                type="button"
                onClick={() => {
                  onChange(opt.value, opt);
                  setDropdownOpen(false);
                }}
                className="w-full px-2.5 py-1.5 text-left hover:bg-[#FFF6CC] border-b border-[#F2F2F2] last:border-b-0 flex items-center justify-between gap-2"
              >
                <span className="text-[#1F1F1F] truncate font-medium">{opt.value}</span>
                {opt.subLabel && (
                  <span className="text-[10.5px] text-[#666] tabular-nums shrink-0">
                    {opt.subLabel}
                  </span>
                )}
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              setDropdownOpen(false);
              onOpenReferenceCard(entityKind);
            }}
            className="w-full px-2.5 py-1.5 text-left bg-[#F9F8F3] hover:bg-[#FFF2B8] text-[11px] font-medium text-[#0F5499] border-t border-[#E4E1D6]"
          >
            + Создать / открыть карточку элемента 1С
          </button>
        </div>
      )}
    </div>
  );

  if (compact || !label) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        {control}
        {hint && (
          <FieldHintPopover1C
            hint={hint}
            enabled={hintsEnabled}
            forceOpen={forceOpenHint}
            onDismissForce={onDismissForceHint}
            compact
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[12px] text-[#4A4A4A] truncate">{label}:</span>
        {hint && (
          <FieldHintPopover1C
            hint={hint}
            enabled={hintsEnabled}
            forceOpen={forceOpenHint}
            onDismissForce={onDismissForceHint}
          />
        )}
      </div>
      {control}
    </div>
  );
}

export function PopoverPricesVat1C({
  vatRule,
  vatRate,
  isEditable,
  onChangeVat,
}: {
  vatRule: 'included' | 'on_top' | 'none';
  vatRate: number;
  isEditable: boolean;
  onChangeVat: (nextRule: 'included' | 'on_top' | 'none', nextRate: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOut = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  const linkLabel =
    vatRate <= 0 || vatRule === 'none'
      ? 'Без НДС'
      : vatRule === 'on_top'
        ? `НДС сверху (${vatRate}%)`
        : `НДС в сумме (${vatRate}%)`;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] text-[#0055A6] hover:text-[#003D7A] underline decoration-dotted underline-offset-2 whitespace-nowrap font-medium"
      >
        {linkLabel}
      </button>

      {open && (
        <div className="absolute right-0 top-[24px] z-[65] w-[300px] rounded-[3px] border border-[#B8B8B8] bg-[#FCFBF9] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)] text-[12px] text-[#1F1F1F] space-y-2.5">
          <div className="font-semibold text-[12px] border-b border-[#E5E3DC] pb-1.5">
            Цены в документе (1С:БП 3.0)
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                disabled={!isEditable}
                checked={vatRate > 0 && vatRule === 'included'}
                onChange={() => onChangeVat('included', vatRate > 0 ? vatRate : 20)}
              />
              <span>НДС в сумме (в т.ч. НДС 20/120)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                disabled={!isEditable}
                checked={vatRate > 0 && vatRule === 'on_top'}
                onChange={() => onChangeVat('on_top', vatRate > 0 ? vatRate : 20)}
              />
              <span>НДС сверху (+20% к цене без НДС)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                disabled={!isEditable}
                checked={vatRate <= 0 || vatRule === 'none'}
                onChange={() => onChangeVat('none', 0)}
              />
              <span>Без НДС (не облагается / УСН)</span>
            </label>
          </div>

          {vatRate > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#EAE8E1]">
              <span className="text-[11.5px] text-[#555]">Ставка НДС:</span>
              <select
                disabled={!isEditable}
                value={String(vatRate)}
                onChange={(e) => onChangeVat(vatRule === 'none' ? 'included' : vatRule, Number(e.target.value))}
                className="h-[25px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px]"
              >
                <option value="20">20%</option>
                <option value="10">10%</option>
              </select>
            </div>
          )}

          <p className="text-[11px] text-[#5C5338] bg-[#FFF8DC] p-2 rounded-[2px] border border-[#E8D58C]">
            Если в задании указано «в т.ч. НДС», ставьте <strong>НДС в сумме</strong>. Если указана «цена без НДС» — ставьте <strong>НДС сверху</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

export function PopoverSettlementAccounts1C({
  isBuyerSide,
}: {
  isBuyerSide: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOut = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  const mainAcc = isBuyerSide ? '62.01' : '60.01';
  const advAcc = isBuyerSide ? '62.02' : '60.02';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] text-[#0055A6] hover:text-[#003D7A] underline decoration-dotted underline-offset-2 whitespace-nowrap"
      >
        Расчеты: {mainAcc}, {advAcc}, зачет авансов: Автоматически
      </button>

      {open && (
        <div className="absolute left-0 top-[24px] z-[65] w-[320px] rounded-[3px] border border-[#B8B8B8] bg-[#FCFBF9] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)] text-[12px] text-[#1F1F1F] space-y-2">
          <div className="font-semibold border-b border-[#E5E3DC] pb-1.5">
            Счета расчетов с контрагентами
          </div>
          <div className="grid grid-cols-[155px_1fr] gap-1.5 items-center tabular-nums">
            <span className="text-[#555]">Счет расчетов:</span>
            <span className="px-2 py-0.5 border border-[#D4D4D4] bg-white rounded-[2px] font-medium">
              {mainAcc}
            </span>
            <span className="text-[#555]">Счет авансов:</span>
            <span className="px-2 py-0.5 border border-[#D4D4D4] bg-white rounded-[2px] font-medium">
              {advAcc}
            </span>
            <span className="text-[#555]">Зачет авансов:</span>
            <span className="px-2 py-0.5 border border-[#D4D4D4] bg-white rounded-[2px] font-medium">
              Автоматически
            </span>
          </div>
          <p className="text-[11px] text-[#555] pt-1 border-t border-[#EAE8E1]">
            При режиме «Автоматически» 1С сама проверяет остаток аванса на счёте {advAcc} по выбранному договору и делает проводку зачёта Дт {isBuyerSide ? '62.02 Кт 62.01' : '60.01 Кт 60.02'}.
          </p>
        </div>
      )}
    </div>
  );
}

export function UpdFooterBar1C({
  isSale,
  totalAmount,
  vatAmount,
  vatRate,
  hasInvoiceSF,
  sfNumber,
  sfDate,
  isEditable,
  onToggleInvoiceSF,
  onChangeSfNumber,
  onChangeSfDate,
  hint,
  hintsEnabled,
  forceOpenHint,
  onDismissForceHint,
  highlighted,
}: {
  isSale: boolean;
  totalAmount: number;
  vatAmount: number;
  vatRate: number;
  hasInvoiceSF: boolean;
  sfNumber: string;
  sfDate: string;
  isEditable: boolean;
  onToggleInvoiceSF: (val: boolean) => void;
  onChangeSfNumber: (val: string) => void;
  onChangeSfDate: (val: string) => void;
  hint?: SmartFieldHint1C;
  hintsEnabled: boolean;
  forceOpenHint?: boolean;
  onDismissForceHint?: () => void;
  highlighted?: boolean;
}) {
  const [reflectInBook, setReflectInBook] = useState(true);

  return (
    <div
      className={`rounded-[3px] border p-2.5 space-y-2 transition-colors ${
        highlighted
          ? 'border-[#D6B018] bg-[#FFFDF2] ring-2 ring-[#FFDC33]/55'
          : 'border-[#DCDAD2] bg-[#F7F6F2]'
      }`}
    >
      {/* Totals Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[#E3E1D8] text-[12px]">
        <div className="flex items-center gap-2 text-[#555]">
          <span>Валюта документа:</span>
          <strong className="text-[#1F1F1F]">руб.</strong>
        </div>
        <div className="flex flex-wrap items-center gap-5 tabular-nums">
          <div>
            <span className="text-[#555]">Всего: </span>
            <strong className="text-[13.5px] font-bold text-[#1F1F1F]">
              {formatMoney(totalAmount, true)} ₽
            </strong>
          </div>
          <div>
            <span className="text-[#555]">НДС (в т.ч.): </span>
            <strong className="text-[13px] font-semibold text-[#1F1F1F]">
              {vatRate > 0 ? `${formatMoney(vatAmount, true)} ₽` : 'Без НДС'}
            </strong>
          </div>
        </div>
      </div>

      {/* Authentic 1C УПД / Счет-фактура Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-3">
          {/* 1C UPD Switch */}
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={hasInvoiceSF}
              onClick={() => {
                if (isEditable) onToggleInvoiceSF(!hasInvoiceSF);
              }}
              className={`w-9 h-[19px] rounded-full p-0.5 transition-colors flex items-center ${
                hasInvoiceSF ? 'bg-[#3C9A3F] justify-end' : 'bg-[#BDBDBD] justify-start'
              } ${!isEditable ? 'opacity-90' : ''}`}
            >
              <span className="w-[15px] h-[15px] rounded-full bg-white shadow-xs" />
            </button>
            <span className="font-semibold text-[#1F1F1F]">УПД</span>
          </label>

          <span className="text-[#4A4A4A]">Счет-фактура:</span>

          {hasInvoiceSF ? (
            <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
              <span className="text-[#555]">№</span>
              <input
                type="text"
                readOnly={!isEditable}
                value={sfNumber}
                onChange={(e) => onChangeSfNumber(e.target.value)}
                placeholder="б/н"
                className="h-[25px] w-24 px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
              />
              <span className="text-[#555]">от</span>
              <input
                type="date"
                readOnly={!isEditable}
                value={sfDate}
                onChange={(e) => onChangeSfDate(e.target.value)}
                className="h-[25px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
              />
              <span className="text-[11.5px] font-medium text-[#207227]">
                {isSale ? 'Выписан (Книга продаж)' : 'Зарегистрирован'}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (isEditable) onToggleInvoiceSF(true);
              }}
              className="h-[26px] px-2.5 rounded-[2px] border border-[#CCCCCC] bg-white hover:bg-[#FFF8DC] text-[12px] text-[#0055A6] font-medium"
            >
              {isSale ? 'Выписать счет-фактуру' : 'Зарегистрировать счет-фактуру'}
            </button>
          )}

          {hint && (
            <FieldHintPopover1C
              hint={hint}
              enabled={hintsEnabled}
              forceOpen={forceOpenHint}
              onDismissForce={onDismissForceHint}
            />
          )}
        </div>

        {!isSale && vatRate > 0 && (
          <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#333] cursor-pointer">
            <input
              type="checkbox"
              checked={hasInvoiceSF && reflectInBook}
              disabled={!isEditable}
              onChange={(e) => setReflectInBook(e.target.checked)}
              className="rounded-[2px] border-[#999]"
            />
            <span>Отразить вычет НДС в книге покупок датой получения</span>
          </label>
        )}
      </div>
    </div>
  );
}
