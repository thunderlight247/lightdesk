import Link from "next/link";
import { AcceptInviteForm } from "@/components/forms/accept-invite-form";
import { getCurrentUser } from "@/lib/auth/session";
import { RoleBadge } from "@/components/workspace/role-badge";
import { previewInvitation } from "@/modules/businesses/invitations";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvitation(token);
  const user = invite ? await getCurrentUser() : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 bg-zinc-50/70">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-lg font-bold text-white shadow-sm mb-3">
            LD
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">LightDesk</h1>
        </div>

        {/* Card */}
        <div className="card p-6 sm:p-8 shadow-sm space-y-4">
          {!invite ? (
            <div className="text-center space-y-2">
              <h2 className="text-lg font-bold text-zinc-900">Invitation unavailable</h2>
              <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed">
                This invitation link is invalid, has expired, or was already used. Please request a new invitation from your business workspace administrator.
              </p>
              <div className="pt-2">
                <Link href="/login" className="font-semibold text-brand-700 underline text-xs">
                  Back to Sign In →
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-zinc-900">
                  Join {invite.businessName}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-500">Role assigned:</span>
                  <RoleBadge role={invite.role} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Invitation intended for <strong className="font-medium text-zinc-700">{invite.email}</strong>.
                </p>
              </div>

              {user && user.email === invite.email ? (
                <AcceptInviteForm token={token} mode="join" />
              ) : user ? (
                <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
                  <p>You are signed in as a different account ({user.email}). Sign out first and reopen this link.</p>
                </div>
              ) : invite.accountExists ? (
                <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-700 border border-zinc-200 space-y-2">
                  <p>You already have an existing account for this email.</p>
                  <Link
                    className="inline-block font-semibold text-brand-700 underline"
                    href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                  >
                    Sign in to accept invitation →
                  </Link>
                </div>
              ) : (
                <AcceptInviteForm token={token} mode="register" />
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
