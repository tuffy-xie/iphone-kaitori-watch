// 全局共享类型定义

export type CardId = 'epos' | 'ana';

export interface ProductConfig {
  id: string;
  model: string;
  capacity: string;
  color: string;
  colorZh: string;
  jan: string;
  part?: string;
  applePrice: number;
  active: boolean;
}

export interface ProductsFile {
  products: ProductConfig[];
}

export interface EposCardConfig {
  type: 'epos_platinum';
  label: string;
  /** 每多少日元 */
  yenPerPointUnit: number;
  /** 获得多少积分 */
  pointsPerUnit: number;
  /** 1 积分折合日元 */
  yenPerPoint: number;
  annualBonus: {
    enabled: boolean;
    /** 当前年度累计消费（日元） */
    ytdSpend: number;
    /** 奖励阶梯：达到 threshold 消费时获得 bonusPoints（一次性） */
    tiers: { threshold: number; bonusPoints: number }[];
  };
}

export interface AnaCardConfig {
  type: 'ana_gold';
  label: string;
  yenPerPointUnit: number;
  pointsPerUnit: number;
  /** 1 J-POINT 可转换的 ANA 里程数 */
  jpointToMiles: number;
  /** 1 里程折合日元 */
  yenPerMile: number;
}

export type CardConfig = EposCardConfig | AnaCardConfig;

export interface CardsFile {
  cards: { epos: EposCardConfig; ana: AnaCardConfig };
}

export interface Settings {
  timezone: string;
  currency: string;
  quota: {
    dailyLimit: number;
    tpsMs: number;
    reserveForReports: number;
  };
  reportHoursJst: { morning: number; afternoon: number };
  returnReminderThresholdsDays: number[];
  returnDeadlineDaysAfterReceipt: number;
  suggestApplyDaysBeforeDeadline: number;
  priceAlertThresholdYen: number;
  rawDataRetentionDays: number;
  maxQuoteAgeHours: number;
  /** 默认费用；null = 未确认（展示"净利润尚无法确定"） */
  fees: { shipping: number | null; transport: number | null; handling: number | null };
  minProfitYen: number;
  specialShops: { kaitoriIchimonme: string[] };
  cardsToCompare: CardId[];
  telegramMaxChars: number;
}

// ---------- 订单 ----------

export type OrderStatus =
  | 'pending_delivery'
  | 'received'
  | 'holding'
  | 'sold'
  | 'return_requested'
  | 'return_shipped'
  | 'refunded'
  | 'cancelled';

/** 仍持有（需要监控与退货倒计时）的状态 */
export const HELD_STATUSES: OrderStatus[] = [
  'pending_delivery',
  'received',
  'holding',
  'return_requested',
  'return_shipped',
];

export interface OrderInput {
  orderRef: string;
  jan: string;
  quantity?: number;
  unitPrice: number;
  card?: CardId;
  purchaseDate?: string | null;
  etaDate?: string | null;
  receivedDate?: string | null;
  /** 官方确认的退货截止日期（优先于估算） */
  returnDeadlineConfirmed?: string | null;
  /** 退货寄出截止日期（与申请截止不是一回事） */
  returnShipDeadline?: string | null;
  status?: OrderStatus;
  soldPrice?: number | null;
  fees?: { shipping?: number | null; transport?: number | null; handling?: number | null };
  confirmedDiscount?: number | null;
  notes?: string | null;
}

export interface OrderRecord extends OrderInput {
  id: number;
  quantity: number;
  card: CardId;
  status: OrderStatus;
  confirmedDiscount: number;
  created_at: string;
  updated_at: string;
}

// ---------- 报价 ----------

export interface NormalizedQuote {
  shopKey: string;
  shopName: string;
  price: number;
  url: string | null;
  updatedAt: string | null;
  updatedRel: string | null;
  stale: boolean;
  stopped: boolean;
  markNote: string | null;
  walkinBonus: number | null;
  /** 从 mark_note 解析出的减价金额（正数表示扣减），仅作参考展示 */
  discountAmount: number | null;
  discountNote: string | null;
}

export interface QuoteFilterResult {
  valid: NormalizedQuote[];
  excluded: { quote: NormalizedQuote; reason: string }[];
  best: NormalizedQuote | null;
  second: NormalizedQuote | null;
  third: NormalizedQuote | null;
  ichimonme: NormalizedQuote | null;
  /** 全量报价中出现过的颜色减价提示（是否已包含在报价中：未确认） */
  colorDiscount: { amount: number; note: string; included: 'unknown' } | null;
}

export interface ParsedProduct {
  jan: string | null;
  name: string;
  maxPrice: number | null;
  quotes: NormalizedQuote[];
  warnings: string[];
}

// ---------- 数据库 ----------

export interface Row {
  [key: string]: unknown;
}

export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
  exec(sql: string): Promise<void>;
}
