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
    { href: `${base}/lab`, label: "Lab" },
  ];
  if (can(membership.role, "business:update")) items.push({ href: `${base}/settings`, label: "Settings" });

  return (
    <div>
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Business workspace</p>
            <p className="break-words text-lg font-semibold tracking-tight text-zinc-900">{membership.business.name}</p>
          </div>
          {businesses.length > 1 && (
            <details className="relative text-sm">
              <summary className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-700 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50">
                Switch business
              </summary>
              <ul className="mt-1 divide-y rounded-lg border border-zinc-200 bg-white shadow-sm">
                {businesses.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/businesses/${b.id}`}
                      aria-current={b.id === membership.businessId ? "true" : undefined}
                      className={`flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-zinc-50 ${
                        b.id === membership.businessId ? "font-medium text-brand-800" : ""
                      }`}
                    >
                      <span>{b.name}</span>
                      <RoleBadge role={b.role} />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {businesses.length <= 1 && <RoleBadge role={membership.role} />}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BusinessNav items={items} />
          {businesses.length > 1 && (
            <div className="ml-auto hidden sm:block">
              <RoleBadge role={membership.role} />
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
