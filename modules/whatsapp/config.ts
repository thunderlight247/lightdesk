/**
 * WhatsApp Cloud API configuration, read from server-side environment variables only. Same design
 * rule as `modules/lab/config.ts`: a missing or malformed WhatsApp setting must never break
 * sign-in, the workspace or the BIP. Problems are reported as `issues`, never thrown.
 *
 * Secret values are held as trims, never logged. `issues` text never contains a secret value.
 */
export type WhatsappConfig = {
  appId: string | null;
  appSecret: string | null; // used for webhook signature verification (X-Hub-Signature-256)
  accessToken: string | null; // system-user token scoped to the WABA
  businessAccountId: string | null; // WABA id, numeric string
  phoneNumberId: string | null; // phone-number id, numeric string
  webhookVerifyToken: string | null; // arbitrary string you choose for webhook GET verification
  signupConfigId: string | null; // Meta embedded-signup configuration id (WHATSAPP_SIGNUP_CONFIG_ID)
  outboxFlushToken: string | null; // (ADR 0010) bearer token enabling the outbox cron endpoint; unset = endpoint disabled
  graphApiVersion: string; // e.g. "v26.0"
  issues: string[];
};

const GRAPH_VERSION_RE = /^v\d+\.\d+$/;

export function readWhatsappConfig(env: Record<string, string | undefined> = process.env): WhatsappConfig {
  const issues: string[] = [];
  const raw = (name: string): string | null => (env[name] ?? "").trim() || null;

  const graphApiVersion = (env.WHATSAPP_GRAPH_API_VERSION ?? "").trim() || "v26.0";
  if (!GRAPH_VERSION_RE.test(graphApiVersion)) {
    issues.push("WHATSAPP_GRAPH_API_VERSION must look like vNN.N (e.g. v26.0)");
  }
  for (const numeric of ["WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_PHONE_NUMBER_ID"] as const) {
    const value = raw(numeric);
    if (value !== null && !/^\d+$/.test(value)) {
      issues.push(`${numeric} must be the numeric id, not a display phone number`);
    }
  }

  const config: WhatsappConfig = {
    appId: raw("WHATSAPP_APP_ID"),
    appSecret: raw("WHATSAPP_APP_SECRET"),
    accessToken: raw("WHATSAPP_ACCESS_TOKEN"),
    businessAccountId: raw("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    phoneNumberId: raw("WHATSAPP_PHONE_NUMBER_ID"),
    webhookVerifyToken: raw("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    signupConfigId: raw("WHATSAPP_SIGNUP_CONFIG_ID"),
    outboxFlushToken: raw("WHATSAPP_OUTBOX_FLUSH_TOKEN"),
    graphApiVersion,
    issues,
  };
  if (config.outboxFlushToken !== null && config.outboxFlushToken.length < 32) {
    issues.push("WHATSAPP_OUTBOX_FLUSH_TOKEN must be at least 32 characters when set");
  }
  return config;
}

/** Why live WhatsApp work cannot run yet. Safe to show; never echoes secret values. */
export function whatsappConnectionProblem(config: WhatsappConfig): string | null {
  if (config.issues.length > 0) return "The WhatsApp settings on this server are invalid.";
  if (!config.accessToken) return "No WhatsApp access token is configured on this server.";
  if (!config.phoneNumberId) return "No WhatsApp phone-number id is configured on this server.";
  return null;
}
