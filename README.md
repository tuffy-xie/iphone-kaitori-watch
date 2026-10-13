# iphone-kaitori-watch

日本 iPhone 新品 **買取套利监控系统**：在 Apple Store 购买全新未拆封 iPhone 后，自动监控日本各家買取店回收价格，计算现金/积分/里程口径的收益与回本价，跟踪 Apple 退货截止日期，并通过 Telegram 推送日报与风险预警。

- 云端自动运行（GitHub Actions 定时 + Cloudflare D1 持久化），**不需要 Mac / NAS / VPS 常开**
- 运行时 **零 npm 依赖**（Node 原生 TypeScript + 内置 `node:sqlite`），稳定、低成本
- 个人使用工具：**不自动购买、不自动出售、不自动申请退货**

> **✅ 部署状态：已上线运行中**（2026-10-13 完成全部验证：真实 API 采集 / D1 持久化 / Telegram 推送 / 定时任务）。日常使用方法见下方「日常使用速查」，部署过程记录见第 5 节。

---

## 📖 日常使用速查

> 系统已部署并持续自动运行。以下是你日常唯一需要了解的操作。

### 1. 你会自动收到什么（无需任何操作）

| 时间（JST） | 内容 |
|---|---|
| 每天 09:07 | 📱 **早报**：四色各一行（一丁目回收价 + 与官网毛差 + 涨跌 + 减价警示） |
| 每天 17:07 | 📱 **下午报**（格式同上） |
| 事件发生时 | 🚨 报价涨跌超 ¥2,000 ｜ 🎉 首次现金回本 ｜ 🟡 首次综合估值回本 ｜ ⚠️ 采集失败 ｜ ℹ️ 额度保护跳过 |
| 每天 10:00 & 22:00 | ⏳ 退货倒计时检查：剩 7/3/2/1/0 天节点提醒，最后 3 天每天提醒（不消耗買取X 额度，API 故障也保证发出） |

**日报长这样**（一屏看完）：

```
📱 買取监控·早报｜🕒 2026/10/13 09:05 JST

📦 iPhone 18 Pro Max 256GB｜官网 ¥239,800
⚫ 黑色 ¥228,000｜毛差 -¥11,800｜⚠️减价 -¥17,500未确认
⚪ 银色 ¥235,800｜毛差 -¥4,000｜⚠️减价 -¥19,500未确认
🟥 酒红色 ¥230,000｜毛差 -¥9,800
🔷 冰川色 ¥238,000｜毛差 -¥1,800

⏳ 退货倒计时（有订单时才出现）
🧾 DEMO-BLK-01 ⚫黑色×1｜截止 10月25日（估算）｜最迟申请 10月24日｜剩 12 天

💡 当前判断（有订单时才出现）
🔵 DEMO-BLK-01 继续观察：目前亏损 11,800 日元（现金口径）
🔗 買取一丁目 09:00更新｜09:05 JST 查询
```

> **聚焦模式（默认）**：报告与订单收益判定统一以 **買取一丁目** 为报价基准（一丁目暂无有效报价时自动回退全店最高价并显示店名）。API 一次调用仍返回全部 38 家报价存库，只是展示和判定聚焦一丁目。想改回“全店最高价”模式：`config/settings.json` 中 `"focusShopOnly": false` 并 push。

### 2. 录入 / 修改订单（买了 iPhone 后唯一要做的操作）

打开 **Actions 页面**：https://github.com/tuffy-xie/iphone-kaitori-watch/actions/workflows/monitor.yml

1. 右侧 **Run workflow** 按钮
2. `mode` 选 **`order-upsert`**
3. `orders_json` 粘贴订单 JSON（模板见下）
4. 点绿色 **Run workflow**

