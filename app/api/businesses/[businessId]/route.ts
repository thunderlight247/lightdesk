import { requireUser } from "@/lib/auth/guards";
import { assertSameOrigin } from "@/lib/security/origin";
import { toErrorResponse, ValidationError } from "@/lib/security/errors";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { updateBusiness } from "@/modules/businesses/service";
import { requirePermission } from "@/modules/permissions/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ businessId: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

function publicBusiness(b: { id: string; name: string; slug: string; description: string | null; location: string | null }) {
  return { id: b.id, name: b.name, slug: b.slug, description: b.description, location: b.location };
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, (await ctx.params).businessId);
    const membership = await requirePermission(user.id, businessId, "business:read");
    return Response.json({ business: publicBusiness(membership.business), role: membership.role }, { headers: NO_STORE });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Update name (owner only), description, location. Slug/status are not settable here. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, (await ctx.params).businessId);
    const body: unknown = await request.json().catch(() => {
      throw new ValidationError("Body must be valid JSON");
    });
    const { business, changed } = await updateBusiness(user.id, businessId, body);
    return Response.json({ business: publicBusiness(business), changed }, { headers: NO_STORE });
  } catch (err) {
    return toErrorResponse(err);
  }
}
