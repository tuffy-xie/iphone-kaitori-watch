// 信用卡积分 / 里程计算

import type { AnaCardConfig, CardConfig, EposCardConfig } from '../types.ts';

export interface CardCalcResult {
  /** EPOS 积分 或 ANA J-POINT */
  points: number;
  /** 积分直接折合日元（ANA 的 J-POINT 默认只按里程估算，记 0） */
  pointsValueYen: number;
  /** ANA 里程（EPOS 记 0） */
  miles: number;
  milesValueYen: number;
  /** EPOS 年度奖励增量（参考估算，不计入确定收益） */
  annualBonusPoints: number | null;
  annualBonusValueYen: number | null;
  annualBonusEstimated: boolean;
  notes: string[];
}

function eposBonusAt(cfg: EposCardConfig, spend: number): number {
  let best = 0;
  for (const t of cfg.annualBonus.tiers) {
    if (spend >= t.threshold) best = Math.max(best, t.bonusPoints);
  }
  return best;
}

export function calcCard(priceYen: number, card: CardConfig): CardCalcResult {
  const notes: string[] = [];
  const points = Math.floor(priceYen / card.yenPerPointUnit) * card.pointsPerUnit;

  if (card.type === 'epos_platinum') {
    const pointsValueYen = points * card.yenPerPoint;
    let annualBonusPoints: number | null = null;
    let annualBonusValueYen: number | null = null;
    if (card.annualBonus.enabled && card.annualBonus.tiers.length > 0) {
      annualBonusPoints =
        eposBonusAt(card, card.annualBonus.ytdSpend + priceYen) - eposBonusAt(card, card.annualBonus.ytdSpend);
      annualBonusValueYen = annualBonusPoints * card.yenPerPoint;
      notes.push('年度消费奖励为参考估算，未计入确定收益');
    }
    return {
      points,
      pointsValueYen,
      miles: 0,
      milesValueYen: 0,
      annualBonusPoints,
      annualBonusValueYen,
      annualBonusEstimated: annualBonusPoints !== null,
      notes,
    };
  }

  const ana = card as AnaCardConfig;
  const miles = points * ana.jpointToMiles;
  const milesValueYen = miles * ana.yenPerMile;
  notes.push(`里程按 1 J-POINT = ${ana.jpointToMiles} 里程、1 里程 = ${ana.yenPerMile} 日元估算（非现金）`);
  return {
    points,
    pointsValueYen: 0,
    miles,
    milesValueYen,
    annualBonusPoints: null,
    annualBonusValueYen: null,
    annualBonusEstimated: false,
    notes,
  };
}
