import Link from "next/link";
import { notFound } from "next/navigation";
import { NewConversationForm } from "@/components/lab/new-conversation-form";
import { ConversationStatusBadge } from "@/components/lab/badges";
import { fmtDateTime } from "@/components/profile/format";
import { PageHeading } from "@/components/ui/card";
import { Alert, Chip } from "@/components/ui/field";
import { businessIdSchema } from "@/lib/validation/schemas";
import { orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { getLabReadiness, listConversations } from "@/modules/lab/service";
import { SIMULATION_NOTICE } from "@/modules/lab/types";

export default async function LabPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId: raw } = await params;
  const parsed = businessIdSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const businessId = parsed.data;
  const [ready, conversations] = await Promise.all([
    orNotFound(getLabReadiness(user.id, businessId)),
    orNotFound(listConversations(user.id, businessId)),
  ]);
  const base = `/businesses/${businessId}`;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Conversation lab"
        lead={
          <>
            Simulate customer enquiries and inspect how LightDesk generates responses strictly using your <em>approved</em> business facts.{" "}
            {SIMULATION_NOTICE} Nothing here is sent to WhatsApp or any external user.
          </>
        }
      />

      {/* Lab Readiness Dashboard */}
      <section aria-labelledby="readiness" className="card p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
          <h2 id="readiness" className="text-sm font-semibold text-zinc-900">Lab readiness</h2>
          <Chip tone={ready.aiReady ? "success" : "warning"} withDot>
            {ready.aiReady ? "Ready for AI drafting" : "Limited readiness"}
          </Chip>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Business Profile</span>
            <p className="mt-1 font-semibold text-zinc-900 capitalize text-sm">
              {ready.profileStatus ? ready.profileStatus.toLowerCase().replace("_", " ") : "Not started"}
            </p>
          </div>

          <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">AI Model Provider</span>
            <p className="mt-1 font-semibold text-zinc-900 text-sm">
              {ready.provider.configured ? `Gemini (${ready.provider.model})` : "Not configured"}
            </p>
          </div>

          <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Rate Limits</span>
            <p className="mt-1 font-semibold text-zinc-900 text-sm">
              {ready.limits.userPerMinute}/min · {ready.limits.businessPerHour}/hr
            </p>
          </div>

          <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Response Mode</span>
            <p className="mt-1 font-semibold text-zinc-900 text-sm">
              Owner approval required
            </p>
          </div>
        </div>

        {ready.blockers.length > 0 && (
          <Alert tone="info">
            <p className="font-semibold text-amber-950">Action items before full AI generation:</p>
            <ul className="mt-1.5 ml-4 list-disc text-xs space-y-0.5 text-amber-900">
              {ready.blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
            <div className="mt-2 flex gap-3 text-xs">
              <Link href={`${base}/profile`} className="font-semibold text-amber-900 underline">
                Open business profile →
              </Link>
              <Link href={`${base}/profile/permissions`} className="font-semibold text-amber-900 underline">
                Configure AI permissions →
              </Link>
            </div>
          </Alert>
        )}

        <p className="text-xs text-zinc-400 leading-relaxed">
          Draft generation is processed by the configured external AI provider (Google Gemini). Review provider terms before testing; this lab is designed for simulated, non-confidential test queries.
        </p>
      </section>

      {/* Start new simulation form */}
      {ready.canUse && <NewConversationForm businessId={businessId} />}

      {/* Test Conversations List */}
      <section aria-labelledby="convos" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="convos" className="text-sm font-semibold text-zinc-900">
            Test simulations <span className="font-normal text-zinc-500">({conversations.length})</span>
          </h2>
        </div>

        {conversations.length === 0 ? (
          <div className="card border-dashed p-8 text-center text-sm text-zinc-500">
            <p>No test simulations started yet.</p>
            <p className="mt-1 text-xs text-zinc-400">
              {ready.canUse ? "Create a simulation above to test how customer enquiries are answered." : "An owner or admin can start a new simulation."}
            </p>
          </div>
        ) : (
          <ul className="card divide-y divide-zinc-100 overflow-hidden">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${base}/lab/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-zinc-50/80 active:bg-zinc-100/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-zinc-900 truncate">{c.title ?? "Empty simulation"}</p>
                      <ConversationStatusBadge status={c.status} />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Customer: <strong className="font-medium text-zinc-700">{c.customerLabel}</strong> · {c.messageCount} messages · started by {c.createdByName} · {fmtDateTime(c.lastMessageAt)}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-brand-700 shrink-0">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
