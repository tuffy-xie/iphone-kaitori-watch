// 验收5/6：EPOS 积分计算 + ANA 里程计算

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCard } from '../src/analysis/cards.ts';
import { loadCardsFile } from '../src/config/load.ts';

const { cards } = loadCardsFile();

test('EPOS：239800 日元 → 1199 积分 → ¥1,199', () => {
  const r = calcCard(239800, cards.epos);
  assert.equal(r.points, 1199);
  assert.equal(r.pointsValueYen, 1199);
  assert.equal(r.miles, 0);
  assert.equal(r.annualBonusPoints, null, '未配置阶梯时不估算年度奖励');
});

test('EPOS 年度奖励只按增量计算，且标记为估算', () => {
  const cfg = {
    ...cards.epos,
    annualBonus: {
      enabled: true,
      ytdSpend: 900000,
      tiers: [{ threshold: 1000000, bonusPoints: 5000 }],
    },
  };
  const r = calcCard(239800, cfg);
  // ytd 90万 + 23.98万 = 113.98万 ≥ 100万 → 增量 5000 分
  assert.equal(r.annualBonusPoints, 5000);
  assert.equal(r.annualBonusValueYen, 5000);
  assert.equal(r.annualBonusEstimated, true);
  assert.ok(r.notes.some((n) => n.includes('未计入确定收益')));
});

test('EPOS 年度奖励：未跨阶梯时增量为 0', () => {
  const cfg = {
    ...cards.epos,
    annualBonus: { enabled: true, ytdSpend: 500000, tiers: [{ threshold: 1000000, bonusPoints: 5000 }] },
  };
  const r = calcCard(239800, cfg);
  assert.equal(r.annualBonusPoints, 0);
});

test('ANA：239800 日元 → 1199 J-POINT → 2398 里程 → ¥4,796', () => {
  const r = calcCard(239800, cards.ana);
  assert.equal(r.points, 1199);
  assert.equal(r.miles, 2398);
  assert.equal(r.milesValueYen, 4796);
  assert.equal(r.pointsValueYen, 0, 'ANA 的 J-POINT 默认只按里程估算');
});

test('ANA 转换比例与里程估值可调整（1.5 / 2.5）', () => {
  const r15 = calcCard(239800, { ...cards.ana, jpointToMiles: 1.5, yenPerMile: 1.5 });
  assert.equal(r15.miles, 1798.5);
  assert.equal(r15.milesValueYen, 2697.75);
  const r25 = calcCard(239800, { ...cards.ana, jpointToMiles: 2, yenPerMile: 2.5 });
  assert.equal(r25.milesValueYen, 5995);
});
