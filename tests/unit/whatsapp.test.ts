import { describe, expect, it } from "vitest";
import { readWhatsappConfig, whatsappConnectionProblem } from "@/modules/whatsapp/config";
import { checkWabaOwnsPhoneNumber, fetchPhoneNumberInfo } from "@/modules/whatsapp/graph";

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
