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
  const config = readWhatsappConfig();
  if (!config.appSecret) return new Response("forbidden", { status: 403, headers: noStore });
  const raw = await req.text();
  if (!verifyWebhookSignature(config.appSecret, raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("forbidden", { status: 403, headers: noStore });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
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
