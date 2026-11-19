'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Compass,
  HelpCircle,
  Lightbulb,
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { ACCOUNT_MAP } from '@/data/chartOfAccounts';

export interface AccountantChatPanelProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseMobile?: () => void;
  onOpenAiSettings?: () => void;
}

const QUICK_QUESTIONS: string[] = [
  'Почему здесь счет 20.01, а не 41?',
  'Как правильно оформить УПД в 1С 8.3?',
  'Не закрывается 20 счет при закрытии месяца, что проверить?',
  'Разбери проводки и НДС по текущей операции',
  'Почему у меня расхождение в ОСВ?',
];

function highlightAccountTokens(
  text: string,
  onSelectAccount: (code: string) => void,
  keyPrefix: string
): React.ReactNode[] {
  const regex = /(\b\d{2}\.\d{1,2}(?:\.[0-9А-ЯЁA-Z]{1,3})?\b|\b000\b)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1];
    if (!ACCOUNT_MAP[candidate]) {
      continue;
    }

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(
      <button
        key={`${keyPrefix}-acc-${match.index}`}
        type="button"
        onClick={() => onSelectAccount(candidate)}
        title={`Счет ${candidate}: ${ACCOUNT_MAP[candidate].name} (перейти в ОСВ)`}
        className="mx-0.5 inline-flex items-center rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0 font-mono text-[11px] font-semibold text-zinc-900 tabular-nums transition hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
      >
        {candidate}
      </button>
    );

    lastIndex = match.index + candidate.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function renderInlineMarkdown(
  text: string,
  onSelectAccount: (code: string) => void,
  keyPrefix: string
): React.ReactNode[] {
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const plain = text.slice(lastIdx, match.index);
      nodes.push(...highlightAccountTokens(plain, onSelectAccount, `${keyPrefix}-p-${lastIdx}`));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const inner = token.slice(2, -2);
      nodes.push(
        <strong
          key={`${keyPrefix}-b-${match.index}`}
          className="font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {highlightAccountTokens(inner, onSelectAccount, `${keyPrefix}-bi-${match.index}`)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const inner = token.slice(1, -1).trim();
      if (ACCOUNT_MAP[inner]) {
        nodes.push(
          <button
            key={`${keyPrefix}-cacc-${match.index}`}
            type="button"
            onClick={() => onSelectAccount(inner)}
            title={`Счет ${inner}: ${ACCOUNT_MAP[inner].name} (перейти в ОСВ)`}
            className="mx-0.5 inline-flex items-center rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-900 tabular-nums transition hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {inner}
          </button>
        );
      } else {
        nodes.push(
          <code
            key={`${keyPrefix}-code-${match.index}`}
            className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-800 tabular-nums dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {inner}
          </code>
        );
      }
    }

    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    nodes.push(...highlightAccountTokens(text.slice(lastIdx), onSelectAccount, `${keyPrefix}-tail`));
  }

  return nodes;
}

