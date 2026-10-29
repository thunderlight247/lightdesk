"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email address">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••••••"
        />
      </Field>
      <div className="pt-2">
        <Button type="submit" disabled={pending} className="w-full" size="lg">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </div>
    </form>
  );
}
