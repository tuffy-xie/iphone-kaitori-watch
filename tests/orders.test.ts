// 验收8/17：多订单管理 + API 额度管理

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/fixtures.ts';
import * as repo from '../src/db/repo.ts';
import { QuotaManager } from '../src/kaitorix/quota.ts';
import { loadSettings } from '../src/config/load.ts';

const settings = loadSettings();

test('订单 upsert 与持有列表（多订单、多状态）', async () => {
  const db = await createTestDb();
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-BLK-01', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-04', status: 'holding',
  });
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-SLV-01', jan: '4549995734591', quantity: 2, unitPrice: 239800, card: 'ana',
    receivedDate: '2026-10-05', status: 'received',
  });
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-GLC-01', jan: '4549995734690', quantity: 1, unitPrice: 239800, card: 'epos',
    status: 'sold', soldPrice: 242000,
  });
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-BRG-01', jan: '4549995734645', quantity: 1, unitPrice: 239800, card: 'ana',
    status: 'refunded',
  });

  const all = await repo.listOrders(db);
  assert.equal(all.length, 4);
  const held = await repo.listHeldOrders(db);
  assert.equal(held.length, 2);
  assert.deepEqual(held.map((o) => o.orderRef).sort(), ['IP18PM-BLK-01', 'IP18PM-SLV-01']);
  const one = await repo.getOrderByRef(db, 'IP18PM-SLV-01');
  assert.equal(one!.quantity, 2);
  assert.equal(one!.card, 'ana');

  // 同一 orderRef 再次 upsert = 更新而非新增
  await repo.upsertOrder(db, {
    orderRef: 'IP18PM-BLK-01', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'ana',
    receivedDate: '2026-10-04', returnDeadlineConfirmed: '2026-10-20', status: 'holding',
  });
  const after = await repo.listOrders(db);
  assert.equal(after.length, 4);
  const updated = await repo.getOrderByRef(db, 'IP18PM-BLK-01');
  assert.equal(updated!.card, 'ana');
  assert.equal(updated!.returnDeadlineConfirmed, '2026-10-20');
});

test('额度管理：30/日；下午报前的普通轮次整轮预留 4 次，之后不再预留', async () => {
  const db = await createTestDb();
  const q = new QuotaManager(db, settings);
  const today = '2026-10-12';

  assert.equal(await q.remaining(today), 30);
  // 普通运行整轮预检（小时 10，下午报之前）：rem - 4 >= 4 才允许
  assert.deepEqual(await q.canFetch(4, 'normal', today, 10), { allowed: true, remaining: 30 });
  // 早/晚报轮次不受预留限制
  assert.deepEqual(await q.canFetch(4, 'critical', today, 9), { allowed: true, remaining: 30 });

  for (let i = 0; i < 22; i++) await q.recordCall('4549995734546', today);
  assert.equal(await q.remaining(today), 8);
  // 剩 8 次（下午报前）：8-4=4 >= 4 → 普通轮次仍可整轮执行
  assert.equal((await q.canFetch(4, 'normal', today, 15)).allowed, true);

  for (let i = 0; i < 2; i++) await q.recordCall('4549995734546', today);
  assert.equal(await q.remaining(today), 6);
  // 剩 6 次（下午报前）：6-4=2 < 4 → 普通轮次整轮跳过（不部分跳过）
  const d1 = await q.canFetch(4, 'normal', today, 15);
  assert.equal(d1.allowed, false);
  assert.match(d1.reason!, /额度保护/);
  // 报告轮次不受预留限制
  assert.equal((await q.canFetch(4, 'high', today, 17)).allowed, true);
  // 下午报之后（小时 20）：无需再预留，6-4=2 >= 0 → 允许
  assert.equal((await q.canFetch(4, 'normal', today, 20)).allowed, true);

  for (let i = 0; i < 6; i++) await q.recordCall('4549995734546', today);
  assert.equal(await q.remaining(today), 0);
  const d2 = await q.canFetch(1, 'critical', today, 9);
  assert.equal(d2.allowed, false);
  assert.match(d2.reason!, /额度不足/);
});

test('额度管理：响应头 Remaining=0 时以权威值标记耗尽；>0 时不动本地计数', async () => {
  const db = await createTestDb();
  const q = new QuotaManager(db, settings);
  const today = '2026-10-12';
  for (let i = 0; i < 20; i++) await q.recordCall('4549995734546', today);
  // 头部显示还有 5 次 → 不下调也不上调（本地 20 是安全下界）
  await q.syncFromHeader(30, 5, today);
  assert.equal(await q.usedToday(today), 20);
  // 头部显示 0 次 → 以权威值标记耗尽
  await q.syncFromHeader(30, 0, today);
  assert.equal(await q.usedToday(today), 30);
  assert.equal(await q.remaining(today), 0);
});

test('同一 JAN 每次运行只查一次（由监控流程保证，这里验证存储唯一快照）', async () => {
  const db = await createTestDb();
  await repo.insertSnapshot(db, { runId: 'r1', jan: '4549995734546', fetchedAt: '2026-10-12T00:07:00.000+09:00', payload: { jan: '4549995734546' } });
  const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM quote_snapshots WHERE jan = ?', ['4549995734546']);
  assert.equal(rows[0].n, 1);
});
