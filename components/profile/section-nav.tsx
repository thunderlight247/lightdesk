"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SectionNav({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Profile sections"
      className="nav-scroll mb-6 -mx-4 px-4 sm:mx-0 sm:px-0 py-1"
    >
      <div className="flex items-center gap-2">
        {items.map((i) => {
          const active = i.exact
            ? pathname === i.href
            : pathname === i.href || pathname.startsWith(`${i.href}/`);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs sm:text-sm font-medium transition-all duration-150 ${
                active
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "border border-zinc-200/90 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              {i.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