```json
[
  {
    "orderRef": "IP18PM-BLK-01",
    "jan": "4549995734546",
    "quantity": 1,
    "unitPrice": 239800,
    "card": "epos",
    "purchaseDate": "2026-10-20",
    "etaDate": "2026-10-24",
    "receivedDate": "2026-10-24",
    "returnDeadlineConfirmed": "2026-11-07",
    "status": "holding",
    "fees": { "shipping": 0, "transport": 0, "handling": 0 }
  }
]
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `orderRef` | ✅ | 自定义编号；**相同编号再次提交 = 修改该订单** |
| `jan` | ✅ | 黑 `4549995734546` / 银 `4549995734591` / 酒红 `4549995734645` / 冰川 `4549995734690` |
| `unitPrice` | ✅ | 每台**实付金额**（默认按 Apple 官网价，可覆盖） |
| `quantity` | | 台数，默认 1 |
| `card` | | `epos`（EPOS黑卡）/ `ana`（ANA金卡），按实际付款卡 |
| `receivedDate` | | 实际收货日；无官方截止日时据此 **+14 天估算**退货截止（标注"估算"） |
| `returnDeadlineConfirmed` | | Apple 官方确认的退货截止日，**优先于估算** |
| `returnShipDeadline` | | 退货寄出截止日（与申请截止分开跟踪） |
| `status` | | `pending_delivery` 待到货 / `received` 已到货 / `holding` 持有观察 / `sold` 已出售 / `return_requested` 已申请退货 / `return_shipped` 已寄出退货 / `refunded` 退款完成 / `cancelled` |
| `soldPrice` | | 实际出售价（status=sold 时填） |
| `fees` | | 运费/交通费/手续费；**缺省 = 0（确认免运费）**；**显式 `null` = 未确认**（显示"净利润尚无法确定"） |
| `confirmedDiscount` | | 已确认会扣减的金额（未确认的减价不要填，系统绝不自动扣） |

> ⚠️ **修改订单 = 全量覆盖**：未填的字段会恢复默认值，所以修改时请把该订单的完整信息重新填一遍（可只改变化的字段，但建议全量提交）。

**常见操作示例**：

```jsonc
// 收货后补录收货日（触发退货倒计时）
[{"orderRef":"IP18PM-BLK-01","jan":"4549995734546","quantity":1,"unitPrice":239800,"card":"epos","receivedDate":"2026-10-24","status":"holding"}]

// 已出售：标记状态 + 成交价
[{"orderRef":"IP18PM-BLK-01","jan":"4549995734546","quantity":1,"unitPrice":239800,"card":"epos","receivedDate":"2026-10-24","status":"sold","soldPrice":245000}]

