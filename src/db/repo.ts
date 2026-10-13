// 数据仓储层：产品 / 订单 / 报价 / 聚合 / 额度 / 通知去重 / 系统状态 / 运行日志

import type {
  NormalizedQuote,
  OrderInput,
  OrderRecord,
  OrderStatus,
  ProductConfig,
  QuoteFilterResult,
} from '../types.ts';
import type { Db } from '../types.ts';

// ---------- 产品 ----------

export async function upsertProduct(db: Db, p: ProductConfig): Promise<void> {
  await db.run(
    `INSERT INTO products (product_key, model, capacity, color, color_zh, jan, part, apple_price, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(product_key) DO UPDATE SET
       model = excluded.model, capacity = excluded.capacity, color = excluded.color,
       color_zh = excluded.color_zh, jan = excluded.jan, part = excluded.part,
       apple_price = excluded.apple_price, active = excluded.active, updated_at = datetime('now')`,
    [p.id, p.model, p.capacity, p.color, p.colorZh, p.jan, p.part ?? null, p.applePrice, p.active ? 1 : 0],
  );
}

export async function listActiveProducts(db: Db): Promise<ProductConfig[]> {
  const rows = await db.query<{
    product_key: string; model: string; capacity: string; color: string; color_zh: string;
    jan: string; part: string | null; apple_price: number;
  }>(
    'SELECT product_key, model, capacity, color, color_zh, jan, part, apple_price FROM products WHERE active = 1',
  );
  return rows.map((r) => ({
    id: r.product_key,
    model: r.model,
    capacity: r.capacity,
    color: r.color,
    colorZh: r.color_zh ?? r.color,
    jan: r.jan,
    part: r.part ?? undefined,
    applePrice: Number(r.apple_price),
    active: true,
  }));
}

// ---------- 订单 ----------

export async function upsertOrder(db: Db, o: OrderInput): Promise<void> {
  await db.run(
    `INSERT INTO orders (order_ref, jan, quantity, unit_price, card, purchase_date, eta_date, received_date,
                         return_deadline_confirmed, return_ship_deadline, status, sold_price,
                         fees_shipping, fees_transport, fees_handling, confirmed_discount, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(order_ref) DO UPDATE SET
       jan = excluded.jan, quantity = excluded.quantity, unit_price = excluded.unit_price, card = excluded.card,
       purchase_date = excluded.purchase_date, eta_date = excluded.eta_date, received_date = excluded.received_date,
       return_deadline_confirmed = excluded.return_deadline_confirmed, return_ship_deadline = excluded.return_ship_deadline,
       status = excluded.status, sold_price = excluded.sold_price,
       fees_shipping = excluded.fees_shipping, fees_transport = excluded.fees_transport,
       fees_handling = excluded.fees_handling, confirmed_discount = excluded.confirmed_discount,
       notes = excluded.notes, updated_at = datetime('now')`,
    [
      o.orderRef,
      o.jan,
      o.quantity ?? 1,
      o.unitPrice,
      o.card ?? 'epos',
      o.purchaseDate ?? null,
      o.etaDate ?? null,
      o.receivedDate ?? null,
      o.returnDeadlineConfirmed ?? null,
      o.returnShipDeadline ?? null,
      o.status ?? 'pending_delivery',
      o.soldPrice ?? null,
      o.fees?.shipping ?? null,
      o.fees?.transport ?? null,
      o.fees?.handling ?? null,
      o.confirmedDiscount ?? 0,
      o.notes ?? null,
    ],
  );
}

interface OrderRow {
  id: number; order_ref: string; jan: string; quantity: number; unit_price: number; card: string;
  purchase_date: string | null; eta_date: string | null; received_date: string | null;
  return_deadline_confirmed: string | null; return_ship_deadline: string | null; status: string;
  sold_price: number | null; fees_shipping: number | null; fees_transport: number | null;
  fees_handling: number | null; confirmed_discount: number; notes: string | null;
  created_at: string; updated_at: string;
}

