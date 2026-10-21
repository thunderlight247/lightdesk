/**
 * M6d Embedded Signup onboarding (spec §3.6): the business OWNER connects their WhatsApp
 * presence from their own console. Two steps, mirroring Meta's flow:
 *
 * 1. `startEmbeddedSignup` — the browser runs Meta's Embedded Signup and hands back a
 *    short-lived `code`; the server exchanges it for a business access token, upgrades it to a
 *    long-lived token (Meta requires this within 24h), and then DISCOVERS which WABAs and phone
 *    numbers the token can see. One number → the connection is verified and activated at once;
 *    several numbers → the long-lived token is stored ENCRYPTED, server-side only
 *    (WhatsAppPendingConnection, short TTL, never sent back to the browser) and the owner
 *    chooses the number in step 2.
 * 2. `completeEmbeddedSignupChoice` — re-verifies the chosen number against the WABA with the
 *    pending token, runs the live pre-flight (the "can we see this number" read), then binds it.
 *
 * Safety rules:
 * - Owner-only (role OWNER), added to audit, distinct from the owner/admin send permission:
 *   binding the account is more sensitive than sending a message.
 * - Every token exchange goes through `modules/whatsapp/graph.ts` with an injectable fetch —
 *   nothing hardcodes Graph URLs elsewhere, tests never touch the network.
 * - Tokens/secret values are never logged and never included in action results; audit metadata
 *   is sanitized downstream as well (defence in depth).
 * - The live \"pre-flight\" before storing anything is a READ (`fetchPhoneNumberInfo`), same
 *   trust level as `scripts/whatsapp-verify.ts`. Nothing is ever stored unverified.
 */
import { prisma } from "@/lib/db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import { encryptSecret, readSecretBoxKey, decryptSecret } from "@/lib/security/secret-box";
import { recordAudit } from "@/modules/audit/service";
import { requireMembership } from "@/modules/permissions/access";
import { readWhatsappConfig, type WhatsappConfig } from "@/modules/whatsapp/config";
import {
  checkWabaOwnsPhoneNumber, exchangeCodeForToken, fetchPhoneNumberInfo, listWabas,
  listWabaPhoneNumbers, upgradeToLongLivedToken,
  type BusinessListing, type PhoneNumberListing,
} from "@/modules/whatsapp/graph";
import { SENT_LIKE_STATUSES } from "@/modules/whatsapp/statuses";
import { FREE_SERVICE_MESSAGES_PER_MONTH } from "@/modules/whatsapp/service";

export type SignupDeps = { fetchImpl?: typeof fetch; now?: () => Date };

const PENDING_TTL_MS = 10 * 60_000;

export type ExistingConnection = {
  id: string;
  displayPhoneNumber: string;
  coexistence: boolean;
  status: "CONNECTED" | "DISCONNECTED";
  tokenExpiresAt: Date | null;
  conversationCount: number;
};

/** Safe, browser-ready state for the settings page. Contains no secrets by construction. */
export async function getSignupState(actorId: string, businessId: string, deps: SignupDeps = {}) {
  const membership = await requireMembership(actorId, businessId);
  return buildSignupState(membership.role, businessId, deps);
}

async function buildSignupState(role: string, businessId: string, deps: SignupDeps = {}) {
  const config = readWhatsappConfig();
  const blockers: string[] = [];
  if (!config.appId) blockers.push("No Meta app id is configured on this server (WHATSAPP_APP_ID).");
  if (!config.appSecret) blockers.push("No Meta app secret is configured on this server (WHATSAPP_APP_SECRET).");
  if (!config.signupConfigId) blockers.push("No Embedded Signup configuration id is configured on this server (WHATSAPP_SIGNUP_CONFIG_ID).");
  if (readSecretBoxKey() === null) blockers.push("The WhatsApp token encryption key is missing on this server (WHATSAPP_TOKEN_ENCRYPTION_KEY).");

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { id: true, displayPhoneNumber: true, coexistence: true, status: true, tokenExpiresAt: true, _count: { select: { conversations: true } } },
  });
  const existing: ExistingConnection | null = connection
    ? {
        id: connection.id,
        displayPhoneNumber: connection.displayPhoneNumber,
        coexistence: connection.coexistence,
        status: connection.status,
        tokenExpiresAt: connection.tokenExpiresAt,
        conversationCount: connection._count.conversations,
      }
    : null;
  const now = (deps.now ?? (() => new Date()))();
  const meterUsed = connection
    ? await prisma.whatsAppMessage.count({
        where: { connectionId: connection.id, direction: "OUTBOUND", status: { in: SENT_LIKE_STATUSES }, createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
      })
    : 0;
  return {
    isOwner: role === "OWNER",
    signupReady: blockers.length === 0,
    blockers,
    appId: config.appId,
    signupConfigId: config.signupConfigId,
    graphApiVersion: config.graphApiVersion,
    existing,
    meterUsed,
    meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0),
  };
}

