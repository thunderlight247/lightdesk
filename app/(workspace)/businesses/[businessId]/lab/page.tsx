import Link from "next/link";
import { NewConversationForm } from "@/components/lab/new-conversation-form";
import { ConversationStatusBadge } from "@/components/lab/badges";
import { fmtDateTime } from "@/components/profile/format";
import { Alert } from "@/components/ui/field";
import { businessIdSchema } from "@/lib/validation/schemas";
import { notFound } from "next/navigation";
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
      <div>
        <h1 className="mb-1 text-xl font-semibold">Conversation lab</h1>
        <p className="text-sm text-neutral-600">
          Try fictional customer enquiries and see how LightDesk would draft a reply from your <em>approved</em> business profile.
          {" "}{SIMULATION_NOTICE} Nothing is delivered through WhatsApp or any other channel.
        </p>
      </div>

      <section aria-labelledby="readiness" className="space-y-2 rounded-md border bg-white p-4 text-sm">
        <h2 id="readiness" className="font-medium">Readiness</h2>
        <dl className="grid gap-1 sm:grid-cols-2">
          <div><dt className="inline text-neutral-600">Business profile: </dt><dd className="inline">{ready.profileStatus ? ready.profileStatus.toLowerCase().replace("_", " ") : "not started"}</dd></div>
          <div><dt className="inline text-neutral-600">AI provider: </dt><dd className="inline">{ready.provider.configured ? `Gemini (${ready.provider.model})` : "not configured"}</dd></div>
          <div><dt className="inline text-neutral-600">AI drafting: </dt><dd className="inline">{ready.aiReady ? "ready" : "limited"}</dd></div>
          <div><dt className="inline text-neutral-600">Your limits: </dt><dd className="inline">{ready.limits.userPerMinute} drafts/min, {ready.limits.businessPerHour}/hour per business</dd></div>
        </dl>
        {ready.blockers.length > 0 && (
          <Alert tone="info">
            <ul className="ml-4 list-disc">{ready.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            <p className="mt-1">
              <Link href={`${base}/profile`} className="underline">Open the business profile</Link>
              {" · "}
              <Link href={`${base}/profile/permissions`} className="underline">AI permissions</Link>
            </p>
          </Alert>
        )}
        <p className="text-xs text-neutral-600">
          Draft requests are processed by the configured external AI provider (Google Gemini). Review the provider&apos;s data-handling terms before
          using any real customer information; this lab is for fictional or anonymised test data only.
        </p>
      </section>

      {ready.canUse && <NewConversationForm businessId={businessId} />}

      <section aria-labelledby="convos" className="space-y-3">
        <h2 id="convos" className="font-medium">Test conversations ({conversations.length})</h2>
        {conversations.length === 0 ? (
          <p className="rounded-md border border-dashed bg-white p-4 text-sm text-neutral-600">
            No test conversations yet.{ready.canUse ? " Start one above to see how a reply would be drafted." : " An owner or admin can start one."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border bg-white text-sm">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link href={`${base}/lab/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-neutral-50">
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{c.title ?? "Empty conversation"}</span>
                    <span className="ml-2 text-xs text-neutral-500">{c.customerLabel} · {c.messageCount} messages · by {c.createdByName} · {fmtDateTime(c.lastMessageAt)}</span>
                  </span>
                  <ConversationStatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
