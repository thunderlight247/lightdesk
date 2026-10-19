import { requireUser } from "@/lib/auth/guards";
import { assertSameOrigin } from "@/lib/security/origin";
import { toErrorResponse, ValidationError } from "@/lib/security/errors";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { buildInviteLink, createInvitation } from "@/modules/businesses/invitations";

export const dynamic = "force-dynamic";

/**
 * Dev-workflow invitation creation. Returns the one-time link in the response;
 * no email is sent in Milestone 0.
 */
export async function POST(request: Request, ctx: { params: Promise<{ businessId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, (await ctx.params).businessId);
    const body: unknown = await request.json().catch(() => {
      throw new ValidationError("Body must be valid JSON");
    });
    const inv = await createInvitation(user.id, businessId, body);
    return Response.json(
      { invitation: { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt }, inviteLink: buildInviteLink(inv.token) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
