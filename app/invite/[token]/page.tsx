import Link from "next/link";
import { AcceptInviteForm } from "@/components/forms/accept-invite-form";
import { getCurrentUser } from "@/lib/auth/session";
import { previewInvitation } from "@/modules/businesses/invitations";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvitation(token);
  const user = invite ? await getCurrentUser() : null;

  return (
    <main className="mx-auto max-w-sm p-6 pt-20">
      {!invite ? (
        <>
          <h1 className="mb-2 text-xl font-semibold">Invitation unavailable</h1>
          <p className="text-sm text-neutral-600">This invitation is invalid, has expired, or was already used. Ask for a new one.</p>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-xl font-semibold">Join {invite.businessName}</h1>
          <p className="mb-6 text-sm text-neutral-600">Invitation for {invite.email} as {invite.role}.</p>
          {user && user.email === invite.email ? (
            <AcceptInviteForm token={token} mode="join" />
          ) : user ? (
            <p className="text-sm">You are signed in as a different account. Sign out and open this link again.</p>
          ) : invite.accountExists ? (
            <p className="text-sm">
              You already have an account. <Link className="underline" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</Link>, then return to this link.
            </p>
          ) : (
            <AcceptInviteForm token={token} mode="register" />
          )}
        </>
      )}
    </main>
  );
}
