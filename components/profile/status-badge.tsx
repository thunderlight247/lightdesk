import { STATUS_LABEL, type ProfileStatusName } from "@/modules/business-profile/lifecycle";

const PROFILE_STYLE: Record<ProfileStatusName, string> = {
  DRAFT: "bg-neutral-200 text-neutral-900",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-900",
  ACTIVE: "bg-green-100 text-green-900",
  SUSPENDED: "bg-red-100 text-red-900",
};

export function ProfileStatusBadge({ status }: { status: ProfileStatusName }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${PROFILE_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export type ItemState = "missing" | "approved" | "change" | "draft";
const ITEM: Record<ItemState, { label: string; cls: string }> = {
  missing: { label: "Not provided", cls: "bg-neutral-100 text-neutral-700" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-900" },
  change: { label: "Change awaiting approval", cls: "bg-amber-100 text-amber-900" },
  draft: { label: "Draft — not approved", cls: "bg-amber-100 text-amber-900" },
};

export function ItemBadge({ status }: { status: ItemState }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ITEM[status].cls}`}>{ITEM[status].label}</span>;
}
