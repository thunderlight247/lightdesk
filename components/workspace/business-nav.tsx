"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; exact?: boolean };

export function BusinessNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Business sections"
      className="nav-scroll -mx-4 px-4 sm:mx-0 sm:px-0 py-1"
    >
      <div className="flex items-center gap-1.5 rounded-2xl bg-zinc-200/60 p-1">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all duration-150 ${
                active
                  ? "bg-white text-zinc-900 shadow-xs"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-white/50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
