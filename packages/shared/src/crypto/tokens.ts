import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** Generate a cryptographically secure opaque token (256 bits, base64url). */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/** Generate a short human-readable pairing code (uppercase alphanumerics, no ambiguous chars). */
export function generatePairingCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Constant-time comparison of two hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function newId(prefix: string): string {
  // time-sortable-ish unique id
  const ts = Date.now().toString(36);
  const rnd = randomBytes(8).toString("hex");
  return `${prefix}_${ts}_${rnd}`;
}