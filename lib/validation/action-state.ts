import { AppError, ValidationError } from "@/lib/security/errors";

export type ActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Development invitation delivery: shown once, never stored. */
  inviteLink?: string;
};

export function actionError(err: unknown): ActionState {
  if (err instanceof ValidationError) return { error: err.message, fieldErrors: err.fieldErrors };
  if (err instanceof AppError) return { error: err.message };
  console.error("[action] unexpected", err instanceof Error ? err.name : typeof err);
  return { error: "Something went wrong. Please try again." };
}
