import { z } from "zod";

export const ReviewStateEnum = z.enum(["DRAFT", "APPROVED"]);
export type ReviewState = z.infer<typeof ReviewStateEnum>;

export const CatalogueItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be at most 120 characters"),
  description: z.string().trim().max(500, "Description must be at most 500 characters").optional().nullable(),
  category: z.string().trim().max(80, "Category must be at most 80 characters").optional().nullable(),
  priceGhs: z.coerce.number().min(0, "Price must be non-negative").max(10_000_000, "Price exceeds maximum"),
  currency: z.string().trim().max(10).default("GHS"),
  inStock: z.boolean().default(true),
  variants: z.string().trim().max(200, "Variants must be at most 200 characters").optional().nullable(),
  sku: z.string().trim().max(50, "SKU must be at most 50 characters").optional().nullable(),
});

export type CatalogueItemInput = z.infer<typeof CatalogueItemInputSchema>;

export type CatalogueFilter = {
  search?: string;
  category?: string;
  inStock?: boolean;
  state?: ReviewState;
};

export type ImportRowResult = {
  row: number;
  data?: CatalogueItemInput;
  error?: string;
};

export type ImportSummary = {
  totalRows: number;
  stagedCount: number;
  errors: { row: number; error: string }[];
  duplicateWarnings: { row: number; name: string; existingItemId: string }[];
};

export type PriceConflict = {
  catalogueItemId: string;
  productName: string;
  cataloguePriceGhs: number;
  faqId: string;
  faqQuestion: string;
  faqText: string;
  extractedPrice: number;
};
