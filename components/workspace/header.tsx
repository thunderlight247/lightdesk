import Link from "next/link";
import { logoutAction } from "@/app/(workspace)/actions";
import type { SessionUser } from "@/lib/auth/session";

export function Header({ user }: { user: SessionUser }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-6">
        <nav aria-label="Main" className="flex items-center gap-3">
          <Link href="/businesses" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white shadow-sm">LD</span>
            <span className="font-semibold tracking-tight text-zinc-900">LightDesk</span>
          </Link>
          <Link
            href="/businesses"
            className="rounded-lg px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Businesses
          </Link>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          {user.isPlatformAdmin && (
            <Link
              href="/admin/businesses/new"
              className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Platform admin
            </Link>
          )}
          <form action={logoutAction} className="flex items-center gap-3">
            <span className="hidden text-zinc-600 sm:inline">{user.name}</span>
            <button
              type="submit"
              className="rounded-lg px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
