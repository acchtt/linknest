/** Cloudflare Pages runtime: Web APIs only. No cookies, Node crypto, or persistence. */
import { parseSocialUrl, LinkError } from '../../public/links.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const demoFiles = Object.freeze({
  'reel-hd': { path: 'reel-hd.mp4', mime: 'video/mp4' },
  'reel-sd': { path: 'reel-sd.mp4', mime: 'video/mp4' },
  'reel-poster': { path: 'reel-poster.jpg', mime: 'image/jpeg' },
  photo: { path: 'photo.jpg', mime: 'image/jpeg' },
  avatar: { path: 'avatar.jpg', mime: 'image/jpeg' },
});
const mimePattern = /^(?:image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm))$/;
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function json(data, status = 200) {
  return Response.json(data, { status, headers: noStore });
}
export function errorJson(message, code, status) {
  return json({ error: message, code }, status);
}
export function isDemo(env) { return !String(env?.RESOLVER_API_URL || '').trim(); }
function secret(env) { return String(env?.DOWNLOAD_SIGNING_SECRET || ''); }
function resolverEndpoint(env) {
  const raw = String(env?.RESOLVER_API_URL || '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  return url;
}
function hosts(env) {
  return String(env?.MEDIA_HOSTS || 'fbcdn.net,cdninstagram.com')
    .split(',').map(x => x.trim().toLowerCase()).filter(x => x && !x.includes('/') && !x.includes(':'));
}
export function trustedMediaUrl(raw, env) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    return hosts(env).some(host => url.hostname.toLowerCase() === host || url.hostname.toLowerCase().endsWith(`.${host}`));
  } catch { return false; }
}
function safeFilename(value, fallback) {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100) || fallback;
}
function validMime(mime, kind) {
  return mimePattern.test(mime) && (kind === 'image' ? mime.startsWith('image/') : mime.startsWith('video/'));
}
function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token');
  const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}
async function hmac(value, signingSecret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
export async function signToken(data, env, now = Date.now()) {
  if (secret(env).length < 32) throw new Error('DOWNLOAD_SIGNING_SECRET must be at least 32 characters.');
  const payload = toBase64Url(enc.encode(JSON.stringify({ ...data, exp: now + 10 * 60 * 1000 })));
  return `${payload}.${toBase64Url(await hmac(payload, secret(env)))}`;
}
export async function verifyToken(token, mode, env, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('Invalid download link.');
  const segments = token.split('.');
  if (segments.length !== 2) throw new Error('Invalid download link.');
  let actual;
  try { actual = fromBase64Url(segments[1]); } catch { throw new Error('Invalid download link.'); }
  const expected = await hmac(segments[0], secret(env));
  // Perform an equality check without early-exiting on the first differing byte.
  let mismatch = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ (actual[i] || 0);
  if (mismatch) throw new Error('Invalid download link.');
  let data;
  try { data = JSON.parse(dec.decode(fromBase64Url(segments[0]))); } catch { throw new Error('Invalid download link.'); }
  if (data?.mode !== mode || !Number.isFinite(data.exp) || now > data.exp) {
    throw new Error('This download link expired. Please resolve the post again.');
  }
  return data;
}

function demoResult({ platform, type }) {
  const isVideo = type === 'video' || type === 'reel';
  const image = type === 'profile' ? 'avatar' : 'photo';
  const videoEntry = (key, label, filename) => ({
    label, downloadUrl: `/demo/${demoFiles[key].path}`, filename,
  });
  return {
    platform, type, demo: true,
    title: isVideo ? 'A little moment, worth keeping' :
      type === 'profile' ? 'Profile image · sample' : 'Captured in color · sample',
    items: [{
      id: 'sample-1', kind: isVideo ? 'video' : 'image',
      previewUrl: `/demo/${demoFiles[isVideo ? 'reel-poster' : image].path}`,
      variants: isVideo ? [
        videoEntry('reel-hd', 'HD · 720p', 'linknest-sample-hd.mp4'),
        videoEntry('reel-sd', 'SD · 360p', 'linknest-sample-sd.mp4'),
      ] : [videoEntry(image, 'Original image', 'linknest-sample.jpg')],
    }],
  };
}
function providerUrl(url, env) {
  if (!trustedMediaUrl(url, env)) throw Object.assign(new Error('The media host is not permitted. Check MEDIA_HOSTS.'), { status: 502, code: 'HOST_NOT_ALLOWED' });
  return url;
}
async function mediaEndpoint(mode, data, env) {
  return `/api/${mode}/${await signToken({ mode, ...data }, env)}`;
}
async function toMediaResponse(data, classification, env) {
  if (!data || !Array.isArray(data.items) || !data.items.length || data.items.length > 10) {
    throw Object.assign(new Error('No downloadable public media was returned.'), { status: 422, code: 'MEDIA_UNAVAILABLE' });
  }
  const items = await Promise.all(data.items.map(async (item, index) => {
    const kind = item?.kind;
    if (!['image', 'video'].includes(kind)) throw new Error('Invalid media kind');
    const thumbnail = kind === 'image' ? item.imageUrl || item.thumbnailUrl : item.thumbnailUrl;
    const imageMime = item.thumbnailMime || 'image/jpeg';
    if (!thumbnail || !validMime(imageMime, 'image')) throw new Error('Invalid thumbnail');
    if (!Array.isArray(item.variants) || !item.variants.length || item.variants.length > 8) throw new Error('Invalid variants');
    const previewUrl = await mediaEndpoint('preview', { url: providerUrl(thumbnail, env), mime: imageMime }, env);
    const variants = await Promise.all(item.variants.map(async (variant, vIndex) => {
      const mime = variant?.mime || (kind === 'image' ? 'image/jpeg' : 'video/mp4');
      if (!validMime(mime, kind)) throw new Error('Invalid variant MIME');
      const ext = mime.split('/')[1].replace('jpeg', 'jpg');
      const filename = safeFilename(variant.filename, `linknest-${index + 1}-${vIndex + 1}.${ext}`);
      return {
        label: String(variant.label || 'Download').slice(0, 40),
        ...(Number.isFinite(variant.sizeBytes) && variant.sizeBytes >= 0 ? { sizeBytes: variant.sizeBytes } : {}),
        downloadUrl: await mediaEndpoint('download', { url: providerUrl(variant.url, env), mime, filename }, env),
      };
    }));
    return { id: `media-${index + 1}`, kind, previewUrl, variants };
  }));
  return { platform: classification.platform, type: classification.type, demo: false,
    title: String(data.title || 'Your media is ready').slice(0, 120), items };
}
export async function resolveRequest(context) {
  const { request, env } = context;
  if (!/application\/json/i.test(request.headers.get('content-type') || '')) return errorJson('Send a JSON request.', 'INVALID_REQUEST', 415);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 4096) return errorJson('That URL is too long.', 'INVALID_REQUEST', 413);
  let data;
  try {
    const raw = await request.text();
    if (enc.encode(raw).length > 4096) return errorJson('That URL is too long.', 'INVALID_REQUEST', 413);
    data = JSON.parse(raw);
  } catch { return errorJson('Invalid JSON request.', 'INVALID_REQUEST', 400); }
  let classification;
  try { classification = parseSocialUrl(data?.url); }
  catch (error) {
    return errorJson(error.message, error instanceof LinkError ? error.code : 'INVALID_URL', 400);
  }
  if (isDemo(env)) return json(demoResult(classification));
  const endpoint = resolverEndpoint(env);
  if (!endpoint || secret(env).length < 32) {
    return errorJson('Media provider is not configured correctly.', 'SERVER_CONFIG', 503);
  }
  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(env.RESOLVER_API_KEY ? { Authorization: `Bearer ${env.RESOLVER_API_KEY}` } : {}) },
      body: JSON.stringify({ url: classification.normalizedUrl, platform: classification.platform, type: classification.type }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { return errorJson('The media service is unavailable. Try again.', 'SERVICE_UNAVAILABLE', 503); }
  if ([401, 403].includes(upstream.status)) return errorJson('The media service did not authorize this request.', 'UNAUTHORIZED', 502);
  if ([404, 422].includes(upstream.status)) return errorJson('Content is private, unavailable, or unsupported.', 'MEDIA_UNAVAILABLE', 422);
  if (!upstream.ok) return errorJson('The media service returned an error.', 'PROVIDER_ERROR', 502);
  let providerData;
  try { providerData = await upstream.json(); }
  catch { return errorJson('The media service returned invalid data.', 'INVALID_PROVIDER_RESPONSE', 502); }
  try { return json(await toMediaResponse(providerData, classification, env)); }
  catch (error) {
    return errorJson(error.status === 422 ? error.message : 'Invalid media response or untrusted media host.', error.code || 'INVALID_PROVIDER_RESPONSE', error.status || 502);
  }
}

