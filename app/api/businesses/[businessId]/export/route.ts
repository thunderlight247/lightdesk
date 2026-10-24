import { requireUser } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/security/errors";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { exportBusinessData } from "@/modules/privacy/export";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, (await ctx.params).businessId);
    const archive = await exportBusinessData(user.id, businessId);

    const filename = `lightdesk-export-${archive.business.slug}-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(JSON.stringify(archive, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
