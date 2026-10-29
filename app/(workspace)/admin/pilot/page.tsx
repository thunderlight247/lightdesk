import { notFound } from "next/navigation";
import { AdminPilotPanel } from "@/components/admin/pilot-panel";
import { PageHeading, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/field";
import { requireUserForPage } from "@/lib/auth/guards";
import { AppError } from "@/lib/security/errors";
import { getPilotOverview } from "@/modules/pilot/service";
import { listPilotCandidatesForPage } from "./actions";

/**
 * M7 platform-admin monitoring console (docs/m7-pilot.md §3). Counters only: conversation
 * and message CONTENT never crosses tenant boundaries here.
 */
export default async function AdminPilotPage() {
  const user = await requireUserForPage();
  const overview = await getPilotOverview(user.id).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const candidates = await listPilotCandidatesForPage().catch(() => []);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Controlled pilot"
        lead="Enrollment, consent state, hard usage limits and per-business counters. Restricted capabilities stay off until the business owner explicitly consents in their console."
      />

      <AdminPilotPanel overview={overview} candidates={candidates} />

      <section aria-labelledby="fb-heading" className="card p-4 sm:p-6 space-y-3">
        <CardTitle
          title={
            <span>
              Recent pilot feedback <span className="font-normal text-zinc-500">({overview.recentFeedback.length})</span>
            </span>
          }
        />
        {overview.recentFeedback.length === 0 ? (
          <p className="text-xs text-zinc-400 italic py-2">No feedback submitted yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-xs sm:text-sm">
            {overview.recentFeedback.map((f) => (
              <li key={f.id} className="space-y-1.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900">{f.businessName}</span>
                  <Chip tone="neutral">{f.category}</Chip>
                </div>
                <p className="whitespace-pre-line text-zinc-700 leading-relaxed">{f.comment}</p>
                <p className="text-[11px] text-zinc-400">{f.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
