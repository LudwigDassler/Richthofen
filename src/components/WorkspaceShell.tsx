'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { Header } from '@/components/Header';
import { Tab1DatabaseOsv } from '@/components/Tab1DatabaseOsv';
import { Tab2ImportPostings } from '@/components/Tab2ImportPostings';
import { Tab3AuditAutofix } from '@/components/Tab3AuditAutofix';
import { Tab4Export1C } from '@/components/Tab4Export1C';

export function WorkspaceShell() {
  const { hydrated, activeTab, notice, dismissNotice } = useAccountant();

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs text-zinc-500">
        Загрузка рабочего контура 1С:Бухгалтерия 8.3...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {notice && (
        <div className="max-w-[1600px] w-full mx-auto px-4 lg:px-6 pt-3">
          <div
            className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded border text-xs ${
              notice.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                : notice.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {notice.tone === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              ) : notice.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              ) : (
                <Info className="w-4 h-4 shrink-0 text-amber-600" />
              )}
              <span className="truncate">{notice.message}</span>
            </div>
            <button
              type="button"
              onClick={dismissNotice}
              aria-label="Закрыть уведомление"
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-5">
        {activeTab === 'db_osv' && <Tab1DatabaseOsv />}
        {activeTab === 'import_postings' && <Tab2ImportPostings />}
        {activeTab === 'audit_autofix' && <Tab3AuditAutofix />}
        {activeTab === 'export_1c' && <Tab4Export1C />}
      </main>
    </div>
  );
}