// 已申请退货
[{"orderRef":"IP18PM-BLK-01","jan":"4549995734546","quantity":1,"unitPrice":239800,"card":"epos","receivedDate":"2026-10-24","status":"return_requested"}]
```

### 3. 手动触发一次运行（测试 / 补数据）

同一 Run workflow 页面：`mode` 选 **`monitor`**，可选 `report_type`（auto/morning/afternoon/normal）、`dry_run=true`（真实采集+打印，不推送 Telegram）。

其他 mode：`verify-jan`（校验 JAN）、`notify-test`（测试消息）、`migrate`（数据库迁移）、`cleanup`（手动清理）、`return-reminder`（退货检查）。

### 4. 新增监控其他型号/颜色

编辑 `config/products.json` 增加一项（`model`/`capacity`/`color`/`jan`/`applePrice`）并 push，下一轮自动生效，无需改代码。免费额度 30 次/日 = 最多约 7 个 JAN × 6 轮，超出需调整轮次或升级 Premium。

### 5. 查看运行历史与日志

Actions 页面 → 点任意运行 → 展开步骤查看日志，关键行：
- `[采集] 黑色 4549995734546: 26 家有效报价，最高 231000`
- `[调度] 按时隙 JST 09:07 处理 → morning`（时区/时隙自愈状态）
- `[完成] report=morning 采集=4 预警=1 日报=true`

---

## 1. 功能总览

| 模块 | 能力 |
|---|---|
| 数据采集 | 買取X Open API `GET /open/api/product/{jan}`，官方认证，TPS=1，30 次/日额度管理 |
| 报价分析 | 有效报价过滤（stopped / stale / 过旧 / 非法价格）、排名、第二/第三、買取一丁目单独展示、与上次/当天早间/24 小时前差额 |
| 减价处理 | `mark_note` 中的颜色减价（如 ブラック -17,500）只作提示：**不重复扣减**，无法确认是否已包含时标注"未确认"，并单独给出保守口径 |
| 积分计算 | EPOS Platinum（200円=1pt，1pt=1円，年度奖励只按增量且仅作参考估算）；ANA To Me CARD PASMO JCB GOLD（200円=1 J-POINT，可配 1 J-POINT=N 里程、1 里程=M 日元） |
| 利润计算 | 现金毛差额/净利润、综合预计收益、现金回本价、综合估值回本价、利润率；费用可配置，未知时明确提示"净利润尚无法确认" |
| 订单管理 | 多订单多颜色；支持官方确认退货截止日（优先）或收货日+14 天估算（标注"估算"）；申请截止与寄出截止分开跟踪 |
| 自动建议 | ✅现金回本 / 🟡积分估值回本 / 🔵继续观察 / 🔴退货预警 四状态 |
| 通知 | Telegram 简体中文；09:07 早报、17:07 下午报；涨跌 >¥2,000、首次回本、退货临近、采集失败即时提醒；事件去重防重复推送 |
| 数据保留 | 原始报价 29 天自动清理（遵守買取X 条款）；每日聚合长期保留用于历史比较；原始数据**不提交 Git** |

## 2. 架构

```
GitHub Actions (cron, UTC)          Cloudflare D1 (SQLite)
  monitor.yml  每天 6 次 ─────┐        products / orders / quote_snapshots
    09:07 早报 · 17:07 下午报 │  ───►  quotes / daily_best / api_usage
    其余仅预警                │        notifications(去重) / run_log / system_state
  return-reminder.yml 独立 ───┘              ▲
    JST 10:00/22:00，不调用買取X API         │ REST API (fetch, 无 wrangler)
                                             │
買取X Open API ◄── TPS=1, 30次/日 ── Telegram Bot API ◄── 手机
```

**为什么监控和退货提醒是两个工作流**：退货最后期限提醒不能因为買取X API 故障或额度耗尽而被跳过。独立工作流只读数据库，天然免疫 API 问题。

## 3. 目录结构

```
iphone-kaitori-watch/
├── .github/workflows/
│   ├── monitor.yml            # 每天 6 次监控 + workflow_dispatch 手动入口
│   └── return-reminder.yml    # 独立退货提醒（每天 2 次）
├── config/
│   ├── products.json          # 监控型号/颜色/JAN/Apple 官方价（可扩展）
│   ├── cards.json             # EPOS / ANA 积分规则（可调整）
│   └── settings.json          # 额度/阈值/费用/保留天数等全部可配置项
├── migrations/0001_init.sql   # D1 数据库 schema
├── src/
│   ├── cli.ts                 # 入口：monitor / return-reminder / order-upsert / verify-jan / ...
│   ├── kaitorix/              # API 客户端 / 解析 / 过滤 / 额度管理 / Mock
│   ├── analysis/              # 积分里程 / 利润回本 / 四状态建议
│   ├── orders/return.ts       # 退货日期计算
│   ├── db/                    # D1 REST + 本地 SQLite + 迁移 + 仓储
│   ├── notify/                # Telegram 发送 / 消息排版 / 事件去重
│   └── monitor/               # 编排 / 退货提醒 / 29 天清理
├── tests/                     # 53 个自动化测试（node:test，零依赖）
├── .env.example
└── package.json               # 运行时零依赖；devDeps 仅 typescript
```

## 4. 本地快速验证（5 分钟，不需要任何密钥）

```bash
cd iphone-kaitori-watch
npm install          # 只装 typescript
npm test             # 53 个测试（含端到端 Mock 流程）
npm run typecheck

