import { z } from "zod";
import { TOKEN_PATTERN } from "@/lib/security/tokens";
import { ValidationError } from "@/lib/security/errors";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");
export const nameSchema = z.string().trim().min(1, "Required").max(100);
export const businessIdSchema = z.string().regex(/^[a-z0-9]{10,40}$/, "Invalid id");
export const inviteTokenSchema = z.string().regex(TOKEN_PATTERN, "Invalid token");
export const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const createInvitationSchema = z.object({ email: emailSchema, role: roleSchema });
export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  ownerEmail: emailSchema,
});
const noControlChars = /^[^\u0000-\u001f\u007f]*$/;
// description may contain tabs and line breaks, but no other control characters
const noControlCharsMultiline = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const emptyToNull = (v: string): string | null => (v === "" ? null : v);

/**
 * Editable business identity fields. Every field is optional (omitted = leave unchanged;
 * empty string on description/location = clear). `.strict()` rejects anything else, so
 * slug, status, id and similar can never be set through this path.
 */
export const updateBusinessSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Use at least 2 characters")
      .max(100, "Use at most 100 characters")
      .regex(noControlChars, "Contains invalid characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, "Use at most 500 characters")
      .regex(noControlCharsMultiline, "Contains invalid characters")
      .transform(emptyToNull)
      .optional(),
    location: z
      .string()
      .trim()
      .max(120, "Use at most 120 characters")
      .regex(noControlChars, "Contains invalid characters")
      .transform(emptyToNull)
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });

export const registrationSchema = z.object({ name: nameSchema, password: passwordSchema });
export const bootstrapSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
});

/** Parse or throw a ValidationError carrying per-field messages only (never raw input). */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Invalid input", result.error.flatten().fieldErrors as Record<string, string[] | undefined>);
  }
  return result.data;
}
