import { ProviderError, type AiProvider, type GenerateRequest, type GenerateResponse, type Usage } from "@/modules/lab/ai/types";

const DEFAULT_BASE = "https://api.deepseek.com"; // OpenAI-compatible /chat/completions endpoint
const MAX_ATTEMPTS = 2; // one retry, only for transient server/network failures
const RETRY_DELAY_MS = 400;

/**
 * DeepSeek's JSON mode (`response_format: json_object`) guarantees valid JSON but does NOT enforce a
 * schema the way Gemini's responseSchema does, so the response contract is spelled out in the system
 * message. This text is application configuration only: no customer text, business data or secrets.
 */
const RESPONSE_CONTRACT = [
  "The response schema is a JSON object with exactly these fields:",
  'replyDraft: string (the reply text, non-empty, at most 1200 characters),',
  "status: one of \"answerable\", \"needs_information\", \"conflict_detected\", \"escalation_required\",",
  "reason: string (at most 400 characters),",
  "evidenceRefs: array of strings (the refs from businessFacts you used; at most 10, each at most 20 characters),",
  "missingInformation: array of strings (what to check with the business owner; at most 5, each at most 200 characters),",
  'escalationReason: string or null (only when status is conflict_detected or escalation_required, at most 400 characters).',
].join("\n");

type Failure = { kind: "CONFIG" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER"; retryable: boolean; message: string };

/** Pure: maps an HTTP failure to a safe error. Never copies the response body into the message. */
export function classifyHttpFailure(status: number, body: unknown): Failure {
  const err = (body as { error?: { type?: unknown; code?: unknown; message?: unknown } } | null)?.error;
  const msg = typeof err?.message === "string" ? err.message : "";
  const type = (typeof err?.type === "string" ? err.type : "") + (typeof err?.code === "string" ? err.code : "");
  if (status === 429 || /rate.?limit|throttl/i.test(type)) {
    return { kind: "RATE_LIMIT", retryable: false, message: "The AI provider rate limit was reached." };
  }
  if (status === 401 || status === 403 || /authentication|permission|invalid.?api.?key/i.test(type + msg)) {
    return { kind: "CONFIG", retryable: false, message: "The AI provider rejected the configured credentials." };
  }
  if (status === 402 || /balance|arrear/i.test(type + msg)) {
    return { kind: "CONFIG", retryable: false, message: "The AI provider account cannot pay for this request." };
  }
  if (status === 404 || /not.?exist/i.test(type + msg)) {
    return { kind: "CONFIG", retryable: false, message: "The configured AI model was not found." };
  }
  if (status === 408 || status === 504) {
    return { kind: "TIMEOUT", retryable: true, message: "The AI provider timed out." };
  }
  if (status >= 500) return { kind: "PROVIDER", retryable: true, message: "The AI provider had a temporary error." };
  return { kind: "PROVIDER", retryable: false, message: "The AI provider rejected the request." };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
}

export function extractUsage(data: unknown): Usage {
  const u = (data as { usage?: Record<string, unknown> } | null)?.usage;
  return { promptTokens: num(u?.prompt_tokens), completionTokens: num(u?.completion_tokens), totalTokens: num(u?.total_tokens) };
}

function extractText(data: unknown): string | null {
  const c = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  return typeof c === "string" && c.trim() !== "" ? c : null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createDeepSeekProvider(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; baseUrl?: string }): AiProvider {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? DEFAULT_BASE;
  return {
    name: "deepseek",
    model: opts.model,
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const started = Date.now();
      const deadline = started + req.timeoutMs;
      const url = `${base}/chat/completions`;
      const body = JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: `${req.system}\n\n${RESPONSE_CONTRACT}` },
          { role: "user", content: req.user },
        ],
        temperature: 0.2,
        max_tokens: req.maxOutputTokens,
        stream: false,
        response_format: { type: "json_object" },
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
            headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
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
