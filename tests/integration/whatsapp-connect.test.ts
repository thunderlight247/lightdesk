import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resetDb, twoTenants } from "../helpers/db";
import {
  completeEmbeddedSignupChoice, disconnectWhatsAppConnection, getSignupState, startEmbeddedSignup,
} from "@/modules/whatsapp/onboarding";
import { decryptSecret } from "@/lib/security/secret-box";

// The connect flow needs the Meta app credentials and the secret-box key; set them deterministically
// for this file and restore the previous environment afterwards.
const ENV_KEYS = [
  "WHATSAPP_APP_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_SIGNUP_CONFIG_ID", "WHATSAPP_TOKEN_ENCRYPTION_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.WHATSAPP_APP_ID = "TEST-APP-ID";
  process.env.WHATSAPP_APP_SECRET = "TEST-APP-SECRET";
  process.env.WHATSAPP_SIGNUP_CONFIG_ID = "TEST-CONFIG-ID";
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const NOW = new Date("2026-10-21T00:00:00.000Z");
const NOW_FN = () => new Date(NOW);
const LONG_TOKEN = "LONG-LIVED-TEST-TOKEN";
const EXPIRES_IN_S = 5184000; // Meta's usual ~60 days for long-lived tokens

type Route = { match: string; respond: () => Response };
function graphFetch(routes: Route[]) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    return route ? route.respond() : new Response(JSON.stringify({ error: { message: "route not stubbed" } }), { status: 400 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
// The upgrade URL also contains "/oauth/access_token", so the ORDER matters: the specific
// grant_type route must be found first, then the plain exchange route.
const oauthRoutes = (): Route[] => [
  { match: "grant_type=fb_exchange_token", respond: () => json({ access_token: LONG_TOKEN, token_type: "bearer", expires_in: EXPIRES_IN_S }) },
  { match: "/oauth/access_token", respond: () => json({ access_token: "SHORT-LIVED-TOKEN", token_type: "bearer", expires_in: 3600 }) },
];

const singleNumberRoutes = (extra: Route[] = []): Route[] => [
  ...oauthRoutes(),
  { match: "/me/businesses", respond: () => json({ data: [{ id: "WABA1", name: "Owner's WABA" }] }) },
  { match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111", display_phone_number: "+1 555-0100", verified_name: "Test Shop" }] }) },
  { match: "/111?", respond: () => json({ id: "111", display_phone_number: "+1 555-0100", verified_name: "Test Shop", quality_rating: "GREEN" }) },
  { match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111" }] }) }, // ownership cross-check
  ...extra,
];

function seed(overrides: Partial<{ role: "OWNER" | "ADMIN" | "MEMBER" }> = {}) {
  return twoTenants().then(({ ownerA, adminA, memberA, ownerB, bizA, bizB }) => {
    const actor = overrides.role === "ADMIN" ? adminA : overrides.role === "MEMBER" ? memberA : ownerA;
    return { ownerA, adminA, memberA, ownerB, actor, bizA, bizB };
  });
}

// Clean BEFORE every test too: earlier test files leave seeded users (owner-a@test.example …)
// behind, and twoTenants would collide on the unique email on this file's first test.
beforeEach(async () => {
  await resetDb();
});
afterEach(async () => {
  await resetDb();
});

describe("Embedded Signup permissions and availability", () => {
  it("exposes state to every member but reserves control for the OWNER", async () => {
    const { actor: owner, adminA, memberA, bizA } = await seed();
    const ownerState = await getSignupState(owner.id, bizA.id);
    expect(ownerState.isOwner).toBe(true);
    expect(ownerState.signupReady).toBe(true);
    expect(ownerState.existing).toBeNull();
    const adminState = await getSignupState(adminA.id, bizA.id);
    expect(adminState.isOwner).toBe(false);
    expect((await getSignupState(memberA.id, bizA.id)).isOwner).toBe(false);
    // Control actions stay owner-only regardless of the send permission level:
    await expect(startEmbeddedSignup(adminA.id, bizA.id, { code: "CODE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(completeEmbeddedSignupChoice(memberA.id, bizA.id, { pendingId: "x", wabaId: "WABA1", phoneNumberId: "111" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(disconnectWhatsAppConnection(adminA.id, bizA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.auditEvent.count({ where: { action: { in: ["whatsapp.connection.connected", "whatsapp.connection.disconnected"] }, businessId: bizA.id } })).toBe(0);
  });

  it("rejects unusable signup callbacks before any Graph traffic", async () => {
    const { actor, bizA } = await seed();
    let called = 0;
    const spy = (async () => { called += 1; return json({}); }) as unknown as typeof fetch;
    for (const bad of [null, "", "a".repeat(1025), "bad code with spaces"]) {
      await expect(startEmbeddedSignup(actor.id, bizA.id, { code: bad }, { fetchImpl: spy, now: NOW_FN })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(called).toBe(0);
    expect(await prisma.whatsAppPendingConnection.count()).toBe(0);
  });
});

describe("Embedded Signup connect flow", () => {
  it("binds a single-number account immediately: token stored encrypted, expiry recorded, audit written", async () => {
    const { actor, bizA } = await seed();
    const routes = graphFetch(singleNumberRoutes());
    const result = await startEmbeddedSignup(actor.id, bizA.id, { code: "GOOD-CODE" }, { fetchImpl: routes.impl, now: NOW_FN });
    expect(result.outcome).toBe("connected");
    if (result.outcome !== "connected") return;
    expect(result.connection).toMatchObject({ displayPhoneNumber: "+1 555-0100", phoneNumberId: "111", wabaId: "WABA1", coexistence: false });
    expect(await prisma.whatsAppPendingConnection.count()).toBe(0);
    const connection = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(decryptSecret(connection.tokenCiphertext, Buffer.alloc(32, 9))).toBe(LONG_TOKEN);
    expect(connection.tokenExpiresAt?.toISOString()).toBe(new Date(NOW.getTime() + EXPIRES_IN_S * 1000).toISOString());
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.connection.connected", businessId: bizA.id } });
    expect(audit.actorUserId).toBe(actor.id);
    expect(audit.metadata).toMatchObject({ replaced: false });
    expect(JSON.stringify(audit.metadata)).not.toContain(LONG_TOKEN);
  });

  it("puts the owner in a choose step for multiple numbers and holds the token ONLY server-side", async () => {
    const { actor, bizA } = await seed();
    const routes = graphFetch([
      { match: "grant_type=fb_exchange_token", respond: () => json({ access_token: LONG_TOKEN, token_type: "bearer", expires_in: EXPIRES_IN_S }) },
      { match: "/oauth/access_token", respond: () => json({ access_token: "SHORT", token_type: "bearer", expires_in: 3600 }) },
      { match: "/me/businesses", respond: () => json({ data: [{ id: "WABA1", name: "Shop" }] }) },
      { match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111", display_phone_number: "+1 555-0100" }, { id: "222", display_phone_number: "+1 555-0200" }] }) },
    ]);
    const result = await startEmbeddedSignup(actor.id, bizA.id, { code: "GOOD-CODE" }, { fetchImpl: routes.impl, now: NOW_FN });
    expect(result.outcome).toBe("choose");
    if (result.outcome !== "choose") return;
    expect(result.pendingId).toBeTruthy();
    expect(result.wabas).toEqual([{ id: "WABA1", name: "Shop", numbers: [
      { id: "111", displayPhoneNumber: "+1 555-0100", name: null },
      { id: "222", displayPhoneNumber: "+1 555-0200", name: null },
    ] }]);

    const pending = await prisma.whatsAppPendingConnection.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(pending.tokenCiphertext).not.toContain(LONG_TOKEN);
    expect(decryptSecret(pending.tokenCiphertext, Buffer.alloc(32, 9))).toBe(LONG_TOKEN);

    // A choice Meta did not offer is refused and leaves the session usable.
    const chooseRoutes = graphFetch([{ match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111" }, { id: "222" }] }) }]);
    await expect(completeEmbeddedSignupChoice(actor.id, bizA.id, { pendingId: result.pendingId, wabaId: "WABA1", phoneNumberId: "999" }, { fetchImpl: chooseRoutes.impl, now: NOW_FN }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.whatsAppConnection.count({ where: { businessId: bizA.id } })).toBe(0);

    // Choosing a listed number verifies it live, binds it, and cleans up the pending session.
    const chosen = graphFetch([
      { match: "/222?", respond: () => json({ id: "222", display_phone_number: "+1 555-0200", verified_name: "Test Shop" }) },
      { match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111" }, { id: "222" }] }) },
    ]);
    // The second call here is the ownership cross-check, which consults the same listing route.
    const done = await completeEmbeddedSignupChoice(actor.id, bizA.id, { pendingId: result.pendingId, wabaId: "WABA1", phoneNumberId: "222" }, { fetchImpl: chosen.impl, now: NOW_FN });
    expect(done.outcome).toBe("connected");
    expect(await prisma.whatsAppPendingConnection.count({ where: { businessId: bizA.id } })).toBe(0);
    const connection = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(decryptSecret(connection.tokenCiphertext, Buffer.alloc(32, 9))).toBe(LONG_TOKEN);
    expect(connection).toMatchObject({ phoneNumberId: "222", wabaId: "WABA1", displayPhoneNumber: "+1 555-0200", status: "CONNECTED" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.connection.connected", businessId: bizA.id } });
    expect(audit.actorUserId).toBe(actor.id);
    expect(JSON.stringify(audit.metadata)).not.toContain(LONG_TOKEN);
  });

  it("expires the pending token after the TTL and deletes it", async () => {
    const { actor, bizA } = await seed();
    const stale = await prisma.whatsAppPendingConnection.create({
      data: { businessId: bizA.id, tokenCiphertext: "already-encrypted-stale", createdAt: new Date(NOW.getTime() - 11 * 60_000) },
    });
    await expect(completeEmbeddedSignupChoice(actor.id, bizA.id, { pendingId: stale.id, wabaId: "WABA1", phoneNumberId: "111" }, { now: NOW_FN }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.whatsAppPendingConnection.count({ where: { businessId: bizA.id } })).toBe(0);
  });

  it("is a NotFoundError for another business's pending session", async () => {
    const { actor, bizA, bizB, ownerB } = await seed();
    const routes = graphFetch([
      { match: "grant_type=fb_exchange_token", respond: () => json({ access_token: LONG_TOKEN }) },
      { match: "/oauth/access_token", respond: () => json({ access_token: "SHORT" }) },
      { match: "/me/businesses", respond: () => json({ data: [{ id: "WABA1" }, { id: "WABA2" }] }) },
      { match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111" }] }) },
      { match: "/WABA2/phone_numbers", respond: () => json({ data: [] }) },
    ]);
    const result = await startEmbeddedSignup(actor.id, bizA.id, { code: "GOOD" }, { fetchImpl: routes.impl, now: NOW_FN });
    expect(result.outcome).toBe("choose");
    if (result.outcome !== "choose") return;
    await expect(completeEmbeddedSignupChoice(ownerB.id, bizB.id, { pendingId: result.pendingId, wabaId: "WABA1", phoneNumberId: "111" }, { now: NOW_FN }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    // The session stays usable for its own business afterwards.
    expect(await prisma.whatsAppPendingConnection.count({ where: { businessId: bizA.id } })).toBe(1);
  });
});

describe("Embedded Signup failures never store unverified state", () => {
  it("refuses a code Meta rejects, with no pending row or connection change", async () => {
    const { actor, bizA } = await seed();
    const routes = graphFetch([
      { match: "/oauth/access_token", respond: () => json({ error: { message: "Invalid authorization code" } }, 400) },
    ]);
    await expect(startEmbeddedSignup(actor.id, bizA.id, { code: "BAD-CODE" }, { fetchImpl: routes.impl, now: NOW_FN }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.whatsAppPendingConnection.count({ where: { businessId: bizA.id } })).toBe(0);
    expect(await prisma.whatsAppConnection.count({ where: { businessId: bizA.id } })).toBe(0);
  });

  it("refuses a number that fails the pre-flight read and audits the failure", async () => {
    const { actor, bizA } = await seed();
    const routes = graphFetch([
      ...oauthRoutes(),
      { match: "/me/businesses", respond: () => json({ data: [{ id: "WABA1" }] }) },
      { match: "/WABA1/phone_numbers", respond: () => json({ data: [{ id: "111" }] }) },
      { match: "/111?", respond: () => json({ error: { message: "(#10) Application does not have permission for this action" } }, 400) },
    ]);
    await expect(startEmbeddedSignup(actor.id, bizA.id, { code: "GOOD" }, { fetchImpl: routes.impl, now: NOW_FN }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.whatsAppConnection.count({ where: { businessId: bizA.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.signup.failed", businessId: bizA.id } })).toBe(1);
  });
});

describe("Owner disconnect", () => {
  it("marks DISCONNECTED, keeps history, cleans pending sessions and audits", async () => {
    const { actor, bizA } = await seed();
    const connection = await prisma.whatsAppConnection.create({
      data: { businessId: bizA.id, wabaId: "WABA1", phoneNumberId: "111", displayPhoneNumber: "+1 555-0100", status: "CONNECTED", tokenCiphertext: "ciphertext" },
    });
    const conv = await prisma.whatsAppConversation.create({
      data: { connectionId: connection.id, businessId: bizA.id, customerPhone: "233540111222" },
    });
    await prisma.whatsAppPendingConnection.create({ data: { businessId: bizA.id, tokenCiphertext: "x" } });
    await disconnectWhatsAppConnection(actor.id, bizA.id);
    expect((await prisma.whatsAppConnection.findUniqueOrThrow({ where: { businessId: bizA.id } })).status).toBe("DISCONNECTED");
    // The conversation history is kept untouched (customers' threads must survive a disconnect).
    expect(await prisma.whatsAppConversation.count({ where: { id: conv.id } })).toBe(1);
    expect(await prisma.whatsAppPendingConnection.count({ where: { businessId: bizA.id } })).toBe(0);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.connection.disconnected", businessId: bizA.id } });
    expect(audit.actorUserId).toBe(actor.id);
    expect(audit.metadata).toMatchObject({ previousStatus: "CONNECTED" });
  });

  it("404s for a business without any connection", async () => {
    const { actor, bizA } = await seed();
    await expect(disconnectWhatsAppConnection(actor.id, bizA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
