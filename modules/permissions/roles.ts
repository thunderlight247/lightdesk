export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "business:read",
  "members:read",
  "invitations:manage",
  "business:update", // edit description / location
  "business:rename", // change the business name (owner-only)
  "profile:read", // view the Business Intelligence Profile
  "profile:edit", // save drafts, submit for review, discard own pending changes
  "profile:approve", // approve material changes, change AI permissions, activate/suspend
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Deny by default: anything not listed here is not allowed.
const MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: new Set<Permission>([
    "business:read",
    "members:read",
    "invitations:manage",
    "business:update",
    "business:rename",
    "profile:read",
    "profile:edit",
    "profile:approve",
  ]),
  ADMIN: new Set<Permission>([
    "business:read",
    "members:read",
    "invitations:manage",
    "business:update",
    "profile:read",
    "profile:edit",
  ]),
  MEMBER: new Set<Permission>(["business:read", "members:read", "profile:read"]),
};

const RANK: Readonly<Record<Role, number>> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function can(role: string | null | undefined, permission: string): boolean {
  if (!role || !Object.hasOwn(MATRIX, role)) return false;
  return (MATRIX[role as Role] as ReadonlySet<string>).has(permission);
}

/** An actor may grant roles up to and including their own — never above. */
export function canAssignRole(actorRole: string, targetRole: string): boolean {
  if (!Object.hasOwn(RANK, actorRole) || !Object.hasOwn(RANK, targetRole)) return false;
  return RANK[targetRole as Role] <= RANK[actorRole as Role];
}
