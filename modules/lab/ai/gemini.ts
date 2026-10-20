import { ProviderError, type AiProvider, type GenerateRequest, type GenerateResponse, type Usage } from "@/modules/lab/ai/types";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_ATTEMPTS = 2; // one retry, only for transient server/network failures
const RETRY_DELAY_MS = 400;

/** Mirrors the Zod contract in result.ts. Property order is intentional. */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    replyDraft: { type: "STRING" },
    status: { type: "STRING", enum: ["answerable", "needs_information", "conflict_detected", "escalation_required"] },
    reason: { type: "STRING" },
    evidenceRefs: { type: "ARRAY", items: { type: "STRING" } },
    missingInformation: { type: "ARRAY", items: { type: "STRING" } },
    escalationReason: { type: "STRING" },
  },
  required: ["replyDraft", "status", "reason", "evidenceRefs", "missingInformation"],
} as const;

type Failure = { kind: "CONFIG" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER"; retryable: boolean; message: string };

/** Pure: maps an HTTP failure to a safe error. Never copies the response body into the message. */
export function classifyHttpFailure(status: number, body: unknown): Failure {
  const err = (body as { error?: { status?: unknown; message?: unknown } } | null)?.error;
  const code = typeof err?.status === "string" ? err.status : "";
  const msg = typeof err?.message === "string" ? err.message : "";
  if (status === 429 || code === "RESOURCE_EXHAUSTED") {
    return { kind: "RATE_LIMIT", retryable: false, message: "The AI provider rate limit was reached." };
  }
  if (status === 401 || status === 403 || code === "PERMISSION_DENIED" || code === "UNAUTHENTICATED" || (status === 400 && /api key/i.test(msg))) {
    return { kind: "CONFIG", retryable: false, message: "The AI provider rejected the configured credentials." };
  }
  if (status === 404) return { kind: "CONFIG", retryable: false, message: "The configured AI model was not found." };
  if (status === 408 || status === 504 || code === "DEADLINE_EXCEEDED") {
    return { kind: "TIMEOUT", retryable: true, message: "The AI provider timed out." };
  }
  if (status >= 500) return { kind: "PROVIDER", retryable: true, message: "The AI provider had a temporary error." };
  return { kind: "PROVIDER", retryable: false, message: "The AI provider rejected the request." };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
}

export function extractUsage(data: unknown): Usage {
  const u = (data as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  return { promptTokens: num(u?.promptTokenCount), completionTokens: num(u?.candidatesTokenCount), totalTokens: num(u?.totalTokenCount) };
}

function extractText(data: unknown): string | null {
  const parts = (data as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  return text.trim() === "" ? null : text;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createGeminiProvider(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; baseUrl?: string }): AiProvider {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? DEFAULT_BASE;
  return {
    name: "gemini",
    model: opts.model,
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const started = Date.now();
      const deadline = started + req.timeoutMs;
      const url = `${base}/models/${encodeURIComponent(opts.model)}:generateContent`;
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: req.maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          // 2.5 Flash models can think by default; thinking tokens cost money and eat the output budget.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      let last: ProviderError | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remaining);
        try {
          // The key travels in a header, never in the URL, so it cannot end up in access logs.
          const res = await f(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
            body,
            signal: controller.signal,
          });
          if (!res.ok) {
            const parsed = await res.json().catch(() => null);
            const failure = classifyHttpFailure(res.status, parsed);
            last = new ProviderError(failure.kind, failure.message, failure.retryable, res.status);
            if (failure.retryable && attempt < MAX_ATTEMPTS) {
              await sleep(RETRY_DELAY_MS);
              continue;
            }
            throw last;
          }
          const data: unknown = await res.json().catch(() => null);
          const text = extractText(data);
          if (text === null) throw new ProviderError("PROVIDER", "The AI provider returned no content.", false, res.status);
          return { text, usage: extractUsage(data), model: opts.model, latencyMs: Date.now() - started };
        } catch (e) {
          if (e instanceof ProviderError) throw e;
          if (controller.signal.aborted) throw new ProviderError("TIMEOUT", "The AI provider timed out.", false);
          last = new ProviderError("PROVIDER", "The AI provider could not be reached.", true);
          if (attempt < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          throw last;
        } finally {
          clearTimeout(timer);
        }
      }
      throw last ?? new ProviderError("TIMEOUT", "The AI provider timed out.", false);
    },
  };
}
