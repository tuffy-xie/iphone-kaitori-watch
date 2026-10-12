// 買取X 客户端：429 区分、重试、TPS；D1 REST：请求格式、重试

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KaitoriXClient, KaitoriXError } from '../src/kaitorix/client.ts';
import { D1RestDb, splitSql } from '../src/db/d1.ts';

test('429 + Retry-After>1 判定为日额度耗尽（不重试）', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: 'limit' }), {
      status: 429,
      headers: { 'retry-after': '3600', 'x-ratelimit-remaining': '0' },
    })) as typeof fetch;
  const client = new KaitoriXClient({ apiKey: 'k', tpsMs: 0, fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(
    () => client.getProduct('4549995734546'),
    (e: KaitoriXError) => {
      assert.equal(e.kind, 'daily');
      assert.match(e.message, /JST 0:00 重置/);
      return true;
    },
  );
});

test('429 + Retry-After=1 判定为 TPS 限流，等待后重试', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) {
      return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
    }
    return new Response(JSON.stringify({ jan: '4549995734546', name: 'x', max_price: 1, prices: [] }), {
      status: 200,
      headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '29' },
    });
  }) as typeof fetch;
  const sleeps: number[] = [];
  const client = new KaitoriXClient({
    apiKey: 'k', tpsMs: 0, fetchImpl,
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });
  const res = await client.getProduct('4549995734546');
  assert.equal(calls, 2);
  assert.ok(sleeps.some((ms) => ms >= 1100), 'TPS 重试至少间隔 1.1s');
  assert.equal(res.rateLimitRemaining, 29);
});

test('5xx 退避重试后成功；401 不重试直接报错', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls < 3) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ jan: 'x', name: 'x', max_price: 1, prices: [] }), { status: 200 });
  }) as typeof fetch;
  const client = new KaitoriXClient({ apiKey: 'k', tpsMs: 0, fetchImpl, sleepImpl: async () => {} });
  await client.getProduct('4549995734546');
  assert.equal(calls, 3);

  const authFetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  const client2 = new KaitoriXClient({ apiKey: 'bad', tpsMs: 0, fetchImpl: authFetch, sleepImpl: async () => {} });
  await assert.rejects(() => client2.getProduct('4549995734546'), (e: KaitoriXError) => e.kind === 'auth');
});

test('TPS 间隔：两次请求间隔不小于设定值', async () => {
  const times: number[] = [];
  const fetchImpl = (async () => {
    times.push(Date.now());
    return new Response(JSON.stringify({ jan: 'x', name: 'x', max_price: 1, prices: [] }), { status: 200 });
  }) as typeof fetch;
  const client = new KaitoriXClient({ apiKey: 'k', tpsMs: 60, fetchImpl });
  await client.getProduct('1111111');
  await client.getProduct('2222222');
  assert.ok(times[1] - times[0] >= 55, `间隔 ${times[1] - times[0]}ms`);
});

test('D1 REST：请求 URL/Body/鉴权格式，5xx 重试后成功', async () => {
  const calls: { url: string; body: unknown; auth: string }[] = [];
  let n = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
      auth: String((init?.headers as Record<string, string>)?.Authorization ?? ''),
    });
    n++;
    if (n === 1) return new Response('{}', { status: 500 });
    return new Response(
      JSON.stringify({ result: [{ results: [{ a: 1 }], success: true, meta: { changes: 2, last_row_id: 7 } }], success: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const db = new D1RestDb({
    accountId: 'acc123',
    databaseId: 'db456',
    apiToken: 'tok789',
    fetchImpl,
    sleepImpl: async () => {},
  });
  const rows = await db.query<{ a: number }>('SELECT * FROM t WHERE x = ?', ['v']);
  assert.deepEqual(rows, [{ a: 1 }]);
  assert.equal(calls.length, 2, '5xx 后重试一次');
  assert.match(calls[1].url, /accounts\/acc123\/d1\/database\/db456\/query$/);
  assert.deepEqual((calls[1].body as { sql: string; params: string[] }).sql, 'SELECT * FROM t WHERE x = ?');
  assert.deepEqual((calls[1].body as { sql: string; params: string[] }).params, ['v']);
  assert.equal(calls[1].auth, 'Bearer tok789');

  const run = await db.run('UPDATE t SET a = ?', [1]);
  assert.equal(run.changes, 2);
  assert.equal(run.lastInsertRowid, 7);
});

test('D1 REST：错误响应抛出；exec 切分 SQL', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ success: false, errors: [{ message: 'no such table' }] }), { status: 200 })) as typeof fetch;
  const db = new D1RestDb({ accountId: 'a', databaseId: 'b', apiToken: 'c', fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(() => db.query('SELECT 1'), /no such table/);

  const stmts = splitSql('-- 注释\nCREATE TABLE a (x);\nINSERT INTO a VALUES (1); -- 行尾注释\n');
  assert.equal(stmts.length, 2);
  assert.equal(stmts[0], 'CREATE TABLE a (x)');
});
