import Link from "next/link";
import { BusinessNav, type NavItem } from "@/components/workspace/business-nav";
import { RoleBadge } from "@/components/workspace/role-badge";
import { loadMembershipOrNotFound, requireUserForPage } from "@/lib/auth/guards";
import { listBusinessesForUser } from "@/modules/businesses/service";
import { can } from "@/modules/permissions/roles";

/**
 * Convenience chrome only. Layouts are not re-run on every client navigation, so every
 * page below still performs its own membership check — this is not the security boundary.
 */
export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const membership = await loadMembershipOrNotFound(user.id, businessId);
  const businesses = await listBusinessesForUser(user.id);

  const base = `/businesses/${membership.businessId}`;
  const items: NavItem[] = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/profile`, label: "Profile" },
  ];
  if (can(membership.role, "business:update")) items.push({ href: `${base}/settings`, label: "Settings" });

  return (
    <div>
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Business workspace</p>
            <p className="break-words text-lg font-semibold">{membership.business.name}</p>
          </div>
          <RoleBadge role={membership.role} />
        </div>
        {businesses.length > 1 && (
          <details className="text-sm">
            <summary className="cursor-pointer underline">Switch business</summary>
            <ul className="mt-2 divide-y rounded-md border bg-white">
              {businesses.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/businesses/${b.id}`}
                    aria-current={b.id === membership.businessId ? "true" : undefined}
                    className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50"
                  >
                    <span>{b.name}</span>
                    <RoleBadge role={b.role} />
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
        <BusinessNav items={items} />
      </div>
      {children}
    </div>
  );
}
