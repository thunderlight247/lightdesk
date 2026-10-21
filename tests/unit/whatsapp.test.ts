import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { decryptSecret, encryptSecret, readSecretBoxKey } from "@/lib/security/secret-box";
import { readWhatsappConfig, whatsappConnectionProblem } from "@/modules/whatsapp/config";
import {
  checkWabaOwnsPhoneNumber, exchangeCodeForToken, fetchPhoneNumberInfo, listWabas,
  listWabaPhoneNumbers, sendWhatsAppText, upgradeToLongLivedToken,
} from "@/modules/whatsapp/graph";
import { parseInboundPayload, verifyWebhookSignature, verifyWebhookToken } from "@/modules/whatsapp/webhooks";

describe("readWhatsappConfig", () => {
  it("reports all-missing config with no crash and no secret values", () => {
    const config = readWhatsappConfig({});
    expect(config.accessToken).toBeNull();
    expect(config.phoneNumberId).toBeNull();
    expect(config.graphApiVersion).toBe("v26.0");
    expect(config.issues).toEqual([]);
    expect(whatsappConnectionProblem(config)).toBe("No WhatsApp access token is configured on this server.");
  });

  it("rejects non-numeric ids and malformed graph versions", () => {
    const config = readWhatsappConfig({
      WHATSAPP_PHONE_NUMBER_ID: "+4915112345678", // display number, not an id
      WHATSAPP_BUSINESS_ACCOUNT_ID: "abc",
      WHATSAPP_GRAPH_API_VERSION: "26",
      WHATSAPP_ACCESS_TOKEN: "tok",
    });
    expect(config.issues).toHaveLength(3);
    expect(whatsappConnectionProblem(config)).toBe("The WhatsApp settings on this server are invalid.");
  });

  it("accepts fully numeric ids and a well-formed graph version", () => {
    const config = readWhatsappConfig({
      WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
      WHATSAPP_BUSINESS_ACCOUNT_ID: "987654321098765",
      WHATSAPP_GRAPH_API_VERSION: "v26.0",
      WHATSAPP_ACCESS_TOKEN: "tok",
    });
    expect(config.issues).toEqual([]);
    expect(whatsappConnectionProblem(config)).toBeNull();
  });
});

describe("fetchPhoneNumberInfo", () => {
  const params = { accessToken: "test-token", phoneNumberId: "111", graphApiVersion: "v26.0" };

  it("parses a happy-path Graph response and keeps the waba id", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          id: "111",
          display_phone_number: "233540000000",
          verified_name: "Kumasi Phones",
          quality_rating: "GREEN",
          code_verification_status: "VERIFIED",
        }),
        { status: 200 },
      )) as typeof fetch;
    const out = await fetchPhoneNumberInfo(params, { fetchImpl: fakeFetch });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.displayPhoneNumber).toBe("233540000000");
      expect(out.value.verifiedName).toBe("Kumasi Phones");
    }
  });

  it("maps a Graph token error to a readable safe message", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Invalid OAuth access token - Cannot parse access token", type: "OAuthException", code: 190 } }), { status: 401 })) as typeof fetch;
    const out = await fetchPhoneNumberInfo(params, { fetchImpl: fakeFetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("Invalid OAuth access token");
  });

  it("survives a network failure without throwing", async () => {
    const fakeFetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const out = await fetchPhoneNumberInfo(params, { fetchImpl: fakeFetch });
    expect(out).toEqual({ ok: false, message: "The Graph API could not be reached from this server." });
  });

  it("does not request the v26.0-removed account_id field", async () => {
    let requestedUrl = "";
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ id: "111", display_phone_number: "1" }), { status: 200 });
    }) as typeof fetch;
    await fetchPhoneNumberInfo(params, { fetchImpl: fakeFetch });
    expect(decodeURIComponent(requestedUrl)).toContain("fields=id,display_phone_number");
    expect(requestedUrl).not.toContain("account_id");
  });
});

describe("checkWabaOwnsPhoneNumber", () => {
  const params = { accessToken: "test-token", wabaId: "222", phoneNumberId: "111", graphApiVersion: "v26.0" };

  it("confirms ownership when the list contains the configured number", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "999" }, { id: "111" }] }), { status: 200 })) as typeof fetch;
    const out = await checkWabaOwnsPhoneNumber(params, { fetchImpl: fakeFetch });
    expect(out).toEqual({ ok: true, value: { belongs: true } });
  });

  it("reports a mismatch when the number is absent from the WABA list", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "999" }] }), { status: 200 })) as typeof fetch;
    const out = await checkWabaOwnsPhoneNumber(params, { fetchImpl: fakeFetch });
    expect(out).toEqual({ ok: true, value: { belongs: false } });
  });
});

