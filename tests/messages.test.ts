// 验收11：Telegram 消息排版

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReport, buildPriceAlert, buildReturnReminder, buildTestMessage, packMessages, colorEmoji } from '../src/notify/messages.ts';
import { loadSettings, loadProductsFile, loadCardsFile } from '../src/config/load.ts';
import { filterAndRank } from '../src/kaitorix/filter.ts';
import { computeProfit } from '../src/analysis/profit.ts';
import { buildSuggestion } from '../src/analysis/suggestion.ts';
import type { OrderAnalysis, ProductReportItem } from '../src/notify/messages.ts';

const settings = loadSettings();
const { products } = loadProductsFile();
const { cards } = loadCardsFile();

function makeItem(): ProductReportItem {
  const product = products[0];
  const quotes = [
    { shopKey: 'sommelier', shopName: '買取ソムリエ', price: 231000, url: null, updatedAt: '2026-10-12T08:50:00+09:00', updatedRel: '17分前', stale: false, stopped: false, markNote: 'キャンペーン: ブラック -17,500', walkinBonus: null, discountAmount: 17500, discountNote: 'キャンペーン: ブラック -17,500' },
    { shopKey: 'shouten', shopName: '買取商店', price: 229500, url: null, updatedAt: '2026-10-12T08:45:00+09:00', updatedRel: '22分前', stale: false, stopped: false, markNote: null, walkinBonus: null, discountAmount: null, discountNote: null },
    { shopKey: 'ichoume', shopName: '買取一丁目', price: 225000, url: null, updatedAt: '2026-10-12T08:40:00+09:00', updatedRel: '27分前', stale: false, stopped: false, markNote: null, walkinBonus: null, discountAmount: null, discountNote: null },
  ];
  const filtered = filterAndRank(quotes, { specialShopKeys: ['買取一丁目', 'ichoume'] });
  const order = {
    id: 1, orderRef: 'IP18PM-BLK-01', jan: product.jan, quantity: 1, unitPrice: 239800, card: 'epos' as const,
    status: 'holding' as const, confirmedDiscount: 0, created_at: '', updated_at: '',
    receivedDate: '2026-10-04',
  };
  const profit = computeProfit({
    unitPrice: order.unitPrice, quantity: 1, bestPrice: filtered.best!.price,
    fees: { shipping: 0, transport: 0, handling: 0, confirmedDiscount: 0 }, card: cards.epos,
  });
  const suggestion = buildSuggestion({ profit, daysLeft: 6, minProfitYen: 0, discountUnknown: true, quoteNotLocked: true });
  const analyses: OrderAnalysis[] = [
    { order: order as never, product, profit, deadline: { date: '2026-10-18', estimated: true, source: 'estimated' }, daysLeft: 6, suggestApplyDate: '2026-10-17', suggestion },
  ];
  return {
    product, latest: { runId: 'r', fetchedAt: '2026-10-12T00:07:00.000+09:00', quotes },
    filtered, prevBest: 227000, morningBest: 230000, best24hAgo: 229000, analyses, dataAgeHours: 0.1,
  };
}

