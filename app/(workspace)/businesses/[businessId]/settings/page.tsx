import Link from "next/link";
import { BusinessSettingsForm } from "@/components/forms/business-settings-form";
import { loadOverviewOrNotFound, requireUserForPage } from "@/lib/auth/guards";

export default async function BusinessSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const { business, capabilities } = await loadOverviewOrNotFound(user.id, businessId);

  // Members get an explanation instead of a form. The server action and API re-check anyway.
  if (!capabilities.canUpdate) {
    return (
      <section className="rounded-md border bg-white p-6 text-sm">
        <h1 className="mb-1 text-xl font-semibold">Settings</h1>
        <p className="text-neutral-600">
          Only owners and admins can change business settings.{" "}
          <Link href={`/businesses/${business.id}`} className="underline">
            Back to overview
          </Link>
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <BusinessSettingsForm
        businessId={business.id}
        canRename={capabilities.canRename}
        initial={{ name: business.name, description: business.description, location: business.location }}
      />

      {capabilities.canRename && (
        <section aria-labelledby="privacy-heading" className="card space-y-3 p-5">
          <h2 id="privacy-heading" className="text-sm font-semibold text-zinc-900">
            Privacy &amp; Data Management
          </h2>
          <p className="text-sm text-zinc-600">
            Export a complete machine-readable JSON archive of this business&apos;s records, including
            knowledge profile, catalog, WhatsApp conversation history, and audit metadata.
          </p>
          <div>
            <a
              href={`/api/businesses/${business.id}/export`}
              download
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              Download data export (JSON)
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