export type SignupOutcome =
  | { outcome: "connected"; connection: { displayPhoneNumber: string; coexistence: boolean; phoneNumberId: string; wabaId: string } }
  | { outcome: "choose"; pendingId: string; wabas: (BusinessListing & { numbers: PhoneNumberListing[] })[] };

const CODE_RE = /^[A-Za-z0-9_-]+$/;

/** Step 1: exchange the Embedded Signup code, discover the owner's WABAs and numbers. */
export async function startEmbeddedSignup(
  actorId: string, businessId: string, input: { code: unknown }, deps: SignupDeps = {},
): Promise<SignupOutcome> {
  const membership = await requireMembership(actorId, businessId);
  if (membership.role !== "OWNER") throw new ForbiddenError();
  const code = typeof input.code === "string" && input.code.length > 0 && input.code.length <= 1024 && CODE_RE.test(input.code) ? input.code : null;
  if (!code) throw new ValidationError("The signup callback did not include a usable code.");

  const config = readWhatsappConfig();
  const { token, expiresIn } = await exchangeAndUpgrade(code, config, deps);
  const state = await discover(token, deps);

  // Exactly one number = the common pilot case: verify and bind immediately.
  const candidates = state.length === 1 ? state[0].numbers : null;
  if (state.length > 0 && candidates && candidates.length === 1) {
    const chosen = candidates[0];
    await deletePending(businessId);
    const connection = await activateWithToken(actorId, businessId, state[0].id, chosen, { token, expiresIn }, deps);
    return { outcome: "connected", connection };
  }
  if (state.length === 0) {
    throw new ValidationError("Meta returned no WhatsApp business accounts for this signup. Confirm the business profile and the app's WhatsApp product access.");
  }

  // Several options: hold the token server-side, briefly and encrypted, for the choice step.
  const key = readSecretBoxKey();
  if (!key) throw new ConflictError("The WhatsApp token encryption key is missing on this server. The signup cannot be completed.");
  const pending = await prisma.whatsAppPendingConnection.upsert({
    where: { businessId },
    create: { businessId, tokenCiphertext: encryptSecret(token, key) },
    update: { tokenCiphertext: encryptSecret(token, key), createdAt: (deps.now ?? (() => new Date()))() },
  });
  return { outcome: "choose", pendingId: pending.id, wabas: state };
}

