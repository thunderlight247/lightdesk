import Link from "next/link";
import { RoleBadge } from "@/components/workspace/role-badge";
import { requireUserForPage } from "@/lib/auth/guards";
import { listBusinessesForUser } from "@/modules/businesses/service";

export default async function BusinessesPage() {
  const user = await requireUserForPage();
  const businesses = await listBusinessesForUser(user.id);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Your businesses</h1>
      <p className="mb-6 text-sm text-neutral-600">
        {businesses.length > 0
          ? "Choose a business to open its workspace. You only see businesses you have been invited to."
          : "Workspaces you belong to will appear here."}
      </p>

      {businesses.length === 0 ? (
        <section className="rounded-md border border-dashed bg-white p-6 text-sm">
          <h2 className="mb-1 font-medium">You are not a member of any business yet</h2>
          <p className="text-neutral-600">
            Ask a business owner or admin to send you an invitation link, then open it to join their workspace.
          </p>
          {user.isPlatformAdmin && (
            <p className="mt-3 text-neutral-600">
              You are a platform administrator. Creating businesses is a separate task:{" "}
              <Link href="/admin/businesses/new" className="underline">
                open platform admin
              </Link>
              .
            </p>
          )}
        </section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link
                href={`/businesses/${b.id}`}
                className="block h-full rounded-md border bg-white p-4 hover:border-neutral-400 focus-visible:outline focus-visible:outline-2"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{b.name}</span>
                  <RoleBadge role={b.role} />
                </div>
                <p className="break-words text-sm text-neutral-600">{b.location ?? "No location set"}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
