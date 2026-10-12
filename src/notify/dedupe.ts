// 通知器：DRY_RUN 打印 + 事件去重（同一事件只推送一次）

import type { Db } from '../types.ts';
import { markNotified, wasNotified } from '../db/repo.ts';
import { sendTelegram, type TelegramOptions } from './telegram.ts';

export class Notifier {
  private readonly db: Db | null;
  private readonly tg: TelegramOptions | null;
  private readonly dryRun: boolean;

  constructor(db: Db | null, tg: TelegramOptions | null, dryRun: boolean) {
    this.db = db;
    this.tg = tg;
    this.dryRun = dryRun;
  }

  /** 直接发送（日报等，不去重） */
  async send(text: string): Promise<void> {
    if (this.dryRun) {
      console.log(`\n──────── TELEGRAM (DRY_RUN，未发送) ────────\n${text}\n──────── /TELEGRAM ────────\n`);
      return;
    }
    const r = await sendTelegram(text, this.tg);
    if (!r.ok) console.error(`Telegram 发送失败: ${r.error}`);
  }

  /** 带去重发送：返回 false 表示该事件今天/历史已推送过 */
  async sendOnce(eventKey: string, text: string): Promise<boolean> {
    if (this.dryRun) {
      console.log(`\n──────── TELEGRAM (DRY_RUN，未发送) [event: ${eventKey}] ────────\n${text}\n──────── /TELEGRAM ────────\n`);
      return true;
    }
    if (this.db) {
      if (await wasNotified(this.db, eventKey)) return false;
    }
    const r = await sendTelegram(text, this.tg);
    if (!r.ok) {
      console.error(`Telegram 发送失败(${eventKey}): ${r.error}`);
      return false;
    }
    if (this.db) await markNotified(this.db, eventKey, text.slice(0, 120));
    return true;
  }
}
