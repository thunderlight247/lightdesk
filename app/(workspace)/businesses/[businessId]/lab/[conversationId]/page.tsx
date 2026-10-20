import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConversationStatusBadge, ResultBadge } from "@/components/lab/badges";
import { Composer } from "@/components/lab/composer";
import { ApproveDraftForm, FollowUpForm, RegenerateButton } from "@/components/lab/draft-controls";
import { ActionButton } from "@/components/profile/action-button";
import { fmtDateTime } from "@/components/profile/format";
import { Alert, Chip } from "@/components/ui/field";
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
      <Link href={base} className="inline-flex text-sm text-zinc-600 transition-colors hover:text-zinc-900" aria-label="Back to all test conversations">
        ← All test conversations
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold tracking-tight text-zinc-900">{conv.title ?? "New test conversation"}</h1>
          <p className="text-xs text-zinc-500">Simulated customer: {conv.customerLabel} · started by {conv.createdByName} · {fmtDateTime(conv.createdAt)}</p>
        </div>
        <ConversationStatusBadge status={conv.status} />
      </div>
      <Alert tone="info">{SIMULATION_NOTICE} Nothing in this conversation is delivered through WhatsApp or any other channel.</Alert>

      {conv.status === "ESCALATED" && (
        <section role="region" aria-label="Escalation" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
          <h2 className="text-sm font-semibold text-red-900">Needs human follow-up</h2>
          <p className="mt-1 break-words">{conv.escalationReason}</p>
          {ready.canApprove ? (
            <div className="mt-3">
              <ActionButton action={resolveAction} fields={fields} label="Mark escalation resolved" pendingLabel="Resolving…" confirm="Resolve this escalation and close the conversation?" />
            </div>
          ) : (
            <p className="mt-2 text-xs">Only an owner can resolve an escalation.</p>
          )}
        </section>
      )}
      {resolved && <Alert tone="success">This conversation is resolved and read-only.</Alert>}

      <ol aria-label="Transcript" className="space-y-4">
        {messages.length === 0 && <li className="card border-dashed p-5 text-center text-sm text-zinc-600">No messages yet. Type a simulated customer enquiry below.</li>}
        {messages.map((m) => {
          if (m.role === "CUSTOMER") {
            return (
              <li key={m.id} className="flex gap-3">
                <span aria-hidden className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600">
                  {conv.customerLabel.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs font-medium text-zinc-500">{conv.customerLabel} (simulated customer)</p>
                  <p className="whitespace-pre-line break-words rounded-2xl rounded-tl-md bg-zinc-100 px-4 py-2.5 text-sm">
                    {m.content}
                  </p>
                </div>
              </li>
            );
          }
          const isLatestDraft = m.id === latestDraftId;
          const ring =
            m.draftState === "APPROVED" ? "border-emerald-300 bg-emerald-50/40"
            : m.draftState === "DRAFT" ? "border-amber-300 bg-amber-50/40"
            : "border-zinc-200 bg-white opacity-70";
          const stateLabel =
            m.draftState === "APPROVED" ? "Approved reply (simulation)"
            : m.draftState === "DRAFT" ? "Draft — awaiting your review"
            : "Replaced draft";
          return (
            <li key={m.id} className={`space-y-3 rounded-xl border p-4 text-sm shadow-sm ${ring}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-zinc-800">{stateLabel}</span>
                <Chip tone={m.source === "RULES" ? "neutral" : "brand"}>
                  {m.source === "RULES" ? "Rules-based (AI not used)" : "AI-generated"}
                </Chip>
                {m.resultStatus && <ResultBadge status={m.resultStatus} />}
                {m.edited && <Chip tone="sky">Edited before approval</Chip>}
              </div>
              <p className="whitespace-pre-line break-words rounded-2xl rounded-tr-md border border-zinc-200 bg-white px-4 py-2.5">
                {m.draftState === "APPROVED" && m.approvedContent ? m.approvedContent : m.content}
              </p>
              <p className="text-xs text-zinc-500">{SIMULATION_NOTICE}</p>
              {m.edited && (
                <details>
                  <summary className="cursor-pointer text-xs text-zinc-600 underline underline-offset-2">Original AI draft</summary>
                  <p className="mt-1 whitespace-pre-line break-words rounded-lg bg-zinc-100 px-3 py-2 text-xs">{m.content}</p>
                </details>
              )}
              {m.draftState === "APPROVED" && m.approvedByName && (
                <p className="text-xs text-zinc-500">Approved by {m.approvedByName}{m.approvedAt ? ` · ${fmtDateTime(m.approvedAt)}` : ""}</p>
              )}

              <details>
                <summary className="cursor-pointer text-xs text-zinc-600 underline underline-offset-2">Basis for this draft</summary>
                <div className="mt-2 space-y-2 rounded-lg bg-white/80 p-3 text-xs">
                  {m.reason && <p><span className="font-semibold">Why: </span>{m.reason}</p>}
                  {m.missingInformation.length > 0 && (
                    <div><p className="font-semibold">Missing information</p><ul className="ml-4 list-disc">{m.missingInformation.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  )}
                  {m.escalationReason && m.resultStatus !== "answerable" && <p><span className="font-semibold">Escalation reason: </span>{m.escalationReason}</p>}
                  {m.evidence.length > 0 ? (
                    <div>
                      <p className="font-semibold">Approved information used{m.profileRevision ? ` (profile revision ${m.profileRevision})` : ""}</p>
                      <ul className="mt-1 space-y-1">
                        {m.evidence.map((e) => (
                          <li key={e.ref} className="rounded-lg border border-zinc-200 bg-zinc-50 p-2"><p className="font-medium">{e.label}</p><p className="whitespace-pre-line break-words">{e.text}</p></li>
                        ))}
                      </ul>
                    </div>
                  ) : <p>No approved business information was used to write this reply.</p>}
                  {m.generation && (
                    <p className="text-zinc-500">
                      {m.generation.usedAi ? `Generated by ${m.generation.provider} ${m.generation.model}` : "No AI call was made"}
                      {m.generation.latencyMs !== null ? ` in ${(m.generation.latencyMs / 1000).toFixed(1)}s` : ""}
                      {m.generation.usedAi ? (m.generation.totalTokens !== null || m.generation.promptTokens !== null ? ` · tokens: ${m.generation.promptTokens ?? "?"} in / ${m.generation.completionTokens ?? "?"} out` : " · token usage not reported") : ""}
                    </p>
                  )}
                </div>
              </details>

              {m.draftState === "DRAFT" && isLatestDraft && !resolved && (
                <div className="space-y-3 rounded-lg border-t border-dashed border-zinc-300 pt-3">
                  {ready.canApprove ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Review &amp; approve</p>
                      <ApproveDraftForm {...fields} messageId={m.id} draft={m.content} />
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600">Only an owner can approve a draft.</p>
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
      {!ready.canUse && <p className="text-sm text-zinc-600">You can read this conversation. Owners and admins can add messages.</p>}

      {ready.canUse && !resolved && conv.status !== "ESCALATED" && (
        <section className="card p-4 sm:p-5">
          <p className="mb-3 text-sm font-semibold text-zinc-900">Escalate manually</p>
          <FollowUpForm {...fields} />
        </section>
      )}

      {mayDelete && (
        <div className="flex justify-end border-t border-zinc-200 pt-4">
          <ActionButton action={deleteConversationAction} fields={fields} label="Delete this test conversation" variant="danger" pendingLabel="Deleting…"
            confirm="Delete this conversation and all its messages permanently?" />
        </div>
      )}
    </div>
  );
}
