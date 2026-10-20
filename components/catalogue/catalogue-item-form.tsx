"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveCatalogueItemAction } from "@/app/(workspace)/businesses/[businessId]/profile/catalogue-actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function CatalogueItemForm({
  businessId,
  item,
}: {
  businessId: string;
  item?: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    priceGhs: number | string;
    inStock: boolean;
    variants: string | null;
    sku: string | null;
    revision: number;
  };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCatalogueItemAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!item && state.ok) ref.current?.reset();
  }, [item, state]);

  const rev = item ? `${item.id}-${item.revision}` : "new";

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="businessId" value={businessId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Product or service name" errors={state.fieldErrors?.name}>
          <Input
            key={`n-${rev}`}
            name="name"
            required
            maxLength={120}
            defaultValue={item?.name ?? ""}
            placeholder="e.g. iPhone 13 128GB or African Print Maxi Dress"
          />
        </Field>

        <Field label="Price in GHS" errors={state.fieldErrors?.priceGhs} hint="Official price in Ghana Cedis.">
          <Input
            key={`p-${rev}`}
            name="priceGhs"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={item ? String(item.priceGhs) : ""}
            placeholder="e.g. 450.00"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Category (optional)" errors={state.fieldErrors?.category}>
          <Input
            key={`c-${rev}`}
            name="category"
            maxLength={80}
            defaultValue={item?.category ?? ""}
            placeholder="e.g. Phones, Footwear"
          />
        </Field>

        <Field label="Variants (optional)" errors={state.fieldErrors?.variants} hint="Sizes, colors, or options.">
          <Input
            key={`v-${rev}`}
            name="variants"
            maxLength={200}
            defaultValue={item?.variants ?? ""}
            placeholder="e.g. Sizes 40-44 | Colors: Black, Blue"
          />
        </Field>

        <Field label="SKU / Item code (optional)" errors={state.fieldErrors?.sku}>
          <Input
            key={`s-${rev}`}
            name="sku"
            maxLength={50}
            defaultValue={item?.sku ?? ""}
            placeholder="e.g. NKE-402-BLK"
          />
        </Field>
      </div>

      <div className="flex items-center gap-2.5">
        <input
          id={`stock-${rev}`}
          type="checkbox"
          name="inStock"
          value="true"
          defaultChecked={item ? item.inStock : true}
          className="h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
        />
        <label htmlFor={`stock-${rev}`} className="text-sm font-medium text-zinc-800">
          Currently in stock / available
        </label>
      </div>

      <Field label="Description (optional)" errors={state.fieldErrors?.description}>
        <Textarea
          key={`d-${rev}`}
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={item?.description ?? ""}
          placeholder="Brief details or specifications."
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : item ? "Save working draft" : "Add item as draft"}
      </Button>
    </form>
  );
}
