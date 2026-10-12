// 监控主流程：采集 → 存储 → 分析 → 预警 → 日报

import { randomUUID } from 'node:crypto';
import type { CardId, ProductConfig, Settings } from '../types.ts';
import type { Db } from '../types.ts';
import { KaitoriXError, type KaitoriXClient } from '../kaitorix/client.ts';
import { parseProductResponse } from '../kaitorix/parse.ts';
import { filterAndRank, type FilterOptions } from '../kaitorix/filter.ts';
import { QuotaManager, type RunPriority } from '../kaitorix/quota.ts';
import { computeProfit } from '../analysis/profit.ts';
import { buildSuggestion } from '../analysis/suggestion.ts';
import { returnCountdown } from '../orders/return.ts';
import * as repo from '../db/repo.ts';
import type { Notifier } from '../notify/dedupe.ts';
import * as msg from '../notify/messages.ts';
import type { OrderAnalysis, ProductReportItem } from '../notify/messages.ts';
import { isoNowJst, jstHour, reportTypeForHour, todayJst } from '../util/time.ts';
import { resolveScheduleSlot } from '../util/schedule.ts';
import { runCleanupIfDue } from './cleanup.ts';
import { sendReturnReminders } from './reminder.ts';

export type ReportType = 'morning' | 'afternoon' | 'normal';

export interface MonitorDeps {
  db: Db;
  settings: Settings;
  products: ProductConfig[];
  cards: Record<CardId, import('../types.ts').CardConfig>;
  /** null 表示本次不采集（无 API Key 的纯演练） */
  client: KaitoriXClient | null;
  notifier: Notifier;
  now?: Date;
  trigger?: string;
  /** GitHub Actions schedule 事件：cron 表达式（github.event.schedule） */
  scheduleCron?: string | null;
  /** cron 使用的时区；'Asia/Tokyo' 表示 cron 小时即 JST */
  scheduleTz?: string;
  /** 是否由定时任务触发（决定是否启用时隙逻辑） */
  scheduled?: boolean;
}

export interface MonitorResult {
  runId: string;
  reportType: ReportType;
  fetched: string[];
  skipped: { jan: string; reason: string }[];
  failed: { jan: string; reason: string }[];
  alertsSent: number;
  reportSent: boolean;
}

const EMPTY_FILTER = {
  valid: [],
  excluded: [],
  best: null,
  second: null,
  third: null,
  ichimonme: null,
  colorDiscount: null,
};

