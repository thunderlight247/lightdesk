/**
 * The ONLY place Cloud API HTTP calls are made (spec §3.1). Thin and typed; under test the
 * `fetchImpl` dependency is injected so no test ever touches the network — same idea as the
 * lab module's `MockProvider`.
 *
 * Error text returned by Graph can contain internals; callers get a normalized
 * { kind, message } where message is safe only because Graph error *messages* (not codes) are
 * the business-facing wording; raw payloads stay in logs the script prints, not in prompts.
 */
export type GraphResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type PhoneNumberInfo = {
  id: string;
  displayPhoneNumber: string; // as Graph returns it, e.g. "4915112345678"
  verifiedName: string | null;
  qualityRating: string | null; // GREEN / YELLOW / RED / UNKNOWN
  codeVerificationStatus: string | null;
  wabaId: string | null; // when requested via ?fields=account_id
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
 * One live call that proves the token works AND that it can see the phone number:
 * GET /{phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,
 * code_verification_status,account_id
 */
export async function fetchPhoneNumberInfo(
  params: { accessToken: string; phoneNumberId: string; graphApiVersion: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GraphResult<PhoneNumberInfo>> {
  const fields = [
    "id", "display_phone_number", "verified_name", "quality_rating", "code_verification_status", "account_id",
  ].join(",");
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
      wabaId: typeof v.account_id === "string" ? v.account_id : null,
    },
  };
}
