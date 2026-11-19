import { NextRequest, NextResponse } from 'next/server';
import type {
  AiProviderConfig,
  OpeningBalanceEntry,
  OrganizationCard,
} from '@/types/accounting';
import {
  buildTaskParserSystemPrompt,
  ParsedTaskResponseSchema,
} from '@/lib/ai/schemas';
import { parseTaskLocally } from '@/lib/ai/localRuleParser';

interface ParseTaskRequestBody {
  rawText?: string;
  imageBase64?: string;
  organization?: OrganizationCard;
  openingBalances?: OpeningBalanceEntry[];
  aiConfig?: AiProviderConfig;
}

function parseDataUrlImage(input: string): { mimeType: string; base64Data: string; dataUrl: string } {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (match) {
    const mimeType = match[1];
    const base64Data = match[2].replace(/\s+/g, '');
    return {
      mimeType,
      base64Data,
      dataUrl: `data:${mimeType};base64,${base64Data}`,
    };
  }
  const cleanBase64 = trimmed.replace(/\s+/g, '');
  const mimeType = cleanBase64.startsWith('/9j/')
    ? 'image/jpeg'
    : cleanBase64.startsWith('UklGR')
      ? 'image/webp'
      : 'image/png';
  return {
    mimeType,
    base64Data: cleanBase64,
    dataUrl: `data:${mimeType};base64,${cleanBase64}`,
  };
}

function extractJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const firstBrace = unfenced.indexOf('{');
    const lastBrace = unfenced.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Модель вернула ответ не в формате JSON.');
  }
}

