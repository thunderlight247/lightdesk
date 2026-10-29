"use client";

import { useActionState } from "react";
import {
  approveEntryAction, clearEntryAction, discardEntryAction, saveEntryAction,
} from "@/app/(workspace)/businesses/[businessId]/profile/actions";
import { Button } from "@/components/ui/button";
import { Alert, Input, Select, Textarea } from "@/components/ui/field";
import { ActionButton } from "@/components/profile/action-button";
import { ItemBadge, type ItemState } from "@/components/profile/status-badge";
import type { ActionState } from "@/lib/validation/action-state";

export type FieldDefProps = {
  key: string;
  label: string;
  help: string;
  why: string;
  kind: "text" | "textarea" | "select" | "phone" | "email" | "toggle";
  options?: { value: string; label: string }[];
  maxLength: number;
  material: boolean;
};
export type EntryProps = { id: string; value: string; approvedValue: string | null; state: "DRAFT" | "APPROVED"; revision: number };
export type EntryPerms = { save: boolean; approve: boolean; discard: boolean; clear: boolean };

const show = (def: FieldDefProps, v: string) => def.options?.find((o) => o.value === v)?.label ?? v;

export function EntryField({
  businessId, def, entry, perms, platformNote, blockEnable, meta,
}: {
  businessId: string;
  def: FieldDefProps;
  entry: EntryProps | null;
  perms: EntryPerms;
  platformNote?: string | null;
  blockEnable?: boolean;
  meta?: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveEntryAction, {});
  const id = `field-${def.key}`;
  const rev = entry ? `${entry.id}-${entry.revision}` : "none"; // remount inputs when the stored value changes
  const status: ItemState = !entry ? "missing" : entry.state === "APPROVED" ? "approved" : entry.approvedValue !== null ? "change" : "draft";
  const isPending = !!entry && entry.state === "DRAFT";

  return (
    <section className="card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold tracking-tight text-zinc-900">
          {def.label}
        </label>
        <ItemBadge status={status} />
      </div>

      <div className="space-y-1 text-xs sm:text-sm text-zinc-600">
        <p id={`${id}-help`} className="leading-relaxed">{def.help}</p>
        <p className="text-zinc-400 text-xs italic">Why it matters: {def.why}</p>
      </div>

      {platformNote && <Alert tone="info">{platformNote}</Alert>}

      {status === "change" && entry && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs sm:text-sm">
          <p className="font-semibold text-amber-900">Currently approved in-force value:</p>
          <p className="mt-1 whitespace-pre-line break-words text-amber-950 font-mono bg-white/70 p-2 rounded-lg border border-amber-200/60">
            {show(def, entry.approvedValue!)}
          </p>
        </div>
      )}

      {perms.save ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="key" value={def.key} />
          {def.kind === "textarea" ? (
            <Textarea
              key={rev}
              id={id}
              name="value"
              rows={4}
              maxLength={def.maxLength}
              required
              defaultValue={entry?.value ?? ""}
              aria-describedby={`${id}-help`}
            />
          ) : def.kind === "select" || def.kind === "toggle" ? (
            <Select
              key={rev}
              id={id}
              name="value"
              required
              defaultValue={entry?.value ?? ""}
              aria-describedby={`${id}-help`}
            >
              <option value="" disabled>Choose…</option>
              {def.options?.map((o) => (
                <option key={o.value} value={o.value} disabled={blockEnable && o.value === "enabled"}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              key={rev}
              id={id}
              name="value"
              required
              maxLength={def.maxLength}
              defaultValue={entry?.value ?? ""}
              type={def.kind === "email" ? "email" : def.kind === "phone" ? "tel" : "text"}
              aria-describedby={`${id}-help`}
            />
          )}

          {state.fieldErrors?.value?.map((e) => (
            <p key={e} className="text-xs font-medium text-red-600">{e}</p>
          ))}
          {state.error && !state.fieldErrors?.value && <Alert>{state.error}</Alert>}
          {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

          <div className="pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3 text-sm">
          {entry ? (
            <p className="whitespace-pre-line break-words text-zinc-900">{show(def, entry.value)}</p>
          ) : (
            <p className="italic text-zinc-400">Not provided — LightDesk will treat this as unknown.</p>
          )}
        </div>
      )}

      {entry && (perms.approve || perms.discard || perms.clear) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          {isPending && perms.approve && (
            <ActionButton
              action={approveEntryAction}
              fields={{ businessId, entryId: entry.id }}
              label="Approve"
              pendingLabel="Approving…"
              variant="primary"
            />
          )}
          {isPending && perms.discard && (
            <ActionButton
              action={discardEntryAction}
              fields={{ businessId, entryId: entry.id }}
              label="Discard change"
              confirm={entry.approvedValue === null ? "Remove this draft?" : "Go back to the approved value?"}
            />
          )}
          {perms.clear && (
            <ActionButton
              action={clearEntryAction}
              fields={{ businessId, entryId: entry.id }}
              label="Clear"
              variant="danger"
              confirm="Mark this as not provided? LightDesk will treat it as unknown."
            />
          )}
        </div>
      )}

      {meta && <p className="text-xs text-zinc-400">{meta}</p>}
    </section>
  );
}
