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
    </div>
  );
}
