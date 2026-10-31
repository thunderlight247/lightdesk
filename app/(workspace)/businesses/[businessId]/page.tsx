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
      <PageHeading
        title="Overview"
        lead="Manage business workspace profile, team members, conversation test lab, and WhatsApp connection."
      />

      {/* Quick Action Navigation Grid */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <Link
            href={`${base}/profile`}
            className="card-interactive block p-4 sm:p-5 h-full group"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 group-hover:text-brand-700">Business Profile</span>
              <span className="text-zinc-400 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <span className="mt-1.5 block text-xs sm:text-sm text-zinc-500 leading-relaxed">
              Maintain facts, FAQs, product catalogue, policies, and AI permissions.
            </span>
          </Link>
        </li>

        <li>
          <Link
            href={`${base}/lab`}
            className="card-interactive block p-4 sm:p-5 h-full group"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 group-hover:text-brand-700">Conversation Lab</span>
              <span className="text-zinc-400 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <span className="mt-1.5 block text-xs sm:text-sm text-zinc-500 leading-relaxed">
              Test customer enquiries and inspect AI drafts against approved facts.
            </span>
          </Link>
        </li>

        <li>
          <Link
            href={`${base}/members`}
            className="card-interactive block p-4 sm:p-5 h-full group"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 group-hover:text-brand-700">
                Members{capabilities.canManageInvitations ? " & Invitations" : ""}
              </span>
              <span className="text-zinc-400 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <span className="mt-1.5 block text-xs sm:text-sm text-zinc-500 leading-relaxed">
              {capabilities.canManageInvitations ? "Manage team members and invite new collaborators." : "View authorized workspace team members."}
            </span>
          </Link>
        </li>

        {capabilities.canUpdate && (
          <li>
            <Link
              href={`${base}/settings`}
              className="card-interactive block p-4 sm:p-5 h-full group"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-900 group-hover:text-brand-700">Settings</span>
                <span className="text-zinc-400 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <span className="mt-1.5 block text-xs sm:text-sm text-zinc-500 leading-relaxed">
                Update business name, physical location, and workspace details.
              </span>
            </Link>
          </li>
        )}
      </ul>

      {/* Workspace Details Card */}
      <section className="card p-4 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900">Workspace information</h2>
        <div className="divide-y divide-zinc-100 text-xs sm:text-sm">
          <Row label="Business Name">
            <span className="font-medium text-zinc-900">{business.name}</span>
          </Row>
          <Row label="Account Status">
            <Chip tone="success" withDot>
              {business.status === "ACTIVE" ? "Active" : business.status}
            </Chip>
          </Row>
          <Row label="Location">
            {business.location ? (
              <span className="text-zinc-800">{business.location}</span>
            ) : (
              <span className="text-zinc-400 italic">Not set</span>
            )}
          </Row>
          <Row label="Description">
            {business.description ? (
              <span className="whitespace-pre-line text-zinc-800 leading-relaxed">{business.description}</span>
            ) : (
              <span className="text-zinc-400 italic">
                No description provided yet.
                {capabilities.canUpdate && (
                  <>
                    {" "}
                    <Link href={`${base}/settings`} className="font-medium text-brand-700 underline">
                      Add description
                    </Link>
                  </>
                )}
              </span>
            )}
          </Row>
          {memberCount !== null && (
            <Row label="Team Size">
              <span className="text-zinc-800 font-medium">{memberCount} member{memberCount === 1 ? "" : "s"}</span>
            </Row>
          )}
          <Row label="Workspace ID">
            <code className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 border border-zinc-200/60">
              {business.slug}
            </code>
          </Row>
          <Row label="Created Date">
            <span className="text-zinc-600">{day(business.createdAt)}</span>
          </Row>
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-zinc-500 font-medium">{label}</dt>
      <dd className="min-w-0 break-words sm:col-span-2 text-zinc-900">{children}</dd>
    </div>
  );
}
