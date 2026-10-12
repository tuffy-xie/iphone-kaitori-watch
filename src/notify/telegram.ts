// Telegram Bot API 发送（支持 DRY_RUN：只打印不发送）

export interface TelegramOptions {
  token: string;
  chatId: string;
}

export interface SendResult {
  ok: boolean;
  mocked: boolean;
  error?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegram(
  text: string,
  opts: TelegramOptions | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!opts) {
    console.log(`[TELEGRAM 未配置，仅打印]\n${text}`);
    return { ok: true, mocked: true };
  }
  const res = await fetchImpl(`https://api.telegram.org/bot${opts.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: opts.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !data?.ok) {
    return { ok: false, mocked: false, error: data?.description ?? `HTTP ${res.status}` };
  }
  return { ok: true, mocked: false };
}
