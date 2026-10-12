// 金额格式化（日元）

export function yen(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `¥${Math.round(n).toLocaleString('en-US')}`;
}

/** 带符号：+¥1,199 / -¥8,800 / ¥0 */
export function yenSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Math.round(n);
  if (v === 0) return '¥0';
  return v > 0 ? `+¥${v.toLocaleString('en-US')}` : `-¥${Math.abs(v).toLocaleString('en-US')}`;
}
