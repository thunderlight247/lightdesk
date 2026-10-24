"use client";

import { useActionState, useEffect, useRef } from "react";
import { stageBulkImportAction } from "@/app/(workspace)/businesses/[businessId]/profile/catalogue-actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function CatalogueImportForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(stageBulkImportAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

      <div className="rounded bg-neutral-50 p-2 text-xs text-neutral-600">
        <p className="font-medium text-neutral-800">CSV format guidelines:</p>
        <p>Columns: <code>name</code>, <code>price</code>, <code>category</code>, <code>inStock</code>, <code>variants</code>, <code>sku</code></p>
        <p className="mt-1 text-neutral-500">All imported items enter as <strong>drafts</strong>; existing approved facts are never silently overwritten.</p>
      </div>

      <Field label="Paste CSV rows here" hint="Include header row. Quoted values with commas are supported.">
        <Textarea
          name="csvContent"
          rows={6}
          required
          placeholder="Paste CSV data with a header row"
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Staging import…" : "Stage items for review"}
      </Button>
    </form>
  );
}
