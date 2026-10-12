// Cloudflare D1 REST 客户端（无需 wrangler，GitHub Actions 直接调用）
// API: POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query

import type { Db } from '../types.ts';

interface D1QueryResponse {
  result?: { results?: Record<string, unknown>[]; success?: boolean; meta?: { changes?: number; last_row_id?: number } }[];
  success?: boolean;
  errors?: { message?: string }[];
}

export interface D1Options {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 按分号切分 SQL（剔除 -- 注释；本项目迁移文件不含字符串内分号） */
export function splitSql(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class D1RestDb implements Db {
  private readonly url: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(opts: D1Options) {
    if (!opts.accountId || !opts.databaseId || !opts.apiToken) {
      throw new Error('D1 配置不完整（需要 CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID / CLOUDFLARE_API_TOKEN）');
    }
    this.url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`;
    this.apiToken = opts.apiToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 4;
  }

  private async request(sql: string, params: unknown[]): Promise<D1QueryResponse> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params }),
        });
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after') ?? '2');
          await this.sleepImpl(Math.max(1000, ra * 1000));
          lastErr = new Error('D1 429 限流');
          continue;
        }
        if (res.status >= 500) {
          await this.sleepImpl(1500 * (attempt + 1));
          lastErr = new Error(`D1 HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as D1QueryResponse;
        if (data.success === false || (data.errors && data.errors.length > 0)) {
          throw new Error(`D1 错误: ${data.errors?.map((e) => e.message).join('; ') ?? 'unknown'}`);
        }
        return data;
      } catch (e) {
        lastErr = e as Error;
        if ((e as Error).message.startsWith('D1 错误')) throw e;
        await this.sleepImpl(1500 * (attempt + 1));
      }
    }
    throw lastErr ?? new Error('D1 请求失败');
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const data = await this.request(sql, params);
    return (data.result?.[0]?.results ?? []) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const data = await this.request(sql, params);
    const meta = data.result?.[0]?.meta;
    return { changes: Number(meta?.changes ?? 0), lastInsertRowid: Number(meta?.last_row_id ?? 0) };
  }

  async exec(sql: string): Promise<void> {
    for (const stmt of splitSql(sql)) {
      await this.request(stmt, []);
    }
  }
}
