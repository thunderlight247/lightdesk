"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SectionNav({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Profile sections" className="mb-6 flex flex-wrap gap-2 text-sm">
      {items.map((i) => {
        const active = i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${active ? "border-neutral-900 bg-neutral-900 text-white" : "bg-white hover:border-neutral-400"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
