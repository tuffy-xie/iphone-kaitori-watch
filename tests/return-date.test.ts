// 验收9/10：退货截止日计算（实际截止优先于估算）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDeadline, returnCountdown, dueReminderThresholds, formatDeadlineLabel } from '../src/orders/return.ts';
import { addDays, daysBetween, todayJst } from '../src/util/time.ts';
import { loadSettings } from '../src/config/load.ts';
import type { OrderRecord } from '../src/types.ts';

const settings = loadSettings();

function order(over: Partial<OrderRecord>): OrderRecord {
  return {
    id: 1,
    orderRef: 'T-01',
    jan: '4549995734546',
    quantity: 1,
    unitPrice: 239800,
    card: 'epos',
    status: 'holding',
    confirmedDiscount: 0,
    created_at: '',
    updated_at: '',
    ...over,
  } as OrderRecord;
}

test('测试订单算例：10/04 收货 → 估算截止 10/18，建议最迟 10/17', () => {
  const o = order({ receivedDate: '2026-10-04' });
  const d = effectiveDeadline(o, settings);
  assert.deepEqual(d, { date: '2026-10-18', estimated: true, source: 'estimated' });
  const cd = returnCountdown(o, settings, '2026-10-12');
  assert.equal(cd.daysLeft, 6);
  assert.equal(cd.suggestApplyDate, '2026-10-17');
  assert.equal(cd.applyDaysLeft, 5);
  assert.match(formatDeadlineLabel(d!), /估算/);
});

test('官方确认截止日期优先于估算日期', () => {
  const o = order({ receivedDate: '2026-10-04', returnDeadlineConfirmed: '2026-10-20' });
  const d = effectiveDeadline(o, settings);
  assert.deepEqual(d, { date: '2026-10-20', estimated: false, source: 'confirmed' });
  assert.match(formatDeadlineLabel(d!), /官方确认/);
});

test('无收货日期且无官方日期时无法计算', () => {
  const o = order({});
  assert.equal(effectiveDeadline(o, settings), null);
  const cd = returnCountdown(o, settings, '2026-10-12');
  assert.equal(cd.daysLeft, null);
});

test('申请截止与寄出截止分开跟踪', () => {
  const o = order({ receivedDate: '2026-10-04', returnDeadlineConfirmed: '2026-10-18', returnShipDeadline: '2026-11-01', status: 'return_requested' });
  const cd = returnCountdown(o, settings, '2026-10-12');
  assert.equal(cd.daysLeft, 6);
  assert.equal(cd.shipDaysLeft, 20);
});

test('提醒阈值：剩余 7/3/2/1/0 天触发；>7 天不触发', () => {
  assert.deepEqual(dueReminderThresholds(10, [7, 3, 2, 1, 0]), []);
  assert.deepEqual(dueReminderThresholds(7, [7, 3, 2, 1, 0]), [7]);
  assert.deepEqual(dueReminderThresholds(3, [7, 3, 2, 1, 0]), [3, 7]);
  assert.deepEqual(dueReminderThresholds(0, [7, 3, 2, 1, 0]), [0, 1, 2, 3, 7]);
  assert.deepEqual(dueReminderThresholds(null, [7, 3, 2, 1, 0]), []);
});

test('日期工具：加减天数与间隔', () => {
  assert.equal(addDays('2026-10-04', 14), '2026-10-18');
  assert.equal(addDays('2026-10-18', -1), '2026-10-17');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-10-04', '2026-10-18'), 14);
  assert.equal(daysBetween('2026-10-18', '2026-10-12'), -6);
  assert.equal(todayJst(new Date('2026-10-12T00:30:00+09:00')), '2026-10-12');
  assert.equal(todayJst(new Date('2026-10-11T20:00:00+09:00')), '2026-10-11');
});
