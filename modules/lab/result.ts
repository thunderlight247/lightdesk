import { z } from "zod";
import { HOLDING_REPLY, ungroundedFigures, unauthorisedCommitments } from "@/modules/lab/rules";
import { MAX_REPLY_CHARS, type DraftResult, type EvidenceItem, type Retrieval } from "@/modules/lab/types";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (max: number) => z.string().trim().max(max).refine((s) => !CONTROL.test(s), "control characters");

/** What the provider must return. Anything else is rejected, not "interpreted". */
export const providerOutputSchema = z.object({
  replyDraft: text(MAX_REPLY_CHARS).refine((s) => s.length > 0, "empty reply"),
  status: z.enum(["answerable", "needs_information", "conflict_detected", "escalation_required"]),
  reason: text(400),
  evidenceRefs: z.array(z.string().trim().max(20)).max(10).default([]),
  missingInformation: z.array(text(200)).max(5).default([]),
  escalationReason: text(400).nullish(),
});
export type ProviderOutput = z.infer<typeof providerOutputSchema>;

export function parseProviderOutput(raw: string): { ok: true; value: ProviderOutput } | { ok: false; reason: string } {
  let body = raw.trim();
  const fenced = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) body = fenced[1];
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const parsed = providerOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "does not match the response contract" };
  return { ok: true, value: parsed.data };
}

/**
 * Applies APPLICATION rules to a schema-valid model answer. The model's status, evidence and wording are
 * suggestions: evidence must resolve to records the server retrieved, an "answerable" claim needs verified
 * evidence, and figures/commitments the approved information never mentions are blocked.
 */
export function finalizeAiResult(out: ProviderOutput, retrieval: Retrieval, customerTexts: readonly string[]): DraftResult {
  const adjustments: string[] = [];
  const byRef = new Map(retrieval.items.map((i) => [i.ref, i]));
  const evidence: EvidenceItem[] = [];
  for (const ref of new Set(out.evidenceRefs)) {
    const item = byRef.get(ref);
    if (item) evidence.push({ ref: item.ref, kind: item.kind, sourceId: item.sourceId, label: item.label, text: item.text });
    else adjustments.push(`dropped unknown evidence reference "${ref.slice(0, 20)}"`);
  }

  let status: DraftResult["status"] = out.status;
  let replyDraft = out.replyDraft;
  let reason = out.reason;
  let missing = out.missingInformation;
  let escalationReason = out.escalationReason ?? null;
  let source: DraftResult["source"] = "AI";

  const block = (why: string, newStatus: DraftResult["status"], newReason: string) => {
    adjustments.push(why);
    status = newStatus;
    replyDraft = HOLDING_REPLY;
    reason = newReason;
    source = "RULES";
  };

  const approvedTexts = [...retrieval.items.map((i) => i.text), ...Object.values(retrieval.preferences)];
  const figures = ungroundedFigures(replyDraft, [...approvedTexts, ...customerTexts]);
  const commitments = unauthorisedCommitments(replyDraft, approvedTexts);
  if (figures.length > 0) {
    block(`blocked figures not in approved information: ${figures.slice(0, 5).join(", ")}`, "needs_information",
      "The draft contained figures that are not in the approved information, so it was replaced with a safe holding reply.");
    missing = [...missing, "Approved information for the figures the draft mentioned"].slice(0, 5);
  } else if (commitments.length > 0) {
    block(`blocked commitments not in approved information: ${commitments.join(", ")}`, "escalation_required",
      "The draft made a commitment the approved information does not support, so it was replaced with a safe holding reply.");
  } else if (status === "answerable" && evidence.length === 0) {
    block("answerable claim had no verified evidence", "needs_information",
      "The draft claimed to be answerable but cited no approved information, so it was replaced with a safe holding reply.");
  }

  if (status !== "answerable" && !escalationReason) {
    escalationReason = status === "conflict_detected" ? "Conflicting approved facts need a human decision."
      : status === "needs_information" ? "Missing business information." : reason.slice(0, 400);
  }
  if (status !== "answerable" && missing.length === 0 && status === "needs_information") missing = ["Approved information that answers this question"];
  return { status, replyDraft, reason, evidence, missingInformation: missing, escalationReason, source, adjustments };
}
