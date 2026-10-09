export const config = {
  port: Number(process.env.PORT) || 3000,
  resolverUrl: (process.env.RESOLVER_API_URL || '').trim(),
  resolverKey: (process.env.RESOLVER_API_KEY || '').trim(),
  mediaHosts: (process.env.MEDIA_HOSTS || 'fbcdn.net,cdninstagram.com')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
  maxBytes: (Number(process.env.MAX_DOWNLOAD_MB) || 350) * 1024 * 1024,
};

export const demoMode = !config.resolverUrl;

// Credentials must never be transmitted to an untrusted or plaintext endpoint.
if (config.resolverUrl) {
  let endpoint;
  try { endpoint = new URL(config.resolverUrl); }
  catch { throw new Error('RESOLVER_API_URL must be a valid URL.'); }
  if (endpoint.protocol !== 'https:' &&
      !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('RESOLVER_API_URL must use HTTPS (or local HTTP for development).');
  }
}
