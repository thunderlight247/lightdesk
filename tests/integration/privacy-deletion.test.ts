import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import { deleteBusiness } from "@/modules/privacy/deletion";
import { resetDb, twoTenants } from "../helpers/db";

describe("Privacy & Business Deletion (M8 Phase 1)", () => {
  beforeEach(resetDb);

  it("allows the business OWNER to permanently delete the workspace when confirmation matches", async () => {
    const t = await twoTenants();
    const result = await deleteBusiness(t.ownerA.id, t.bizA.id, "Biz A");

    expect(result.deleted).toBe(true);
    expect(result.businessId).toBe(t.bizA.id);

    // Business record is removed
    const found = await prisma.business.findUnique({ where: { id: t.bizA.id } });
    expect(found).toBeNull();

    // Memberships are cascade-deleted
    const memberships = await prisma.businessMembership.findMany({ where: { businessId: t.bizA.id } });
    expect(memberships).toHaveLength(0);

    // Audit record persists with businessId null
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "business.deleted", actorUserId: t.ownerA.id },
    });
    expect(audit).toBeDefined();
    expect(audit?.businessId).toBeNull();
  });

  it("rejects deletion when confirmation name does not match", async () => {
    const t = await twoTenants();
    await expect(deleteBusiness(t.ownerA.id, t.bizA.id, "Wrong Name")).rejects.toBeInstanceOf(ValidationError);

    // Business still exists
    const found = await prisma.business.findUnique({ where: { id: t.bizA.id } });
    expect(found).not.toBeNull();
  });

  it("refuses deletion for an ADMIN (owner-only invariant)", async () => {
    const t = await twoTenants();
    await expect(deleteBusiness(t.adminA.id, t.bizA.id, "Biz A")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses deletion for a MEMBER (owner-only invariant)", async () => {
    const t = await twoTenants();
    await expect(deleteBusiness(t.memberA.id, t.bizA.id, "Biz A")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses deletion across tenants (Owner B cannot delete Biz A)", async () => {
    const t = await twoTenants();
    await expect(deleteBusiness(t.ownerB.id, t.bizA.id, "Biz A")).rejects.toBeInstanceOf(NotFoundError);
  });
});
