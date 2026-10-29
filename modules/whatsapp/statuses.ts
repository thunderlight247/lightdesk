/**
 * Shared WhatsApp message status facts for M6c/M6d. One tiny module so the send meter and the
 * AI-assist pipeline agree without importing each other (no cycles between service and assist).
 */
import type { WhatsAppMessageStatus } from "@/lib/generated/prisma/client";

/**
 * Statuses an outbound row has once it has actually gone (or is travelling) to the customer.
 * DRAFT rows are excluded wherever messages are counted: only real sends count toward the
 * monthly 1,000 free servicemessages tier and the 24-hour window bookkeeping.
 */
export const SENT_LIKE_STATUSES: WhatsAppMessageStatus[] = ["SENT", "DELIVERED", "READ"];

export const isSentLike = (status: string): boolean => (SENT_LIKE_STATUSES as readonly string[]).includes(status);
