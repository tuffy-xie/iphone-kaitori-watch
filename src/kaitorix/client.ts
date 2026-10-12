// 買取X Open API 客户端
// 文档：https://kaitorix.app/open/docs
// 端点：GET /open/api/product/{jan_or_asin}
// 限额：Free 30 次/日（JST 0:00 重置）；TPS=1；429 分「每秒限流」与「日限耗尽」两种

export interface RawPrice {
  store: string;
  key: string;
  price: number | null;
  url?: string;
  updated?: string;
  updated_at?: string | null;
  stale?: boolean;
  stopped?: boolean;
  mark_note?: string | null;
  walkin_bonus?: number | null;
}

export interface RawProductResponse {
  jan?: string;
  asin?: string;
  name: string;
  max_price: number | null;
  prices: RawPrice[];
}

export interface ProductResult {
  body: RawProductResponse;
  /** 本次调用实际发出的 HTTP 请求数（含重试） */
  attempts: number;
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
}

export type KaitoriXErrorKind = 'auth' | 'not_found' | 'bad_request' | 'tps' | 'daily' | 'server' | 'network' | 'bad_response';

export class KaitoriXError extends Error {
  readonly kind: KaitoriXErrorKind;
  readonly status: number | null;
  readonly retryAfterSec: number | null;
  /** 本次调用实际发出的 HTTP 请求数（含重试） */
  readonly attempts: number;

  constructor(
    message: string,
    kind: KaitoriXErrorKind,
    status: number | null = null,
    retryAfterSec: number | null = null,
    attempts: number = 1,
  ) {
    super(message);
    this.name = 'KaitoriXError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.attempts = attempts;
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** 请求最小间隔（TPS=1 → 默认 1100ms） */
  tpsMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class KaitoriXClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly tpsMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private lastCallAt = 0;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) throw new Error('KAITORIX_API_KEY 未配置');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://kaitorix.app').replace(/\/+$/, '');
    this.tpsMs = opts.tpsMs ?? 1100;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private async respectTps(): Promise<void> {
    const now = Date.now();
    const wait = this.lastCallAt + this.tpsMs - now;
    if (wait > 0) await this.sleepImpl(wait);
    this.lastCallAt = Date.now();
  }

  /** 获取单个 JAN/ASIN 的買取报价 */
  async getProduct(jan: string): Promise<ProductResult> {
    let attempts = 0;
    let lastError: KaitoriXError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.respectTps();
      attempts++;
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/open/api/product/${encodeURIComponent(jan)}`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'User-Agent': 'iphone-kaitori-watch/1.0 (+https://github.com/)',
          },
        });
      } catch (e) {
        lastError = new KaitoriXError(`网络错误: ${(e as Error).message}`, 'network', null, null, attempts);
        if (attempt < this.maxRetries) {
          await this.sleepImpl(2000 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      const limit = this.numHeader(res.headers, 'x-ratelimit-limit');
      const remaining = this.numHeader(res.headers, 'x-ratelimit-remaining');
      const reset = this.numHeader(res.headers, 'x-ratelimit-reset');

      if (res.status === 200) {
        let body: RawProductResponse;
        try {
          body = (await res.json()) as RawProductResponse;
        } catch (e) {
          throw new KaitoriXError(`响应不是合法 JSON: ${(e as Error).message}`, 'bad_response', res.status, null, attempts);
        }
        if (!body || typeof body !== 'object' || !Array.isArray(body.prices)) {
          throw new KaitoriXError('响应缺少 prices 数组', 'bad_response', res.status, null, attempts);
        }
        return { body, attempts, rateLimitLimit: limit, rateLimitRemaining: remaining, rateLimitReset: reset };
      }

      // 429：区分 TPS（Retry-After<=1，不消耗日额度）与日限耗尽
      if (res.status === 429) {
        const retryAfter = this.numHeader(res.headers, 'retry-after');
        if (retryAfter !== null && retryAfter <= 1) {
          // 每秒限流：不消耗日额度，等待 1s+ 重试
          if (attempt < this.maxRetries) {
            await this.sleepImpl(Math.max(1100, (retryAfter ?? 1) * 1000));
            continue;
          }
          throw new KaitoriXError('TPS 限流重试后仍失败', 'tps', 429, retryAfter, attempts);
        }
        throw new KaitoriXError('買取X 每日请求额度已耗尽（JST 0:00 重置）', 'daily', 429, retryAfter, attempts);
      }

      // 5xx：退避重试
      if (res.status >= 500) {
        lastError = new KaitoriXError(`買取X 服务器错误 HTTP ${res.status}`, 'server', res.status, null, attempts);
        if (attempt < this.maxRetries) {
          await this.sleepImpl(3000 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      // 4xx：不重试
      if (res.status === 401 || res.status === 403) {
        throw new KaitoriXError('API Key 无效或未授权（401/403）', 'auth', res.status, null, attempts);
      }
      if (res.status === 404) {
        throw new KaitoriXError(`未找到商品: ${jan}（404）`, 'not_found', res.status, null, attempts);
      }
      throw new KaitoriXError(`HTTP ${res.status}`, 'bad_request', res.status, null, attempts);
    }
    throw lastError ?? new KaitoriXError('未知错误', 'network', null, null, attempts);
  }

  private numHeader(headers: Headers, name: string): number | null {
    const v = headers.get(name);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
