import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSocialUrl, LinkError } from '../public/links.js';

const scenarios = [
  ['https://www.facebook.com/reel/1234/', 'facebook', 'reel'],
  ['https://www.facebook.com/share/r/abc/', 'facebook', 'reel'],
  ['https://www.facebook.com/watch/?v=19900', 'facebook', 'video'],
  ['https://m.facebook.com/somepage/videos/123/', 'facebook', 'video'],
  ['https://fb.watch/abcd/', 'facebook', 'video'],
  ['https://www.instagram.com/reel/DHabc/', 'instagram', 'reel'],
  ['https://instagram.com/p/DY123/?img_index=2', 'instagram', 'photo'],
  ['instagram.com/example.profile/', 'instagram', 'profile'],
  ['https://www.instagram.com/reels/DGxyz/', 'instagram', 'reel'],
];
for (const [url, platform, type] of scenarios) {
  test(`classifies ${url}`, () => {
    assert.equal(parseSocialUrl(url).platform, platform);
    assert.equal(parseSocialUrl(url).type, type);
  });
}

test('rejects unsupported or unsafe URLs', () => {
  for (const url of [
    'https://evil-facebook.com/reel/100',
    'https://instagram.com/stories/person/100',
    'https://instagram.com/explore/',
    'https://facebook.com/photo/?fbid=999',
    'ftp://instagram.com/reel/111',
    'https://127.0.0.1/secret',
    'https://user:pass@instagram.com/reel/hello',
    'https://instagram.com:9443/p/abcd',
  ]) assert.throws(() => parseSocialUrl(url), LinkError);
});

test('enforces HTTPS and drops fragments', () => {
  const obj = parseSocialUrl('http://instagram.com/reel/hello/#hello');
  assert.equal(obj.normalizedUrl, 'https://instagram.com/reel/hello/');
});
