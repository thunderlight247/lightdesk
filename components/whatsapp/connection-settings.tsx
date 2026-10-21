"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, GhostButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/field";
import {
  chooseWhatsAppSignupAction, disconnectWhatsAppAction, startWhatsAppSignupAction,
} from "@/app/(workspace)/businesses/[businessId]/whatsapp/settings/actions";

type SignupOutcome =
  | { outcome: "connected"; connection: { displayPhoneNumber: string; coexistence: boolean; phoneNumberId: string; wabaId: string } }
  | { outcome: "choose"; pendingId: string; wabas: { id: string; name: string | null; numbers: { id: string; displayPhoneNumber: string | null; name: string | null }[] }[] };

type Outcome = { ok: true; result: SignupOutcome | { disconnected: true } } | { ok: false; error: string };

type MinimalFB = {
  init: (opts: { appId: string; xfbml: boolean; version: string }) => void;
  login: (cb: (r: { authResponse?: { code?: string } }) => void, opts: Record<string, unknown>) => void;
};

/** Loads Meta's SDK exactly once and calls back with a ready global `FB`. */
function loadFacebookSdk(appId: string, version: string, onLoad: (fb: MinimalFB) => void) {
  const w = window as unknown as { fbAsyncInit?: () => void; FB?: MinimalFB };
  w.fbAsyncInit = () => {
    w.FB!.init({ appId, xfbml: false, version });
    onLoad(w.FB!);
  };
  const handle = document.getElementById("fb-sdk-loader");
  if (handle) return; // already loading
  const script = document.createElement("script");
  script.id = "fb-sdk-loader";
  script.src = "https://connect.facebook.net/en_US/sdk.js";
  script.async = true;
  script.crossOrigin = "anonymous";
  script.onerror = () => onErrorRef.current?.("Meta's signup SDK could not be loaded. Check the network and try again.");
  document.body.appendChild(script);
}

const onErrorRef: { current: ((msg: string) => void) | null } = { current: null };

/**
 * M6d Embedded Signup controls (spec §3.6). The browser only ever holds Meta's `code`;
 * the exchange happens server-side. Owner-only in the service layer — the page shows
 * a read-only explanation for other roles instead of these controls.
 */
export function WhatsAppConnectionSettings({ businessId, appId, signupConfigId, graphApiVersion, connected, statusLabel, displayPhoneNumber, tokenExpiresAt, meterFree, conversationCount, canControl }: {
  businessId: string;
  appId: string | null;
  signupConfigId: string | null;
  graphApiVersion: string;
  connected: boolean;
  statusLabel: string;
  displayPhoneNumber: string | null;
  tokenExpiresAt: Date | null;
  meterFree: number;
  conversationCount: number;
  canControl: boolean; // OWNER only (enforced again by the service)
}) {
  const router = useRouter();
  const [fbReady, setFbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState<Extract<SignupOutcome, { outcome: "choose" }> | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<Extract<SignupOutcome, { outcome: "connected" }> | null>(null);
  const fbRef = useRef<MinimalFB | null>(null);
  onErrorRef.current = setError;

  useEffect(() => {
    if (!appId) return;
    loadFacebookSdk(appId, graphApiVersion, (fb) => {
      fbRef.current = fb;
      setFbReady(true);
    });
  }, [appId, graphApiVersion]);

  const finish = useCallback((result: Outcome) => {
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    if ("outcome" in result.result) {
      if (result.result.outcome === "connected") {
        setConnectedInfo(result.result);
        setChoose(null);
        router.refresh();
      } else {
        setChoose(result.result);
      }
    } else {
      router.refresh();
    }
  }, [router]);

  const launchSignup = () => {
    if (!fbRef.current || !signupConfigId) return;
    setBusy(true);
    setError(null);
    fbRef.current.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          setError("The Meta signup was cancelled or did not return a code. Try again.");
          return;
        }
        startWhatsAppSignupAction(businessId, code).then(finish);
      },
      {
        config_id: signupConfigId,
        response_type: "code",
        override_default_response_type: true,
        auth_type: "rerequest",
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  };

  const chooseNumber = (wabaId: string, phoneNumberId: string) => {
    if (!choose) return;
    setBusy(true);
    chooseWhatsAppSignupAction(businessId, { pendingId: choose.pendingId, wabaId, phoneNumberId }).then(finish);
  };

  if (!canControl) {
    return <Alert tone="info">Connecting or disconnecting the WhatsApp number is restricted to the business owner in this release.</Alert>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {connectedInfo && (
        <Alert tone="success">
          Connected: {connectedInfo.connection.displayPhoneNumber}. LightDesk now receives incoming customer messages for this number.
        </Alert>
      )}

      {connected && !connectedInfo && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-700">
            <span className="font-medium">{displayPhoneNumber ?? "WhatsApp number"}</span> · {statusLabel.toLowerCase()}
            {tokenExpiresAt ? ` · token valid until ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(tokenExpiresAt)}` : ""}
            {conversationCount > 0 ? ` · ${conversationCount} conversation${conversationCount === 1 ? "" : "s"} on file` : ""}
            {` · ${meterFree} free service messages left this month`}
          </p>
          <p className="text-xs text-zinc-500">
            To change the number or refresh a token that is expiring, run the signup again with the same account and pick the new number; the connection is replaced and everything is audited.
          </p>
        </div>
      )}

      {!connected && !connectedInfo && !choose && (
        <>
          <p className="text-sm text-zinc-700">Connect your WhatsApp Business account through Meta&apos;s official signup window. LightDesk receives a short-lived code only; tokens are exchanged on the server and stored encrypted.</p>
          <Button type="button" onClick={launchSignup} disabled={busy || !fbReady || !signupConfigId}>
            {busy ? "Opening Meta…" : !fbReady ? "Loading Meta's signup window…" : "Connect a WhatsApp number"}
          </Button>
        </>
      )}

      {choose && (
        <div className="space-y-2" aria-label="Choose the number LightDesk should use">
          <p className="text-sm font-medium text-zinc-900">More than one WhatsApp number is connected to this account. Choose the one LightDesk should drive:</p>
          {choose.wabas.map((waba) => (
            <div key={waba.id} className="space-y-1 rounded-lg border border-zinc-200 p-3">
              <p className="text-xs font-medium text-zinc-500">WhatsApp business account {waba.name ?? waba.id}</p>
              {waba.numbers.length === 0 ? (
                <p className="text-xs text-zinc-500">No phone numbers registered under this account.</p>
              ) : (
                waba.numbers.map((n) => (
                  <GhostButton key={n.id} type="button" disabled={busy} onClick={() => chooseNumber(waba.id, n.id)}>
                    {n.displayPhoneNumber ?? n.id}{n.name ? ` — ${n.name}` : ""}
                  </GhostButton>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {connected && canControl && (
        <div>
          <Button variant="danger" type="button" disabled={busy}
            onClick={() => { setBusy(true); disconnectWhatsAppAction(businessId).then(finish); }}>
            {busy ? "Working…" : "Disconnect this number"}
          </Button>
          <p className="mt-1 text-xs text-zinc-500">History is kept; Meta webhook traffic stops immediately. Send attempts are refused until you connect again.</p>
        </div>
      )}
    </div>
  );
}
