// 本地 SQLite 实现（node:sqlite，零依赖）—— 本地开发 / 测试 / 未配置 D1 时使用

import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../types.ts';

export class SqliteDb implements Db {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as never[])) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const stmt = this.db.prepare(sql);
    const r = stmt.run(...(params as never[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
