// 自动出售建议（四种状态）
// 铁律：费用未确认、或商家减价是否已包含无法确认时，不得给出「确定盈利/回本」结论。

import type { ProfitResult } from './profit.ts';

export type SuggestionStatus = 'cash' | 'points' | 'watch' | 'return';

export interface Suggestion {
  status: SuggestionStatus;
  emoji: string;
  title: string;
  bullets: string[];
  warnings: string[];
}

export interface SuggestionInput {
  profit: ProfitResult;
  daysLeft: number | null;
  minProfitYen: number;
  /** 商家减价是否已包含在报价中无法确认 */
  discountUnknown: boolean;
  /** 报价未向商家锁定/确认 */
  quoteNotLocked: boolean;
}

export function buildSuggestion(input: SuggestionInput): Suggestion {
  const { profit, daysLeft, minProfitYen, discountUnknown, quoteNotLocked } = input;
  const warnings: string[] = [];
  if (discountUnknown) {
    warnings.push('商家减价是否已包含在报价中：未确认，未给出确定性盈利建议');
  }
  if (!profit.feesKnown) {
    warnings.push('运费/交通费/手续费未确认，净利润尚无法确认');
  }
  // 只有费用已确认且减价包含情况明确时，才允许下「确定回本」结论
  const canConfirm = profit.feesKnown && !discountUnknown;

  if (!profit.hasQuote) {
    return {
      status: 'watch',
      emoji: '⚪',
      title: '暂无有效报价',
      bullets: ['当前没有过滤后的有效回收报价，无法判断'],
      warnings,
    };
  }

  const cash = profit.cashNetPerUnit ?? 0;
  const comp = profit.comprehensiveNetPerUnit ?? 0;
  const bullets: string[] = [];

  // 状态1：现金回本（仅在所有要素已确认时判定）
  if (canConfirm && cash >= 0 && cash >= minProfitYen) {
    bullets.push('当前公开报价已达到现金回本条件');
    if (quoteNotLocked) bullets.push('报价未向商家锁定，出售前请进一步确认');
    return { status: 'cash', emoji: '✅', title: '现金回本', bullets, warnings };
  }

  // 状态2：积分估值回本（需费用已知；明确标注非现金回本）
  if (profit.feesKnown && comp >= 0 && comp >= minProfitYen) {
    bullets.push('现金仍亏损，计入积分/里程估值后综合收益 ≥ 0');
    bullets.push('仅为综合估值回本，并非现金回本');
    if (discountUnknown) bullets.push('减价包含情况未确认，结论含估算成分');
    return { status: 'points', emoji: '🟡', title: '积分估值回本', bullets, warnings };
  }

  // 状态4：退货预警
  if (daysLeft !== null && daysLeft <= 3) {
    bullets.push(`现金口径亏损 ${Math.round(-cash).toLocaleString('en-US')} 日元，未达到最低收益要求`);
    if (profit.comprehensiveBreakEvenPrice !== null && profit.bestPrice !== null) {
      const gap = profit.comprehensiveBreakEvenPrice - profit.bestPrice;
      if (gap > 0) {
        bullets.push(`综合估值回本还需回收价 ≥ ¥${Math.round(profit.comprehensiveBreakEvenPrice).toLocaleString('en-US')}`);
      }
    }
    bullets.push('建议尽快确认是否申请退货（系统不会自动执行）');
    return { status: 'return', emoji: '🔴', title: '退货预警', bullets, warnings };
  }

  // 状态3：继续观察
  if (!canConfirm && (profit.cashGrossPerUnit ?? 0) >= 0) {
    bullets.push('现金毛差额已转正，但费用/减价未确认，暂不判定回本');
  } else {
    bullets.push(`目前亏损 ${Math.round(-cash).toLocaleString('en-US')} 日元（现金口径）`);
  }
  if (profit.bestPrice !== null && profit.comprehensiveBreakEvenPrice !== null) {
    const gap = profit.comprehensiveBreakEvenPrice - profit.bestPrice;
    bullets.push(
      gap > 0
        ? `距离综合估值回本还差 ¥${Math.round(gap).toLocaleString('en-US')}（回收价需 ≥ ¥${Math.round(profit.comprehensiveBreakEvenPrice).toLocaleString('en-US')}）`
        : '综合估值已回本',
    );
  }
  if (daysLeft !== null) {
    bullets.push(`距退货截止还有 ${daysLeft} 天，可继续观察`);
  } else {
    bullets.push('尚未录入收货日期，无法计算退货截止时间');
  }
  bullets.push('不预测、不保证价格上涨');
  return { status: 'watch', emoji: '🔵', title: '继续观察', bullets, warnings };
}
