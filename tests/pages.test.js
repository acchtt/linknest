import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveRequest, signToken, verifyToken, trustedMediaUrl, mediaRequest } from '../functions/_lib/core.js';
import { onRequestGet as configGet } from '../functions/api/config.js';
import { onRequestGet as healthGet } from '../functions/api/health.js';
import { onRequestPost as resolvePost } from '../functions/api/resolve.js';
import { onRequestGet as downloadGet } from '../functions/api/download/[token].js';

const secret = 'some-64-character-randomish-dev-key-change-in-production-123456';
const env = { DOWNLOAD_SIGNING_SECRET: secret, MEDIA_HOSTS: 'allowed.example' };
const url = 'https://www.instagram.com/reel/testmedia/';
function request(data, e = {}) {
  return {
    env: e,
    request: new Request('https://linknest.pages.dev/api/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }),
  };
}

test('Cloudflare Pages routes: demo config and health', async () => {
  assert.deepEqual(await (await configGet({ env: {} })).json(), { demo: true });
  assert.deepEqual(await (await healthGet({ env: {} })).json(), { status: 'ok', demo: true });
  assert.equal((await configGet({ env: { RESOLVER_API_URL: 'https://api.example' } })).headers.get('Cache-Control'), 'no-store');
});

test('Cloudflare Pages resolver: sample image and video and safe static paths', async () => {
  const video = await resolvePost(request({ url }));
  assert.equal(video.status, 200);
  const payload = await video.json();
  assert.equal(payload.demo, true);
  assert.equal(payload.items[0].kind, 'video');
  assert.equal(payload.items[0].previewUrl, '/demo/reel-poster.jpg');
  assert.match(payload.items[0].variants[0].downloadUrl, /^\/demo\/reel-hd\.mp4$/);
  const photo = await resolveRequest(request({ url: 'https://www.instagram.com/p/hello/' }));
  assert.equal((await photo.json()).items[0].kind, 'image');
});

test('Cloudflare Pages resolver: unsupported, malformed, oversized JSON', async () => {
  const invalid = await resolvePost(request({ url: 'https://example.com/private' }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'UNSUPPORTED');
  const ctx = request({ url });
  ctx.request = new Request(ctx.request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal((await resolvePost(ctx)).status, 400);
  const oversized = await resolvePost(request({ url: 'A'.repeat(4100) }));
  assert.equal(oversized.status, 413);
});

test('HMAC tokens are mode-bound, expire, survive requests, and reject forgery', async () => {
  const stamp = 100_000;
  const signed = await signToken({ mode: 'download', url: 'https://allowed.example/video.mp4', mime: 'video/mp4', filename: 'saved.mp4' }, env, stamp);
  assert.equal((await verifyToken(signed, 'download', env, stamp + 20)).filename, 'saved.mp4');
  await assert.rejects(() => verifyToken(signed, 'preview', env, stamp));
  await assert.rejects(() => verifyToken(signed, 'download', env, stamp + 601_000));
  await assert.rejects(() => verifyToken(signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A'), 'download', env, stamp));
  await assert.rejects(() => signToken({ mode: 'download' }, { DOWNLOAD_SIGNING_SECRET: 'short' }));
});

test('Allowlist rejects credentials, non-HTTPS, arbitrary redirects and wrong hosts', () => {
  assert.equal(trustedMediaUrl('https://cdn.allowed.example/photo.jpg', env), true);
  assert.equal(trustedMediaUrl('https://allowed.example/photo.jpg', env), true);
  for (const v of ['http://allowed.example/a', 'https://evilallowed.example/a', 'https://bad:pass@allowed.example/a', 'https://127.0.0.1/a', 'https://allowed.example:444/a']) {
    assert.equal(trustedMediaUrl(v, env), false, v);
  }
});

test('Real resolver mode fails closed without secret or valid HTTPS resolver', async () => {
  const ctx = request({ url }, { RESOLVER_API_URL: 'http://wrong.example' });
  assert.equal((await resolvePost(ctx)).status, 503);
  const live = request({ url }, { RESOLVER_API_URL: 'https://api.example/resolve' });
  assert.equal((await resolvePost(live)).status, 503);
});

test('Cloudflare downloads: invalid tokens rejected without fetching', async () => {
  const response = await downloadGet({ env, params: { token: 'not-a-token' } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'EXPIRED_OR_INVALID_TOKEN');
});

test('Cloudflare downloads: token and CDN response are proxied with download headers', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (resource) => {
      assert.equal(resource, 'https://allowed.example/video.mp4');
      return new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } });
    };
    const token = await signToken({ mode: 'download', url: 'https://allowed.example/video.mp4', mime: 'video/mp4', filename: 'my-video.mp4' }, env);
    const res = await mediaRequest({ env, params: { token } }, 'download');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="my-video.mp4"');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1, 2, 3]);
  } finally { globalThis.fetch = original; }
});

test('Cloudflare routing declaration restricts Functions to /api', async () => {
  const routes = JSON.parse(await readFile(new URL('../public/_routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(routes.include, ['/api/*']);
});

test('Connected resolver: preserves public-only errors and handles provider overload', async () => {
  const original = globalThis.fetch;
  const liveEnv = { ...env, RESOLVER_API_URL: 'https://resolver.example/api/resolve', RESOLVER_API_KEY: 'server-only-token' };
  try {
    globalThis.fetch = async (resource, options) => {
      assert.equal(resource.href ?? resource, liveEnv.RESOLVER_API_URL);
      assert.equal(options.headers.Authorization, 'Bearer server-only-token');
      return new Response(JSON.stringify({ error: 'Busy' }), { status: 429, headers: { 'content-type': 'application/json' } });
    };
    const busy = await resolvePost(request({ url }, liveEnv));
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).code, 'SERVICE_BUSY');
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PROFILE_UNAVAILABLE' }), { status: 422 });
    const profile = await resolvePost(request({ url: 'https://www.instagram.com/exampleprofile/' }, liveEnv));
    assert.equal(profile.status, 422);
    assert.match((await profile.json()).error, /authorized account API/i);
  } finally { globalThis.fetch = original; }
});

test('Connected resolver: refuses untrusted media before signing download URLs', async () => {
  const original = globalThis.fetch;
  const liveEnv = { ...env, RESOLVER_API_URL: 'https://resolver.example/api/resolve' };
  try {
    globalThis.fetch = async () => Response.json({ title: 'Test video', items: [{
      kind: 'video', thumbnailUrl: 'https://allowed.example/p.jpg',
      variants: [{ label: 'HD', url: 'https://evil.example/v.mp4', mime: 'video/mp4' }],
    }] });
    const response = await resolvePost(request({ url }, liveEnv));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'HOST_NOT_ALLOWED');
  } finally { globalThis.fetch = original; }
});