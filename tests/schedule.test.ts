// 调度验证：cron 解析、时隙判定、迟到执行、漏执行自愈、手动执行

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/fixtures.ts';
import { parseCronHours, resolveScheduleSlot, scheduledJstHours, slotToReportType } from '../src/util/schedule.ts';
import { reportTypeForHour } from '../src/util/time.ts';
import { loadSettings } from '../src/config/load.ts';

const settings = loadSettings();
const CRON = '7 9,12,15,17,20,23 * * *';
const at = (date: string, h: number, m = 7): Date => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`);

test('cron 小时字段解析：列表 / 步进 / 区间', () => {
  assert.deepEqual(parseCronHours(CRON), [9, 12, 15, 17, 20, 23]);
  assert.deepEqual(parseCronHours('0 */5 * * *'), [0, 5, 10, 15, 20]);
  assert.deepEqual(parseCronHours('0 9-17 * * *'), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(parseCronHours('0 9 * * 1-5'), [9]);
  assert.deepEqual(parseCronHours('bad'), []);
});

test('时区换算：timezone=Asia/Tokyo 直接使用；UTC cron +9 换算', () => {
  assert.deepEqual(scheduledJstHours(CRON, false), [9, 12, 15, 17, 20, 23]);
  assert.deepEqual(scheduledJstHours('7 0,3,6,8,11,14 * * *', true), [9, 12, 15, 17, 20, 23]);
  assert.deepEqual(scheduledJstHours('7 0,3,6,8,11,14 * * *', false), [0, 3, 6, 8, 11, 14]);
});

test('时隙 → 报告类型映射（9=早间，17=下午，其余=普通）', () => {
  assert.equal(slotToReportType(9, settings), 'morning');
  assert.equal(slotToReportType(17, settings), 'afternoon');
  assert.equal(slotToReportType(12, settings), 'normal');
  assert.equal(slotToReportType(23, settings), 'normal');
});

test('正常一天：6 个时隙各处理一次，09:07/17:07 为完整报告', async () => {
  const db = await createTestDb();
  const expected: [number, string][] = [
    [9, 'morning'],
    [12, 'normal'],
    [15, 'normal'],
    [17, 'afternoon'],
    [20, 'normal'],
    [23, 'normal'],
  ];
  for (const [h, type] of expected) {
    const r = await resolveScheduleSlot(db, CRON, at('2026-10-12', h), false, settings);
    assert.equal(r.slot, h, `时隙 ${h} 应被处理`);
    assert.equal(r.type, type);
    assert.equal(r.recovered, false);
  }
  // 当天再次运行（含 23:30）→ 无剩余时隙，按普通运行
  const r = await resolveScheduleSlot(db, CRON, at('2026-10-12', 23, 30), false, settings);
  assert.equal(r.slot, null);
  assert.equal(r.type, 'normal');
});

test('迟到执行：09:07 延迟到 10:30 启动，仍按早间报告处理', async () => {
  const db = await createTestDb();
  const r = await resolveScheduleSlot(db, CRON, at('2026-10-12', 10, 30), false, settings);
  assert.equal(r.slot, 9);
  assert.equal(r.type, 'morning');
  assert.equal(r.recovered, false);
  // 随后 12:07 正常启动 → 时隙 12（不重复处理 9）
  const r2 = await resolveScheduleSlot(db, CRON, at('2026-10-12', 12, 7), false, settings);
  assert.equal(r2.slot, 12);
  assert.equal(r2.type, 'normal');
});

test('迟到执行：17:07 延迟到 18:40 启动，仍按下午报告处理', async () => {
  const db = await createTestDb();
  for (const h of [9, 12, 15]) await resolveScheduleSlot(db, CRON, at('2026-10-12', h), false, settings);
  const r = await resolveScheduleSlot(db, CRON, at('2026-10-12', 18, 40), false, settings);
  assert.equal(r.slot, 17);
  assert.equal(r.type, 'afternoon');
});

test('漏执行自愈：17:07 整轮丢失，20:07 自动补发下午报告', async () => {
  const db = await createTestDb();
  for (const h of [9, 12, 15]) await resolveScheduleSlot(db, CRON, at('2026-10-12', h), false, settings);
  const r = await resolveScheduleSlot(db, CRON, at('2026-10-12', 20, 7), false, settings);
  assert.equal(r.slot, 17, '应补发丢失的 17 时隙');
  assert.equal(r.type, 'afternoon');
  assert.equal(r.recovered, true);
  // 再往后运行 → 时隙 20
  const r2 = await resolveScheduleSlot(db, CRON, at('2026-10-12', 23, 7), false, settings);
  assert.equal(r2.slot, 20);
});

test('跨午夜：23:07 延迟到次日 00:30 → 普通运行，不影响新的一天', async () => {
  const db = await createTestDb();
  for (const h of [9, 12, 15, 17, 20, 23]) await resolveScheduleSlot(db, CRON, at('2026-10-12', h), false, settings);
  const r = await resolveScheduleSlot(db, CRON, at('2026-10-13', 0, 30), false, settings);
  assert.equal(r.slot, null);
  assert.equal(r.type, 'normal');
  // 新一天 09:07 正常
  const r2 = await resolveScheduleSlot(db, CRON, at('2026-10-13', 9, 7), false, settings);
  assert.equal(r2.slot, 9);
  assert.equal(r2.type, 'morning');
});

test('UTC cron 形式（无 timezone 字段的备用方案）同样正确', async () => {
  const db = await createTestDb();
  const r = await resolveScheduleSlot(db, '7 0,3,6,8,11,14 * * *', at('2026-10-12', 9, 7), true, settings);
  assert.equal(r.slot, 9);
  assert.equal(r.type, 'morning');
});

test('手动执行（非 schedule）按当前 JST 小时自动判定', () => {
  assert.equal(reportTypeForHour(9, 9, 17), 'morning');
  assert.equal(reportTypeForHour(17, 9, 17), 'afternoon');
  assert.equal(reportTypeForHour(10, 9, 17), 'normal');
  assert.equal(reportTypeForHour(0, 9, 17), 'normal');
});