# 完整 dry-run：Mock 报价 + 本地 SQLite + Telegram 消息只打印不发送
npm run dry-run
# 录入一笔演练订单后再跑，可以看到带订单/退货倒计时的完整日报：
ORDERS_JSON='[{"orderRef":"DEMO-01","jan":"4549995734546","quantity":1,"unitPrice":239800,"card":"epos","receivedDate":"2026-10-04","status":"holding"}]' \
  DRY_RUN=true KAITORIX_MOCK=1 node src/cli.ts order-upsert
DRY_RUN=true KAITORIX_MOCK=1 REPORT_TYPE=morning node src/cli.ts monitor
```

> ⚠️ Mock 数据仅用于验证流程与排版，**不代表真实行情**。真实行情必须配置 `KAITORIX_API_KEY` 后运行 `npm run verify:jan` 确认。

## 5. 部署手顺（✅ 已于 2026-10-13 全部完成，保留作为记录/重装指引）

> **分阶段验证顺序（务必按此顺序，每阶段确认无误再进入下一阶段）：**
> **Phase A 数据库迁移** → **Phase B 真实 API 采集验证** → **Phase C Telegram 推送测试** → **Phase D 录入订单并开启定时运行**
> 每阶段都用 Actions → monitor → Run workflow 手动执行，先 `dry_run=true` 观察日志，再 `dry_run=false` 生效。

### Phase A：数据库迁移（5.1–5.5 之后）

1. Actions → monitor → Run workflow → `mode=migrate`, `dry_run=false`
2. 日志出现 `[迁移] 新应用: 0001_init.sql` 与 `[完成] 数据库已初始化` 即成功
3. 本地核对（可选）：Cloudflare Dashboard → D1 → 你的数据库 → Console 执行 `SELECT name FROM _migrations;` 应返回 `0001_init.sql`

### Phase B：真实 API 采集验证

1. Actions → monitor → Run workflow → `mode=verify-jan`, `dry_run=false`
   - 四个 JAN 全部输出 ✅（返回商品名包含预期型号与颜色）→ JAN 配置正确
   - 出现 ⚠️/❌ → 按日志提示修正 `config/products.json` 的 JAN 与颜色对应关系后重试
2. Actions → monitor → Run workflow → `mode=monitor`, `dry_run=true`（**真实 API + 演练模式**）
   - 日志 `[采集]` 四行显示各颜色有效报价家数与最高价；Telegram 消息只打印不发送
   - 核对返回的商品名称、报价、商家链接、减价提示是否符合预期
3. 同一步骤再以 `dry_run=false` 跑一次，确认 D1 中落库（Dashboard → D1 → Console：`SELECT jan, COUNT(*) FROM quotes GROUP BY jan;`）

### Phase C：Telegram 推送测试

1. Actions → monitor → Run workflow → `mode=notify-test`, `dry_run=false`
2. 手机收到 ✅ 测试消息即通道正常
3. 再跑一次 `mode=monitor`, `report_type=morning`, `dry_run=false`，收到完整早报

### Phase D：录入订单并开启定时运行

1. `mode=order-upsert` 录入真实订单（见 5.6）
2. 手动跑一次 `mode=monitor`, `dry_run=false`，确认日报包含订单与退货倒计时
3. **开启定时（最后一步）**：初始 push 时两个 workflow 的 `schedule` 均为注释状态，不会自动运行。Phase A→D 全部验证通过后，取消 `.github/workflows/monitor.yml` 与 `return-reminder.yml` 中 `schedule` 的注释并 push（或让助手代改），下次 09:07 JST 自动运行
4. 首次定时运行后核对日志 `[调度] 按时隙 JST 09:07 处理 → morning`（时区验证，见第 6 节）

### 5.1 创建 GitHub 私有仓库

```bash
cd iphone-kaitori-watch
git init && git add . && git commit -m "init: iphone-kaitori-watch"
gh repo create iphone-kaitori-watch --private --source=. --push
```

仓库必须为 **Private**（`.gitignore` 已排除 `data/`、`.env`、`node_modules/`；原始报价只进 D1，不进 Git 历史）。

### 5.2 创建 Telegram Bot

1. 找 [@BotFather](https://t.me/BotFather) → `/newbot` → 得到 `TELEGRAM_BOT_TOKEN`
2. 给你的 bot 随便发一条消息，然后浏览器打开
   `https://api.telegram.org/bot<TOKEN>/getUpdates`，从返回的 `chat.id` 得到 `TELEGRAM_CHAT_ID`
