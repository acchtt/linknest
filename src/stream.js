import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { DEMO_FILES, isTrustedMediaUrl } from './resolver.js';

const DEMO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/demo');

export async function serveMedia(req, res, token) {
  const isDownload = token.mode === 'download';
  const mime = token.mime;
  if (!/^(image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm))$/.test(mime || '')) {
    return res.status(400).json({ error: 'Invalid content type.', code: 'INVALID_MEDIA' });
  }
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  if (isDownload) {
    const filename = String(token.filename || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  if (token.fileKey) {
    const file = DEMO_FILES[token.fileKey];
    if (!file || file.mime !== mime || (token.mode === 'preview' && !mime.startsWith('image/'))) {
      return res.status(400).end();
    }
    return res.sendFile(path.join(DEMO_DIR, file.path));
  }
  if (typeof token.url !== 'string' || !isTrustedMediaUrl(token.url)) {
    return res.status(400).json({ error: 'Untrusted media source.', code: 'INVALID_MEDIA' });
  }
  if (token.mode === 'preview' && !mime.startsWith('image/')) return res.status(400).end();

  let remote = token.url;
  let upstream;
  const controller = new AbortController();
  const headerTimeout = setTimeout(() => controller.abort(), 20000);
  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      if (!isTrustedMediaUrl(remote)) throw new Error('Untrusted redirect target');
      upstream = await fetch(remote, {
        headers: { 'User-Agent': 'LinkNest/1.0' },
        redirect: 'manual', signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get('location');
        if (!location || redirect === 3) throw new Error('Too many redirects');
        const next = new URL(location, remote).toString();
        if (!isTrustedMediaUrl(next)) throw new Error('Untrusted redirect target');
        await upstream.body?.cancel();
        remote = next;
        continue;
      }
      break;
    }
    clearTimeout(headerTimeout);
    if (!upstream.ok || !upstream.body) throw new Error('Media could not be fetched');
    const remoteType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (remoteType && remoteType !== 'application/octet-stream' &&
        !remoteType.startsWith(mime.startsWith('image/') ? 'image/' : 'video/')) {
      throw new Error('Unexpected upstream content type');
    }
    const size = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(size) && size > config.maxBytes) throw new Error('Media exceeds size limit');
    // Also cap chunked/unreported responses so the server cannot proxy unlimited bytes.
    let seen = 0;
    const { Transform } = await import('node:stream');
    const limiter = new Transform({
      transform(chunk, encoding, cb) {
        seen += chunk.length;
        if (seen > config.maxBytes) cb(new Error('Media exceeds size limit'));
        else cb(null, chunk);
      },
    });
    if (Number.isFinite(size) && size > 0) res.setHeader('Content-Length', String(size));
    await pipeline(Readable.fromWeb(upstream.body), limiter, res);
  } catch {
    controller.abort();
    if (!res.headersSent) res.status(502).json({ error: 'Unable to download media right now.', code: 'DOWNLOAD_FAILED' });
    else res.destroy();
  } finally {
    clearTimeout(headerTimeout);
  }
}
