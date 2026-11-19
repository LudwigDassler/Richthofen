import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { Synced1CSnapshot } from '@/types/accounting';
import { decode1CTextBuffer } from '@/lib/import1c/xmlAndBankParser';
import {
  buildSample1CSyncErrorPayload,
  normalize1CSyncPayload,
} from '@/lib/import1c/json1CSyncNormalizer';

export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-1C-Token',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

function getCacheFilePath(): string {
  return path.join(process.cwd(), '.cache', '1c_latest.json');
}

function getRawCacheFilePath(): string {
  return path.join(process.cwd(), '.cache', '1c_latest_raw.json');
}

function getExternalExportCandidatePaths(): string[] {
  const candidates: string[] = [];
  const envPath = process.env.ONEC_EXPORT_JSON_PATH?.trim();
  if (envPath) {
    candidates.push(envPath);
  }
  candidates.push('C:\\Users\\Ludwig\\Downloads\\1c_export.json');
  try {
    const homeDownloads = path.join(os.homedir(), 'Downloads', '1c_export.json');
    if (!candidates.includes(homeDownloads)) {
      candidates.push(homeDownloads);
    }
  } catch {
    // Ignore homedir lookup errors in restricted environments
  }
  return candidates;
}

async function writeSnapshotCache(snapshot: Synced1CSnapshot, rawPayload?: unknown): Promise<void> {
  const cacheFile = getCacheFilePath();
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  if (rawPayload !== undefined) {
    await fs.writeFile(getRawCacheFilePath(), JSON.stringify(rawPayload, null, 2), 'utf-8');
  }
}

async function readSnapshotCache(): Promise<{
  snapshot: Synced1CSnapshot | null;
  mtimeMs: number;
}> {
  const cacheFile = getCacheFilePath();
  const rawCacheFile = getRawCacheFilePath();
  try {
    const stat = await fs.stat(cacheFile);
    const cachedText = await fs.readFile(cacheFile, 'utf-8');
    const parsedCached = JSON.parse(cachedText) as Record<string, unknown>;

    if (
      parsedCached &&
      parsedCached['isNormalizedSnapshot'] === true &&
      Array.isArray(parsedCached['allDocuments']) &&
      parsedCached['directories1C'] &&
      parsedCached['registers1C']
    ) {
      return {
        snapshot: parsedCached as unknown as Synced1CSnapshot,
        mtimeMs: stat.mtimeMs,
      };
    }

    // Fallback: re-normalize from raw cache if old format was stored
    try {
      const rawText = await fs.readFile(rawCacheFile, 'utf-8');
      const parsedRaw = JSON.parse(rawText) as unknown;
      const snapshot = normalize1CSyncPayload(parsedRaw);
      await writeSnapshotCache(snapshot);
      return { snapshot, mtimeMs: stat.mtimeMs };
    } catch {
      const snapshot = normalize1CSyncPayload(parsedCached);
      return { snapshot, mtimeMs: stat.mtimeMs };
    }
  } catch {
    try {
      const rawStat = await fs.stat(rawCacheFile);
      const rawText = await fs.readFile(rawCacheFile, 'utf-8');
      const parsedRaw = JSON.parse(rawText) as unknown;
      const snapshot = normalize1CSyncPayload(parsedRaw);
      await writeSnapshotCache(snapshot);
      return { snapshot, mtimeMs: rawStat.mtimeMs };
    } catch {
      return { snapshot: null, mtimeMs: 0 };
    }
  }
}

async function clearSnapshotCache(): Promise<void> {
  for (const filePath of [getCacheFilePath(), getRawCacheFilePath()]) {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function DELETE() {
  await clearSnapshotCache();
  return NextResponse.json(
    {
      status: 'ok',
      cleared: true,
      hasData: false,
      snapshot: null,
    },
    { headers: CORS_HEADERS }
  );
}

export async function GET() {
  try {
    const cached = await readSnapshotCache();

    // Safely check external 1c_export.json locations (never throws on EPERM or ENOENT)
    for (const extPath of getExternalExportCandidatePaths()) {
      try {
        const extStat = await fs.stat(extPath);
        if (!extStat.isFile()) continue;

        if (!cached.snapshot || extStat.mtimeMs > cached.mtimeMs) {
          const fileBytes = await fs.readFile(extPath);
          const decodedText = decode1CTextBuffer(toArrayBuffer(fileBytes)).trim();
          if (!decodedText) continue;

          const parsedJson = JSON.parse(decodedText) as unknown;
          const baseSnapshot = normalize1CSyncPayload(parsedJson, 'downloads-file');
          const snapshot: Synced1CSnapshot = {
            ...baseSnapshot,
            revision: `${baseSnapshot.revision}-m${Math.floor(extStat.mtimeMs)}`,
          };
          await writeSnapshotCache(snapshot, parsedJson);

          return NextResponse.json(
            {
              status: 'ok',
              hasData: true,
              syncedAt: snapshot.syncedAt,
              revision: snapshot.revision,
              snapshot,
            },
            { headers: CORS_HEADERS }
          );
        }
      } catch {
        // Sandbox EPERM or file does not exist — safely continue
      }
    }

    if (cached.snapshot) {
      return NextResponse.json(
        {
          status: 'ok',
          hasData: true,
          syncedAt: cached.snapshot.syncedAt,
          revision: cached.snapshot.revision,
          snapshot: cached.snapshot,
        },
        { headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        hasData: false,
        snapshot: null,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка чтения кэша синхронизации 1С.';
    return NextResponse.json(
      {
        status: 'error',
        hasData: false,
        error: msg,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    if (searchParams.get('clear') === '1') {
      await clearSnapshotCache();
      return NextResponse.json(
        {
          status: 'ok',
          cleared: true,
          hasData: false,
          snapshot: null,
        },
        { headers: CORS_HEADERS }
      );
    }

    if (searchParams.get('demo') === '1') {
      const sampleRaw = buildSample1CSyncErrorPayload();
      const snapshot = normalize1CSyncPayload(
        sampleRaw,
        'demo-simulation',
        `demo-sim-${Date.now()}`
      );
      await writeSnapshotCache(snapshot, sampleRaw);

      return NextResponse.json(
        {
          status: 'ok',
          hasData: true,
          syncedAt: snapshot.syncedAt,
          revision: snapshot.revision,
          snapshot,
        },
        { headers: CORS_HEADERS }
      );
    }

    const rawArrayBuffer = await req.arrayBuffer();
    const decodedText = decode1CTextBuffer(rawArrayBuffer).trim();
    if (!decodedText) {
      return NextResponse.json(
        {
          status: 'error',
          error:
            'Пустое тело запроса. Отправьте JSON выгрузки из 1С или вызовите ?demo=1 для тестового снимка.',
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(decodedText);
    } catch {
      return NextResponse.json(
        {
          status: 'error',
          error: 'Некорректный JSON в выгрузке 1С. Проверьте формат сериализации ЗаписьJSON.',
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const snapshot = normalize1CSyncPayload(parsedJson, 'http-post');
    await writeSnapshotCache(snapshot, parsedJson);

    return NextResponse.json(
      {
        status: 'ok',
        hasData: true,
        syncedAt: snapshot.syncedAt,
        revision: snapshot.revision,
        snapshot,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка приема синхронизации 1С.';
    return NextResponse.json(
      {
        status: 'error',
        error: msg,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
