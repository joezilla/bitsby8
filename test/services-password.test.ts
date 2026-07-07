/**
 * Tests for the bcryptjs password wrapper.
 *
 * Uses real bcrypt hashing (no mocks) — bcryptjs is pure JS and small
 * enough to run inside jest without slowing the suite noticeably.
 */

import { hashPassword, verifyPassword, BCRYPT_COST } from '../src/services/password';

describe('password service', () => {
  test('hash round-trips through verify with the correct plaintext', async () => {
    const plaintext = 'correct horse battery staple';
    const hash = await hashPassword(plaintext);
    expect(hash).not.toBe(plaintext);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt format
    await expect(verifyPassword(plaintext, hash)).resolves.toBe(true);
  });

  test('verify returns false for the wrong password', async () => {
    const hash = await hashPassword('secret');
    await expect(verifyPassword('not-secret', hash)).resolves.toBe(false);
  });

  test('verify returns false for a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('secret', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });

  test('hash uses the expected cost factor (readable by decoding the $2b$XX$ prefix)', async () => {
    const hash = await hashPassword('any');
    // bcrypt format: $2b$<cost>$<salt><digest>
    const parts = hash.split('$');
    expect(parts[1]).toBe('2b');
    expect(parseInt(parts[2], 10)).toBe(BCRYPT_COST);
  });

  test('two hashes of the same plaintext differ (salt is random) but both verify', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    await expect(verifyPassword('same', a)).resolves.toBe(true);
    await expect(verifyPassword('same', b)).resolves.toBe(true);
  });
});
