import { NextRequest, NextResponse } from 'next/server';
import {
  EgrulLookupResponse,
  lookupCounterpartyInEgrul,
} from '@/lib/egrul/egrulLookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BatchQueryItem {
  key: string;
  name: string;
  inn?: string;
}

function deriveRegionHint(rawRegion?: string, orgInn?: string, orgBik?: string): string {
  const cleanReg = (rawRegion ?? '').replace(/\D/g, '');
  if (cleanReg.length === 2) return cleanReg;
  const cleanInn = (orgInn ?? '').replace(/\D/g, '');
  if (cleanInn.length >= 10) return cleanInn.slice(0, 2);
  const cleanBik = (orgBik ?? '').replace(/\D/g, '');
  if (cleanBik.startsWith('0440')) return '78';
  if (cleanBik.startsWith('0445')) return '77';
  if (cleanBik.startsWith('0465')) return '66';
  return '78';
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get('query') ?? searchParams.get('name') ?? '').trim();
  const inn = (searchParams.get('inn') ?? '').trim();
  const regionHint = deriveRegionHint(
    searchParams.get('region') ?? undefined,
    searchParams.get('organizationInn') ?? undefined,
    searchParams.get('organizationBik') ?? undefined
  );

  if (!query && !inn) {
    return NextResponse.json(
      { ok: false, found: false, query: '', candidates: [], error: 'Не передан поисковый запрос' },
      { status: 400 }
    );
  }

  const result = await lookupCounterpartyInEgrul(query, inn, {
    regionPrefixHint: regionHint,
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      query?: string;
      name?: string;
      inn?: string;
      regionHint?: string;
      organizationInn?: string;
      organizationBik?: string;
      queries?: BatchQueryItem[];
    };

    const regionHint = deriveRegionHint(
      body.regionHint,
      body.organizationInn,
      body.organizationBik
    );

    if (Array.isArray(body.queries)) {
      const uniqueItems = body.queries.slice(0, 30);
      const results: Record<string, EgrulLookupResponse> = {};

      // Process in small concurrency batches of 4 to be polite to FNS EGRUL API
      const concurrency = 4;
      for (let i = 0; i < uniqueItems.length; i += concurrency) {
        const slice = uniqueItems.slice(i, i + concurrency);
        const settled = await Promise.all(
          slice.map(async (item) => {
            const res = await lookupCounterpartyInEgrul(item.name || '', item.inn || '', {
              regionPrefixHint: regionHint,
            });
            return { key: item.key, res };
          })
        );
        for (const entry of settled) {
          results[entry.key] = entry.res;
        }
      }

      return NextResponse.json({
        ok: true,
        regionHint,
        results,
      });
    }

    const singleName = (body.query ?? body.name ?? '').trim();
    const singleInn = (body.inn ?? '').trim();
    if (!singleName && !singleInn) {
      return NextResponse.json(
        { ok: false, found: false, query: '', candidates: [], error: 'Пустой запрос' },
        { status: 400 }
      );
    }

    const singleResult = await lookupCounterpartyInEgrul(singleName, singleInn, {
      regionPrefixHint: regionHint,
    });
    return NextResponse.json(singleResult);
  } catch (err) {
    return NextResponse.json(
      {
        ok: true,
        found: false,
        query: '',
        candidates: [],
        error: err instanceof Error ? err.message : 'Ошибка обработки запроса ЕГРЮЛ',
      },
      { status: 200 }
    );
  }
}