function rowToOrder(r: OrderRow): OrderRecord {
  return {
    id: r.id,
    orderRef: r.order_ref,
    jan: r.jan,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    card: r.card as OrderRecord['card'],
    purchaseDate: r.purchase_date,
    etaDate: r.eta_date,
    receivedDate: r.received_date,
    returnDeadlineConfirmed: r.return_deadline_confirmed,
    returnShipDeadline: r.return_ship_deadline,
    status: r.status as OrderStatus,
    soldPrice: r.sold_price === null ? null : Number(r.sold_price),
    fees: { shipping: r.fees_shipping, transport: r.fees_transport, handling: r.fees_handling },
    confirmedDiscount: Number(r.confirmed_discount ?? 0),
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listOrders(db: Db): Promise<OrderRecord[]> {
  const rows = await db.query<OrderRow>('SELECT * FROM orders ORDER BY created_at ASC');
  return rows.map(rowToOrder);
}

export async function listHeldOrders(db: Db): Promise<OrderRecord[]> {
  const rows = await db.query<OrderRow>(
    `SELECT * FROM orders WHERE status IN ('pending_delivery','received','holding','return_requested','return_shipped')
     ORDER BY created_at ASC`,
  );
  return rows.map(rowToOrder);
}

export async function getOrderByRef(db: Db, ref: string): Promise<OrderRecord | null> {
  const rows = await db.query<OrderRow>('SELECT * FROM orders WHERE order_ref = ?', [ref]);
  return rows[0] ? rowToOrder(rows[0]) : null;
}

// ---------- 报价 ----------

export async function insertSnapshot(db: Db, args: { runId: string; jan: string; fetchedAt: string; payload: unknown }): Promise<void> {
  await db.run('INSERT INTO quote_snapshots (run_id, jan, fetched_at, payload) VALUES (?, ?, ?, ?)', [
    args.runId,
    args.jan,
    args.fetchedAt,
    JSON.stringify(args.payload),
  ]);
}

const QUOTE_COLS = [
  'run_id', 'jan', 'fetched_at', 'shop_key', 'shop_name', 'price', 'url', 'quote_updated_at',
  'quote_updated_rel', 'stale', 'stopped', 'mark_note', 'walkin_bonus', 'discount_amount', 'discount_note',
  'rank_no', 'is_ichimonme',
] as const;

export async function insertQuotes(
  db: Db,
  args: { runId: string; jan: string; fetchedAt: string; quotes: NormalizedQuote[]; filtered: QuoteFilterResult },
): Promise<void> {
  const rankMap = new Map<string, number>();
  args.filtered.valid.forEach((q, i) => rankMap.set(q.shopKey, i + 1));
  const ichimonmeKey = args.filtered.ichimonme?.shopKey ?? null;

  const rows = args.quotes.map((q) => [
    args.runId,
    args.jan,
    args.fetchedAt,
    q.shopKey,
    q.shopName,
    q.price,
    q.url,
    q.updatedAt,
    q.updatedRel,
    q.stale ? 1 : 0,
    q.stopped ? 1 : 0,
    q.markNote,
    q.walkinBonus,
    q.discountAmount,
    q.discountNote,
    rankMap.get(q.shopKey) ?? null,
    ichimonmeKey !== null && q.shopKey === ichimonmeKey ? 1 : 0,
  ]);

  // 分块多行 INSERT（每块 5 行，控制 D1 绑定参数数量）
  const CHUNK = 5;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => `(${QUOTE_COLS.map(() => '?').join(',')})`).join(',');
    const params = chunk.flat();
    await db.run(`INSERT INTO quotes (${QUOTE_COLS.join(',')}) VALUES ${placeholders}`, params);
  }
}

interface QuoteRow {
  run_id: string; jan: string; fetched_at: string; shop_key: string; shop_name: string; price: number;
  url: string | null; quote_updated_at: string | null; quote_updated_rel: string | null;
  stale: number; stopped: number; mark_note: string | null; walkin_bonus: number | null;
  discount_amount: number | null; discount_note: string | null; rank_no: number | null; is_ichimonme: number;
}

