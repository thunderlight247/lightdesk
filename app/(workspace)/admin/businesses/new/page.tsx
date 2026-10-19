import { notFound } from "next/navigation";
import { CreateBusinessForm } from "@/components/forms/create-business-form";
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
    <div className="space-y-8">
      <p className="text-xs uppercase tracking-wide text-amber-800">Platform administration</p>
      <h1 className="text-xl font-semibold">Create a business</h1>
      <p className="text-sm text-neutral-600">
        Platform administrators can create businesses but do not get access to their data. The owner joins via invitation.
      </p>
      <CreateBusinessForm />
      <ul className="divide-y rounded-md border bg-white text-sm">
        {businesses.map((b) => (
          <li key={b.id} className="flex justify-between p-3">
            <span>{b.name}</span>
            <span className="text-xs text-neutral-500">{b.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
