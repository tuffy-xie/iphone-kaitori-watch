// 利润计算：现金口径 + 综合估值口径（积分/里程）

import type { CardConfig } from '../types.ts';
import { calcCard, type CardCalcResult } from './cards.ts';

export interface Fees {
  shipping: number | null;
  transport: number | null;
  handling: number | null;
  /** 已确认会从报价中扣减的金额（仅当 API/商家明确确认时才填写） */
  confirmedDiscount: number | null;
}

export interface ProfitInput {
  /** 每台实际购买价 */
  unitPrice: number;
  quantity: number;
  /** 每台当前最高有效回收价 */
  bestPrice: number | null;
  fees: Fees;
  card: CardConfig;
  /** 订单已申请退货/退款 → 积分可能被撤销 */
  pointsReversed?: boolean;
}

export interface ProfitResult {
  hasQuote: boolean;
  bestPrice: number | null;
  cashGrossPerUnit: number | null;
  cashGrossTotal: number | null;
  cashNetPerUnit: number | null;
  cashNetTotal: number | null;
  pointsValuePerUnit: number;
  milesValuePerUnit: number;
  comprehensiveNetPerUnit: number | null;
  comprehensiveNetTotal: number | null;
  /** 现金回本所需回收价（每台） */
  cashBreakEvenPrice: number | null;
  /** 综合估值回本所需回收价（每台） */
  comprehensiveBreakEvenPrice: number | null;
  cashProfitRate: number | null;
  comprehensiveProfitRate: number | null;
  feesKnown: boolean;
  card: CardCalcResult;
  notes: string[];
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const { unitPrice, quantity, bestPrice, card } = input;
  const notes: string[] = [];
  const qty = quantity > 0 ? quantity : 1;

  const feesKnown =
    input.fees.shipping !== null &&
    input.fees.transport !== null &&
    input.fees.handling !== null &&
    input.fees.confirmedDiscount !== null;
  if (!feesKnown) notes.push('部分费用未知，净利润尚无法确认');

  const feesTotal =
    (input.fees.shipping ?? 0) + (input.fees.transport ?? 0) + (input.fees.handling ?? 0) + (input.fees.confirmedDiscount ?? 0);
  const feesPerUnit = feesTotal / qty;

  let cardCalc = calcCard(unitPrice, card);
  if (input.pointsReversed) {
    cardCalc = {
      ...cardCalc,
      points: 0,
      pointsValueYen: 0,
      miles: 0,
      milesValueYen: 0,
      annualBonusPoints: null,
      annualBonusValueYen: null,
      notes: ['订单已申请退货/退款，积分与里程可能被撤销，按 0 计'],
    };
  }

  const pointsValuePerUnit = cardCalc.pointsValueYen;
  const milesValuePerUnit = cardCalc.milesValueYen;

  if (bestPrice === null) {
    return {
      hasQuote: false,
      bestPrice: null,
      cashGrossPerUnit: null,
      cashGrossTotal: null,
      cashNetPerUnit: null,
      cashNetTotal: null,
      pointsValuePerUnit,
      milesValuePerUnit,
      comprehensiveNetPerUnit: null,
      comprehensiveNetTotal: null,
      cashBreakEvenPrice: null,
      comprehensiveBreakEvenPrice: null,
      cashProfitRate: null,
      comprehensiveProfitRate: null,
      feesKnown,
      card: cardCalc,
      notes: [...notes, '暂无有效回收报价'],
    };
  }

  const cashGrossPerUnit = bestPrice - unitPrice;
  const cashGrossTotal = cashGrossPerUnit * qty;
  const cashNetPerUnit = cashGrossPerUnit - feesPerUnit;
  const cashNetTotal = cashNetPerUnit * qty;
  const comprehensiveNetPerUnit = cashNetPerUnit + pointsValuePerUnit + milesValuePerUnit;
  const comprehensiveNetTotal = comprehensiveNetPerUnit * qty;

  const cashBreakEvenPrice = unitPrice + feesPerUnit;
  const comprehensiveBreakEvenPrice = cashBreakEvenPrice - pointsValuePerUnit - milesValuePerUnit;

  return {
    hasQuote: true,
    bestPrice,
    cashGrossPerUnit,
    cashGrossTotal,
    cashNetPerUnit,
    cashNetTotal,
    pointsValuePerUnit,
    milesValuePerUnit,
    comprehensiveNetPerUnit,
    comprehensiveNetTotal,
    cashBreakEvenPrice,
    comprehensiveBreakEvenPrice,
    cashProfitRate: unitPrice > 0 ? cashNetPerUnit / unitPrice : null,
    comprehensiveProfitRate: unitPrice > 0 ? comprehensiveNetPerUnit / unitPrice : null,
    feesKnown,
    card: cardCalc,
    notes: [...notes, ...cardCalc.notes],
  };
}
