import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { recordAudit } from "@/modules/audit/service";
import { compareForm } from "@/modules/business-profile/text";
import {
  type CatalogueItemInput,
  CatalogueItemInputSchema,
  type ImportSummary,
} from "@/modules/catalogue/types";
import { requireMembership } from "@/modules/permissions/access";
import { can } from "@/modules/permissions/roles";

/** Parses simple CSV lines with support for quoted strings and commas */
export function parseCsvLines(csv: string): string[][] {
  const lines: string[][] = [];
  const rawLines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of rawLines) {
    const row: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    lines.push(row);
  }

  return lines;
}

export function parseCatalogueCsv(csvContent: string): {
  validRows: { rowNumber: number; data: CatalogueItemInput }[];
  errors: { row: number; error: string }[];
} {
  const table = parseCsvLines(csvContent);
  if (table.length === 0) {
    return { validRows: [], errors: [{ row: 0, error: "CSV file is empty" }] };
  }

  const header = table[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const nameIdx = header.findIndex((h) => h === "name" || h === "productname" || h === "item");
  const priceIdx = header.findIndex((h) => h === "price" || h === "priceghs" || h === "cost" || h === "amount");
  const catIdx = header.findIndex((h) => h === "category" || h === "type");
  const descIdx = header.findIndex((h) => h === "description" || h === "desc");
  const stockIdx = header.findIndex((h) => h === "instock" || h === "stock" || h === "available");
  const varIdx = header.findIndex((h) => h === "variants" || h === "variant" || h === "sizes" || h === "options");
  const skuIdx = header.findIndex((h) => h === "sku" || h === "code");

  if (nameIdx === -1 || priceIdx === -1) {
    return {
      validRows: [],
      errors: [{ row: 1, error: "Header must contain at least 'name' and 'price' columns" }],
    };
  }

  const validRows: { rowNumber: number; data: CatalogueItemInput }[] = [];
  const errors: { row: number; error: string }[] = [];

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const rawName = row[nameIdx] ?? "";
    const rawPrice = row[priceIdx] ?? "";
    const rawCat = catIdx >= 0 ? row[catIdx] : undefined;
    const rawDesc = descIdx >= 0 ? row[descIdx] : undefined;
    const rawStock = stockIdx >= 0 ? row[stockIdx] : "true";
    const rawVar = varIdx >= 0 ? row[varIdx] : undefined;
    const rawSku = skuIdx >= 0 ? row[skuIdx] : undefined;

    // Clean price (remove GHS, $, etc.)
    const cleanedPrice = rawPrice.replace(/[^\d.-]/g, "");

    const inStock = !/^(false|0|no|out of stock|out)$/i.test(rawStock.trim());

    const parseResult = CatalogueItemInputSchema.safeParse({
      name: rawName,
      priceGhs: cleanedPrice,
      category: rawCat || undefined,
      description: rawDesc || undefined,
      inStock,
      variants: rawVar || undefined,
      sku: rawSku || undefined,
    });

    if (parseResult.success) {
      validRows.push({ rowNumber: r + 1, data: parseResult.data });
    } else {
      errors.push({
        row: r + 1,
        error: parseResult.error.errors.map((e) => e.message).join(", "),
      });
    }
  }

  return { validRows, errors };
}

/**
 * Stages bulk-imported catalogue items into DRAFT state.
 * Never silently overwrites approved catalogue items.
 */
export async function stageBulkImport(
  actorId: string,
  businessId: string,
  csvContent: string,
): Promise<ImportSummary> {
  const membership = await requireMembership(actorId, businessId);
  if (!can(membership.role, "profile:edit")) {
    throw new ForbiddenError();
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { businessId },
    include: { catalogueItems: true },
  });
  if (!profile) throw new NotFoundError("Business profile not found");

  const { validRows, errors } = parseCatalogueCsv(csvContent);
  const duplicateWarnings: ImportSummary["duplicateWarnings"] = [];

  const existingMap = new Map<string, string>();
  for (const item of profile.catalogueItems) {
    existingMap.set(item.normalizedName, item.id);
  }

  let stagedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const { rowNumber, data } of validRows) {
      const normalizedName = compareForm(data.name);

      if (existingMap.has(normalizedName)) {
        duplicateWarnings.push({
          row: rowNumber,
          name: data.name,
          existingItemId: existingMap.get(normalizedName)!,
        });
      }

      await tx.catalogueItem.create({
        data: {
          profileId: profile.id,
          name: data.name,
          description: data.description,
          category: data.category,
          priceGhs: data.priceGhs,
          currency: data.currency,
          inStock: data.inStock,
          variants: data.variants,
          sku: data.sku,
          normalizedName,
          state: "DRAFT",
          createdById: actorId,
          updatedById: actorId,
        },
      });

      existingMap.set(normalizedName, "new");
      stagedCount++;
    }

    await tx.businessProfile.update({
      where: { id: profile.id },
      data: { revision: { increment: 1 } },
    });

    await recordAudit(tx, {
      action: "catalogue.bulk_staged",
      actorUserId: actorId,
      businessId,
      targetType: "BusinessProfile",
      targetId: profile.id,
      metadata: {
        totalRows: validRows.length + errors.length,
        stagedCount,
        errorCount: errors.length,
        duplicateCount: duplicateWarnings.length,
      },
    });
  });

  return {
    totalRows: validRows.length + errors.length,
    stagedCount,
    errors,
    duplicateWarnings,
  };
}
