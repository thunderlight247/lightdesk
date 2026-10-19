export const dynamic = "force-dynamic";

/** Liveness only. Deliberately touches no database and returns no details. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
