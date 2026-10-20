import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Alert } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/card";
import { WhatsAppReplyForm } from "@/components/whatsapp/reply-form";
import { fmtDateTime } from "@/components/profile/format";
import { loadMembershipOrNotFound, orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getWhatsAppConversation } from "@/modules/whatsapp/service";
import { can } from "@/modules/permissions/roles";

export default async function WhatsAppConversationPage({ params }: { params: Promise<{ businessId: string; conversationId: string }> }) {
  const user = await requireUserForPage();
  const { businessId: rawBusinessId, conversationId } = await params;
  const parsed = businessIdSchema.safeParse(rawBusinessId);
  if (!parsed.success) notFound();
  const businessId = parsed.data;
  const [membership, view] = await Promise.all([
    loadMembershipOrNotFound(user.id, businessId),
    orNotFound(getWhatsAppConversation(user.id, businessId, conversationId)),
  ]);
  const { conversation, readiness } = view;
  const maySend = can(membership.role, "whatsapp:send");
  const base = `/businesses/${businessId}/whatsapp`;
  const title = conversation.customerName ?? conversation.customerPhone;

  return (
    <div className="space-y-6">
      <p><Link className="text-sm text-brand-700 underline" href={base}>← WhatsApp inbox</Link></p>
      <PageHeading title={title} lead={conversation.customerPhone} actions={
        <><Chip tone={readiness.status === "ESCALATED" ? "danger" : "neutral"}>{readiness.status.toLowerCase()}</Chip><Chip tone="brand">Owner controlled</Chip></>
      } />
      {conversation.escalationReason && <Alert tone="info">Human follow-up: {conversation.escalationReason}</Alert>}

      <section aria-label="Conversation messages" className="card space-y-3 p-4 sm:p-6">
        {conversation.messages.length === 0 ? <p className="text-sm text-zinc-600">No messages yet.</p> : conversation.messages.map((message) => (
          <article key={message.id} className={`max-w-[90%] rounded-xl p-3 sm:max-w-[75%] ${message.direction === "INBOUND" ? "bg-zinc-100 text-zinc-900" : "ml-auto bg-brand-50 text-zinc-900"}`}>
            <p className="mb-1 text-xs font-medium text-zinc-500">{message.direction === "INBOUND" ? (message.fromOwnerApp ? "Business app" : "Customer") : "You"} · {message.type} · {message.status.toLowerCase()}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{message.text ?? `[${message.type} message]`}</p>
            <time className="mt-2 block text-right text-[11px] text-zinc-500">{fmtDateTime(message.timestampSent ?? message.createdAt)}</time>
          </article>
        ))}
      </section>

      <section aria-labelledby="send-status" className="card space-y-3 p-4 sm:p-5">
        <h2 id="send-status" className="text-sm font-semibold text-zinc-900">Reply status</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="inline text-zinc-500">Customer service window: </dt><dd className="inline"><Chip tone={readiness.windowOpen ? "success" : "danger"}>{readiness.windowOpen ? "Open" : "Closed"}</Chip></dd></div>
          <div><dt className="inline text-zinc-500">Free service messages this month: </dt><dd className="inline">{readiness.meterFree} remaining ({readiness.meterUsed} used)</dd></div>
          {readiness.windowClosesAt && <div className="sm:col-span-2"><dt className="inline text-zinc-500">Window closes: </dt><dd className="inline">{fmtDateTime(readiness.windowClosesAt)}</dd></div>}
        </dl>
        {!readiness.windowOpen && <Alert tone="info">The 24-hour customer service window is closed. Wait for the customer to message again, or reply from the WhatsApp Business app.</Alert>}
        {readiness.meterFree === 0 && <Alert tone="info">The 1,000-message free service tier has been used this month. Meta may charge for additional messages; confirm billing before sending.</Alert>}
      </section>

      <section aria-labelledby="reply-heading" className="card space-y-3 p-4 sm:p-5">
        <h2 id="reply-heading" className="text-sm font-semibold text-zinc-900">Send a reply</h2>
        {!maySend ? <Alert tone="info">This owner console is read-only for your role. A business owner or admin must send replies.</Alert> :
          readiness.status === "RESOLVED" ? <Alert tone="info">This conversation is resolved and sending is disabled.</Alert> :
            <WhatsAppReplyForm businessId={businessId} conversationId={conversationId} enabled={readiness.windowOpen} />}
      </section>
    </div>
  );
}
