"use client";

import { useActionState } from "react";
import { createInvitationAction } from "@/app/(workspace)/businesses/[businessId]/members/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function InviteMemberForm({ businessId, roles }: { businessId: string; roles: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createInvitationAction, {});
  return (
    <form action={action} className="space-y-4 rounded-md border bg-white p-4">
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.inviteLink && (
        <Alert tone="info">
          <p className="mb-1 font-medium">Invitation created. No email was sent — email delivery is not operational in this milestone.</p>
          <p className="mb-1">Copy this link now and send it privately. It is shown once and cannot be recovered.</p>
          <code className="block break-all rounded bg-white p-2">{state.inviteLink}</code>
        </Alert>
      )}
      <Field label="Email" errors={state.fieldErrors?.email}>
        <Input name="email" type="email" required />
      </Field>
      <Field label="Role" errors={state.fieldErrors?.role}>
        <Select name="role" defaultValue="MEMBER">
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>Create invitation</Button>
    </form>
  );
}
