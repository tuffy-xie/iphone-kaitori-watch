// Mock 数据：无 API Key 时的演练数据（DRY_RUN / 测试用）
// 结构严格模仿官方文档响应示例；仅用于跑通流程，不代表真实行情

import type { RawPrice, RawProductResponse } from './client.ts';

export const MOCK_JAN_PRICES: Record<string, number> = {
  '4549995734546': 231000, // 黑色
  '4549995734591': 238800, // 银色
  '4549995734645': 233000, // 酒红色
  '4549995734690': 241000, // 冰川色
};

const MOCK_NAMES: Record<string, string> = {
  '4549995734546': 'iPhone 18 Pro Max 256GB ブラック MJX54J/A 未開封 SIMフリー',
  '4549995734591': 'iPhone 18 Pro Max 256GB シルバー MJX64J/A 未開封 SIMフリー',
  '4549995734645': 'iPhone 18 Pro Max 256GB バーガンディ MJX74J/A 未開封 SIMフリー',
  '4549995734690': 'iPhone 18 Pro Max 256GB グレイシャー MJX84J/A 未開封 SIMフリー',
};

const MOCK_SHOPS: { store: string; key: string; offset: number }[] = [
  { store: '買取ソムリエ', key: 'sommelier', offset: 0 },
  { store: '買取一丁目', key: 'ichoume', offset: -3000 },
  { store: '買取商店', key: 'shouten', offset: -1500 },
  { store: 'ブランド古泉', key: 'kosen', offset: -4200 },
  { store: 'トウキョウジャンク', key: 'junk', offset: -6800 },
  { store: 'スマホ買取本舗', key: 'honpo', offset: -5200 },
  { store: 'モバイル王国', key: 'mobile_oukoku', offset: -7400 },
  { store: 'デジタルドラゴン', key: 'digidragon', offset: -6100 },
  { store: 'イオウ', key: 'iou', offset: -8900 },
  { store: '携帯空間', key: 'keitai_kukan', offset: -9500 },
  { store: 'ゴールドプラザ', key: 'goldplaza', offset: -12000 },
  { store: 'リファン', key: 'refan', offset: -13500 },
  { store: 'Stop店（示例）', key: 'stopshop', offset: -8000 },
  { store: 'Stale店（示例）', key: 'staleshop', offset: -7000 },
];

function isoMinutesAgo(min: number, now: Date): string {
  const d = new Date(now.getTime() - min * 60000);
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().replace('Z', '+09:00').replace('.000', '');
}

export function mockProductResponse(jan: string, now: Date = new Date()): RawProductResponse {
  const base = MOCK_JAN_PRICES[jan] ?? 220000;
  const prices: RawPrice[] = MOCK_SHOPS.map((s, i) => {
    const stopped = s.key === 'stopshop';
    const stale = s.key === 'staleshop';
    const minutesAgo = stale ? 5 * 24 * 60 : 3 + i * 7;
    return {
      store: s.store,
      key: s.key,
      price: base + s.offset,
      url: `https://kaitorix.app/search?q=${jan}`,
      updated: stale ? '5日前' : `${minutesAgo}分前`,
      updated_at: isoMinutesAgo(minutesAgo, now),
      stale,
      stopped,
      // 黑色/银色带颜色减价提示（是否已包含在报价中：未确认）
      mark_note:
        (jan === '4549995734546' || jan === '4549995734591') && i < 4
          ? `キャンペーン: ${jan === '4549995734546' ? 'ブラック' : 'シルバー'} -${jan === '4549995734546' ? '17,500' : '19,500'}`
          : null,
      walkin_bonus: null,
    };
  });
  return {
    jan,
    name: MOCK_NAMES[jan] ?? `Mock Product ${jan}`,
    max_price: base,
    prices,
  };
}

/** 生成一个返回 Mock 数据的 fetch（供 client / 测试注入） */
export function createMockFetch(now: Date = new Date()): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/open\/api\/product\/([^/?]+)/.exec(url);
    const jan = m ? decodeURIComponent(m[1]) : '';
    const body = mockProductResponse(jan, now);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': '29',
        'X-RateLimit-Reset': String(Math.floor(now.getTime() / 1000)),
      },
    });
  }) as typeof fetch;
}
