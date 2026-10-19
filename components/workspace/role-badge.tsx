const LABELS: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };
const STYLES: Record<string, string> = {
  OWNER: "bg-neutral-900 text-white",
  ADMIN: "bg-neutral-200 text-neutral-900",
  MEMBER: "bg-neutral-100 text-neutral-700",
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[role] ?? STYLES.MEMBER}`}>
      {LABELS[role] ?? role}
    </span>
  );
}
