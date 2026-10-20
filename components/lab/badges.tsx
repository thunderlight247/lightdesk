import type { DraftStatus } from "@/modules/lab/types";
import { Chip } from "@/components/ui/field";

const RESULT: Record<DraftStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  answerable: { label: "Answerable from approved information", tone: "success" },
  needs_information: { label: "Needs information", tone: "warning" },
  conflict_detected: { label: "Conflict detected", tone: "danger" },
  escalation_required: { label: "Human attention recommended", tone: "danger" },
};

export function ResultBadge({ status }: { status: DraftStatus }) {
  return <Chip tone={RESULT[status].tone}>{RESULT[status].label}</Chip>;
}

export function ConversationStatusBadge({ status }: { status: "ACTIVE" | "ESCALATED" | "RESOLVED" }) {
  const map = {
    ACTIVE: ["Active", "neutral"],
    ESCALATED: ["Needs human follow-up", "danger"],
    RESOLVED: ["Resolved", "success"],
  } as const;
  return <Chip tone={map[status][1]}>{map[status][0]}</Chip>;
}
