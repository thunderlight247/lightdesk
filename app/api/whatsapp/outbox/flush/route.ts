import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { flushOutboxForBusiness } from "@/modules/whatsapp/outbox";
import { readWhatsappConfig } from "@/modules/whatsapp/config";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/security/errors";

/** Constant-time bearer-token check (same trick as webhook signature verification). */
function tokenMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  const config = readWhatsappConfig();
  if (!config.outboxFlushToken) {
    return NextResponse.json({ error: "disabled" }, { status: 403 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !tokenMatches(parts[1] ?? "", config.outboxFlushToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Invalid input");
  }
  const businessId = parseOrThrow(businessIdSchema, (body as { businessId?: unknown }).businessId);
  const result = await flushOutboxForBusiness(businessId);
  return NextResponse.json(result);
}
