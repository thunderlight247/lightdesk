import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/security/redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeRedirectPath(next));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 bg-zinc-50/70">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-lg font-bold text-white shadow-sm mb-3">
            LD
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">LightDesk</h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            Frontline business conversation platform. Sign in to your workspace.
          </p>
        </div>

        {/* Card */}
        <div className="card p-6 sm:p-8 shadow-sm">
          <LoginForm next={safeRedirectPath(next, "")} />
        </div>

        <p className="text-center text-xs text-zinc-400">
          Access is by invitation only. Contact your business owner for an invitation.
        </p>
      </div>
    </main>
  );
}
