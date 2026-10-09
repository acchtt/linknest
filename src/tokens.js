import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

// The secret is ephemeral. Tokens expire and nothing is persisted to disk.
const secret = randomBytes(32);
const MAX_TOKEN_CHARS = 8192;

function signature(payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signMediaToken({ mode, url, fileKey, mime, filename }) {
  const payload = Buffer.from(JSON.stringify({
    mode, url, fileKey, mime, filename,
    exp: Date.now() + 10 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyMediaToken(token, expectedMode) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS || !token.includes('.')) {
    throw new Error('Invalid download link. Please resolve the post again.');
  }
  const [payload, mac, ...extra] = token.split('.');
  if (extra.length || !mac) throw new Error('Invalid download link.');
  const expected = Buffer.from(signature(payload));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid download link.');
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid download link.'); }
  if (parsed.mode !== expectedMode || !Number.isFinite(parsed.exp) || Date.now() > parsed.exp) {
    throw new Error('This download link expired. Please resolve the post again.');
  }
  return parsed;
}
