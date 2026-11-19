import {
  AiProviderConfig,
  BusinessOperation,
  ChatMessage,
  ExtractedDirectories1C,
  OpeningBalanceEntry,
  OperationStatus,
  OrganizationCard,
  Synced1CSnapshot,
  UserOsvInputRow,
  WorkspaceTab,
} from '@/types/accounting';

export const STORAGE_KEY = '1c_personal_accountant_v3';
export const IDB_NAME = '1c_accountant_idb';
export const IDB_VERSION = 1;

const STORE_ASSETS = 'assets';
const STORE_SNAPSHOTS = 'snapshots';
const UPLOADED_IMAGE_KEY = 'uploaded_task_image';

export interface PersistedAccountantState {
  version: 3;
  activePresetId: string;
  taskTitle: string;
  organization: OrganizationCard;
  openingBalances: OpeningBalanceEntry[];
  rawOperations: BusinessOperation[];
  closingOperationStatuses: Record<string, OperationStatus>;
  includeAutoClosing: boolean;
  baseDirectories: ExtractedDirectories1C;
  activeOperationId: string;
  activeTab: WorkspaceTab;
  osvMode: 'completed_only' | 'all_operations';
  userOsvInputs: Record<string, UserOsvInputRow>;
  synced1C?: Synced1CSnapshot | null;
  chatMessages: ChatMessage[];
  aiConfig: AiProviderConfig;
  theme: 'light' | 'dark';
  savedAt: string;
}

export interface BackupSnapshotRecord {
  id: string;
  label: string;
  savedAt: string;
  state: PersistedAccountantState;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function loadPersistedState(): PersistedAccountantState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAccountantState>;
    if (!parsed || parsed.version !== 3 || !parsed.organization || !Array.isArray(parsed.rawOperations)) {
      return null;
    }
    return parsed as PersistedAccountantState;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedAccountantState): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedState(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function openAccountantDb(): Promise<IDBDatabase | null> {
  if (!isBrowser() || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS);
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveUploadedImageToIdb(dataUrl: string | null): Promise<void> {
  const db = await openAccountantDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      const store = tx.objectStore(STORE_ASSETS);
      if (dataUrl) {
        store.put(dataUrl, UPLOADED_IMAGE_KEY);
      } else {
        store.delete(UPLOADED_IMAGE_KEY);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadUploadedImageFromIdb(): Promise<string | null> {
  const db = await openAccountantDb();
  if (!db) return null;

  return new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const store = tx.objectStore(STORE_ASSETS);
      const req = store.get(UPLOADED_IMAGE_KEY);
      req.onsuccess = () => {
        const val = typeof req.result === 'string' ? req.result : null;
        db.close();
        resolve(val);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function saveBackupSnapshotToIdb(
  id: string,
  label: string,
  state: PersistedAccountantState
): Promise<void> {
  const db = await openAccountantDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const record: BackupSnapshotRecord = {
        id,
        label,
        savedAt: new Date().toISOString(),
        state,
      };
      store.put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function listBackupSnapshotsFromIdb(): Promise<BackupSnapshotRecord[]> {
  const db = await openAccountantDb();
  if (!db) return [];

  return new Promise<BackupSnapshotRecord[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? (req.result as BackupSnapshotRecord[]) : [];
        items.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
        db.close();
        resolve(items);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}
