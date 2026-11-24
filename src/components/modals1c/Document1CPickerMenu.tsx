'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { CREATE_MENU_1C_SECTIONS, CreateDocumentPreset1C } from '@/lib/engine';

export interface Document1CPickerMenuProps {
  onSelectedPreset?: (preset: CreateDocumentPreset1C) => void;
}

export function Document1CPickerMenu({ onSelectedPreset }: Document1CPickerMenuProps) {
  const { create1CDocumentFromPreset } = useAccountant();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleSelect = (preset: CreateDocumentPreset1C) => {
    setOpen(false);
    create1CDocumentFromPreset(preset);
    onSelectedPreset?.(preset);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-300/90 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/80 dark:hover:bg-amber-950/50 text-xs font-medium text-slate-900 dark:text-amber-100 whitespace-nowrap shrink-0 transition-colors"
      >
        <Plus className="w-4 h-4 text-amber-700 dark:text-amber-400" strokeWidth={1.8} />
        + Документ 1С
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" strokeWidth={1.7} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Создание документа 1С:Бухгалтерия 8.3 по разделам учёта"
          className="absolute right-0 top-[42px] z-40 w-[368px] max-w-[calc(100vw-32px)] max-h-[72vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_14px_36px_rgba(15,23,42,0.16)] p-2 text-xs"
        >
          <div className="px-2.5 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
            Создать документ в интерактивной форме 1С:Бухгалтерия 8.3 («Такси»)
          </div>
          {CREATE_MENU_1C_SECTIONS.map((sec) => (
            <div
              key={sec.sectionId}
              className="py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-b-0"
            >
              <div className="px-2.5 pb-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                {sec.sectionTitle}
              </div>
              <div className="space-y-0.5">
                {sec.items.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(preset)}
                    className="w-full px-2.5 py-1.5 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                  >
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {preset.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {preset.subLabel}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
