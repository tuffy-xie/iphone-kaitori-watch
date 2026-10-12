// 数据库迁移 runner + Db 工厂

import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../types.ts';
import { D1RestDb } from './d1.ts';
import { SqliteDb } from './sqlite.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export async function runMigrations(db: Db, dir: string = MIGRATIONS_DIR): Promise<{ applied: string[] }> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     );`,
  );
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const out: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    await db.exec(readFileSync(join(dir, f), 'utf8'));
    await db.run('INSERT INTO _migrations (name) VALUES (?)', [f]);
    out.push(f);
  }
  return { applied: out };
}

/** 根据环境变量选择 D1（远端）或本地 SQLite */
export function createDb(env: NodeJS.ProcessEnv = process.env): { db: Db; kind: 'd1' | 'sqlite'; detail: string } {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = env.D1_DATABASE_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (accountId && databaseId && apiToken) {
    return {
      db: new D1RestDb({ accountId, databaseId, apiToken }),
      kind: 'd1',
      detail: `D1 database=${databaseId}`,
    };
  }
  const path = env.LOCAL_DB_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'local.db');
  mkdirSync(dirname(path), { recursive: true });
  return { db: new SqliteDb(path), kind: 'sqlite', detail: path };
}
