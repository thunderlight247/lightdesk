import { prisma } from "@/lib/db/client";
import { requireMembership, requirePermission } from "@/modules/permissions/access";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { Prisma } from "@/lib/generated/prisma/client";

export type OrderItemInput = {
  name: string;
  quantity: number;
  priceGhs: number;
};

export async function listOrderLeads(
  userId: string,
  businessId: string,
  filter?: { status?: string; conversationId?: string },
) {
  await requireMembership(userId, businessId);

  const where: Prisma.OrderLeadWhereInput = { businessId };
  if (filter?.status) where.status = filter.status;
  if (filter?.conversationId) where.conversationId = filter.conversationId;

  return prisma.orderLead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

export async function createOrderLead(
  userId: string,
  businessId: string,
  input: {
    conversationId?: string;
    customerName: string;
    customerPhone: string;
    items: OrderItemInput[];
    totalGhs: number;
    deliveryAddress?: string;
    deliveryNotes?: string;
    status?: string;
    paymentStatus?: string;
    receiptRef?: string;
  },
) {
  await requirePermission(userId, businessId, "whatsapp:read");

  if (!input.customerName.trim() || !input.customerPhone.trim()) {
    throw new ValidationError("Customer name and phone number are required.");
  }

  if (input.totalGhs < 0) {
    throw new ValidationError("Total amount must be greater than or equal to 0.");
  }

  return prisma.orderLead.create({
    data: {
      businessId,
      conversationId: input.conversationId ?? null,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      items: input.items,
      totalGhs: new Prisma.Decimal(input.totalGhs),
      deliveryAddress: input.deliveryAddress?.trim() || null,
      deliveryNotes: input.deliveryNotes?.trim() || null,
      status: input.status || "PENDING",
      paymentStatus: input.paymentStatus || "UNPAID",
      receiptRef: input.receiptRef?.trim() || null,
      createdById: userId,
    },
  });
}

export async function updateOrderLeadStatus(
  userId: string,
  businessId: string,
  orderId: string,
  updates: {
    status?: string;
    paymentStatus?: string;
    receiptRef?: string;
    deliveryNotes?: string;
  },
) {
  await requirePermission(userId, businessId, "whatsapp:read");

  const existing = await prisma.orderLead.findFirst({
    where: { id: orderId, businessId },
  });
  if (!existing) {
    throw new NotFoundError("Order record not found.");
  }

  return prisma.orderLead.update({
    where: { id: orderId },
    data: {
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.paymentStatus ? { paymentStatus: updates.paymentStatus } : {}),
      ...(updates.receiptRef !== undefined ? { receiptRef: updates.receiptRef?.trim() || null } : {}),
      ...(updates.deliveryNotes !== undefined ? { deliveryNotes: updates.deliveryNotes?.trim() || null } : {}),
    },
  });
}
