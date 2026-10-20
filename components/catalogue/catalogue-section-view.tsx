import { ActionButton } from "@/components/profile/action-button";
import { ItemBadge } from "@/components/profile/status-badge";
import { Alert } from "@/components/ui/field";
import {
  approveCatalogueItemAction,
  deleteCatalogueItemAction,
} from "@/app/(workspace)/businesses/[businessId]/profile/catalogue-actions";
import { CatalogueImportForm } from "@/components/catalogue/catalogue-import-form";
import { CatalogueItemForm } from "@/components/catalogue/catalogue-item-form";
import type { PriceConflict } from "@/modules/catalogue/types";

export type CatalogueItemView = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  priceGhs: number | string;
  currency: string;
  inStock: boolean;
  variants: string | null;
  sku: string | null;
  state: "DRAFT" | "APPROVED";
  approvedName: string | null;
  approvedPriceGhs: number | string | null;
  approvedInStock: boolean | null;
  approvedVariants: string | null;
  revision: number;
};

export function CatalogueSectionView({
  businessId,
  items,
  conflicts,
  canEdit,
  canApprove,
}: {
  businessId: string;
  items: CatalogueItemView[];
  conflicts: PriceConflict[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Price conflicts alert */}
      {conflicts.length > 0 && (
        <Alert tone="error">
          <p className="font-medium">Price discrepancies detected between Catalogue and FAQs:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {conflicts.map((c) => (
              <li key={`${c.catalogueItemId}-${c.faqId}`}>
                <strong>{c.productName}</strong>: Catalogue price is <strong>{c.cataloguePriceGhs.toFixed(2)} GHS</strong>, but FAQ &quot;{c.faqQuestion}&quot; mentions <strong>{c.extractedPrice.toFixed(2)} GHS</strong>.
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Forms (Edit / Import) */}
      {canEdit && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-md border bg-white p-4">
            <h2 className="mb-3 font-medium">Add product or service</h2>
            <CatalogueItemForm businessId={businessId} />
          </section>

          <section className="rounded-md border bg-white p-4">
            <h2 className="mb-3 font-medium">Bulk import items (CSV)</h2>
            <CatalogueImportForm businessId={businessId} />
          </section>
        </div>
      )}

      {/* Item List */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Catalogue items ({items.length})</h2>
          <span className="text-xs text-neutral-500">
            Only approved items are used by LightDesk to answer customer enquiries.
          </span>
        </div>

        {items.length === 0 ? (
          <p className="rounded-md border border-dashed bg-white p-6 text-center text-sm text-neutral-600">
            No catalogue items yet. Add products or import a CSV list to let LightDesk answer price and stock questions.
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const isApproved = item.state === "APPROVED";
              const priceDisplay = Number(item.priceGhs).toFixed(2);
              const approvedPriceDisplay = item.approvedPriceGhs
                ? Number(item.approvedPriceGhs).toFixed(2)
                : null;

              return (
                <li key={item.id} className="rounded-md border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-neutral-900">{item.name}</span>
                        <ItemBadge status={isApproved ? "approved" : "draft"} />
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            item.inStock
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {item.inStock ? "In stock" : "Out of stock"}
                        </span>
                        {item.category && (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                            {item.category}
                          </span>
                        )}
                        {item.sku && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-mono text-neutral-600">
                            SKU: {item.sku}
                          </span>
                        )}
                      </div>

                      {item.variants && (
                        <p className="mt-1 text-xs text-neutral-600">
                          <span className="font-medium">Variants:</span> {item.variants}
                        </p>
                      )}

                      {item.description && (
                        <p className="mt-1 text-xs text-neutral-500">{item.description}</p>
                      )}

                      {!isApproved && approvedPriceDisplay && (
                        <p className="mt-1 text-xs text-amber-700">
                          Pending edit: Working price is {priceDisplay} GHS (Approved in-force price: {approvedPriceDisplay} GHS).
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-bold text-neutral-900">
                        {priceDisplay} <span className="text-xs font-normal text-neutral-500">GHS</span>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        {!isApproved && canApprove && (
                          <ActionButton
                            action={approveCatalogueItemAction}
                            fields={{ businessId, itemId: item.id }}
                            label="Approve item"
                            pendingLabel="Approving…"
                            variant="primary"
                          />
                        )}
                        {canEdit && (
                          <ActionButton
                            action={deleteCatalogueItemAction}
                            fields={{ businessId, itemId: item.id }}
                            label="Delete"
                            pendingLabel="Deleting…"
                            variant="danger"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
