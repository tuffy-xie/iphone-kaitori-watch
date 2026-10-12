-- 初始 schema：产品 / 订单 / 报价快照 / 每日聚合 / 额度 / 通知去重 / 系统状态 / 运行日志
-- 原始报价数据 29 天自动清理（见 src/monitor/cleanup.ts），不提交 Git

-- 产品型号（Apple 官方价作为配置维护，订单可覆盖实际购买金额）
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  capacity TEXT NOT NULL,
  color TEXT NOT NULL,
  color_zh TEXT,
  jan TEXT NOT NULL UNIQUE,
  part TEXT,
  apple_price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 我的订单（手动录入，与 API 原始报价分开存储）
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT NOT NULL UNIQUE,
  jan TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  card TEXT NOT NULL DEFAULT 'epos',
  purchase_date TEXT,
  eta_date TEXT,
  received_date TEXT,
  return_deadline_confirmed TEXT,
  return_ship_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'pending_delivery',
  sold_price INTEGER,
  fees_shipping INTEGER,
  fees_transport INTEGER,
  fees_handling INTEGER,
  confirmed_discount INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_jan ON orders(jan);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 原始报价快照（29 天自动清理）
CREATE TABLE IF NOT EXISTS quote_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  jan TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_jan_time ON quote_snapshots(jan, fetched_at);

-- 归一化报价（29 天自动清理）
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  jan TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  shop_key TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  url TEXT,
  quote_updated_at TEXT,
  quote_updated_rel TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  stopped INTEGER NOT NULL DEFAULT 0,
  mark_note TEXT,
  walkin_bonus INTEGER,
  discount_amount INTEGER,
  discount_note TEXT,
  rank_no INTEGER,
  is_ichimonme INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_jan_time ON quotes(jan, fetched_at);
CREATE INDEX IF NOT EXISTS idx_quotes_run ON quotes(run_id);

-- 每日最高价聚合（长期保留，用于 昨天/3天/7天/14天 比较）
CREATE TABLE IF NOT EXISTS daily_best (
  date TEXT NOT NULL,
  jan TEXT NOT NULL,
  best_price INTEGER,
  best_shop TEXT,
  best_shop_key TEXT,
  morning_price INTEGER,
  shop_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, jan)
);

-- API 额度管理
CREATE TABLE IF NOT EXISTS api_usage_daily (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_usage (
  date TEXT NOT NULL,
  jan TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT,
  PRIMARY KEY (date, jan)
);

-- 通知发送历史（事件去重）
CREATE TABLE IF NOT EXISTS notifications (
  event_key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel TEXT,
  summary TEXT
);

-- 系统运行状态
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 运行日志
CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  trigger TEXT,
  report_type TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  api_calls INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
