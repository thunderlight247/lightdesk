import Link from "next/link";
import { PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/field";
import { loadOverviewOrNotFound, requireUserForPage } from "@/lib/auth/guards";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function BusinessOverviewPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const { business, memberCount, capabilities } = await loadOverviewOrNotFound(user.id, businessId);
  const base = `/businesses/${business.id}`;

  return (
    <div className="space-y-6">
      <PageHeading title="Overview" />

      <section className="card divide-y divide-zinc-100 text-sm">
        <Row label="Name">{business.name}</Row>
        <Row label="Status">
          <Chip tone="success">{business.status === "ACTIVE" ? "Active" : business.status}</Chip>
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
                  <Link href={`${base}/settings`} className="underline hover:text-zinc-700">
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
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{business.slug}</code>
        </Row>
        <Row label="Created">{day(business.createdAt)}</Row>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        <li>
          <Link href={`${base}/members`} className="card block p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50/40">
            <span className="font-medium text-zinc-900">Members{capabilities.canManageInvitations ? " & invitations" : ""}</span>
            <span className="mt-1 block text-sm text-zinc-600">
              {capabilities.canManageInvitations ? "See who has access and invite people." : "See who has access to this business."}
            </span>
          </Link>
        </li>
        {capabilities.canUpdate && (
          <li>
            <Link href={`${base}/settings`} className="card block p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50/40">
              <span className="font-medium text-zinc-900">Settings</span>
              <span className="mt-1 block text-sm text-zinc-600">Update the business location and description.</span>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words sm:col-span-2">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-zinc-500">{children}</span>;
}
