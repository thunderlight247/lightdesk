import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes → 43 base64url chars. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 is appropriate here because tokens are 256-bit random values
 * (no brute-force/dictionary risk, unlike passwords).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
