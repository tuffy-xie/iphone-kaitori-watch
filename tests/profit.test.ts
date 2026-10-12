// 验收7：现金及综合回本价格计算（含需求文档中的算例）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProfit } from '../src/analysis/profit.ts';
import { loadCardsFile } from '../src/config/load.ts';

const { cards } = loadCardsFile();
const zeroFees = { shipping: 0, transport: 0, handling: 0, confirmedDiscount: 0 };

test('算例：购买 239800 / 回收 235000 → 现金毛亏 4800；EPOS +1199 → 综合亏 3601', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 235000, fees: zeroFees, card: cards.epos });
  assert.equal(r.cashGrossPerUnit, -4800);
  assert.equal(r.cashNetPerUnit, -4800);
  assert.equal(r.card.points, 1199);
  assert.equal(r.pointsValuePerUnit, 1199);
  assert.equal(r.comprehensiveNetPerUnit, -3601);
});

test('ANA 金卡同场景：综合 = -4800 + 4796 = -4', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 235000, fees: zeroFees, card: cards.ana });
  assert.equal(r.milesValuePerUnit, 4796);
  assert.equal(r.comprehensiveNetPerUnit, -4);
});

test('回本价格：现金回本价 = 购买价 + 费用；综合回本价再扣除积分/里程', () => {
  const fees = { shipping: 1000, transport: 500, handling: 0, confirmedDiscount: 0 };
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 235000, fees, card: cards.epos });
  assert.equal(r.cashBreakEvenPrice, 239800 + 1500);
  assert.equal(r.comprehensiveBreakEvenPrice, 239800 + 1500 - 1199);
  assert.ok(r.comprehensiveBreakEvenPrice! < r.cashBreakEvenPrice!, '积分回本不等于现金回本');
});

test('费用从净利润中扣除；费用未知时标记为无法确认', () => {
  const r = computeProfit({
    unitPrice: 239800, quantity: 1, bestPrice: 241000,
    fees: { shipping: null, transport: 1000, handling: 0, confirmedDiscount: 0 },
    card: cards.epos,
  });
  assert.equal(r.feesKnown, false);
  assert.equal(r.cashNetPerUnit, 241000 - 239800 - 1000);
  assert.ok(r.notes.some((n) => n.includes('尚无法确认')));
});

test('多数量：总额按数量放大，单价指标不变', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 2, bestPrice: 235000, fees: { shipping: 2000, transport: 0, handling: 0, confirmedDiscount: 0 }, card: cards.epos });
  assert.equal(r.cashGrossPerUnit, -4800);
  assert.equal(r.cashGrossTotal, -9600);
  assert.equal(r.cashNetPerUnit, -5800, '运费 2000 分摊到 2 台 = 1000/台');
  assert.equal(r.cashNetTotal, -11600);
  assert.equal(r.comprehensiveNetTotal, -11600 + 2398);
});

test('已申请退货的订单：积分/里程按 0 计（可能被撤销）', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: 235000, fees: zeroFees, card: cards.epos, pointsReversed: true });
  assert.equal(r.pointsValuePerUnit, 0);
  assert.equal(r.comprehensiveNetPerUnit, -4800);
  assert.ok(r.card.notes.some((n) => n.includes('撤销')));
});

test('已确认减价才会从利润中扣减；未确认不扣', () => {
  const r = computeProfit({
    unitPrice: 239800, quantity: 1, bestPrice: 231000,
    fees: { shipping: 0, transport: 0, handling: 0, confirmedDiscount: 17500 },
    card: cards.epos,
  });
  assert.equal(r.cashNetPerUnit, 231000 - 239800 - 17500);
});

test('无报价时报价相关指标为 null', () => {
  const r = computeProfit({ unitPrice: 239800, quantity: 1, bestPrice: null, fees: zeroFees, card: cards.epos });
  assert.equal(r.hasQuote, false);
  assert.equal(r.cashNetPerUnit, null);
  assert.equal(r.cashBreakEvenPrice, null);
});
