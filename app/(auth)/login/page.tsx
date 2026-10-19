import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/security/redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeRedirectPath(next));
  return (
    <main className="mx-auto max-w-sm p-6 pt-20">
      <h1 className="mb-1 text-2xl font-semibold">LightDesk</h1>
      <p className="mb-6 text-sm text-neutral-600">Sign in. Access is by invitation only.</p>
      <LoginForm next={safeRedirectPath(next, "")} />
    </main>
  );
}
