import { describe, expect, it } from 'vitest';
import { hashFlag, verifyFlag } from '../src/lib/flags.js';

describe('flag hashing', () => {
  it('never stores the plaintext and verifies the exact flag', () => {
    const hash = hashFlag('CTF{s3cr3t_fl4g}');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('s3cr3t');
    expect(verifyFlag('CTF{s3cr3t_fl4g}', hash)).toBe(true);
  });

  it('ignores surrounding whitespace but is case-sensitive', () => {
    const hash = hashFlag('CTF{s3cr3t_fl4g}');
    expect(verifyFlag('  CTF{s3cr3t_fl4g}\n', hash)).toBe(true);
    expect(verifyFlag('ctf{s3cr3t_fl4g}', hash)).toBe(false);
    expect(verifyFlag('CTF{s3cr3t_fl4g', hash)).toBe(false);
  });

  it('depends on the server secret', () => {
    const hash = hashFlag('CTF{s3cr3t_fl4g}', 'a'.repeat(32));
    expect(verifyFlag('CTF{s3cr3t_fl4g}', hash, 'b'.repeat(32))).toBe(false);
  });

  it('rejects corrupt stored hashes instead of throwing', () => {
    expect(verifyFlag('CTF{s3cr3t_fl4g}', 'not-hex')).toBe(false);
  });
});
