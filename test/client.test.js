'use strict';
// node test/client.test.js        -> mocked unit tests (response shapes from the live API)
// MOVOA_API_KEY=sk-... node test/client.test.js --live   -> free live calls only: wrong-key submit + credits()
const assert = require('assert');
const { generateVideo, submit, credits, fit, MovoaError } = require('../client');

function mockFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ url, body, headers: init.headers });
    const path = new URL(url).pathname;
    const [status, json] = routes[path](body, calls);
    return { status, json: async () => json };
  };
  f.calls = calls;
  return f;
}

const fast = { pollEveryMs: 1, apiKey: 'sk-test' };

(async () => {
  if (process.argv.includes('--live')) {
    await assert.rejects(submit('a cat', { apiKey: 'sk-wrong' }), (e) => e.kind === 'auth');
    console.log('live: wrong key -> auth ok');
    if (process.env.MOVOA_API_KEY) console.log('live: credits =', await credits({ apiKey: process.env.MOVOA_API_KEY }));
    return;
  }

  // success, with a queued poll first
  let polls = 0;
  const ok = mockFetch({
    '/api/ai/generate': () => [200, { code: 0, data: { id: 't1', status: 'pending' } }],
    '/api/ai/query': () => [200, { code: 0, data: polls++ ? { status: 'success', videos: ['https://cdn.movoa.ai/x.mp4'] } : { status: 'processing', queued: true, queueEta: 90 } }],
  });
  const waits = [];
  assert.strictEqual(await generateVideo('a lantern', { ...fast, fetch: ok, ratio: '9:16', onWaiting: (t) => waits.push(t) }), 'https://cdn.movoa.ai/x.mp4');
  const sent = ok.calls[0].body;
  assert.deepStrictEqual(sent, { provider: 'auto', mediaType: 'video', model: 'minimax-h3', scene: 'text-to-video', prompt: 'a lantern', options: { sound: true, duration: 5, resolution: '480p', aspect_ratio: '9:16' } });
  assert.strictEqual(ok.calls[0].headers.authorization, 'Bearer sk-test');
  assert.strictEqual(waits[0].queueEta, 90);

  // image to video
  const i2v = mockFetch({ '/api/ai/generate': () => [200, { code: 0, data: { id: 't2' } }], '/api/ai/query': () => [200, { code: 0, data: { status: 'success', videos: ['u'] } }] });
  await generateVideo('move', { ...fast, fetch: i2v, model: 'seedance-2-5', duration: 7, resolution: '768p', imageUrl: 'https://x/a.png', ratio: '16:9' });
  assert.deepStrictEqual(i2v.calls[0].body.options, { sound: true, duration: 5, resolution: '480p', image_input: ['https://x/a.png'] });
  assert.strictEqual(i2v.calls[0].body.scene, 'image-to-video');

  // fit
  assert.deepStrictEqual(fit('veo-3-1-fast', { duration: 5, resolution: '480p', ratio: '1:1' }), { duration: 8, resolution: '720p', ratio: undefined });

  // error mapping
  const refuse = (status, json) => mockFetch({ '/api/ai/generate': () => [status, json] });
  const kind = async (status, json) => { try { await submit('p', { ...fast, fetch: refuse(status, json) }); } catch (e) { return e.kind; } };
  assert.strictEqual(await kind(401, { code: -1, message: 'invalid', data: { reason: 'invalid_api_key' } }), 'auth');
  assert.strictEqual(await kind(200, { code: -1, message: 'no auth' }), 'auth');
  assert.strictEqual(await kind(200, { code: -1, message: 'x', data: { reason: 'plan_required' } }), 'plan');
  assert.strictEqual(await kind(200, { code: -1, message: 'x', data: { reason: 'insufficient_credits' } }), 'quota');
  assert.strictEqual(await kind(200, { code: -1, message: 'x', data: { reason: 'concurrency' } }), 'busy');
  assert.strictEqual(await kind(200, { code: -2, message: 'blocked' }), 'rejected');
  assert.strictEqual(await kind(200, { code: -3, message: 'cooldown' }), 'rejected');
  await assert.rejects(submit('p', { fetch: refuse(200, {}) }), (e) => e.kind === 'auth' && /settings\/apikeys/.test(e.message));

  // failed run
  const failed = mockFetch({ '/api/ai/generate': () => [200, { code: 0, data: { id: 't3' } }], '/api/ai/query': () => [200, { code: 0, data: { status: 'failed', errorMessage: 'nsfw' } }] });
  await assert.rejects(generateVideo('p', { ...fast, fetch: failed }), (e) => e.kind === 'failed' && /nsfw/.test(e.message) && e.id === 't3');

  // a 5xx poll is retried, not fatal
  let n = 0;
  const flaky = mockFetch({ '/api/ai/generate': () => [200, { code: 0, data: { id: 't4' } }], '/api/ai/query': () => (n++ ? [200, { code: 0, data: { status: 'success', videos: ['v'] } }] : [502, {}]) });
  assert.strictEqual(await generateVideo('p', { ...fast, fetch: flaky }), 'v');

  // timeout carries the task id
  const slow = mockFetch({ '/api/ai/generate': () => [200, { code: 0, data: { id: 't5' } }], '/api/ai/query': () => [200, { code: 0, data: { status: 'processing' } }] });
  await assert.rejects(generateVideo('p', { ...fast, fetch: slow, timeoutMs: 20 }), (e) => e instanceof MovoaError && e.kind === 'timeout' && e.id === 't5');

  // credits
  assert.strictEqual(await credits({ apiKey: 'k', fetch: mockFetch({ '/api/user/get-user-credits': () => [200, { code: 0, data: { remainingCredits: 42 } }] }) }), 42);

  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
