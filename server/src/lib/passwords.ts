import { hash, verify } from '@node-rs/argon2';

// Library defaults: Argon2id, 19 MiB memory, 2 iterations (the OWASP baseline).
export const hashPassword = (password: string) => hash(password);

let dummyHash: Promise<string> | undefined;

/**
 * Checks a password against a stored hash. When the user doesn't exist, it still runs a hash
 * so the response time doesn't reveal which usernames are registered.
 */
export async function verifyPassword(storedHash: string | undefined, password: string): Promise<boolean> {
  if (storedHash === undefined) {
    dummyHash ??= hash('timing-equalizer-password');
    await verify(await dummyHash, password);
    return false;
  }
  return verify(storedHash, password);
}
