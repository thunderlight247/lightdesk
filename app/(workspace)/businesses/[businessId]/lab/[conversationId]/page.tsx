import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConversationStatusBadge, ResultBadge } from "@/components/lab/badges";
import { Composer } from "@/components/lab/composer";
import { ApproveDraftForm, FollowUpForm, RegenerateButton } from "@/components/lab/draft-controls";
import { ActionButton } from "@/components/profile/action-button";
import { fmtDateTime } from "@/components/profile/format";
import { Alert, Chip } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import { orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getConversation, getLabReadiness } from "@/modules/lab/service";
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
      {/* Top Header */}
      <div className="flex flex-col gap-3">
        <Link
          href={base}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
          aria-label="Back to all test conversations"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to all test conversations
        </Link>

        <div className="card p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-lg sm:text-xl font-bold tracking-tight text-zinc-900">
                {conv.title ?? "New test conversation"}
              </h1>
              <p className="mt-1 text-xs text-zinc-500">
                Test customer: <strong className="font-semibold text-zinc-700">{conv.customerLabel}</strong> · started by {conv.createdByName} · {fmtDateTime(conv.createdAt)}
              </p>
            </div>
            <ConversationStatusBadge status={conv.status} />
          </div>

          <Alert tone="info">
            <span className="font-semibold">Test mode: </span>nothing in this conversation is delivered to WhatsApp or any customer.
          </Alert>
        </div>
      </div>

      {/* Escalation alert */}
      {conv.status === "ESCALATED" && (
        <section role="region" aria-label="Escalation" className="card border-red-200 bg-red-50/80 p-4 sm:p-5 text-sm space-y-3">
          <div className="flex items-center gap-2 text-red-950 font-bold">
            <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2>Human follow-up required</h2>
          </div>
          <p className="break-words text-xs sm:text-sm text-red-900 bg-white/70 p-3 rounded-xl border border-red-200/60 font-mono">
            {conv.escalationReason}
          </p>
          {ready.canApprove ? (
            <div className="pt-1">
              <ActionButton
                action={resolveAction}
                fields={fields}
                label="Mark escalation resolved"
                pendingLabel="Resolving…"
                variant="primary"
                confirm="Resolve this escalation and close the conversation?"
              />
            </div>
          ) : (
            <p className="text-xs text-red-800">Only an owner can resolve an escalation.</p>
          )}
        </section>
      )}

      {resolved && (
        <Alert tone="success">This conversation is resolved and read-only.</Alert>
      )}

      {/* Messages Transcript */}
      <ol aria-label="Transcript" className="space-y-4">
        {messages.length === 0 && (
          <li className="card border-dashed p-8 text-center text-sm text-zinc-500">
            No messages yet. Type a test customer enquiry below to start testing.
          </li>
        )}

        {messages.map((m) => {
          if (m.role === "CUSTOMER") {
            const customerInitial = conv.customerLabel.trim().charAt(0).toUpperCase() || "C";
            return (
              <li key={m.id} className="flex items-start gap-3 max-w-2xl">
                <span
                  aria-hidden
                  className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700 shadow-2xs"
                >
                  {customerInitial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-zinc-700">{conv.customerLabel}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400">Customer</span>
                  </div>
                  <div className="rounded-2xl rounded-tl-xs bg-zinc-100/90 px-4 py-3 text-sm text-zinc-900 shadow-2xs">
                    <p className="whitespace-pre-line break-words leading-relaxed">{m.content}</p>
                  </div>
                </div>
              </li>
            );
          }

          const isLatestDraft = m.id === latestDraftId;
          const isApproved = m.draftState === "APPROVED";
          const isDraft = m.draftState === "DRAFT";

          const cardBorder =
            isApproved
              ? "border-emerald-200/90 bg-emerald-50/20"
              : isDraft
              ? "border-amber-200/90 bg-amber-50/20"
              : "border-zinc-200/80 bg-white opacity-85";

          const stateLabel =
            isApproved ? "Approved reply"
            : isDraft ? "Draft — awaiting your review"
            : "Superseded draft";

          return (
            <li key={m.id} className={`card p-4 sm:p-5 space-y-3 transition-shadow ${cardBorder}`}>
              {/* Draft Status Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={isApproved ? "success" : isDraft ? "warning" : "neutral"} withDot>
                    {stateLabel}
                  </Chip>
                  <Chip tone={m.source === "RULES" ? "neutral" : "brand"}>
                    {m.source === "RULES" ? "Rules-based" : "AI-generated"}
                  </Chip>
                  {m.resultStatus && <ResultBadge status={m.resultStatus} />}
                  {m.edited && <Chip tone="sky">Edited by reviewer</Chip>}
                </div>
                <span className="text-xs text-zinc-400">LightDesk Assistant</span>
              </div>

              {/* Message Content Bubble */}
              <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 text-sm text-zinc-900 shadow-2xs">
                <p className="whitespace-pre-line break-words leading-relaxed font-sans">
                  {isApproved && m.approvedContent ? m.approvedContent : m.content}
                </p>
              </div>

              {m.edited && (
                <details className="text-xs text-zinc-600">
                  <summary className="cursor-pointer font-medium text-brand-700 hover:text-brand-800 underline underline-offset-2">
                    View original AI-generated draft
                  </summary>
                  <div className="mt-2 rounded-xl bg-zinc-50 border border-zinc-200/60 p-3">
                    <p className="whitespace-pre-line break-words text-zinc-700">{m.content}</p>
                  </div>
                </details>
              )}

              {isApproved && m.approvedByName && (
                <p className="text-xs text-emerald-800">
                  ✓ Approved by {m.approvedByName}{m.approvedAt ? ` · ${fmtDateTime(m.approvedAt)}` : ""}
                </p>
              )}

              {/* Collapsible Basis Accordion */}
              <details className="group rounded-xl border border-zinc-200/70 bg-zinc-50/50 p-3 text-xs">
                <summary className="cursor-pointer select-none font-medium text-zinc-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Inspection: Basis for this response
                  </span>
                  <span className="text-zinc-400 group-open:rotate-180 transition-transform">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </summary>

                <div className="mt-3 space-y-3 pt-3 border-t border-zinc-200/60 text-zinc-700">
                  {m.reason && (
                    <div className="rounded-lg bg-white p-2.5 border border-zinc-200/60">
                      <p className="font-semibold text-zinc-900">Reasoning:</p>
                      <p className="mt-0.5 leading-relaxed">{m.reason}</p>
                    </div>
                  )}

                  {m.missingInformation.length > 0 && (
                    <div className="rounded-lg bg-amber-50 p-2.5 border border-amber-200/60">
                      <p className="font-semibold text-amber-900">Missing information:</p>
                      <ul className="mt-1 ml-4 list-disc space-y-0.5 text-amber-950">
                        {m.missingInformation.map((x) => <li key={x}>{x}</li>)}
                      </ul>
                    </div>
                  )}

                  {m.escalationReason && m.resultStatus !== "answerable" && (
                    <div className="rounded-lg bg-red-50 p-2.5 border border-red-200/60">
                      <p className="font-semibold text-red-900">Escalation reason:</p>
                      <p className="mt-0.5 text-red-950">{m.escalationReason}</p>
                    </div>
                  )}

                  {m.evidence.length > 0 ? (
                    <div>
                      <p className="font-semibold text-zinc-900 mb-1.5">
                        Approved information citations{m.profileRevision ? ` (profile revision ${m.profileRevision})` : ""}:
                      </p>
                      <ul className="space-y-1.5">
                        {m.evidence.map((e) => (
                          <li key={e.ref} className="rounded-lg border border-zinc-200/80 bg-white p-2.5">
                            <p className="font-semibold text-zinc-800 text-[11px]">{e.label}</p>
                            <p className="whitespace-pre-line break-words text-zinc-600 mt-0.5 leading-relaxed">{e.text}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="italic text-zinc-500">No approved business facts were cited for this response.</p>
                  )}

                  {m.generation && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-200/60 text-[11px] text-zinc-500">
                      <span>{m.generation.usedAi ? `Provider: ${m.generation.provider} (${m.generation.model})` : "Rules execution"}</span>
                      {m.generation.latencyMs !== null && <span>· Latency: {(m.generation.latencyMs / 1000).toFixed(2)}s</span>}
                      {m.generation.usedAi && (m.generation.totalTokens !== null || m.generation.promptTokens !== null) && (
                        <span>· Tokens: {m.generation.promptTokens ?? "?"} in / {m.generation.completionTokens ?? "?"} out</span>
                      )}
                    </div>
                  )}
                </div>
              </details>

              {/* Review & Approve Controls */}
              {isDraft && isLatestDraft && !resolved && (
                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 pt-3">
                  {ready.canApprove ? (
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-900">
                        Owner Review &amp; Approval
                      </p>
                      <ApproveDraftForm {...fields} messageId={m.id} draft={m.content} />
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600">Only an owner can approve a draft reply.</p>
                  )}
                  {ready.canUse && (
                    <div className="pt-2 border-t border-amber-200/60">
                      <RegenerateButton {...fields} idempotencyKey={retryKey} />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Failure retry */}
      {pendingFailure && !resolved && (
        <Alert tone="error">
          <p className="font-medium">{pendingFailure.message}</p>
          {ready.canUse && (
            <div className="mt-2.5">
              <RegenerateButton {...fields} idempotencyKey={retryKey} label="Retry draft generation" />
            </div>
          )}
        </Alert>
      )}

      {/* Message Composer */}
      {ready.canUse && !resolved && (
        <Composer
          businessId={businessId}
          conversationId={conv.id}
          idempotencyKey={sendKey}
          timeoutSeconds={Math.round(ready.limits.timeoutMs / 1000)}
        />
      )}
      {!ready.canUse && (
        <p className="text-xs text-zinc-500 text-center py-2">
          Read-only view. Owners and administrators can add messages.
        </p>
      )}

      {/* Manual Escalation */}
      {ready.canUse && !resolved && conv.status !== "ESCALATED" && (
        <section className="card p-4 sm:p-5">
          <CardTitle
            title="Manual escalation"
            subtitle="Flag this conversation if human attention is required outside automated testing."
          />
          <FollowUpForm {...fields} />
        </section>
      )}

      {/* Delete Option */}
      {mayDelete && (
        <div className="flex justify-end border-t border-zinc-200/80 pt-4">
          <ActionButton
            action={deleteConversationAction}
            fields={fields}
            label="Delete this test conversation"
            variant="danger"
            pendingLabel="Deleting…"
            confirm="Delete this conversation and all its messages permanently?"
          />
        </div>
      )}
    </div>
  );
}