function FormattedChatContent({
  content,
  isUser,
  onSelectAccount,
}: {
  content: string;
  isUser: boolean;
  onSelectAccount: (code: string) => void;
}) {
  if (isUser) {
    return <p className="whitespace-pre-wrap text-xs leading-relaxed">{content}</p>;
  }

  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; items: string[] } | null = null;

  const flushList = (keyIdx: number) => {
    if (!listItems) return;
    if (listItems.ordered) {
      blocks.push(
        <ol
          key={`ol-${keyIdx}`}
          className="my-1.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300"
        >
          {listItems.items.map((item, i) => (
            <li key={i}>
              {renderInlineMarkdown(item, onSelectAccount, `oli-${keyIdx}-${i}`)}
            </li>
          ))}
        </ol>
      );
    } else {
      blocks.push(
        <ul
          key={`ul-${keyIdx}`}
          className="my-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300"
        >
          {listItems.items.map((item, i) => (
            <li key={i}>
              {renderInlineMarkdown(item, onSelectAccount, `uli-${keyIdx}-${i}`)}
            </li>
          ))}
        </ul>
      );
    }
    listItems = null;
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList(idx);
      return;
    }

    if (/^---+$/.test(trimmed)) {
      flushList(idx);
      blocks.push(
        <hr key={`hr-${idx}`} className="my-2 border-zinc-200 dark:border-zinc-800" />
      );
      return;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushList(idx);
      blocks.push(
        <h4
          key={`h-${idx}`}
          className="mt-2.5 mb-1 text-xs font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {renderInlineMarkdown(headingMatch[2], onSelectAccount, `h-${idx}`)}
        </h4>
      );
      return;
    }

    const unorderedMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (unorderedMatch) {
      if (!listItems || listItems.ordered) {
        flushList(idx);
        listItems = { ordered: false, items: [] };
      }
      listItems.items.push(unorderedMatch[1]);
      return;
    }

    const orderedMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (orderedMatch) {
      if (!listItems || !listItems.ordered) {
        flushList(idx);
        listItems = { ordered: true, items: [] };
      }
      listItems.items.push(orderedMatch[1]);
      return;
    }

    flushList(idx);

    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s*/, '');
      blocks.push(
        <blockquote
          key={`q-${idx}`}
          className="my-1.5 rounded border-l-2 border-zinc-500 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-800 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-200"
        >
          {renderInlineMarkdown(quoteText, onSelectAccount, `q-${idx}`)}
        </blockquote>
      );
      return;
    }

    blocks.push(
      <p
        key={`p-${idx}`}
        className="my-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300"
      >
        {renderInlineMarkdown(trimmed, onSelectAccount, `p-${idx}`)}
      </p>
    );
  });

  flushList(lines.length);

  return <div className="space-y-1">{blocks}</div>;
}

