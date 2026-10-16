// 验收3：报价有效性过滤（stopped / stale / 过旧 / 非法价格）与排名

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndRank } from '../src/kaitorix/filter.ts';
import { parseProductResponse } from '../src/kaitorix/parse.ts';
import { buildPayload } from './helpers/fixtures.ts';

function make(now = new Date('2026-10-12T09:00:00+09:00')) {
  return parseProductResponse(
    buildPayload({
      jan: '4549995734546',
      name: 'iPhone 18 Pro Max 256GB ブラック MJX54J/A 未開封 SIMフリー',
      now,
      shops: [
        { store: '最高店', key: 'top', price: 231000, minutesAgo: 5 },
        { store: '第二店', key: 'second', price: 229500, minutesAgo: 10 },
        { store: '第三店', key: 'third', price: 228800, minutesAgo: 20 },
        { store: '買取一丁目', key: 'ichoume', price: 225000, minutesAgo: 30 },
        { store: '停止店', key: 'stopshop', price: 240000, stopped: true },
        { store: '陈旧店', key: 'staleshop', price: 239000, stale: true, minutesAgo: 5 * 24 * 60 },
        { store: '无价格店', key: 'noprice', price: null },
        { store: '四天前店', key: 'old', price: 235000, minutesAgo: 4 * 24 * 60 },
      ],
    }),
  ).quotes;
}

test('过滤 stopped/stale/无价格/过旧报价，并按价格降序排名', () => {
  const r = filterAndRank(make(), {
    maxQuoteAgeHours: 72,
    now: new Date('2026-10-12T09:00:00+09:00'),
    specialShopKeys: ['買取一丁目', 'ichoume'],
  });
  assert.equal(r.valid.length, 4);
  assert.equal(r.excluded.length, 4);
  assert.equal(r.best?.shopKey, 'top');
  assert.equal(r.best?.price, 231000);
  assert.equal(r.second?.shopKey, 'second');
  assert.equal(r.third?.shopKey, 'third');
  assert.equal(r.ichimonme?.shopKey, 'ichoume');
  const reasons = r.excluded.map((e) => e.reason).join('|');
  assert.ok(reasons.includes('停止收购'));
  assert.ok(reasons.includes('stale'));
  assert.ok(reasons.includes('价格缺失'));
  assert.ok(reasons.includes('超过 72 小时'));
});

test('stopped 报价即使价格最高也不得作为最高报价（不得直接使用 max_price）', () => {
  // 必须显式传 now：否则按真实当前时间过滤，固定时间的测试数据会全部超过 72h 被滤掉（时间炸弹）
  const r = filterAndRank(make(), { maxQuoteAgeHours: 72, now: new Date('2026-10-12T09:00:00+09:00') });
  assert.notEqual(r.best?.shopKey, 'stopshop');
  assert.ok(r.best!.price < 240000);
});

test('買取一丁目单独识别（key 或名称匹配）', () => {
  const quotes = make();
  const byName = filterAndRank(quotes, { specialShopKeys: ['一丁目'] });
  assert.equal(byName.ichimonme?.shopKey, 'ichoume');
  const byKey = filterAndRank(quotes, { specialShopKeys: ['ichoume'] });
  assert.equal(byKey.ichimonme?.shopKey, 'ichoume');
});

test('颜色减价提示被捕获且标记为"未确认是否包含"', () => {
  const quotes = parseProductResponse(
    buildPayload({
      jan: '4549995734546',
      name: 'iPhone 18 Pro Max 256GB ブラック MJX54J/A 未開封 SIMフリー',
      shops: [
        { store: 'A店', key: 'a', price: 231000, markNote: 'キャンペーン: ブラック -17,500' },
        { store: 'B店', key: 'b', price: 230000 },
      ],
    }),
  ).quotes;
  const r = filterAndRank(quotes, {});
  assert.ok(r.colorDiscount);
  assert.equal(r.colorDiscount!.amount, 17500);
  assert.equal(r.colorDiscount!.included, 'unknown');
  // 最高报价仍是 231000，未被扣减
  assert.equal(r.best?.price, 231000);
});
