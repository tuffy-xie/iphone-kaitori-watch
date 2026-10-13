// 利润展示验证：四个口径分明；费用/减价未确认时不得判定确定收益

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProfit } from '../src/analysis/profit.ts';
import { buildSuggestion } from '../src/analysis/suggestion.ts';
import { buildDailyReport } from '../src/notify/messages.ts';
import { filterAndRank } from '../src/kaitorix/filter.ts';
import type { NormalizedQuote, OrderRecord, ProductConfig } from '../src/types.ts';
import type { OrderAnalysis, ProductReportItem } from '../src/notify/messages.ts';
import { loadSettings, loadProductsFile, loadCardsFile } from '../src/config/load.ts';

const settings = loadSettings();
const { products } = loadProductsFile();
const { cards } = loadCardsFile();
const product = products[0];

const zeroFees = { shipping: 0, transport: 0, handling: 0, confirmedDiscount: 0 };
const unknownFees = { shipping: null, transport: null, handling: null, confirmedDiscount: 0 };

test('费用未确认：即使现金毛差额转正，也不判定现金回本', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 245000, fees: unknownFees, card: cards.epos });
  assert.equal(r.feesKnown, false);
  assert.equal(r.cashGrossPerUnit, 5200, '毛差额仍可计算');
  const s = buildSuggestion({ profit: r, daysLeft: 10, minProfitYen: 0, discountUnknown: false, quoteNotLocked: true });
  assert.equal(s.status, 'watch', '不得判定 ✅ 现金回本');
  assert.ok(s.bullets.some((b) => b.includes('暂不判定回本')));
  assert.ok(s.warnings.some((w) => w.includes('尚无法确认')));
});

test('减价包含情况未确认：即使现金净利润为正，也不给确定性盈利建议', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 245000, fees: zeroFees, card: cards.epos });
  assert.equal(r.feesKnown, true);
  const s = buildSuggestion({ profit: r, daysLeft: 10, minProfitYen: 0, discountUnknown: true, quoteNotLocked: true });
  assert.notEqual(s.status, 'cash');
  assert.ok(s.warnings.some((w) => w.includes('未确认')));
});

test('费用与减价均已确认：恢复现金回本判定', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 245000, fees: zeroFees, card: cards.epos });
  const s = buildSuggestion({ profit: r, daysLeft: 10, minProfitYen: 0, discountUnknown: false, quoteNotLocked: true });
  assert.equal(s.status, 'cash');
  assert.equal(s.emoji, '✅');
});

test('积分估值回本需要费用已知（费用未知时降级为继续观察）', () => {
  // 毛差额 -1000，EPOS +1199 → 综合 +199，但费用未知
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 238800, fees: unknownFees, card: cards.epos });
  const s = buildSuggestion({ profit: r, daysLeft: 10, minProfitYen: 0, discountUnknown: false, quoteNotLocked: true });
  assert.notEqual(s.status, 'points');
  assert.equal(s.status, 'watch');
  // 费用已知时恢复 🟡
  const r2 = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 238800, fees: zeroFees, card: cards.epos });
  const s2 = buildSuggestion({ profit: r2, daysLeft: 10, minProfitYen: 0, discountUnknown: false, quoteNotLocked: true });
  assert.equal(s2.status, 'points');
});

