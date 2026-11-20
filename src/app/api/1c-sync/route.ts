import { NextRequest, NextResponse } from 'next/server';
import {
  clearLatest1CSnapshot,
  extract1CPayloadFromRequest,
  readLatest1CSnapshot,
  saveLatest1CSnapshot,
} from '@/lib/import1c/syncStorage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { connected, snapshot, paths } = await readLatest1CSnapshot();

  if (connected && snapshot) {
    return NextResponse.json({
      connected: true,
      storage: paths.usingAmveraVolume ? '/data/1c-cache' : '.cache',
      snapshot,
    });
  }

  return NextResponse.json({
    connected: false,
    snapshot: null,
    endpoint: '/api/1c-sync',
    storage: paths.usingAmveraVolume ? '/data/1c-cache' : '.cache',
    message:
      'Выгрузка 1С ещё не передана на сервер. Загрузите файл выгрузки JSON в браузере или отправьте POST-запрос из 1С:Предприятие 8.3 на /api/1c-sync.',
  });
}

export async function POST(req: NextRequest) {
  try {
    const { rawText, sourceLabel } = await extract1CPayloadFromRequest(req);
    const { snapshot, paths, persistedToDisk } = await saveLatest1CSnapshot(
      rawText,
      sourceLabel
    );

    return NextResponse.json({
      ok: true,
      connected: true,
      persistedToDisk,
      storage: paths.usingAmveraVolume ? '/data/1c-cache' : '.cache',
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
    const message =
      err instanceof Error ? err.message : 'Ошибка разбора JSON выгрузки 1С';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  await clearLatest1CSnapshot();
  return NextResponse.json({ ok: true, connected: false });
}
