import test from 'node:test';
import assert from 'node:assert/strict';
import { signMediaToken, verifyMediaToken } from '../src/tokens.js';

test('signs and verifies short-lived download tokens', () => {
  const token = signMediaToken({ mode: 'download', fileKey: 'photo', mime: 'image/jpeg', filename: 'photo.jpg' });
  const data = verifyMediaToken(token, 'download');
  assert.equal(data.filename, 'photo.jpg');
  assert.throws(() => verifyMediaToken(token, 'preview'));
  assert.throws(() => verifyMediaToken(token + 'x', 'download'));
});
