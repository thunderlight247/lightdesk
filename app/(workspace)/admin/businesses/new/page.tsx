import { notFound } from "next/navigation";
import { CreateBusinessForm } from "@/components/forms/create-business-form";
import { PageHeading, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/field";
import { requireUserForPage } from "@/lib/auth/guards";
import { AppError } from "@/lib/security/errors";
import { listAllBusinessNames } from "@/modules/businesses/service";

export default async function NewBusinessPage() {
  const user = await requireUserForPage();
  const businesses = await listAllBusinessNames(user.id).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });

  return (
    <div className="space-y-6">
      <PageHeading
        title="Create a business"
        lead="Platform administrators can create businesses and mint owner invitations. Platform administrators do not gain access to business operational data."
      />

      <section className="card p-4 sm:p-6 space-y-4">
        <CardTitle title="New business workspace" subtitle="Creates the workspace and generates a single-use onboarding link for the owner." />
        <CreateBusinessForm />
      </section>

      <section className="card p-4 sm:p-6 space-y-3">
        <CardTitle
          title={
            <span>
              All platform businesses <span className="font-normal text-zinc-500">({businesses.length})</span>
            </span>
          }
        />
        <ul className="divide-y divide-zinc-100 text-xs sm:text-sm">
          {businesses.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2.5">
              <span className="font-medium text-zinc-900">{b.name}</span>
              <Chip tone="success" withDot>{b.status}</Chip>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
