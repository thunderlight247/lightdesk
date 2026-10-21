import { notFound } from "next/navigation";
import { AdminPilotPanel } from "@/components/admin/pilot-panel";
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
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <p className="text-xs uppercase tracking-wide text-amber-800">Platform administration</p>
      <h1 className="text-xl font-semibold">Controlled pilot</h1>
      <p className="text-sm text-neutral-600">
        Enrollment, consent state, hard usage limits and per-business counters. Restricted
        capabilities stay off until the business owner explicitly consents in their console.
      </p>

      <AdminPilotPanel overview={overview} candidates={candidates} />

      <section aria-labelledby="fb-heading" className="space-y-3">
        <h2 id="fb-heading" className="text-sm font-semibold text-zinc-900">Recent pilot feedback</h2>
        {overview.recentFeedback.length === 0 ? (
          <p className="text-sm text-zinc-500">No feedback submitted yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-white text-sm">
            {overview.recentFeedback.map((f) => (
              <li key={f.id} className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-800">{f.businessName}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{f.category}</span>
                </div>
                <p className="whitespace-pre-line text-zinc-700">{f.comment}</p>
                <p className="text-xs text-zinc-400">{f.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
