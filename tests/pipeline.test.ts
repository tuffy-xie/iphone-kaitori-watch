// 端到端：Mock 采集 → 存储 → 分析 → 预警 → 日报 → 退货提醒 → 清理 → API 故障降级

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createVariablePriceFetch, captureLogs } from './helpers/fixtures.ts';
import { runMonitor } from '../src/monitor/run.ts';
import { sendReturnReminders } from '../src/monitor/reminder.ts';
import { runCleanupIfDue } from '../src/monitor/cleanup.ts';
import { Notifier } from '../src/notify/dedupe.ts';
import { KaitoriXClient } from '../src/kaitorix/client.ts';
import * as repo from '../src/db/repo.ts';
import { loadSettings, loadProductsFile, loadCardsFile } from '../src/config/load.ts';

const settings = loadSettings();
const { products } = loadProductsFile();
const { cards } = loadCardsFile();

/** JST 09:07 */
const NOW_MORNING = new Date('2026-10-12T00:07:00Z');
/** JST 12:07 */
const NOW_NOON = new Date('2026-10-12T03:07:00Z');

function makeClient(prices: Record<string, number>): KaitoriXClient {
  return new KaitoriXClient({
    apiKey: 'test-key',
    tpsMs: 0,
    fetchImpl: createVariablePriceFetch(prices),
    sleepImpl: async () => {},
  });
}

test('端到端：早间监控全流程（Mock 数据）', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-BLK-01', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-04', status: 'holding', fees: { shipping: 0, transport: 0, handling: 0 },
  });
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-GLC-01', jan: '4549995734690', quantity: 1, unitPrice: 239800, card: 'ana',
    receivedDate: '2026-10-05', returnDeadlineConfirmed: '2026-10-19', status: 'holding', fees: { shipping: 0, transport: 0, handling: 0 },
  });

  const prices = {
    '4549995734546': 231000,
    '4549995734591': 238800,
    '4549995734645': 233000,
    '4549995734690': 241000,
  };

  const out = await captureLogs(async () => {
    const r = await runMonitor(
      { db, settings, products, cards, client: makeClient(prices), notifier, now: NOW_MORNING, trigger: 'test' },
      { reportType: 'morning' },
    );
    assert.equal(r.reportType, 'morning');
    assert.equal(r.fetched.length, 4);
    assert.equal(r.failed.length, 0);
    assert.equal(r.skipped.length, 0);
    assert.equal(r.reportSent, true);
  });

  // --- 持久化 ---
  const latest = await repo.getLatestValidQuotes(db, '4549995734546');
  assert.ok(latest);
  assert.equal(latest!.quotes[0].price, 231000);
  assert.equal(latest!.quotes.length, 3, 'stopped/stale 不计入有效报价');
  const allQuotes = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM quotes');
  assert.equal(allQuotes[0].n, 20, '4 JAN × 5 店全部落库（含 stopped/stale 标记）');
  const snaps = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM quote_snapshots');
  assert.equal(snaps[0].n, 4, '每个 JAN 一份原始快照');
  const daily = await repo.getDailyBest(db, '2026-10-12', '4549995734546');
  assert.equal(daily!.best_price, 231000);
  assert.equal(daily!.morning_price, 231000, '当天首跑记录早间价');
  const used = await db.query<{ count: number }>('SELECT count FROM api_usage_daily WHERE date = ?', ['2026-10-12']);
  assert.equal(used[0].count, 4, '额度按 JAN 计数');
  const runlog = await db.query<{ status: string }>('SELECT status FROM run_log');
  assert.equal(runlog[0].status, 'ok');

  // --- 日报与预警内容 ---
  assert.match(out, /早间报告/);
  assert.match(out, /⚫ 黑色 ¥231,000（買取ソムリエ）/);
  assert.match(out, /毛差 -¥8,800｜净利 -¥8,800｜积分估值 \+¥1,199｜综合 -¥7,601｜实际确认 -¥8,800/);
  assert.match(out, /⏳ 退货倒计时/);
  assert.match(out, /IP18PM-BLK-01/);
  assert.match(out, /截止 10月18日（估算）/);
  assert.match(out, /IP18PM-GLC-01/);
  assert.match(out, /截止 10月19日（官方）/);
  // 冰川色 241000 ≥ 239800 → 首次现金回本预警
  assert.match(out, /🎉 首次现金回本/);
  // 7 天阈值退货提醒（黑色剩 6 天、冰川剩 7 天）
  assert.match(out, /退货倒计时提醒/);
  assert.ok(!out.includes('NaN'));
});

test('报价变化超过 2000 日元触发异动预警；普通运行不发日报', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-BLK-01', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-04', status: 'holding', fees: { shipping: 0, transport: 0, handling: 0 },
  });
  const prices1 = { '4549995734546': 231000, '4549995734591': 238800, '4549995734645': 233000, '4549995734690': 241000 };
  await captureLogs(async () => {
    await runMonitor({ db, settings, products, cards, client: makeClient(prices1), notifier, now: NOW_MORNING }, { reportType: 'morning' });
  });

  // 第二次运行：黑色 +3500
  const prices2 = { ...prices1, '4549995734546': 234500 };
  const out2 = await captureLogs(async () => {
    const r = await runMonitor({ db, settings, products, cards, client: makeClient(prices2), notifier, now: NOW_NOON }, { reportType: 'normal' });
    assert.equal(r.reportSent, false, '普通运行不发日报');
    assert.ok(r.alertsSent >= 1);
  });
  assert.match(out2, /🚨 报价异动 📈/);
  assert.match(out2, /\+¥3,500/);
  // 日报不重复推送
  const notif = await db.query<{ event_key: string }>('SELECT event_key FROM notifications WHERE event_key LIKE ?', ['report-%']);
  assert.equal(notif.length, 1);
});

