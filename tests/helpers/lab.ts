import { ProviderError, type AiProvider, type GenerateRequest, type GenerateResponse, type Usage } from "@/modules/lab/ai/types";
import type { LabConfig } from "@/modules/lab/config";
import {
  approveEntry, approveFaq, changeProfileStatus, createFaq, createProfile, saveEntry,
} from "@/modules/business-profile/service";

export const NO_USAGE: Usage = { promptTokens: null, completionTokens: null, totalTokens: null };

/** Deterministic stand-in for Gemini. Records every request it receives. */
export class MockProvider implements AiProvider {
  readonly name = "mock";
  readonly model = "mock-model";
  calls: GenerateRequest[] = [];
  constructor(
    private readonly respond: (req: GenerateRequest) => string | Promise<string>,
    private readonly opts: { delayMs?: number; usage?: Usage } = {},
  ) {}
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(req);
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    const text = await this.respond(req);
    return { text, usage: this.opts.usage ?? { promptTokens: 120, completionTokens: 40, totalTokens: 160 }, model: this.model, latencyMs: 7 };
  }
}

export const failingProvider = (kind: ProviderError["kind"]) =>
  new MockProvider(() => { throw new ProviderError(kind, "The AI provider failed. SECRET-DETAIL-SHOULD-NOT-LEAK"); });

export const testConfig = (over: Partial<LabConfig> = {}): LabConfig => ({
  provider: "gemini", apiKey: "test-key-not-real", model: "gemini-2.5-flash", timeoutMs: 5000,
  rateUserPerMinute: 1000, rateBusinessPerHour: 10000, issues: [], ...over,
});

/** A model answer that cites the named FAQ/policy by looking the ref up in what the SERVER sent. */
export function groundedAnswer(labelIncludes: string, reply: string, extra: object = {}) {
  return (req: GenerateRequest) => {
    const facts = JSON.parse(req.user).businessFacts as { ref: string; label: string }[];
    const hit = facts.find((f) => f.label.toLowerCase().includes(labelIncludes.toLowerCase()));
    return JSON.stringify({
      replyDraft: reply, status: "answerable", reason: "Matches approved information.",
      evidenceRefs: hit ? [hit.ref] : [], missingInformation: [], ...extra,
    });
  };
}

export const lastRequestJson = (p: MockProvider) => JSON.parse(p.calls.at(-1)!.user) as {
  businessFacts: { ref: string; label: string; text: string }[];
  conversation: { from: string; text: string }[];
  customerMessage: string;
};

/** Builds an ACTIVE profile for a business through the real M2 services (approvals included). */
export async function buildActiveProfile(
  owner: string, biz: string,
  opts: { capabilities?: boolean; faqs?: [string, string][]; marker?: string } = {},
) {
  await createProfile(owner, biz);
  const entries: [string, string][] = [
    ["business_category", "Phone retailer"],
    ["offerings_summary", "We sell new phones and accessories."],
    ["escalation", "Pass the customer to the business owner."],
    ["delivery", "We deliver within Kumasi on weekdays; the owner confirms the fee."],
    ["opening_hours", "Open Monday to Saturday, 8am to 6pm."],
    ["tone", "warm"],
    ["greeting", "Hello and welcome!"],
  ];
  for (const [key, value] of entries) {
    const { entry } = await saveEntry(owner, biz, { key, value });
    if (entry.state === "DRAFT") await approveEntry(owner, biz, entry.id);
  }
  if (opts.capabilities !== false) {
    for (const key of ["use_approved_knowledge", "prepare_suggested_response"]) {
      const { entry } = await saveEntry(owner, biz, { key, value: "enabled" });
      await approveEntry(owner, biz, entry.id);
    }
  }
  const faqs = opts.faqs ?? [
    ["Do you sell used phones?", "No, we sell new phones only."],
    ["Do you offer a warranty?", "New phones carry a 12 month warranty."],
    ["What payment methods do you accept?", "Cash and mobile money."],
  ];
  for (const [question, answer] of faqs) {
    const faq = await createFaq(owner, biz, { question, answer });
    await approveFaq(owner, biz, faq.id);
  }
  await changeProfileStatus(owner, biz, "ACTIVE");
}
