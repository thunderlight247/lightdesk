"use client";

import { useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/(workspace)/actions";
import type { SessionUser } from "@/lib/auth/session";

export function Header({ user }: { user: SessionUser }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const initial = user.name ? user.name.trim().charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Brand & Desktop Left Nav */}
        <div className="flex items-center gap-6">
          <Link href="/businesses" className="group flex items-center gap-2.5 outline-none">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-xs font-bold tracking-tight text-white shadow-xs transition-transform duration-150 group-hover:scale-105">
              LD
            </span>
            <div className="flex flex-col">
              <span className="text-base font-semibold tracking-tight text-zinc-900 group-hover:text-brand-700">
                LightDesk
              </span>
              <span className="hidden text-[10px] font-medium uppercase tracking-wider text-zinc-400 sm:block -mt-1">
                Workspace
              </span>
            </div>
          </Link>

          <nav aria-label="Main" className="hidden sm:flex items-center gap-1">
            <Link
              href="/businesses"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              Businesses
            </Link>
          </nav>
        </div>

        {/* Desktop Right Nav */}
        <div className="hidden sm:flex items-center gap-3">
          {user.isPlatformAdmin && (
            <div className="flex items-center gap-1.5 border-r border-zinc-200 pr-3">
              <Link
                href="/admin/pilot"
                className="rounded-full border border-amber-300/80 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                Pilot
              </Link>
              <Link
                href="/admin/businesses/new"
                className="rounded-full border border-amber-300/80 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                Platform admin
              </Link>
            </div>
          )}

          <div className="flex items-center gap-2 pl-1">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
              title={user.email}
            >
              {initial}
            </span>
            <span className="max-w-[120px] truncate text-xs font-medium text-zinc-700" title={user.name}>
              {user.name}
            </span>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>

        {/* Mobile Hamburger Toggle */}
        <div className="flex sm:hidden items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
            title={user.email}
          >
            {initial}
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-xs hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {mobileMenuOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-zinc-200/80 bg-white px-4 py-4 shadow-lg animate-in slide-in-from-top duration-150">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">{user.name}</p>
                <p className="truncate text-xs text-zinc-500">{user.email}</p>
              </div>
            </div>

            <nav className="flex flex-col gap-1">
              <Link
                href="/businesses"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
              >
                <span>Businesses</span>
                <span className="text-xs text-zinc-400">Workspace list →</span>
              </Link>

              {user.isPlatformAdmin && (
                <div className="mt-2 space-y-1 rounded-xl bg-amber-50/70 p-2.5 border border-amber-200/60">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">Platform Admin</p>
                  <Link
                    href="/admin/pilot"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    <span>Pilot Operations</span>
                    <span>→</span>
                  </Link>
                  <Link
                    href="/admin/businesses/new"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    <span>Create Business</span>
                    <span>→</span>
                  </Link>
                </div>
              )}
            </nav>

            <div className="pt-2">
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200"
                >
                  <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
