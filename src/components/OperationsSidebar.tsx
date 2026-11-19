'use client';

import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { BusinessOperation, Operation1CSyncStatus } from '@/types/accounting';

type SidebarFilter = 'all' | 'missing_in_1c' | 'needs_fix_in_1c' | 'done_in_1c';

function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ₽'
  );
}

function resolveOpSyncStatus(op: BusinessOperation): Operation1CSyncStatus {
  if (op.match1C?.syncStatus) {
    return op.match1C.syncStatus;
  }
  if (op.status === 'done') return 'done_in_1c';
  if (op.status === 'needs_data') return 'needs_fix_in_1c';
  return 'missing_in_1c';
}

function getStatusPresentation(syncStatus: Operation1CSyncStatus): {
  dotClass: string;
  textClass: string;
  label: string;
} {
  switch (syncStatus) {
    case 'done_in_1c':
      return {
        dotClass: 'bg-emerald-500',
        textClass: 'text-emerald-700 dark:text-emerald-400',
        label: 'Сделано в 1С',
      };
    case 'needs_fix_in_1c':
      return {
        dotClass: 'bg-amber-500',
        textClass: 'text-amber-700 dark:text-amber-400',
        label: 'Есть в 1С, нужна правка',
      };
    default:
      return {
        dotClass: 'bg-zinc-300 dark:bg-zinc-600',
        textClass: 'text-zinc-500 dark:text-zinc-400',
        label: 'Нужно создать',
      };
  }
}

export function OperationsSidebar({
  onOpenImportModal,
}: {
  onOpenImportModal: () => void;
}) {
  const {
    operations,
    activeOperation,
    selectOperationAndNavigate,
    uploadedImageDataUrl,
    activePresetId,
  } = useAccountant();

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<SidebarFilter>('all');
  const [showScreenshotPreview, setShowScreenshotPreview] = useState(false);

  // Strictly ONLY real Q2 operations (!op.isMonthEndClosing)
  const q2Operations = useMemo(
    () => operations.filter((op) => !op.isMonthEndClosing),
    [operations]
  );

  const counts = useMemo(() => {
    let missing = 0;
    let needsFix = 0;
    let done = 0;
    for (const op of q2Operations) {
      const st = resolveOpSyncStatus(op);
      if (st === 'done_in_1c') done += 1;
      else if (st === 'needs_fix_in_1c') needsFix += 1;
      else missing += 1;
    }
    return {
      all: q2Operations.length,
      missing,
      needsFix,
      done,
    };
  }, [q2Operations]);

  const filteredOperations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q2Operations.filter((op) => {
      const st = resolveOpSyncStatus(op);
      if (filter !== 'all' && st !== filter) return false;
      if (!q) return true;
      return (
        String(op.number).toLowerCase().includes(q) ||
        op.date.toLowerCase().includes(q) ||
        (op.shortTitle || '').toLowerCase().includes(q) ||
        op.rawDescription.toLowerCase().includes(q)
      );
    });
  }, [q2Operations, filter, searchQuery]);

  const previewImageSrc =
    uploadedImageDataUrl ||
    (activePresetId !== 'custom-imported-task' ? '/demo-task-screenshot.jpg' : null);

  return (
    <aside className="h-full flex flex-col bg-[#FAFAFA] dark:bg-[#09090B] border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Top Filter & Search Header */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Операции 2 квартала ({counts.all})
          </h2>

          {previewImageSrc && (
            <button
              type="button"
              onClick={() => setShowScreenshotPreview(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              <span>Скриншот</span>
            </button>
          )}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по операциям..."
            className="w-full pl-8 pr-7 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* 4 Clean Filter Pills */}
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: 'all', label: 'Все', count: counts.all },
              { id: 'missing_in_1c', label: 'Нужно создать', count: counts.missing },
              { id: 'needs_fix_in_1c', label: 'Нужна правка', count: counts.needsFix },
              { id: 'done_in_1c', label: 'Сделано', count: counts.done },
            ] as const
          ).map((pill) => {
            const active = filter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setFilter(pill.id)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  active
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                    : 'bg-[#FAFAFA] hover:bg-zinc-100 dark:bg-[#09090B] dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <span>{pill.label}</span>
                <span className="font-mono tabular-nums opacity-75">{pill.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Q2 Operations List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2.5 space-y-1.5">
        {filteredOperations.length === 0 ? (
          <div className="p-4 rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500">
            Операций по выбранному фильтру нет.
          </div>
        ) : (
          filteredOperations.map((op) => {
            const isActive = activeOperation?.id === op.id;
            const syncStatus = resolveOpSyncStatus(op);
            const pres = getStatusPresentation(syncStatus);
            const conciseTitle = op.shortTitle?.trim() || op.rawDescription;

            return (
              <button
                key={op.id}
                type="button"
                onClick={() => selectOperationAndNavigate(op.id)}
                className={`w-full text-left rounded-md p-3 border transition-colors space-y-1.5 ${
                  isActive
                    ? 'bg-white dark:bg-[#111113] border-zinc-900 dark:border-zinc-200 shadow-sm'
                    : 'bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900/70 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {/* Row 1: № • Date & Sum */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    №{op.number} • {op.date}
                  </span>

                  <span className="font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {op.resolvedAmount > 0
                      ? formatRub(op.resolvedAmount)
                      : 'Из остатков'}
                  </span>
                </div>

                {/* Row 2: Concise Title */}
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 leading-snug line-clamp-2">
                  {conciseTitle}
                </div>

                {/* Row 3: Single Clear Status Line */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className={`w-2 h-2 rounded shrink-0 ${pres.dotClass}`} />
                  <span className={`text-[11px] font-medium ${pres.textClass}`}>
                    {pres.label}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Subtle Footer Action */}
      <div className="p-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113]">
        <button
          type="button"
          onClick={onOpenImportModal}
          className="w-full py-1.5 px-2.5 rounded-md text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white bg-[#FAFAFA] hover:bg-zinc-100 dark:bg-[#09090B] dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-colors"
        >
          Загрузить другое задание / файл 1С
        </button>
      </div>

      {/* Screenshot Lightbox */}
      {showScreenshotPreview && previewImageSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65"
          onClick={() => setShowScreenshotPreview(false)}
        >
          <div
            className="max-w-4xl w-full rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Исходная таблица задания
              </span>
              <button
                type="button"
                onClick={() => setShowScreenshotPreview(false)}
                className="p-1 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-[#FAFAFA] dark:bg-[#09090B] max-h-[78vh] overflow-auto flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageSrc}
                alt="Скриншот таблицы операций"
                className="max-w-full h-auto rounded border border-zinc-200 dark:border-zinc-800"
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
