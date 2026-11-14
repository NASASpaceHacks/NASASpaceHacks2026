import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSigningKey, publicKeyFor, type SigningKey } from '@mw/shared/link';

/** Hab Ed25519 route-signing key, generated on first start and persisted in <varDir>/key.json. */
export async function loadOrCreateKey(varDir: string): Promise<SigningKey> {
  const file = join(varDir, 'key.json');
  if (existsSync(file)) {
    try {
      const k = JSON.parse(readFileSync(file, 'utf8')) as Partial<SigningKey>;
      if (k.secretKeyHex && /^[0-9a-f]{64}$/i.test(k.secretKeyHex)) {
        return { secretKeyHex: k.secretKeyHex, publicKeyHex: await publicKeyFor(k.secretKeyHex) };
      }
    } catch {
      /* regenerate below */
    }
  }
  const key = await generateSigningKey();
  mkdirSync(varDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ alg: 'Ed25519', ...key, createdUtc: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  return key;
}
