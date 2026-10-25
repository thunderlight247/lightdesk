/**
 * Laboratory configuration, read from server-side environment variables only. Kept OUT of the
 * app-wide env schema on purpose: a missing or malformed AI setting must never break sign-in,
 * the workspace or the BIP. Problems are reported as `issues`, never thrown.
 */
export const ALLOWED_PROVIDERS = ["gemini", "deepseek"] as const;
export const GEMINI_ALLOWED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
// deepseek-chat = the general chat model (fast, cheapest); deepseek-reasoner = the thinking model.
export const DEEPSEEK_ALLOWED_MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

export type LabConfig = {
  provider: (typeof ALLOWED_PROVIDERS)[number] | null;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  rateUserPerMinute: number;
  rateBusinessPerHour: number;
  /** Human-readable configuration problems. Never contains secret values. */
  issues: string[];
};

function int(raw: string | undefined, fallback: number, min: number, max: number, name: string, issues: string[]): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    issues.push(`${name} must be a whole number between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

/** The API key of the selected, validated provider; other providers' keys are ignored. */
function keyFor(env: Record<string, string | undefined>, selected: string): string | null {
  return ((selected === "deepseek" ? env.DEEPSEEK_API_KEY : env.GEMINI_API_KEY) ?? "").trim() || null;
}

export function readLabConfig(env: Record<string, string | undefined> = process.env): LabConfig {
  const issues: string[] = [];
  // Explicit choice wins; when unset, default to gemini, falling back to deepseek only when
  // gemini has no key at all. A configured provider without a key stays selected (and then
  // shows up as the providerProblem "no key" below) — it is never silently substituted.
  const providerRaw = (env.LAB_AI_PROVIDER ?? "").trim();
  const selected =
    providerRaw ||
    ((env.GEMINI_API_KEY ?? "").trim() === "" && (env.DEEPSEEK_API_KEY ?? "").trim() !== "" ? "deepseek" : "gemini");
  const provider = (ALLOWED_PROVIDERS as readonly string[]).includes(selected) ? (selected as LabConfig["provider"]) : null;
  if (!provider) issues.push("LAB_AI_PROVIDER is not an allowed provider");

  const usingDeepseek = provider === "deepseek";
  const modelRaw = usingDeepseek ? (env.DEEPSEEK_MODEL ?? "") : (env.GEMINI_MODEL ?? "");
  const defaultModel = usingDeepseek ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_GEMINI_MODEL;
  const model = modelRaw.trim() || defaultModel;
  if (provider && usingDeepseek && !(DEEPSEEK_ALLOWED_MODELS as readonly string[]).includes(model)) {
    issues.push("DEEPSEEK_MODEL is not in the server-side allowlist");
  }
  if (provider && !usingDeepseek && !(GEMINI_ALLOWED_MODELS as readonly string[]).includes(model)) {
    issues.push("GEMINI_MODEL is not in the server-side allowlist");
  }

  return {
    provider,
    apiKey: provider ? keyFor(env, provider) : null,
    model,
    timeoutMs: int(env.LAB_AI_TIMEOUT_MS, 20_000, 2_000, 60_000, "LAB_AI_TIMEOUT_MS", issues),
    rateUserPerMinute: int(env.LAB_RATE_USER_PER_MINUTE, 6, 1, 60, "LAB_RATE_USER_PER_MINUTE", issues),
    rateBusinessPerHour: int(env.LAB_RATE_BUSINESS_PER_HOUR, 60, 1, 1000, "LAB_RATE_BUSINESS_PER_HOUR", issues),
    issues,
  };
}

/** Why AI drafting cannot run, or null when the provider is usable. Safe to show to users. */
export function providerProblem(config: LabConfig): string | null {
  if (config.issues.some((i) => i.startsWith("LAB_AI_PROVIDER") || i.startsWith("GEMINI_MODEL") || i.startsWith("DEEPSEEK_MODEL"))) {
    return "The AI provider settings on this server are invalid.";
  }
  if (!config.apiKey) return "No API key is configured on this server for the selected AI provider.";
  return null;
}
