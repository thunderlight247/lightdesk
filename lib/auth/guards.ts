import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { AppError, UnauthenticatedError } from "@/lib/security/errors";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getProfileView } from "@/modules/business-profile/service";
import { getBusinessOverview } from "@/modules/businesses/service";
import { requireMembership } from "@/modules/permissions/access";

/** For route handlers / actions: throws UnauthenticatedError. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

/** For pages: redirects to login. */
export async function requireUserForPage(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Page helper: invalid id, unknown business and non-membership all render 404. */
export async function loadMembershipOrNotFound(userId: string, rawBusinessId: string) {
  const id = businessIdSchema.safeParse(rawBusinessId);
  if (!id.success) notFound();
  try {
    return await requireMembership(userId, id.data);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
}

/** Page helper for overview/settings: same 404 behaviour, returns role + capabilities. */
export async function loadOverviewOrNotFound(userId: string, rawBusinessId: string) {
  const id = businessIdSchema.safeParse(rawBusinessId);
  if (!id.success) notFound();
  try {
    return await getBusinessOverview(userId, id.data);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
}

/** Page helper for the profile area: same 404 behaviour as the rest of the workspace. */
export async function loadProfileViewOrNotFound(userId: string, rawBusinessId: string) {
  const id = businessIdSchema.safeParse(rawBusinessId);
  if (!id.success) notFound();
  try {
    return await getProfileView(userId, id.data);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
}
