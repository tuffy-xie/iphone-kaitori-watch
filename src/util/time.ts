// 日本时间（Asia/Tokyo）工具函数 —— 全系统日期一律以 JST 为准

const TZ = 'Asia/Tokyo';

interface JstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** YYYY-MM-DD */
  date: string;
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function jstParts(d: Date = new Date()): JstParts {
  const parts = partsFormatter.formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  return {
    year,
    month,
    day,
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** 当前 JST 日期字符串 YYYY-MM-DD */
export function todayJst(now: Date = new Date()): string {
  return jstParts(now).date;
}

/** 当前 JST 小时（0-23） */
export function jstHour(now: Date = new Date()): number {
  return jstParts(now).hour;
}

/** '2026/10/12 17:05 JST' */
export function formatJstDateTime(d: Date = new Date()): string {
  const p = jstParts(d);
  return `${p.year}/${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} JST`;
}

/** 日期字符串 -> '10月12日'（Telegram 用） */
export function formatDateCn(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return dateStr;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** ISO 8601（带 +09:00，用于存 DB） */
export function isoNowJst(now: Date = new Date()): string {
  const p = jstParts(now);
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${p.date}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}.${ms}+09:00`;
}

/** YYYY-MM-DD 加减天数 */
export function addDays(dateStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 两个日期间隔天数（to - from） */
export function daysBetween(fromStr: string, toStr: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromStr);
  const pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(toStr);
  if (!pa || !pb) throw new Error(`invalid date: ${fromStr} / ${toStr}`);
  const a = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const b = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((b - a) / 86400000);
}

/** ISO 时间字符串 -> JST 显示 '10/12 16:40' */
export function formatIsoShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = jstParts(d);
  return `${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** 报告类型：由 JST 小时推断 */
export function reportTypeForHour(hour: number, morning: number, afternoon: number): 'morning' | 'afternoon' | 'normal' {
  if (hour === morning) return 'morning';
  if (hour === afternoon) return 'afternoon';
  return 'normal';
}
