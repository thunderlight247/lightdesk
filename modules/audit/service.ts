import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type AuditInput = {
  action: string;
  actorUserId?: string | null;
  businessId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

const SECRET_KEY = /token|password|secret|hash|cookie/i;

/** Defence in depth: secrets must never reach the audit log, even by mistake. */
export function sanitizeMetadata(metadata: AuditInput["metadata"]): Prisma.InputJsonObject | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !SECRET_KEY.test(key)));
}

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      businessId: input.businessId ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: sanitizeMetadata(input.metadata),
    },
  });
}
