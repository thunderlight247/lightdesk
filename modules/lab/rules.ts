import type { DraftResult } from "@/modules/lab/types";

export const HOLDING_REPLY = "I don't have confirmed information about that yet. Let me check with the business owner.";

export type Trigger = {
  kind: "instruction_override" | "payment_claim" | "human_request" | "complaint";
  reason: string;
  reply: string;
};

// Deterministic pre-checks on UNTRUSTED customer text. They save an AI call and cannot be talked out of.
const OVERRIDE =
  /\b(ignore|disregard|forget|override)\b[^.?!]{0,40}\b(instruction|instructions|rules?|prompt|polic(?:y|ies)|guidelines)\b|\b(system|developer) (prompt|message)\b|\b(reveal|show|print|leak)\b[^.?!]{0,30}\b(prompt|api key|secret|password|credentials?)\b|\bapi key\b/i;
// Payment/refund claims must reach a human. Covers adverbs in any order ("I just sent",
// "I have already paid"), contractions ("I've sent") and dispatch-confirmations ("confirm and dispatch").
// Intentionally cautious: a phrase like "I was sent the account number" also escalates.
const PAYMENT_CLAIM =
  /\b(?:refund me|my refund|want (?:a )?refund|money back|money sent|charge ?back|payment (?:was|has|is|not)|did you (?:get|receive|confirm)|confirm (?:my )?(?:payment|transfer|deposit)|confirm\b[^.?!]{0,25}dispatch|(?:(?:i|we)['’]?\s*(?:(?:have|has|was|just|now|already|only|m)|(?:['’]?\s*ve))?\s*(?:already|just|now|only|you|have|has|was)?\s*(?:paid|sent|transferred|deposited)))\b/i;
const HUMAN_REQUEST =
  /\b(speak|talk|chat) (?:to|with) (?:a |an |the )?(?:real )?(?:person|human|someone|somebody|owner|manager|agent|staff|representative)\b|\breal person\b|\bhuman being\b|\blive agent\b|\bcustomer service\b|\byour (?:owner|manager|boss)\b/i;
const COMPLAINT =
  /\b(complain(?:t|ing)?|angry|furious|unacceptable|scam(?:med)?|fraud|cheat(?:ed|ing)?|rip(?:ped)?[- ]?off|terrible|worst|lawyer|police|sue you|report you|disappointed)\b/i;

export function detectTrigger(text: string): Trigger | null {
  if (OVERRIDE.test(text)) {
    return {
      kind: "instruction_override",
      reason: "The message tries to change the assistant's rules or asks for internal information.",
      reply: "I can only help with questions about this business. Let me check with the business owner.",
    };
  }
  if (PAYMENT_CLAIM.test(text)) {
    return {
      kind: "payment_claim",
      reason: "Payments and refunds need a person to decide; the assistant cannot confirm or change them.",
      reply: "Thank you for letting us know. I can't confirm or change payments or refunds myself, so I'm passing this to the business owner.",
    };
  }
  if (HUMAN_REQUEST.test(text)) {
    return {
      kind: "human_request",
      reason: "The customer asked to speak to a person.",
      reply: "Of course. I'm passing this to the business owner so a person can follow up with you.",
    };
  }
  if (COMPLAINT.test(text)) {
    return {
      kind: "complaint",
      reason: "The message is a complaint that needs human judgment.",
      reply: "I'm sorry about this. I'm passing your message to the business owner so a person can look into it.",
    };
  }
  return null;
}

const GREETING = /^\s*(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening)|thanks|thank you|thank u|ok(?:ay)?)[\s.!,]*$/i;
export const isGreeting = (text: string): boolean => GREETING.test(text);

export const PRICE_OR_STOCK = /\b(price|prices|cost|how much|cheap|cheaper|discount|stock|in stock|available|availability|how many)\b/i;

// ---- grounding guards on MODEL OUTPUT (defence in depth; the model is not trusted) --------------------------

const CURRENCY_OR_UNIT = /(?:gh[s₵c]|₵|\$|usd|ghs|cedis?|%|am|pm)/gi;

