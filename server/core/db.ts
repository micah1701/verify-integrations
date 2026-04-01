import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(process.env.DATABASE_PATH ?? './data/tokens.json');

export interface StoreToken {
  store_hash: string;
  access_token: string;
  scope: string;
  installed_at: number;
  updated_at: number;
}

type TokenStore = Record<string, StoreToken>;

function read(): TokenStore {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as TokenStore;
  } catch {
    return {};
  }
}

function write(store: TokenStore): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Atomic write: write to a temp file then rename
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_PATH);
}

// Upsert — handles both first install and re-install
export function upsertToken(record: Omit<StoreToken, 'installed_at' | 'updated_at'>): void {
  const store = read();
  const now = Date.now();
  store[record.store_hash] = {
    ...record,
    installed_at: store[record.store_hash]?.installed_at ?? now,
    updated_at: now,
  };
  write(store);
}

export function getToken(storeHash: string): StoreToken | undefined {
  return read()[storeHash];
}

export function deleteToken(storeHash: string): void {
  const store = read();
  delete store[storeHash];
  write(store);
}