test('API 日额度耗尽：记录失败、跳过其余 JAN、继续用库中报价判断，退货提醒不依赖 API', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-BLK-01', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-04', status: 'holding', fees: { shipping: 0, transport: 0, handling: 0 },
  });
  // 先跑一次成功采集
  const prices = { '4549995734546': 231000, '4549995734591': 238800, '4549995734645': 233000, '4549995734690': 241000 };
  await captureLogs(async () => {
    await runMonitor({ db, settings, products, cards, client: makeClient(prices), notifier, now: NOW_MORNING }, { reportType: 'morning' });
  });

  // 日额度耗尽的 fetch
  const exhaustedFetch = (async () =>
    new Response(JSON.stringify({ error: 'daily limit exceeded' }), {
      status: 429,
      headers: { 'retry-after': '3600', 'x-ratelimit-remaining': '0' },
    })) as typeof fetch;
  const client = new KaitoriXClient({ apiKey: 'k', tpsMs: 0, fetchImpl: exhaustedFetch, sleepImpl: async () => {} });

  const out = await captureLogs(async () => {
    const r = await runMonitor({ db, settings, products, cards, client, notifier, now: NOW_NOON }, { reportType: 'normal' });
    assert.equal(r.fetched.length, 0);
    assert.equal(r.failed.length, 1, '第一个 JAN 失败即判定日额度耗尽');
    assert.equal(r.skipped.length, 3, '其余 JAN 全部跳过');
  });
  assert.match(out, /报价采集失败/);
  assert.match(out, /每日请求额度已耗尽/);

  // 退货提醒独立运行（不调用任何 API）
  const out2 = await captureLogs(async () => {
    const sent = await sendReturnReminders({ db, settings, products, notifier, now: NOW_NOON });
    assert.ok(sent >= 0);
  });
  assert.doesNotMatch(out2, /报价采集失败/);
});

test('29 天原始数据自动清理；每日聚合保留', async () => {
  const db = await createTestDb();
  const oldIso = '2026-09-10T00:07:00.000+09:00'; // 32 天前
  const recentIso = '2026-10-10T00:07:00.000+09:00'; // 2 天前
  for (const iso of [oldIso, recentIso]) {
    await repo.insertSnapshot(db, { runId: 'r', jan: '4549995734546', fetchedAt: iso, payload: { jan: '4549995734546' } });
    await db.run(
      `INSERT INTO quotes (run_id, jan, fetched_at, shop_key, shop_name, price, stale, stopped, is_ichimonme)
       VALUES ('r', '4549995734546', ?, 'sommelier', '買取ソムリエ', 231000, 0, 0, 0)`,
      [iso],
    );
  }
  await repo.upsertDailyBest(db, {
    date: '2026-09-10', jan: '4549995734546', bestPrice: 220000, bestShop: 'X', bestShopKey: 'x', morningPrice: 220000, shopCount: 3,
  });
  await repo.setState(db, 'last_cleanup_date', '2026-10-11');

  // JST 23:30 运行
  const r = await runCleanupIfDue(db, settings, new Date('2026-10-12T14:30:00Z'));
  assert.equal(r.ran, true);
  assert.ok(r.deleted >= 2, '删除 30 天前的快照与报价');

  const oldLeft = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM quotes WHERE fetched_at < '2026-09-13'");
  assert.equal(oldLeft[0].n, 0);
  const recentLeft = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM quotes WHERE fetched_at >= '2026-09-13'");
  assert.equal(recentLeft[0].n, 1);
  const dailyLeft = await repo.getDailyBest(db, '2026-09-10', '4549995734546');
  assert.ok(dailyLeft, '每日聚合不删除');

  // 同日第二次运行不重复清理（仍在 JST 23:45）
  const r2 = await runCleanupIfDue(db, settings, new Date('2026-10-12T14:45:00Z'));
  assert.equal(r2.ran, false);
});

test('mock 模式下 runMonitor 也能只读库中数据出报告（无 client）', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  const prices = { '4549995734546': 231000, '4549995734591': 238800, '4549995734645': 233000, '4549995734690': 241000 };
  await captureLogs(async () => {
    await runMonitor({ db, settings, products, cards, client: makeClient(prices), notifier, now: NOW_MORNING }, { reportType: 'morning' });
  });
  const out = await captureLogs(async () => {
    const r = await runMonitor({ db, settings, products, cards, client: null, notifier, now: NOW_NOON }, { reportType: 'afternoon' });
    assert.equal(r.fetched.length, 0);
    assert.equal(r.reportSent, true);
  });
  assert.match(out, /下午报告/);
  assert.match(out, /⚫ 黑色 ¥231,000（買取ソムリエ）/, '使用库中最近有效报价');
});
