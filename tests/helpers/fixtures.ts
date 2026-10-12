// 测试公共工具：内存 SQLite + 迁移 + Mock 响应构造

import { SqliteDb } from '../../src/db/sqlite.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import type { Db } from '../../src/types.ts';
import type { RawPrice, RawProductResponse } from '../../src/kaitorix/client.ts';

export async function createTestDb(): Promise<Db> {
  const db = new SqliteDb(':memory:');
  const { applied } = await runMigrations(db);
  if (applied.length === 0) throw new Error('迁移未应用');
  return db;
}

let seq = 0;

/** 构造一个買取X 风格的响应（字段与官方文档一致） */
export function buildPayload(args: {
  jan: string;
  name: string;
  shops: { store: string; key: string; price: number | null; stopped?: boolean; stale?: boolean; markNote?: string | null; minutesAgo?: number }[];
  now?: Date;
}): RawProductResponse {
  const now = args.now ?? new Date();
  return {
    jan: args.jan,
    name: args.name,
    max_price: Math.max(0, ...args.shops.map((s) => s.price ?? 0)),
    prices: args.shops.map((s): RawPrice => {
      const minutesAgo = s.minutesAgo ?? 5;
      const d = new Date(now.getTime() - minutesAgo * 60000);
      const jst = new Date(d.getTime() + 9 * 3600 * 1000);
      return {
        store: s.store,
        key: s.key,
        price: s.price,
        url: `https://kaitorix.app/search?q=${args.jan}`,
        updated: `${minutesAgo}分前`,
        updated_at: jst.toISOString().replace('Z', '+09:00').replace('.000', ''),
        stale: s.stale ?? false,
        stopped: s.stopped ?? false,
        mark_note: s.markNote ?? null,
        walkin_bonus: null,
      };
    }),
  };
}

/** 返回可变价格 Mock 的 fetch（用于模拟两次运行之间价格变化） */
export function createVariablePriceFetch(prices: Record<string, number>): typeof fetch {
  seq++;
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/open\/api\/product\/([^/?]+)/.exec(url);
    const jan = m ? decodeURIComponent(m[1]) : '';
    const base = prices[jan] ?? 220000;
    const names: Record<string, string> = {
      '4549995734546': 'iPhone 18 Pro Max 256GB ブラック MJX54J/A 未開封 SIMフリー',
      '4549995734591': 'iPhone 18 Pro Max 256GB シルバー MJX64J/A 未開封 SIMフリー',
      '4549995734645': 'iPhone 18 Pro Max 256GB バーガンディ MJX74J/A 未開封 SIMフリー',
      '4549995734690': 'iPhone 18 Pro Max 256GB グレイシャー MJX84J/A 未開封 SIMフリー',
    };
    const body = buildPayload({
      jan,
      name: names[jan] ?? `Mock ${jan}`,
      shops: [
        { store: '買取ソムリエ', key: 'sommelier', price: base },
        { store: '買取一丁目', key: 'ichoume', price: base - 3000 },
        { store: '買取商店', key: 'shouten', price: base - 1500 },
        { store: '停止店', key: 'stopshop', price: base - 8000, stopped: true },
        { store: '陈旧店', key: 'staleshop', price: base - 7000, stale: true },
      ],
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': '25',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000)),
      },
    });
  }) as typeof fetch;
}

/** 捕获 console.log 输出 */
export async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return logs.join('\n');
}
