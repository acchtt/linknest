import { config, demoMode } from './config.js';
import { signMediaToken } from './tokens.js';

export class ResolveError extends Error {
  constructor(message, code = 'FETCH_FAILED', status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const DEMO_FILES = {
  'reel-hd': { path: 'reel-hd.mp4', mime: 'video/mp4' },
  'reel-sd': { path: 'reel-sd.mp4', mime: 'video/mp4' },
  'reel-poster': { path: 'reel-poster.jpg', mime: 'image/jpeg' },
  'photo': { path: 'photo.jpg', mime: 'image/jpeg' },
  'avatar': { path: 'avatar.jpg', mime: 'image/jpeg' },
};
export { DEMO_FILES };

function safeFilename(value, fallback) {
  const result = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100);
  return result || fallback;
}

function allowedMime(mime, kind) {
  const list = kind === 'video' ? ['video/mp4', 'video/webm'] :
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  return list.includes(mime);
}

export function isTrustedMediaUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return config.mediaHosts.some(host => url.hostname.toLowerCase() === host ||
      url.hostname.toLowerCase().endsWith(`.${host}`));
  } catch { return false; }
}

function createMediaUrl(mode, info) {
  const token = signMediaToken({ mode, ...info });
  return `/api/${mode === 'preview' ? 'preview' : 'download'}/${token}`;
}

function demoEntry(fileKey, label, filename) {
  return {
    label,
    downloadUrl: createMediaUrl('download', {
      fileKey, mime: DEMO_FILES[fileKey].mime, filename,
    }),
  };
}

export function getDemoResult({ platform, type }) {
  const image = type === 'profile' ? 'avatar' : 'photo';
  const isVideo = type === 'video' || type === 'reel';
  return {
    platform, type, demo: true,
    title: isVideo ? 'A little moment, worth keeping' :
      type === 'profile' ? 'Profile image · sample' : 'Captured in color · sample',
    items: [{
      id: 'sample-1', kind: isVideo ? 'video' : 'image',
      previewUrl: createMediaUrl('preview', {
        fileKey: isVideo ? 'reel-poster' : image, mime: 'image/jpeg',
      }),
      variants: isVideo ? [
        demoEntry('reel-hd', 'HD · 720p', 'linknest-sample-hd.mp4'),
        demoEntry('reel-sd', 'SD · 360p', 'linknest-sample-sd.mp4'),
      ] : [demoEntry(image, 'Original image', 'linknest-sample.jpg')],
    }],
  };
}

function safeProviderMedia(raw) {
  if (!isTrustedMediaUrl(raw)) {
    throw new ResolveError('The media host is not on the server allowlist. Check MEDIA_HOSTS.', 'HOST_NOT_ALLOWED', 502);
  }
  return raw;
}

/**
 * Resolver contract (a provider you are authorized to use):
 * POST { url, platform, type }
 * => { title, items: [{kind: 'video'|'image', thumbnailUrl?, imageUrl?,
 *      variants: [{label, url, mime, filename?, sizeBytes?}]}] }
 * No login, cookie, private-content bypass or HTML scraping is performed here.
 */
export async function resolveMedia(classification) {
  if (demoMode) return getDemoResult(classification);
  let response;
  try {
    // Never follow a redirect carrying API authorization to another origin.
    response = await fetch(config.resolverUrl, {
      method: 'POST', redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(config.resolverKey ? { Authorization: `Bearer ${config.resolverKey}` } : {}),
      },
      body: JSON.stringify({
        url: classification.normalizedUrl,
        platform: classification.platform, type: classification.type,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ResolveError('The media service could not be reached. Please try again.', 'SERVICE_UNAVAILABLE', 503);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ResolveError('The media provider did not authorize this request.', 'UNAUTHORIZED', 502);
  }
  if (response.status === 404 || response.status === 422) {
    throw new ResolveError('Content is unavailable, private, removed, or unsupported.', 'MEDIA_UNAVAILABLE', 422);
  }
  if (!response.ok) throw new ResolveError('The media service returned an error. Please try again.', 'PROVIDER_ERROR', 502);
  let data;
  try { data = await response.json(); }
  catch { throw new ResolveError('The media service returned an invalid response.', 'INVALID_PROVIDER_RESPONSE', 502); }
  if (!data || !Array.isArray(data.items) || data.items.length === 0 || data.items.length > 10) {
    throw new ResolveError('No downloadable public media was returned.', 'MEDIA_UNAVAILABLE', 422);
  }

  const items = data.items.map((item, index) => {
    const kind = item.kind;
    if (!['video', 'image'].includes(kind)) {
      throw new ResolveError('The provider returned an unsupported media type.', 'INVALID_PROVIDER_RESPONSE', 502);
    }
    const thumbnail = kind === 'image' ? (item.imageUrl || item.thumbnailUrl) : item.thumbnailUrl;
    if (!thumbnail) throw new ResolveError('The provider did not return a thumbnail.', 'INVALID_PROVIDER_RESPONSE', 502);
    const imageMime = item.thumbnailMime || 'image/jpeg';
    if (!allowedMime(imageMime, 'image')) throw new ResolveError('Invalid preview format.', 'INVALID_PROVIDER_RESPONSE', 502);
    const previewUrl = createMediaUrl('preview', {
      url: safeProviderMedia(thumbnail), mime: imageMime,
    });
    if (!Array.isArray(item.variants) || !item.variants.length || item.variants.length > 8) {
      throw new ResolveError('No download qualities were returned.', 'MEDIA_UNAVAILABLE', 422);
    }
    const variants = item.variants.map((variant, vIndex) => {
      const mime = variant.mime || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      if (!allowedMime(mime, kind)) throw new ResolveError('Unsupported file format returned.', 'INVALID_PROVIDER_RESPONSE', 502);
      const ext = mime.split('/')[1].replace('jpeg', 'jpg');
      const filename = safeFilename(variant.filename, `linknest-${index + 1}-${vIndex + 1}.${ext}`);
      return {
        label: String(variant.label || (kind === 'video' ? 'Download video' : 'Original image')).slice(0, 40),
        ...(Number.isFinite(variant.sizeBytes) && variant.sizeBytes >= 0 ? { sizeBytes: variant.sizeBytes } : {}),
        downloadUrl: createMediaUrl('download', {
          url: safeProviderMedia(variant.url), mime, filename,
        }),
      };
    });
    return { id: `media-${index + 1}`, kind, previewUrl, variants };
  });

  return {
    platform: classification.platform, type: classification.type,
    demo: false, title: String(data.title || 'Your media is ready').slice(0, 120), items,
  };
}
