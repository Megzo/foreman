import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

/**
 * Ed25519 signing for app bundles (FR-8.4, PRD Open Q8). The PRD recommends
 * @noble/ed25519, but Node's built-in crypto speaks Ed25519 natively, so we
 * stay dependency-free (the same "keep deps out" discipline as the rest of the
 * shell). Keys are PEM strings: the public key is what gets compiled into the
 * shell per app; the private key stays with the app author.
 */

export interface KeyPair {
  /** SPKI PEM — distributed/compiled into the shell to verify bundles. */
  publicKey: string;
  /** PKCS8 PEM — the author's signing secret, never shipped. */
  privateKey: string;
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

/** Detached signature over the exact bundle bytes, base64-encoded. */
export function signBundle(bundle: Buffer, privateKeyPem: string): string {
  // Ed25519 takes no separate digest algorithm — pass null.
  return cryptoSign(null, bundle, privateKeyPem).toString("base64");
}

/**
 * Verifies a detached signature over the bundle bytes. Fail-closed: any error
 * (malformed key/signature, wrong key, flipped byte) returns false, never throws
 * — a bad bundle must be rejected, not crash the updater (FR-8.6).
 */
export function verifyBundle(
  bundle: Buffer,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    return cryptoVerify(null, bundle, publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
