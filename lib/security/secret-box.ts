/**
 * AES-256-GCM encryption for WhatsApp access tokens stored in the database
 * (WhatsAppConnection.tokenCiphertext). The key comes from WHATSAPP_TOKEN_ENCRYPTION_KEY
 * (32 bytes as 64 hex chars). Ciphertext format: base64(iv || authTag || data) — iv is
 * random per call, the auth tag guarantees tamper detection. Secrets are never logged.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_RE = /^[0-9a-f]{64}$/i;

export function readSecretBoxKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = (env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!KEY_RE.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

/** Returns null on any failure (wrong key, tampered ciphertext, unreadable format) — call sites treat that as "no valid token". */
export function decryptSecret(ciphertext: string, key: Buffer): string | null {
  try {
    const raw = Buffer.from(ciphertext, "base64");
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