3. 先跑一次连通性测试：Actions → monitor → Run workflow → `mode=notify-test`, `dry_run=false`

### 5.3 获取買取X API Key

1. 打开 https://kaitorix.app/open/mypage （Google 登录后自动获得 Free 套餐：30 次/日）
2. 复制 API Key（`ktx_` 前缀）→ GitHub Secret `KAITORIX_API_KEY`
3. **部署后第一件事**：Actions → monitor → Run workflow → `mode=verify-jan`，确认四种颜色的 JAN 与颜色名称一一对应（输出 ✅ 即通过；⚠️/❌ 需修正 `config/products.json`）

### 5.4 创建 Cloudflare D1 数据库

1. Cloudflare Dashboard → **Workers & Pages → D1 → Create database**，名字如 `iphone-kaitori-watch`
2. 记下 **Database ID**（32 位十六进制）
3. 记下 **Account ID**（Dashboard 右侧栏）
4. 创建 API Token：My Profile → **API Tokens → Create Token → Edit Cloudflare D1** 模板 → 允许所有 D1 数据库（或仅这一个）
5. 执行建表：Actions → monitor → Run workflow → `mode=migrate`, `dry_run=false`
   （本地也可 `CLOUDFLARE_*` 三件套配置后 `npm run migrate`）

### 5.5 配置 GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret | 说明 |
|---|---|
| `KAITORIX_API_KEY` | 買取X Open API Key（`ktx_` 前缀） |
| `TELEGRAM_BOT_TOKEN` | BotFather 给出的 token |
| `TELEGRAM_CHAT_ID` | 你的 chat id |
| `CLOUDFLARE_API_TOKEN` | D1 Edit 权限的 token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `D1_DATABASE_ID` | D1 Database ID |

**任何密钥都不要写进代码或提交到仓库**；本地开发用 `.env`（已被 `.gitignore` 排除，参考 `.env.example`）。

### 5.6 录入真实订单

Actions → monitor → Run workflow → `mode=order-upsert`，在 `orders_json` 填入：

