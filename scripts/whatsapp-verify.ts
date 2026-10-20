/* Verifies that the WhatsApp Cloud API credentials in .env actually work against the live
 * Graph API — the runner-provided "real API key" gate before any M6 implementation proceeds.
 * Run: tsx --env-file=.env scripts/whatsapp-verify.ts
 *
 * Performs ONE safe GET (no message is sent, no state changes):
 *   GET /{WHATSAPP_PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,
 *        quality_rating,code_verification_status,account_id
 * and additionally, when WHATSAPP_BUSINESS_ACCOUNT_ID is set, one GET on the WABA itself.
 * A bad token, wrong number id, or unreachable API exits non-zero with a readable reason.
 */
import { readWhatsappConfig, whatsappConnectionProblem } from "@/modules/whatsapp/config";
import { fetchPhoneNumberInfo } from "@/modules/whatsapp/graph";

async function main() {
  const config = readWhatsappConfig();
  const structural = whatsappConnectionProblem(config);
  if (structural) {
    console.error(`Credentials incomplete: ${structural}`);
    console.error("Fill WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env (see .env.example).");
    process.exitCode = 1;
    return;
  }
  if (config.issues.length > 0) {
    console.error("Configuration problems:");
    for (const issue of config.issues) console.error(` - ${issue}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Calling Graph API ${config.graphApiVersion} ...`);
  const info = await fetchPhoneNumberInfo({
    accessToken: config.accessToken!,
    phoneNumberId: config.phoneNumberId!,
    graphApiVersion: config.graphApiVersion,
  });

  if (!info.ok) {
    console.error(`Credential verification FAILED: ${info.message}`);
    process.exitCode = 1;
    return;
  }

  const v = info.value;
  console.log("Credential verification OK. The token can see this WhatsApp phone number:");
  console.log(JSON.stringify({
    phoneNumberId: v.id,
    displayPhoneNumber: v.displayPhoneNumber,
    verifiedName: v.verifiedName,
    qualityRating: v.qualityRating,
    codeVerificationStatus: v.codeVerificationStatus,
    wabaId: v.wabaId,
  }, null, 2));

  if (config.businessAccountId && v.wabaId && v.wabaId !== config.businessAccountId) {
    console.error(`WABA mismatch: .env says ${config.businessAccountId} but the number belongs to ${v.wabaId}.`);
    process.exitCode = 1;
    return;
  }

  if (v.codeVerificationStatus && v.codeVerificationStatus !== "VERIFIED") {
    console.warn(`Note: code_verification_status is ${v.codeVerificationStatus} — the number must be verified before real messaging.`);
  }
  console.log("Safe next step: this proves the API key. Webhook setup and sending come with M6b/M6d.");
}

main().catch((err) => {
  console.error("WhatsApp credential verification failed:", err);
  process.exitCode = 1;
});
