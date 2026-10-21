/**
 * The ONLY place Cloud API HTTP calls are made (spec §3.1). Thin and typed; under test the
 * `fetchImpl` dependency is injected so no test ever touches the network — same idea as the
 * lab module's `MockProvider`.
 */
export type GraphResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type PhoneNumberInfo = {
  id: string;
  displayPhoneNumber: string; // as Graph returns it, e.g. "233540000000"
  verifiedName: string | null;
  qualityRating: string | null; // GREEN / YELLOW / RED / UNKNOWN
  codeVerificationStatus: string | null;
};

const GRAPH_BASE = "https://graph.facebook.com";

async function graphGetJson(
  path: string,
  params: Record<string, string>,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GraphResult<Record<string, unknown>>> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const url = new URL(path, GRAPH_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetchFn(url, { method: "GET" });
  } catch {
    return { ok: false, message: "The Graph API could not be reached from this server." };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: "The Graph API returned an unreadable response." };
  }
  if (!res.ok || (body as { error?: unknown }).error) {
    const err = (body as { error?: { message?: string; type?: string } }).error;
    const message = err?.message ?? `Graph API call failed (HTTP ${res.status}).`;
    return { ok: false, message };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

/**
 * One live call that proves the token works AND that it can see the phone number.
 * Only stable, documented fields are requested (v26.0 dropped `account_id` here).
 */
export async function fetchPhoneNumberInfo(
  params: { accessToken: string; phoneNumberId: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GraphResult<PhoneNumberInfo>> {
  const fields = "id,display_phone_number,verified_name,quality_rating,code_verification_status";
  const out = await graphGetJson(`${params.graphApiVersion}/${params.phoneNumberId}`, { fields, access_token: params.accessToken }, opts);
  if (!out.ok) return out;
  const v = out.value;
  const id = typeof v.id === "string" ? v.id : null;
  if (!id) return { ok: false, message: "The Graph API response did not include a phone number id." };
  return {
    ok: true,
    value: {
      id,
      displayPhoneNumber: typeof v.display_phone_number === "string" ? v.display_phone_number : "",
      verifiedName: typeof v.verified_name === "string" ? v.verified_name : null,
      qualityRating: typeof v.quality_rating === "string" ? v.quality_rating : null,
      codeVerificationStatus: typeof v.code_verification_status === "string" ? v.code_verification_status : null,
    },
  };
}

/**
 * Independent cross-check: the token can list the WABA's phone numbers, and our
 * configured number id really belongs to that WABA. Data pagination is not needed
 * for verification — one page is enough for any realistic number of lines.
 */
export async function checkWabaOwnsPhoneNumber(
  params: { accessToken: string; wabaId: string; phoneNumberId: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GraphResult<{ belongs: boolean }>> {
  const out = await graphGetJson(
    `${params.graphApiVersion}/${params.wabaId}/phone_numbers`,
    { access_token: params.accessToken },
    opts,
  );
  if (!out.ok) return out;
  const list = (out.value.data ?? []) as { id?: string }[];
  if (!Array.isArray(list)) return { ok: false, message: "The Graph API returned an unreadable phone-number list." };
  return { ok: true, value: { belongs: list.some((n) => n && n.id === params.phoneNumberId) } };
}

export type SendTextResult = { ok: true; wamid: string } | { ok: false; message: string };

/**
 * Sends one free-form text message: POST /{version}/{phoneNumberId}/messages with
 * `messaging_product: "whatsapp"`. The caller must have checked the 24-hour customer
 * service window first. `replyToWamid` (context) keeps the WhatsApp thread coherent.
 */
export async function sendWhatsAppText(
  params: {
    accessToken: string;
    phoneNumberId: string;
    graphApiVersion: string;
    toPhone: string;
    text: string;
    replyToWamid?: string | null;
  },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<SendTextResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.toPhone,
    type: "text",
    text: { body: params.text },
  };
  if (params.replyToWamid) payload.context = { message_id: params.replyToWamid };
  let res: Response;
  try {
    res = await fetchFn(
      new URL(`${params.graphApiVersion}/${params.phoneNumberId}/messages`, GRAPH_BASE),
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  } catch {
    return { ok: false, message: "The Graph API could not be reached from this server." };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: "The Graph API returned an unreadable response." };
  }
  if (!res.ok || (body as { error?: unknown }).error) {
    const err = (body as { error?: { message?: string; type?: string } }).error;
    return { ok: false, message: err?.message ?? `Graph API send failed (HTTP ${res.status}).` };
  }
  const wamid = (body as { messages?: { id?: string }[] }).messages?.[0]?.id;
  if (typeof wamid !== "string" || !wamid) {
    return { ok: false, message: "The Graph API accepted the send but did not return a message id." };
  }
  return { ok: true, wamid };
}

// ---- M6d Embedded Signup: token exchange and number discovery ---------------------------

export type ExchangedToken = { ok: true; accessToken: string; expiresIn: number | null; tokenType: string | null } | { ok: false; message: string };

/**
 * Step 1 of Embedded Signup: the browser handed us a short-lived `code`; we exchange it for a
 * business access token. GET /oauth/access_token?client_id&client_secret&code — the ONLY Graph
 * call that takes the app secret (server-side only; the browser never sees it).
 */
export async function exchangeCodeForToken(
  params: { appId: string; appSecret: string; code: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ExchangedToken> {
  const out = await graphGetJson(
    `${params.graphApiVersion}/oauth/access_token`,
    { client_id: params.appId, client_secret: params.appSecret, code: params.code },
    opts,
  );
  if (!out.ok) return out;
  const accessToken = out.value.access_token;
  const expiresIn = out.value.expires_in;
  const tokenType = out.value.token_type;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, message: "The token exchange response did not include an access token." };
  }
  return { ok: true, accessToken, expiresIn: typeof expiresIn === "number" ? expiresIn : null, tokenType: typeof tokenType === "string" ? tokenType : null };
}

/**
 * Step 2: upgrade the short-lived token to a long-lived token within Meta's 24-hour window.
 * GET /oauth/access_token with grant_type=fb_exchange_token&fb_exchange_token=<short>.
 */
export async function upgradeToLongLivedToken(
  params: { appId: string; appSecret: string; shortLivedToken: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ExchangedToken> {
  const out = await graphGetJson(
    `${params.graphApiVersion}/oauth/access_token`,
    { grant_type: "fb_exchange_token", client_id: params.appId, client_secret: params.appSecret, fb_exchange_token: params.shortLivedToken },
    opts,
  );
  if (!out.ok) return out;
  const accessToken = out.value.access_token;
  const expiresIn = out.value.expires_in;
  const tokenType = out.value.token_type;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, message: "The token upgrade response did not include an access token." };
  }
  return { ok: true, accessToken, expiresIn: typeof expiresIn === "number" ? expiresIn : null, tokenType: typeof tokenType === "string" ? tokenType : null };
}

export type BusinessListing = { id: string; name: string | null };
export type PhoneNumberListing = { id: string; displayPhoneNumber: string | null; name: string | null };

/** With a business token: which WABAs does this owner control through our app? */
export async function listWabas(
  params: { accessToken: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GraphResult<BusinessListing[]>> {
  const out = await graphGetJson(`${params.graphApiVersion}/me/businesses`, { fields: "id,name", access_token: params.accessToken }, opts);
  if (!out.ok) return out;
  const list = out.value.data;
  if (!Array.isArray(list)) return { ok: false, message: "The Graph API returned an unreadable WABA list." };
  return {
    ok: true,
    value: list
      .filter((b): b is { id: string; name?: unknown } => !!b && typeof b.id === "string")
      .map((b) => ({ id: b.id, name: typeof b.name === "string" ? b.name : null })),
  };
}

/** Numbers registered under one WABA, so the owner can pick which one LightDesk should drive. */
export async function listWabaPhoneNumbers(
  params: { accessToken: string; wabaId: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GraphResult<PhoneNumberListing[]>> {
  const out = await graphGetJson(
    `${params.graphApiVersion}/${params.wabaId}/phone_numbers`,
    { fields: "id,display_phone_number,verified_name", access_token: params.accessToken },
    opts,
  );
  if (!out.ok) return out;
  const list = out.value.data;
  if (!Array.isArray(list)) return { ok: false, message: "The Graph API returned an unreadable phone-number list." };
  return {
    ok: true,
    value: list
      .filter((n): n is { id: string; display_phone_number?: unknown; verified_name?: unknown } => !!n && typeof n.id === "string")
      .map((n) => ({
        id: n.id,
        displayPhoneNumber: typeof n.display_phone_number === "string" ? n.display_phone_number : null,
        name: typeof n.verified_name === "string" ? n.verified_name : null,
      })),
  };
}
