// Telegram 消息排版（简体中文、分段、适度 Emoji，适配手机阅读）

import type { CardConfig, CardId, NormalizedQuote, OrderRecord, ProductConfig, QuoteFilterResult, Settings } from '../types.ts';
import type { ProfitResult } from '../analysis/profit.ts';
import { calcCard } from '../analysis/cards.ts';
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
  /** 聚焦模式的报价基准（一丁目；不可用时回退全店最高） */
  focusQuote: NormalizedQuote | null;
  /** focusQuote 是否确实来自一丁目 */
  focusIsIchimonme: boolean;
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

function cardShortLabel(card: CardConfig | undefined): string {
  if (!card) return '';
  return card.type === 'epos_platinum' ? 'EPOS黑卡' : 'ANA金卡';
}

/** 订单一行：五口径（毛差｜净利｜积分估值｜综合｜实际确认） */
function orderLine(a: OrderAnalysis, cards: Record<CardId, CardConfig>): string {
  const pr = a.profit;
  const cardName = cardShortLabel(cards[a.order.card]);
  const reversed = pr.card.notes.some((n) => n.includes('撤销'));
  const head = `🧾 ${a.order.orderRef} ×${a.order.quantity} ${cardName}｜购买${yen(a.order.unitPrice)}`;
  if (!pr.feesKnown) {
    return `${head}｜毛差 ${yenSigned(pr.cashGrossPerUnit)}｜净利未确认｜综合未估算｜确认暂无 ⚠️费用未确认`;
  }
  if (reversed) {
    return `${head}｜毛差 ${yenSigned(pr.cashGrossPerUnit)}｜净利 ${yenSigned(pr.cashNetPerUnit)}｜积分估值 ¥0（已申请退货）｜综合 ${yenSigned(pr.comprehensiveNetPerUnit)}｜实际确认 ${yenSigned(pr.cashNetPerUnit)}`;
  }
  const pts = pr.pointsValuePerUnit + pr.milesValuePerUnit;
  return `${head}｜毛差 ${yenSigned(pr.cashGrossPerUnit)}｜净利 ${yenSigned(pr.cashNetPerUnit)}｜积分估值 +${yen(pts)}｜综合 ${yenSigned(pr.comprehensiveNetPerUnit)}｜实际确认 ${yenSigned(pr.cashNetPerUnit)}`;
}

/** 聚焦模式：每色一行（一丁目价 + 毛差 + 涨跌 + 减价警示） */
function focusLine(item: ProductReportItem): string {
  const p = item.product;
  const emoji = colorEmoji(p.color);
  const fq = item.focusQuote;
  if (!fq) return `${emoji} ${p.colorZh}：一丁目暂无有效报价`;
  const priceText = item.focusIsIchimonme ? yen(fq.price) : `${yen(fq.price)}（${fq.shopName}）`;
  const parts = [`${emoji} ${p.colorZh} ${priceText}`, `毛差 ${yenSigned(fq.price - p.applePrice)}`];
  const diff = item.prevBest !== null ? fq.price - item.prevBest : null;
  if (diff !== null && diff !== 0) {
    parts.push(diff > 0 ? `↑${Math.abs(diff).toLocaleString('en-US')}` : `↓${Math.abs(diff).toLocaleString('en-US')}`);
  }
  if (fq.discountAmount) parts.push(`⚠️减价 -${yen(Math.abs(fq.discountAmount))}未确认`);
  return parts.join('｜');
}

/** 全店模式：每色 2 行（最高价+商家+排名+毛差 / 积分估算+差额+减价+报价时间） */
function productBlock(item: ProductReportItem, cards: Record<CardId, CardConfig>): string {
  const p = item.product;
  const f = item.filtered;
  if (!f.best) {
    return `${colorEmoji(p.color)} ${p.colorZh}：暂无有效报价`;
  }
  const best = f.best.price;
  const apple = p.applePrice;
  const lines: string[] = [];

  const l1: string[] = [`${colorEmoji(p.color)} ${p.colorZh} ${yen(best)}（${f.best.shopName}）`];
  if (f.second) l1.push(`第二 ${yen(f.second.price)}`);
  if (f.third) l1.push(`第三 ${yen(f.third.price)}`);
  if (f.ichimonme) l1.push(`一丁目 ${yen(f.ichimonme.price)}`);
  l1.push(`毛差 ${yenSigned(best - apple)}`);
  lines.push(l1.join('｜'));

  const l2: string[] = [];
  if (item.analyses.length === 0) {
    const eposR = calcCard(apple, cards.epos);
    const anaR = calcCard(apple, cards.ana);
    l2.push(`EPOS+${yen(eposR.pointsValueYen)}`, `ANA≈${yen(anaR.milesValueYen)}`);
  }
  l2.push(`较上次 ${diffText(best, item.prevBest)}`, `较今早 ${diffText(best, item.morningBest)}`);
  if (f.colorDiscount) {
    l2.push(`⚠️减价 ${yenSigned(-f.colorDiscount.amount)}未确认（保守${yen(best - f.colorDiscount.amount)}）`);
  }
  l2.push(`报价 ${formatIsoShort(f.best.updatedAt)}`);
  lines.push(`  ${l2.join('｜')}`);

  for (const a of item.analyses) lines.push(orderLine(a, cards));
  return lines.join('\n');
}

