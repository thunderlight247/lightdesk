import Link from "next/link";
import { RoleBadge } from "@/components/workspace/role-badge";
import { PageHeading } from "@/components/ui/card";
import { requireUserForPage } from "@/lib/auth/guards";
import { listBusinessesForUser } from "@/modules/businesses/service";

export default async function BusinessesPage() {
  const user = await requireUserForPage();
  const businesses = await listBusinessesForUser(user.id);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Your businesses"
        lead={
          businesses.length > 0
            ? "Select a business to enter its workspace, inspect profiles, and test simulated conversations."
            : "Workspaces you belong to will appear here."
        }
      />

      {businesses.length === 0 ? (
        <section className="card border-dashed p-8 text-center text-sm space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div className="max-w-md mx-auto">
            <h2 className="font-semibold text-zinc-900 text-base">You are not a member of any workspace yet</h2>
            <p className="mt-1 text-zinc-500 text-xs sm:text-sm">
              Ask your business owner or administrator to send you an invitation link, then open it to join.
            </p>
          </div>
          {user.isPlatformAdmin && (
            <div className="pt-2">
              <Link
                href="/admin/businesses/new"
                className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-amber-600"
              >
                Create new business (Admin) →
              </Link>
            </div>
          )}
        </section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((b) => {
            const initial = b.name.trim().charAt(0).toUpperCase() || "B";
            return (
              <li key={b.id}>
                <Link
                  href={`/businesses/${b.id}`}
                  className="card-interactive block h-full p-4 sm:p-5 group"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-bold text-brand-700 text-sm group-hover:scale-105 transition-transform">
                      {initial}
                    </span>
                    <RoleBadge role={b.role} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-zinc-900 group-hover:text-brand-700 truncate text-base">
                      {b.name}
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500 truncate">
                      {b.location ?? "No location specified"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
