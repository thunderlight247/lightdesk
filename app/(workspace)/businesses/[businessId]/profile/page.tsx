import Link from "next/link";
import { ActionButton } from "@/components/profile/action-button";
import { fmtDateTime } from "@/components/profile/format";
import { ProfileStatusBadge } from "@/components/profile/status-badge";
import { SuspendForm } from "@/components/profile/transition-form";
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
      <section className="space-y-3 rounded-md border border-dashed bg-white p-6 text-sm">
        <h1 className="text-xl font-semibold">Business profile</h1>
        <p className="text-neutral-600">
          The profile is the structured record of how this business works: facts, FAQs, policies, how LightDesk should speak, and what it may do.
          Nothing is filled in for you, and nothing is used until an owner approves it.
        </p>
        {view.caps.canEdit ? (
          <ActionButton action={createProfileAction} fields={{ businessId: view.businessId }} label="Start the profile" pendingLabel="Creating…" variant="primary" />
        ) : (
          <p>The profile has not been started. Ask an owner or admin to start it.</p>
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
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Business profile</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ProfileStatusBadge status={status} />
          <span className="text-sm text-neutral-600">{EXPLAIN[status]}</span>
        </div>
        {status === "SUSPENDED" && profile.statusReason && (
          <p className="mt-2 break-words text-sm">Reason: {profile.statusReason}</p>
        )}
        <p className="mt-1 text-xs text-neutral-500">
          Status last changed {fmtDateTime(profile.statusChangedAt)}
          {profile.statusChangedById && actors[profile.statusChangedById] ? ` by ${actors[profile.statusChangedById]}` : ""} · revision {profile.revision}
        </p>
      </div>

      <section aria-labelledby="lifecycle" className="space-y-3 rounded-md border bg-white p-4">
        <h2 id="lifecycle" className="font-medium">Lifecycle</h2>
        {evaluation.blocking.length > 0 && status !== "ACTIVE" && (
          <div>
            <p className="text-sm font-medium">Before this profile can be activated:</p>
            <ul className="ml-5 list-disc text-sm text-neutral-700">
              {evaluation.blocking.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {nextStatuses.includes("REVIEW_REQUIRED") && caps.canEdit && evaluation.pending.length > 0 && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "REVIEW_REQUIRED" }} label="Submit for owner review" />
          )}
          {status === "REVIEW_REQUIRED" && caps.canEdit && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "DRAFT" }} label="Return to draft" />
          )}
          {nextStatuses.includes("ACTIVE") && caps.canApprove && evaluation.canActivate && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "ACTIVE" }} variant="primary"
              label={status === "SUSPENDED" ? "Reactivate profile" : "Activate profile"} pendingLabel="Activating…"
              confirm="Activate this profile? Only approved information will be used." />
          )}
          {status === "SUSPENDED" && caps.canApprove && (
            <ActionButton action={changeStatusAction} fields={{ ...fields, to: "DRAFT" }} label="Move back to draft" />
          )}
        </div>
        {status === "ACTIVE" && caps.canApprove && <SuspendForm businessId={view.businessId} />}
        {!caps.canEdit && <p className="text-sm text-neutral-600">You can view the profile. Owners and admins can edit it; only owners can approve and activate.</p>}
        {caps.canEdit && !caps.canApprove && <p className="text-sm text-neutral-600">You can prepare drafts. Only an owner can approve changes, change AI permissions, or activate the profile.</p>}
      </section>

      <section aria-labelledby="checklist" className="space-y-3">
        <h2 id="checklist" className="font-medium">Checklist</h2>
        <p className="text-sm text-neutral-600">Required items must be approved before activation. Recommended items are optional — leave them empty if they don&apos;t apply or you don&apos;t know yet.</p>
        {[["Required", required], ["Recommended", recommended]].map(([title, items]) => (
          <div key={title as string}>
            <h3 className="mb-1 text-sm font-medium">{title as string}</h3>
            <ul className="divide-y rounded-md border bg-white text-sm">
              {(items as typeof required).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <Link href={`${base}/${c.section}`} className="underline">{c.label}</Link>
                  <span className={c.status === "approved" ? "text-green-800" : c.status === "pending" ? "text-amber-800" : "text-neutral-600"}>
                    {c.status === "approved" ? (c.changePending ? "Approved · change awaiting approval" : "Approved") : c.status === "pending" ? "Saved — not approved" : "Not provided"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {evaluation.conflicts.length > 0 && (
        <section aria-labelledby="conflicts" className="space-y-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <h2 id="conflicts" className="font-medium">Conflicting FAQ answers</h2>
          <p>LightDesk will not choose between these. Edit one, deactivate one, or delete one.</p>
          <ul className="ml-5 list-disc">{evaluation.conflicts.map((c) => <li key={c.faqIds.join()}>{c.question}</li>)}</ul>
          <Link href={`${base}/faq`} className="underline">Go to FAQs</Link>
        </section>
      )}

      <section aria-labelledby="pending" className="space-y-3">
        <h2 id="pending" className="font-medium">Awaiting approval ({evaluation.pending.length})</h2>
        {evaluation.pending.length === 0 ? (
          <p className="text-sm text-neutral-600">Nothing is waiting for approval.</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border bg-white text-sm">
              {evaluation.pending.map((p) => (
                <li key={`${p.kind}-${p.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="min-w-0 break-words">
                    <Link href={`${base}/${p.section}`} className="underline">{p.label}</Link>
                    <span className="ml-2 text-xs text-neutral-500">{p.neverApproved ? "new draft" : "change to approved value"}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {caps.canApprove && (
                      <ActionButton variant="primary" label="Approve" pendingLabel="Approving…"
                        action={p.kind === "entry" ? approveEntryAction : approveFaqAction}
                        fields={p.kind === "entry" ? { ...fields, entryId: p.id } : { ...fields, faqId: p.id }} />
                    )}
                    {(p.module === "PERMISSION" ? caps.canApprove : caps.canEdit) && (
                      <ActionButton label="Discard" action={p.kind === "entry" ? discardEntryAction : discardFaqAction}
                        fields={p.kind === "entry" ? { ...fields, entryId: p.id } : { ...fields, faqId: p.id }}
                        confirm="Discard this change?" />
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {caps.canApprove && evaluation.pending.length > 1 && (
              <ActionButton action={approveAllAction} fields={fields} label="Approve all pending" pendingLabel="Approving…" confirm="Approve every pending item? Items with conflicts will be skipped." />
            )}
          </>
        )}
      </section>
    </div>
  );
}
