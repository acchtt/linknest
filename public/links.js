/**
 * Shared browser/server classifier. A valid public-looking URL is not proof
 * that media is available: the authorized resolver determines that later.
 */
export class LinkError extends Error {
  constructor(message, code = 'INVALID_URL') {
    super(message);
    this.name = 'LinkError';
    this.code = code;
  }
}

const IG_RESERVED = new Set([
  'accounts', 'about', 'api', 'challenge', 'developer', 'developers',
  'directory', 'direct', 'download', 'emails', 'explore', 'legal', 'press',
  'privacy', 'reels', 'reel', 'p', 'stories', 'tags', 'tv', 'web'
]);

export function parseSocialUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1500) {
    throw new LinkError('Paste a Facebook or Instagram link to continue.');
  }

  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) {
    if (/^(?:www\.|m\.|web\.)?(?:facebook\.com|instagram\.com|fb\.watch|instagr\.am)\//i.test(value)) {
      value = `https://${value}`;
    } else {
      throw new LinkError('Please paste a complete Facebook or Instagram URL.');
    }
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LinkError('This URL does not look valid. Check the link and try again.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new LinkError('Only standard Facebook and Instagram links are supported.');
  }
  const hostname = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const path = url.pathname.toLowerCase();
  let platform;
  let type;

  if (['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'].includes(hostname)) {
    platform = 'instagram';
    if (/^\/(?:reel|reels)\/[^/]+\/?$/i.test(path)) {
      type = 'reel';
    } else if (/^\/p\/[^/]+\/?$/i.test(path)) {
      type = 'photo';
    } else if (parts.length === 1 && /^[a-zA-Z0-9._]{1,30}$/.test(parts[0]) && !IG_RESERVED.has(parts[0].toLowerCase())) {
      type = 'profile';
    } else {
      throw new LinkError('Supported Instagram links: Reels, photo posts, and public profile URLs.', 'UNSUPPORTED');
    }
  } else if (['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(hostname)) {
    platform = 'facebook';
    if (hostname === 'fb.watch') {
      if (!parts.length) throw new LinkError('This Facebook watch link is incomplete.');
      type = 'video';
    } else if (/^\/(?:reel|share\/r)\/[^/]+\/?$/i.test(path)) {
      type = 'reel';
    } else if (
      (/^\/watch\/?$/i.test(path) && url.searchParams.has('v')) ||
      /(?:^|\/)videos\/[^/]+/i.test(path) ||
      /^\/share\/v\/[^/]+\/?$/i.test(path) ||
      /^\/video\.php$/i.test(path) && url.searchParams.has('v')
    ) {
      type = 'video';
    } else {
      throw new LinkError('Supported Facebook links: public video and Reel URLs.', 'UNSUPPORTED');
    }
  } else {
    throw new LinkError('Only Facebook and Instagram URLs are supported.', 'UNSUPPORTED');
  }

  // Enforce HTTPS and drop fragments; leave query fields intact (some are essential).
  url.protocol = 'https:';
  url.hash = '';
  return { platform, type, normalizedUrl: url.toString() };
}
