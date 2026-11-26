'use client';

import React, { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = `${error?.name ?? ''} ${error?.message ?? ''}`;
    const isChunkError =
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk') ||
      msg.includes('Failed to fetch dynamically imported module');

    if (isChunkError && typeof window !== 'undefined') {
      try {
        const key = 'app_chunk_reload_once';
        const lastReload = Number(window.sessionStorage.getItem(key) || '0');
        if (Date.now() - lastReload > 15000) {
          window.sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      } catch {
        // Ignore sessionStorage restrictions in sandboxed iframes
      }
    }
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F7F8FA] dark:bg-slate-950">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
        <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Обновление модулей рабочей среды
        </div>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          Версия сборки на сервере обновилась. Нажмите кнопку ниже, чтобы перезагрузить актуальные модули интерфейса без потери сохранённых данных.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              } else {
                reset();
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Обновить страницу
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Повторить
          </button>
        </div>
      </div>
    </div>
  );
}
