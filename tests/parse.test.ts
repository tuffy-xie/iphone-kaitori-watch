// 验收2/4：買取X 真实响应结构解析 + 颜色减价不重复扣除

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscountNote, parseProductResponse } from '../src/kaitorix/parse.ts';
import { buildPayload } from './helpers/fixtures.ts';

const DOC_SAMPLE = {
  jan: '4549995649284',
  name: 'iPhone 17 Pro Max 256GB シルバー MFY84J/A 未開封 SIMフリー',
  max_price: 220000,
  prices: [
    { store: '買取一丁目', key: 'ichoume', price: 220000, url: 'https://x', updated: '8分前', updated_at: '2026-10-12T14:52:00+09:00', stale: false, stopped: false },
    { store: '買取商店', key: 'shouten', price: 220000, url: 'https://x', updated: '13分前', updated_at: '2026-10-12T14:47:00+09:00', stale: false, stopped: false },
  ],
};

test('按官方文档字段解析响应（store/key/price/url/updated/updated_at/stale/stopped）', () => {
  const parsed = parseProductResponse(DOC_SAMPLE, { jan: '4549995649284' });
  assert.equal(parsed.jan, '4549995649284');
  assert.equal(parsed.name, DOC_SAMPLE.name);
  assert.equal(parsed.maxPrice, 220000);
  assert.equal(parsed.quotes.length, 2);
  const q = parsed.quotes[0];
  assert.equal(q.shopName, '買取一丁目');
  assert.equal(q.shopKey, 'ichoume');
  assert.equal(q.price, 220000);
  assert.equal(q.url, 'https://x');
  assert.equal(q.updatedAt, '2026-10-12T14:52:00+09:00');
  assert.equal(q.updatedRel, '8分前');
  assert.equal(q.stale, false);
  assert.equal(q.stopped, false);
  assert.deepEqual(parsed.warnings, []);
});

test('名称与预期型号/颜色不符时产生警告', () => {
  const parsed = parseProductResponse(DOC_SAMPLE, { jan: '4549995649284', model: 'iPhone 18 Pro Max', color: 'ブラック' });
  assert.ok(parsed.warnings.some((w) => w.includes('型号')));
  assert.ok(parsed.warnings.some((w) => w.includes('ブラック')));
});

test('mark_note 颜色减价解析：ブラック -17,500 / シルバー -19500', () => {
  assert.deepEqual(parseDiscountNote('キャンペーン: ブラック -17,500'), { amount: 17500, note: 'キャンペーン: ブラック -17,500' });
  assert.deepEqual(parseDiscountNote('シルバー -19500'), { amount: 19500, note: 'シルバー -19500' });
  assert.deepEqual(parseDiscountNote('17500円減'), { amount: 17500, note: '17500円減' });
  assert.equal(parseDiscountNote(null), null);
  assert.equal(parseDiscountNote('通常通り'), null);
});

test('颜色减价只作为提示记录，不改变报价本身', () => {
  const payload = buildPayload({
    jan: '4549995734546',
    name: 'iPhone 18 Pro Max 256GB ブラック MJX54J/A 未開封 SIMフリー',
    shops: [
      { store: 'A店', key: 'a', price: 231000, markNote: 'キャンペーン: ブラック -17,500' },
      { store: 'B店', key: 'b', price: 230000 },
    ],
  });
  const parsed = parseProductResponse(payload, { jan: '4549995734546', model: 'iPhone 18 Pro Max', color: 'ブラック' });
  assert.equal(parsed.quotes[0].price, 231000, '报价不得因减价提示被修改');
  assert.equal(parsed.quotes[0].discountAmount, 17500);
  assert.equal(parsed.quotes[0].discountNote, 'キャンペーン: ブラック -17,500');
  assert.equal(parsed.maxPrice, 231000);
});
