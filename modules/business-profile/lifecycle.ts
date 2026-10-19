export const PROFILE_STATUSES = ["DRAFT", "REVIEW_REQUIRED", "ACTIVE", "SUSPENDED"] as const;
export type ProfileStatusName = (typeof PROFILE_STATUSES)[number];

export const STATUS_LABEL: Readonly<Record<ProfileStatusName, string>> = {
  DRAFT: "Draft",
  REVIEW_REQUIRED: "Review required",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
};

/**
 * Permitted transitions (everything else is rejected on the server):
 *   DRAFT           → REVIEW_REQUIRED (submit) | ACTIVE (owner activates)
 *   REVIEW_REQUIRED → DRAFT (return)           | ACTIVE (owner activates)
 *   ACTIVE          → SUSPENDED
 *   SUSPENDED       → ACTIVE (reactivate, re-validated) | DRAFT
 */
const TRANSITIONS: Readonly<Record<ProfileStatusName, readonly ProfileStatusName[]>> = {
  DRAFT: ["REVIEW_REQUIRED", "ACTIVE"],
  REVIEW_REQUIRED: ["DRAFT", "ACTIVE"],
  ACTIVE: ["SUSPENDED"],
  SUSPENDED: ["ACTIVE", "DRAFT"],
};

export function isProfileStatus(value: unknown): value is ProfileStatusName {
  return typeof value === "string" && (PROFILE_STATUSES as readonly string[]).includes(value);
}

export function allowedTransitions(from: ProfileStatusName): readonly ProfileStatusName[] {
  return Object.hasOwn(TRANSITIONS, from) ? TRANSITIONS[from] : [];
}

export function canTransition(from: string, to: string): boolean {
  return isProfileStatus(from) && isProfileStatus(to) && TRANSITIONS[from].includes(to);
}

/** Submitting for review / returning to draft are editor actions; everything else is owner-only. */
export function requiredPermissionFor(from: ProfileStatusName, to: ProfileStatusName): "profile:edit" | "profile:approve" {
  if (to === "REVIEW_REQUIRED" || (from === "REVIEW_REQUIRED" && to === "DRAFT")) return "profile:edit";
  return "profile:approve";
}
