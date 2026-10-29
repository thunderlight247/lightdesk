"use client";

import { useActionState } from "react";
import { Alert, Chip, Input, Select } from "@/components/ui/field";
import { Button, GhostButton } from "@/components/ui/button";
import type { PilotOverviewRow } from "@/modules/pilot/service";
import { enrollInPilotAction, setPilotStatusAction } from "@/app/(workspace)/admin/pilot/actions";

const STATUS_LABEL: Record<string, string> = {
  PENDING_CONSENT: "Awaiting owner consent",
  ACTIVE: "Active",
  PAUSED: "Paused",
  EXITED: "Exited",
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
        <form action={enrollAction} className="card p-4 sm:p-5 flex flex-wrap items-end gap-3">
          <label className="text-sm min-w-[200px]">
            <span className="mb-1.5 block font-medium text-zinc-800">Enroll a business</span>
            <Select name="businessId" required>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </label>
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1.5 block font-medium text-zinc-800">Note (optional)</span>
            <Input name="note" maxLength={500} placeholder="Why this business, onboarding context" />
          </label>
          <div>
            <Button disabled={enrollPending}>{enrollPending ? "Enrolling…" : "Enroll business"}</Button>
          </div>
        </form>
      )}

      {overview.rows.length === 0 ? (
        <div className="card border-dashed p-8 text-center text-sm text-zinc-500">
          No businesses enrolled in the controlled pilot yet.
        </div>
      ) : (
        <ul className="card divide-y divide-zinc-100 overflow-hidden">
          {overview.rows.map((row) => (
            <li key={row.businessId} className="space-y-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-zinc-900 text-sm">{row.businessName}</span>
                <Chip
                  tone={
                    row.status === "ACTIVE"
                      ? "success"
                      : row.status === "EXITED"
                      ? "danger"
                      : "warning"
                  }
                  withDot
                >
                  {STATUS_LABEL[row.status]}
                </Chip>
              </div>

              <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600 border border-zinc-100 space-y-1">
                <p>
                  <strong className="text-zinc-800">Owner consent:</strong>{" "}
                  {row.consentAt ? row.consentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Not yet given"}
                </p>
                <p>
                  <strong className="text-zinc-800">AI calls today:</strong> {row.usage.aiCallsToday}
                  {row.caps ? ` / ${row.caps.aiCallsPerDay} cap` : " (unlimited)"} ·{" "}
                  <strong className="text-zinc-800">Outbound this month:</strong> {row.usage.outboundThisMonth}
                  {row.caps ? ` / ${row.caps.outboundPerMonth} cap` : " (unlimited)"}
                </p>
                <p className="text-zinc-500">
                  Open conversations: {row.usage.openConversations} · Escalated: {row.usage.escalated} · Failed sends: {row.usage.failedSends} · Feedback entries: {row.feedbackCount}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {row.status !== "PAUSED" && row.status !== "EXITED" && (
                  <form action={statusAction}>
                    <input type="hidden" name="businessId" value={row.businessId} />
                    <input type="hidden" name="action" value="pause" />
                    <GhostButton disabled={statusPending} variant="secondary">Pause</GhostButton>
                  </form>
                )}
                {row.status === "PAUSED" && (
                  <form action={statusAction}>
                    <input type="hidden" name="businessId" value={row.businessId} />
                    <input type="hidden" name="action" value="resume" />
                    <GhostButton disabled={statusPending} variant="secondary">Resume</GhostButton>
                  </form>
                )}
                {row.status !== "EXITED" && (
                  <form action={statusAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="businessId" value={row.businessId} />
                    <input type="hidden" name="action" value="exit" />
                    <Input name="reason" placeholder="Exit reason (optional)" className="w-48 py-1.5 text-xs" maxLength={200} />
                    <GhostButton disabled={statusPending} variant="danger">Exit pilot</GhostButton>
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