function countdownBlock(analyses: OrderAnalysis[]): string | null {
  const withDeadline = analyses.filter((a) => a.deadline !== null);
  if (withDeadline.length === 0) return null;
  const lines: string[] = [SEP, '⏳ 退货倒计时'];
  for (const a of withDeadline) {
    const d = a.deadline!;
    const parts = [`🧾 ${a.order.orderRef} ${colorEmoji(a.product.color)}${a.product.colorZh}×${a.order.quantity}`];
    parts.push(`截止 ${formatDateCn(d.date)}${d.estimated ? '（估算）' : '（官方）'}`);
    if (a.suggestApplyDate) parts.push(`最迟申请 ${formatDateCn(a.suggestApplyDate)}`);
    if (a.daysLeft !== null) parts.push(`剩 ${a.daysLeft} 天`);
    lines.push(parts.join('｜'));
  }
  return lines.join('\n');
}

function judgmentBlock(analyses: OrderAnalysis[], warnings: string[], now: Date, focusFooter: string | null): string {
  const lines: string[] = [SEP, '💡 当前判断'];
  if (analyses.length === 0) lines.push('（暂无持有中的订单）');
  for (const a of analyses) {
    lines.push(`${a.suggestion.emoji} ${a.order.orderRef} ${a.suggestion.title}：${a.suggestion.bullets[0] ?? ''}`);
    const w = a.suggestion.warnings[0];
    if (w) lines.push(`   ⚠️ ${w}`);
  }
  for (const w of warnings) lines.push(`⚠️ ${w}`);
  lines.push(focusFooter ?? `🔗 買取X（${formatJstDateTime(now)} 查询）`);
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
  /** true = 聚焦模式（只展示一丁目，每色一行） */
  focusMode?: boolean;
}

export function buildDailyReport(args: DailyReportArgs): string[] {
  const { now, reportType, items, cards, quotaNote, extraWarnings } = args;
  const focusMode = args.focusMode ?? false;
  const label = focusMode
    ? reportType === 'morning' ? '早报' : reportType === 'afternoon' ? '下午报' : '快报'
    : reportType === 'morning' ? '早间报告' : reportType === 'afternoon' ? '下午报告' : '监控报告';
  const headerText = `📱 買取监控·${label}｜🕒 ${formatJstDateTime(now)}`;

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
    const modelHeader = `📦 ${modelKey}｜官网 ${yen(first.product.applePrice)}`;
    const prefix = headerUsed ? '' : `${headerText}\n\n`;
    headerUsed = true;
    const colorBlocks = focusMode
      ? groupItems.map((item) => [focusLine(item), ...item.analyses.map((a) => orderLine(a, cards))].join('\n'))
      : groupItems.map((item) => productBlock(item, cards));
    // 聚焦模式：每个色块之间不加空行，全文更紧凑
    blocks.push(prefix + [modelHeader, ...colorBlocks].join(focusMode ? '\n' : '\n\n'));
  }
  if (!headerUsed) blocks.push(headerText);

  const allAnalyses = items.flatMap((i) => i.analyses);
  const cd = countdownBlock(allAnalyses);
  if (cd) blocks.push(cd);

  // 聚焦模式页脚：一丁目报价更新时间 + 查询时间
  let focusFooter: string | null = null;
  if (focusMode) {
    const times = items
      .map((i) => i.focusQuote?.updatedAt)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .sort();
    const latest = times[times.length - 1];
    focusFooter = latest
      ? `🔗 買取一丁目 ${formatIsoShort(latest)}更新｜${formatJstDateTime(now)} 查询`
      : `🔗 買取一丁目｜${formatJstDateTime(now)} 查询`;
  }

  const warnings = [...extraWarnings];
  if (quotaNote) warnings.push(quotaNote);
  blocks.push(judgmentBlock(allAnalyses, warnings, now, focusFooter));

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
  priceLabel?: string;
}): string {
  const diff = args.current - args.previous;
  const arrow = args.direction === 'up' ? '📈' : '📉';
  const priceLabel = args.priceLabel ?? '最高回收';
  return [
    `🚨 报价异动 ${arrow}`,
    SEP,
    `${colorEmoji(args.product.color)} ${args.product.colorZh}（${args.product.color}）`,
    `${priceLabel}：${yen(args.current)}（${args.shopName}）`,
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
  priceLabel?: string;
}): string {
  const kindLabel = args.kind === 'cash' ? '🎉 首次现金回本' : '🟡 首次综合估值回本（非现金回本）';
  const priceLabel = args.priceLabel ?? '最高回收';
  return [
    kindLabel,
    SEP,
    `🧾 ${args.order.orderRef} ×${args.order.quantity}`,
    `${colorEmoji(args.product.color)} ${args.product.colorZh}（${args.product.color}）`,
    `${priceLabel}：${yen(args.bestPrice)}（${args.shopName}）`,
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
