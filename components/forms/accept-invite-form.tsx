"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "@/app/invite/[token]/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function AcceptInviteForm({ token, mode }: { token: string; mode: "join" | "register" }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(acceptInvitationAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />
      {mode === "register" && (
        <>
          <Field label="Your full name" errors={state.fieldErrors?.name}>
            <Input name="name" required maxLength={100} autoComplete="name" placeholder="e.g. Ama Mensah" />
          </Field>
          <Field label="Create password (12+ characters)" errors={state.fieldErrors?.password}>
            <Input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" placeholder="••••••••••••" />
          </Field>
        </>
      )}
      <div className="pt-2">
        <Button type="submit" disabled={pending} className="w-full" size="lg">
          {pending
            ? "Joining workspace…"
            : mode === "register"
            ? "Create account & join"
            : "Join business workspace"}
        </Button>
      </div>
    </form>
  );
}
