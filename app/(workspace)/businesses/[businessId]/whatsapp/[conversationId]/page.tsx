import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Alert } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/card";
import { WhatsAppReplyForm } from "@/components/whatsapp/reply-form";
import { WhatsAppModeControls } from "@/components/whatsapp/mode-controls";
import { WhatsAppQueuedCancel } from "@/components/whatsapp/queued-cancel";
import { ConversationAssignee } from "@/components/whatsapp/conversation-assignee";
import { QuickRepliesBar } from "@/components/whatsapp/quick-replies-bar";
import { OrderCaptureCard } from "@/components/whatsapp/order-capture-card";
import { ReceiptInspector } from "@/components/whatsapp/receipt-inspector";
import { ConversationNotes } from "@/components/whatsapp/conversation-notes";
import { fmtDateTime } from "@/components/profile/format";
import { loadMembershipOrNotFound, orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getWhatsAppConversation } from "@/modules/whatsapp/service";
import { asEvidence, asStrings } from "@/modules/lab/pipeline";
import { can } from "@/modules/permissions/roles";
import { listMembers } from "@/modules/businesses/service";
import { listConversationNotes } from "@/modules/frontline/notes";
import { listOrderLeads } from "@/modules/frontline/orders";
import { listQuickReplies } from "@/modules/frontline/quick-replies";

const DRAFT_STATUS_TONE: Record<string, "success" | "brand" | "danger" | "neutral"> = {
  ANSWERABLE: "success",
  NEEDS_INFORMATION: "brand",
  CONFLICT_DETECTED: "danger",
  ESCALATION_REQUIRED: "danger",
};

