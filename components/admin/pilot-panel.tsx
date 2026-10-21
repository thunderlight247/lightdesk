"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/field";
import { Button, GhostButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { PilotOverviewRow } from "@/modules/pilot/service";
import { enrollInPilotAction, setPilotStatusAction } from "@/app/(workspace)/admin/pilot/actions";

const STATUS_LABEL: Record<string, string> = {
  PENDING_CONSENT: "awaiting owner consent",
  ACTIVE: "active",
  PAUSED: "paused",
  EXITED: "exited",
};

export function AdminPilotPanel({
  overview,
  candidates,
}: {
  overview: { rows: PilotOverviewRow[]; recentFeedback: { id: string; businessName: string; category: string; comment: string; createdAt: Date }[] };
  candidates: { id: string; name: string }[];
}) {
  const [enrollState, enrollAction, enrollPending] = useActionState(enrollInPilotAction, {});
  const [statusState, statusAction, statusPending] = useActionState(setPilotStatusAction, {});

  return (
    <div className="space-y-6">
      {(enrollState.error || statusState.error) && <Alert tone="error">{enrollState.error ?? statusState.error}</Alert>}
      {(enrollState.message || statusState.message) && <Alert tone="success">{enrollState.message ?? statusState.message}</Alert>}

      {candidates.length > 0 && (
        <form action={enrollAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-800">Enroll a business</span>
            <select name="businessId" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" required>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block font-medium text-zinc-800">Note (optional)</span>
            <Input name="note" maxLength={500} placeholder="why this business, who arranged it" />
          </label>
          <Button disabled={enrollPending}>{enrollPending ? "Enrolling…" : "Enroll"}</Button>
        </form>
      )}

      {overview.rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No businesses enrolled yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-white text-sm">
          {overview.rows.map((row) => (
            <li key={row.businessId} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-zinc-900">{row.businessName}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    row.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : row.status === "EXITED" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"
                  }`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Consent: {row.consentAt ? row.consentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "not yet given"} ·
                {" "}AI today: {row.usage.aiCallsToday}{row.caps ? ` / ${row.caps.aiCallsPerDay} cap` : " (no cap)"} ·
                {" "}Outbound this month: {row.usage.outboundThisMonth}{row.caps ? ` / ${row.caps.outboundPerMonth} cap` : " (no cap)"} ·
                {" "}Open: {row.usage.openConversations} · Escalated: {row.usage.escalated} · Failed sends: {row.usage.failedSends} ·
                {" "}Feedback: {row.feedbackCount}
              </p>
              <div className="flex flex-wrap gap-2">
                {row.status !== "PAUSED" && row.status !== "EXITED" && (
                  <form action={statusAction}>
                    <input type="hidden" name="businessId" value={row.businessId} />
                    <input type="hidden" name="action" value="pause" />
                    <GhostButton disabled={statusPending}>Pause</GhostButton>
                  </form>
                )}
                {row.status === "PAUSED" && (
                  <form action={statusAction}>
                    <input type="hidden" name="businessId" value={row.businessId} />
                    <input type="hidden" name="action" value="resume" />
                    <GhostButton disabled={statusPending}>Resume</GhostButton>
                  </form>
                )}
                {row.status !== "EXITED" && (
                  <form action={statusAction} className="flex items-center gap-2">
                    <input type="hidden" name="businessId" value={row.businessId} />
                    <input type="hidden" name="action" value="exit" />
                    <input name="reason" placeholder="exit reason (optional)" className="w-48 rounded-md border border-zinc-300 px-2 py-1 text-xs" maxLength={200} />
                    <GhostButton disabled={statusPending}>Exit pilot</GhostButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
