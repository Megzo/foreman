import { describe, expect, test } from "vitest";
import { generateKeyPair, signBundle, verifyBundle } from "./signing.js";

// The signing seam (FR-8.4): app bundles are Ed25519-signed by the author and
// the shell verifies the detached signature before ever applying one. The
// security property under test is "any byte flip fails verification".
describe("bundle signing (FR-8.4)", () => {
  test("a signature produced with the private key verifies with the public key", () => {
    const { publicKey, privateKey } = generateKeyPair();
    const bundle = Buffer.from("the app bundle bytes");

    const signature = signBundle(bundle, privateKey);

    expect(verifyBundle(bundle, signature, publicKey)).toBe(true);
  });

  test("a single flipped byte fails verification (tamper detection)", () => {
    const { publicKey, privateKey } = generateKeyPair();
    const bundle = Buffer.from("the app bundle bytes");
    const signature = signBundle(bundle, privateKey);

    const tampered = Buffer.from(bundle);
    tampered[0] = tampered[0]! ^ 0x01;

    expect(verifyBundle(tampered, signature, publicKey)).toBe(false);
  });

  test("a signature from a different key does not verify", () => {
    const author = generateKeyPair();
    const attacker = generateKeyPair();
    const bundle = Buffer.from("the app bundle bytes");

    const signature = signBundle(bundle, attacker.privateKey);

    expect(verifyBundle(bundle, signature, author.publicKey)).toBe(false);
  });

  test("a malformed signature is rejected rather than throwing", () => {
    const { publicKey } = generateKeyPair();
    expect(verifyBundle(Buffer.from("x"), "not-base64-sig!!", publicKey)).toBe(false);
  });
});