export default async function WhatsAppConversationPage({ params }: { params: Promise<{ businessId: string; conversationId: string }> }) {
  const user = await requireUserForPage();
  const { businessId: rawBusinessId, conversationId } = await params;
  const parsed = businessIdSchema.safeParse(rawBusinessId);
  if (!parsed.success) notFound();
  const businessId = parsed.data;

  const [membership, view, members, notes, orders, quickReplies] = await Promise.all([
    loadMembershipOrNotFound(user.id, businessId),
    orNotFound(getWhatsAppConversation(user.id, businessId, conversationId)),
    listMembers(user.id, businessId).catch(() => []),
    listConversationNotes(user.id, businessId, conversationId).catch(() => []),
    listOrderLeads(user.id, businessId, { conversationId }).catch(() => []),
    listQuickReplies(user.id, businessId).catch(() => []),
  ]);

  const { conversation, readiness, latestDraft } = view;
  const maySend = can(membership.role, "whatsapp:send");
  const base = `/businesses/${businessId}/whatsapp`;
  const title = conversation.customerName ?? conversation.customerPhone;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p><Link className="text-sm font-medium text-brand-700 hover:text-brand-900 underline" href={base}>← WhatsApp inbox</Link></p>
        <ConversationAssignee
          businessId={businessId}
          conversationId={conversationId}
          currentAssigneeId={conversation.assignedToId}
          members={members}
        />
      </div>

      <PageHeading
        title={title}
        lead={
          conversation.customerName
            ? `${conversation.customerPhone}${conversation.assignedTo ? ` · Assigned to ${conversation.assignedTo.name}` : ""}`
            : conversation.assignedTo ? `Assigned to ${conversation.assignedTo.name}` : undefined
        }
        actions={
          <>
            <Chip tone={readiness.status === "ESCALATED" ? "danger" : "neutral"}>{readiness.status.toLowerCase()}</Chip>
            <Chip tone="brand">{readiness.mode === "OWNER_ONLY" ? "Owner only" : "AI assist"}</Chip>
          </>
        }
      />

      {conversation.escalationReason && <Alert tone="info">Human follow-up: {conversation.escalationReason}</Alert>}
      {readiness.providerDegraded && (
        <Alert tone="info">
          Meta&apos;s messaging service has been unavailable since {fmtDateTime(readiness.providerDegraded.since)}
          {" "}({readiness.providerDegraded.failures} failed send attempts). Approved replies are queued and will be sent automatically — nothing is lost.
        </Alert>
      )}

      {/* Messages Feed */}
      <section aria-label="Conversation messages" className="card space-y-3 p-4 sm:p-6">
        {conversation.messages.length === 0 ? <p className="text-sm text-zinc-600">No messages yet.</p> : conversation.messages.map((message) => {
          const isDraft = message.draftState === "DRAFT";
          const isSuperseded = message.draftState === "SUPERSEDED";
          const isQueued = message.status === "QUEUED" && !isDraft && !isSuperseded;
          return (
            <article key={message.id}
              className={`max-w-[90%] rounded-xl p-3 sm:max-w-[75%] ${message.direction === "INBOUND" ? "bg-zinc-100 text-zinc-900" : isDraft || isQueued ? "ml-auto border border-dashed border-brand-300 bg-brand-50 text-zinc-900" : "ml-auto bg-brand-50 text-zinc-900"}`}>
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
                {message.direction === "INBOUND"
                  ? (message.fromOwnerApp ? "Business app" : "Customer")
                  : isDraft
                    ? <><span>AI draft · not sent</span><Chip tone={DRAFT_STATUS_TONE[message.resultStatus ?? ""] ?? "neutral"}>{(message.resultStatus ?? "draft").toLowerCase().replace(/_/g, " ")}</Chip></>
                    : isSuperseded
                      ? <span>Superseded draft · not sent</span>
                      : isQueued
                        ? <><span>Approved reply · waiting to send</span><Chip tone="warning">queued</Chip></>
                        : <span>You</span>}
                {!isDraft && !isSuperseded && <span>· {message.type}{!isQueued && <span> · {message.status.toLowerCase()}</span>}</span>}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">{message.text ?? `[${message.type} message]`}</p>
              {isQueued && message.nextAttemptAt && (
                <p className="mt-1 text-xs text-zinc-600">Next send attempt: {fmtDateTime(message.nextAttemptAt)}{message.attempts > 0 ? ` · ${message.attempts} attempt${message.attempts === 1 ? "" : "s"} so far` : ""}</p>
              )}
              {message.errorInfo !== null && (typeof (message.errorInfo as { details?: unknown } | null)?.details === "string") && (
                <p className="mt-1 text-xs text-red-700">Delivery failure: {(message.errorInfo as { details?: unknown }).details as string}</p>
              )}
              {isQueued && maySend && (
                <div className="mt-2">
                  <WhatsAppQueuedCancel businessId={businessId} conversationId={conversationId} messageId={message.id} queuedAt={fmtDateTime(message.queuedAt ?? message.createdAt)} />
                </div>
              )}
              <time className="mt-2 block text-right text-[11px] text-zinc-500">{fmtDateTime(message.timestampSent ?? message.createdAt)}</time>
            </article>
          );
        })}
      </section>

      {/* Reply Surface with Quick Replies */}
      <section aria-labelledby="reply-heading" className="card space-y-4 p-4 sm:p-5">
        <h2 id="reply-heading" className="text-sm font-semibold text-zinc-900">{latestDraft ? "Review and send the AI draft" : "Send a reply"}</h2>
        {!maySend ? <Alert tone="info">This owner console is read-only for your role. A business owner or admin must send replies.</Alert> :
          readiness.status === "RESOLVED" ? <Alert tone="info">This conversation is resolved and sending is disabled.</Alert> : (
            <>
              {latestDraft && latestDraft.resultStatus !== "ANSWERABLE" && (
                <Alert tone={latestDraft.resultStatus === "ESCALATION_REQUIRED" ? "error" : "info"}>
                  {latestDraft.reason ?? "This draft needs your attention."}
                  {asStrings(latestDraft.missingInformation).length > 0 && (
                    <> Missing: {asStrings(latestDraft.missingInformation).join("; ")}.</>
                  )}
                </Alert>
              )}
              {readiness.queued && (
                <Alert tone="info">
                  {readiness.queued.count} approved {readiness.queued.count === 1 ? "reply is" : "replies are"} waiting to send above. Compose a new reply once it has sent, or cancel it from the queued message.
                </Alert>
              )}

              <QuickRepliesBar
                businessId={businessId}
                quickReplies={quickReplies}
              />

              <WhatsAppReplyForm
                businessId={businessId}
                conversationId={conversationId}
                enabled={readiness.windowOpen && !readiness.queued}
                draft={latestDraft ? { text: latestDraft.text ?? "", source: latestDraft.source, reason: latestDraft.reason, evidenceCount: asEvidence(latestDraft.evidence).length } : null}
              />
            </>
          )}

        <div className="pt-2 border-t border-zinc-100">
          <dl className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
            <div>
              <span>Customer window: </span>
              <Chip tone={readiness.windowOpen ? "success" : "danger"}>{readiness.windowOpen ? "Open" : "Closed"}</Chip>
            </div>
            <div>
              <span>Monthly free tier: </span>
              <span>{readiness.meterFree} remaining ({readiness.meterUsed} used)</span>
            </div>
          </dl>
        </div>
      </section>

      {/* Frontline Suite: Orders & Verification, Team Notes & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <OrderCaptureCard
            businessId={businessId}
            conversationId={conversationId}
            defaultCustomerName={conversation.customerName ?? ""}
            defaultCustomerPhone={conversation.customerPhone}
            existingOrders={orders.map((o) => ({
              ...o,
              totalGhs: Number(o.totalGhs),
            }))}
          />

          <ReceiptInspector
            businessId={businessId}
            conversationId={conversationId}
          />
        </div>

        <div className="space-y-6">
          <ConversationNotes
            businessId={businessId}
            conversationId={conversationId}
            currentUserId={user.id}
            notes={notes}
          />

          <section aria-labelledby="control-heading" className="card space-y-3 p-4 sm:p-5">
            <h2 id="control-heading" className="text-sm font-semibold text-zinc-900">Conversation Mode</h2>
            {maySend && readiness.status !== "RESOLVED"
              ? <WhatsAppModeControls businessId={businessId} conversationId={conversationId} mode={readiness.mode as "OWNER_ONLY" | "AI_ASSIST"} />
              : readiness.status === "RESOLVED" ? <Alert tone="info">This conversation is resolved.</Alert> :
                <Alert tone="info">Changing AI assistance is an owner/admin action.</Alert>}
          </section>
        </div>
      </div>
    </div>
  );
}
