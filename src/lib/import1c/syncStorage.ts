import fsSync from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { Database1CSnapshot } from '@/types/accounting';
import { normalize1CDatabaseExport } from './json1CSyncNormalizer';
import { isBase0JsonPayload, parseBase0Json } from './parseBase0Json';

export interface SyncCachePaths {
  cacheDir: string;
  rawFile: string;
  latestFile: string;
  legacyNormalizedFile: string;
  usingAmveraVolume: boolean;
}

export interface ResolveCacheOptions {
  platform?: NodeJS.Platform;
  cwd?: string;
  amveraVolumeRoot?: string;
  customCacheDir?: string;
  windowsExportPath?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __inMemory1CSnapshot: Database1CSnapshot | null | undefined;
}

function isWindowsDrivePath(candidate: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(candidate.trim());
}

/**
 * Resolves the directory used to persist `1c_latest_raw.json` and `1c_latest.json`.
 * - On Linux containers with `/data` volume mounted (Amvera persistent storage), uses `/data/1c-cache`
 *   and creates it via `fs.mkdirSync(..., { recursive: true })`.
 * - Locally on Windows/macOS/Linux without `/data`, uses `<cwd>/.cache`.
 * - Never touches `C:\...` paths on non-Windows platforms.
 */
export function resolve1CCachePaths(options: ResolveCacheOptions = {}): SyncCachePaths {
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const amveraRoot = options.amveraVolumeRoot ?? '/data';
  const envCustomDir = (options.customCacheDir ?? process.env.ONEC_CACHE_DIR ?? '').trim();

  let selectedDir = '';
  let usingAmveraVolume = false;

  // 1. Honor explicit ONEC_CACHE_DIR unless it is a Windows path on a non-Windows OS
  if (envCustomDir && (platform === 'win32' || !isWindowsDrivePath(envCustomDir))) {
    try {
      fsSync.mkdirSync(envCustomDir, { recursive: true });
      selectedDir = envCustomDir;
    } catch {
      selectedDir = '';
    }
  }

  // 2. On Linux/Unix containers, prefer Amvera persistent storage `/data/1c-cache` if `/data` exists
  if (!selectedDir && platform !== 'win32' && fsSync.existsSync(amveraRoot)) {
    const candidate = path.join(amveraRoot, '1c-cache');
    try {
      fsSync.mkdirSync(candidate, { recursive: true });
      selectedDir = candidate;
      usingAmveraVolume = true;
    } catch {
      selectedDir = '';
    }
  }

  // 3. Fallback to `<cwd>/.cache` (default on local Windows/macOS/dev)
  if (!selectedDir) {
    const localCache = path.join(cwd, '.cache');
    try {
      fsSync.mkdirSync(localCache, { recursive: true });
    } catch {
      // Read-only filesystem fallback: paths are still returned, in-memory snapshot keeps working
    }
    selectedDir = localCache;
  }

  return {
    cacheDir: selectedDir,
    rawFile: path.join(selectedDir, '1c_latest_raw.json'),
    latestFile: path.join(selectedDir, '1c_latest.json'),
    legacyNormalizedFile: path.join(selectedDir, '1c_latest_normalized.json'),
    usingAmveraVolume,
  };
}

function isAlreadyNormalizedSnapshot(value: unknown): value is Database1CSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.organization === 'object' &&
    rec.organization !== null &&
    Array.isArray(rec.rawBalances) &&
    Array.isArray(rec.postings) &&
    typeof rec.rawDirectories === 'object' &&
    rec.rawDirectories !== null
  );
}

export function decodeBufferTextSmart(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('\uFFFD')) {
    return utf8.replace(/^\uFEFF/, '');
  }
  try {
    return new TextDecoder('windows-1251').decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return utf8.replace(/^\uFEFF/, '');
  }
}

export function parseAndNormalize1CPayload(
  rawText: string,
  sourceLabel: string
): { cleanJsonText: string; snapshot: Database1CSnapshot } {
  const cleanJsonText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanJsonText) {
    throw new Error('Пустое тело запроса. Ожидался JSON выгрузки 1С.');
  }

  const parsed = JSON.parse(cleanJsonText);

  if (isAlreadyNormalizedSnapshot(parsed)) {
    return { cleanJsonText, snapshot: parsed };
  }

  // Unwrap optional envelope `{ snapshot: ... }` or `{ data: ... }` if sent by proxy/client
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>;
    if (isAlreadyNormalizedSnapshot(rec.snapshot)) {
      return { cleanJsonText, snapshot: rec.snapshot };
    }
    if (
      rec.data &&
      typeof rec.data === 'object' &&
      !Array.isArray(rec.data) &&
      !('Организация' in rec) &&
      !('Остатки' in rec) &&
      !('ВсеСправочники' in rec)
    ) {
      return {
        cleanJsonText: JSON.stringify(rec.data),
        snapshot: normalize1CDatabaseExport(rec.data, sourceLabel),
      };
    }
  }

  if (isBase0JsonPayload(parsed, sourceLabel)) {
    const snapshot = parseBase0Json(parsed as Record<string, unknown>, sourceLabel);
    return { cleanJsonText, snapshot };
  }

  const snapshot = normalize1CDatabaseExport(parsed, sourceLabel);
  return { cleanJsonText, snapshot };
}

/**
 * Extracts raw JSON text from either:
 * - Direct JSON / text POST body (`application/json`, `text/plain`, 1C `HTTPЗапрос`)
 * - Browser `multipart/form-data` upload (`File` / `Blob` or text field)
 */
