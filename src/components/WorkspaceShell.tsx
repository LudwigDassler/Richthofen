'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Compass,
  Database,
  FileSearch,
  ListTodo,
  Table2,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { Header } from '@/components/Header';
import { OperationsSidebar } from '@/components/OperationsSidebar';
import { StepNavigatorTab } from '@/components/StepNavigatorTab';
import { Database1CTab } from '@/components/Database1CTab';
import { AuditErrorsTab } from '@/components/AuditErrorsTab';
import { OsvTab } from '@/components/OsvTab';
import { AccountantChatPanel } from '@/components/AccountantChatPanel';
import { ImportTaskModal } from '@/components/ImportTaskModal';
import { AiSettingsModal } from '@/components/AiSettingsModal';

export function WorkspaceShell() {
  const {
    activeTab,
    setActiveTab,
    operations,
    activeOperationId,
    openingBalances,
    osvReport,
    reconciliation,
    requisiteReport,
    auditReport,
    synced1C,
  } = useAccountant();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [tab3SubView, setTab3SubView] = useState<'audit' | 'osv'>('audit');

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [activeOperationId]);

  useEffect(() => {
    if (activeTab === 'osv') {
      setTab3SubView('osv');
    } else if (activeTab === 'audit') {
      setTab3SubView('audit');
    }
  }, [activeTab]);

  const realQ2Operations = useMemo(
    () => operations.filter((op) => !op.isMonthEndClosing),
    [operations]
  );

  const doneIn1CCount = useMemo(
    () =>
      realQ2Operations.filter((op) =>
        op.match1C ? op.match1C.syncStatus === 'done_in_1c' : op.status === 'done'
      ).length,
    [realQ2Operations]
  );

  const osvAlertCount = useMemo(() => {
    const redCount = osvReport.rows.filter((r) => !r.isGroup && r.hasRedBalance).length;
    return redCount + reconciliation.mismatchedAccountsCount;
  }, [osvReport.rows, reconciliation.mismatchedAccountsCount]);

  const combinedErrorsCount = useMemo(
    () => Math.max(auditReport.totalIssuesCount, osvAlertCount),
    [auditReport.totalIssuesCount, osvAlertCount]
  );

  const isTab1 = activeTab === 'navigator';
  const isTab2 =
    activeTab === 'database1c' || activeTab === 'balances' || activeTab === 'directories';
  const isTab3 =
    activeTab === 'audit_osv' || activeTab === 'audit' || activeTab === 'osv';

  const dbInitialSection =
    activeTab === 'balances'
      ? 'balances'
      : activeTab === 'directories'
        ? 'directories'
        : undefined;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FAFAFA] text-zinc-900 dark:bg-[#09090B] dark:text-zinc-100">
      {/* 1-Row Global Header */}
      <Header
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenAiSettings={() => setIsAiSettingsOpen(true)}
        onToggleMobileChat={() => setIsChatDrawerOpen((prev) => !prev)}
      />

      {/* 3 Clear Top Tabs Bar */}
      <nav
        aria-label="Разделы рабочей области"
        className="z-20 flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-[#111113] sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {isTab1 && (
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 lg:hidden"
            >
              <ListTodo className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">
                Операции ({doneIn1CCount}/{realQ2Operations.length})
              </span>
            </button>
          )}

          {/* Tab 1: Что сделать в 1С (Пошагово) */}
          <button
            type="button"
            onClick={() => setActiveTab('navigator')}
            className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition ${
              isTab1
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Compass className="h-3.5 w-3.5 shrink-0" />
            <span>Что сделать в 1С (Пошагово)</span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                isTab1
                  ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              {doneIn1CCount}/{realQ2Operations.length}
            </span>
          </button>

          {/* Tab 2: Что уже есть в моей базе 1С */}
          <button
            type="button"
            onClick={() => setActiveTab('database1c')}
            className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition ${
              isTab2
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span>Что уже есть в моей базе 1С</span>
            {requisiteReport.incompleteCount > 0 ? (
              <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                {requisiteReport.incompleteCount}
              </span>
            ) : (
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                  isTab2
                    ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {synced1C ? synced1C.allDocuments?.length ?? 0 : openingBalances.length}
              </span>
            )}
          </button>

          {/* Tab 3: Проверка ошибок и ОСВ */}
          <button
            type="button"
            onClick={() => setActiveTab('audit_osv')}
            className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition ${
              isTab3
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <FileSearch className="h-3.5 w-3.5 shrink-0" />
            <span>Проверка ошибок и ОСВ</span>
            {combinedErrorsCount > 0 && (
              <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                {combinedErrorsCount}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left 320px Operations Sidebar ONLY on Tab 1 */}
        {isTab1 && (
          <div className="hidden w-[320px] shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111113] lg:flex">
            <OperationsSidebar onOpenImportModal={() => setIsImportModalOpen(true)} />
          </div>
        )}

        {/* Right / Full Workspace */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#FAFAFA] dark:bg-[#09090B]">
          {/* Clean Segmented Switch on Tab 3 («Проверка ошибок и ОСВ») */}
          {isTab3 && (
            <div className="z-10 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-[#111113] sm:px-6">
              <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    setTab3SubView('audit');
                    setActiveTab('audit_osv');
                  }}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition ${
                    tab3SubView === 'audit'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <FileSearch className="h-3.5 w-3.5" />
                  <span>Найденные ошибки и недочеты</span>
                  {auditReport.totalIssuesCount > 0 && (
                    <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                      {auditReport.totalIssuesCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTab3SubView('osv');
                    setActiveTab('audit_osv');
                  }}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition ${
                    tab3SubView === 'osv'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  <span>Оборотно-сальдовая ведомость (ОСВ)</span>
                  {osvAlertCount > 0 && (
                    <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                      {osvAlertCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto pb-20 scrollbar-thin">
            {isTab1 && <StepNavigatorTab />}
            {isTab2 && <Database1CTab initialSection={dbInitialSection} />}
            {isTab3 && (tab3SubView === 'audit' ? <AuditErrorsTab /> : <OsvTab />)}
          </div>
        </main>
      </div>

      {/* Mobile Slide-Over Operations Drawer (Tab 1) */}
      {isTab1 && isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 flex bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        >
          <div
            className="relative flex h-full w-[88vw] max-w-[320px] flex-col border-r border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#111113]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-11 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Операции задачи
              </span>
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <OperationsSidebar
                onOpenImportModal={() => {
                  setIsMobileSidebarOpen(false);
                  setIsImportModalOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bottom-Right Compact Button + Slide-Over Chat Drawer («Личный бухгалтер») */}
      <AccountantChatPanel
        isOpen={isChatDrawerOpen}
        onOpenChange={setIsChatDrawerOpen}
        onCloseMobile={() => setIsChatDrawerOpen(false)}
        onOpenAiSettings={() => setIsAiSettingsOpen(true)}
      />

      {/* Global Modals */}
      <ImportTaskModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onOpenAiSettings={() => {
          setIsImportModalOpen(false);
          setIsAiSettingsOpen(true);
        }}
      />

      <AiSettingsModal
        isOpen={isAiSettingsOpen}
        onClose={() => setIsAiSettingsOpen(false)}
      />
    </div>
  );
}
