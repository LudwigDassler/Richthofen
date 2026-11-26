'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { Header } from '@/components/Header';

const TabLoadingFallback = () => (
  <div className="py-16 flex items-center justify-center text-sm text-slate-500">
    Загрузка раздела...
  </div>
);

const Tab1DatabaseOsv = dynamic(
  () => import('@/components/Tab1DatabaseOsv').then((m) => m.Tab1DatabaseOsv),
  { ssr: false, loading: TabLoadingFallback }
);
const Tab2ImportPostings = dynamic(
  () => import('@/components/Tab2ImportPostings').then((m) => m.Tab2ImportPostings),
  { ssr: false, loading: TabLoadingFallback }
);
const Tab3AuditAutofix = dynamic(
  () => import('@/components/Tab3AuditAutofix').then((m) => m.Tab3AuditAutofix),
  { ssr: false, loading: TabLoadingFallback }
);
const Tab4Export1C = dynamic(
  () => import('@/components/Tab4Export1C').then((m) => m.Tab4Export1C),
  { ssr: false, loading: TabLoadingFallback }
);
const Modal1CDocument = dynamic(
  () => import('@/components/modals1c').then((m) => m.Modal1CDocument),
  { ssr: false }
);

export function WorkspaceShell() {
  const { hydrated, activeTab, notice, dismissNotice, active1CModalOpId } = useAccountant();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0 });
    }
  }, [activeTab]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Загрузка рабочего контура 1С:Бухгалтерия 8.3...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {notice && (
        <div className="max-w-[1600px] w-full mx-auto px-4 lg:px-6 pt-4">
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
              notice.tone === 'error'
                ? 'border-rose-200/80 bg-rose-50/90 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
                : notice.tone === 'success'
                  ? 'border-emerald-200/80 bg-emerald-50/90 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-slate-200/80 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {notice.tone === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" strokeWidth={1.6} />
              ) : notice.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" strokeWidth={1.6} />
              ) : (
                <Info className="w-4 h-4 shrink-0 text-amber-600" strokeWidth={1.6} />
              )}
              <span className="truncate font-medium">{notice.message}</span>
            </div>
            <button
              type="button"
              onClick={dismissNotice}
              aria-label="Закрыть уведомление"
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 shrink-0 transition-colors"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.6} />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-6">
        {activeTab === 'db_osv' && <Tab1DatabaseOsv />}
        {activeTab === 'import_postings' && <Tab2ImportPostings />}
        {activeTab === 'audit_autofix' && <Tab3AuditAutofix />}
        {activeTab === 'export_1c' && <Tab4Export1C />}
      </main>

      {active1CModalOpId && <Modal1CDocument />}
    </div>
  );
}
