"use client";

import { useActionState } from "react";
import { Alert, Input, Select } from "@/components/ui/field";
import { Button, GhostButton } from "@/components/ui/button";
import type { PilotStatusView } from "@/modules/pilot/service";
import {
  consentToPilotAction,
  leavePilotAction,
  submitPilotFeedbackAction,
  updateUsageCapsAction,
} from "@/app/(workspace)/businesses/[businessId]/whatsapp/settings/pilot/actions";

const STATUS_LABEL: Record<string, string> = {
  PENDING_CONSENT: "awaiting your consent",
  ACTIVE: "active",
  PAUSED: "paused by the platform",
  EXITED: "ended",
};

export function PilotPanel({
  businessId,
  status,
  canControl,
}: {
  businessId: string;
  status: PilotStatusView;
  canControl: boolean;
}) {
  const [consentState, consentAction, consentPending] = useActionState(consentToPilotAction, {});
  const [leaveState, leaveAction, leavePending] = useActionState(leavePilotAction, {});
  const [capsState, capsAction, capsPending] = useActionState(updateUsageCapsAction, {});
  const [fbState, fbAction, fbPending] = useActionState(submitPilotFeedbackAction, {});

  const err = consentState.error ?? leaveState.error ?? capsState.error ?? fbState.error;
  const msg = consentState.message ?? leaveState.message ?? capsState.message ?? fbState.message;

  return (
    <section aria-labelledby="pilot-heading" className="card space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pilot-heading" className="text-sm font-semibold text-zinc-900">Controlled pilot</h2>
        <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800">
          {status.enrolled ? STATUS_LABEL[status.status ?? ""] ?? status.status : "not enrolled"}
        </span>
      </div>

      {err && <Alert tone="error">{err}</Alert>}
      {msg && <Alert tone="success">{msg}</Alert>}

      {!status.enrolled && (
        <p className="text-sm text-zinc-600">
          This business is not part of the LightDesk controlled pilot yet. Ask the platform team for an invitation.
        </p>
      )}

      {status.enrolled && status.status === "PENDING_CONSENT" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">
            LightDesk runs a controlled pilot for this business. Read the terms below; accepting them activates
            AI-assisted drafting and the send gate for your conversations, each bounded by hard usage caps.
          </p>
          <blockquote className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700">
            {status.consentText}
          </blockquote>
          {canControl ? (
            <form action={consentAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="accepted" value="yes" />
              <Button disabled={consentPending}>{consentPending ? "Activating…" : "I am the owner and I accept"}</Button>
            </form>
          ) : (
            <p className="text-xs text-zinc-500">Only the business owner can accept the pilot terms.</p>
          )}
        </div>
      )}

      {status.enrolled && status.status === "ACTIVE" && (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Consented {status.consentAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""} UTC · terms {status.consentTextVersion}
          </p>
          <p className="text-sm text-zinc-700">
            Hard limits today: <strong>{status.usage.aiCallsToday}</strong> AI drafts drafted
            {status.caps ? <> of {status.caps.aiCallsPerDay}</> : " (no cap)"}, <strong>{status.usage.outboundThisMonth}</strong> messages sent
            {status.caps ? <> of {status.caps.outboundPerMonth}</> : " (no cap)"} this month. Anything sent still requires a person&apos;s explicit approval — automatic sending is not possible at any stage of the pilot.
          </p>

          {canControl && (
            <form action={capsAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="businessId" value={businessId} />
              <label className="text-sm">
                <span className="mb-1 block font-medium text-zinc-800">AI drafts per day</span>
                <Input name="aiCallsPerDay" type="number" min={0} defaultValue={status.caps?.aiCallsPerDay ?? 0} className="w-32" required />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-zinc-800">Outbound per month</span>
                <Input name="outboundPerMonth" type="number" min={0} defaultValue={status.caps?.outboundPerMonth ?? 0} className="w-32" required />
              </label>
              <Button disabled={capsPending}>{capsPending ? "Saving…" : "Update caps"}</Button>
            </form>
          )}

          {canControl && (
            <form action={leaveAction}>
              <input type="hidden" name="businessId" value={businessId} />
              <GhostButton disabled={leavePending}>{leavePending ? "Leaving…" : "Leave the pilot"}</GhostButton>
            </form>
          )}
        </div>
      )}

      {status.enrolled && status.status === "EXITED" && (
        <p className="text-sm text-zinc-600">This pilot enrollment has ended. AI assist stays off until the platform re-invites the business.</p>
      )}

      {status.enrolled && (
        <form action={fbAction} className="space-y-3 border-t border-zinc-100 pt-4">
          <p className="text-sm font-medium text-zinc-800">Send feedback to the LightDesk team</p>
          <input type="hidden" name="businessId" value={businessId} />
          <Select name="category" required defaultValue="worked_well">
            <option value="worked_well">Something worked well</option>
            <option value="wrong_answer">The AI gave a wrong answer</option>
            <option value="missed_escalation">Something should have escalated</option>
            <option value="confusing">Something was confusing</option>
            <option value="other">Something else</option>
          </Select>
          <textarea
            name="comment"
            required
            maxLength={1000}
            rows={3}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="What happened? Be as specific as you like — this goes to the LightDesk team, never into the AI."
          />
          <Button disabled={fbPending}>{fbPending ? "Sending…" : "Send feedback"}</Button>
        </form>
      )}
    </section>
  );
}
