"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; exact?: boolean };

export function BusinessNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Business sections" className="flex flex-wrap gap-1 border-b text-sm">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${active ? "border-neutral-900 font-medium" : "border-transparent text-neutral-600 hover:text-neutral-900"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
