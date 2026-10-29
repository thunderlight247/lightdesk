import Link from "next/link";
import { BusinessSettingsForm } from "@/components/forms/business-settings-form";
import { DeleteBusinessSection } from "@/components/forms/delete-business-form";
import { PageHeading } from "@/components/ui/card";
import { loadOverviewOrNotFound, requireUserForPage } from "@/lib/auth/guards";

export default async function BusinessSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const { business, capabilities } = await loadOverviewOrNotFound(user.id, businessId);

  // Members get an explanation instead of a form. The server action and API re-check anyway.
  if (!capabilities.canUpdate) {
    return (
      <section className="card p-6 text-sm space-y-3">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900">Settings</h1>
        <p className="text-zinc-600">
          Only owners and administrators can change business settings.{" "}
          <Link href={`/businesses/${business.id}`} className="font-semibold text-brand-700 underline">
            Back to overview
          </Link>
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Settings"
        lead="Manage general business metadata, data export archives, and workspace deletion."
      />

      <BusinessSettingsForm
        businessId={business.id}
        canRename={capabilities.canRename}
        initial={{ name: business.name, description: business.description, location: business.location }}
      />

      {capabilities.canRename && (
        <div className="space-y-6">
          <section aria-labelledby="privacy-heading" className="card p-5 sm:p-6 space-y-3">
            <h2 id="privacy-heading" className="text-sm font-semibold text-zinc-900">
              Privacy &amp; Data Management
            </h2>
            <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed">
              Export a complete, machine-readable JSON archive of this business&apos;s records, including
              knowledge profile, product catalogue, conversation history, and audit metadata.
            </p>
            <div className="pt-1">
              <a
                href={`/api/businesses/${business.id}/export`}
                download
                className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-zinc-700 shadow-xs transition-colors hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download data export (JSON)
              </a>
            </div>
          </section>

          <DeleteBusinessSection businessId={business.id} businessName={business.name} />
        </div>
      )}
    </div>
  );
}
