// 额度分配算法验证：完整一天调度模拟 + 失败重试计数

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/fixtures.ts';
import { QuotaManager, type RunPriority } from '../src/kaitorix/quota.ts';
import { KaitoriXClient, KaitoriXError } from '../src/kaitorix/client.ts';
import { loadSettings } from '../src/config/load.ts';

const settings = loadSettings();
const JANS = ['4549995734546', '4549995734591', '4549995734645', '4549995734690'];
const DAY_PLAN: [number, string, RunPriority][] = [
  [9, '09:07', 'critical'],
  [12, '12:07', 'normal'],
  [15, '15:07', 'normal'],
  [17, '17:07', 'high'],
  [20, '20:07', 'normal'],
  [23, '23:07', 'normal'],
];

/** 按 run.ts 的真实逻辑模拟一天：普通轮次整轮预检（下午报前预留 4 次），报告轮次只受耗尽限制 */
async function simulateDay(
  extraCalls: Record<string, number> = {},
): Promise<{ fetched: number; skipped: string[]; used: number }> {
  const db = await createTestDb();
  const q = new QuotaManager(db, settings);
  const today = '2026-10-12';
  let fetched = 0;
  const skipped: string[] = [];
  for (const [hour, label, priority] of DAY_PLAN) {
    const decision = await q.canFetch(JANS.length, priority, today, hour);
    if (!decision.allowed) {
      skipped.push(`${label}/*`);
      continue;
    }
    for (const jan of JANS) {
      if ((await q.remaining(today)) < 1) {
        skipped.push(`${label}/${jan}`);
        continue;
      }
      await q.recordCall(jan, today);
      fetched++;
    }
    // 模拟该轮发生的额外请求（失败重试，每次重试都消耗服务器端额度）
    const extra = extraCalls[label] ?? 0;
    if (extra > 0) await q.recordCalls(JANS[0], extra, today);
  }
  return { fetched, skipped, used: await q.usedToday(today) };
}

test('完整一天：6 轮 × 4 JAN = 24 次全部完成，剩余 6 次余量', async () => {
  const r = await simulateDay();
  assert.equal(r.fetched, 24);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.used, 24);
});

test('注入 4 次重试消耗：24+4=28 次，全部轮次仍然完成', async () => {
  const r = await simulateDay({ '12:07': 2, '20:07': 2 });
  assert.equal(r.fetched, 24, '重试不得导致轮次被跳过');
  assert.deepEqual(r.skipped, []);
  assert.equal(r.used, 28);
});

test('注入 6 次重试消耗：24+6=30 次，全部轮次仍然完成（恰好用尽限额但不漏轮）', async () => {
  const r = await simulateDay({ '09:07': 1, '12:07': 1, '15:07': 1, '17:07': 1, '20:07': 2 });
  assert.equal(r.fetched, 24);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.used, 30);
});

test('注入 10 次重试：仅最后一轮普通运行被跳过，早晚报告轮次不受影响', async () => {
  const r = await simulateDay({ '09:07': 2, '12:07': 2, '15:07': 2, '17:07': 2, '20:07': 2 });
  assert.equal(r.fetched, 20, '前 5 轮（含 09:07 早报、17:07 下午报）全部完成');
  assert.deepEqual(r.skipped, ['23:07/*'], '仅 23:07 整轮被跳过（不部分跳过）');
  assert.equal(r.used, 30, '20 次采集 + 10 次重试 = 恰好用尽当日限额');
});

test('报告轮次不受预留限制；真正耗尽时所有轮次跳过', async () => {
  const db = await createTestDb();
  const q = new QuotaManager(db, settings);
  const today = '2026-10-12';
  for (let i = 0; i < 29; i++) await q.recordCall('x', today);
  assert.equal((await q.canFetch(1, 'critical', today, 9)).allowed, true, '早间报告仅受真正耗尽限制');
  assert.equal((await q.canFetch(1, 'high', today, 17)).allowed, true, '下午报告仅受真正耗尽限制');
  assert.equal((await q.canFetch(1, 'normal', today, 12)).allowed, false, '下午报前的普通运行需保留 4 次');
  await q.recordCall('x', today); // 真正耗尽
  assert.equal((await q.canFetch(1, 'critical', today, 9)).allowed, false);
  assert.match((await q.canFetch(1, 'critical', today, 9)).reason!, /额度不足/);
});

test('客户端 attempts：成功重试与失败 attempt 都计入返回值', async () => {
  let n = 0;
  const flaky = (async () => {
    n++;
    if (n < 3) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ jan: 'x', name: 'x', max_price: 1, prices: [] }), { status: 200 });
  }) as typeof fetch;
  const client = new KaitoriXClient({ apiKey: 'k', tpsMs: 0, fetchImpl: flaky, sleepImpl: async () => {} });
  const res = await client.getProduct('1111111');
  assert.equal(res.attempts, 3, '3 次尝试（2 次 503 + 1 次成功）');

  const unauthorized = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  const c2 = new KaitoriXClient({ apiKey: 'k', tpsMs: 0, fetchImpl: unauthorized, sleepImpl: async () => {} });
  await assert.rejects(
    () => c2.getProduct('1111111'),
    (e: KaitoriXError) => {
      assert.equal(e.attempts, 1, '4xx 不重试，attempts=1');
      assert.equal(e.kind, 'auth');
      return true;
    },
  );
});

test('额度按 attempts 累计：一次成功调用（3 次尝试）计 3 次', async () => {
  const db = await createTestDb();
  const q = new QuotaManager(db, settings);
  const today = '2026-10-12';
  await q.recordCalls('4549995734546', 3, today);
  assert.equal(await q.usedToday(today), 3);
  const rows = await db.query<{ count: number }>('SELECT count FROM api_usage WHERE jan = ?', ['4549995734546']);
  assert.equal(rows[0].count, 3);
});
