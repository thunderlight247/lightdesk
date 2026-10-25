import { providerProblem, type LabConfig } from "@/modules/lab/config";
import { createDeepSeekProvider } from "@/modules/lab/ai/deepseek";
import { createGeminiProvider } from "@/modules/lab/ai/gemini";
import { ProviderError, type AiProvider } from "@/modules/lab/ai/types";

/**
 * Selection is entirely server-side: provider and model come from validated configuration,
 * never from a request. An unusable configuration fails loudly (CONFIG); nothing is substituted.
 */
export function createProvider(config: LabConfig, fetchImpl?: typeof fetch): AiProvider {
  const problem = providerProblem(config);
  if (problem || !config.provider || !config.apiKey) {
    throw new ProviderError("CONFIG", problem ?? "The AI provider is not configured.");
  }
  if (config.provider === "deepseek") {
    return createDeepSeekProvider({ apiKey: config.apiKey, model: config.model, fetchImpl });
  }
  return createGeminiProvider({ apiKey: config.apiKey, model: config.model, fetchImpl });
}
