/** Provider-independent contract: conversation logic only ever sees these types. */
export type ProviderErrorKind = "CONFIG" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string, // always a safe, generic message: never provider response bodies, keys or prompts
    public readonly retryable = false,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type GenerateRequest = {
  /** Trusted application instructions. */
  system: string;
  /** Untrusted + retrieved content, serialised as data. */
  user: string;
  maxOutputTokens: number;
  timeoutMs: number;
};

/** `null` = the provider did not report it. That is NOT the same as zero. */
export type Usage = { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };

export type GenerateResponse = { text: string; usage: Usage; model: string; latencyMs: number };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
