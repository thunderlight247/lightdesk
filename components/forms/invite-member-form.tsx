"use client";

import { useActionState } from "react";
import { createInvitationAction } from "@/app/(workspace)/businesses/[businessId]/members/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function InviteMemberForm({ businessId, roles }: { businessId: string; roles: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createInvitationAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.inviteLink && (
        <Alert tone="info">
          <p className="font-semibold text-amber-950">Invitation link created:</p>
          <p className="mt-0.5 text-xs text-amber-900">
            Copy this link now and send it privately. It is only shown once and cannot be recovered.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="block flex-1 break-all rounded-lg bg-white/80 p-2.5 font-mono text-xs border border-amber-200/80 text-amber-950">
              {state.inviteLink}
            </code>
          </div>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Member email address" errors={state.fieldErrors?.email}>
          <Input name="email" type="email" required placeholder="colleague@example.com" />
        </Field>
        <Field label="Assigned workspace role" errors={state.fieldErrors?.role}>
          <Select name="role" defaultValue="MEMBER">
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating link…" : "Generate invitation link"}
        </Button>
      </div>
    </form>
  );
}
