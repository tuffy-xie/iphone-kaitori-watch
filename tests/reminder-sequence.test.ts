// 退货提醒序列验证：7/3/2/1/0 阈值 + 最后 3 天每日提醒，不重不漏；API 无关

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, captureLogs } from './helpers/fixtures.ts';
import * as repo from '../src/db/repo.ts';
import { Notifier } from '../src/notify/dedupe.ts';
import { sendReturnReminders } from '../src/monitor/reminder.ts';
import { loadSettings, loadProductsFile } from '../src/config/load.ts';

const settings = loadSettings();
const { products } = loadProductsFile();

async function sentKeysOn(db: Awaited<ReturnType<typeof createTestDb>>, notifier: Notifier, date: string): Promise<string[]> {
  const before = new Set((await db.query<{ event_key: string }>('SELECT event_key FROM notifications')).map((r) => r.event_key));
  await captureLogs(async () => {
    await sendReturnReminders({ db, settings, products, notifier, now: new Date(`${date}T10:00:00+09:00`) });
  });
  const after = await db.query<{ event_key: string }>('SELECT event_key FROM notifications');
  return after.map((r) => r.event_key).filter((k) => !before.has(k));
}

test('多日序列：7/3/2/1/0 阈值各触发一次，最后 3 天每日提醒，截止后仍每日提醒', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  // 2026-10-01 收货 → 估算截止 2026-10-15
  await repo.upsertOrder(db, {
    orderRef: 'SEQ-01', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-01', status: 'holding',
  });

  const expected: Record<string, string[]> = {
    '2026-10-07': [],                                // 剩 8 天
    '2026-10-08': ['return-d7-SEQ-01'],              // 剩 7 天 → 7 天阈值
    '2026-10-09': [],
    '2026-10-10': [],
    '2026-10-11': [],
    '2026-10-12': ['return-d3-SEQ-01', 'return-daily-SEQ-01-2026-10-12'], // 剩 3 天
    '2026-10-13': ['return-d2-SEQ-01', 'return-daily-SEQ-01-2026-10-13'],
    '2026-10-14': ['return-d1-SEQ-01', 'return-daily-SEQ-01-2026-10-14'],
    '2026-10-15': ['return-d0-SEQ-01', 'return-daily-SEQ-01-2026-10-15'], // 截止当天
    '2026-10-16': ['return-daily-SEQ-01-2026-10-16'], // 已过期仍持有 → 继续每日提醒
    '2026-10-17': ['return-daily-SEQ-01-2026-10-17'],
  };

  for (const [date, keys] of Object.entries(expected)) {
    const sent = await sentKeysOn(db, notifier, date);
    assert.deepEqual(sent, keys, `${date} 的提醒集合不正确（剩 ${15 - Number(date.slice(8))} 天）`);
  }
});

test('官方确认截止日优先，且阈值按官方日期计算', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  // 收货 10-01（估算 10-15），但官方确认 10-20 → 以 10-20 为准
  await repo.upsertOrder(db, {
    orderRef: 'SEQ-02', jan: '4549995734591', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-01', returnDeadlineConfirmed: '2026-10-20', status: 'holding',
  });
  // 10-13：按官方日期剩 7 天 → d7 触发；按估算只剩 2 天（会误触 d2/daily）
  const sent = await sentKeysOn(db, notifier, '2026-10-13');
  assert.deepEqual(sent, ['return-d7-SEQ-02'], '必须使用官方确认日期，不得使用估算日期');
});

test('同日重复运行（监控 + 独立提醒工作流）不重复发送', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  await repo.upsertOrder(db, {
    orderRef: 'SEQ-03', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-05', status: 'holding', // 截止 10-19，10-12 剩 7 天 → d7
  });
  const first = await sentKeysOn(db, notifier, '2026-10-12');
  assert.deepEqual(first, ['return-d7-SEQ-03']);
  // 同一天再跑一次（模拟另一个工作流）
  const second = await sentKeysOn(db, notifier, '2026-10-12');
  assert.deepEqual(second, [], '同日第二次运行不得重复发送');
});

test('API 完全不可用时，退货提醒仍独立工作（不调用任何 API）', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  await repo.upsertOrder(db, {
    orderRef: 'SEQ-04', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-13', status: 'holding', // 截止 10-27，10-20 剩 7 天
  });
  // sendReturnReminders 不接收 client 参数，天然与買取X API 解耦
  const out = await captureLogs(async () => {
    const sent = await sendReturnReminders({ db, settings, products, notifier, now: new Date('2026-10-20T10:00:00+09:00') });
    assert.equal(sent, 1);
  });
  assert.match(out, /退货倒计时提醒/);
  assert.match(out, /申请截止：10月27日（估算）/);
  assert.match(out, /建议最迟申请：10月26日/);
});

test('已出售/已退款的订单不再提醒', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);
  await repo.upsertOrder(db, {
    orderRef: 'SEQ-05', jan: '4549995734546', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-13', status: 'sold', soldPrice: 245000,
  });
  await repo.upsertOrder(db, {
    orderRef: 'SEQ-06', jan: '4549995734591', quantity: 1, unitPrice: 239800, card: 'epos',
    receivedDate: '2026-10-13', status: 'refunded',
  });
  const sent = await sentKeysOn(db, notifier, '2026-10-20');
  assert.deepEqual(sent, []);
});
