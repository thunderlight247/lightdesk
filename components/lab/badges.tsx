import type { DraftStatus } from "@/modules/lab/types";
import { Chip } from "@/components/ui/field";

const RESULT: Record<DraftStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  answerable: { label: "Answerable from approved information", tone: "success" },
  needs_information: { label: "Needs information", tone: "warning" },
  conflict_detected: { label: "Conflict detected", tone: "danger" },
  escalation_required: { label: "Human attention recommended", tone: "danger" },
};

export function ResultBadge({ status }: { status: DraftStatus }) {
  const r = RESULT[status];
  return <Chip tone={r.tone} withDot>{r.label}</Chip>;
}

export function ConversationStatusBadge({ status }: { status: "ACTIVE" | "ESCALATED" | "RESOLVED" }) {
  const map = {
    ACTIVE: ["Active", "neutral"],
    ESCALATED: ["Needs human follow-up", "danger"],
    RESOLVED: ["Resolved", "success"],
  } as const;
  const [label, tone] = map[status];
  return <Chip tone={tone} withDot>{label}</Chip>;
}