test('日报包含所有必需区块', () => {
  const messages = buildDailyReport({
    now: new Date('2026-10-12T09:05:00+09:00'),
    reportType: 'morning',
    items: [makeItem()],
    cards,
    settings,
    quotaNote: null,
    extraWarnings: [],
  });
  const text = messages.join('\n\n@@@\n\n');
  assert.match(text, /📱 iPhone買取套利监控 · 早间报告/);
  assert.match(text, /🕒 2026\/10\/12 09:05 JST/);
  assert.match(text, /📦 iPhone 18 Pro Max 256GB/);
  assert.match(text, /💴 Apple官网：¥239,800/);
  assert.match(text, /⚫ 黑色（ブラック）/);
  assert.match(text, /最高回收：¥231,000/);
  assert.match(text, /商家：買取ソムリエ/);
  assert.match(text, /第二：¥229,500（買取商店）/);
  assert.match(text, /一丁目：¥225,000（買取一丁目）/);
  assert.match(text, /现金毛差额：-¥8,800\/台（未扣运费等费用）/);
  assert.match(text, /🧾 IP18PM-BLK-01 ×1（EPOS Platinum（EPOS黑卡））/);
  assert.match(text, /💴 购买：¥239,800\/台/);
  assert.match(text, /📉 现金毛差额：-¥8,800\/台（未扣运费等费用）/);
  assert.match(text, /🧮 预计净利润：-¥8,800\/台/);
  assert.match(text, /💎 积分估值收益：1,199pt ≈ ¥1,199（估算，非现金）/);
  assert.match(text, /🔮 综合预计收益：-¥7,601\/台（估算）/);
  assert.match(text, /✅ 实际确认收益（现金）：-¥8,800\/台/);
  assert.match(text, /EPOS：\+¥1,199/);
  assert.match(text, /ANA里程：\+2,398（约 ¥4,796）/);
  assert.match(text, /较上次：\+¥4,000/);
  assert.match(text, /较今早：\+¥1,000/);
  assert.match(text, /24h前：\+¥2,000/);
  assert.match(text, /⏳ 退货倒计时/);
  assert.match(text, /10月18日（估算：收货\+14天）/);
  assert.match(text, /建议最迟申请：10月17日/);
  assert.match(text, /💡 当前判断/);
  assert.match(text, /🔵 IP18PM-BLK-01：继续观察/);
  assert.match(text, /未确认/);
  assert.match(text, /🔗 报价来源：買取X Open API/);
  assert.ok(!text.includes('NaN'), '不得出现 NaN');
});

test('长报告自动分段且不超限', () => {
  const items = Array.from({ length: 12 }, makeItem);
  const messages = buildDailyReport({
    now: new Date('2026-10-12T17:05:00+09:00'),
    reportType: 'afternoon',
    items,
    cards,
    settings,
    quotaNote: '本次未更新报价：测试',
    extraWarnings: ['测试警告'],
  });
  assert.ok(messages.length >= 2);
  for (const m of messages) assert.ok(m.length <= settings.telegramMaxChars, `消息超长: ${m.length}`);
});

test('报价异动/回本/退货提醒/测试消息格式', () => {
  const alert = buildPriceAlert({
    product: products[0], direction: 'up', current: 231000, previous: 227000,
    shopName: '買取ソムリエ', updatedAt: '2026-10-12T08:50:00+09:00',
  });
  assert.match(alert, /🚨 报价异动 📈/);
  assert.match(alert, /\+¥4,000/);

  const reminder = buildReturnReminder({
    order: { orderRef: 'IP18PM-BLK-01', quantity: 1 } as never,
    product: products[0],
    daysLeft: 3,
    deadlineLabel: '10月18日（官方确认）',
    suggestApplyDate: '2026-10-17',
    applyDaysLeft: 5,
    shipDeadlineLabel: null,
    shipDaysLeft: null,
    bestPrice: 231000,
    bestShop: '買取ソムリエ',
    bestUpdatedAt: '2026-10-12T08:50:00+09:00',
    thresholds: [7, 3],
  });
  assert.match(reminder, /⚠️ 退货倒计时提醒/);
  assert.match(reminder, /15% 退货手续费/);
  assert.match(reminder, /系统不会自动退货/);

  const test = buildTestMessage(new Date('2026-10-12T09:00:00+09:00'));
  assert.match(test, /测试消息/);
});

test('packMessages 分块不超限', () => {
  const blocks = ['a'.repeat(3000), 'b'.repeat(3000), 'short'];
  const out = packMessages(blocks, 3500);
  assert.equal(out.length, 2, '贪心打包：前两块各占一条，short 并入第二条');
  for (const m of out) assert.ok(m.length <= 3500);
});

test('颜色 Emoji 映射', () => {
  assert.equal(colorEmoji('ブラック'), '⚫');
  assert.equal(colorEmoji('シルバー'), '⚪');
  assert.equal(colorEmoji('バーガンディ'), '🟥');
  assert.equal(colorEmoji('グレイシャー'), '🔷');
});
