// 验收12：重复通知过滤

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, captureLogs } from './helpers/fixtures.ts';
import { Notifier } from '../src/notify/dedupe.ts';

test('同一事件只推送一次；不同事件分别推送', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, false);

  assert.equal(await notifier.sendOnce('evt-a', '消息A'), true);
  assert.equal(await notifier.sendOnce('evt-a', '消息A'), false, '第二次应被去重');
  assert.equal(await notifier.sendOnce('evt-b', '消息B'), true);

  const rows = await db.query<{ event_key: string }>('SELECT event_key FROM notifications ORDER BY event_key');
  assert.deepEqual(rows.map((r) => r.event_key), ['evt-a', 'evt-b']);
});

test('DRY_RUN 模式不写入去重状态，可反复演练', async () => {
  const db = await createTestDb();
  const notifier = new Notifier(db, null, true);
  const out = await captureLogs(async () => {
    assert.equal(await notifier.sendOnce('evt-a', '消息A'), true);
    assert.equal(await notifier.sendOnce('evt-a', '消息A'), true);
  });
  assert.match(out, /DRY_RUN/);
  assert.match(out, /evt-a/);
  const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM notifications');
  assert.equal(rows[0].n, 0);
});
