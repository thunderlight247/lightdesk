import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(72),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Lazily validated so `next build` does not need runtime secrets. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Names only — never echo values (they may be secrets).
      const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid environment configuration: ${names}`);
    }
    cached = parsed.data;
  }
  return cached;
}
