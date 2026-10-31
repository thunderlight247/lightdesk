import { prisma } from "@/lib/db/client";
import { loadMembershipOrNotFound } from "@/lib/auth/guards";

export type DemandInsightItem = {
  topic: string;
  count: number;
  sampleEnquiries: string[];
  lastEnquiredAt: Date;
  source: "WHATSAPP" | "LAB" | "MIXED";
};

export type DemandOverview = {
  totalEnquiries: number;
  unmetEnquiriesCount: number;
  unmetRatio: number;
  topMissingTopics: DemandInsightItem[];
  recentUnmetQuestions: Array<{
    id: string;
    text: string;
    reason: string | null;
    missingInfo: string[];
    createdAt: Date;
    channel: "WhatsApp" | "Conversation Lab";
  }>;
};

export async function getDemandInsights(userId: string, businessId: string): Promise<DemandOverview> {
  await loadMembershipOrNotFound(userId, businessId);

  // 1. Fetch recent WhatsApp messages with drafting metadata
  const liveMessages = await prisma.whatsAppMessage.findMany({
    where: {
      conversation: { businessId },
      direction: "INBOUND",
    },
    select: {
      id: true,
      text: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const liveDrafts = await prisma.whatsAppMessage.findMany({
    where: {
      conversation: { businessId },
      draftState: { not: null },
    },
    select: {
      id: true,
      text: true,
      resultStatus: true,
      reason: true,
      missingInformation: true,
      createdAt: true,
      conversationId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // 2. Fetch lab messages with drafting metadata
  const labDrafts = await prisma.labMessage.findMany({
    where: {
      conversation: { businessId },
      role: "ASSISTANT",
    },
    select: {
      id: true,
      content: true,
      resultStatus: true,
      reason: true,
      missingInformation: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Combine unmet items
  const recentUnmet: DemandOverview["recentUnmetQuestions"] = [];
  type TopicEntry = { count: number; samples: string[]; lastAt: Date; hasWhatsApp: boolean; hasLab: boolean };
  const topicCounts = new Map<string, TopicEntry>();

  // Process live drafts
  for (const d of liveDrafts) {
    if (d.resultStatus === "NEEDS_INFORMATION" || d.resultStatus === "CONFLICT_DETECTED" || d.resultStatus === "ESCALATION_REQUIRED") {
      const missing = Array.isArray(d.missingInformation) ? (d.missingInformation as string[]) : [];
      recentUnmet.push({
        id: d.id,
        text: d.text ?? "Customer enquiry",
        reason: d.reason,
        missingInfo: missing,
        createdAt: d.createdAt,
        channel: "WhatsApp",
      });

      for (const m of missing) {
        const key = m.trim().toLowerCase();
        if (!key) continue;
        const entry = topicCounts.get(key) ?? { count: 0, samples: [] as string[], lastAt: d.createdAt, hasWhatsApp: true, hasLab: false };
        entry.count += 1;
        entry.hasWhatsApp = true;
        if (entry.samples.length < 3 && d.text) entry.samples.push(d.text);
        if (d.createdAt > entry.lastAt) entry.lastAt = d.createdAt;
        topicCounts.set(key, entry);
      }
    }
  }

  // Process lab drafts
  for (const l of labDrafts) {
    if (l.resultStatus === "NEEDS_INFORMATION" || l.resultStatus === "CONFLICT_DETECTED" || l.resultStatus === "ESCALATION_REQUIRED") {
      const missing = Array.isArray(l.missingInformation) ? (l.missingInformation as string[]) : [];
      recentUnmet.push({
        id: l.id,
        text: l.content ?? "Simulation enquiry",
        reason: l.reason,
        missingInfo: missing,
        createdAt: l.createdAt,
        channel: "Conversation Lab",
      });

      for (const m of missing) {
        const key = m.trim().toLowerCase();
        if (!key) continue;
        const entry = topicCounts.get(key) ?? { count: 0, samples: [] as string[], lastAt: l.createdAt, hasWhatsApp: false, hasLab: true };
        entry.count += 1;
        entry.hasLab = true;
        if (entry.samples.length < 3 && l.content) entry.samples.push(l.content);
        if (l.createdAt > entry.lastAt) entry.lastAt = l.createdAt;
        topicCounts.set(key, entry);
      }
    }
  }

  const topMissingTopics: DemandInsightItem[] = Array.from(topicCounts.entries())
    .map(([topic, data]) => ({
      topic,
      count: data.count,
      sampleEnquiries: data.samples,
      lastEnquiredAt: data.lastAt,
      source: (data.hasWhatsApp && data.hasLab ? "MIXED" : data.hasWhatsApp ? "WHATSAPP" : "LAB") as "WHATSAPP" | "LAB" | "MIXED",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalEnquiries = liveMessages.length + labDrafts.length;
  const unmetEnquiriesCount = recentUnmet.length;
  const unmetRatio = totalEnquiries > 0 ? Math.round((unmetEnquiriesCount / totalEnquiries) * 100) : 0;

  return {
    totalEnquiries,
    unmetEnquiriesCount,
    unmetRatio,
    topMissingTopics,
    recentUnmetQuestions: recentUnmet.slice(0, 15),
  };
}
