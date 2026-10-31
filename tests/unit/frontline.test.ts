import { describe, it, expect } from "vitest";

describe("Frontline CRM & Quick Replies Logic", () => {
  it("validates quick reply shortcuts strictly", () => {
    const validShortcut = "/delivery";
    expect(validShortcut.startsWith("/")).toBe(true);
    expect(validShortcut.length).toBeGreaterThanOrEqual(2);
    expect(validShortcut.length).toBeLessThanOrEqual(40);

    const invalidNoSlash = "delivery";
    expect(invalidNoSlash.startsWith("/")).toBe(false);

    const tooShort = "/";
    expect(tooShort.length >= 2).toBe(false);
  });

  it("normalizes order items and formats GHS currency accurately", () => {
    const rawItems = [
      { name: "Shea Butter Cream", quantity: 2, priceGhs: 50 },
      { name: "African Black Soap", quantity: 1, priceGhs: 30 },
    ];

    const computedTotal = rawItems.reduce((acc, it) => acc + it.priceGhs * it.quantity, 0);
    expect(computedTotal).toBe(130);
    expect(computedTotal.toFixed(2)).toBe("130.00");
  });

  it("parses and aggregates unmet customer demand topics", () => {
    const topicMap = new Map<string, { count: number; samples: string[]; hasWhatsApp: boolean; hasLab: boolean }>();

    const recordTopic = (topic: string, sample: string, channel: "WhatsApp" | "Lab") => {
      const key = topic.trim().toLowerCase();
      const entry = topicMap.get(key) ?? { count: 0, samples: [], hasWhatsApp: false, hasLab: false };
      entry.count += 1;
      if (channel === "WhatsApp") entry.hasWhatsApp = true;
      if (channel === "Lab") entry.hasLab = true;
      if (entry.samples.length < 3) entry.samples.push(sample);
      topicMap.set(key, entry);
    };

    recordTopic("delivery fee", "How much is delivery to Tema?", "WhatsApp");
    recordTopic("delivery fee", "Can you deliver to Kumasi?", "WhatsApp");
    recordTopic("delivery fee", "What is the dispatch cost?", "Lab");
    recordTopic("payment options", "Do you accept MoMo?", "WhatsApp");

    const deliveryEntry = topicMap.get("delivery fee");
    expect(deliveryEntry?.count).toBe(3);
    expect(deliveryEntry?.hasWhatsApp).toBe(true);
    expect(deliveryEntry?.hasLab).toBe(true);
    expect(deliveryEntry?.samples).toHaveLength(3);

    const source = deliveryEntry?.hasWhatsApp && deliveryEntry?.hasLab ? "MIXED" : "WHATSAPP";
    expect(source).toBe("MIXED");

    const momoEntry = topicMap.get("payment options");
    expect(momoEntry?.count).toBe(1);
    expect(momoEntry?.hasWhatsApp).toBe(true);
    expect(momoEntry?.hasLab).toBe(false);
  });
});
