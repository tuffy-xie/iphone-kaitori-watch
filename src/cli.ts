#!/usr/bin/env node
// CLI 入口：monitor / return-reminder / migrate / order-upsert / verify-jan / notify-test / cleanup
// 用法示例：
//   node src/cli.ts monitor --report-type=morning --dry-run
//   ORDERS_JSON='[...]' node src/cli.ts order-upsert

import { readFileSync } from 'node:fs';
import {
  envBool,
  loadCardsFile,
  loadEnvFile,
  loadProductsFile,
  loadSettings,
} from './config/load.ts';
import { createDb, runMigrations } from './db/migrate.ts';
import * as repo from './db/repo.ts';
import { KaitoriXClient } from './kaitorix/client.ts';
import { createMockFetch } from './kaitorix/mock.ts';
import { Notifier } from './notify/dedupe.ts';
import * as msg from './notify/messages.ts';
import { runMonitor, type ReportType } from './monitor/run.ts';
import { sendReturnReminders } from './monitor/reminder.ts';
import { runCleanupIfDue } from './monitor/cleanup.ts';
import { filterAndRank } from './kaitorix/filter.ts';
import { parseProductResponse } from './kaitorix/parse.ts';
import { todayJst } from './util/time.ts';
import { HELD_STATUSES, type CardId, type OrderInput, type OrderStatus } from './types.ts';

function parseArgs(argv: string[]): { mode: string; flags: Record<string, string>; bools: Record<string, boolean> } {
  const [mode = 'monitor'] = argv;
  const flags: Record<string, string> = {};
  const bools: Record<string, boolean> = {};
  for (const a of argv.slice(1)) {
    if (a === '--dry-run') bools['dry-run'] = true;
    else if (a === '--force') bools.force = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? 'true';
    }
  }
  return { mode, flags, bools };
}

