// 退货提醒（监控运行与独立提醒工作流共用；事件键统一，D1 去重）

import type { CardId, ProductConfig, Settings } from '../types.ts';
import type { Db } from '../types.ts';
import * as repo from '../db/repo.ts';
import type { Notifier } from '../notify/dedupe.ts';
import * as msg from '../notify/messages.ts';
import type { ProductReportItem } from '../notify/messages.ts';
import { dueReminderThresholds, returnCountdown } from '../orders/return.ts';
import { formatDateCn, todayJst } from '../util/time.ts';

export interface ReminderDeps {
  db: Db;
  settings: Settings;
  products: ProductConfig[];
  notifier: Notifier;
  now?: Date;
  /** 监控运行传入本次分析的报价项；独立工作流不传则从库里读 */
  items?: ProductReportItem[];
}

export async function sendReturnReminders(deps: ReminderDeps): Promise<number> {
  const now = deps.now ?? new Date();
  const today = todayJst(now);
  const orders = await repo.listHeldOrders(deps.db);
  if (orders.length === 0) return 0;

  const itemByJan = new Map((deps.items ?? []).map((i) => [i.product.jan, i]));
  let sent = 0;

  for (const o of orders) {
    const product = deps.products.find((p) => p.jan === o.jan);
    if (!product) continue;
    const cd = returnCountdown(o, deps.settings, today);
    if (!cd.deadline || cd.daysLeft === null) continue;

    let best: { price: number; shopName: string; updatedAt: string | null } | null = null;
    const item = itemByJan.get(o.jan);
    const itemBest = item ? item.filtered.best : null;
    if (itemBest) {
      best = { price: itemBest.price, shopName: itemBest.shopName, updatedAt: itemBest.updatedAt };
    } else {
      const latest = await repo.getLatestValidQuotes(deps.db, o.jan);
      const q = latest?.quotes[0] ?? null;
      if (q) best = { price: q.price, shopName: q.shopName, updatedAt: q.updatedAt };
    }

    const args = {
      order: o,
      product,
      daysLeft: cd.daysLeft,
      deadlineLabel: `${formatDateCn(cd.deadline.date)}${cd.deadline.estimated ? '（估算）' : '（官方确认）'}`,
      suggestApplyDate: cd.suggestApplyDate,
      applyDaysLeft: cd.applyDaysLeft,
      shipDeadlineLabel: cd.shipDeadline ? formatDateCn(cd.shipDeadline) : null,
      shipDaysLeft: cd.shipDaysLeft,
      bestPrice: best?.price ?? null,
      bestShop: best?.shopName ?? null,
      bestUpdatedAt: best?.updatedAt ?? null,
      thresholds: dueReminderThresholds(cd.daysLeft, deps.settings.returnReminderThresholdsDays),
    };

    // 阈值节点提醒（7/3/2/1/0 天，每个节点只发一次）
    for (const t of args.thresholds) {
      if (await deps.notifier.sendOnce(`return-d${t}-${o.orderRef}`, msg.buildReturnReminder(args))) sent++;
    }
    // 最后 3 天每天提醒（即使价格没有变化）
    if (cd.daysLeft <= 3) {
      if (await deps.notifier.sendOnce(`return-daily-${o.orderRef}-${today}`, msg.buildReturnReminder(args))) sent++;
    }
  }
  return sent;
}