export async function mediaRequest(context, mode) {
  const { env, params } = context;
  if (secret(env).length < 32) return errorJson('Media downloads are not configured.', 'SERVER_CONFIG', 503);
  let token;
  try { token = await verifyToken(params.token, mode, env); }
  catch (error) { return errorJson(error.message, 'EXPIRED_OR_INVALID_TOKEN', 400); }
  if (!validMime(token.mime, token.mime?.startsWith('image/') ? 'image' : 'video') ||
      (mode === 'preview' && !token.mime.startsWith('image/')) || !trustedMediaUrl(token.url, env)) {
    return errorJson('Untrusted or invalid media source.', 'INVALID_MEDIA', 400);
  }
  const maxMB = Number(env.MAX_DOWNLOAD_MB) || 100;
  const maxBytes = Math.min(Math.max(maxMB, 1), 350) * 1024 * 1024;
  let remote = token.url;
  let upstream;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!trustedMediaUrl(remote, env)) throw new Error('Untrusted redirect');
      upstream = await fetch(remote, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000) });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get('location');
      if (!location || redirects === 3) throw new Error('Invalid redirect');
      await upstream.body?.cancel();
      remote = new URL(location, remote).toString();
    }
    if (!upstream.ok || !upstream.body) throw new Error('Upstream unavailable');
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && contentType !== 'application/octet-stream' && contentType !== token.mime) {
      throw new Error('Content type mismatch');
    }
    const lengthHeader = upstream.headers.get('content-length');
    const length = lengthHeader == null ? null : Number(lengthHeader);
    if (length != null && (!Number.isFinite(length) || length < 0 || length > maxBytes)) throw new Error('Invalid media size');
  } catch {
    await upstream?.body?.cancel().catch(() => {});
    return errorJson('Unable to download media right now.', 'DOWNLOAD_FAILED', 502);
  }
  let bytes = 0;
  const limitStream = new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) { controller.error(new Error('Media exceeds size limit')); return; }
      controller.enqueue(chunk);
    },
  });
  const headers = new Headers({ 'Content-Type': token.mime, ...noStore });
  if (mode === 'download') {
    headers.set('Content-Disposition', `attachment; filename="${safeFilename(token.filename, 'media')}"`);
  }
  // Do not claim Content-Length when the upstream might be corrupt or chunked.
  return new Response(upstream.body.pipeThrough(limitStream), { headers });
}