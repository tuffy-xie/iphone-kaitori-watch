// 验收1：四种颜色 JAN 校验 + 配置一致性

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProductsFile, loadSettings, loadCardsFile } from '../src/config/load.ts';

const EXPECTED = [
  { color: 'ブラック', colorZh: '黑色', jan: '4549995734546', part: 'MJX54J/A' },
  { color: 'シルバー', colorZh: '银色', jan: '4549995734591', part: 'MJX64J/A' },
  { color: 'バーガンディ', colorZh: '酒红色', jan: '4549995734645', part: 'MJX74J/A' },
  { color: 'グレイシャー', colorZh: '冰川色', jan: '4549995734690', part: 'MJX84J/A' },
];

test('产品配置包含 iPhone 18 Pro Max 256GB 四种颜色，JAN 与需求一致', () => {
  const { products } = loadProductsFile();
  assert.equal(products.length, 4);
  for (const e of EXPECTED) {
    const p = products.find((x) => x.jan === e.jan);
    assert.ok(p, `缺少 JAN ${e.jan}`);
    assert.equal(p!.color, e.color);
    assert.equal(p!.colorZh, e.colorZh);
    assert.equal(p!.model, 'iPhone 18 Pro Max');
    assert.equal(p!.capacity, '256GB');
    assert.equal(p!.part, e.part);
    assert.equal(p!.applePrice, 239800, 'Apple 官方含税价必须为 239800（与官方部件表一致）');
    assert.equal(p!.active, true);
  }
});

test('JAN 格式合法（7-14 位数字）且不重复', () => {
  const { products } = loadProductsFile();
  const jans = products.map((p) => p.jan);
  assert.equal(new Set(jans).size, jans.length);
  for (const jan of jans) assert.match(jan, /^\d{7,14}$/);
});

test('卡片配置：EPOS 200円=1积分、1积分=1日元；ANA 200円=1 J-POINT、1J-POINT=2里程、1里程=2日元', () => {
  const { cards } = loadCardsFile();
  assert.equal(cards.epos.yenPerPointUnit, 200);
  assert.equal(cards.epos.pointsPerUnit, 1);
  assert.equal(cards.epos.yenPerPoint, 1);
  assert.equal(cards.ana.yenPerPointUnit, 200);
  assert.equal(cards.ana.jpointToMiles, 2);
  assert.equal(cards.ana.yenPerMile, 2);
});

test('运行设置：日报时间 9/17 点、限额 30/日、原始数据保留 29 天', () => {
  const s = loadSettings();
  assert.equal(s.reportHoursJst.morning, 9);
  assert.equal(s.reportHoursJst.afternoon, 17);
  assert.equal(s.quota.dailyLimit, 30);
  assert.equal(s.rawDataRetentionDays, 29);
  assert.equal(s.returnDeadlineDaysAfterReceipt, 14);
  assert.equal(s.suggestApplyDaysBeforeDeadline, 1);
  assert.equal(s.priceAlertThresholdYen, 2000);
});
