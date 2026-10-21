export type DraftStatus = "answerable" | "needs_information" | "conflict_detected" | "escalation_required";

/** Failure kinds for a drafting attempt. Shared by the lab and the live WhatsApp assist (M6c). */
export type DraftErrorKind = "CONFIG" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER" | "INVALID_OUTPUT" | "INTERNAL";
export const DRAFT_STATUSES: readonly DraftStatus[] = ["answerable", "needs_information", "conflict_detected", "escalation_required"];

export type EvidenceKind = "faq" | "policy" | "identity" | "offerings" | "catalogue";

/** A real approved record that was retrieved by the server. The model can only refer to these by `ref`. */
export type EvidenceItem = {
  ref: string;
  kind: EvidenceKind;
  sourceId: string; // FAQ id, or the profile entry key, or catalogue item id
  label: string;
  text: string; // snapshot of the approved text at generation time
};

export type RetrievedItem = EvidenceItem & { relevance: "matched" | "baseline" };

export type Retrieval = {
  items: RetrievedItem[];
  conflicts: { question: string; sourceIds: string[] }[];
  /** Approved communication preferences (instructions, not facts). */
  preferences: Record<string, string>;
};

/** Structural view of the M2 approved snapshot, so the lab does not depend on its implementation. */
export type SnapshotLike = {
  revision: number;
  values: Record<string, string>;
  faqs: { id: string; question: string; answer: string; category: string | null }[];
  capabilities: Record<string, boolean>;
  catalogue?: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    priceGhs: number;
    currency: string;
    inStock: boolean;
    variants: string | null;
  }[];
};

export type DraftResult = {
  status: DraftStatus;
  replyDraft: string;
  reason: string;
  evidence: EvidenceItem[];
  missingInformation: string[];
  escalationReason: string | null;
  source: "AI" | "RULES";
  /** What the server changed or blocked after the model answered. For operators/tests, never shown as facts. */
  adjustments: string[];
};

export const MAX_CUSTOMER_CHARS = 1000;
export const MAX_REPLY_CHARS = 1200;
export const SIMULATION_NOTICE = "Simulation only — this was not sent to any customer.";
