import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/profile/action-button";
import { EntryField, type EntryProps } from "@/components/profile/entry-field";
import { FaqForm } from "@/components/profile/faq-form";
import { fmtDateTime } from "@/components/profile/format";
import { ItemBadge } from "@/components/profile/status-badge";
import { Alert, Chip } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import { loadOverviewOrNotFound, loadProfileViewOrNotFound, requireUserForPage } from "@/lib/auth/guards";
import { CatalogueSectionView } from "@/components/catalogue/catalogue-section-view";
import { detectPriceConflicts, listCatalogueItems } from "@/modules/catalogue/service";
import { defsForModule, SECTIONS } from "@/modules/business-profile/catalog";
import { PLATFORM_POLICY, isCapability } from "@/modules/permissions/platform-policy";
import {
  approveFaqAction, deleteFaqAction, discardFaqAction, toggleFaqAction,
} from "../actions";

export default async function ProfileSectionPage({ params }: { params: Promise<{ businessId: string; section: string }> }) {
  const user = await requireUserForPage();
  const { businessId, section } = await params;
  const index = SECTIONS.findIndex((s) => s.slug === section);
  if (index < 0) notFound();
  const sec = SECTIONS[index];
  const view = await loadProfileViewOrNotFound(user.id, businessId);
  const base = `/businesses/${view.businessId}/profile`;

  if (!view.exists) {
    return (
      <Alert tone="info">
        The profile has not been started yet.{" "}
        <Link href={base} className="font-semibold underline">
          Go to the profile overview
        </Link>{" "}
        to start it.
      </Alert>
    );
  }
  const { caps, actors, entries, faqs, evaluation } = view;
  const prev = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];
  const who = (id: string | null | undefined) => (id ? actors[id] ?? "a former member" : null);

  let body: React.ReactNode;
  if (sec.slug === "catalogue") {
    const [items, conflicts] = await Promise.all([
      listCatalogueItems(user.id, businessId),
      detectPriceConflicts(user.id, businessId),
    ]);
    body = (
      <CatalogueSectionView
        businessId={view.businessId}
        items={items.map((i) => ({
          ...i,
          priceGhs: Number(i.priceGhs),
          approvedPriceGhs: i.approvedPriceGhs ? Number(i.approvedPriceGhs) : null,
        }))}
        conflicts={conflicts}
        canEdit={caps.canEdit}
        canApprove={caps.canApprove}
      />
    );
  } else if (sec.slug === "faq") {
    body = (
      <div className="space-y-6">
        {evaluation.conflicts.length > 0 && (
          <Alert tone="error">
            <p className="font-semibold">Conflicting answers detected:</p>
            <p className="mt-1">
              Conflicts found for: {evaluation.conflicts.map((c) => `“${c.question}”`).join(", ")}. LightDesk will not choose between them — edit, deactivate or delete one.
            </p>
          </Alert>
        )}

        {caps.canEdit && (
          <section className="card p-4 sm:p-5">
            <CardTitle title="Add a question & answer" subtitle="Draft questions and approved answers for customer enquiries." />
            <FaqForm businessId={view.businessId} />
          </section>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">
              Frequently asked questions <span className="font-normal text-zinc-500">({faqs.length})</span>
            </h2>
            <span className="text-xs text-zinc-500">
              LightDesk only uses approved answers.
            </span>
          </div>

          {faqs.length === 0 ? (
            <p className="card border-dashed p-6 text-center text-sm text-zinc-600">
              No FAQs yet. Nothing is assumed: LightDesk can only use answers you add and approve.
            </p>
          ) : (
            <ul className="space-y-3">
              {faqs.map((f) => {
                const inConflict = evaluation.conflicts.some((c) => c.faqIds.includes(f.id));
                const approved = f.approvedAt !== null;
                const status = f.state === "APPROVED" ? "approved" : approved ? "change" : "draft";
                const f2 = { businessId: view.businessId, faqId: f.id };
                return (
                  <li key={f.id} className="card p-4 sm:p-5 transition-shadow">
                    <details className="group">
                      <summary className="cursor-pointer select-none list-none flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-zinc-900 group-hover:text-brand-700">
                            {f.question}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <ItemBadge status={status} />
                            <Chip tone={f.isActive ? "success" : "neutral"}>
                              {f.isActive ? "Active" : "Inactive"}
                            </Chip>
                            {f.category && <Chip tone="neutral">{f.category}</Chip>}
                            {inConflict && <Chip tone="danger">Conflict detected</Chip>}
                          </div>
                        </div>
                        <span className="shrink-0 text-zinc-400 group-open:rotate-180 transition-transform">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </summary>

                      <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4">
                        {status === "change" && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
                            <p className="font-semibold text-amber-900">Approved wording currently in force:</p>
                            <p className="mt-1 font-medium text-zinc-900">{f.approvedQuestion}</p>
                            <p className="mt-1 whitespace-pre-line break-words text-zinc-700 bg-white/70 p-2.5 rounded-lg border border-amber-200/60 font-mono text-xs">
                              {f.approvedAnswer}
                            </p>
                          </div>
                        )}

                        {caps.canEdit ? (
                          <FaqForm
                            businessId={view.businessId}
                            faq={{ id: f.id, question: f.question, answer: f.answer, category: f.category, revision: f.revision }}
                          />
                        ) : (
                          <div className="rounded-xl bg-zinc-50 p-3 text-sm">
                            <p className="whitespace-pre-line break-words text-zinc-800">{f.answer}</p>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-2">
                          {f.state === "DRAFT" && caps.canApprove && (
                            <ActionButton variant="primary" label="Approve" pendingLabel="Approving…" action={approveFaqAction} fields={f2} />
                          )}
                          {f.state === "DRAFT" && caps.canEdit && (
                            <ActionButton label="Discard change" action={discardFaqAction} fields={f2} confirm="Discard this change?" />
                          )}
                          {caps.canEdit && (
                            <ActionButton
                              label={f.isActive ? "Deactivate" : "Activate"}
                              action={toggleFaqAction}
                              fields={{ ...f2, active: String(!f.isActive) }}
                            />
                          )}
                          {(approved ? caps.canApprove : caps.canEdit) && (
                            <ActionButton
                              variant="danger"
                              label="Delete"
                              action={deleteFaqAction}
                              fields={f2}
                              confirm="Delete this FAQ permanently?"
                            />
                          )}
                        </div>

                        <p className="text-xs text-zinc-400">
                          Last changed {fmtDateTime(f.updatedAt)} by {who(f.updatedById)}
                          {approved && f.approvedAt ? ` · approved ${fmtDateTime(f.approvedAt)} by ${who(f.approvedById)}` : " · not yet approved"}
                        </p>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  } else {
    const overview = sec.slug === "identity" ? await loadOverviewOrNotFound(user.id, businessId) : null;
    const byKey = new Map(entries.map((e) => [e.key, e]));
    body = (
      <div className="space-y-4">
        {overview && (
          <section className="card p-4 sm:p-5 text-sm space-y-3">
            <h2 className="font-semibold text-zinc-900">From business settings</h2>
            <dl className="grid gap-2 sm:grid-cols-3 rounded-xl bg-zinc-50 p-3 border border-zinc-100">
              <div>
                <dt className="text-xs text-zinc-500">Business name</dt>
                <dd className="mt-0.5 font-medium text-zinc-900 break-words">{overview.business.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Location</dt>
                <dd className="mt-0.5 font-medium text-zinc-900 break-words">{overview.business.location ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Description</dt>
                <dd className="mt-0.5 font-medium text-zinc-900 break-words">{overview.business.description ?? "Not set"}</dd>
              </div>
            </dl>
            <p className="text-xs text-zinc-500">
              These settings are the single source of truth and are not duplicated in the profile.{" "}
              {overview.capabilities.canUpdate && (
                <Link href={`/businesses/${view.businessId}/settings`} className="font-medium text-brand-700 underline">
                  Edit in Settings →
                </Link>
              )}
            </p>
          </section>
        )}

        {sec.slug === "permissions" && (
          <Alert tone="info">
            Everything here starts disabled. Only the owner can change these, a change stays a draft until approved, and the platform can forbid a capability regardless of your choice.
            Nothing here sends or answers anything yet.
          </Alert>
        )}

        {defsForModule(sec.module!).map((def) => {
          const e = byKey.get(def.key);
          const entry: EntryProps | null = e ? { id: e.id, value: e.value, approvedValue: e.approvedValue, state: e.state, revision: e.revision } : null;
          const isPerm = def.module === "PERMISSION";
          const blocked = isPerm && isCapability(def.key) && !PLATFORM_POLICY[def.key].allowed;
          const meta = e
            ? `Last changed ${fmtDateTime(e.updatedAt)} by ${who(e.updatedById)}${e.approvedAt ? ` · approved ${fmtDateTime(e.approvedAt)} by ${who(e.approvedById)}` : " · not yet approved"}`
            : null;
          return (
            <EntryField
              key={def.key}
              businessId={view.businessId}
              def={{ key: def.key, label: def.label, help: def.help, why: def.why, kind: def.kind, options: def.options ? [...def.options] : undefined, maxLength: def.maxLength, material: def.material }}
              entry={entry}
              meta={meta}
              blockEnable={blocked}
              platformNote={blocked && isCapability(def.key) ? `Platform restriction: ${PLATFORM_POLICY[def.key].note ?? "not permitted."} This cannot be enabled by the business.` : null}
              perms={{
                save: isPerm ? caps.canApprove : caps.canEdit,
                approve: caps.canApprove,
                discard: isPerm ? caps.canApprove : caps.canEdit,
                clear: !!e && (e.approvedValue !== null || isPerm ? caps.canApprove : caps.canEdit),
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">{sec.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">{sec.intro}</p>
          {!caps.canEdit && (
            <p className="mt-1.5 text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md inline-block">
              Read-only view. Owners and admins can edit this section.
            </p>
          )}
        </div>
      </div>

      {body}

      {/* Navigation Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 pt-6">
        {prev ? (
          <Link
            href={`${base}/${prev.slug}`}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-zinc-700 shadow-xs hover:border-zinc-300 hover:bg-zinc-50"
          >
            ← {prev.title}
          </Link>
        ) : (
          <Link
            href={base}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-zinc-700 shadow-xs hover:border-zinc-300 hover:bg-zinc-50"
          >
            ← Overview
          </Link>
        )}

        {next ? (
          <Link
            href={`${base}/${next.slug}`}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs sm:text-sm font-medium text-white shadow-xs hover:bg-zinc-800"
          >
            {next.title} →
          </Link>
        ) : (
          <Link
            href={base}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-xs sm:text-sm font-medium text-white shadow-xs hover:bg-brand-700"
          >
            Back to overview →
          </Link>
        )}
      </div>
    </div>
  );
}