describe("sendWhatsAppText", () => {
  const params = { accessToken: "tok", phoneNumberId: "PN", graphApiVersion: "v26.0", toPhone: "233540111222", text: "Hi", replyToWamid: "wamid.R1" };

  it("posts the message with whatsapp product and reply context, returns the wamid", async () => {
    let method = "";
    let body: unknown;
    let auth = "";
    const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      method = init?.method ?? "";
      body = JSON.parse(String(init?.body));
      auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.OUT9" }] }), { status: 200 });
    }) as typeof fetch;
    const out = await sendWhatsAppText(params, { fetchImpl: fakeFetch });
    expect(out).toEqual({ ok: true, wamid: "wamid.OUT9" });
    expect(method).toBe("POST");
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "233540111222", type: "text", context: { message_id: "wamid.R1" } });
    expect(auth).toBe("Bearer tok");
  });

  it("maps Graph errors to a readable message and omits the context when not replying", async () => {
    const errFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "(#131026) Re-engagement", type: "O", code: 131026 } }), { status: 400 })) as typeof fetch;
    const errOut = await sendWhatsAppText(params, { fetchImpl: errFetch });
    expect(errOut).toEqual({ ok: false, message: "(#131026) Re-engagement" });
    const fakeFetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OUTA" }] }), { status: 200 })) as typeof fetch;
    const okOut = await sendWhatsAppText({ ...params, replyToWamid: null }, { fetchImpl: fakeFetch });
    expect(okOut.ok).toBe(true);
  });
});

