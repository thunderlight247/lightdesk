import { getEntryDef } from "@/modules/business-profile/catalog";
import { compareForm, normalizeQuestion } from "@/modules/business-profile/text";
import type { EvidenceKind, Retrieval, RetrievedItem, SnapshotLike } from "@/modules/lab/types";

const STOP = new Set(
  "the a an and or but of to in on at for from with about is are was were be been do does did you your yours we our us i me my can could would will shall may might have has had it its this that these those there here what when where which who how any some please tell know want need just also than then so if not no yes".split(" "),
);

export function tokens(text: string): Set<string> {
  return new Set(
    compareForm(text)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(" ")
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}

type Topic = { key: string; kind: EvidenceKind; test: RegExp };
const TOPICS: Topic[] = [
  { key: "opening_hours", kind: "policy", test: /\b(open|opens|opening|close|closes|closing|hours|time|times|when|sunday|saturday|monday|weekend|today|tomorrow)\b/i },
  { key: "delivery", kind: "policy", test: /\b(deliver|delivery|delivered|shipping|ship|send|courier|dispatch|drop ?off|bring)\b/i },
  { key: "returns", kind: "policy", test: /\b(return|returns|refund|exchange|warranty|replace|replacement|faulty|broken|damaged|guarantee)\b/i },
  { key: "appointments", kind: "policy", test: /\b(appointment|appointments|book|booking|reserve|reservation|visit|schedule|slot)\b/i },
  { key: "service_area", kind: "identity", test: /\b(where|location|address|area|located|find you|direction|directions|branch|shop)\b/i },
  { key: "public_phone", kind: "identity", test: /\b(phone|call|number|contact|whatsapp)\b/i },
  { key: "public_email", kind: "identity", test: /\b(email|e-mail|mail)\b/i },
  { key: "payment_methods", kind: "policy", test: /\b(pay|payment|paying|momo|money|cash|transfer|account|card)\b/i },
  { key: "momo_details", kind: "policy", test: /\b(momo|mtn|telecel|airtel|tigo|number|merchant|pay to|send money)\b/i },
  { key: "payment_terms", kind: "policy", test: /\b(deposit|advance|before|after|terms|when to pay|pay on delivery|cod)\b/i },
  { key: "offerings_summary", kind: "offerings", test: /\b(sell|sells|selling|have|stock|product|products|service|services|offer|offers|brand|brands|buy|available|range|kind|kinds)\b/i },
];

const PREFERENCE_KEYS = ["tone", "formality", "response_length", "primary_language", "additional_languages", "greeting", "sign_off", "terminology"];
const MAX_FAQS = 5;
const FAQ_MIN_SCORE = 2;
const MAX_CATALOGUE = 5;

/**
 * Minimal, deterministic retrieval over the APPROVED snapshot (no vector database). Returns only what is
 * relevant to the enquiry plus a small baseline, each with a server-assigned reference (E1, E2…). Those
 * references are the only way the model can cite evidence, and the server verifies them afterwards.
 */
export function retrieve(snapshot: SnapshotLike, enquiry: string, priorCustomerTexts: readonly string[] = []): Retrieval {
  const qTokens = tokens([enquiry, ...priorCustomerTexts.slice(-2)].join(" "));
  const topicText = [enquiry, ...priorCustomerTexts.slice(-1)].join(" ");

  const scored = snapshot.faqs
    .map((f) => {
      const qt = tokens(f.question);
      const at = tokens(`${f.answer} ${f.category ?? ""}`);
      let score = 0;
      for (const t of qTokens) score += qt.has(t) ? 2 : at.has(t) ? 1 : 0;
      return { f, score };
    })
    .filter((x) => x.score >= FAQ_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FAQS);

  const items: RetrievedItem[] = [];
  const push = (it: Omit<RetrievedItem, "ref">) => items.push({ ...it, ref: `E${items.length + 1}` });

  for (const { f } of scored) {
    push({ kind: "faq", sourceId: f.id, label: `FAQ: ${f.question.slice(0, 80)}`, text: `Q: ${f.question}\nA: ${f.answer}`.slice(0, 1800), relevance: "matched" });
  }

  // Catalogue matching
  if (snapshot.catalogue && snapshot.catalogue.length > 0) {
    const scoredCatalogue = snapshot.catalogue
      .map((c) => {
        const nt = tokens(c.name);
        const dt = tokens(`${c.description ?? ""} ${c.category ?? ""} ${c.variants ?? ""}`);
        let score = 0;
        for (const t of qTokens) score += nt.has(t) ? 3 : dt.has(t) ? 1 : 0;
        return { c, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CATALOGUE);

    for (const { c } of scoredCatalogue) {
      const stockStr = c.inStock ? "In Stock" : "Out of Stock";
      const variantStr = c.variants ? ` | Variants: ${c.variants}` : "";
      const descStr = c.description ? `\nDescription: ${c.description}` : "";
      push({
        kind: "catalogue",
        sourceId: c.id,
        label: `Product: ${c.name}`,
        text: `Product: ${c.name}\nPrice: ${c.priceGhs.toFixed(2)} ${c.currency}\nStatus: ${stockStr}${variantStr}${descStr}`,
        relevance: "matched",
      });
    }
  }
  const topicKeys = new Set(TOPICS.filter((t) => t.test.test(topicText)).map((t) => t.key));
  for (const t of TOPICS) {
    const value = snapshot.values[t.key];
    if (value === undefined) continue;
    const matched = topicKeys.has(t.key);
    if (t.key === "offerings_summary" || matched) {
      push({ kind: t.kind, sourceId: t.key, label: getEntryDef(t.key)?.label ?? t.key, text: value, relevance: matched ? "matched" : "baseline" });
    }
  }
  for (const key of ["business_category", "escalation"]) {
    const value = snapshot.values[key];
    if (value !== undefined && !items.some((i) => i.sourceId === key)) {
      push({ kind: key === "escalation" ? "policy" : "identity", sourceId: key, label: getEntryDef(key)?.label ?? key, text: value, relevance: "baseline" });
    }
  }

  // Conflicts: any retrieved FAQ whose normalised question has differing approved answers elsewhere.
  const conflicts: Retrieval["conflicts"] = [];
  const seen = new Set<string>();
  for (const { f } of scored) {
    const nq = normalizeQuestion(f.question);
    if (seen.has(nq)) continue;
    seen.add(nq);
    const same = snapshot.faqs.filter((o) => normalizeQuestion(o.question) === nq);
    if (new Set(same.map((o) => compareForm(o.answer))).size > 1) {
      conflicts.push({ question: f.question, sourceIds: same.map((o) => o.id) });
    }
  }

  const preferences: Record<string, string> = {};
  for (const k of PREFERENCE_KEYS) if (snapshot.values[k] !== undefined) preferences[k] = snapshot.values[k];
  return { items, conflicts, preferences };
}

export const hasRelevantFacts = (r: Retrieval): boolean => r.items.some((i) => i.relevance === "matched");
