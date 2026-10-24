import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { exportBusinessData } from "@/modules/privacy/export";
import { resetDb, twoTenants } from "../helpers/db";

describe("Privacy & Data Export (M8 Phase 1)", () => {
  beforeEach(resetDb);

  it("allows the business OWNER to export data", async () => {
    const t = await twoTenants();
    const archive = await exportBusinessData(t.ownerA.id, t.bizA.id);

    expect(archive).toBeDefined();
    expect(archive.business.id).toBe(t.bizA.id);
    expect(archive.business.name).toBe(t.bizA.name);
    expect(archive.exportedAt).toBeTruthy();
  });

  it("refuses export for an ADMIN (owner-only invariant)", async () => {
    const t = await twoTenants();
    await expect(exportBusinessData(t.adminA.id, t.bizA.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses export for a MEMBER (owner-only invariant)", async () => {
    const t = await twoTenants();
    await expect(exportBusinessData(t.memberA.id, t.bizA.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses export across tenants (Owner B cannot export Biz A)", async () => {
    const t = await twoTenants();
    await expect(exportBusinessData(t.ownerB.id, t.bizA.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
