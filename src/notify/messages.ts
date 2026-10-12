// Telegram 消息排版（简体中文、分段、适度 Emoji，适配手机阅读）

import type { CardConfig, CardId, OrderRecord, ProductConfig, QuoteFilterResult, Settings } from '../types.ts';
import type { ProfitResult } from '../analysis/profit.ts';
import type { LatestQuotes } from '../db/repo.ts';
import type { DeadlineInfo } from '../orders/return.ts';
import { formatDateCn, formatIsoShort, formatJstDateTime, jstParts } from '../util/time.ts';
import { yen, yenSigned } from '../util/format.ts';
import { escapeHtml } from './telegram.ts';

const SEP = '━━━━━━━━━━━━━━━━━━';

const COLOR_EMOJI: Record<string, string> = {
  ブラック: '⚫',
  シルバー: '⚪',
  バーガンディ: '🟥',
  グレイシャー: '🔷',
};

export function colorEmoji(color: string): string {
  return COLOR_EMOJI[color] ?? '▫️';
}

export interface OrderAnalysis {
  order: OrderRecord;
  product: ProductConfig;
  profit: ProfitResult;
  deadline: DeadlineInfo | null;
  daysLeft: number | null;
  suggestApplyDate: string | null;
  suggestion: { emoji: string; title: string; bullets: string[]; warnings: string[] };
}

export interface ProductReportItem {
  product: ProductConfig;
  latest: LatestQuotes | null;
  filtered: QuoteFilterResult;
  prevBest: number | null;
  morningBest: number | null;
  best24hAgo: number | null;
  analyses: OrderAnalysis[];
  /** 数据距现在小时数 */
  dataAgeHours: number | null;
}

function diffText(current: number | null, ref: number | null): string {
  if (current === null || ref === null) return '—';
  return yenSigned(current - ref);
}

function cardLine(cards: Record<CardId, CardConfig>, unitPrice: number): string {
  const parts: string[] = [];
  for (const id of ['epos', 'ana'] as CardId[]) {
    const c = cards[id];
    if (!c) continue;
    const points = Math.floor(unitPrice / c.yenPerPointUnit) * c.pointsPerUnit;
    if (c.type === 'epos_platinum') {
      parts.push(`EPOS：+${yen(points * c.yenPerPoint)}`);
    } else {
      const miles = points * c.jpointToMiles;
      parts.push(`ANA里程：+${miles.toLocaleString('en-US')}（约 ${yen(miles * c.yenPerMile)}）`);
    }
  }
  return parts.join('｜');
}

function quoteLine(q: { shopName: string; price: number } | null): string {
  return q ? `${yen(q.price)}（${q.shopName}）` : '—';
}

