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
        lead="Live customer conversations connected through the official WhatsApp Cloud API. New conversations are owner-controlled; nothing is sent automatically."
        actions={connection ? <Chip tone="success">Connected · {connection.displayPhoneNumber}</Chip> : undefined}
      />

      {providerDegraded && (
        <Alert tone="info">
          Meta&apos;s messaging service has been unavailable since {fmtDateTime(providerDegraded.since)}.{" "}
          {queuedCount === 0
            ? "Sending may be slow; no replies are waiting."
            : `${queuedCount} approved ${queuedCount === 1 ? "reply is" : "replies are"} queued and will be sent automatically. Nothing is lost.`}
        </Alert>
      )}

      {!providerDegraded && queuedCount > 0 && (
        <Alert tone="info">
          {queuedCount} approved {queuedCount === 1 ? "reply is" : "replies are"} waiting to send (every attempt so far has been retried automatically).
        </Alert>
      )}

      {!connection ? (
        <section className="card space-y-2 border-dashed p-5">
          <h2 className="font-semibold text-zinc-900">No WhatsApp number connected</h2>
          <p className="text-sm text-zinc-600">Connect your business&apos;s own WhatsApp number through Meta&apos;s official Cloud API — owners can do it from the connection settings; otherwise ask your platform administrator.</p>
          <Link href={`${base}/settings`} className="inline-block text-sm text-brand-700 underline">Open connection settings →</Link>
        </section>
      ) : conversations.length === 0 ? (
        <p className="card border-dashed p-6 text-center text-sm text-zinc-600">No customer conversations yet. New WhatsApp messages will appear here.</p>
      ) : (
        <section aria-label="Customer conversations" className="card divide-y divide-zinc-100">
          {conversations.map((conversation) => (
            <Link key={conversation.id} href={`${base}/${conversation.id}`} className="flex flex-wrap items-start justify-between gap-3 p-4 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-900">{conversation.customerName ?? conversation.customerPhone}</span>
                  <Chip tone={conversation.status === "ESCALATED" ? "danger" : "neutral"}>{conversation.status.toLowerCase()}</Chip>
                  <Chip tone="brand">{conversation.mode === "OWNER_ONLY" ? "Owner only" : "AI assist"}</Chip>
                </span>
                <span className="mt-1 block truncate text-sm text-zinc-600">{conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}{conversation.lastMessagePreview}</span>
                <span className="mt-1 block text-xs text-zinc-500">{conversation.customerPhone} · {conversation.messageCount} messages{connection.coexistence ? " · app coexistence" : ""}</span>
              </span>
              <time className="shrink-0 text-xs text-zinc-500">{fmtDateTime(conversation.lastMessageAt)}</time>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