/** Step 2 (multi-number): verify the chosen number with the pending token, then bind. */
export async function completeEmbeddedSignupChoice(
  actorId: string, businessId: string,
  input: { pendingId: unknown; wabaId: unknown; phoneNumberId: unknown; coexistence?: unknown },
  deps: SignupDeps = {},
): Promise<SignupOutcome> {
  const membership = await requireMembership(actorId, businessId);
  if (membership.role !== "OWNER") throw new ForbiddenError();
  const pendingId = typeof input.pendingId === "string" ? input.pendingId : null;
  const wabaId = typeof input.wabaId === "string" ? input.wabaId : null;
  const phoneNumberId = typeof input.phoneNumberId === "string" ? input.phoneNumberId : null;
  if (!pendingId || !wabaId || !phoneNumberId || !/^\d+$/.test(phoneNumberId)) throw new ValidationError("Invalid choice. Reload the page and try again.");

  const pending = await loadLivePending(pendingId, businessId);
  if (!pending) throw new NotFoundError("This signup session expired. Start the connection again.");

  const key = readSecretBoxKey();
  if (!key) throw new ConflictError("The WhatsApp token encryption key is missing on this server. The signup cannot be completed.");
  const token = pending ? decryptSecret(pending.tokenCiphertext, key) : null;
  if (!token) throw new ConflictError("The stored signup token could not be read. Start the connection again.");

  const phoneList = await listWabaPhoneNumbers({ accessToken: token, wabaId, graphApiVersion: readWhatsappConfig().graphApiVersion }, deps);
  if (!phoneList.ok) throw new ConflictError(`The chosen number could not be verified with Meta: ${phoneList.message}`);
  const chosen = phoneList.value.find((n) => n.id === phoneNumberId);
  if (!chosen) throw new ConflictError("That phone number is not registered under the WhatsApp account you connected. Choose from the listed numbers.");

  await deletePending(businessId);
  const connection = await activateWithToken(actorId, businessId, wabaId, chosen, { token, expiresIn: null }, deps, { coexistence: input.coexistence === true || input.coexistence === "true" });
  return { outcome: "connected", connection };
}

/** Owner disconnect (soft): the connection stops serving webhooks and sends; history is kept. */
export async function disconnectWhatsAppConnection(actorId: string, businessId: string) {
  const membership = await requireMembership(actorId, businessId);
  if (membership.role !== "OWNER") throw new ForbiddenError();
  const connection = await prisma.whatsAppConnection.findUnique({ where: { businessId }, select: { id: true, displayPhoneNumber: true, status: true } });
  if (!connection) throw new NotFoundError("No WhatsApp connection exists for this business yet.");
  await prisma.$transaction(async (tx) => {
    await tx.whatsAppPendingConnection.deleteMany({ where: { businessId } });
    await tx.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED" } });
    await recordAudit(tx, {
      action: "whatsapp.connection.disconnected", actorUserId: actorId, businessId,
      targetType: "WhatsAppConnection", targetId: connection.id,
      metadata: { previousStatus: connection.status as string },
    });
  });
}

// ---- internals -----------------------------------------------------------------------------

async function exchangeAndUpgrade(code: string, config: WhatsappConfig, deps: SignupDeps): Promise<{ token: string; expiresIn: number | null }> {
  if (!config.appId || !config.appSecret) throw new ConflictError("The Meta app credentials are not fully configured on this server.");
  const exchanged = await exchangeCodeForToken({ appId: config.appId, appSecret: config.appSecret, code, graphApiVersion: config.graphApiVersion }, deps);
  if (!exchanged.ok) throw new ConflictError(`Meta rejected the signup code: ${exchanged.message}`);
  const upgraded = await upgradeToLongLivedToken({ appId: config.appId, appSecret: config.appSecret, shortLivedToken: exchanged.accessToken, graphApiVersion: config.graphApiVersion }, deps);
  if (!upgraded.ok) throw new ConflictError(`Meta refused to upgrade the signup token: ${upgraded.message}`);
  return { token: upgraded.accessToken, expiresIn: upgraded.expiresIn };
}

async function discover(token: string, deps: SignupDeps): Promise<(BusinessListing & { numbers: PhoneNumberListing[] })[]> {
  const config = readWhatsappConfig();
  const wabas = await listWabas({ accessToken: token, graphApiVersion: config.graphApiVersion }, deps);
  if (!wabas.ok) throw new ConflictError(`Meta did not list the WhatsApp accounts for this token: ${wabas.message}`);
  return Promise.all(
    wabas.value.map(async (waba) => {
      const numbers = await listWabaPhoneNumbers({ accessToken: token, wabaId: waba.id, graphApiVersion: config.graphApiVersion }, deps);
      return { ...waba, numbers: numbers.ok ? numbers.value : [] };
    }),
  );
}

