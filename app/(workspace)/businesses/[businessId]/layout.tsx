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
  if (can(membership.role, "whatsapp:read")) {
    items.push({ href: `${base}/whatsapp`, label: "WhatsApp" });
    items.push({ href: `${base}/orders`, label: "Orders" });
    items.push({ href: `${base}/analytics`, label: "Insights" });
  }
  if (can(membership.role, "business:update")) items.push({ href: `${base}/settings`, label: "Settings" });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Business header banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">
                Workspace
              </span>
              <RoleBadge role={membership.role} />
            </div>
            <h1 className="mt-1.5 break-words text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
              {membership.business.name}
            </h1>
          </div>

          {businesses.length > 1 && (
            <details className="relative text-sm">
              <summary className="cursor-pointer list-none select-none inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 shadow-xs transition-colors hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100">
                <span>Switch business</span>
                <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <ul className="absolute right-0 z-30 mt-2 w-64 max-h-72 overflow-y-auto divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                {businesses.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/businesses/${b.id}`}
                      aria-current={b.id === membership.businessId ? "true" : undefined}
                      className={`flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs transition-colors hover:bg-zinc-50 ${
                        b.id === membership.businessId ? "bg-brand-50/70 font-semibold text-brand-900" : "text-zinc-700"
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      <RoleBadge role={b.role} />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Business sub-navigation pills */}
        <BusinessNav items={items} />
      </div>

      <div>{children}</div>
    </div>
  );
}
