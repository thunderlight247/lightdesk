import { loadMembershipOrNotFound, requireUserForPage } from "@/lib/auth/guards";
import { InviteMemberForm } from "@/components/forms/invite-member-form";
import { RoleBadge } from "@/components/workspace/role-badge";
import { PageHeading, CardTitle } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { listMembers } from "@/modules/businesses/service";
import { listPendingInvitations } from "@/modules/businesses/invitations";
import { can, ROLES, canAssignRole } from "@/modules/permissions/roles";
import { revokeInvitationAction } from "./actions";

export default async function MembersPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const membership = await loadMembershipOrNotFound(user.id, businessId);
  const members = await listMembers(user.id, membership.businessId);
  const canManage = can(membership.role, "invitations:manage");
  const pending = canManage ? await listPendingInvitations(user.id, membership.businessId) : [];
  const assignable = ROLES.filter((r) => canAssignRole(membership.role, r));

  return (
    <div className="space-y-6">
      <PageHeading
        title="Team members"
        lead="Manage members with access to this business workspace and their operational roles."
      />

      {/* Current Members List */}
      <section className="card p-4 sm:p-5 space-y-3">
        <CardTitle
          title={
            <span>
              Active members <span className="font-normal text-zinc-500">({members.length})</span>
            </span>
          }
        />
        <ul className="divide-y divide-zinc-100">
          {members.map((m) => {
            const initial = m.user.name ? m.user.name.charAt(0).toUpperCase() : m.user.email.charAt(0).toUpperCase();
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800 text-xs">
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-900 truncate text-sm">{m.user.name}</p>
                    <p className="text-xs text-zinc-500 truncate">{m.user.email}</p>
                  </div>
                </div>
                <RoleBadge role={m.role} />
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && (
        <>
          {/* Pending Invitations */}
          <section className="card p-4 sm:p-5 space-y-3">
            <CardTitle
              title={
                <span>
                  Pending invitations <span className="font-normal text-zinc-500">({pending.length})</span>
                </span>
              }
              subtitle="Unclaimed invitation links. Invitations expire automatically after their window."
            />
            {pending.length === 0 ? (
              <p className="text-xs text-zinc-400 italic py-2">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {pending.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-900 text-sm truncate">{i.email}</span>
                        <RoleBadge role={i.role} />
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Expires {i.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                      </p>
                    </div>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="businessId" value={membership.businessId} />
                      <input type="hidden" name="invitationId" value={i.id} />
                      <GhostButton type="submit" variant="danger">
                        Revoke
                      </GhostButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Invite Form */}
          <section className="card p-4 sm:p-5 space-y-3">
            <CardTitle
              title="Invite a new member"
              subtitle="Generate an invitation link to onboard a new team member."
            />
            <InviteMemberForm businessId={membership.businessId} roles={[...assignable]} />
          </section>
        </>
      )}
    </div>
  );
}