function productBlock(item: ProductReportItem, cards: Record<CardId, CardConfig>): string {
  const p = item.product;
  const f = item.filtered;
  const lines: string[] = [];
  lines.push(`${colorEmoji(p.color)} ${p.colorZh}（${p.color}）`);

  if (!f.best) {
    lines.push('最高回收：暂无有效报价');
    if (item.latest === null) lines.push('（尚无成功采集记录）');
    return lines.join('\n');
  }

  const best = f.best.price;
  const apple = p.applePrice;
  lines.push(`最高回收：${yen(best)}`);
  lines.push(`商家：${f.best.shopName}`);
  lines.push(`第二：${quoteLine(f.second)}`);
  lines.push(`第三：${quoteLine(f.third)}`);
  lines.push(`一丁目：${quoteLine(f.ichimonme)}`);
  lines.push(`现金毛差额：${yenSigned(best - apple)}/台（未扣运费等费用）`);
  lines.push(cardLine(cards, apple));
  lines.push(
    `较上次：${diffText(best, item.prevBest)}｜较今早：${diffText(best, item.morningBest)}｜24h前：${diffText(best, item.best24hAgo)}`,
  );
  lines.push(
    `报价更新：${formatIsoShort(f.best.updatedAt)}${item.dataAgeHours !== null ? `（数据采集于 ${item.dataAgeHours.toFixed(1)} 小时前）` : ''}`,
  );

  if (f.colorDiscount) {
    lines.push(
      `⚠️ 检测到颜色减价提示 ${yenSigned(-f.colorDiscount.amount)}（是否已包含在报价中：未确认，未扣减；保守口径 ${yen(best - f.colorDiscount.amount)}）`,
    );
  }

  for (const a of item.analyses) {
    const cardLabel = cards[a.order.card]?.label ?? a.order.card;
    const pr = a.profit;
    lines.push(`🧾 ${a.order.orderRef} ×${a.order.quantity}（${cardLabel}）`);
    lines.push(`💴 购买：${yen(a.order.unitPrice)}/台`);
    lines.push(`📉 现金毛差额：${yenSigned(pr.cashGrossPerUnit)}/台（未扣运费等费用）`);
    lines.push(pr.feesKnown ? `🧮 预计净利润：${yenSigned(pr.cashNetPerUnit)}/台` : '🧮 预计净利润：费用未确认，尚无法确定');
    const isAna = cards[a.order.card]?.type === 'ana_gold';
    const reversed = pr.card.notes.some((n) => n.includes('撤销'));
    if (reversed) {
      lines.push('💎 积分估值收益：已申请退货，积分/里程可能被撤销，按 ¥0 计');
    } else if (pr.card.points > 0 && isAna) {
      lines.push(
        `💎 积分估值收益：${pr.card.points.toLocaleString('en-US')} J-POINT → ${pr.card.miles.toLocaleString('en-US')}mi ≈ ${yen(pr.card.milesValueYen)}（估算，非现金）`,
      );
    } else if (pr.card.points > 0) {
      lines.push(`💎 积分估值收益：${pr.card.points.toLocaleString('en-US')}pt ≈ ${yen(pr.card.pointsValueYen)}（估算，非现金）`);
    }
    if (pr.card.annualBonusPoints) {
      lines.push(`🎁 EPOS年度奖励增量：+${pr.card.annualBonusPoints.toLocaleString('en-US')}pt（参考估算，不计入确定收益）`);
    }
    lines.push(
      pr.feesKnown
        ? `🔮 综合预计收益：${yenSigned(pr.comprehensiveNetPerUnit)}/台（估算）`
        : '🔮 综合预计收益：费用未确认，暂无法估算',
    );
    lines.push(
      pr.feesKnown && pr.cashNetPerUnit !== null
        ? `✅ 实际确认收益（现金）：${yenSigned(pr.cashNetPerUnit)}/台`
        : '✅ 实际确认收益：费用未确认，暂无确认收益',
    );
    if (!pr.feesKnown) lines.push('⚠️ 请补齐运费/交通费/手续费后再确认净利润与回本判定');
  }
  return lines.join('\n');
}

function countdownBlock(analyses: OrderAnalysis[]): string | null {
  const withDeadline = analyses.filter((a) => a.deadline !== null);
  if (withDeadline.length === 0) return null;
  const lines: string[] = [SEP, '⏳ 退货倒计时'];
  for (const a of withDeadline) {
    lines.push(`🧾 ${a.order.orderRef}｜${a.product.model} ${a.product.capacity} ${colorEmoji(a.product.color)}${a.product.colorZh} ×${a.order.quantity}`);
    lines.push(`申请截止：${formatDateCn(a.deadline!.date)}${a.deadline!.estimated ? '（估算：收货+14天）' : '（官方确认）'}`);
    if (a.suggestApplyDate) lines.push(`建议最迟申请：${formatDateCn(a.suggestApplyDate)}`);
    if (a.daysLeft !== null) lines.push(`还剩：${a.daysLeft} 天`);
  }
  return lines.join('\n');
}

function judgmentBlock(analyses: OrderAnalysis[], warnings: string[], now: Date): string {
  const lines: string[] = [SEP, '💡 当前判断'];
  if (analyses.length === 0) lines.push('（暂无持有中的订单）');
  for (const a of analyses) {
    lines.push(`${a.suggestion.emoji} ${a.order.orderRef}：${a.suggestion.title}`);
    for (const b of a.suggestion.bullets.slice(0, 2)) lines.push(`   ${b}`);
    for (const w of a.suggestion.warnings) lines.push(`   ⚠️ ${w}`);
  }
  for (const w of warnings) lines.push(`⚠️ ${w}`);
  lines.push(SEP);
  lines.push(`🔗 报价来源：買取X Open API（查询时间 ${formatJstDateTime(now)}）`);
  return lines.join('\n');
}