describe("verifyWebhookSignature", () => {
  const appSecret = "app-secret-test";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const sign = (payload: string, secret: string) => `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(appSecret, body, sign(body, appSecret))).toBe(true);
  });

  it("rejects a body signed with the wrong secret, an edited body, a missing/malformed header", () => {
    expect(verifyWebhookSignature(appSecret, body, sign(body, "other-secret"))).toBe(false);
    expect(verifyWebhookSignature(appSecret, body + " ", sign(body, appSecret))).toBe(false);
    expect(verifyWebhookSignature(appSecret, body, null)).toBe(false);
    expect(verifyWebhookSignature(appSecret, body, "sha1=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(appSecret, body, "sha256=not-a-hex-hash")).toBe(false);
    expect(verifyWebhookSignature("", body, sign(body, appSecret))).toBe(false);
  });

  it("signs exact raw bytes: whitespace/formatting changes invalidate the old signature", () => {
    const compact = Buffer.from('{"a":1,"b":2}', "utf8");
    const formatted = Buffer.from('{\n  "a": 1,\n  "b": 2\n}', "utf8");
    const compactSignature = sign(compact.toString("utf8"), appSecret);
    expect(verifyWebhookSignature(appSecret, compact, compactSignature)).toBe(true);
    expect(verifyWebhookSignature(appSecret, formatted, compactSignature)).toBe(false);
  });
});

describe("verifyWebhookToken", () => {
  it("accepts only the configured handshake token and fails closed for missing values", () => {
    expect(verifyWebhookToken("configured-token", "configured-token")).toBe(true);
    expect(verifyWebhookToken("configured-token", "wrong-token")).toBe(false);
    expect(verifyWebhookToken("configured-token", null)).toBe(false);
    expect(verifyWebhookToken("", "configured-token")).toBe(false);
  });
});

describe("parseInboundPayload", () => {
  it("extracts the message, profile name and phone-number id", () => {
    const out = parseInboundPayload({
      entry: [{
        id: "WA", changes: [{ field: "messages", value: {
          metadata: { phone_number_id: "PNID" },
          contacts: [{ profile: { name: "Ama Mensah" } }],
          messages: [{ id: "wamid.T1", from: "233540000001", type: "text", text: { body: "How much is the iPhone 13?" }, timestamp: "1729400000" }],
        } }],
      }],
    });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ phoneNumberId: "PNID", wamid: "wamid.T1", fromPhone: "233540000001", profileName: "Ama Mensah", text: "How much is the iPhone 13?", type: "text", timestamp: 1729400000 });
    expect(out.statusEvents).toBe(0);
  });

  it("counts status events without treating them as messages", () => {
    const out = parseInboundPayload({
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" },
        statuses: [{ id: "wamid.T1", status: "delivered" }, { id: "wamid.T2", status: "read" }],
      } }] }],
    });
    expect(out.messages).toEqual([]);
    expect(out.statusEvents).toBe(2);
  });

  it("truncates oversized text and survives garbage payloads", () => {
    const long = "x".repeat(5000);
    const out1 = parseInboundPayload({
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" }, messages: [{ id: "wamid.T3", from: "1", type: "text", text: { body: long } }],
      } }] }],
    });
    expect(out1.messages[0]?.text?.length).toBe(4000);
    expect(parseInboundPayload(null)).toEqual({ messages: [], statusEvents: 0 });
    expect(parseInboundPayload({ nonsense: true })).toEqual({ messages: [], statusEvents: 0 });
    expect(parseInboundPayload({ entry: [{ changes: [{ field: "messages", value: { metadata: {}, messages: [{ from: "x" }] } }] }] }).messages).toEqual([]);
  });
});

describe("secret-box", () => {
  const key = Buffer.alloc(32, 7);
  const envWithKey = { WHATSAPP_TOKEN_ENCRYPTION_KEY: key.toString("hex") };

  it("round-trips a token", () => {
    const ciphertext = encryptSecret("EAAtoken123", key);
    expect(decryptSecret(ciphertext, key)).toBe("EAAtoken123");
    expect(readSecretBoxKey(envWithKey)).toEqual(key);
  });

  it("refuses tampered ciphertext, wrong keys, and malformed config", () => {
    const ciphertext = encryptSecret("EAAtoken123", key);
    const short = ciphertext.slice(0, -4) + "AAAA";
    expect(decryptSecret(short, Buffer.alloc(32, 7))).toBeNull();
    expect(decryptSecret(ciphertext, Buffer.alloc(32, 8))).toBeNull();
    expect(decryptSecret("not base64 data!!", key)).toBeNull();
    expect(readSecretBoxKey({ WHATSAPP_TOKEN_ENCRYPTION_KEY: "tooshort" })).toBeNull();
  });
});

// ---- M6d Embedded Signup: Graph token exchange + discovery -------------------------------

const urlOf = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

function graphFetch(routes: { match: string; respond: (url: string) => Response }[]) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    return route ? route.respond(url) : new Response(JSON.stringify({ error: { message: "route not stubbed" } }), { status: 400 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const GRAPH = "v26.0";

describe("exchangeCodeForToken / upgradeToLongLivedToken", () => {
  it("exchanges the signup code server-side and reports the expiry", async () => {
    const { impl, calls } = graphFetch([{ match: "/oauth/access_token", respond: () => jsonOk({ access_token: "SHORT-TOKEN", token_type: "bearer", expires_in: 43200 }) }]);
    const out = await exchangeCodeForToken({ appId: "APP", appSecret: "SECRET", code: "A9z_0", graphApiVersion: GRAPH }, { fetchImpl: impl });
    expect(out).toEqual({ ok: true, accessToken: "SHORT-TOKEN", expiresIn: 43200, tokenType: "bearer" });
    expect(calls[0]).toContain("client_id=APP");
    expect(calls[0]).toContain("code=A9z_0");
  });

  it("surfaces a Graph rejection without echoing bodies or secrets", async () => {
    const { impl } = graphFetch([{ match: "/oauth/access_token", respond: () => new Response(JSON.stringify({ error: { message: "Invalid authorization code" } }), { status: 400 }) }]);
    const out = await exchangeCodeForToken({ appId: "APP", appSecret: "SECRET", code: "BAD", graphApiVersion: GRAPH }, { fetchImpl: impl });
    expect(out).toEqual({ ok: false, message: "Invalid authorization code" });
  });

  it("upgrades to a long-lived token and rejects a body without an access token", async () => {
    const upgraded = graphFetch([{ match: "/oauth/access_token", respond: () => jsonOk({ access_token: "LONG-LIVED", token_type: "bearer", expires_in: 5184000 }) }]);
    const ok = await upgradeToLongLivedToken({ appId: "APP", appSecret: "SECRET", shortLivedToken: "SHORT", graphApiVersion: GRAPH }, { fetchImpl: upgraded.impl });
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.accessToken).toBe("LONG-LIVED");
    expect(upgraded.calls[0]).toContain("grant_type=fb_exchange_token");

    const empty = graphFetch([{ match: "/oauth/access_token", respond: () => jsonOk({ extras: 1 }) }]);
    const fail = await upgradeToLongLivedToken({ appId: "APP", appSecret: "SECRET", shortLivedToken: "SHORT", graphApiVersion: GRAPH }, { fetchImpl: empty.impl });
    expect(fail).toEqual({ ok: false, message: "The token upgrade response did not include an access token." });
  });
});

describe("listWabas / listWabaPhoneNumbers", () => {
  it("lists businesses and their phone numbers defensively over partial data", async () => {
    const { impl } = graphFetch([
      { match: "/me/businesses", respond: () => jsonOk({ data: [{ id: "WABA1", name: "Owner's WABA" }, { noId: true }, { id: "WABA2" }] }) },
      { match: "/WABA1/phone_numbers", respond: () => jsonOk({ data: [{ id: "111", display_phone_number: "+1 555-0100", verified_name: "Alpha" }, { id: "222", display_phone_number: null }] }) },
      { match: "/WABA2/phone_numbers", respond: () => jsonOk({ data: [] }) },
    ]);
    const wabas = await listWabas({ accessToken: "T", graphApiVersion: GRAPH }, { fetchImpl: impl });
    expect(wabas.ok).toBe(true);
    if (wabas.ok) expect(wabas.value).toEqual([{ id: "WABA1", name: "Owner's WABA" }, { id: "WABA2", name: null }]);
    const nums = await listWabaPhoneNumbers({ accessToken: "T", wabaId: "WABA1", graphApiVersion: GRAPH }, { fetchImpl: impl });
    expect(nums.ok).toBe(true);
    if (nums.ok) {
      expect(nums.value).toEqual([
        { id: "111", displayPhoneNumber: "+1 555-0100", name: "Alpha" },
        { id: "222", displayPhoneNumber: null, name: null },
      ]);
    }
  });
});
