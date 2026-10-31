import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Chip } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/card";
import { fmtDateTime } from "@/components/profile/format";
import { orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { listWhatsAppConversations } from "@/modules/whatsapp/service";

export default async function WhatsAppInboxPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const parsed = businessIdSchema.safeParse((await params).businessId);
  if (!parsed.success) notFound();
  const businessId = parsed.data;
  const { connection, conversations, queuedCount, providerDegraded } = await orNotFound(listWhatsAppConversations(user.id, businessId));
  const base = `/businesses/${businessId}/whatsapp`;

  return (
    <div className="space-y-6">
      <PageHeading
        title="WhatsApp inbox"
        lead="Live customer conversations connected via the official WhatsApp Cloud API. Messages are owner-controlled; no replies are sent without your explicit review and approval."
        actions={
          connection ? (
            <Chip tone="success" withDot>
              Connected: {connection.displayPhoneNumber}
            </Chip>
          ) : undefined
        }
      />

      {providerDegraded && (
        <Alert tone="info">
          Meta&apos;s messaging service has been unavailable since {fmtDateTime(providerDegraded.since)}.{" "}
          {queuedCount === 0
            ? "Sending may be delayed; no replies are currently queued."
            : `${queuedCount} approved ${queuedCount === 1 ? "reply is" : "replies are"} queued and will be sent automatically. Nothing is lost.`}
        </Alert>
      )}

      {!providerDegraded && queuedCount > 0 && (
        <Alert tone="info">
          {queuedCount} approved {queuedCount === 1 ? "reply is" : "replies are"} waiting to send (every attempt so far has been retried automatically).
        </Alert>
      )}

      {!connection ? (
        <section className="card space-y-3 border-dashed p-6 sm:p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div className="max-w-md mx-auto">
            <h2 className="font-semibold text-zinc-900 text-base">No WhatsApp number connected</h2>
            <p className="mt-1 text-xs sm:text-sm text-zinc-500">
              Connect your official WhatsApp Business number through Meta&apos;s Cloud API. Business owners can complete setup in Connection Settings.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href={`${base}/settings`}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-brand-700"
            >
              Open connection settings →
            </Link>
          </div>
        </section>
      ) : conversations.length === 0 ? (
        <div className="card border-dashed p-8 text-center text-sm text-zinc-500">
          No customer conversations yet. Inbound customer WhatsApp messages will appear here in real time.
        </div>
      ) : (
        <section aria-label="Customer conversations" className="card divide-y divide-zinc-100 overflow-hidden">
          {conversations.map((conversation) => (
            <Link
              key={conversation.id}
              href={`${base}/${conversation.id}`}
              className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-semibold text-zinc-900 text-sm">
                    {conversation.customerName ?? conversation.customerPhone}
                  </span>
                  <Chip tone={conversation.status === "ESCALATED" ? "danger" : "neutral"} withDot>
                    {conversation.status.toLowerCase()}
                  </Chip>
                  <Chip tone="brand">
                    {conversation.mode === "OWNER_ONLY" ? "Owner only" : "AI assist"}
                  </Chip>
                  {conversation.assignedTo && (
                    <Chip tone="neutral">
                      👤 {conversation.assignedTo.name}
                    </Chip>
                  )}
                </div>
                <p className="truncate text-xs sm:text-sm text-zinc-600">
                  {conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}{conversation.lastMessagePreview}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {conversation.customerPhone} · {conversation.messageCount} message{conversation.messageCount === 1 ? "" : "s"}
                  {connection.coexistence ? " · app coexistence" : ""}
                </p>
              </div>
              <time className="shrink-0 text-xs text-zinc-400">
                {fmtDateTime(conversation.lastMessageAt)}
              </time>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
