import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/ready/route";

describe("Deep Readiness Probe (GET /api/health/ready)", () => {
  it("returns 200 with status ready when database is reachable", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      checks: { database: { status: string }; encryption: { status: string } };
      totalLatencyMs: number;
    };

    expect(body.status).toBe("ready");
    expect(body.checks.database.status).toBe("ok");
    expect(body.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
