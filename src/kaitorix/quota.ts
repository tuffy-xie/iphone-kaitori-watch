// 買取X API 额度管理（Free: 30 次/日，JST 0:00 重置）
// 策略：早/晚报（critical/high）优先保障，只受真正耗尽限制；
//       下午报之前的普通轮次整轮预留 reserveForReports 次，之后不再预留；
//       同一 JAN 每次运行只查一次；TPS 由 client 控制；重试 attempts 也计数。

import type { Db, Settings } from '../types.ts';
import { jstHour, todayJst } from '../util/time.ts';

export type RunPriority = 'critical' | 'high' | 'normal';

export interface QuotaDecision {
  allowed: boolean;
  reason?: string;
  remaining: number;
}

export class QuotaManager {
  private readonly db: Db;
  private readonly settings: Settings;

  constructor(db: Db, settings: Settings) {
    this.db = db;
    this.settings = settings;
  }

  async usedToday(today: string = todayJst()): Promise<number> {
    const rows = await this.db.query<{ count: number }>('SELECT count FROM api_usage_daily WHERE date = ?', [today]);
    return rows[0]?.count ?? 0;
  }

  async remaining(today: string = todayJst()): Promise<number> {
    return Math.max(0, this.settings.quota.dailyLimit - (await this.usedToday(today)));
  }

  /**
   * 是否允许采集。
   * - 报告轮次（早间 critical / 下午 high）：只受「真正耗尽」限制（允许部分采集，其余用库中报价）
   * - 普通轮次：若当天还有报告轮次未执行（当前 JST 小时 < 下午报小时），需整轮预留 reserveForReports 次；
   *   下午报之后无需再保护，剩余额度可全部用于采集。
   */
  async canFetch(
    need: number,
    priority: RunPriority,
    today: string = todayJst(),
    nowHour: number = jstHour(),
  ): Promise<QuotaDecision> {
    const rem = await this.remaining(today);
    if (priority !== 'normal') {
      if (rem < 1) {
        return { allowed: false, reason: `每日额度不足：今日剩余 ${rem} 次，需要 ${need} 次`, remaining: rem };
      }
      return { allowed: true, remaining: rem };
    }
    const reportsRemain = nowHour < this.settings.reportHoursJst.afternoon;
    const reserve = reportsRemain ? this.settings.quota.reserveForReports : 0;
    if (rem - need < reserve) {
      return {
        allowed: false,
        reason: reportsRemain
          ? `额度保护：今日剩余 ${rem} 次，需为下午报告与错误恢复保留 ${reserve} 次`
          : `每日额度不足：今日剩余 ${rem} 次，需要 ${need} 次`,
        remaining: rem,
      };
    }
    return { allowed: true, remaining: rem };
  }

  async recordCall(jan: string, today: string = todayJst()): Promise<void> {
    await this.recordCalls(jan, 1, today);
  }

  /** 记录 n 次请求（含失败重试——服务器端每次尝试都计数） */
  async recordCalls(jan: string, n: number, today: string = todayJst()): Promise<void> {
    if (n <= 0) return;
    await this.db.run(
      `INSERT INTO api_usage_daily (date, count, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET count = count + ?, updated_at = datetime('now')`,
      [today, n, n],
    );
    await this.db.run(
      `INSERT INTO api_usage (date, jan, count, last_called_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(date, jan) DO UPDATE SET count = count + ?, last_called_at = datetime('now')`,
      [today, jan, n, n],
    );
  }

  /**
   * 用响应头校正额度：仅在 X-RateLimit-Remaining = 0（日额度耗尽）时以权威值覆盖。
   * 其余情况以本地计数为准（本地计数是安全下界；真正耗尽时 429 会拦住）。
   */
  async syncFromHeader(limit: number, remaining: number, today: string = todayJst()): Promise<void> {
    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || remaining > 0) return;
    await this.db.run(
      `INSERT INTO api_usage_daily (date, count, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET count = MAX(count, ?), updated_at = datetime('now')`,
      [today, limit, limit],
    );
  }
}