export function AccountantChatPanel({
  isOpen,
  onOpenChange,
  onCloseMobile,
  onOpenAiSettings,
}: AccountantChatPanelProps) {
  const {
    effectiveOrganization,
    openingBalances,
    activeOperation,
    operations,
    osvReport,
    reconciliation,
    auditReport,
    chatMessages,
    aiConfig,
    addChatMessage,
    clearChatMessages,
    setActiveTab,
  } = useAccountant();

  const [internalOpen, setInternalOpen] = useState(false);
  const drawerOpen = isOpen !== undefined ? isOpen : internalOpen;

  const setDrawerOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) {
        onOpenChange(next);
      } else {
        setInternalOpen(next);
      }
      if (!next && onCloseMobile) {
        onCloseMobile();
      }
    },
    [onOpenChange, onCloseMobile]
  );

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickChips, setShowQuickChips] = useState(true);
  const [seenContextSignature, setSeenContextSignature] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const redAccountsCount = useMemo(
    () => osvReport.rows.filter((r) => !r.isGroup && r.hasRedBalance).length,
    [osvReport.rows]
  );

  const discrepancyCount = reconciliation.diagnostics.length;
  const auditIssuesCount = auditReport.totalIssuesCount;

  const contextualTipSummary = useMemo(() => {
    if (auditIssuesCount > 0) {
      return {
        count: auditIssuesCount,
        isUrgent: true,
        headline: `Аудитор 1С нашел замечаний: ${auditIssuesCount}`,
        prompt: 'Почему у меня расхождение в ОСВ?',
      };
    }
    if (discrepancyCount > 0) {
      return {
        count: discrepancyCount,
        isUrgent: true,
        headline: `Найдено расхождений в вашей ОСВ: ${discrepancyCount}`,
        prompt: 'Почему у меня расхождение в ОСВ?',
      };
    }
    if (redAccountsCount > 0) {
      return {
        count: redAccountsCount,
        isUrgent: true,
        headline: `«Краснота» на ${redAccountsCount} сч. в ОСВ`,
        prompt: 'Почему возникла краснота (отрицательное сальдо) в ОСВ и как исправить?',
      };
    }
    if (activeOperation?.status === 'needs_data') {
      return {
        count: 1,
        isUrgent: true,
        headline: `Оп. №${activeOperation.number} ждет остатков из 1С`,
        prompt: 'Откуда взять недостающую сумму по текущей операции в 1С?',
      };
    }
    const pitfallsCount = activeOperation?.pitfalls.length ?? 0;
    if (activeOperation && pitfallsCount > 0) {
      return {
        count: pitfallsCount,
        isUrgent: activeOperation.pitfalls.some((p) => p.severity === 'critical'),
        headline: `Оп. №${activeOperation.number}: ${activeOperation.pitfalls[0].title}`,
        prompt: 'Разбери проводки и НДС по текущей операции',
      };
    }
    return {
      count: 0,
      isUrgent: false,
      headline: '',
      prompt: '',
    };
  }, [auditIssuesCount, discrepancyCount, redAccountsCount, activeOperation]);

  const contextSignature = `${activeOperation?.id ?? 'none'}:${activeOperation?.status ?? ''}:${discrepancyCount}:${redAccountsCount}:${auditIssuesCount}`;

  useEffect(() => {
    if (drawerOpen) {
      setSeenContextSignature(contextSignature);
    }
  }, [drawerOpen, contextSignature]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, setDrawerOpen]);

  useEffect(() => {
    if (drawerOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isLoading, drawerOpen]);

  const unreadTipsCount =
    seenContextSignature === contextSignature ? 0 : contextualTipSummary.count;

  const providerLabel = useMemo(() => {
    if (aiConfig.provider === 'gemini' && aiConfig.apiKey.trim()) {
      return 'Gemini';
    }
    if (aiConfig.provider === 'openai-compatible' && aiConfig.apiKey.trim()) {
      return 'OpenAI';
    }
    return 'Эксперт 1С';
  }, [aiConfig]);

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || isLoading) return;

    const currentOpNumber = activeOperation?.number;
    addChatMessage({
      role: 'user',
      content: question,
      relatedOperationNumber: currentOpNumber,
    });
    setInput('');
    setIsLoading(true);

    try {
      const nextMessagesPayload = [
        ...chatMessages.slice(-12).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
        {
          id: `user-${Date.now()}`,
          role: 'user' as const,
          content: question,
          timestamp: new Date().toISOString(),
        },
      ];

      const contextPayload = {
        organization: effectiveOrganization,
        openingBalances,
        activeOperation,
        operationsSummary: operations.map((op) => ({
          id: op.id,
          number: op.number,
          date: op.date,
          rawDescription: op.rawDescription,
          resolvedAmount: op.resolvedAmount,
          status: op.status,
          documentType1C: op.documentType1C,
          isMonthEndClosing: op.isMonthEndClosing,
        })),
        osvSummary: {
          totalStartDebit: osvReport.totalStartDebit,
          totalStartCredit: osvReport.totalStartCredit,
          totalTurnoverDebit: osvReport.totalTurnoverDebit,
          totalTurnoverCredit: osvReport.totalTurnoverCredit,
          totalEndDebit: osvReport.totalEndDebit,
          totalEndCredit: osvReport.totalEndCredit,
          rows: osvReport.rows.filter((r) => !r.isGroup),
        },
        discrepancies: reconciliation.diagnostics,
      };

      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessagesPayload,
          context: contextPayload,
          aiConfig,
        }),
      });

      const data = (await resp.json()) as {
        success?: boolean;
        reply?: string;
        error?: string;
      };

      const replyText =
        data.reply?.trim() ||
        'Не удалось получить ответ помощника. Попробуйте повторить запрос.';

      addChatMessage({
        role: 'assistant',
        content: replyText,
        relatedOperationNumber: currentOpNumber,
      });
    } catch {
      addChatMessage({
        role: 'assistant',
        content:
          'Произошла сетевая ошибка при обращении к модулю «Личный бухгалтер». Проверьте соединение или повторите вопрос.',
        relatedOperationNumber: currentOpNumber,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendQuestion(input);
    }
  };

  return (
    <>
      {/* Compact Linear Bottom-Right Trigger Button (rounded-md, 1px solid) */}
      {!drawerOpen && (
        <div className="fixed bottom-4 right-4 z-40">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            title={
              contextualTipSummary.headline ||
              'Открыть помощник «Личный бухгалтер 1С 8.3»'
            }
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3.5 text-xs font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span>Личный бухгалтер</span>

            {unreadTipsCount > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                  contextualTipSummary.isUrgent
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-600 text-white'
                }`}
              >
                <Lightbulb className="h-2.5 w-2.5" />
                <span>{unreadTipsCount}</span>
              </span>
            )}
          </button>
        </div>
      )}

      {/* Right-Side Linear Slide-Over Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#111113]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-[#111113]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-900 text-white dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 sm:text-sm">
                        Личный бухгалтер
                      </h2>
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-600 dark:bg-emerald-400" />
                        1С 8.3
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Контекстный помощник по проводкам и ОСВ
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {onOpenAiSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerOpen(false);
                        onOpenAiSettings();
                      }}
                      title="Настройки ИИ-провайдера"
                      className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <Settings2 className="h-3 w-3" />
                      <span>{providerLabel}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={clearChatMessages}
                    title="Очистить диалог"
                    className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    title="Закрыть панель (Esc)"
                    className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Live Context Strip */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {activeOperation && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('navigator');
                      setDrawerOpen(false);
                    }}
                    title={activeOperation.rawDescription}
                    className="inline-flex max-w-full items-center gap-1.5 truncate rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    <Compass className="h-3 w-3 shrink-0 text-zinc-500" />
                    <span className="truncate font-mono tabular-nums">
                      Оп. №{activeOperation.number} · {activeOperation.date}
                    </span>
                  </button>
                )}

                {(discrepancyCount > 0 || auditIssuesCount > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(auditIssuesCount > 0 ? 'audit' : 'osv');
                      setDrawerOpen(false);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 font-mono text-[11px] font-semibold text-red-700 tabular-nums transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>Ошибок: {Math.max(discrepancyCount, auditIssuesCount)}</span>
                  </button>
                )}

                {discrepancyCount === 0 && auditIssuesCount === 0 && redAccountsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('osv');
                      setDrawerOpen(false);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 font-mono text-[11px] font-semibold text-red-700 tabular-nums dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>Краснота: {redAccountsCount}</span>
                  </button>
                )}
              </div>

              {/* Active Tip Banner */}
              {contextualTipSummary.count > 0 && (
                <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="truncate">{contextualTipSummary.headline}</span>
                  </div>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void sendQuestion(contextualTipSummary.prompt)}
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-900 px-2 py-1 font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    <span>Разобрать</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Messages Feed */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-[#FAFAFA] px-4 py-4 scrollbar-thin dark:bg-[#09090B]">
              {chatMessages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border text-xs font-medium ${
                        isUser
                          ? 'border-zinc-800 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-300'
                      }`}
                    >
                      {isUser ? (
                        <User className="h-3.5 w-3.5" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                    </div>

                    <div
                      className={`max-w-[86%] rounded-md border px-3 py-2.5 ${
                        isUser
                          ? 'border-zinc-800 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-200'
                      }`}
                    >
                      {msg.relatedOperationNumber !== undefined && (
                        <div
                          className={`mb-1 font-mono text-[10px] font-medium tabular-nums ${
                            isUser
                              ? 'text-zinc-300 dark:text-zinc-600'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          Операция №{msg.relatedOperationNumber}
                        </div>
                      )}

                      <FormattedChatContent
                        content={msg.content}
                        isUser={isUser}
                        onSelectAccount={() => {
                          setActiveTab('osv');
                          setDrawerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-400">
                    Проверка счетов 1С 8.3 и вашей ОСВ...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Contextual Question Chips */}
            <div className="border-t border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-[#111113]">
              <div className="mb-1.5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowQuickChips((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  <HelpCircle className="h-3 w-3" />
                  <span>Быстрые вопросы по задаче</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickChips((v) => !v)}
                  className="text-[10px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  {showQuickChips ? 'Скрыть' : 'Показать'}
                </button>
              </div>

              {showQuickChips && (
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={isLoading}
                      onClick={() => void sendQuestion(q)}
                      className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-left text-[11px] text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendQuestion(input);
              }}
              className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-[#111113]"
            >
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Вопрос по проводкам, УПД, НДС, закрытию 20 счета или ОСВ..."
                  className="max-h-28 min-h-[40px] flex-1 resize-none rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  title="Отправить вопрос (Enter)"
                  className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
