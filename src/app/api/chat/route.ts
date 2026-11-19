import { NextRequest, NextResponse } from 'next/server';
import type { AiProviderConfig, ChatMessage } from '@/types/accounting';
import {
  buildChatSystemPrompt,
  ChatContextPayload,
  generateLocalExpertReply,
} from '@/lib/ai/localExpertChat';

interface ChatRequestBody {
  messages?: Array<{
    id?: string;
    role?: 'user' | 'assistant' | 'system';
    content?: string;
    timestamp?: string;
  }>;
  message?: string;
  question?: string;
  context?: ChatContextPayload;
  aiConfig?: AiProviderConfig;
}

function normalizeMessages(body: ChatRequestBody): ChatMessage[] {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages
      .filter((m) => typeof m?.content === 'string' && m.content.trim().length > 0)
      .map((m, idx) => ({
        id: m.id || `msg-${idx + 1}`,
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: (m.content || '').trim(),
        timestamp: m.timestamp || new Date().toISOString(),
      }));
  }

  const single = (body.message || body.question || '').trim();
  if (single) {
    return [
      {
        id: 'msg-1',
        role: 'user',
        content: single,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  return [];
}

function resolveChatProvider(aiConfig?: AiProviderConfig): {
  mode: 'gemini' | 'openai-compatible' | 'local-expert';
  apiKey: string;
  model: string;
  baseUrl: string;
} {
  const envGemini = process.env.GEMINI_API_KEY?.trim() || '';
  const envOpenAi = process.env.OPENAI_API_KEY?.trim() || '';

  if (aiConfig?.provider === 'gemini') {
    const key = aiConfig.apiKey?.trim() || envGemini;
    if (key) {
      return {
        mode: 'gemini',
        apiKey: key,
        model: aiConfig.model?.trim() || 'gemini-2.0-flash',
        baseUrl: 'https://generativelanguage.googleapis.com',
      };
    }
  }

  if (aiConfig?.provider === 'openai-compatible') {
    const key = aiConfig.apiKey?.trim() || envOpenAi;
    if (key) {
      return {
        mode: 'openai-compatible',
        apiKey: key,
        model: aiConfig.model?.trim() || 'gpt-4o-mini',
        baseUrl: (aiConfig.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      };
    }
  }

  if (!aiConfig || aiConfig.provider !== 'demo-local') {
    if (envGemini) {
      return {
        mode: 'gemini',
        apiKey: envGemini,
        model: aiConfig?.model?.trim() || 'gemini-2.0-flash',
        baseUrl: 'https://generativelanguage.googleapis.com',
      };
    }
    if (envOpenAi) {
      return {
        mode: 'openai-compatible',
        apiKey: envOpenAi,
        model: aiConfig?.model?.trim() || 'gpt-4o-mini',
        baseUrl: (aiConfig?.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      };
    }
  }

  return {
    mode: 'local-expert',
    apiKey: '',
    model: '',
    baseUrl: '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const messages = normalizeMessages(body);
    const context = body.context;
    const aiConfig = body.aiConfig;

    if (messages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          usedMode: 'local-expert' as const,
          reply: 'Пожалуйста, введите ваш вопрос по 1С:Бухгалтерия 8.3.',
          error: 'Пустой список сообщений.',
        },
        { status: 400 }
      );
    }

    const resolved = resolveChatProvider(aiConfig);

    // =========================================================================
    // 1. LOCAL 1C 8.3 EXPERT ENGINE
    // =========================================================================
    if (resolved.mode === 'local-expert') {
      const reply = generateLocalExpertReply(messages, context);
      return NextResponse.json({
        success: true,
        usedMode: 'local-expert' as const,
        reply,
      });
    }

    const systemPrompt = buildChatSystemPrompt(context);
    const recentMessages = messages.slice(-14);

    // =========================================================================
    // 2. GEMINI CHAT
    // =========================================================================
    if (resolved.mode === 'gemini') {
      const modelName = resolved.model.replace(/^models\//, '') || 'gemini-2.0-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${encodeURIComponent(resolved.apiKey)}`;

      const geminiContents = recentMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: geminiContents,
          generationConfig: {
            temperature: 0.25,
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(
          `Ошибка Gemini API (${resp.status}): ${errText.slice(0, 240) || resp.statusText}`
        );
      }

      const data = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const reply =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('\n')
          .trim() || '';

      if (!reply) {
        throw new Error('Модель Gemini вернула пустой ответ.');
      }

      return NextResponse.json({
        success: true,
        usedMode: 'llm' as const,
        reply,
      });
    }

    // =========================================================================
    // 3. OPENAI-COMPATIBLE CHAT
    // =========================================================================
    const endpoint = `${resolved.baseUrl}/chat/completions`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model || 'gpt-4o-mini',
        temperature: 0.25,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(
        `Ошибка OpenAI API (${resp.status}): ${errText.slice(0, 240) || resp.statusText}`
      );
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim() || '';
    if (!reply) {
      throw new Error('OpenAI-совместимая модель вернула пустой ответ.');
    }

    return NextResponse.json({
      success: true,
      usedMode: 'llm' as const,
      reply,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Ошибка обращения к ИИ-помощнику.';
    return NextResponse.json(
      {
        success: false,
        usedMode: 'llm' as const,
        reply: `Не удалось получить ответ от внешнего ИИ (${errMsg}). Проверьте API-ключ в «Настройках ИИ» или переключите режим на встроенный экспертный модуль 1С 8.3.`,
        error: errMsg,
      },
      { status: 500 }
    );
  }
}
