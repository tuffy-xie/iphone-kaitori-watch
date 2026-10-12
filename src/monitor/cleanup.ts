// 原始数据清理：Free/Premium 原始报价保留 29 天，到点自动删除
// 每日聚合（daily_best）长期保留，不受影响

import type { Db, Settings } from '../types.ts';
import * as repo from '../db/repo.ts';
import { daysBetween, jstHour, todayJst } from '../util/time.ts';

export async function runCleanupIfDue(
  db: Db,
  settings: Settings,
  now: Date,
): Promise<{ ran: boolean; deleted: number; reason?: string }> {
  const today = todayJst(now);
  const last = await repo.getState(db, 'last_cleanup_date');
  if (last === today) return { ran: false, deleted: 0, reason: '今天已执行' };

  const hour = jstHour(now);
  const missedYesterday = last !== null && daysBetween(last, today) >= 1;
  const shouldRun = hour >= 23 || missedYesterday || last === null;
  if (!shouldRun) return { ran: false, deleted: 0, reason: '未到执行时间（JST 23:00 后的运行执行）' };

  const rawCutoff = new Date(now.getTime() - settings.rawDataRetentionDays * 86400000).toISOString();
  const logCutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
  const notifCutoff = new Date(now.getTime() - 180 * 86400000).toISOString();

  const deleted = await repo.cleanupOldRaw(db, rawCutoff);
  await repo.pruneRunLog(db, logCutoff);
  await repo.pruneNotifications(db, notifCutoff);
  await repo.setState(db, 'last_cleanup_date', today);
  return { ran: true, deleted };
}
