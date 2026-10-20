import type { DraftStatus } from "@/modules/lab/types";

const RESULT: Record<DraftStatus, { label: string; cls: string }> = {
  answerable: { label: "Answerable from approved information", cls: "bg-green-100 text-green-900" },
  needs_information: { label: "Needs information", cls: "bg-amber-100 text-amber-900" },
  conflict_detected: { label: "Conflict detected", cls: "bg-red-100 text-red-900" },
  escalation_required: { label: "Human attention recommended", cls: "bg-red-100 text-red-900" },
};

export function ResultBadge({ status }: { status: DraftStatus }) {
  const r = RESULT[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${r.cls}`}>{r.label}</span>;
}

export function ConversationStatusBadge({ status }: { status: "ACTIVE" | "ESCALATED" | "RESOLVED" }) {
  const map = {
    ACTIVE: ["Active", "bg-neutral-100 text-neutral-800"],
    ESCALATED: ["Needs human follow-up", "bg-red-100 text-red-900"],
    RESOLVED: ["Resolved", "bg-green-100 text-green-900"],
  } as const;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status][1]}`}>{map[status][0]}</span>;
}