export async function runMonitor(
  deps: MonitorDeps,
  opts: { reportType?: ReportType | 'auto'; force?: boolean } = {},
): Promise<MonitorResult> {
  const now = deps.now ?? new Date();
  const { db, settings, products, cards, client, notifier } = deps;
  const today = todayJst(now);
  const hour = jstHour(now);
  const runId = randomUUID();

  // ---------- 报告类型判定 ----------
  // 优先级：显式指定（workflow_dispatch）> 定时时隙（自愈迟到/漏执行）> 按当前 JST 小时
  let reportType: ReportType;
  let slotInfo: { slot: number | null; recovered: boolean } | null = null;
  if (opts.reportType && opts.reportType !== 'auto') {
    reportType = opts.reportType;
  } else if (deps.scheduled && deps.scheduleCron) {
    const resolved = await resolveScheduleSlot(db, deps.scheduleCron, now, deps.scheduleTz !== 'Asia/Tokyo', settings);
    reportType = resolved.type;
    slotInfo = { slot: resolved.slot, recovered: resolved.recovered };
    if (resolved.slot !== null) {
      console.log(
        `[调度] 按时隙 JST ${String(resolved.slot).padStart(2, '0')}:07 处理 → ${reportType}${resolved.recovered ? '（补发更早时隙）' : ''}`,
      );
    } else {
      console.log('[调度] 当天所有时隙均已完成，按普通运行处理');
    }
  } else {
    reportType = reportTypeForHour(hour, settings.reportHoursJst.morning, settings.reportHoursJst.afternoon);
  }
  const priority: RunPriority = reportType === 'morning' ? 'critical' : reportType === 'afternoon' ? 'high' : 'normal';

  await repo.insertRunLog(db, {
    runId,
    mode: 'monitor',
    trigger: deps.trigger ?? 'local',
    reportType,
    startedAt: isoNowJst(now),
  });

  for (const p of products) await repo.upsertProduct(db, p);
  const active = products.filter((p) => p.active);
  const productByJan = new Map(active.map((p) => [p.jan, p]));
  const jans = [...new Set(active.map((p) => p.jan))];

  const quota = new QuotaManager(db, settings);
  const fetched: string[] = [];
  const skipped: { jan: string; reason: string }[] = [];
  const failed: { jan: string; reason: string }[] = [];
  const fetchWarnings: string[] = [];
  let apiCalls = 0;

  if (client) {
    // 普通运行整轮预检：整轮 4 个 JAN 都能完成、且仍保留 reserveForReports 次额度时才执行，
    // 避免轮内部分跳过（预留按轮计算，不按单次调用）。
    let roundAllowed = true;
    if (priority === 'normal') {
      const decision = await quota.canFetch(jans.length, priority, today, hour);
      roundAllowed = decision.allowed;
      if (!decision.allowed) {
        skipped.push({ jan: '*', reason: decision.reason ?? '额度保护，本轮未采集' });
        console.log(`[跳过] 本轮未采集：${decision.reason ?? '额度保护'}`);
      }
    }
    if (roundAllowed) {
      for (let i = 0; i < jans.length; i++) {
        const jan = jans[i];
        const product = productByJan.get(jan)!;
        // 真正耗尽检查（早/晚报允许部分采集，其余用库中报价）
        if ((await quota.remaining(today)) < 1) {
          skipped.push({ jan, reason: '每日额度已耗尽' });
          continue;
        }
      try {
        const res = await client.getProduct(jan);
        apiCalls += res.attempts;
        await quota.recordCalls(jan, res.attempts, today);
        if (res.rateLimitLimit !== null && res.rateLimitRemaining !== null) {
          await quota.syncFromHeader(res.rateLimitLimit, res.rateLimitRemaining, today);
        }
        const parsed = parseProductResponse(res.body, { jan, model: product.model, color: product.color });
        for (const w of parsed.warnings) {
          console.warn(`[警告] ${product.colorZh} ${jan}: ${w}`);
          fetchWarnings.push(`${product.colorZh}: ${w}`);
        }
        const filterOpts: FilterOptions = {
          maxQuoteAgeHours: settings.maxQuoteAgeHours,
          now,
          specialShopKeys: settings.specialShops.kaitoriIchimonme,
        };
        const filtered = filterAndRank(parsed.quotes, filterOpts);
        const fetchedAt = isoNowJst(now);
        await repo.insertSnapshot(db, { runId, jan, fetchedAt, payload: res.body });
        await repo.insertQuotes(db, { runId, jan, fetchedAt, quotes: parsed.quotes, filtered });
        if (filtered.best) {
          const existing = await repo.getDailyBest(db, today, jan);
          await repo.upsertDailyBest(db, {
            date: today,
            jan,
            bestPrice: filtered.best.price,
            bestShop: filtered.best.shopName,
            bestShopKey: filtered.best.shopKey,
            morningPrice: existing?.morning_price ?? filtered.best.price,
            shopCount: filtered.valid.length,
          });
        }
        fetched.push(jan);
        console.log(
          `[采集] ${product.colorZh} ${jan}: ${filtered.valid.length} 家有效报价，最高 ${filtered.best?.price ?? '—'}`,
        );
      } catch (e) {
        const err = e as KaitoriXError;
        apiCalls += err.attempts ?? 1;
        await quota.recordCalls(jan, err.attempts ?? 1, today);
        failed.push({ jan, reason: err.message });
        console.error(`[失败] ${product.colorZh} ${jan}: ${err.message}`);
        await notifier.sendOnce(
          `api-fail-${jan}-${today}`,
          msg.buildApiFailureAlert({ product, reason: err.message }),
        );
        if (err.kind === 'daily') {
          for (const rest of jans.slice(i + 1)) skipped.push({ jan: rest, reason: '買取X 每日额度已耗尽' });
          break;
        }
      }
      }
    }
  } else {
    skipped.push({ jan: '*', reason: '未配置 KAITORIX_API_KEY（演练模式，使用数据库中已有报价）' });
  }

  // ---------- 分析 ----------
  const orders = await repo.listHeldOrders(db);
  const items: ProductReportItem[] = [];
  const alerts: { key: string; text: string }[] = [];
  const reversedStatuses = ['return_requested', 'return_shipped', 'refunded'];

  for (const p of active) {
    const latest = await repo.getLatestValidQuotes(db, p.jan);
    const filtered = latest ? filterAndRank(latest.quotes, { maxQuoteAgeHours: settings.maxQuoteAgeHours, now, specialShopKeys: settings.specialShops.kaitoriIchimonme }) : EMPTY_FILTER;
    const prevBest = latest ? await repo.getPreviousValidBest(db, p.jan, latest.fetchedAt) : null;
    const daily = await repo.getDailyBest(db, today, p.jan);
    const morningBest = daily?.morning_price ?? null;
    const best24hAgo = latest ? await repo.getBestAround24hAgo(db, p.jan, isoNowJst(now)) : null;
    const dataAgeHours = latest ? (now.getTime() - new Date(latest.fetchedAt).getTime()) / 3600000 : null;

    const analyses: OrderAnalysis[] = [];
    for (const o of orders.filter((o) => o.jan === p.jan)) {
      const card = cards[o.card];
      const profit = computeProfit({
        unitPrice: o.unitPrice,
        quantity: o.quantity,
        bestPrice: filtered.best?.price ?? null,
        // 订单费用在录入时已解析：NULL = 未确认（显示"尚无法确定"），不再回退默认值
        fees: {
          shipping: o.fees?.shipping ?? null,
          transport: o.fees?.transport ?? null,
          handling: o.fees?.handling ?? null,
          confirmedDiscount: o.confirmedDiscount ?? 0,
        },
        card,
        pointsReversed: reversedStatuses.includes(o.status),
      });
      const cd = returnCountdown(o, settings, today);
      const suggestion = buildSuggestion({
        profit,
        daysLeft: cd.daysLeft,
        minProfitYen: settings.minProfitYen,
        discountUnknown: filtered.colorDiscount !== null,
        quoteNotLocked: true,
      });
      analyses.push({
        order: o,
        product: p,
        profit,
        deadline: cd.deadline,
        daysLeft: cd.daysLeft,
        suggestApplyDate: cd.suggestApplyDate,
        suggestion,
      });

      const best = filtered.best;
      if (best && prevBest !== null) {
        const diff = best.price - prevBest;
        if (Math.abs(diff) >= settings.priceAlertThresholdYen) {
          alerts.push({
            key: `price-${diff > 0 ? 'up' : 'down'}-${p.jan}-${today}`,
            text: msg.buildPriceAlert({
              product: p,
              direction: diff > 0 ? 'up' : 'down',
              current: best.price,
              previous: prevBest,
              shopName: best.shopName,
              updatedAt: best.updatedAt,
            }),
          });
        }
      }
      if (best && profit.cashBreakEvenPrice !== null && best.price >= profit.cashBreakEvenPrice) {
        alerts.push({
          key: `first-cashbe-${o.orderRef}`,
          text: msg.buildBreakEvenAlert({
            order: o,
            product: p,
            kind: 'cash',
            bestPrice: best.price,
            breakEvenPrice: profit.cashBreakEvenPrice,
            shopName: best.shopName,
          }),
        });
      } else if (best && profit.comprehensiveBreakEvenPrice !== null && best.price >= profit.comprehensiveBreakEvenPrice) {
        alerts.push({
          key: `first-compbe-${o.orderRef}`,
          text: msg.buildBreakEvenAlert({
            order: o,
            product: p,
            kind: 'comprehensive',
            bestPrice: best.price,
            breakEvenPrice: profit.comprehensiveBreakEvenPrice,
            shopName: best.shopName,
          }),
        });
      }
    }

    items.push({ product: p, latest, filtered, prevBest, morningBest, best24hAgo, analyses, dataAgeHours });
  }

  // ---------- 退货提醒（与独立提醒工作流共用事件键，DB 去重） ----------
  const remindersSent = await sendReturnReminders({ db, settings, products, notifier, now, items });

  // ---------- 预警 ----------
  let alertsSent = remindersSent;
  for (const a of alerts) {
    if (await notifier.sendOnce(a.key, a.text)) alertsSent++;
  }
  if (skipped.some((s) => s.reason.includes('额度'))) {
    const note = msg.buildQuotaSkipNote(skipped.find((s) => s.reason.includes('额度'))!.reason);
    if (await notifier.sendOnce(`quota-skip-${today}`, note)) alertsSent++;
  }

  // ---------- 日报 ----------
  let reportSent = false;
  if (reportType === 'morning' || reportType === 'afternoon') {
    const messages = msg.buildDailyReport({
      now,
      reportType,
      items,
      cards,
      settings,
      quotaNote: skipped.some((s) => s.reason.includes('额度')) ? msg.buildQuotaSkipNote(skipped.find((s) => s.reason.includes('额度'))!.reason) : null,
      extraWarnings: [...new Set(fetchWarnings)],
    });
    for (const m of messages) {
      if (opts.force) await notifier.send(m);
      else await notifier.sendOnce(`report-${reportType}-${today}`, m);
    }
    reportSent = true;
  }

  const cleanup = await runCleanupIfDue(db, settings, now);
  if (cleanup.ran) console.log(`[清理] 删除 ${cleanup.deleted} 条超过 ${settings.rawDataRetentionDays} 天的原始报价`);

  await repo.finishRunLog(db, {
    runId,
    status: failed.length > 0 ? 'partial' : 'ok',
    apiCalls,
    message: `fetched=${fetched.length} skipped=${skipped.length} failed=${failed.length} alerts=${alertsSent} report=${reportSent}${slotInfo?.slot !== null && slotInfo?.slot !== undefined ? ` slot=${slotInfo.slot}${slotInfo.recovered ? '(recovered)' : ''}` : ''}`,
  });

  return { runId, reportType, fetched, skipped, failed, alertsSent, reportSent };
}
