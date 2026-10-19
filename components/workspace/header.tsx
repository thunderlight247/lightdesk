import Link from "next/link";
import { logoutAction } from "@/app/(workspace)/actions";
import type { SessionUser } from "@/lib/auth/session";

export function Header({ user }: { user: SessionUser }) {
  return (
    <header className="border-b bg-white px-4 py-3 text-sm sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Main" className="flex items-center gap-4">
          <Link href="/businesses" className="font-semibold">
            LightDesk
          </Link>
          <Link href="/businesses">Businesses</Link>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          {user.isPlatformAdmin && (
            <Link
              href="/admin/businesses/new"
              className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
            >
              Platform admin
            </Link>
          )}
          <form action={logoutAction} className="flex items-center gap-3">
            <span className="text-neutral-600">{user.name}</span>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
