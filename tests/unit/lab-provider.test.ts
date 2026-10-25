import { describe, expect, it } from "vitest";
import { createProvider } from "@/modules/lab/ai/factory";
import { classifyHttpFailure as classifyDeepseek, createDeepSeekProvider, extractUsage as extractDeepseekUsage } from "@/modules/lab/ai/deepseek";
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

describe("DeepSeek adapter", () => {
  const okBody = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  const mk = (fetchImpl: typeof fetch) => createDeepSeekProvider({ apiKey: KEY, model: "deepseek-chat", fetchImpl });

  it("returns text, latency and provider-reported usage; keeps the key in a header only", async () => {
    let url = ""; let init: RequestInit = {};
    const f = (async (u: string, i: RequestInit) => { url = u; init = i; return new Response(okBody); }) as unknown as typeof fetch;
    const r = await mk(f).generate(REQ);
    expect(r).toMatchObject({ text: '{"ok":true}', model: "deepseek-chat", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(init.body)).not.toContain(KEY);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "deepseek-chat", temperature: 0.2, max_tokens: 100, response_format: { type: "json_object" } });
    expect(body.messages).toEqual([
      { role: "system", content: expect.stringContaining("sys") },
      { role: "user", content: "usr" },
    ]);
    expect(body.messages[0].content).toContain("replyDraft"); // the response contract is spelled out (no server-side schema)
    expect(String(init.body)).toContain("json_object"); // JSON mode requires the word "json" in the prompt
  });
  it("treats unreported usage as null, never zero", async () => {
    const f = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }))) as unknown as typeof fetch;
    expect((await mk(f).generate(REQ)).usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
    expect(extractDeepseekUsage({ usage: { prompt_tokens: -1, completion_tokens: "7" } })).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
    expect(extractDeepseekUsage({ usage: { prompt_tokens: 0 } }).promptTokens).toBe(0); // a real zero stays zero
  });
  it("classifies failures without leaking provider bodies", async () => {
    const mkf = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const cases: [number, object, string][] = [
      [429, { error: { message: `rate limited for ${KEY}` } }, "RATE_LIMIT"],
      [401, { error: { message: `Authentication Fails, Your api key: ${KEY}, is invalid` } }, "CONFIG"],
      [402, { error: { type: "insufficient_balance" } }, "CONFIG"],
      [404, { error: { message: "Model Not Exist" } }, "CONFIG"],
      [400, { error: { message: "bad request" } }, "PROVIDER"],
    ];
    for (const [status, body, kind] of cases) {
      const e = await kindOf(mk(mkf(status, body)).generate(REQ));
      expect(e).toBeInstanceOf(ProviderError);
      expect(e?.kind).toBe(kind);
      expect(e?.message).not.toContain(KEY);
    }
    expect(classifyDeepseek(503, null)).toMatchObject({ kind: "PROVIDER", retryable: true });
    expect(classifyDeepseek(404, null).message).not.toContain(KEY);
  });
  it("retries a transient 503 exactly once, then gives up", async () => {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("{}", { status: 503 }) : new Response(okBody))) as unknown as typeof fetch;
    expect((await mk(flaky).generate(REQ)).text).toBe('{"ok":true}');
    expect(calls).toBe(2);
    calls = 0;
    const limited = (async () => { calls++; return new Response("{}", { status: 429 }); }) as unknown as typeof fetch;
    await kindOf(mk(limited).generate(REQ));
    expect(calls).toBe(1); // no retry on rate limits
  });
  it("maps timeouts, network errors and empty responses", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal?.addEventListener("abort", () => rej(new Error("aborted"))); })) as unknown as typeof fetch;
    expect((await kindOf(mk(hang).generate({ ...REQ, timeoutMs: 30 })))?.kind).toBe("TIMEOUT");
    const net = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await kindOf(mk(net).generate(REQ)))?.kind).toBe("PROVIDER");
    const empty = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter" }] }))) as unknown as typeof fetch;
    expect((await kindOf(mk(empty).generate(REQ)))?.message).toMatch(/no content/);
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
    expect(providerProblem(readLabConfig({}))).toMatch(/No API key/);
    expect(providerProblem(readLabConfig({ GEMINI_API_KEY: "k" }))).toBeNull();
  });
  it("the model comes from the server-side allowlist only", () => {
    expect(readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-2.5-flash-lite" }).issues).toEqual([]);
    expect(readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "../../other" }).issues).toHaveLength(1);
    expect(readLabConfig({ DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: "deepseek-reasoner" }).issues).toEqual([]);
    expect(readLabConfig({ DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: "deepseek-9" }).issues).toHaveLength(1);
  });
  it("deepseek is selected explicitly, or by default only when gemini has no key", () => {
    const explicit = readLabConfig({ GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d", LAB_AI_PROVIDER: "deepseek" });
    expect(explicit).toMatchObject({ provider: "deepseek", apiKey: "d", model: "deepseek-chat", issues: [] });
    const fallback = readLabConfig({ DEEPSEEK_API_KEY: "d" });
    expect(fallback).toMatchObject({ provider: "deepseek", apiKey: "d", model: "deepseek-chat", issues: [] });
    // gemini key present = gemini stays the default; deepseek is never silently substituted
    expect(readLabConfig({ GEMINI_API_KEY: "g", DEEPSEEK_API_KEY: "d" })).toMatchObject({ provider: "gemini", apiKey: "g", issues: [] });
    // selected provider without its own key stays selected and fails loudly
    expect(readLabConfig({ GEMINI_API_KEY: "g", LAB_AI_PROVIDER: "deepseek" })).toMatchObject({ provider: "deepseek", apiKey: null });
    expect(providerProblem(readLabConfig({ GEMINI_API_KEY: "g", LAB_AI_PROVIDER: "deepseek" }))).toMatch(/No API key/);
    expect(providerProblem(readLabConfig({ DEEPSEEK_API_KEY: "d" }))).toBeNull();
  });
  it("createProvider fails loudly (CONFIG) instead of substituting anything", () => {
    const base: LabConfig = readLabConfig({ GEMINI_API_KEY: "k" });
    expect(createProvider(base).name).toBe("gemini");
    expect(createProvider(readLabConfig({ DEEPSEEK_API_KEY: "k2", LAB_AI_PROVIDER: "deepseek" })).name).toBe("deepseek");
    for (const cfg of [readLabConfig({}), readLabConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "nope" })]) {
      expect(() => createProvider(cfg)).toThrow(ProviderError);
      try { createProvider(cfg); } catch (e) { expect((e as ProviderError).kind).toBe("CONFIG"); }
    }
  });
});
