import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConversationStatusBadge, ResultBadge } from "@/components/lab/badges";
import { Composer } from "@/components/lab/composer";
import { ApproveDraftForm, FollowUpForm, RegenerateButton } from "@/components/lab/draft-controls";
import { ActionButton } from "@/components/profile/action-button";
import { fmtDateTime } from "@/components/profile/format";
import { Alert } from "@/components/ui/field";
import { orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getConversation, getLabReadiness } from "@/modules/lab/service";
import { SIMULATION_NOTICE } from "@/modules/lab/types";
import { deleteConversationAction, resolveAction } from "../actions";

const CONV_ID = /^[a-z0-9]{10,40}$/;

export default async function ConversationPage({ params }: { params: Promise<{ businessId: string; conversationId: string }> }) {
  const user = await requireUserForPage();
  const { businessId: rawBiz, conversationId: rawConv } = await params;
  const biz = businessIdSchema.safeParse(rawBiz);
  if (!biz.success || !CONV_ID.test(rawConv)) notFound();
  const businessId = biz.data;
  const [ready, data] = await Promise.all([
    orNotFound(getLabReadiness(user.id, businessId)),
    orNotFound(getConversation(user.id, businessId, rawConv)),
  ]);
  const { conversation: conv, messages, pendingFailure, latestDraftId } = data;
  const base = `/businesses/${businessId}/lab`;
  const resolved = conv.status === "RESOLVED";
  const mayDelete = ready.canDeleteAny || (ready.canUse && conv.createdById === user.id);
  const fields = { businessId, conversationId: conv.id };
  // Fresh per page render: a double-click or repeated submit re-sends the same key and is de-duplicated server-side.
  const sendKey = randomUUID();
  const retryKey = randomUUID();

  return (
    <div className="space-y-6">
      <Link href={base} className="text-sm underline">← All test conversations</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold">{conv.title ?? "New test conversation"}</h1>
          <p className="text-xs text-neutral-500">Simulated customer: {conv.customerLabel} · started by {conv.createdByName} · {fmtDateTime(conv.createdAt)}</p>
        </div>
        <ConversationStatusBadge status={conv.status} />
      </div>
      <Alert tone="info">{SIMULATION_NOTICE} Nothing in this conversation is delivered through WhatsApp or any other channel.</Alert>

      {conv.status === "ESCALATED" && (
        <section role="region" aria-label="Escalation" className="space-y-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <h2 className="font-medium">Needs human follow-up</h2>
          <p className="break-words">{conv.escalationReason}</p>
          {ready.canApprove ? (
            <ActionButton action={resolveAction} fields={fields} label="Mark escalation resolved" pendingLabel="Resolving…" confirm="Resolve this escalation and close the conversation?" />
          ) : (
            <p>Only an owner can resolve an escalation.</p>
          )}
        </section>
      )}
      {resolved && <Alert tone="success">This conversation is resolved and read-only.</Alert>}

      <ol aria-label="Transcript" className="space-y-3">
        {messages.length === 0 && <li className="rounded-md border border-dashed bg-white p-4 text-sm text-neutral-600">No messages yet. Type a simulated customer enquiry below.</li>}
        {messages.map((m) => {
          if (m.role === "CUSTOMER") {
            return (
              <li key={m.id} className="rounded-md border bg-neutral-100 p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-neutral-600">{conv.customerLabel} (simulated customer)</p>
                <p className="whitespace-pre-line break-words">{m.content}</p>
              </li>
            );
          }
          const isLatestDraft = m.id === latestDraftId;
          const border = m.draftState === "APPROVED" ? "border-green-300" : m.draftState === "DRAFT" ? "border-amber-300" : "border-neutral-200 opacity-70";
          return (
            <li key={m.id} className={`space-y-2 rounded-md border bg-white p-3 text-sm ${border}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-neutral-700">
                  {m.draftState === "APPROVED" ? "Approved reply (simulation)" : m.draftState === "DRAFT" ? "Draft — awaiting review" : "Replaced draft"}
                </span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5">{m.source === "RULES" ? "Rules-based (AI not used)" : "AI-generated"}</span>
                {m.resultStatus && <ResultBadge status={m.resultStatus} />}
                {m.edited && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-900">Edited before approval</span>}
              </div>
              <p className="whitespace-pre-line break-words">{m.draftState === "APPROVED" && m.approvedContent ? m.approvedContent : m.content}</p>
              <p className="text-xs text-neutral-600">{SIMULATION_NOTICE}</p>
              {m.edited && <details><summary className="cursor-pointer text-xs underline">Original AI draft</summary><p className="mt-1 whitespace-pre-line break-words text-xs">{m.content}</p></details>}
              {m.draftState === "APPROVED" && m.approvedByName && <p className="text-xs text-neutral-500">Approved by {m.approvedByName}{m.approvedAt ? ` · ${fmtDateTime(m.approvedAt)}` : ""}</p>}

              <details>
                <summary className="cursor-pointer text-xs underline">Basis for this draft</summary>
                <div className="mt-2 space-y-2 text-xs">
                  {m.reason && <p><span className="font-medium">Why: </span>{m.reason}</p>}
                  {m.missingInformation.length > 0 && (
                    <div><p className="font-medium">Missing information</p><ul className="ml-4 list-disc">{m.missingInformation.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  )}
                  {m.escalationReason && m.resultStatus !== "answerable" && <p><span className="font-medium">Escalation reason: </span>{m.escalationReason}</p>}
                  {m.evidence.length > 0 ? (
                    <div>
                      <p className="font-medium">Approved information used{m.profileRevision ? ` (profile revision ${m.profileRevision})` : ""}</p>
                      <ul className="space-y-1">
                        {m.evidence.map((e) => (
                          <li key={e.ref} className="rounded border bg-neutral-50 p-2"><p className="font-medium">{e.label}</p><p className="whitespace-pre-line break-words">{e.text}</p></li>
                        ))}
                      </ul>
                    </div>
                  ) : <p>No approved business information was used to write this reply.</p>}
                  {m.generation && (
                    <p className="text-neutral-500">
                      {m.generation.usedAi ? `Generated by ${m.generation.provider} ${m.generation.model}` : "No AI call was made"}
                      {m.generation.latencyMs !== null ? ` in ${(m.generation.latencyMs / 1000).toFixed(1)}s` : ""}
                      {m.generation.usedAi ? (m.generation.totalTokens !== null || m.generation.promptTokens !== null ? ` · tokens: ${m.generation.promptTokens ?? "?"} in / ${m.generation.completionTokens ?? "?"} out` : " · token usage not reported") : ""}
                    </p>
                  )}
                </div>
              </details>

              {m.draftState === "DRAFT" && isLatestDraft && !resolved && (
                <div className="space-y-3 border-t pt-3">
                  {ready.canApprove ? (
                    <ApproveDraftForm {...fields} messageId={m.id} draft={m.content} />
                  ) : (
                    <p className="text-xs text-neutral-600">Only an owner can approve a draft.</p>
                  )}
                  {ready.canUse && <RegenerateButton {...fields} idempotencyKey={retryKey} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {pendingFailure && !resolved && (
        <Alert>
          <p>{pendingFailure.message}</p>
          {ready.canUse && <div className="mt-2"><RegenerateButton {...fields} idempotencyKey={retryKey} label="Try again" /></div>}
        </Alert>
      )}

      {ready.canUse && !resolved && (
        <Composer businessId={businessId} conversationId={conv.id} idempotencyKey={sendKey} timeoutSeconds={Math.round(ready.limits.timeoutMs / 1000)} />
      )}
      {!ready.canUse && <p className="text-sm text-neutral-600">You can read this conversation. Owners and admins can add messages.</p>}

      {ready.canUse && !resolved && conv.status !== "ESCALATED" && <section className="rounded-md border bg-white p-4"><FollowUpForm {...fields} /></section>}

      {mayDelete && (
        <div className="border-t pt-4">
          <ActionButton action={deleteConversationAction} fields={fields} label="Delete this test conversation" variant="danger" pendingLabel="Deleting…"
            confirm="Delete this conversation and all its messages permanently?" />
        </div>
      )}
    </div>
  );
}
