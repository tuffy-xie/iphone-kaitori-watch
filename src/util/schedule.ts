// 调度工具：解析 GitHub Actions cron、按「时隙」推断报告类型
// 解决两类问题：
//   1) GitHub 定时任务迟到（延迟几分钟到数小时）→ 按实际应属时隙处理，不按启动时刻
//   2) 某个时隙的运行整体丢失（GitHub 偶发漏执行）→ 后续运行自动补发该时隙的报告

import type { Db, Settings } from '../types.ts';
import type { ReportType } from '../monitor/run.ts';
import * as repo from '../db/repo.ts';
import { jstHour, todayJst } from '../util/time.ts';

/** 展开 cron 的小时字段：支持 * / 步进 / 区间 / 列表 */
export function parseCronHours(cron: string): number[] {
  const fields = cron.trim().split(/\s+/);
  if (fields.length < 5) return [];
  const hourField = fields[1];
  const out = new Set<number>();
  for (const part of hourField.split(',')) {
    const stepMatch = /^(.+)\/(\d+)$/.exec(part);
    let body = part;
    let step = 1;
    if (stepMatch) {
      body = stepMatch[1];
      step = Number(stepMatch[2]);
    }
    let from = 0;
    let to = 23;
    if (body === '*') {
      // 全部
    } else if (/^\d+$/.test(body)) {
      from = to = Number(body);
    } else {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(body);
      if (!rangeMatch) continue;
      from = Number(rangeMatch[1]);
      to = Number(rangeMatch[2]);
    }
    for (let h = from; h <= to; h += step) {
      if (h >= 0 && h <= 23) out.add(h);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** cron 中的小时转换为 JST 小时（cronIsUtc=true 时 +9） */
export function scheduledJstHours(cron: string, cronIsUtc: boolean): number[] {
  const hours = parseCronHours(cron);
  if (!cronIsUtc) return hours;
  return [...new Set(hours.map((h) => (h + 9) % 24))].sort((a, b) => a - b);
}

/** 时隙 → 报告类型 */
export function slotToReportType(hour: number, settings: Settings): ReportType {
  if (hour === settings.reportHoursJst.morning) return 'morning';
  if (hour === settings.reportHoursJst.afternoon) return 'afternoon';
  return 'normal';
}

export interface SlotResolution {
  /** 本次运行负责的时隙（JST 小时）；null = 当天所有应处理时隙均已完成 */
  slot: number | null;
  type: ReportType;
  /** 是否补发了更早时隙（迟到/漏执行的自愈） */
  recovered: boolean;
}

/**
 * 确定本次定时运行负责的时隙：
 * 取「当天已过去的时隙中最早一个尚未完成的」，标记完成后返回。
 * 全部已完成 → normal（避免重复推送）。
 */
export async function resolveScheduleSlot(
  db: Db,
  cron: string,
  now: Date,
  cronIsUtc: boolean,
  settings: Settings,
): Promise<SlotResolution> {
  const hours = scheduledJstHours(cron, cronIsUtc);
  if (hours.length === 0) return { slot: null, type: 'normal', recovered: false };
  const cur = jstHour(now);
  const today = todayJst(now);
  const preceding = hours.filter((h) => h <= cur);
  const latest = preceding.length > 0 ? preceding[preceding.length - 1] : null;

  for (const h of preceding) {
    const key = `slotdone:${today}:${h}`;
    const done = await repo.getState(db, key);
    if (done !== '1') {
      await repo.setState(db, key, '1');
      return { slot: h, type: slotToReportType(h, settings), recovered: latest !== null && h < latest };
    }
  }
  return { slot: null, type: 'normal', recovered: false };
}
