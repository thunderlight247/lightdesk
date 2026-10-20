/* Binds the verified WhatsApp Cloud API credentials in .env to a LightDesk business by
 * creating (or refreshing) its WhatsAppConnection row. Tokens are encrypted at rest.
 * Run: tsx --env-file=.env scripts/whatsapp-setup-connection.ts <businessId> [--coexistence]
 * One live read is performed first (fetchPhoneNumberInfo) so we never store an unverified token.
 */
import { prisma } from "@/lib/db/client";
import { encryptSecret, readSecretBoxKey } from "@/lib/security/secret-box";
import { readWhatsappConfig, whatsappConnectionProblem } from "@/modules/whatsapp/config";
import { fetchPhoneNumberInfo } from "@/modules/whatsapp/graph";

async function main() {
  const businessId = process.argv[2];
  const coexistence = process.argv.includes("--coexistence");
  if (!businessId || businessId.startsWith("--")) {
    console.error("Usage: tsx --env-file=.env scripts/whatsapp-setup-connection.ts <businessId> [--coexistence]");
    process.exitCode = 1;
    return;
  }
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
  if (!business) {
    console.error(`Business ${businessId} not found.`);
    process.exitCode = 1;
    return;
  }
  const key = readSecretBoxKey();
  if (!key) {
    console.error("WHATSAPP_TOKEN_ENCRYPTION_KEY is not set or malformed (needs 32 bytes as 64 hex chars).");
    process.exitCode = 1;
    return;
  }
  const config = readWhatsappConfig();
  const problem = whatsappConnectionProblem(config) ?? (config.issues.length > 0 ? "invalid config" : null);
  if (config.issues.length > 0) {
    console.error("Configuration problems:");
    for (const issue of config.issues) console.error(` - ${issue}`);
    process.exitCode = 1;
    return;
  }
  if (!config.accessToken || !config.phoneNumberId) {
    console.error(`Credentials incomplete: ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log("Verifying the token against the live Graph API before storing anything ...");
  const info = await fetchPhoneNumberInfo({
    accessToken: config.accessToken,
    phoneNumberId: config.phoneNumberId,
    graphApiVersion: config.graphApiVersion,
  });
  if (!info.ok) {
    console.error(`Credential verification FAILED, nothing was stored: ${info.message}`);
    process.exitCode = 1;
    return;
  }
  const v = info.value;
  if (config.businessAccountId && await needsWabaCheck(config, v.id)) {
    console.error("The phone number is not listed under the configured WABA. Nothing was stored.");
    process.exitCode = 1;
    return;
  }

  const row = await prisma.whatsAppConnection.upsert({
    where: { businessId: business.id },
    create: {
      businessId: business.id,
      wabaId: config.businessAccountId ?? "unknown",
      phoneNumberId: v.id,
      displayPhoneNumber: v.displayPhoneNumber,
      coexistence,
      tokenCiphertext: encryptSecret(config.accessToken, key),
    },
    update: {
      phoneNumberId: v.id,
      wabaId: config.businessAccountId ?? "unknown",
      displayPhoneNumber: v.displayPhoneNumber,
      coexistence,
      status: "CONNECTED",
      tokenCiphertext: encryptSecret(config.accessToken, key),
      tokenExpiresAt: null,
    },
  });
  console.log(`WhatsApp connection saved for business "${business.name}":`);
  console.log(JSON.stringify({
    connectionId: row.id, phoneNumberId: row.phoneNumberId, displayPhoneNumber: row.displayPhoneNumber,
    coexistence: row.coexistence, status: row.status,
    verifiedName: v.verifiedName, qualityRating: v.qualityRating, codeVerificationStatus: v.codeVerificationStatus,
  }, null, 2));
  if (v.codeVerificationStatus && v.codeVerificationStatus !== "VERIFIED") {
    console.warn(`Note: code_verification_status is ${v.codeVerificationStatus} — inbound webhooks and real messaging still need Meta-side setup (webhook URL + token).`);
  }
}

async function needsWabaCheck(config: ReturnType<typeof readWhatsappConfig>, phoneNumberId: string): Promise<boolean> {
  const { checkWabaOwnsPhoneNumber } = await import("@/modules/whatsapp/graph");
  const out = await checkWabaOwnsPhoneNumber({
    accessToken: config.accessToken!,
    wabaId: config.businessAccountId!,
    phoneNumberId,
    graphApiVersion: config.graphApiVersion,
  });
  return !out.ok || !out.value.belongs;
}

main()
  .catch((err) => {
    console.error("WhatsApp connection setup failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
