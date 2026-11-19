import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { normalize1CDatabaseExport } from '@/lib/import1c/json1CSyncNormalizer';

export const dynamic = 'force-dynamic';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const RAW_CACHE_FILE = path.join(CACHE_DIR, '1c_latest_raw.json');
const NORMALIZED_CACHE_FILE = path.join(CACHE_DIR, '1c_latest_normalized.json');

export async function GET() {
  try {
    const rawText = await fs.readFile(RAW_CACHE_FILE, 'utf-8');
    const rawJson = JSON.parse(rawText);
    const snapshot = normalize1CDatabaseExport(
      rawJson,
      '/api/1c-sync (.cache/1c_latest_raw.json)'
    );

    return NextResponse.json({
      connected: true,
      snapshot,
    });
  } catch {
    try {
      const normText = await fs.readFile(NORMALIZED_CACHE_FILE, 'utf-8');
      const snapshot = JSON.parse(normText);
      return NextResponse.json({
        connected: true,
        snapshot,
      });
    } catch {
      return NextResponse.json({
        connected: false,
        snapshot: null,
        endpoint: '/api/1c-sync',
        message:
          'Выгрузка 1С ещё не передана на сервер. Загрузите файл выгрузки JSON вручную или отправьте POST-запрос из 1С:Предприятие 8.3 на /api/1c-sync.',
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody.trim()) {
      return NextResponse.json(
        { error: 'Пустое тело запроса. Ожидался JSON выгрузки 1С.' },
        { status: 400 }
      );
    }

    const cleanBody = rawBody.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleanBody);
    const snapshot = normalize1CDatabaseExport(parsed, 'POST /api/1c-sync');

    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(RAW_CACHE_FILE, cleanBody, 'utf-8');
    await fs.writeFile(NORMALIZED_CACHE_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');

    return NextResponse.json({
      ok: true,
      connected: true,
      organization: snapshot.organization.name,
      inn: snapshot.organization.inn,
      counts: {
        balances: snapshot.rawBalances.length,
        postings: snapshot.postings.length,
        documents: snapshot.documents.length,
        directories: Object.keys(snapshot.rawDirectories).length,
      },
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка разбора JSON выгрузки 1С';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    await fs.rm(RAW_CACHE_FILE, { force: true });
    await fs.rm(NORMALIZED_CACHE_FILE, { force: true });
  } catch {
    // Ignore
  }
  return NextResponse.json({ ok: true, connected: false });
}