function resolveEffectiveAiProvider(
  aiConfig?: AiProviderConfig,
  hasImage = false
): {
  mode: 'gemini' | 'openai-compatible' | 'local';
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

  // When aiConfig is omitted or demo-local without explicit key:
  // use env keys if available when no explicit demo-local override, OR when Vision image requires an LLM
  if (!aiConfig || aiConfig.provider !== 'demo-local' || hasImage) {
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
    mode: 'local',
    apiKey: '',
    model: '',
    baseUrl: '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ParseTaskRequestBody;
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    const organization = body.organization;
    const openingBalances = body.openingBalances;
    const aiConfig = body.aiConfig;

    if (!rawText && !imageBase64) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Не передан текст операций или изображение таблицы. Вставьте текст/таблицу из Excel или прикрепите скриншот.',
        },
        { status: 400 }
      );
    }

    const resolved = resolveEffectiveAiProvider(aiConfig, Boolean(imageBase64));

    // =========================================================================
    // 1. LOCAL SMART PARSER MODE (no API key or provider === 'demo-local')
    // =========================================================================
    if (resolved.mode === 'local') {
      if (!rawText && imageBase64) {
        const friendlyMsg =
          'Для распознавания скриншотов и фотографий методичек (Vision OCR) необходим API-ключ Gemini или OpenAI. ' +
          'Откройте «Настройки ИИ» в верхней панели и добавьте ключ, ЛИБО вставьте текст таблицы / загрузите файл Excel (.xlsx, .csv) / выберите готовую демо-задачу — умный локальный парсер 1С 8.3 разберет текст и таблицы мгновенно и без API-ключа!';
        return NextResponse.json(
          {
            success: false,
            usedMode: 'local-smart-parser',
            requiresApiKey: true,
            error: friendlyMsg,
            message: friendlyMsg,
          },
          { status: 400 }
        );
      }

      const localResult = parseTaskLocally(rawText, organization?.defaultVatRate ?? 20);
      if (localResult.operations.length === 0) {
        return NextResponse.json(
          {
            success: false,
            usedMode: 'local-smart-parser',
            error:
              'Не удалось распознать хозяйственные операции из введенного текста. Проверьте наличие строк с описанием операций.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        usedMode: 'local-smart-parser',
        title: localResult.title,
        operations: localResult.operations,
        directories: localResult.directories,
        warnings: imageBase64
          ? [
              ...localResult.warnings,
              'Изображение проигнорировано (API-ключ не задан) — разбор выполнен по текстовой части через локальный парсер 1С 8.3.',
            ]
          : localResult.warnings,
      });
    }

    // =========================================================================
    // 2. GEMINI VISION / JSON STRUCTURED PARSER
    // =========================================================================
    const systemPrompt = buildTaskParserSystemPrompt(organization, openingBalances);
    const q2FilterHint =
      'ВАЖНО: Если в тексте или файле есть секция «За 1 квартал», начальные остатки, реквизиты организации (ИНН, БИК 044030653) или операции с датами до 01.04 (январь/февраль/март), ИГНОРИРУЙ их и извлекай ТОЛЬКО хозяйственные операции 2 квартала (с 1 апреля)! Никогда не путай номера документов, табельные номера или БИК/ИНН с суммой операции.';
    const userPrompt = rawText
      ? `Распознай и разбери по правилам 1С:Бухгалтерия 8.3 (ред. 3.0) следующую учебную задачу.\n${q2FilterHint}\n\n${rawText}`
      : `Внимательно прочитай прикрепленный скриншот / фото таблицы хозяйственных операций, извлеки каждую строку без пропусков и верни полный разбор по правилам 1С:Бухгалтерия 8.3 (ред. 3.0) строго в формате JSON.\n${q2FilterHint}`;

    if (resolved.mode === 'gemini') {
      const modelName = resolved.model.replace(/^models\//, '') || 'gemini-2.0-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${encodeURIComponent(resolved.apiKey)}`;

      const parts: Array<Record<string, unknown>> = [];
      if (imageBase64) {
        const parsedImg = parseDataUrlImage(imageBase64);
        parts.push({
          inlineData: {
            mimeType: parsedImg.mimeType,
            data: parsedImg.base64Data,
          },
        });
      }
      parts.push({ text: userPrompt });

      const geminiResp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!geminiResp.ok) {
        const errText = await geminiResp.text().catch(() => '');
        throw new Error(
          `Ошибка Gemini API (${geminiResp.status}): ${errText.slice(0, 280) || geminiResp.statusText}`
        );
      }

      const geminiJson = (await geminiResp.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawModelText =
        geminiJson.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('\n')
          .trim() || '';

      if (!rawModelText) {
        throw new Error('Gemini вернул пустой ответ при разборе задачи.');
      }

      const parsedRawObj = extractJsonFromModelText(rawModelText);
      const validated = ParsedTaskResponseSchema.parse(parsedRawObj);

      return NextResponse.json({
        success: true,
        usedMode: 'gemini',
        title: validated.title,
        operations: validated.operations,
        directories: validated.directories,
        warnings: validated.warnings,
      });
    }

    // =========================================================================
    // 3. OPENAI-COMPATIBLE VISION / JSON STRUCTURED PARSER
    // =========================================================================
    const endpoint = `${resolved.baseUrl}/chat/completions`;
    const userContent: unknown = imageBase64
      ? [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: { url: parseDataUrlImage(imageBase64).dataUrl },
          },
        ]
      : userPrompt;

    const openAiResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model || 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!openAiResp.ok) {
      const errText = await openAiResp.text().catch(() => '');
      throw new Error(
        `Ошибка OpenAI API (${openAiResp.status}): ${errText.slice(0, 280) || openAiResp.statusText}`
      );
    }

    const openAiJson = (await openAiResp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawModelText = openAiJson.choices?.[0]?.message?.content?.trim() || '';
    if (!rawModelText) {
      throw new Error('OpenAI-совместимый провайдер вернул пустой ответ.');
    }

    const parsedRawObj = extractJsonFromModelText(rawModelText);
    const validated = ParsedTaskResponseSchema.parse(parsedRawObj);

    return NextResponse.json({
      success: true,
      usedMode: 'openai-compatible',
      title: validated.title,
      operations: validated.operations,
      directories: validated.directories,
      warnings: validated.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка при разборе задачи.';
    return NextResponse.json(
      {
        success: false,
        error: message,
        message,
      },
      { status: 500 }
    );
  }
}
