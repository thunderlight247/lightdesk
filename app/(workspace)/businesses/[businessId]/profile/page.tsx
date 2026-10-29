import Link from "next/link";
import { ActionButton } from "@/components/profile/action-button";
import { fmtDateTime } from "@/components/profile/format";
import { ProfileStatusBadge } from "@/components/profile/status-badge";
import { SuspendForm } from "@/components/profile/transition-form";
import { Alert, Chip } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import { loadProfileViewOrNotFound, requireUserForPage } from "@/lib/auth/guards";
import type { ProfileStatusName } from "@/modules/business-profile/lifecycle";
import {
  approveAllAction, approveEntryAction, approveFaqAction, changeStatusAction, createProfileAction,
  discardEntryAction, discardFaqAction,
} from "./actions";

const EXPLAIN: Record<ProfileStatusName, string> = {
  DRAFT: "Being set up. Nothing in this profile is in use yet.",
  REVIEW_REQUIRED: "Submitted for the owner to review. Nothing in this profile is in use yet.",
  ACTIVE: "In use. Only approved information is ever used; drafts and pending changes are not.",
  SUSPENDED: "Suspended. LightDesk treats this profile as inactive until an owner reactivates it.",
};

export default async function ProfileOverviewPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const { businessId } = await params;
  const view = await loadProfileViewOrNotFound(user.id, businessId);
  const base = `/businesses/${view.businessId}/profile`;

  if (!view.exists) {
    return (
      <section className="card space-y-4 border-dashed p-6 sm:p-8 text-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Start Business Profile</h1>
          <p className="mt-1 text-zinc-600">
            The profile is the structured record of how this business works: facts, FAQs, policies, and AI permissions. Nothing is filled in for you, and nothing is used until an owner approves it.
          </p>
        </div>
        {view.caps.canEdit ? (
          <div className="pt-2">
            <ActionButton action={createProfileAction} fields={{ businessId: view.businessId }} label="Initialize business profile" pendingLabel="Creating…" variant="primary" />
          </div>
        ) : (
          <p className="text-zinc-500">The profile has not been started. Ask an owner or admin to start it.</p>
        )}
      </section>
    );
  }

  const { profile, evaluation, caps, actors, nextStatuses } = view;
  const status = profile.status as ProfileStatusName;
  const required = evaluation.checklist.filter((c) => c.level === "required");
  const recommended = evaluation.checklist.filter((c) => c.level === "recommended");
  const fields = { businessId: view.businessId };

  return (
    <div className="space-y-6">
      {/* Overview Status Banner */}
      <div className="card p-4 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">Business profile</h1>
            <p className="mt-1 text-xs text-zinc-500">
              Revision {profile.revision} · Status changed {fmtDateTime(profile.statusChangedAt)}
              {profile.statusChangedById && actors[profile.statusChangedById] ? ` by ${actors[profile.statusChangedById]}` : ""}
            </p>
          </div>
          <ProfileStatusBadge status={status} />
        </div>
        <p className="text-sm text-zinc-600 bg-zinc-50 rounded-xl p-3 border border-zinc-100">
          {EXPLAIN[status]}
        </p>
        {status === "SUSPENDED" && profile.statusReason && (
          <Alert tone="error">
            <span className="font-semibold">Suspension reason: </span>{profile.statusReason}
          </Alert>
        )}
      </div>

      {/* Lifecycle Actions */}
      <section aria-labelledby="lifecycle" className="card p-4 sm:p-6 space-y-4">
        <CardTitle title="Profile lifecycle" subtitle="Controls whether this profile is in draft mode, in review, or active in live simulations." />
        {evaluation.blocking.length > 0 && status !== "ACTIVE" && (
          <Alert tone="info">
            <p className="font-semibold text-amber-900">Before this profile can be activated:</p>
            <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-xs">
              {evaluation.blocking.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2.5">
          {nextStatuses.includes("REVIEW_REQUIRED") && caps.canEdit && evaluation.pending.length > 0 && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "REVIEW_REQUIRED" }} label="Submit for owner review" />
          )}
          {status === "REVIEW_REQUIRED" && caps.canEdit && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "DRAFT" }} label="Return to draft" />
          )}
          {nextStatuses.includes("ACTIVE") && caps.canApprove && evaluation.canActivate && (
            <ActionButton
              action={changeStatusAction}
              fields={{ ...fields, to: "ACTIVE" }}
              variant="primary"
              label={status === "SUSPENDED" ? "Reactivate profile" : "Activate profile"}
              pendingLabel="Activating…"
              confirm="Activate this profile? Only approved information will be used."
            />
          )}
          {status === "SUSPENDED" && caps.canApprove && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "DRAFT" }} label="Move back to draft" />
          )}
        </div>
        {status === "ACTIVE" && caps.canApprove && <SuspendForm businessId={view.businessId} />}
        {!caps.canEdit && (
          <p className="text-xs text-zinc-500">Read-only view. Owners and admins can edit; only owners can approve and activate.</p>
        )}
        {caps.canEdit && !caps.canApprove && (
          <p className="text-xs text-zinc-500">You can prepare drafts. Only an owner can approve changes, change AI permissions, or activate the profile.</p>
        )}
      </section>

      {/* Checklist Grid */}
      <section aria-labelledby="checklist" className="space-y-4">
        <div>
          <h2 id="checklist" className="text-base font-bold text-zinc-900">Readiness checklist</h2>
          <p className="text-xs text-zinc-500">
            Required items must be approved before profile activation. Recommended items enhance the assistant&apos;s answer fidelity.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {[["Required items", required], ["Recommended items", recommended]].map(([title, items]) => (
            <div key={title as string} className="card p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                  <h3 className="text-sm font-semibold text-zinc-900">{title as string}</h3>
                  <span className="text-xs text-zinc-400">
                    {(items as typeof required).filter((c) => c.status === "approved").length} of {(items as typeof required).length} complete
                  </span>
                </div>
                <ul className="divide-y divide-zinc-100 text-xs sm:text-sm mt-1">
                  {(items as typeof required).map((c) => {
                    const isApproved = c.status === "approved";
                    const isPending = c.status === "pending";
                    return (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                        <Link href={`${base}/${c.section}`} className="font-medium text-zinc-800 hover:text-brand-700 truncate">
                          {c.label}
                        </Link>
                        <Chip tone={isApproved ? "success" : isPending ? "warning" : "neutral"} withDot>
                          {isApproved ? (c.changePending ? "Approved (edit pending)" : "Approved") : isPending ? "Draft pending" : "Missing"}
                        </Chip>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Conflicts */}
      {evaluation.conflicts.length > 0 && (
        <section aria-labelledby="conflicts" className="card border-red-200 bg-red-50/70 p-4 sm:p-5 text-sm space-y-2">
          <h2 id="conflicts" className="font-semibold text-red-950">Conflicting FAQ answers detected</h2>
          <p className="text-red-900 text-xs">LightDesk will not choose between these conflicting answers. Edit, deactivate, or delete one:</p>
          <ul className="ml-5 list-disc text-xs text-red-900 space-y-0.5">
            {evaluation.conflicts.map((c) => <li key={c.faqIds.join()}>{c.question}</li>)}
          </ul>
          <div className="pt-1">
            <Link href={`${base}/faq`} className="text-xs font-semibold text-red-700 underline">
              Open FAQs to resolve conflicts →
            </Link>
          </div>
        </section>
      )}

      {/* Awaiting Approval */}
      <section aria-labelledby="pending" className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
          <CardTitle
            title={
              <span>
                Awaiting owner approval <span className="font-normal text-zinc-500">({evaluation.pending.length})</span>
              </span>
            }
            subtitle="Changes must be reviewed by the business owner before taking effect."
          />
        </div>

        {evaluation.pending.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-2">All items are up to date. Nothing is currently waiting for approval.</p>
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 text-xs sm:text-sm">
              {evaluation.pending.map((p) => (
                <li key={`${p.kind}-${p.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/${p.section}`} className="font-medium text-zinc-900 hover:text-brand-700">
                      {p.label}
                    </Link>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {p.neverApproved ? "New draft entry" : "Modification to approved entry"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {caps.canApprove && (
                      <ActionButton
                        variant="primary"
                        label="Approve"
                        pendingLabel="Approving…"
                        action={p.kind === "entry" ? approveEntryAction : approveFaqAction}
                        fields={p.kind === "entry" ? { ...fields, entryId: p.id } : { ...fields, faqId: p.id }}
                      />
                    )}
                    {(p.module === "PERMISSION" ? caps.canApprove : caps.canEdit) && (
                      <ActionButton
                        label="Discard"
                        action={p.kind === "entry" ? discardEntryAction : discardFaqAction}
                        fields={p.kind === "entry" ? { ...fields, entryId: p.id } : { ...fields, faqId: p.id }}
                        confirm="Discard this change?"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {caps.canApprove && evaluation.pending.length > 1 && (
              <div className="border-t border-zinc-100 pt-3">
                <ActionButton
                  action={approveAllAction}
                  fields={fields}
                  label="Approve all pending items"
                  pendingLabel="Approving…"
                  confirm="Approve every pending item? Items with conflicts will be skipped."
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
