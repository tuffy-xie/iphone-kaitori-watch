// 报价有效性过滤与排名
// 规则：排除 stopped / stale / 价格缺失或非法 / 报价过旧；不使用顶层 max_price，一律从过滤后的 prices[] 计算

import type { NormalizedQuote, QuoteFilterResult } from '../types.ts';

export interface FilterOptions {
  excludeStopped?: boolean;
  excludeStale?: boolean;
  maxQuoteAgeHours?: number;
  now?: Date;
  /** 買取一丁目的 key 或名称（大小写不敏感包含匹配） */
  specialShopKeys?: string[];
}

function isTooOld(q: NormalizedQuote, maxAgeHours: number | undefined, now: Date): boolean {
  if (!maxAgeHours || !q.updatedAt) return false;
  const t = new Date(q.updatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > maxAgeHours * 3600 * 1000;
}

export function filterAndRank(quotes: NormalizedQuote[], opts: FilterOptions = {}): QuoteFilterResult {
  const excludeStopped = opts.excludeStopped ?? true;
  const excludeStale = opts.excludeStale ?? true;
  const now = opts.now ?? new Date();
  const specialKeys = (opts.specialShopKeys ?? []).map((s) => s.toLowerCase());

  const valid: NormalizedQuote[] = [];
  const excluded: { quote: NormalizedQuote; reason: string }[] = [];

  for (const q of quotes) {
    if (!q.shopKey) {
      excluded.push({ quote: q, reason: '缺少店铺标识 key' });
      continue;
    }
    if (!Number.isFinite(q.price) || q.price <= 0) {
      excluded.push({ quote: q, reason: '价格缺失或非法' });
      continue;
    }
    if (excludeStopped && q.stopped) {
      excluded.push({ quote: q, reason: '店铺已停止收购该商品' });
      continue;
    }
    if (excludeStale && q.stale) {
      excluded.push({ quote: q, reason: '报价超过 3 天未更新（stale）' });
      continue;
    }
    if (isTooOld(q, opts.maxQuoteAgeHours, now)) {
      excluded.push({ quote: q, reason: `报价更新时间超过 ${opts.maxQuoteAgeHours} 小时` });
      continue;
    }
    valid.push(q);
  }

  valid.sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });

  const ichimonme =
    valid.find(
      (q) =>
        specialKeys.includes(q.shopKey.toLowerCase()) ||
        specialKeys.some((k) => q.shopName.toLowerCase().includes(k)),
    ) ?? null;

  // 颜色减价提示：取有效报价中第一个带减价注记的（是否已包含在报价中：未确认，绝不自动扣减）
  const withDiscount = valid.find((q) => q.discountAmount !== null && q.discountAmount > 0);
  const colorDiscount = withDiscount?.discountAmount
    ? { amount: withDiscount.discountAmount, note: withDiscount.discountNote ?? '', included: 'unknown' as const }
    : null;

  return {
    valid,
    excluded,
    best: valid[0] ?? null,
    second: valid[1] ?? null,
    third: valid[2] ?? null,
    ichimonme,
    colorDiscount,
  };
}
