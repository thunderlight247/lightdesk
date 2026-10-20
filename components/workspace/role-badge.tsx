import { Chip } from "@/components/ui/field";

const LABELS: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };
const TONES: Record<string, "brand" | "sky" | "neutral"> = {
  OWNER: "brand",
  ADMIN: "sky",
  MEMBER: "neutral",
};

export function RoleBadge({ role }: { role: string }) {
  return <Chip tone={TONES[role] ?? "neutral"}>{LABELS[role] ?? role}</Chip>;
}
