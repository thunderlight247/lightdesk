import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Chip } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/card";
import { WhatsAppConnectionSettings } from "@/components/whatsapp/connection-settings";
import { orNotFound, requireUserForPage } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { getSignupState } from "@/modules/whatsapp/onboarding";

/**
 * M6d onboarding UX (spec §3.6, flow 2 "Settings"): connection status, token state,
 * disconnect, the monthly service-meter, and (flow 1) Meta's Embedded Signup — all in the
 * private owner console. Read-only for admins/members; controls are OWNER-only.
 */
export default async function WhatsAppSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const user = await requireUserForPage();
  const parsed = businessIdSchema.safeParse((await params).businessId);
  if (!parsed.success) notFound();
  const businessId = parsed.data;
  const state = await orNotFound(getSignupState(user.id, businessId));
  const base = `/businesses/${businessId}/whatsapp`;
  const connected = state.existing?.status === "CONNECTED";

  return (
    <div className="space-y-6">
      <p><Link className="text-sm text-brand-700 underline" href={base}>← WhatsApp inbox</Link></p>
      <PageHeading
        title="WhatsApp connection"
        lead="Connect your business's real WhatsApp presence through Meta's official Cloud API. Customers always keep using their own WhatsApp app; LightDesk never takes over their interface."
        actions={<Chip tone={connected ? "success" : "neutral"}>{connected ? "Connected" : "Not connected"}</Chip>}
      />

      {!state.isOwner && (
        <Alert tone="info">Only the business owner can connect, change or disconnect the WhatsApp number. Ask your owner to complete the connection here.</Alert>
      )}

      <section aria-labelledby="connection-heading" className="card space-y-4 p-4 sm:p-6">
        <h2 id="connection-heading" className="text-sm font-semibold text-zinc-900">Connection</h2>
        {state.signupReady ? (
          <WhatsAppConnectionSettings
            businessId={businessId}
            appId={state.appId}
            signupConfigId={state.signupConfigId}
            graphApiVersion={state.graphApiVersion}
            connected={connected}
            statusLabel={state.existing?.status ?? "NOT CONNECTED"}
            displayPhoneNumber={state.existing?.displayPhoneNumber ?? null}
            tokenExpiresAt={state.existing?.tokenExpiresAt ?? null}
            meterFree={state.meterFree}
            conversationCount={state.existing?.conversationCount ?? 0}
            canControl={state.isOwner}
          />
        ) : (
          <Alert tone="info">
            Connecting your WhatsApp Business account is not set up on this server yet. Ask the LightDesk team to
            complete the Meta app configuration; you will then be able to connect your number from this page.
          </Alert>
        )}
      </section>

      <section aria-labelledby="meter-heading" className="card space-y-3 p-4 sm:p-6">
        <h2 id="meter-heading" className="text-sm font-semibold text-zinc-900">Monthly service-message meter</h2>
        <p className="text-sm text-zinc-700">
          {state.meterUsed === 0
            ? `No service messages used this month. The free tier is 1,000 per messaging account per calendar month (no rollover).`
            : `${state.meterUsed} service message${state.meterUsed === 1 ? "" : "s"} used this month; ${state.meterFree} free message${state.meterFree === 1 ? "" : "s"} remaining before Meta charges apply.`}
        </p>
        <p className="text-xs text-zinc-500">Only messages LightDesk actually sends count. Customer messages inbound to you are free; AI drafts pending review never count.</p>
      </section>

    </div>
  );
}
