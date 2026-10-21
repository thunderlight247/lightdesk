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

export type InboundStatus = {
  wamid: string;
  status: string; // "sent" | "delivered" | "read" | "failed" — stored as received
  timestamp: number | null;
  errors: { code: number | null; title: string | null; message: string | null; details: string | null }[];
};

export type ParsedStatusGroup = {
  phoneNumberId: string;
  statuses: InboundStatus[];
};

export type ParsedInbound = {
  messages: InboundMessage[];
  statuses: ParsedStatusGroup[];
  statusEvents: number; // kept for the documented count contract; equals sum of group sizes
};

const MAX_TEXT_CHARS = 4000;

/** Meta's body shape; anything malformed or truncated is handled defensively. */
export function parseInboundPayload(value: unknown): ParsedInbound {
  const messages: InboundMessage[] = [];
  const statuses: ParsedStatusGroup[] = [];
  let statusEvents = 0;
  const root = value as
    | { entry?: { id?: unknown; changes?: { field?: unknown; value?: {
        metadata?: { phone_number_id?: unknown }; contacts?: { profile?: { name?: unknown } }[];
        messages?: { id?: unknown; from?: unknown; type?: unknown; timestamp?: unknown; text?: { body?: unknown } }[];
        statuses?: { id?: unknown; status?: unknown; timestamp?: unknown; errors?: { code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } }[] }[];
      } }[] }[] }
    | null | undefined;
  if (!root || !Array.isArray(root.entry)) return { messages: [], statuses: [], statusEvents: 0 };
  for (const entry of root.entry) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change || change.field !== "messages" || !change.value) continue;
      const phoneNumberId = typeof change.value.metadata?.phone_number_id === "string" ? change.value.metadata.phone_number_id : null;
      if (!phoneNumberId) continue;
      if (Array.isArray(change.value.statuses)) {
        statusEvents += change.value.statuses.length;
        const group: InboundStatus[] = [];
        for (const s of change.value.statuses) {
          if (typeof s?.id !== "string" || typeof s?.status !== "string") continue; // can't target a row without the id
          const errors = Array.isArray(s.errors)
            ? s.errors
              .filter((e): e is { code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } } => !!e &&
                (typeof e.code === "number" || typeof e.title === "string" || typeof e.message === "string" || (typeof e.error_data?.details === "string")))
              .map((e) => ({
                code: typeof e.code === "number" ? e.code : null,
                title: typeof e.title === "string" ? e.title.slice(0, 300) : null,
                message: typeof e.message === "string" ? e.message.slice(0, 300) : null,
                details: typeof e.error_data?.details === "string" ? e.error_data.details.slice(0, 500) : null,
              }))
            : [];
          group.push({ wamid: s.id, status: s.status, timestamp: typeof s.timestamp === "string" && /^\d+$/.test(s.timestamp) ? Number(s.timestamp) : null, errors });
        }
        if (group.length > 0) statuses.push({ phoneNumberId, statuses: group });
      }
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
  return { messages, statuses, statusEvents };
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
