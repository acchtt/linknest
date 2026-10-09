/**
 * Public deployment smoke test; requires Node >= 20 and no dependencies.
 * Does not store submitted links or download full video files.
 * Usage: LINKNEST_URL=https://example.pages.dev node scripts/live-smoke.mjs
 */
const origin = new URL(process.env.LINKNEST_URL || 'https://linknest-3bg.pages.dev');
const base = origin.origin;
const results = [];

async function request(path, options = {}) {
  const url = new URL(path, base);
  if (url.origin !== base) throw new Error('Unexpected cross-origin request');
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: { 'Cache-Control': 'no-cache', ...options.headers },
    ...options,
  });
  return response;
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, pass: false, detail: error.message });
    console.error(`FAIL ${name} — ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`Testing ${base}`);
await check('Homepage HTML', async () => {
  const response = await request('/');
  expect(response.status === 200, `Expected 200, got ${response.status}`);
  const html = await response.text();
  expect(/LinkNest/i.test(html), 'LinkNest branding missing');
  expect(/<form\b/i.test(html), 'URL form missing');
  return '200 OK';
});

await check('Frontend JavaScript', async () => {
  const response = await request('/app.js');
  expect(response.status === 200, `Expected 200, got ${response.status}`);
  const js = await response.text();
  expect(js.includes('/api/resolve'), 'Frontend resolver endpoint missing');
  return '200 OK';
});

let demoMode;
await check('Pages Function: /api/health', async () => {
  const response = await request('/api/health');
  expect(response.status === 200, `Expected 200, got ${response.status}`);
  const json = await response.json();
  expect(json.status === 'ok' && typeof json.demo === 'boolean', 'Unexpected health response (not Pages Functions?)');
  demoMode = json.demo;
  return `healthy, ${demoMode ? 'demo' : 'provider'} mode`;
});

await check('Pages Function: /api/config', async () => {
  const response = await request('/api/config');
  expect(response.status === 200, `Expected 200, got ${response.status}`);
  const json = await response.json();
  expect(typeof json.demo === 'boolean' && json.demo === demoMode, 'Config and health mismatch');
  return `demo=${json.demo}`;
});

await check('Reject unsupported links', async () => {
  const response = await request('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/not-a-social-media-url' }),
  });
  expect(response.status === 400, `Expected 400, got ${response.status}`);
  const json = await response.json();
  expect(typeof json.error === 'string', 'Missing error message');
  return '400 with explanatory JSON';
});

if (demoMode === true) {
  await check('Demo Instagram Reel response', async () => {
    const response = await request('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.instagram.com/reel/CXexample01/' }),
    });
    expect(response.status === 200, `Expected 200, got ${response.status}`);
    const json = await response.json();
    expect(json.demo === true, 'Demo response not labelled');
    expect(json.platform === 'instagram' && json.type === 'reel', 'Wrong URL classification');
    expect(json.items?.[0]?.kind === 'video', 'Expected video');
    expect(json.items[0].previewUrl === '/demo/reel-poster.jpg', 'Missing sample thumbnail');
    expect(json.items[0].variants?.length === 2, 'Missing HD/SD variants');
    return 'thumbnail + HD/SD links';
  });

  await check('Demo video sample available', async () => {
    const response = await request('/demo/reel-hd.mp4', { method: 'HEAD' });
    expect(response.status === 200, `Expected 200, got ${response.status}`);
    const type = response.headers.get('content-type') || '';
    expect(type.includes('video/mp4'), `Expected video/mp4, got ${type}`);
    return '200 video/mp4';
  });
  await check('Demo Instagram photo available', async () => {
    const response = await request('/demo/photo.jpg', { method: 'HEAD' });
    expect(response.status === 200, `Expected 200, got ${response.status}`);
    const type = response.headers.get('content-type') || '';
    expect(type.includes('image/jpeg'), `Expected image/jpeg, got ${type}`);
    return '200 image/jpeg';
  });
} else if (demoMode === false) {
  console.log('INFO Provider mode detected; skipping arbitrary real-media retrieval without permission.');
}

const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
if (failed.length) process.exitCode = 1;