function rowToQuote(r: QuoteRow): NormalizedQuote {
  return {
    shopKey: r.shop_key,
    shopName: r.shop_name,
    price: Number(r.price),
    url: r.url,
    updatedAt: r.quote_updated_at,
    updatedRel: r.quote_updated_rel,
    stale: r.stale === 1,
    stopped: r.stopped === 1,
    markNote: r.mark_note,
    walkinBonus: r.walkin_bonus,
    discountAmount: r.discount_amount,
    discountNote: r.discount_note,
  };
}

export interface LatestQuotes {
  runId: string;
  fetchedAt: string;
  quotes: NormalizedQuote[];
}

/** 最近一次存在有效报价的快照（stopped/stale 已过滤） */
export async function getLatestValidQuotes(db: Db, jan: string): Promise<LatestQuotes | null> {
  const rows = await db.query<QuoteRow>(
    `SELECT * FROM quotes
     WHERE jan = ? AND stopped = 0 AND stale = 0
       AND fetched_at = (SELECT MAX(fetched_at) FROM quotes WHERE jan = ? AND stopped = 0 AND stale = 0)
     ORDER BY price DESC`,
    [jan, jan],
  );
  if (rows.length === 0) return null;
  return { runId: rows[0].run_id, fetchedAt: rows[0].fetched_at, quotes: rows.map(rowToQuote) };
}

/** 上一次（早于给定时间）有效最高报价 */
export async function getPreviousValidBest(db: Db, jan: string, beforeFetchedAt: string): Promise<number | null> {
  const rows = await db.query<{ best: number | null }>(
    `SELECT MAX(price) AS best FROM quotes
     WHERE jan = ? AND stopped = 0 AND stale = 0
       AND fetched_at = (SELECT MAX(fetched_at) FROM quotes WHERE jan = ? AND stopped = 0 AND stale = 0 AND fetched_at < ?)`,
    [jan, jan, beforeFetchedAt],
  );
  return rows[0]?.best ?? null;
}

/** 上一次（早于给定时间）買取一丁目的有效报价 */
export async function getPreviousIchimonmeBest(db: Db, jan: string, beforeFetchedAt: string): Promise<number | null> {
  const rows = await db.query<{ best: number | null }>(
    `SELECT MAX(price) AS best FROM quotes
     WHERE jan = ? AND is_ichimonme = 1 AND stopped = 0 AND stale = 0
       AND fetched_at = (SELECT MAX(fetched_at) FROM quotes WHERE jan = ? AND is_ichimonme = 1 AND stopped = 0 AND stale = 0 AND fetched_at < ?)`,
    [jan, jan, beforeFetchedAt],
  );
  return rows[0]?.best ?? null;
}

/** 约 24 小时前的有效最高报价（窗口 now-30h ~ now-24h） */
export async function getBestAround24hAgo(db: Db, jan: string, nowIso: string): Promise<number | null> {
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(now)) return null;
  const to = new Date(now - 24 * 3600 * 1000).toISOString();
  const from = new Date(now - 30 * 3600 * 1000).toISOString();
  const rows = await db.query<{ best: number | null }>(
    `SELECT MAX(price) AS best FROM quotes
     WHERE jan = ? AND stopped = 0 AND stale = 0 AND fetched_at <= ? AND fetched_at >= ?`,
    [jan, to, from],
  );
  return rows[0]?.best ?? null;
}

// ---------- 每日聚合 ----------

