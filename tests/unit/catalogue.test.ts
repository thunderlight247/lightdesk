import { describe, expect, it } from "vitest";
import { compareForm } from "@/modules/business-profile/text";
import { parseCatalogueCsv, parseCsvLines } from "@/modules/catalogue/import";
import { CatalogueItemInputSchema } from "@/modules/catalogue/types";
import { retrieve } from "@/modules/lab/retrieval";
import type { SnapshotLike } from "@/modules/lab/types";

describe("CatalogueItemInputSchema validation", () => {
  it("accepts valid catalogue item inputs", () => {
    const valid = CatalogueItemInputSchema.safeParse({
      name: "iPhone 13 128GB",
      priceGhs: "6500.50",
      category: "Phones",
      description: "Brand new sealed in box",
      inStock: true,
      variants: "Midnight, Starlight, Blue",
      sku: "IPH13-128",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.priceGhs).toBe(6500.5);
      expect(valid.data.currency).toBe("GHS");
      expect(valid.data.inStock).toBe(true);
    }
  });

  it("rejects negative prices and empty names", () => {
    const badPrice = CatalogueItemInputSchema.safeParse({
      name: "Valid Name",
      priceGhs: -10,
    });
    expect(badPrice.success).toBe(false);

    const emptyName = CatalogueItemInputSchema.safeParse({
      name: "   ",
      priceGhs: 50,
    });
    expect(emptyName.success).toBe(false);
  });
});

describe("CSV parsing and bulk import", () => {
  it("correctly parses CSV lines handling quoted fields with commas", () => {
    const csv = `name,price,variants\n"Shirt, Casual",120.50,"Sizes: M, L, XL"\nShoes,250.00,"Black, White"`;
    const lines = parseCsvLines(csv);
    expect(lines).toHaveLength(3);
    expect(lines[1][0]).toBe("Shirt, Casual");
    expect(lines[1][1]).toBe("120.50");
    expect(lines[1][2]).toBe("Sizes: M, L, XL");
  });

  it("validates and parses catalogue CSV table", () => {
    const csv = `name,price,category,inStock,variants
"Nike Air Max",450.00,Shoes,true,"Sizes: 41-44"
"Polo T-Shirt",85.00,Clothing,true,"Blue, Red"
"Broken Row",-50,Invalid,no,"None"`;

    const { validRows, errors } = parseCatalogueCsv(csv);
    expect(validRows).toHaveLength(2);
    expect(validRows[0].data.name).toBe("Nike Air Max");
    expect(validRows[0].data.priceGhs).toBe(450);
    expect(validRows[1].data.name).toBe("Polo T-Shirt");
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(4);
    expect(errors[0].error).toMatch(/Price must be non-negative/);
  });
});

describe("Duplicate detection normalization", () => {
  it("normalizes product names identically despite case and whitespace", () => {
    const n1 = compareForm("Nike Air Max 90");
    const n2 = compareForm("  nike   air   max   90  ");
    const n3 = compareForm("NIKE AIR MAX 90");
    expect(n1).toBe(n2);
    expect(n2).toBe(n3);
  });
});

describe("Laboratory catalogue retrieval", () => {
  const snapshot: SnapshotLike = {
    revision: 1,
    values: {
      business_category: "Retail Shop",
      escalation: "Call the owner",
      offerings_summary: "We sell authentic sneakers and sportswear",
      greeting: "Hello",
      sign_off: "Thank you",
    },
    faqs: [
      { id: "f1", question: "Do you deliver to Kumasi?", answer: "Yes we deliver via VIP bus.", category: "Delivery" },
    ],
    capabilities: {},
    catalogue: [
      {
        id: "c1",
        name: "Nike Air Max 90",
        description: "Classic running shoe",
        category: "Footwear",
        priceGhs: 450,
        currency: "GHS",
        inStock: true,
        variants: "Sizes 41-45",
      },
      {
        id: "c2",
        name: "Adidas Ultraboost",
        description: "High performance sneaker",
        category: "Footwear",
        priceGhs: 600,
        currency: "GHS",
        inStock: false,
        variants: "Sizes 42-44",
      },
    ],
  };

  it("retrieves approved catalogue items matching customer tokens", () => {
    const res = retrieve(snapshot, "How much is the Nike Air Max?");
    const catItem = res.items.find((i) => i.kind === "catalogue" && i.sourceId === "c1");
    expect(catItem).toBeDefined();
    expect(catItem?.text).toContain("Price: 450.00 GHS");
    expect(catItem?.text).toContain("Status: In Stock");
    expect(catItem?.text).toContain("Variants: Sizes 41-45");
  });

  it("includes out of stock status for unavailable items", () => {
    const res = retrieve(snapshot, "Do you have the Adidas Ultraboost available?");
    const catItem = res.items.find((i) => i.kind === "catalogue" && i.sourceId === "c2");
    expect(catItem).toBeDefined();
    expect(catItem?.text).toContain("Status: Out of Stock");
    expect(catItem?.text).toContain("Price: 600.00 GHS");
  });
});
