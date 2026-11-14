import * as ed from '@noble/ed25519';
import type { PlanPackage } from '../contracts/types';
import { canonicalCbor } from './codec';

/**
 * Ed25519 (RFC 8032) route-package signatures via @noble/ed25519 (async API → WebCrypto SHA-512,
 * available in browsers and Node ≥ 20). The signature covers the canonical CBOR of the package
 * with `sig` removed, so the visor can verify a ROUTE_PUSH with only the hab's 32-byte public key.
 */

export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Bytes the signature covers: canonical CBOR of the package without `sig`. */
export function packageSigningBytes(pkg: PlanPackage): Uint8Array {
  const { sig: _sig, ...body } = pkg;
  return canonicalCbor(body);
}

export interface SigningKey {
  secretKeyHex: string;
  publicKeyHex: string;
}

export async function generateSigningKey(): Promise<SigningKey> {
  const sk = ed.utils.randomSecretKey();
  const pk = await ed.getPublicKeyAsync(sk);
  return { secretKeyHex: toHex(sk), publicKeyHex: toHex(pk) };
}

export async function publicKeyFor(secretKeyHex: string): Promise<string> {
  return toHex(await ed.getPublicKeyAsync(fromHex(secretKeyHex)));
}

/** Signature (hex) over `packageSigningBytes(pkg)`. Does not mutate `pkg`. */
export async function signPackage(pkg: PlanPackage, secretKeyHex: string): Promise<string> {
  return toHex(await ed.signAsync(packageSigningBytes(pkg), fromHex(secretKeyHex)));
}

/** True when `pkg.sig` is a valid Ed25519 signature by `publicKeyHex`. Never throws. */
export async function verifyPackage(pkg: PlanPackage, publicKeyHex: string): Promise<boolean> {
  try {
    if (!pkg.sig) return false;
    return await ed.verifyAsync(fromHex(pkg.sig), packageSigningBytes(pkg), fromHex(publicKeyHex));
  } catch {
    return false;
  }
}