const VALID_STATUSES: OrderStatus[] = [...HELD_STATUSES, 'sold', 'refunded', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateOrders(
  orders: unknown[],
  knownJans: Set<string>,
  cardIds: string[],
  defaultFees: { shipping: number | null; transport: number | null; handling: number | null },
): { valid: OrderInput[]; errors: string[] } {
  const valid: OrderInput[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  // 费用解析规则：字段缺省 → 用 settings 默认值；显式 null → 未确认（DB 存 NULL，展示"尚无法确定"）
  const resolveFee = (fees: OrderInput['fees'], key: 'shipping' | 'transport' | 'handling'): number | null => {
    if (fees === undefined || fees === null) return defaultFees[key];
    if (fees[key] === undefined) return defaultFees[key];
    return fees[key];
  };
  orders.forEach((raw, i) => {
    const o = raw as Partial<OrderInput>;
    const prefix = `订单[${i}]${o?.orderRef ? ` (${o.orderRef})` : ''}`;
    if (!o || typeof o.orderRef !== 'string' || !o.orderRef.trim()) {
      errors.push(`${prefix}: 缺少 orderRef`);
      return;
    }
    if (seen.has(o.orderRef)) {
      errors.push(`${prefix}: orderRef 重复`);
      return;
    }
    seen.add(o.orderRef);
    if (typeof o.jan !== 'string' || !knownJans.has(o.jan)) {
      errors.push(`${prefix}: JAN ${o.jan ?? '(空)'} 不在产品配置中（已知: ${[...knownJans].join(', ')}）`);
      return;
    }
    if (typeof o.unitPrice !== 'number' || !(o.unitPrice > 0)) {
      errors.push(`${prefix}: unitPrice 必须大于 0`);
      return;
    }
    if (o.quantity !== undefined && (!Number.isInteger(o.quantity) || o.quantity < 1)) {
      errors.push(`${prefix}: quantity 必须为 >=1 的整数`);
      return;
    }
    if (o.card !== undefined && !cardIds.includes(o.card)) {
      errors.push(`${prefix}: card 必须是 ${cardIds.join(' / ')}`);
      return;
    }
    if (o.status !== undefined && !VALID_STATUSES.includes(o.status)) {
      errors.push(`${prefix}: status 必须是 ${VALID_STATUSES.join(' / ')}`);
      return;
    }
    for (const [k, v] of Object.entries({ purchaseDate: o.purchaseDate, etaDate: o.etaDate, receivedDate: o.receivedDate, returnDeadlineConfirmed: o.returnDeadlineConfirmed, returnShipDeadline: o.returnShipDeadline })) {
      if (v != null && !DATE_RE.test(v)) {
        errors.push(`${prefix}: ${k} 需为 YYYY-MM-DD 格式（收到 ${v}）`);
        return;
      }
    }
    valid.push({
      orderRef: o.orderRef.trim(),
      jan: o.jan,
      quantity: o.quantity ?? 1,
      unitPrice: o.unitPrice,
      card: (o.card ?? 'epos') as CardId,
      purchaseDate: o.purchaseDate ?? null,
      etaDate: o.etaDate ?? null,
      receivedDate: o.receivedDate ?? null,
      returnDeadlineConfirmed: o.returnDeadlineConfirmed ?? null,
      returnShipDeadline: o.returnShipDeadline ?? null,
      status: o.status ?? 'pending_delivery',
      soldPrice: o.soldPrice ?? null,
      fees: {
        shipping: resolveFee(o.fees, 'shipping'),
        transport: resolveFee(o.fees, 'transport'),
        handling: resolveFee(o.fees, 'handling'),
      },
      confirmedDiscount: o.confirmedDiscount ?? 0,
      notes: o.notes ?? null,
    });
  });
  return { valid, errors };
}

async function main(): Promise<void> {
  loadEnvFile();
  const { mode, flags, bools } = parseArgs(process.argv.slice(2));
  const dryRun = bools['dry-run'] || envBool('DRY_RUN');
  const force = bools.force === true;

  const settings = loadSettings();
  const productsFile = loadProductsFile();
  const cardsFile = loadCardsFile();
  const products = productsFile.products;
  const cards = cardsFile.cards;

  const { db, kind, detail } = createDb();
  console.log(`[启动] 模式=${mode} 数据库=${kind === 'd1' ? 'Cloudflare D1' : '本地 SQLite'}(${detail}) DRY_RUN=${dryRun}`);

  const mig = await runMigrations(db);
  if (mig.applied.length > 0) console.log(`[迁移] 新应用: ${mig.applied.join(', ')}`);

  const tgOpts =
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
      ? { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }
      : null;
  if (!tgOpts && !dryRun) console.warn('[提示] 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID，消息将只打印不发送');
  const notifier = new Notifier(db, tgOpts, dryRun);

  const now = new Date();

  switch (mode) {
    case 'migrate': {
      console.log('[完成] 数据库已初始化（迁移全部应用）');
      break;
    }

    case 'monitor': {
      let client: KaitoriXClient | null = null;
      if (process.env.KAITORIX_API_KEY) {
        client = new KaitoriXClient({
          apiKey: process.env.KAITORIX_API_KEY,
          baseUrl: process.env.KAITORIX_BASE_URL,
          tpsMs: settings.quota.tpsMs,
        });
        console.log('[采集] 使用買取X 真实 API');
      } else if (envBool('KAITORIX_MOCK') || dryRun) {
        client = new KaitoriXClient({
          apiKey: 'mock-key',
          tpsMs: 0,
          fetchImpl: createMockFetch(now),
          sleepImpl: async () => {},
        });
        console.log('[采集] 未配置 KAITORIX_API_KEY，使用 Mock 数据演练（不代表真实行情）');
      } else {
        console.warn('[采集] 未配置 KAITORIX_API_KEY，本次仅使用数据库中的已有报价');
      }
      const reportType = (flags['report-type'] ?? process.env.REPORT_TYPE ?? 'auto') as ReportType | 'auto';
      const result = await runMonitor(
        {
          db,
          settings,
          products,
          cards,
          client,
          notifier,
          now,
          trigger: process.env.GITHUB_EVENT_NAME ?? 'local',
          scheduleCron: process.env.SCHEDULE_CRON || null,
          scheduleTz: process.env.SCHEDULE_TZ || 'UTC',
          scheduled: (process.env.GITHUB_EVENT_NAME ?? '') === 'schedule',
        },
        { reportType, force },
      );
      console.log(
        `[完成] report=${result.reportType} 采集=${result.fetched.length} 跳过=${result.skipped.length} 失败=${result.failed.length} 预警=${result.alertsSent} 日报=${result.reportSent}`,
      );
      break;
    }

    case 'return-reminder': {
      const sent = await sendReturnReminders({ db, settings, products, notifier, now });
      console.log(`[完成] 退货提醒检查完毕，本次发送 ${sent} 条`);
      break;
    }

    case 'order-upsert': {
      const jsonText = process.env.ORDERS_JSON ?? (flags.file ? readFileSync(flags.file, 'utf8') : '');
      if (!jsonText.trim()) {
        console.error('错误：请通过环境变量 ORDERS_JSON 或 --file=orders.json 提供订单 JSON 数组');
        process.exitCode = 1;
        break;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        console.error(`错误：ORDERS_JSON 不是合法 JSON: ${(e as Error).message}`);
        process.exitCode = 1;
        break;
      }
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const { valid, errors } = validateOrders(arr, new Set(products.map((p) => p.jan)), Object.keys(cards), settings.fees);
      if (errors.length > 0) {
        console.error('订单校验失败：');
        for (const e of errors) console.error(`  - ${e}`);
        process.exitCode = 1;
        break;
      }
      for (const o of valid) await repo.upsertOrder(db, o);
      await notifier.send(msg.buildOrdersSavedMessage(valid.map((o) => o.orderRef), now));
      console.log(`[完成] 已保存 ${valid.length} 笔订单: ${valid.map((o) => o.orderRef).join(', ')}`);
      break;
    }

    case 'verify-jan': {
      for (const p of products.filter((x) => x.active)) {
        if (process.env.KAITORIX_API_KEY) {
          const client = new KaitoriXClient({
            apiKey: process.env.KAITORIX_API_KEY,
            baseUrl: process.env.KAITORIX_BASE_URL,
            tpsMs: settings.quota.tpsMs,
          });
          try {
            const res = await client.getProduct(p.jan);
            const parsed = parseProductResponse(res.body, { jan: p.jan, model: p.model, color: p.color });
            const filtered = filterAndRank(parsed.quotes, { specialShopKeys: settings.specialShops.kaitoriIchimonme });
            const ok = parsed.warnings.length === 0;
            console.log(
              `${ok ? '✅' : '⚠️'} ${p.jan} ${p.colorZh}(${p.color}) → 名称: ${parsed.name} | 最高有效: ${filtered.best?.price ?? '—'} | 有效报价 ${filtered.valid.length} 家`,
            );
            for (const w of parsed.warnings) console.log(`    ⚠️ ${w}`);
          } catch (e) {
            console.log(`❌ ${p.jan} ${p.colorZh}: ${(e as Error).message}`);
          }
        } else {
          console.log(`⏭️  ${p.jan} ${p.colorZh}(${p.color}) ${p.model} ${p.capacity} — 未配置 KAITORIX_API_KEY，跳过在线校验`);
        }
      }
      console.log('[完成] JAN 校验结束。如有 ⚠️/❌ 请核对 config/products.json 中的 JAN 与颜色对应关系');
      break;
    }

    case 'notify-test': {
      await notifier.send(msg.buildTestMessage(now));
      console.log('[完成] 测试消息已处理');
      break;
    }

    case 'cleanup': {
      const r = await runCleanupIfDue(db, settings, now);
      console.log(r.ran ? `[完成] 清理 ${r.deleted} 条过期原始数据` : `[跳过] ${r.reason ?? ''}`);
      break;
    }

    default:
      console.error(`未知模式: ${mode}（可用: migrate / monitor / return-reminder / order-upsert / verify-jan / notify-test / cleanup）`);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`[致命错误] ${(e as Error).stack ?? e}`);
  process.exitCode = 1;
});
