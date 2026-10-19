import { loadMembershipOrNotFound, requireUserForPage } from "@/lib/auth/guards";
import { InviteMemberForm } from "@/components/forms/invite-member-form";
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
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{membership.business.name} — members</h1>
      <ul className="divide-y rounded-md border bg-white text-sm">
        {members.map((m) => (
          <li key={m.id} className="flex justify-between p-3">
            <span>{m.user.name} <span className="text-neutral-500">({m.user.email})</span></span>
            <span className="text-xs text-neutral-500">{m.role}</span>
          </li>
        ))}
      </ul>

      {canManage && (
        <>
          <section>
            <h2 className="mb-2 font-medium">Pending invitations</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-neutral-600">None.</p>
            ) : (
              <ul className="divide-y rounded-md border bg-white text-sm">
                {pending.map((i) => (
                  <li key={i.id} className="flex items-center justify-between p-3">
                    <span>{i.email} · {i.role} · expires {i.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="businessId" value={membership.businessId} />
                      <input type="hidden" name="invitationId" value={i.id} />
                      <button type="submit" className="underline">Revoke</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 font-medium">Invite someone</h2>
            <InviteMemberForm businessId={membership.businessId} roles={[...assignable]} />
          </section>
        </>
      )}
    </div>
  );
}