function makeOrder(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 1,
    orderRef: 'DEMO-01',
    jan: product.jan,
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

function makeItem(order: OrderRecord, bestPrice: number): ProductReportItem {
  const quotes: NormalizedQuote[] = [
    { shopKey: 'sommelier', shopName: '買取ソムリエ', price: bestPrice, url: null, updatedAt: '2026-10-12T08:50:00+09:00', updatedRel: '17分前', stale: false, stopped: false, markNote: null, walkinBonus: null, discountAmount: null, discountNote: null },
  ];
  const filtered = filterAndRank(quotes, {});
  const profit = computeProfit({
    unitPrice: order.unitPrice,
    quantity: order.quantity,
    bestPrice,
    fees: {
      shipping: order.fees?.shipping ?? null,
      transport: order.fees?.transport ?? null,
      handling: order.fees?.handling ?? null,
      confirmedDiscount: order.confirmedDiscount ?? 0,
    },
    card: cards[order.card],
    pointsReversed: ['return_requested', 'return_shipped', 'refunded'].includes(order.status),
  });
  const suggestion = buildSuggestion({ profit, daysLeft: 10, minProfitYen: 0, discountUnknown: false, quoteNotLocked: true });
  const analyses: OrderAnalysis[] = [
    { order, product, profit, deadline: null, daysLeft: 10, suggestApplyDate: null, suggestion },
  ];
  return {
    product,
    latest: { runId: 'r', fetchedAt: '2026-10-12T00:07:00.000+09:00', quotes },
    filtered,
    prevBest: null,
    morningBest: null,
    best24hAgo: null,
    analyses,
    dataAgeHours: 0.1,
  };
}

test('日报订单区：费用未确认时四个口径分明，不出现确定净利润', () => {
  const order = makeOrder({ fees: { shipping: null, transport: null, handling: null } });
  const messages = buildDailyReport({
    now: new Date('2026-10-12T09:05:00+09:00'),
    reportType: 'morning',
    items: [makeItem(order, 245000)],
    cards,
    settings,
    quotaNote: null,
    extraWarnings: [],
  });
  const text = messages.join('\n');
  assert.match(text, /🧾 DEMO-01 ×1 EPOS黑卡｜购买 ¥239,800/);
  assert.match(text, /毛差 \+¥5,200｜预计净利 未确认｜综合 未估算｜实际确认 暂无 ⚠️费用未确认/);
  assert.doesNotMatch(text, /预计净利 \+¥5,200/, '不得把毛差额当作确定净利润');
  assert.doesNotMatch(text, /实际确认 \+¥5,200/);
});

test('日报订单区：费用已确认时显示预计净利润与实际确认收益', () => {
  const order = makeOrder({ fees: { shipping: 0, transport: 0, handling: 0 } });
  const messages = buildDailyReport({
    now: new Date('2026-10-12T09:05:00+09:00'),
    reportType: 'morning',
    items: [makeItem(order, 235000)],
    cards,
    settings,
    quotaNote: null,
    extraWarnings: [],
  });
  const text = messages.join('\n');
  assert.match(text, /🧾 DEMO-01 ×1 EPOS黑卡｜购买 ¥239,800/);
  assert.match(text, /毛差 -¥4,800｜预计净利 -¥4,800｜积分估值 \+¥1,199｜综合 -¥3,601｜实际确认 -¥4,800/);
  assert.doesNotMatch(text, /尚无法确定/);
});

test('ANA 卡订单：积分估值按 J-POINT → 里程展示', () => {
  const order = makeOrder({ card: 'ana', fees: { shipping: 0, transport: 0, handling: 0 } });
  const messages = buildDailyReport({
    now: new Date('2026-10-12T09:05:00+09:00'),
    reportType: 'morning',
    items: [makeItem(order, 235000)],
    cards,
    settings,
    quotaNote: null,
    extraWarnings: [],
  });
  const text = messages.join('\n');
  assert.match(text, /🧾 DEMO-01 ×1 ANA金卡｜购买 ¥239,800/);
  assert.match(text, /毛差 -¥4,800｜预计净利 -¥4,800｜积分估值 \+¥4,796｜综合 -¥4｜实际确认 -¥4,800/);
});

test('已申请退货的订单：积分估值按 0 计并说明原因', () => {
  const order = makeOrder({ status: 'return_requested', fees: { shipping: 0, transport: 0, handling: 0 } });
  const messages = buildDailyReport({
    now: new Date('2026-10-12T09:05:00+09:00'),
    reportType: 'morning',
    items: [makeItem(order, 235000)],
    cards,
    settings,
    quotaNote: null,
    extraWarnings: [],
  });
  const text = messages.join('\n');
  assert.match(text, /🧾 DEMO-01 ×1 EPOS黑卡｜购买 ¥239,800/);
  assert.match(text, /毛差 -¥4,800｜预计净利 -¥4,800｜积分估值 ¥0（已申请退货）｜综合 -¥4,800｜实际确认 -¥4,800/);
});
