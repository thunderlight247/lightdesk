/**
 * The draft PIPELINE shared by the M3 laboratory and the M6c live WhatsApp assist (spec §4
 * phase table: "reusing the M3 generation + M4 pre-check + meters"). Everything here is
 * pure computation over an approved business snapshot plus a conversation history; the
 * caller decides where the result is persisted. Safety properties this function guarantees:
 *
 * - The customer's text is untrusted input; the M4 deterministic `detectTrigger` pre-check
 *   runs BEFORE any AI call, so payment/refund/override/human-request trips never reach the model.
 * - Retrieval only ever sees APPROVED values (M2/M5 approved snapshot, active profile only).
 * - Model output is parsed and re-validated (`parseProviderOutput`) and grounded
 *   (`finalizeAiResult`); drafts about prices or unapproved figures become holding replies.
 * - Provider errors are mapped to safe, generic error kinds; messages never contain
 *   provider bodies, keys or prompts.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { createProvider } from "@/modules/lab/ai/factory";
import { ProviderError, type AiProvider, type Usage } from "@/modules/lab/ai/types";
import type { LabConfig } from "@/modules/lab/config";
import { buildPrompt, type HistoryTurn } from "@/modules/lab/prompt";
import { finalizeAiResult, parseProviderOutput } from "@/modules/lab/result";
import { retrieve, hasRelevantFacts } from "@/modules/lab/retrieval";
import {
  conflictResult, detectTrigger, greetingResult, invalidOutputResult, isGreeting, noRelevantInfoResult,
  permissionsBlockedResult, PRICE_OR_STOCK, profileUnavailableResult, triggerResult,
} from "@/modules/lab/rules";
import type { DraftErrorKind } from "@/modules/lab/types";
import { MAX_REPLY_CHARS, type DraftResult, type EvidenceItem } from "@/modules/lab/types";
import { getApprovedProfileSnapshot } from "@/modules/business-profile/service";

export const MAX_OUTPUT_TOKENS = 1024;

export type { DraftErrorKind };

export type ComputedDraft = {
  /** null = the attempt failed (errorKind says why); a RULES or AI result otherwise. */
  result: DraftResult | null;
  errorKind: DraftErrorKind | null;
  usedAi: boolean;
  providerName: string | null;
  modelName: string | null;
  usage: Usage | null;
  latencyMs: number | null;
  profileRevision: number | null;
};

/**
 * Computes the reply draft for the (customer) message `customerText`, given the earlier
 * conversation turns (customer messages and APPROVED assistant replies only; unapproved
 * drafts are never fed back). `priorCustomerTexts` alone feeds conflict/price retrieval.
 */
export async function computeDraft(input: {
  businessId: string;
  businessName: string;
  customerText: string;
  priorTurns: readonly HistoryTurn[];
  config: LabConfig;
  provider?: AiProvider; // test seam, same as the lab's deps.provider
}): Promise<ComputedDraft> {
  const started = Date.now();
  let usedAi = false;
  let providerName: string | null = null;
  let modelName: string | null = null;
  let usage: Usage | null = null;
  let errorKind: DraftErrorKind | null = null;
  let result: DraftResult | null = null;
  let profileRevision: number | null = null;

  const priorCustomerTexts = input.priorTurns.filter((t) => t.from === "customer").map((t) => t.text);

  try {
    const snapshot = await getApprovedProfileSnapshot(input.businessId);
    if (!snapshot) {
      const profile = await prisma.businessProfile.findUnique({ where: { businessId: input.businessId }, select: { status: true } });
      result = profileUnavailableResult(profile?.status ?? null);
    } else if (!snapshot.capabilities.use_approved_knowledge || !snapshot.capabilities.prepare_suggested_response) {
      const missing: string[] = [];
      if (!snapshot.capabilities.use_approved_knowledge) missing.push("Use approved business knowledge");
      if (!snapshot.capabilities.prepare_suggested_response) missing.push("Prepare suggested responses");
      result = permissionsBlockedResult(missing);
      profileRevision = snapshot.revision;
    } else {
      profileRevision = snapshot.revision;
      const trigger = detectTrigger(input.customerText);
      if (trigger) result = triggerResult(trigger);
      else if (isGreeting(input.customerText)) result = greetingResult(retrieve(snapshot, "", []).preferences);
      else {
        const retrieval = retrieve(snapshot, input.customerText, priorCustomerTexts);
        if (retrieval.conflicts.length > 0) result = conflictResult(retrieval.conflicts);
        else if (!hasRelevantFacts(retrieval) || (PRICE_OR_STOCK.test(input.customerText) && !retrieval.items.some((i) => i.relevance === "matched" && i.kind !== "offerings"))) {
          // Prices and stock are not modelled in the profile: unless an approved FAQ/policy addresses it, do not ask the AI at all.
          result = noRelevantInfoResult(PRICE_OR_STOCK.test(input.customerText));
        } else {
          const prompt = buildPrompt({
            businessName: input.businessName,
            retrieval,
            history: input.priorTurns,
            customerMessage: input.customerText,
          });
          const provider = input.provider ?? createProvider(input.config); // throws ProviderError CONFIG when unusable
          providerName = provider.name;
          modelName = provider.model;
          usedAi = true;
          const res = await provider.generate({ system: prompt.system, user: prompt.user, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: input.config.timeoutMs });
          usage = res.usage;
          const parsed = parseProviderOutput(res.text);
          if (!parsed.ok) {
            errorKind = "INVALID_OUTPUT";
            result = invalidOutputResult();
          } else {
            result = finalizeAiResult(parsed.value, retrieval, [...priorCustomerTexts, input.customerText]);
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) errorKind = err.kind;
    else {
      console.error("[draft-pipeline] unexpected error", err instanceof Error ? err.name : typeof err);
      errorKind = "INTERNAL";
    }
    result = null;
  }

  return {
    result,
    errorKind,
    usedAi,
    providerName,
    modelName,
    usage,
    latencyMs: usedAi ? Date.now() - started : null,
    profileRevision,
  };
}

// ---- JSON column parsers shared by the lab and WhatsApp review surfaces -----------------

/** Server-written evidence snapshots only; anything else is ignored, never trusted. */
export function asEvidence(json: unknown): EvidenceItem[] {
  return Array.isArray(json)
    ? json.filter((e): e is EvidenceItem => !!e && typeof e === "object" && ["ref", "kind", "sourceId", "label", "text"].every((k) => typeof (e as Record<string, unknown>)[k] === "string"))
    : [];
}

export function asStrings(json: unknown): string[] {
  return Array.isArray(json) ? json.filter((s): s is string => typeof s === "string") : [];
}

/** DraftResult handles for persisting evidence columns from both callers. */
export function evidenceJson(result: DraftResult): Prisma.InputJsonValue {
  return result.evidence as unknown as Prisma.InputJsonValue;
}

export const REPLY_CHAR_CAP = MAX_REPLY_CHARS;
