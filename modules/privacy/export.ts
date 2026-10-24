import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { recordAudit } from "@/modules/audit/service";
import { requireMembership } from "@/modules/permissions/access";

export type BusinessExportArchive = {
  exportedAt: string;
  business: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    location: string | null;
    status: string;
    createdAt: string;
  };
  profile: {
    status: string;
    revision: number;
    entries: {
      module: string;
      key: string;
      approvedValue: string | null;
      workingValue: string;
      state: string;
    }[];
    faqs: {
      question: string;
      answer: string;
      category: string | null;
      state: string;
    }[];
    catalogue: {
      name: string;
      description: string | null;
      category: string | null;
      priceGhs: string;
      currency: string;
      inStock: boolean;
      variants: string | null;
      sku: string | null;
      state: string;
    }[];
  } | null;
  whatsapp: {
    phoneNumber: string | null;
    conversations: {
      customerPhone: string;
      customerName: string | null;
      status: string;
      mode: string;
      messages: {
        direction: string;
        text: string | null;
        status: string;
        timestamp: string;
      }[];
    }[];
  } | null;
};

/**
 * Exports complete business record for privacy compliance (Ghana DPA / GDPR).
 * Strict invariant: ONLY accessible to users with the 'OWNER' role on that business.
 */
export async function exportBusinessData(actorUserId: string, businessId: string): Promise<BusinessExportArchive> {
  const membership = await requireMembership(actorUserId, businessId);
  if (membership.role !== "OWNER") {
    throw new ForbiddenError("Only business owners can export business data.");
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      profile: {
        include: {
          entries: true,
          faqs: true,
          catalogueItems: true,
        },
      },
      whatsappConnections: {
        include: {
          conversations: {
            include: {
              messages: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!business) {
    throw new NotFoundError("Business not found");
  }

  // Audit this critical privacy action
  await recordAudit(prisma, {
    action: "business.data_exported",
    actorUserId,
    businessId,
    targetType: "Business",
    targetId: businessId,
    metadata: {
      businessName: business.name,
      hasProfile: !!business.profile,
      hasWhatsapp: business.whatsappConnections.length > 0,
    },
  });

  const connection = business.whatsappConnections[0] ?? null;

  return {
    exportedAt: new Date().toISOString(),
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      description: business.description,
      location: business.location,
      status: business.status,
      createdAt: business.createdAt.toISOString(),
    },
    profile: business.profile
      ? {
          status: business.profile.status,
          revision: business.profile.revision,
          entries: business.profile.entries.map((e) => ({
            module: e.module,
            key: e.key,
            approvedValue: e.approvedValue,
            workingValue: e.value,
            state: e.state,
          })),
          faqs: business.profile.faqs.map((f) => ({
            question: f.approvedQuestion ?? f.question,
            answer: f.approvedAnswer ?? f.answer,
            category: f.approvedCategory ?? f.category,
            state: f.state,
          })),
          catalogue: business.profile.catalogueItems.map((c) => ({
            name: c.approvedName ?? c.name,
            description: c.approvedDescription ?? c.description,
            category: c.approvedCategory ?? c.category,
            priceGhs: (c.approvedPriceGhs ?? c.priceGhs).toString(),
            currency: c.currency,
            inStock: c.approvedInStock ?? c.inStock,
            variants: c.approvedVariants ?? c.variants,
            sku: c.approvedSku ?? c.sku,
            state: c.state,
          })),
        }
      : null,
    whatsapp: connection
      ? {
          phoneNumber: connection.displayPhoneNumber,
          conversations: connection.conversations.map((conv) => ({
            customerPhone: conv.customerPhone,
            customerName: conv.customerName,
            status: conv.status,
            mode: conv.mode,
            messages: conv.messages.map((m) => ({
              direction: m.direction,
              text: m.text,
              status: m.status,
              timestamp: m.createdAt.toISOString(),
            })),
          })),
        }
      : null,
  };
}