/** Normalised numeric figures in a text: "GH₵1,050.50" -> "1050.50", "8:00 AM" -> "8:00". */
export function extractFigures(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?(?::\d{2})?/g)) {
    out.push(m[0].replace(/,/g, ""));
  }
  return out;
}

/** Figures that appear in the reply but in none of the allowed (approved or customer-provided) texts. */
export function ungroundedFigures(reply: string, allowedTexts: readonly string[]): string[] {
  const allowed = new Set(allowedTexts.flatMap((t) => extractFigures(t.replace(CURRENCY_OR_UNIT, " "))));
  return [...new Set(extractFigures(reply.replace(CURRENCY_OR_UNIT, " ")).filter((f) => !allowed.has(f)))];
}

const COMMITMENT =
  /(?:\b(?:discount|percent off|half price|special price|free delivery|free shipping|guarantee[ds]?|we will refund|refund (?:has been )?approved|payment (?:has been )?(?:received|confirmed))\b|%\s?off)/gi;

/** Commitment phrases in the reply that the approved information never mentions. */
export function unauthorisedCommitments(reply: string, approvedTexts: readonly string[]): string[] {
  const haystack = approvedTexts.join("\n").toLowerCase();
  return [...new Set([...reply.matchAll(COMMITMENT)].map((m) => m[0].toLowerCase()).filter((p) => !haystack.includes(p)))];
}

// ---- deterministic results (no AI call) --------------------------------------------------------------------

const rules = (r: Omit<DraftResult, "source" | "adjustments" | "evidence"> & Partial<Pick<DraftResult, "evidence">>): DraftResult => ({
  evidence: [],
  ...r,
  source: "RULES",
  adjustments: [],
});

export const triggerResult = (t: Trigger): DraftResult =>
  rules({ status: "escalation_required", replyDraft: t.reply, reason: t.reason, missingInformation: [], escalationReason: t.reason });

export const conflictResult = (conflicts: { question: string }[]): DraftResult =>
  rules({
    status: "conflict_detected",
    replyDraft: HOLDING_REPLY,
    reason: `Approved information conflicts for: ${conflicts.map((c) => `“${c.question.slice(0, 60)}”`).join(", ")}. The assistant will not choose between the answers.`,
    missingInformation: [],
    escalationReason: "Conflicting approved facts need a human decision.",
  });

export const noRelevantInfoResult = (priceOrStock: boolean): DraftResult =>
  rules({
    status: "needs_information",
    replyDraft: HOLDING_REPLY,
    reason: "No approved business information addresses this question.",
    missingInformation: priceOrStock ? ["Approved prices or stock information"] : ["Approved information that answers this question"],
    escalationReason: "Missing business information.",
  });

export const profileUnavailableResult = (status: string | null): DraftResult => {
  const why = status === null ? "has not been created" : `is ${status.toLowerCase().replace("_", " ")}`;
  return rules({
    status: "needs_information",
    replyDraft: HOLDING_REPLY,
    reason: `The business profile ${why}, so there is no approved information the assistant may use. The AI was not called.`,
    missingInformation: ["An active business profile with approved information"],
    escalationReason: "Missing business information: the profile is not active.",
  });
};

export const permissionsBlockedResult = (missing: string[]): DraftResult =>
  rules({
    status: "needs_information",
    replyDraft: HOLDING_REPLY,
    reason: `The business owner has not enabled: ${missing.join(", ")}. The AI was not called.`,
    missingInformation: missing.map((m) => `AI permission: ${m}`),
    escalationReason: "AI permissions are not enabled for drafting.",
  });

export const invalidOutputResult = (): DraftResult =>
  rules({
    status: "escalation_required",
    replyDraft: HOLDING_REPLY,
    reason: "The AI provider's output failed validation, so a safe holding reply was used instead.",
    missingInformation: [],
    escalationReason: "Provider output failed validation.",
  });

export const greetingResult = (prefs: Record<string, string>): DraftResult =>
  rules({
    status: "answerable",
    replyDraft: prefs.greeting ?? "Hello! How can I help you today?",
    reason: "A greeting needs no business facts. No AI call was made.",
    missingInformation: [],
    escalationReason: null,
  });
