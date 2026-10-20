/**
 * Public WhatsApp Cloud API webhook endpoint (spec §3.4). No session: Meta is the caller.
 *
 * GET  — subscription handshake: echoes hub.challenge only when hub.verify_token matches
 *        WHATSAPP_WEBHOOK_VERIFY_TOKEN (compare happens on the server value; nothing leaked).
 * POST — fails closed without WHATSAPP_APP_SECRET (no signature check is possible), rejects
 *        bad signatures with 403, then records each inbound message idempotently (OWNER_ONLY
 *        default — nothing is ever sent in this phase) and always answers Meta quickly.
 */
import { readWhatsappConfig } from "@/modules/whatsapp/config";
import { recordInboundMessage } from "@/modules/whatsapp/service";
import { parseInboundPayload, verifyWebhookSignature } from "@/modules/whatsapp/webhooks";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" } as const;

/** Middleware guard for POST: reads the raw body ONCE (Request bodies are single-use),
 *  verifies it against WHATSAPP_APP_SECRET via x-hub-signature-256 before anything else
 *  happens, and either returns a rejection Response or the verified raw body. */
async function verifyWebhookGuard(req: Request): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const config = readWhatsappConfig();
  if (!config.appSecret) return { ok: false, response: new Response("forbidden", { status: 403, headers: noStore }) };
  const body = await req.text();
  if (!verifyWebhookSignature(config.appSecret, body, req.headers.get("x-hub-signature-256"))) {
    return { ok: false, response: new Response("forbidden", { status: 403, headers: noStore }) };
  }
  return { ok: true, body };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const config = readWhatsappConfig();
  const challenge = url.searchParams.get("hub.challenge");
  if (
    url.searchParams.get("hub.mode") === "subscribe" &&
    !!config.webhookVerifyToken &&
    !!challenge &&
    url.searchParams.get("hub.verify_token") === config.webhookVerifyToken
  ) {
    return new Response(challenge, { headers: { ...noStore, "content-type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403, headers: noStore });
}

export async function POST(req: Request) {
  const guarded = await verifyWebhookGuard(req);
  if (!guarded.ok) return guarded.response;
  let payload: unknown;
  try {
    payload = JSON.parse(guarded.body);
  } catch {
    return new Response("bad request", { status: 400, headers: noStore });
  }
  const { messages } = parseInboundPayload(payload);
  let stored = 0;
  let unknown = 0;
  for (const msg of messages) {
    const recorded = await recordInboundMessage(msg);
    if (recorded) {
      if (!recorded.duplicate) stored += 1;
    } else {
      unknown += 1;
    }
  }
  return Response.json({ received: stored, unknown }, { headers: noStore });
}
