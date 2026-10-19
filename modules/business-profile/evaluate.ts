import { ENTRY_DEFS, SECTION_BY_MODULE, getEntryDef } from "@/modules/business-profile/catalog";
import { compareForm } from "@/modules/business-profile/text";

export type EntryLite = {
  id?: string;
  module: string;
  key: string;
  value: string;
  approvedValue: string | null;
  state: "DRAFT" | "APPROVED";
};
export type FaqLite = {
  id: string;
  question: string;
  answer: string;
  normalizedQuestion: string;
  isActive: boolean;
  state: "DRAFT" | "APPROVED";
  approvedAt: Date | null;
};

export type ItemStatus = "approved" | "pending" | "missing";
export type ChecklistItem = {
  id: string;
  label: string;
  level: "required" | "recommended";
  status: ItemStatus;
  /** An approved value exists but a newer change is awaiting approval. */
  changePending: boolean;
  section: string;
};
export type PendingItem = {
  kind: "entry" | "faq";
  id: string;
  label: string;
  section: string;
  module: string | null;
  neverApproved: boolean;
};
export type Conflict = { question: string; faqIds: string[] };
export type Evaluation = {
  checklist: ChecklistItem[];
  pending: PendingItem[];
  conflicts: Conflict[];
  /** Why the profile cannot be activated right now. Empty = it can. */
  blocking: string[];
  canActivate: boolean;
};

const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Groups active FAQs by normalised question; differing answers are a conflict (never auto-resolved). */
export function findConflicts(faqs: readonly FaqLite[]): Conflict[] {
  const groups = new Map<string, FaqLite[]>();
  for (const f of faqs) {
    if (!f.isActive) continue;
    groups.set(f.normalizedQuestion, [...(groups.get(f.normalizedQuestion) ?? []), f]);
  }
  const out: Conflict[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map((f) => compareForm(f.answer))).size > 1) {
      out.push({ question: group[0].question, faqIds: group.map((f) => f.id) });
    }
  }
  return out;
}

/**
 * Transparent checklist — no percentage, no weighting. Required items must be APPROVED
 * (not merely saved) before activation; recommended items may stay unknown.
 */
export function evaluateProfile(entries: readonly EntryLite[], faqs: readonly FaqLite[]): Evaluation {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const checklist: ChecklistItem[] = [];
  const blocking: string[] = [];

  for (const def of ENTRY_DEFS) {
    if (!def.requiredForActivation && !def.recommended) continue;
    const e = byKey.get(def.key);
    const status: ItemStatus = !e ? "missing" : e.approvedValue !== null ? "approved" : "pending";
    const level = def.requiredForActivation ? "required" : "recommended";
    checklist.push({
      id: def.key, label: def.label, level, status,
      changePending: !!e && e.approvedValue !== null && e.state === "DRAFT",
      section: SECTION_BY_MODULE[def.module],
    });
    if (level === "required" && status !== "approved") {
      blocking.push(status === "missing" ? `${def.label} has not been provided` : `${def.label} is saved but not yet approved`);
    }
  }

  const activeFaqs = faqs.filter((f) => f.isActive);
  const approvedFaq = activeFaqs.some((f) => f.approvedAt !== null);
  checklist.push({
    id: "faq", label: "At least one approved, active FAQ", level: "recommended",
    status: approvedFaq ? "approved" : activeFaqs.length > 0 ? "pending" : "missing",
    changePending: false, section: "faq",
  });

  const conflicts = findConflicts(faqs);
  for (const c of conflicts) blocking.push(`Conflicting answers for “${truncate(c.question)}” must be resolved`);

  const pending: PendingItem[] = [
    ...entries.filter((e) => e.state === "DRAFT").map((e): PendingItem => ({
      kind: "entry", id: e.id ?? e.key, label: getEntryDef(e.key)?.label ?? e.key,
      section: SECTION_BY_MODULE[(getEntryDef(e.key)?.module ?? "IDENTITY")],
      module: e.module, neverApproved: e.approvedValue === null,
    })),
    ...faqs.filter((f) => f.state === "DRAFT").map((f): PendingItem => ({
      kind: "faq", id: f.id, label: truncate(f.question), section: "faq", module: null, neverApproved: f.approvedAt === null,
    })),
  ];

  return { checklist, pending, conflicts, blocking, canActivate: blocking.length === 0 };
}