export async function upsertDailyBest(
  db: Db,
  args: {
    date: string;
    jan: string;
    bestPrice: number;
    bestShop: string;
    bestShopKey: string;
    morningPrice: number | null;
    shopCount: number;
    ichimonmePrice?: number | null;
    ichimonmeMorningPrice?: number | null;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO daily_best (date, jan, best_price, best_shop, best_shop_key, morning_price, shop_count,
                             ichimonme_price, ichimonme_morning_price, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(date, jan) DO UPDATE SET
       best_price = excluded.best_price, best_shop = excluded.best_shop, best_shop_key = excluded.best_shop_key,
       morning_price = COALESCE(daily_best.morning_price, excluded.morning_price),
       shop_count = excluded.shop_count,
       ichimonme_price = excluded.ichimonme_price,
       ichimonme_morning_price = COALESCE(daily_best.ichimonme_morning_price, excluded.ichimonme_morning_price),
       updated_at = datetime('now')`,
    [
      args.date, args.jan, args.bestPrice, args.bestShop, args.bestShopKey, args.morningPrice, args.shopCount,
      args.ichimonmePrice ?? null, args.ichimonmeMorningPrice ?? null,
    ],
  );
}

export async function getDailyBest(
  db: Db,
  date: string,
  jan: string,
): Promise<{ best_price: number; morning_price: number | null; ichimonme_price: number | null; ichimonme_morning_price: number | null } | null> {
  const rows = await db.query<{ best_price: number; morning_price: number | null; ichimonme_price: number | null; ichimonme_morning_price: number | null }>(
    'SELECT best_price, morning_price, ichimonme_price, ichimonme_morning_price FROM daily_best WHERE date = ? AND jan = ?',
    [date, jan],
  );
  return rows[0] ?? null;
}

// ---------- 通知去重 ----------

export async function wasNotified(db: Db, eventKey: string): Promise<boolean> {
  const rows = await db.query<{ n: number }>('SELECT 1 AS n FROM notifications WHERE event_key = ?', [eventKey]);
  return rows.length > 0;
}

export async function markNotified(db: Db, eventKey: string, summary = ''): Promise<void> {
  await db.run(
    `INSERT INTO notifications (event_key, summary) VALUES (?, ?)
     ON CONFLICT(event_key) DO UPDATE SET sent_at = datetime('now'), summary = excluded.summary`,
    [eventKey, summary.slice(0, 200)],
  );
}

// ---------- 系统状态 ----------

export async function getState(db: Db, key: string): Promise<string | null> {
  const rows = await db.query<{ value: string | null }>('SELECT value FROM system_state WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setState(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value],
  );
}

// ---------- 运行日志 ----------

export async function insertRunLog(
  db: Db,
  args: { runId: string; mode: string; trigger: string; reportType: string; startedAt: string },
): Promise<void> {
  await db.run(
    'INSERT INTO run_log (run_id, mode, trigger, report_type, started_at) VALUES (?, ?, ?, ?, ?)',
    [args.runId, args.mode, args.trigger, args.reportType, args.startedAt],
  );
}

export async function finishRunLog(
  db: Db,
  args: { runId: string; status: string; apiCalls: number; message: string },
): Promise<void> {
  await db.run('UPDATE run_log SET finished_at = datetime(\'now\'), status = ?, api_calls = ?, message = ? WHERE run_id = ?', [
    args.status,
    args.apiCalls,
    args.message.slice(0, 500),
    args.runId,
  ]);
}

// ---------- 清理 ----------

/** 删除早于截止时间的原始报价数据（快照 + 归一化报价） */
export async function cleanupOldRaw(db: Db, olderThanIso: string): Promise<number> {
  const a = await db.run('DELETE FROM quote_snapshots WHERE fetched_at < ?', [olderThanIso]);
  const b = await db.run('DELETE FROM quotes WHERE fetched_at < ?', [olderThanIso]);
  return a.changes + b.changes;
}

export async function pruneRunLog(db: Db, olderThanIso: string): Promise<number> {
  const r = await db.run('DELETE FROM run_log WHERE started_at < ?', [olderThanIso]);
  return r.changes;
}

export async function pruneNotifications(db: Db, olderThanIso: string): Promise<number> {
  const r = await db.run('DELETE FROM notifications WHERE sent_at < ?', [olderThanIso]);
  return r.changes;
}