/** 按 maxChars 打包消息块 */
export function packMessages(blocks: string[], maxChars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const block of blocks) {
    if (cur && cur.length + block.length + 2 > maxChars) {
      out.push(cur.trimEnd());
      cur = '';
    }
    if (block.length > maxChars) {
      if (cur) {
        out.push(cur.trimEnd());
        cur = '';
      }
      let tmp = '';
      for (const line of block.split('\n')) {
        if (tmp && tmp.length + line.length + 1 > maxChars) {
          out.push(tmp.trimEnd());
          tmp = '';
        }
        tmp += line + '\n';
      }
      if (tmp.trim()) out.push(tmp.trimEnd());
      continue;
    }
    cur += block + '\n\n';
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out.length > 0 ? out : ['（无内容）'];
}

export interface DailyReportArgs {
  now: Date;
  reportType: 'morning' | 'afternoon' | 'normal';
  items: ProductReportItem[];
  cards: Record<CardId, CardConfig>;
  settings: Settings;
  quotaNote: string | null;
  extraWarnings: string[];
}

export function buildDailyReport(args: DailyReportArgs): string[] {
  const { now, reportType, items, cards, quotaNote, extraWarnings } = args;
  const label = reportType === 'morning' ? '早间报告' : reportType === 'afternoon' ? '下午报告' : '监控报告';
  const headerText = [`📱 iPhone買取套利监控 · ${label}`, SEP, `🕒 ${formatJstDateTime(now)}`].join('\n');

  // 按型号分组
  const byModel = new Map<string, ProductReportItem[]>();
  for (const item of items) {
    const key = `${item.product.model} ${item.product.capacity}`;
    const arr = byModel.get(key) ?? [];
    arr.push(item);
    byModel.set(key, arr);
  }

  const blocks: string[] = [];
  let headerUsed = false;
  for (const [modelKey, groupItems] of byModel) {
    const first = groupItems[0];
    const modelHeader = [`📦 ${modelKey}`, `💴 Apple官网：${yen(first.product.applePrice)}（含税）`].join('\n');
    const prefix = headerUsed ? '' : `${headerText}\n\n`;
    headerUsed = true;
    const colorBlocks = groupItems.map((item) => productBlock(item, cards));
    blocks.push(prefix + [modelHeader, ...colorBlocks].join('\n\n'));
  }
  if (!headerUsed) blocks.push(headerText);

  const allAnalyses = items.flatMap((i) => i.analyses);
  const cd = countdownBlock(allAnalyses);
  if (cd) blocks.push(cd);

  const warnings = [...extraWarnings];
  if (quotaNote) warnings.push(quotaNote);
  blocks.push(judgmentBlock(allAnalyses, warnings, now));

  return packMessages(blocks, args.settings.telegramMaxChars);
}

// ---------- 预警消息 ----------

export function buildPriceAlert(args: {
  product: ProductConfig;
  direction: 'up' | 'down';
  current: number;
  previous: number;
  shopName: string;
  updatedAt: string | null;
}): string {
  const diff = args.current - args.previous;
  const arrow = args.direction === 'up' ? '📈' : '📉';
  return [
    `🚨 报价异动 ${arrow}`,
    SEP,
    `${colorEmoji(args.product.color)} ${args.product.colorZh}（${args.product.color}）`,
    `最高回收：${yen(args.current)}（${args.shopName}）`,
    `较上次：${yenSigned(diff)}`,
    `报价更新：${formatIsoShort(args.updatedAt)}`,
    SEP,
    '🔗 来源：買取X Open API',
  ].join('\n');
}

