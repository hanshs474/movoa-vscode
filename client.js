// Movoa HTTP client. No VS Code imports, so it can be tested with plain node.
'use strict';

const BASE = 'https://movoa.ai';
const KEYS_URL = `${BASE}/settings/apikeys`;
// Same ids and options as the official SDK (movoa-ai on npm).
const MODELS = {
  'minimax-h3': { durations: [4, 5, 6, 8, 10, 15], resolutions: ['480p', '768p'], ratios: ['16:9', '9:16', '1:1'] },
  'seedance-2-5': { durations: [5, 10, 15, 20, 25, 30], resolutions: ['480p', '720p'], ratios: ['16:9', '9:16', '1:1'] },
  'seedance-2': { durations: [4, 6, 8, 10], resolutions: ['480p', '720p'], ratios: ['16:9', '9:16', '1:1'] },
  'seedance-2-fast': { durations: [4, 6, 8, 10], resolutions: ['480p', '720p'], ratios: ['16:9', '9:16', '1:1'] },
  'seedance-2-mini': { durations: [4, 6, 8, 10], resolutions: ['480p', '720p'], ratios: ['16:9', '9:16', '1:1'] },
  'veo-3-1-fast': { durations: [8], resolutions: ['720p'], ratios: ['16:9', '9:16'] },
};
const DEFAULT_MODEL = 'minimax-h3';
const NEEDS_KEY = `Movoa needs an API key. Create one at ${KEYS_URL}, then run "Movoa: Set API Key".`;

/** kind: auth | quota | plan | busy | rejected | failed | timeout | other */
class MovoaError extends Error {
  constructor(message, kind = 'other', id) {
    super(message);
    this.name = 'MovoaError';
    this.kind = kind;
    this.id = id;
  }
}

/** Snap a setting to what the chosen model takes, so a model switch never sends an option it refuses. */
function fit(model, { duration, resolution, ratio } = {}) {
  const m = MODELS[model] || MODELS[DEFAULT_MODEL];
  const want = Number(duration) || 5;
  const d = m.durations.includes(want) ? want
    : m.durations.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  return {
    duration: d,
    resolution: m.resolutions.includes(resolution) ? resolution : m.resolutions[0],
    ratio: ratio && m.ratios.includes(ratio) ? ratio : undefined,
  };
}

/** movoa.ai answers most refusals as HTTP 200 with a non-zero code and a data.reason. */
function explain(status, body = {}) {
  const msg = String(body.message || body.error || `HTTP ${status}`);
  const reason = body.data && body.data.reason;
  if (status === 401 || /no auth/i.test(msg)) return new MovoaError(`the API key was rejected. ${NEEDS_KEY}`, 'auth');
  if (body.code === -2 || body.code === -3) return new MovoaError(`${msg}. Reword the prompt and try again.`, 'rejected');
  if (reason === 'insufficient_credits') return new MovoaError('not enough credits on your Movoa account for this run.', 'quota');
  if (reason === 'plan_required') return new MovoaError('this model or quality needs a plan on your Movoa account.', 'plan');
  if (reason === 'concurrency') return new MovoaError('another run is still generating on this account. Try again when it finishes.', 'busy');
  return new MovoaError(msg);
}

async function call(path, json, o = {}) {
  const key = String(o.apiKey || '').trim();
  if (!key) throw new MovoaError(NEEDS_KEY, 'auth');
  const res = await (o.fetch || fetch)((o.base || BASE) + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(json || {}),
    signal: o.signal,
  });
  let body = {};
  try { body = (await res.json()) || {}; } catch { /* non-JSON error page; the status still says what happened */ }
  return { status: res.status, body };
}

/** Submit one clip; resolves to the task id. */
async function submit(prompt, o = {}) {
  if (!String(prompt || '').trim()) throw new MovoaError('prompt is required');
  const model = o.model || DEFAULT_MODEL;
  const f = fit(model, o);
  const options = { sound: true, duration: f.duration, resolution: f.resolution };
  if (f.ratio && !o.imageUrl) options.aspect_ratio = f.ratio;
  if (o.imageUrl) options.image_input = [o.imageUrl];
  const r = await call('/api/ai/generate', {
    provider: 'auto', mediaType: 'video', model,
    scene: o.imageUrl ? 'image-to-video' : 'text-to-video', prompt, options,
  }, o);
  const id = r.body && r.body.data && r.body.data.id;
  if (r.status !== 200 || r.body.code !== 0 || !id) throw explain(r.status, r.body);
  return String(id);
}

async function status(taskId, o = {}) {
  const r = await call('/api/ai/query', { taskId }, o);
  if (r.status !== 200 || r.body.code !== 0) {
    const e = explain(r.status, r.body);
    e.status = r.status;
    throw e;
  }
  return r.body.data || {};
}

/** Submit one clip and poll it; resolve to the finished video URL. */
async function generateVideo(prompt, o = {}) {
  const id = await submit(prompt, o);
  if (o.onQueued) o.onQueued(id);
  const deadline = Date.now() + (o.timeoutMs ?? 1_800_000);
  const every = o.pollEveryMs ?? 10_000;
  while (true) {
    if (o.signal && o.signal.aborted) throw new MovoaError(`cancelled; the clip may still land in your Movoa library`, 'timeout', id);
    if (Date.now() >= deadline) throw new MovoaError(`not finished in time; the clip will still land in your Movoa library`, 'timeout', id);
    await new Promise((r) => setTimeout(r, every));
    let t;
    try {
      t = await status(id, o);
    } catch (e) {
      // a dropped poll or a 5xx is not a failed run
      if (e instanceof MovoaError && e.status && e.status < 500) throw e;
      continue;
    }
    if (t.status === 'success' && t.videos && t.videos.length) return String(t.videos[0]);
    if (t.status === 'failed' || t.status === 'canceled') {
      throw new MovoaError(`the run ${t.status}${t.errorMessage ? `: ${t.errorMessage}` : ''}. Try rewording the prompt.`, 'failed', id);
    }
    if (o.onWaiting) o.onWaiting(t);
  }
}

/** Remaining credits on the account. Free to call. */
async function credits(o = {}) {
  const r = await call('/api/user/get-user-credits', {}, o);
  if (r.status === 200 && r.body.code === 0) return Number((r.body.data && r.body.data.remainingCredits) || 0);
  throw explain(r.status, r.body);
}

/** Upload a local image so it can be the first frame; resolves to its https URL. */
async function uploadImage(bytes, filename, o = {}) {
  // The upload endpoint checks the MIME type, so an untyped Blob is refused as "not an image".
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [, 'png'])[1].toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png';
  const form = new FormData();
  form.append('files', new Blob([bytes], { type }), filename);
  const res = await (o.fetch || fetch)(`${o.base || BASE}/api/storage/upload-image`, { method: 'POST', body: form, signal: o.signal });
  if (res.status === 413) throw new MovoaError('that image is over 10 MB.');
  let env = {};
  try { env = (await res.json()) || {}; } catch { /* fall through */ }
  const url = env.data && env.data.urls && env.data.urls[0];
  if (env.code !== 0 || !url) throw new MovoaError(`upload failed: ${env.message || `HTTP ${res.status}`}`);
  return url;
}

module.exports = {
  generateVideo, submit, status, credits, uploadImage, explain, fit, MovoaError,
  BASE, KEYS_URL, MODELS, DEFAULT_MODEL,
};
