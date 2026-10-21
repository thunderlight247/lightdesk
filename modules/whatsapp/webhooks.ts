/**
 * Webhook payload parsing and X-Hub-Signature-256 verification for the WhatsApp Cloud API
 * (spec §3.4). Pure functions only — the route handler stays a thin shell; unit tests cover
 * these with no network and no database.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type InboundMessage = {
  phoneNumberId: string;
  wamid: string;
  fromPhone: string;
  profileName: string | null;
  text: string | null; // present only for type "text"
  type: string; // "text", "image", "button", "interactive", ... stored as received
  timestamp: number | null; // unix seconds from Meta, if present
};

export type ParsedInbound = {
  messages: InboundMessage[];
  statusEvents: number; // counted only; delivery-status handling is M6d
};

const MAX_TEXT_CHARS = 4000;

/** Meta's body shape; anything malformed or truncated is handled defensively. */
export function parseInboundPayload(value: unknown): ParsedInbound {
  const messages: InboundMessage[] = [];
  let statusEvents = 0;
  const root = value as
    | { entry?: { id?: unknown; changes?: { field?: unknown; value?: {
        metadata?: { phone_number_id?: unknown }; contacts?: { profile?: { name?: unknown } }[];
        messages?: { id?: unknown; from?: unknown; type?: unknown; timestamp?: unknown; text?: { body?: unknown } }[];
        statuses?: unknown[];
      } }[] }[] }
    | null | undefined;
  if (!root || !Array.isArray(root.entry)) return { messages: [], statusEvents: 0 };
  for (const entry of root.entry) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change || change.field !== "messages" || !change.value) continue;
      const phoneNumberId = typeof change.value.metadata?.phone_number_id === "string" ? change.value.metadata.phone_number_id : null;
      if (!phoneNumberId) continue;
      if (Array.isArray(change.value.statuses)) statusEvents += change.value.statuses.length;
      const profileName = Array.isArray(change.value.contacts) && typeof change.value.contacts[0]?.profile?.name === "string"
        ? change.value.contacts[0].profile.name.slice(0, 120) : null;
      if (!Array.isArray(change.value.messages)) continue;
      for (const m of change.value.messages) {
        if (typeof m.id !== "string" || typeof m.from !== "string") continue; // can't dedupe without an id
        const type = typeof m.type === "string" ? m.type : "unknown";
        const text = typeof m.text?.body === "string" && m.text.body.length > 0 ? m.text.body.slice(0, MAX_TEXT_CHARS) : null;
        const ts = typeof m.timestamp === "string" && /^\d+$/.test(m.timestamp) ? Number(m.timestamp) : null;
        messages.push({ phoneNumberId, wamid: m.id, fromPhone: m.from, profileName, text, type, timestamp: ts });
      }
    }
  }
  return { messages, statusEvents };
}

/**
 * Meta signs every webhook POST with HMAC-SHA256 over the RAW body:
 * `X-Hub-Signature-256: sha256=<hex>`. Fails closed on anything unexpected.
 */
export function verifyWebhookSignature(appSecret: string, rawBody: string | Uint8Array, header: string | null): boolean {
  if (!appSecret || !header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header);
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Compare handshake tokens without content-dependent early exits (including length). */
export function verifyWebhookToken(expectedToken: string, suppliedToken: string | null): boolean {
  if (!expectedToken || suppliedToken === null) return false;
  const expectedDigest = createHash("sha256").update(expectedToken, "utf8").digest();
  const suppliedDigest = createHash("sha256").update(suppliedToken, "utf8").digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}