async function activateWithToken(
  actorId: string, businessId: string, wabaId: string, chosen: PhoneNumberListing, pendingToken: { token: string; expiresIn: number | null }, deps: SignupDeps,
  opts: { coexistence?: boolean } = {},
) {
  const token = pendingToken.token;
  const config = readWhatsappConfig();
  const key = readSecretBoxKey();
  if (!key) throw new ConflictError("The WhatsApp token encryption key is missing on this server. The signup cannot be completed.");
  if (!wabaId) throw new ValidationError("Invalid choice. Reload the page and try again.");

  // Live pre-flight read (no send): proves the token can see the number, and cross-checks ownership.
  const info = await fetchPhoneNumberInfo({ accessToken: token, phoneNumberId: chosen.id, graphApiVersion: config.graphApiVersion }, deps);
  if (!info.ok) {
    await recordAudit(prisma, {
      action: "whatsapp.signup.failed", actorUserId: actorId, businessId,
      targetType: "Business", targetId: businessId, metadata: { stage: "number_preflight", reason: info.message },
    });
    throw new ConflictError(`The number could not be verified with Meta, so nothing was stored: ${info.message}`);
  }
  const ownership = await checkWabaOwnsPhoneNumber({ accessToken: token, wabaId, phoneNumberId: info.value.id, graphApiVersion: config.graphApiVersion }, deps);
  if (!ownership.ok || !ownership.value.belongs) {
    await recordAudit(prisma, {
      action: "whatsapp.signup.failed", actorUserId: actorId, businessId,
      targetType: "Business", targetId: businessId, metadata: { stage: "waba_crosscheck", reason: ownership.ok ? "number not under this WABA" : ownership.message },
    });
    throw new ConflictError("The phone number is not listed under the WhatsApp business account you connected, so nothing was stored. Choose the number it actually belongs to.");
  }

  const now = (deps.now ?? (() => new Date()))();
  const tokenExpiresAt = pendingToken.expiresIn !== null ? new Date(now.getTime() + pendingToken.expiresIn * 1000) : null;
  return prisma.$transaction(async (tx) => {
    const previous = await tx.whatsAppConnection.findUnique({ where: { businessId }, select: { id: true, status: true } });
    const connection = await tx.whatsAppConnection.upsert({
      where: { businessId },
      create: {
        businessId, wabaId, phoneNumberId: info.value.id, displayPhoneNumber: info.value.displayPhoneNumber || (chosen.displayPhoneNumber ?? ""),
        coexistence: opts.coexistence ?? false, status: "CONNECTED", tokenCiphertext: encryptSecret(token, key), tokenExpiresAt,
      },
      update: {
        wabaId, phoneNumberId: info.value.id, displayPhoneNumber: info.value.displayPhoneNumber || (chosen.displayPhoneNumber ?? ""),
        status: "CONNECTED", tokenCiphertext: encryptSecret(token, key), tokenExpiresAt,
      },
      select: { id: true, displayPhoneNumber: true, coexistence: true, phoneNumberId: true, wabaId: true },
    });
    await tx.whatsAppPendingConnection.deleteMany({ where: { businessId } });
    await recordAudit(tx, {
      action: "whatsapp.connection.connected", actorUserId: actorId, businessId,
      targetType: "WhatsAppConnection", targetId: connection.id,
      metadata: { replaced: previous !== null, previousStatus: previous?.status ?? null, coexistence: opts.coexistence ?? false },
    });
    return connection;
  });
}

async function loadLivePending(pendingId: string, businessId: string) {
  const now = Date.now();
  // Opportunistic TTL cleanup: expired pending tokens are dropped on every attempt.
  await prisma.whatsAppPendingConnection.deleteMany({
    where: { createdAt: { lt: new Date(now - PENDING_TTL_MS) }, businessId },
  });
  const pending = await prisma.whatsAppPendingConnection.findUnique({ where: { id: pendingId } });
  if (!pending) return null;
  if (pending.businessId !== businessId) return null; // other tenants' ids are "not found"
  if (Date.now() - pending.createdAt.getTime() > PENDING_TTL_MS) {
    await prisma.whatsAppPendingConnection.delete({ where: { id: pendingId } });
    return null;
  }
  return pending;
}

async function deletePending(businessId: string) {
  await prisma.whatsAppPendingConnection.deleteMany({ where: { businessId } }).catch(() => undefined);
}
