import { ActionButton } from "@/components/profile/action-button";
import { ItemBadge } from "@/components/profile/status-badge";
import { CardTitle } from "@/components/ui/card";
import { Alert, Chip } from "@/components/ui/field";
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
          <p className="font-semibold text-red-950">Price discrepancies detected between Catalogue and FAQs:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-900">
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-4 sm:p-5">
            <CardTitle title="Add product or service" subtitle="New items start as drafts; approve them to make them answerable." />
            <CatalogueItemForm businessId={businessId} />
          </section>

          <section className="card p-4 sm:p-5">
            <CardTitle title="Bulk import items (CSV)" subtitle="Import many items at once without overwriting approved facts." />
            <CatalogueImportForm businessId={businessId} />
          </section>
        </div>
      )}

      {/* Item List */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            Catalogue items <span className="font-normal text-zinc-500">({items.length})</span>
          </h2>
          <span className="text-xs text-zinc-500">
            Only approved items are used by LightDesk to answer customer enquiries.
          </span>
        </div>

        {items.length === 0 ? (
          <p className="card border-dashed p-6 text-center text-sm text-zinc-600">
            No catalogue items yet. Add products or import a CSV list to let LightDesk answer price and stock questions.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => {
              const isApproved = item.state === "APPROVED";
              const priceDisplay = Number(item.priceGhs).toFixed(2);
              const approvedPriceDisplay = item.approvedPriceGhs
                ? Number(item.approvedPriceGhs).toFixed(2)
                : null;

              return (
                <li key={item.id} className="card p-4 sm:p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold text-zinc-900">{item.name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <ItemBadge status={isApproved ? "approved" : "draft"} />
                          <Chip tone={item.inStock ? "success" : "danger"} withDot>
                            {item.inStock ? "In stock" : "Out of stock"}
                          </Chip>
                          {item.category && <Chip tone="neutral">{item.category}</Chip>}
                          {item.sku && (
                            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 border border-zinc-200/60">
                              SKU: {item.sku}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="whitespace-nowrap text-lg font-bold tabular-nums text-zinc-900">
                          {priceDisplay} <span className="text-xs font-medium text-zinc-500">GHS</span>
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 min-w-0 text-xs sm:text-sm text-zinc-600 space-y-1">
                      {item.variants && (
                        <p>
                          <span className="font-semibold text-zinc-700">Variants:</span> {item.variants}
                        </p>
                      )}
                      {item.description && (
                        <p className="break-words text-zinc-500 text-xs leading-relaxed">{item.description}</p>
                      )}
                      {!isApproved && approvedPriceDisplay && (
                        <p className="text-xs text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                          Pending edit: Working price is {priceDisplay} GHS (Approved in-force price: {approvedPriceDisplay} GHS).
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 pt-3">
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
