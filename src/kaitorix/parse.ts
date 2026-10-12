// 買取X API 响应解析与归一化
// 依据官方文档字段：store/key/price/url/updated/updated_at/stale/stopped/mark_note/walkin_bonus

import type { NormalizedQuote, ParsedProduct } from '../types.ts';
import type { RawPrice, RawProductResponse } from './client.ts';

/** 从 mark_note 中解析「颜色减价」提示，如「ブラック -17,500」「シルバー -19500」 */
export function parseDiscountNote(markNote: string | null | undefined): { amount: number; note: string } | null {
  if (!markNote) return null;
  const text = markNote.trim();
  if (!text) return null;
  // 全角转半角便于匹配
  const normalized = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/，/g, ',');
  const patterns: RegExp[] = [
    /[-−ー―]\s*([0-9][0-9,]{2,})\s*円?/,          // -17,500 / -17500円
    /([0-9][0-9,]{2,})\s*円\s*(?:減|引き|オフ|値下)/, // 17500円減
    /(?:減価|マイナス|割引)\s*[-:]?\s*([0-9][0-9,]{2,})/, // 減価 17500
  ];
  for (const re of patterns) {
    const m = re.exec(normalized);
    if (m) {
      const amount = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(amount) && amount > 0) return { amount, note: text };
    }
  }
  return null;
}

function normalizePrice(raw: RawPrice): NormalizedQuote {
  const discount = parseDiscountNote(raw.mark_note ?? null);
  return {
    shopKey: String(raw.key ?? ''),
    shopName: String(raw.store ?? ''),
    price: Number(raw.price ?? 0),
    url: raw.url ?? null,
    updatedAt: raw.updated_at ?? null,
    updatedRel: raw.updated ?? null,
    stale: raw.stale === true,
    stopped: raw.stopped === true,
    markNote: raw.mark_note ?? null,
    walkinBonus: typeof raw.walkin_bonus === 'number' ? raw.walkin_bonus : null,
    discountAmount: discount?.amount ?? null,
    discountNote: discount?.note ?? null,
  };
}

export interface ParseExpectation {
  jan?: string;
  model?: string;
  color?: string;
}

export function parseProductResponse(json: RawProductResponse, expected?: ParseExpectation): ParsedProduct {
  const warnings: string[] = [];
  const quotes = (json.prices ?? []).map(normalizePrice);

  if (expected?.jan && json.jan && json.jan !== expected.jan) {
    warnings.push(`返回 JAN(${json.jan}) 与预期(${expected.jan}) 不一致`);
  }
  if (expected?.model && json.name && !json.name.includes(expected.model)) {
    warnings.push(`商品名称与预期型号不符: ${json.name}`);
  }
  if (expected?.color && json.name && !json.name.includes(expected.color)) {
    warnings.push(`商品名称中未找到预期颜色「${expected.color}」: ${json.name}（请核对 JAN 与颜色对应关系）`);
  }
  if (!json.name) warnings.push('商品名称为空');

  return {
    jan: json.jan ?? null,
    name: json.name ?? '',
    maxPrice: typeof json.max_price === 'number' ? json.max_price : null,
    quotes,
    warnings,
  };
}
