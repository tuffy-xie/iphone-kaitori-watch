// Apple 退货日期计算与倒计时
// 规则：官方确认截止日期 > 估算（实际收货日 +14 天，必须标注"估算"）

import type { OrderRecord, Settings } from '../types.ts';
import { addDays, daysBetween, formatDateCn } from '../util/time.ts';

export interface DeadlineInfo {
  date: string;
  estimated: boolean;
  source: 'confirmed' | 'estimated';
}

export function effectiveDeadline(order: OrderRecord, settings: Settings): DeadlineInfo | null {
  if (order.returnDeadlineConfirmed) {
    return { date: order.returnDeadlineConfirmed, estimated: false, source: 'confirmed' };
  }
  if (order.receivedDate) {
    return {
      date: addDays(order.receivedDate, settings.returnDeadlineDaysAfterReceipt),
      estimated: true,
      source: 'estimated',
    };
  }
  return null;
}

export interface Countdown {
  deadline: DeadlineInfo | null;
  /** 距退货申请截止天数 */
  daysLeft: number | null;
  /** 建议最迟申请日期（截止前 1 天） */
  suggestApplyDate: string | null;
  applyDaysLeft: number | null;
  /** 退货寄出截止日期（与申请截止不是一回事） */
  shipDeadline: string | null;
  shipDaysLeft: number | null;
}

export function returnCountdown(order: OrderRecord, settings: Settings, today: string): Countdown {
  const deadline = effectiveDeadline(order, settings);
  const daysLeft = deadline ? daysBetween(today, deadline.date) : null;
  const suggestApplyDate = deadline ? addDays(deadline.date, -settings.suggestApplyDaysBeforeDeadline) : null;
  const applyDaysLeft = suggestApplyDate ? daysBetween(today, suggestApplyDate) : null;
  const shipDeadline = order.returnShipDeadline ?? null;
  const shipDaysLeft = shipDeadline ? daysBetween(today, shipDeadline) : null;
  return { deadline, daysLeft, suggestApplyDate, applyDaysLeft, shipDeadline, shipDaysLeft };
}

/** 今天应该触发哪些阈值提醒（7/3/2/1/0 天） */
export function dueReminderThresholds(daysLeft: number | null, thresholds: number[]): number[] {
  if (daysLeft === null) return [];
  return thresholds.filter((t) => daysLeft <= t).sort((a, b) => a - b);
}

export function formatDeadlineLabel(d: DeadlineInfo): string {
  return `${formatDateCn(d.date)}${d.estimated ? '（估算）' : '（官方确认）'}`;
}
