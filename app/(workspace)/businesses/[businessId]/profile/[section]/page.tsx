import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/profile/action-button";
import { EntryField, type EntryProps } from "@/components/profile/entry-field";
import { FaqForm } from "@/components/profile/faq-form";
import { fmtDateTime } from "@/components/profile/format";
import { ItemBadge } from "@/components/profile/status-badge";
import { Alert } from "@/components/ui/field";
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
        The profile has not been started yet. <Link href={base} className="underline">Go to the profile overview</Link> to start it.
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
          <Alert>
            Conflicting answers exist for: {evaluation.conflicts.map((c) => `“${c.question}”`).join(", ")}. LightDesk will not choose between them — edit, deactivate or delete one.
          </Alert>
        )}
        {caps.canEdit && (
          <section className="rounded-md border bg-white p-4">
            <h2 className="mb-3 font-medium">Add a FAQ</h2>
            <FaqForm businessId={view.businessId} />
          </section>
        )}
        {faqs.length === 0 ? (
          <p className="rounded-md border border-dashed bg-white p-4 text-sm text-neutral-600">No FAQs yet. Nothing is assumed: LightDesk can only use answers you add and approve.</p>
        ) : (
          <ul className="space-y-3">
            {faqs.map((f) => {
              const inConflict = evaluation.conflicts.some((c) => c.faqIds.includes(f.id));
              const approved = f.approvedAt !== null;
              const status = f.state === "APPROVED" ? "approved" : approved ? "change" : "draft";
              const f2 = { businessId: view.businessId, faqId: f.id };
              return (
                <li key={f.id} className="rounded-md border bg-white p-4">
                  <details>
                    <summary className="cursor-pointer break-words font-medium">{f.question}</summary>
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <ItemBadge status={status} />
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5">{f.isActive ? "Active" : "Inactive"}</span>
                        {f.category && <span className="rounded-full bg-neutral-100 px-2.5 py-0.5">{f.category}</span>}
                        {inConflict && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-red-900">Conflicts with another entry</span>}
                      </div>
                      {status === "change" && (
                        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
                          <p className="font-medium">Approved wording still in use:</p>
                          <p className="break-words">{f.approvedQuestion}</p>
                          <p className="whitespace-pre-line break-words">{f.approvedAnswer}</p>
                        </div>
                      )}
                      {caps.canEdit ? (
                        <FaqForm businessId={view.businessId} faq={{ id: f.id, question: f.question, answer: f.answer, category: f.category, revision: f.revision }} />
                      ) : (
                        <p className="whitespace-pre-line break-words text-sm">{f.answer}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {f.state === "DRAFT" && caps.canApprove && <ActionButton variant="primary" label="Approve" pendingLabel="Approving…" action={approveFaqAction} fields={f2} />}
                        {f.state === "DRAFT" && caps.canEdit && <ActionButton label="Discard change" action={discardFaqAction} fields={f2} confirm="Discard this change?" />}
                        {caps.canEdit && <ActionButton label={f.isActive ? "Deactivate" : "Activate"} action={toggleFaqAction} fields={{ ...f2, active: String(!f.isActive) }} />}
                        {(approved ? caps.canApprove : caps.canEdit) && <ActionButton variant="danger" label="Delete" action={deleteFaqAction} fields={f2} confirm="Delete this FAQ permanently?" />}
                      </div>
                      <p className="text-xs text-neutral-500">
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
    );
  } else {
    const overview = sec.slug === "identity" ? await loadOverviewOrNotFound(user.id, businessId) : null;
    const byKey = new Map(entries.map((e) => [e.key, e]));
    body = (
      <div className="space-y-4">
        {overview && (
          <section className="rounded-md border bg-white p-4 text-sm">
            <h2 className="mb-2 font-medium">From business settings</h2>
            <dl className="space-y-1">
              <div><dt className="inline text-neutral-600">Name: </dt><dd className="inline break-words">{overview.business.name}</dd></div>
              <div><dt className="inline text-neutral-600">Location: </dt><dd className="inline break-words">{overview.business.location ?? "Not set"}</dd></div>
              <div><dt className="inline text-neutral-600">Description: </dt><dd className="inline break-words">{overview.business.description ?? "Not set"}</dd></div>
            </dl>
            <p className="mt-2 text-neutral-600">
              These are the single source of truth and are not repeated in the profile.{" "}
              {overview.capabilities.canUpdate && <Link href={`/businesses/${view.businessId}/settings`} className="underline">Edit in Settings</Link>}
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
      <div>
        <h1 className="mb-1 text-xl font-semibold">{sec.title}</h1>
        <p className="text-sm text-neutral-600">{sec.intro}</p>
        {!caps.canEdit && <p className="mt-1 text-sm text-neutral-600">You can view this section. Owners and admins can edit it.</p>}
      </div>
      {body}
      <div className="flex justify-between border-t pt-4 text-sm">
        {prev ? <Link href={`${base}/${prev.slug}`} className="underline">← {prev.title}</Link> : <Link href={base} className="underline">← Overview</Link>}
        {next ? <Link href={`${base}/${next.slug}`} className="underline">{next.title} →</Link> : <Link href={base} className="underline">Back to overview →</Link>}
      </div>
    </div>
  );
}