export async function extract1CPayloadFromRequest(
  req: Request
): Promise<{ rawText: string; sourceLabel: string }> {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const preferredKeys = ['file', 'export', 'json', 'payload', 'data'];

    for (const key of preferredKeys) {
      const entry = formData.get(key);
      if (entry && typeof entry === 'object' && 'arrayBuffer' in entry) {
        const blob = entry as Blob & { name?: string };
        const buf = await blob.arrayBuffer();
        return {
          rawText: decodeBufferTextSmart(buf),
          sourceLabel: blob.name || 'POST /api/1c-sync (файл)',
        };
      }
      if (typeof entry === 'string' && entry.trim()) {
        return {
          rawText: entry,
          sourceLabel: `POST /api/1c-sync (${key})`,
        };
      }
    }

    for (const value of formData.values()) {
      if (value && typeof value === 'object' && 'arrayBuffer' in value) {
        const blob = value as Blob & { name?: string };
        const buf = await blob.arrayBuffer();
        return {
          rawText: decodeBufferTextSmart(buf),
          sourceLabel: blob.name || 'POST /api/1c-sync (файл)',
        };
      }
      if (typeof value === 'string' && value.trim()) {
        return {
          rawText: value,
          sourceLabel: 'POST /api/1c-sync (form)',
        };
      }
    }

    throw new Error('В multipart-запросе не найден JSON-файл выгрузки 1С.');
  }

  const buffer = await req.arrayBuffer();
  return {
    rawText: decodeBufferTextSmart(buffer),
    sourceLabel: 'POST /api/1c-sync',
  };
}

export async function readLatest1CSnapshot(
  options: ResolveCacheOptions = {}
): Promise<{
  connected: boolean;
  snapshot: Database1CSnapshot | null;
  paths: SyncCachePaths;
}> {
  const platform = options.platform ?? process.platform;
  const paths = resolve1CCachePaths(options);

  // 1. Primary raw export file (`1c_latest_raw.json`)
  if (fsSync.existsSync(paths.rawFile)) {
    try {
      const rawText = await fs.readFile(paths.rawFile, 'utf-8');
      const { snapshot } = parseAndNormalize1CPayload(
        rawText,
        `/api/1c-sync (${path.basename(paths.rawFile)})`
      );
      globalThis.__inMemory1CSnapshot = snapshot;
      return { connected: true, snapshot, paths };
    } catch {
      // Fall through to `1c_latest.json`
    }
  }

  // 2. Normalized or raw `1c_latest.json` (plus legacy `1c_latest_normalized.json`)
  for (const candidateFile of [paths.latestFile, paths.legacyNormalizedFile]) {
    if (fsSync.existsSync(candidateFile)) {
      try {
        const text = await fs.readFile(candidateFile, 'utf-8');
        const { snapshot } = parseAndNormalize1CPayload(
          text,
          `/api/1c-sync (${path.basename(candidateFile)})`
        );
        globalThis.__inMemory1CSnapshot = snapshot;
        return { connected: true, snapshot, paths };
      } catch {
        // Continue checking fallbacks
      }
    }
  }

  // 3. Optional Windows-only local export fallback (strictly guarded by `platform === 'win32'` & `fs.existsSync`)
  const winCandidate = (
    options.windowsExportPath ??
    process.env.ONEC_WINDOWS_EXPORT_PATH ??
    ''
  ).trim();
  if (platform === 'win32' && winCandidate && fsSync.existsSync(winCandidate)) {
    try {
      const rawBuf = await fs.readFile(winCandidate);
      const rawText = decodeBufferTextSmart(
        rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength)
      );
      const { snapshot } = parseAndNormalize1CPayload(rawText, winCandidate);
      globalThis.__inMemory1CSnapshot = snapshot;
      return { connected: true, snapshot, paths };
    } catch {
      // Ignore broken local fallback
    }
  }

  // 4. In-memory fallback (works even if container filesystem is read-only)
  if (globalThis.__inMemory1CSnapshot) {
    return {
      connected: true,
      snapshot: globalThis.__inMemory1CSnapshot,
      paths,
    };
  }

  return { connected: false, snapshot: null, paths };
}

export async function saveLatest1CSnapshot(
  rawText: string,
  sourceLabel = 'POST /api/1c-sync',
  options: ResolveCacheOptions = {}
): Promise<{
  snapshot: Database1CSnapshot;
  paths: SyncCachePaths;
  persistedToDisk: boolean;
}> {
  const { cleanJsonText, snapshot } = parseAndNormalize1CPayload(rawText, sourceLabel);
  const paths = resolve1CCachePaths(options);

  // Always update in-memory snapshot so POST -> GET works even without local disk
  globalThis.__inMemory1CSnapshot = snapshot;

  let persistedToDisk = false;
  try {
    fsSync.mkdirSync(paths.cacheDir, { recursive: true });
    await fs.writeFile(paths.rawFile, cleanJsonText, 'utf-8');
    await fs.writeFile(paths.latestFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    persistedToDisk = true;
  } catch {
    persistedToDisk = false;
  }

  return { snapshot, paths, persistedToDisk };
}

export async function clearLatest1CSnapshot(
  options: ResolveCacheOptions = {}
): Promise<void> {
  globalThis.__inMemory1CSnapshot = null;
  const paths = resolve1CCachePaths(options);
  for (const file of [paths.rawFile, paths.latestFile, paths.legacyNormalizedFile]) {
    try {
      await fs.rm(file, { force: true });
    } catch {
      // Ignore
    }
  }
}