```json
[
  {
    "orderRef": "IP18PM-BLK-01",
    "jan": "4549995734546",
    "quantity": 1,
    "unitPrice": 239800,
    "card": "epos",
    "purchaseDate": "2026-10-01",
    "etaDate": "2026-10-04",
    "receivedDate": "2026-10-04",
    "returnDeadlineConfirmed": "2026-10-18",
    "status": "holding"
  }
]
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `orderRef` | ✅ | 订单自定义编号（再次提交同编号 = 修改该订单） |
| `jan` | ✅ | 必须在 `config/products.json` 中 |
| `unitPrice` | ✅ | 每台**实际支付金额**（默认用 Apple 官方价，可覆盖） |
| `quantity` | | 台数，默认 1 |
| `card` | | `epos` / `ana`，默认 `epos`（按实际付款卡） |
| `receivedDate` | | 实际收货日；无官方截止日时据此 +14 天**估算**退货截止 |
| `returnDeadlineConfirmed` | | 官方确认的退货截止日，**优先于估算** |
| `returnShipDeadline` | | 退货寄出截止日（与申请截止分开） |
| `status` | | `pending_delivery`/`received`/`holding`/`sold`/`return_requested`/`return_shipped`/`refunded`/`cancelled`，默认 `pending_delivery` |
| `fees` | | `{"shipping":0,"transport":0,"handling":0}` 运费/交通费/手续费；不填用 `settings.json` 默认值；填 `null` 表示未知 → 提示"净利润尚无法确认" |
| `confirmedDiscount` | | **已确认**会从报价扣减的金额（未确认的减价不要填，系统不会自动扣） |

新增其他型号：编辑 `config/products.json` 增加一项（JAN + Apple 价），提交后即生效，无需改代码。

## 6. 运行时间表与时区

| 工作流 | JST 时间 | 行为 |
|---|---|---|
| monitor.yml | 09:07 | 采集 + **完整早间日报** |
| monitor.yml | 12:07 / 15:07 / 20:07 / 23:07 | 采集；无重大变化不推送 |
| monitor.yml | 17:07 | 采集 + **完整下午日报** |
| return-reminder.yml | 10:00 / 22:00 | 退货倒计时检查（不调用買取X API） |

**时区**：GitHub Actions 的 `schedule` 已支持 IANA `timezone` 字段，工作流直接使用 `timezone: Asia/Tokyo`（cron 小时即 JST 本地小时，无夏令时问题）。若将来该字段不可用，可改回 UTC 等价写法 `cron: '7 0,3,6,8,11,14 * * *'` 并把 workflow 中 `SCHEDULE_TZ` 改为 `UTC`，代码会自动 +9 换算。

**迟到与漏执行自愈（时隙机制）**：
- 报告类型不按"启动时刻"判断，而按"本次运行应属的时隙"判断（数据库记录每天各时隙完成状态）
- 09:07 延迟到 10:30 启动 → 仍按**早间报告**处理；17:07 延迟到 18:40 → 仍按**下午报告**处理
- 某个时隙整轮丢失（GitHub 偶发漏执行）→ 下一次运行自动**补发**该时隙的报告（如 17:07 丢失，20:07 补发下午报）
- 手动 `workflow_dispatch` 不影响时隙状态；`report_type` 输入可强制指定报告类型
- 跨午夜（23:07 延迟到次日 00:30）→ 按普通运行处理，不重复推送
- **部署后验证**：首次定时运行后看 Actions 日志的 `[调度] 按时隙 JST 09:07 处理 → morning`；若实际执行时间约晚 9 小时（如 JST 18:07 才跑），说明 `timezone` 字段未生效，按上面的备用方案切换
- 所有运行都有超时（20/10 分钟）、网络重试、TPS 限速、共享并发组（两个工作流串行，避免去重竞争）与 `run_log` 记录

## 7. 買取X API 额度策略（Free 30 次/日）

一天固定消耗：4 颜色 × 6 轮 = **24 次**，余量 6 次。

- **普通轮次整轮预检**：12:07 / 15:07（下午报之前）需在整轮 4 次采集后仍保留 `reserveForReports=4` 次（=1 轮报告）才执行，否则**整轮跳过**（不部分跳过），改用库中最近有效报价
- **下午报之后不再预留**：20:07 / 23:07 无需再保护报告，剩余额度可全部用于采集
- **报告轮次（09:07 / 17:07）不受预留限制**，只在真正耗尽时停止；允许部分采集（如 2 个 JAN 成功、2 个失败），其余用库中报价继续出报告
- 同一 JAN 每次运行只查一次，多订单共享同一份报价
- 请求间隔 ≥1.1s（TPS=1）；**失败重试的每次尝试都计入额度**（服务器端计数）
- 429 自动区分「每秒限流（等待重试，不耗日额度）」与「日限耗尽（当天停止采集并提醒）」；`X-RateLimit-Remaining: 0` 时以权威值标记耗尽
- 已用测试模拟完整一天：无故障 24/24 完成；注入 4 次或 6 次重试仍 24/24 完成；注入 10 次重试仅 23:07 整轮跳过（早晚报不受影响）

## 8. 计算规则要点（四个收益口径）

- **现金毛差额** = 回收价（聚焦模式=一丁目价；全店模式=最高有效价）− 实际购买价（未扣任何费用）
- **预计净利润** = 现金毛差额 − 运费 − 交通费 − 手续费 − 已确认减价；**费用未确认时显示"尚无法确定"，不得当作确定收益**
- **积分估值收益** = EPOS 积分或 ANA 里程的估值（估算、非现金）；ANA 按 J-POINT → 里程 → 日元展示
- **实际确认收益** = 费用已确认时的现金净利润（唯一可确认口径）；报价未锁定前仍需向商家确认
- **综合预计收益** = 预计净利润 + 积分估值（估算口径）；**积分回本 ≠ 现金回本**，报告中始终区分
- 回本判定铁律：费用未确认、或商家减价是否已包含无法确认时，**不得给出确定性盈利/回本结论**（自动降级为"继续观察"并说明原因）
- 费用录入语义：`fees` 字段**缺省**用 `settings.json` 默认值（默认 0 = 确认免运费）；**显式 `null`** = 未确认
- EPOS 年度奖励：按「当前年度累计消费 + 本单」是否跨阶梯计算**增量**，只显示为参考估算，**不计入确定收益**
- ANA 里程估值默认 1 里程 = 2 日元（可在 `cards.json` 改 1.5/2/2.5），里程不是现金
- 已申请退货/退款的订单，积分里程按 **0** 计（可能被撤销）
- 商家颜色减价（mark_note）**绝不自动扣减**；无法确认是否已包含时显示"未确认"，并单独给出保守口径价格
- Apple 对大量购买/不当退货可能收取 **15% 退货手续费**，退货提醒中每次都会提示

## 9. 数据保留与合规

- 原始报价（`quote_snapshots` / `quotes`）**29 天自动清理**（遵守買取X Free/Premium 条款）；`daily_best` 聚合长期保留
- 原始报价**不写入 Git**（只进 D1）
- 買取X Free/Premium 仅限个人使用（个人仕入れ判断），本系统即此类用途；不对外公开数据、不再分发

## 10. 测试

```bash
npm test        # 83 个测试
```

覆盖：JAN 校验、真实 API 响应结构解析、报价过滤、减价不重复扣除、EPOS/ANA 计算、现金与综合回本、**四个收益口径与费用未确认时的降级**、多订单、退货日期（实际优先于估算）、**退货提醒多日序列（7/3/2/1/0 阈值 + 每日提醒，不重不漏）**、消息排版、通知去重、**额度全天模拟（6 轮 × 4 JAN + 重试注入）**、**cron 时区换算与时隙自愈（迟到/漏执行/跨午夜/手动）**、D1 REST 请求格式与重试、29 天清理、API 耗尽降级、端到端 Mock 流程。

## 11. 成本

| 项目 | 费用 |
|---|---|
| GitHub Actions（私有仓库） | 免费额度内（每次运行 <1 分钟） |
| Cloudflare D1 Free | 免费（5GB 存储 / 500万读每日） |
| Telegram Bot | 免费 |
| 買取X Open API Free | 免费（30 次/日，Google 登录即得） |
| **合计** | **¥0/月** |

## 12. 故障排查

| 现象 | 处理 |
|---|---|
| Telegram 没消息 | Actions 日志搜 `TELEGRAM 未配置` / 发送失败；用 `mode=notify-test` 验证 |
| 采集全部失败 | 检查 `KAITORIX_API_KEY`；额度耗尽的当天会自动停止采集并用旧数据判断 |
| 报价不更新 | 普通运行受额度保护跳过属正常；查看日志 `额度保护` |
| JAN 校验 ⚠️ | `config/products.json` 中 JAN 与颜色不对应，按 `verify-jan` 输出修正 |
| D1 报错 | 确认三个 `CLOUDFLARE_*` Secret 与 Token 的 D1 Edit 权限；先跑 `mode=migrate` |
| 本地无数据 | 未配置 D1 三件套时用 `data/local.db`，属正常 |

## 13. 后续可选扩展

- Cloudflare Worker + 简单管理页面 / Telegram 命令（`/orders` `/add` `/return`）录入订单（需 Worker 处理 Webhook 并验证身份）
- 買取X Premium/Unlimited（500 次/日或无限 + 批量接口）后可提高采集频率
- `GET /open/api/apple-stock` 可一并监控 Apple Store 库存（1 次请求拿全型号，可大幅节省额度）