export function buildBreakEvenAlert(args: {
  order: OrderRecord;
  product: ProductConfig;
  kind: 'cash' | 'comprehensive';
  bestPrice: number;
  breakEvenPrice: number;
  shopName: string;
}): string {
  const kindLabel = args.kind === 'cash' ? '🎉 首次现金回本' : '🟡 首次综合估值回本（非现金回本）';
  return [
    kindLabel,
    SEP,
    `🧾 ${args.order.orderRef} ×${args.order.quantity}`,
    `${colorEmoji(args.product.color)} ${args.product.colorZh}（${args.product.color}）`,
    `最高回收：${yen(args.bestPrice)}（${args.shopName}）`,
    args.kind === 'cash'
      ? `现金回本价：${yen(args.breakEvenPrice)}`
      : `综合估值回本价：${yen(args.breakEvenPrice)}`,
    '报价未锁定前请向商家进一步确认',
    SEP,
    '🔗 来源：買取X Open API',
  ].join('\n');
}

export function buildReturnReminder(args: {
  order: OrderRecord;
  product: ProductConfig;
  daysLeft: number | null;
  deadlineLabel: string;
  suggestApplyDate: string | null;
  applyDaysLeft: number | null;
  shipDeadlineLabel: string | null;
  shipDaysLeft: number | null;
  bestPrice: number | null;
  bestShop: string | null;
  bestUpdatedAt: string | null;
  thresholds: number[];
}): string {
  const urgency = args.daysLeft !== null && args.daysLeft <= 1 ? '🚨' : args.daysLeft !== null && args.daysLeft <= 3 ? '⚠️' : '⏳';
  const lines = [
    `${urgency} 退货倒计时提醒`,
    SEP,
    `🧾 ${args.order.orderRef} ×${args.order.quantity}`,
    `📦 ${args.product.model} ${args.product.capacity} ${colorEmoji(args.product.color)}${args.product.colorZh}`,
    `申请截止：${args.deadlineLabel}`,
  ];
  if (args.suggestApplyDate) lines.push(`建议最迟申请：${formatDateCn(args.suggestApplyDate)}`);
  if (args.daysLeft !== null) lines.push(`还剩：${args.daysLeft} 天`);
  if (args.shipDeadlineLabel) {
    lines.push(`寄出截止：${args.shipDeadlineLabel}${args.shipDaysLeft !== null ? `（还剩 ${args.shipDaysLeft} 天）` : ''}`);
  }
  lines.push(SEP);
  if (args.bestPrice !== null) {
    lines.push(`当前最高回收：${yen(args.bestPrice)}${args.bestShop ? `（${args.bestShop}）` : ''}`);
    lines.push(`报价更新：${formatIsoShort(args.bestUpdatedAt)}`);
  } else {
    lines.push('当前无有效回收报价');
  }
  lines.push('Apple 对大量购买/不当退货可能收取 15% 退货手续费，退货不一定无损');
  lines.push('系统不会自动退货，请自行决定');
  lines.push(SEP);
  lines.push('🔗 报价来源：買取X');
  return lines.join('\n');
}

export function buildApiFailureAlert(args: { product: ProductConfig; reason: string }): string {
  return [
    '⚠️ 报价采集失败',
    SEP,
    `${colorEmoji(args.product.color)} ${args.product.colorZh}（${args.product.color}）JAN ${args.product.jan}`,
    `原因：${args.reason}`,
    '已使用数据库中最近的有效报价继续判断',
  ].join('\n');
}

export function buildQuotaSkipNote(reason: string): string {
  return `本次未更新报价：${reason}。将使用数据库中最近的有效报价。`;
}

export function buildTestMessage(now: Date): string {
  const p = jstParts(now);
  return [
    '✅ iPhone買取套利监控 · 测试消息',
    SEP,
    `🕒 ${formatJstDateTime(now)}`,
    '如果你收到这条消息，说明 Telegram Bot 配置正确。',
    `系统时区：Asia/Tokyo（当前 ${p.date}）`,
  ].join('\n');
}

export function buildOrdersSavedMessage(refs: string[], now: Date): string {
  return [
    '✅ 订单已保存',
    SEP,
    ...refs.map((r) => `🧾 ${r}`),
    `🕒 ${formatJstDateTime(now)}`,
  ].join('\n');
}

export { escapeHtml };
