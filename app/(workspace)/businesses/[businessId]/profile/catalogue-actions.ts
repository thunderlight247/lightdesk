"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { stageBulkImport } from "@/modules/catalogue/import";
import {
  approveCatalogueItem,
  deleteCatalogueItem,
  saveCatalogueItem,
  toggleCatalogueItemStock,
} from "@/modules/catalogue/service";

async function run(
  formData: FormData,
  fn: (userId: string, businessId: string) => Promise<string>,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const message = await fn(user.id, businessId);
    revalidatePath(`/businesses/${businessId}/profile`, "layout");
    return { ok: true, message };
  } catch (err) {
    return actionError(err);
  }
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

export async function saveCatalogueItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (userId, businessId) => {
    const itemId = str(fd, "itemId") || undefined;
    const name = str(fd, "name");
    const priceGhs = str(fd, "priceGhs");
    const category = str(fd, "category") || undefined;
    const description = str(fd, "description") || undefined;
    const variants = str(fd, "variants") || undefined;
    const sku = str(fd, "sku") || undefined;
    const inStock = fd.get("inStock") === "true" || fd.get("inStock") === "on";

    const { duplicateWarning } = await saveCatalogueItem(
      userId,
      businessId,
      {
        name,
        priceGhs: Number(priceGhs),
        category,
        description,
        variants,
        sku,
        inStock,
        currency: "GHS",
      },
      itemId,
    );

    let msg = itemId ? "Catalogue item updated as draft." : "Catalogue item created as draft.";
    if (duplicateWarning) msg += ` Note: ${duplicateWarning}`;
    return msg;
  });
}

export async function approveCatalogueItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (userId, businessId) => {
    const itemId = str(fd, "itemId");
    await approveCatalogueItem(userId, businessId, itemId);
    return "Catalogue item approved for use.";
  });
}

export async function toggleCatalogueItemStockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (userId, businessId) => {
    const itemId = str(fd, "itemId");
    const item = await toggleCatalogueItemStock(userId, businessId, itemId);
    return `Item marked as ${item.inStock ? "in stock" : "out of stock"}.`;
  });
}

export async function deleteCatalogueItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (userId, businessId) => {
    const itemId = str(fd, "itemId");
    await deleteCatalogueItem(userId, businessId, itemId);
    return "Catalogue item deleted.";
  });
}

export async function stageBulkImportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (userId, businessId) => {
    const csvContent = str(fd, "csvContent");
    const summary = await stageBulkImport(userId, businessId, csvContent);
    let msg = `Successfully staged ${summary.stagedCount} items as drafts.`;
    if (summary.errors.length > 0) {
      msg += ` (${summary.errors.length} rows had errors).`;
    }
    if (summary.duplicateWarnings.length > 0) {
      msg += ` (${summary.duplicateWarnings.length} duplicates detected).`;
    }
    return msg;
  });
}
