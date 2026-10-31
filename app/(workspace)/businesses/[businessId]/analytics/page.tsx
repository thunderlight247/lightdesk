import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/field";
import { fmtDateTime } from "@/components/profile/format";
import { requireUserForPage, loadMembershipOrNotFound } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getDemandInsights } from "@/modules/analytics/demand";

export default async function BusinessAnalyticsPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const user = await requireUserForPage();
  const { businessId: rawBusinessId } = await params;
  const parsed = businessIdSchema.safeParse(rawBusinessId);
  if (!parsed.success) notFound();
  const businessId = parsed.data;

  await loadMembershipOrNotFound(user.id, businessId);
  const demand = await getDemandInsights(user.id, businessId);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Customer Demand &amp; Insights"
        lead="Actionable intelligence on what your customers are asking on WhatsApp that isn't answered in your business profile or product catalogue yet."
        actions={
          <Link
            href={`/businesses/${businessId}/profile`}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-brand-700"
          >
            Update Business Profile →
          </Link>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Customer Enquiries</p>
          <p className="mt-2 text-3xl font-extrabold text-zinc-900">{demand.totalEnquiries}</p>
          <p className="mt-1 text-xs text-zinc-500">Inbound WhatsApp &amp; Lab simulations</p>
        </div>

        <div className="card p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Unmet Inquiries</p>
          <p className="mt-2 text-3xl font-extrabold text-amber-600">{demand.unmetEnquiriesCount}</p>
          <p className="mt-1 text-xs text-zinc-500">Required missing info or escalation</p>
        </div>

        <div className="card p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Unmet Ratio</p>
          <p className="mt-2 text-3xl font-extrabold text-brand-600">{demand.unmetRatio}%</p>
          <p className="mt-1 text-xs text-zinc-500">Lower is better: more queries auto-answerable</p>
        </div>
      </div>

      {/* Top Missing Knowledge & Demand Topics */}
      <section aria-labelledby="missing-topics-heading" className="card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="missing-topics-heading" className="text-base font-bold text-zinc-900">
              High-Demand Topics Missing from Profile
            </h2>
            <p className="text-xs text-zinc-500">
              These topics caused the AI assistant to pause and request information. Adding them to your profile will automate more replies.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
            {demand.topMissingTopics.length} detected topics
          </span>
        </div>

        {demand.topMissingTopics.length === 0 ? (
          <div className="border border-dashed border-zinc-200 rounded-xl p-8 text-center text-sm text-zinc-500">
            🎉 Great job! No frequent unmet knowledge gaps detected. All recent enquiries were answerable from your profile and catalogue.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {demand.topMissingTopics.map((topic, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3 shadow-xs hover:border-brand-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-zinc-900 text-sm capitalize">
                    {topic.topic}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-brand-50 text-brand-700 px-2 py-0.5 text-xs font-semibold">
                      {topic.count} {topic.count === 1 ? "query" : "queries"}
                    </span>
                    <Chip tone="neutral">{topic.source.toLowerCase()}</Chip>
                  </div>
                </div>

                {topic.sampleEnquiries.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                      What customers asked:
                    </p>
                    <ul className="space-y-1">
                      {topic.sampleEnquiries.map((sample, sIdx) => (
                        <li
                          key={sIdx}
                          className="rounded bg-zinc-50 p-2 text-xs text-zinc-700 italic border border-zinc-100"
                        >
                          &ldquo;{sample}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">Last asked {fmtDateTime(topic.lastEnquiredAt)}</span>
                  <Link
                    href={`/businesses/${businessId}/profile`}
                    className="text-brand-600 hover:text-brand-800 font-semibold underline"
                  >
                    Add to Profile →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Unmet Questions Feed */}
      <section aria-labelledby="unmet-feed-heading" className="card p-5 sm:p-6 space-y-4">
        <h2 id="unmet-feed-heading" className="text-base font-bold text-zinc-900">
          Recent Inquiries Needing Human Attention
        </h2>

        {demand.recentUnmetQuestions.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">No recent unmet questions recorded.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {demand.recentUnmetQuestions.map((q) => (
              <li key={q.id} className="py-3 space-y-1 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Chip tone="brand">{q.channel}</Chip>
                    <span className="text-zinc-400">{fmtDateTime(q.createdAt)}</span>
                  </div>
                  {q.missingInfo.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {q.missingInfo.map((m, mIdx) => (
                        <span
                          key={mIdx}
                          className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-medium border border-amber-200"
                        >
                          Missing: {m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="font-medium text-zinc-900">&ldquo;{q.text}&rdquo;</p>
                {q.reason && <p className="text-zinc-500 text-[11px]">{q.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
