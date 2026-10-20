import { describe, expect, it } from "vitest";
import { createProvider } from "@/modules/lab/ai/factory";
import { classifyHttpFailure, createGeminiProvider, extractUsage } from "@/modules/lab/ai/gemini";
import { ProviderError } from "@/modules/lab/ai/types";
import { readLabConfig, providerProblem, type LabConfig } from "@/modules/lab/config";

const KEY = "SECRET-KEY-123";
const REQ = { system: "sys", user: "usr", maxOutputTokens: 100, timeoutMs: 2000 };
const okBody = (extra: object = {}) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], ...extra });
const provider = (fetchImpl: typeof fetch) => createGeminiProvider({ apiKey: KEY, model: "gemini-2.5-flash", fetchImpl });
const kindOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as ProviderError | null;

describe("Gemini adapter", () => {
  it("returns text, latency and provider-reported usage; keeps the key in a header only", async () => {
    let url = ""; let init: RequestInit = {};
    const f = (async (u: string, i: RequestInit) => { url = u; init = i; return new Response(okBody({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } })); }) as unknown as typeof fetch;
    const r = await provider(f).generate(REQ);
    expect(r).toMatchObject({ text: '{"ok":true}', model: "gemini-2.5-flash", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(String(init.body)).not.toContain(KEY);
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 100 });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });
  it("treats unreported usage as null, never zero", async () => {
    const f = (async () => new Response(okBody())) as unknown as typeof fetch;
    expect((await provider(f).generate(REQ)).usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
    expect(extractUsage({ usageMetadata: { promptTokenCount: -1, candidatesTokenCount: "7" } })).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
    expect(extractUsage({ usageMetadata: { promptTokenCount: 0 } }).promptTokens).toBe(0); // a real zero stays zero
  });
  it("classifies failures without leaking provider bodies", async () => {
    const mk = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const cases: [number, object, string][] = [
      [429, { error: { status: "RESOURCE_EXHAUSTED", message: `quota for ${KEY}` } }, "RATE_LIMIT"],
      [400, { error: { message: `API key not valid: ${KEY}` } }, "CONFIG"],
      [403, { error: { status: "PERMISSION_DENIED" } }, "CONFIG"],
      [404, {}, "CONFIG"],
      [400, { error: { message: "bad request" } }, "PROVIDER"],
    ];
    for (const [status, body, kind] of cases) {
      const e = await kindOf(provider(mk(status, body)).generate(REQ));
      expect(e).toBeInstanceOf(ProviderError);
      expect(e?.kind).toBe(kind);
      expect(e?.message).not.toContain(KEY);
    }
    expect(classifyHttpFailure(503, null)).toMatchObject({ kind: "PROVIDER", retryable: true });
  });
  it("retries a transient 503 exactly once, then gives up", async () => {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("{}", { status: 503 }) : new Response(okBody()))) as unknown as typeof fetch;
    expect((await provider(flaky).generate(REQ)).text).toBe('{"ok":true}');
    expect(calls).toBe(2);
    calls = 0;
    const down = (async () => { calls++; return new Response("{}", { status: 503 }); }) as unknown as typeof fetch;
    expect((await kindOf(provider(down).generate(REQ)))?.kind).toBe("PROVIDER");
    expect(calls).toBe(2);
    calls = 0;
    const limited = (async () => { calls++; return new Response("{}", { status: 429 }); }) as unknown as typeof fetch;
    await kindOf(provider(limited).generate(REQ));
    expect(calls).toBe(1); // no retry on rate limits
  });
  it("maps timeouts, network errors and empty responses", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal?.addEventListener("abort", () => rej(new Error("aborted"))); })) as unknown as typeof fetch;
    expect((await kindOf(provider(hang).generate({ ...REQ, timeoutMs: 30 })))?.kind).toBe("TIMEOUT");
    const net = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await kindOf(provider(net).generate(REQ)))?.kind).toBe("PROVIDER");
    const empty = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }))) as unknown as typeof fetch;
    expect((await kindOf(provider(empty).generate(REQ)))?.message).toMatch(/no content/);
  });
});

describe("configuration and provider selection", () => {
  it("defaults, empty values and invalid values are handled without throwing", () => {
    const empty = readLabConfig({ GEMINI_API_KEY: "", GEMINI_MODEL: "", LAB_AI_PROVIDER: "" });
    expect(empty).toMatchObject({ provider: "gemini", apiKey: null, model: "gemini-3.5-flash", rateUserPerMinute: 6, rateBusinessPerHour: 60, timeoutMs: 20000, issues: [] });
    const bad = readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-9-ultra", LAB_RATE_USER_PER_MINUTE: "abc", LAB_AI_PROVIDER: "openai" });
    expect(bad.provider).toBeNull();
    expect(bad.issues).toHaveLength(2); // invalid provider + invalid number (model is only checked for gemini)
    expect(bad.rateUserPerMinute).toBe(6);
    expect(providerProblem(bad)).toMatch(/invalid/);
    expect(providerProblem(readLabConfig({}))).toMatch(/No Gemini API key/);
    expect(providerProblem(readLabConfig({ GEMINI_API_KEY: "k" }))).toBeNull();
  });
  it("the model comes from the server-side allowlist only", () => {
    expect(readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-2.5-flash-lite" }).issues).toEqual([]);
    expect(readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "../../other" }).issues).toHaveLength(1);
  });
  it("createProvider fails loudly (CONFIG) instead of substituting anything", () => {
    const base: LabConfig = readLabConfig({ GEMINI_API_KEY: "k" });
    expect(createProvider(base).name).toBe("gemini");
    for (const cfg of [readLabConfig({}), readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "nope" })]) {
      expect(() => createProvider(cfg)).toThrow(ProviderError);
      try { createProvider(cfg); } catch (e) { expect((e as ProviderError).kind).toBe("CONFIG"); }
    }
  });
});
