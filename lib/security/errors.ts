export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_INVITATION";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", message, 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") {
    super("FORBIDDEN", message, 403);
  }
}
/** Also used when the caller is not a member: existence is not revealed. */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
  }
}
export class ValidationError extends AppError {
  constructor(
    message = "Invalid input",
    public readonly fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super("VALIDATION", message, 400);
  }
}
export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("CONFLICT", message, 409);
  }
}

export type InvitationFailureReason =
  | "not_found"
  | "expired"
  | "already_used"
  | "revoked"
  | "email_mismatch"
  | "business_inactive";

/** Message is deliberately generic; `reason` is for server logs and tests only. */
export class InvalidInvitationError extends AppError {
  constructor(public readonly reason: InvitationFailureReason) {
    super(
      "INVALID_INVITATION",
      "This invitation is invalid, has expired, or was issued to a different account",
      400,
    );
  }
}

/** Safe JSON error response for route handlers. Never leaks internals. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message };
    if (err instanceof ValidationError) error.fields = err.fieldErrors;
    return Response.json({ error }, { status: err.status, headers: { "Cache-Control": "no-store" } });
  }
  // Log the error class only: messages from DB drivers can contain data.
  console.error("[error] unexpected", err instanceof Error ? err.name : typeof err);
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
