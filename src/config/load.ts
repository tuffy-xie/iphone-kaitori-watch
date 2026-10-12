// 配置加载（JSON 配置文件 + 环境变量 + .env 本地文件）

import { readFileSync, existsSync } from 'node:fs';
import type { CardsFile, ProductsFile, Settings } from '../types.ts';

const DEFAULTS: Settings = {
  timezone: 'Asia/Tokyo',
  currency: 'JPY',
  quota: { dailyLimit: 30, tpsMs: 1100, reserveForReports: 8 },
  reportHoursJst: { morning: 9, afternoon: 17 },
  returnReminderThresholdsDays: [7, 3, 2, 1, 0],
  returnDeadlineDaysAfterReceipt: 14,
  suggestApplyDaysBeforeDeadline: 1,
  priceAlertThresholdYen: 2000,
  rawDataRetentionDays: 29,
  maxQuoteAgeHours: 72,
  fees: { shipping: 0, transport: 0, handling: 0 },
  minProfitYen: 0,
  specialShops: { kaitoriIchimonme: ['買取一丁目', 'ichoume'] },
  cardsToCompare: ['epos', 'ana'],
  telegramMaxChars: 3500,
};

function loadJson<T>(relPath: string): T {
  const url = new URL(`../../${relPath}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

export function loadProductsFile(): ProductsFile {
  return loadJson('config/products.json');
}

export function loadCardsFile(): CardsFile {
  return loadJson('config/cards.json');
}

export function loadSettings(): Settings {
  const raw = loadJson('config/settings.json') as Partial<Settings>;
  return {
    ...DEFAULTS,
    ...raw,
    quota: { ...DEFAULTS.quota, ...(raw.quota ?? {}) },
    reportHoursJst: { ...DEFAULTS.reportHoursJst, ...(raw.reportHoursJst ?? {}) },
    fees: { ...DEFAULTS.fees, ...(raw.fees ?? {}) },
    specialShops: { ...DEFAULTS.specialShops, ...(raw.specialShops ?? {}) },
  };
}

/** 极简 .env 解析（本地开发用；GitHub Actions 使用 Secrets，不走此文件） */
export function loadEnvFile(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function envBool(key: string, def = false): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export function envInt(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
