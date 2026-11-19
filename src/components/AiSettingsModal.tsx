'use client';

import React, { useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { AiProviderConfig } from '@/types/accounting';

export function AiSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { aiConfig, updateAiConfig } = useAccountant();

  const [provider, setProvider] = useState<AiProviderConfig['provider']>(aiConfig.provider);
  const [apiKey, setApiKey] = useState(aiConfig.apiKey);
  const [baseUrl, setBaseUrl] = useState(aiConfig.baseUrl || 'https://api.openai.com/v1');
  const [model, setModel] = useState(aiConfig.model || 'gemini-2.0-flash');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setProvider(aiConfig.provider);
      setApiKey(aiConfig.apiKey || '');
      setBaseUrl(aiConfig.baseUrl || 'https://api.openai.com/v1');
      setModel(aiConfig.model || 'gemini-2.0-flash');
    }
  }, [isOpen, aiConfig]);

  if (!isOpen) return null;

  const handleProviderSelect = (next: AiProviderConfig['provider']) => {
    setProvider(next);
    if (next === 'gemini' && (!model || model.startsWith('gpt-'))) {
      setModel('gemini-2.0-flash');
    } else if (next === 'openai-compatible' && (!model || model.startsWith('gemini'))) {
      setModel('gpt-4o-mini');
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateAiConfig({
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || 'https://api.openai.com/v1',
      model:
        model.trim() ||
        (provider === 'openai-compatible' ? 'gpt-4o-mini' : 'gemini-2.0-flash'),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-xl rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-[#FAFAFA] dark:bg-[#09090B]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Настройки ИИ и Vision OCR
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-4">
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Режим работы
            </label>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => handleProviderSelect('demo-local')}
                className={`text-left p-3 rounded-md border transition-colors ${
                  provider === 'demo-local'
                    ? 'border-zinc-900 dark:border-zinc-200 bg-[#FAFAFA] dark:bg-zinc-900'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    <Cpu className="w-4 h-4" />
                    Локальный движок 1С 8.3 (без API-ключа)
                  </div>
                  {provider === 'demo-local' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                      Активен
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Разбор текста, Excel/CSV, выгрузок ОСВ из 1С и экспертный чат работают офлайн.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleProviderSelect('gemini')}
                className={`text-left p-3 rounded-md border transition-colors ${
                  provider === 'gemini'
                    ? 'border-zinc-900 dark:border-zinc-200 bg-[#FAFAFA] dark:bg-zinc-900'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    <Sparkles className="w-4 h-4" />
                    Google Gemini API (Vision OCR скриншотов + LLM)
                  </div>
                  {provider === 'gemini' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                      Выбран
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Оптическое распознавание фото таблиц (`gemini-2.0-flash` / `gemini-2.5-flash`).
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleProviderSelect('openai-compatible')}
                className={`text-left p-3 rounded-md border transition-colors ${
                  provider === 'openai-compatible'
                    ? 'border-zinc-900 dark:border-zinc-200 bg-[#FAFAFA] dark:bg-zinc-900'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    <KeyRound className="w-4 h-4" />
                    OpenAI / Совместимый API
                  </div>
                  {provider === 'openai-compatible' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                      Выбран
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>

          {provider !== 'demo-local' && (
            <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  API-ключ
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider === 'gemini' ? 'AIzaSy...' : 'sk-...'}
                    className="w-full pl-3 pr-9 py-1.5 rounded-md text-xs font-mono bg-white dark:bg-[#111113] border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {provider === 'openai-compatible' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-1.5 rounded-md text-xs font-mono bg-white dark:bg-[#111113] border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Модель
                  </label>
                  <div className="flex items-center gap-1">
                    {(provider === 'gemini'
                      ? ['gemini-2.0-flash', 'gemini-2.5-flash']
                      : ['gpt-4o-mini', 'gpt-4o']
                    ).map((presetModel) => (
                      <button
                        key={presetModel}
                        type="button"
                        onClick={() => setModel(presetModel)}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
                      >
                        {presetModel}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-md text-xs font-mono bg-white dark:bg-[#111113] border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>Ключ хранится локально в вашем браузере (`localStorage`).</span>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
            >
              <Check className="w-3.5 h-3.5" />
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
