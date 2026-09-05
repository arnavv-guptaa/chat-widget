// Dependency-free tests of the real wire guard. Also imported by the Vitest
// store suite. Local: node --experimental-strip-types test/hosted-history-contract.mjs
import assert from 'node:assert/strict';
import { historyQuery, readHistoryResponse, assertHistoryPage, HISTORY_PAGINATION, HISTORY_PAGINATION_HEADER } from '../src/server/stores/hosted/history.ts';
const timestamp = new Date('2026-01-01T00:00:00.000Z');
const row = (id, createdAt = timestamp) => ({ id, createdAt, role: 'user', parts: [], text: id });
const all = Array.from({ length: 337 }, (_, i) => row(`m-${String(i).padStart(4, '0')}`, new Date(+timestamp + Math.floor(i / 140))));
const header = { [HISTORY_PAGINATION_HEADER]: HISTORY_PAGINATION };
let assertions = 0;
const check = (value, expected) => { assert.deepEqual(value, expected); assertions++; };
check(historyQuery().limit, 100);
check(historyQuery({ limit: 5000 }).limit, 101);
check(historyQuery({ limit: NaN }).limit, 100);
check(historyQuery({ limit: 2.9 }).limit, 2);
check(historyQuery({ limit: 0 }).limit, 1);
assert.throws(() => historyQuery({ beforeId: 'orphan' })); assertions++;
check(Object.fromEntries(historyQuery({ before: timestamp, beforeId: 'm/&?=+' }).query), {
  historyPagination: HISTORY_PAGINATION, limit: '100', before: timestamp.toISOString(), beforeId: 'm/&?=+',
});

// The historical API fixture is intentionally capped, unlike the old all-rows
// test double. Both first probe and continuation must throw, not return [] or
// a short page that leads the router to set hasMore=false.
for (const opts of [{ limit: 101 }, { limit: 31, before: all[150].createdAt, beforeId: all[150].id }]) {
  const { query } = historyQuery(opts);
  check(query.has('limit'), true);
  await assert.rejects(readHistoryResponse(new Response(JSON.stringify({ messages: all.slice(-100) }))), /lacks created-at-id-v1/); assertions++;
}
for (const status of [401, 403, 500, 503]) { await assert.rejects(readHistoryResponse(new Response('', { status }))); assertions++; }
check(await readHistoryResponse(new Response('', { status: 404 })), []);
await assert.rejects(readHistoryResponse(new Response('<html>', { headers: header })), /Invalid hosted history response/); assertions++;

for (const size of [1, 30, 100]) {
  let opts = { limit: size + 1 };
  let ids = [];
  for (let n = 0; n < 400; n++) {
    const { limit } = historyQuery(opts);
    const page = all.filter((m) => !opts.before || +m.createdAt < +opts.before || (+m.createdAt === +opts.before && m.id < opts.beforeId)).slice(-limit);
    assertHistoryPage(page, limit, opts); assertions++;
    const raw = await readHistoryResponse(new Response(JSON.stringify({ messages: page }), { headers: header }));
    check(raw.length, page.length);
    const hasMore = page.length > size;
    const visible = hasMore ? page.slice(-size) : page;
    ids = [...visible.map((m) => m.id), ...ids];
    if (!hasMore) break;
    opts = { limit: size + 1, before: visible[0].createdAt, beforeId: visible[0].id };
  }
  check(ids, all.map((m) => m.id));
  check(new Set(ids).size, 337);
}
// C/UTF8 differs from locale sorting and JS UTF16 for supplementary characters.
assertHistoryPage([row('Z'), row('a'), row('\uE000'), row('\u{10000}')], 4); assertions++;
for (const page of [[row('b'), row('a')], [row('a'), row('a')], [row('a'), row('b'), row('c')]]) {
  assert.throws(() => assertHistoryPage(page, 2)); assertions++;
}
assert.throws(() => assertHistoryPage([row('b')], 1, { before: timestamp, beforeId: 'b' })); assertions++;
assert.throws(() => assertHistoryPage([row('a')], 1, { before: timestamp })); assertions++;
console.log(`hosted-history-contract: ${assertions} assertions passed`);
