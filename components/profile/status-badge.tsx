import { STATUS_LABEL, type ProfileStatusName } from "@/modules/business-profile/lifecycle";

const PROFILE_STYLE: Record<ProfileStatusName, { bg: string; dot: string }> = {
  DRAFT: { bg: "bg-zinc-100 text-zinc-700 border-zinc-200/80", dot: "bg-zinc-400" },
  REVIEW_REQUIRED: { bg: "bg-amber-50 text-amber-900 border-amber-200/80", dot: "bg-amber-500" },
  ACTIVE: { bg: "bg-emerald-50 text-emerald-900 border-emerald-200/80", dot: "bg-emerald-500" },
  SUSPENDED: { bg: "bg-red-50 text-red-900 border-red-200/80", dot: "bg-red-500" },
};

export function ProfileStatusBadge({ status }: { status: ProfileStatusName }) {
  const s = PROFILE_STYLE[status] ?? PROFILE_STYLE.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight ${s.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export type ItemState = "missing" | "approved" | "change" | "draft";
const ITEM: Record<ItemState, { label: string; bg: string; dot: string }> = {
  missing: { label: "Not provided", bg: "bg-zinc-100 text-zinc-600 border-zinc-200/70", dot: "bg-zinc-400" },
  approved: { label: "Approved", bg: "bg-emerald-50 text-emerald-900 border-emerald-200/80", dot: "bg-emerald-500" },
  change: { label: "Change awaiting approval", bg: "bg-amber-50 text-amber-900 border-amber-200/80", dot: "bg-amber-500" },
  draft: { label: "Draft — not approved", bg: "bg-amber-50 text-amber-900 border-amber-200/80", dot: "bg-amber-500" },
};

export function ItemBadge({ status }: { status: ItemState }) {
  const item = ITEM[status] ?? ITEM.missing;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight ${item.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} aria-hidden />
      {item.label}
    </span>
  );
}
