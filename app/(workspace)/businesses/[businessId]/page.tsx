import Link from "next/link";
import { loadOverviewOrNotFound, requireUserForPage } from "@/lib/auth/guards";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function BusinessOverviewPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const { business, memberCount, capabilities } = await loadOverviewOrNotFound(user.id, businessId);
  const base = `/businesses/${business.id}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <dl className="divide-y rounded-md border bg-white text-sm">
        <Row label="Name">{business.name}</Row>
        <Row label="Status">
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">
            {business.status === "ACTIVE" ? "Active" : business.status}
          </span>
        </Row>
        <Row label="Location">{business.location ?? <Muted>Not set</Muted>}</Row>
        <Row label="Description">
          {business.description ? (
            <span className="whitespace-pre-line">{business.description}</span>
          ) : (
            <Muted>
              No description yet.
              {capabilities.canUpdate && (
                <>
                  {" "}
                  <Link href={`${base}/settings`} className="underline">
                    Add one
                  </Link>
                  .
                </>
              )}
            </Muted>
          )}
        </Row>
        {memberCount !== null && <Row label="Members">{memberCount}</Row>}
        <Row label="Workspace ID">
          <code className="text-xs">{business.slug}</code>
        </Row>
        <Row label="Created">{day(business.createdAt)}</Row>
      </dl>

      <ul className="grid gap-3 sm:grid-cols-2">
        <li>
          <Link href={`${base}/members`} className="block rounded-md border bg-white p-4 hover:border-neutral-400">
            <span className="font-medium">Members{capabilities.canManageInvitations ? " & invitations" : ""}</span>
            <span className="mt-1 block text-sm text-neutral-600">
              {capabilities.canManageInvitations ? "See who has access and invite people." : "See who has access to this business."}
            </span>
          </Link>
        </li>
        {capabilities.canUpdate && (
          <li>
            <Link href={`${base}/settings`} className="block rounded-md border bg-white p-4 hover:border-neutral-400">
              <span className="font-medium">Settings</span>
              <span className="mt-1 block text-sm text-neutral-600">Update the business location and description.</span>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 p-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="min-w-0 break-words sm:col-span-2">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-neutral-500">{children}</span>;
}
