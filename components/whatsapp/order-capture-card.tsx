"use client";

import { useState, useActionState, useRef, useEffect } from "react";
import { createOrderLeadAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert, Chip, Field, Input } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/components/profile/format";
import type { ActionState } from "@/lib/validation/action-state";

export type OrderLeadItem = {
  id: string;
  customerName: string;
  customerPhone: string;
  items: unknown;
  totalGhs: string | number;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  status: string;
  paymentStatus: string;
  receiptRef: string | null;
  createdAt: Date;
  createdBy?: { id: string; name: string; email: string } | null;
};

const STATUS_TONES: Record<string, "success" | "brand" | "danger" | "neutral" | "warning"> = {
  PENDING: "warning",
  CONFIRMED: "brand",
  DELIVERED: "success",
  CANCELLED: "danger",
};

const PAYMENT_TONES: Record<string, "success" | "brand" | "danger" | "neutral" | "warning"> = {
  UNPAID: "danger",
  PAID: "success",
  MOMO_VERIFIED: "success",
  CASH_ON_DELIVERY: "neutral",
};

export function OrderCaptureCard({
  businessId,
  conversationId,
  defaultCustomerName = "",
  defaultCustomerPhone = "",
  existingOrders = [],
}: {
  businessId: string;
  conversationId: string;
  defaultCustomerName?: string;
  defaultCustomerPhone?: string;
  existingOrders?: OrderLeadItem[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createOrderLeadAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setIsOpen(false);
    }
  }, [state]);

  return (
    <section aria-labelledby="order-capture-heading" className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle
          title={
            <span className="flex items-center gap-2">
              <span>Orders &amp; Leads</span>
              {existingOrders.length > 0 && (
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
                  {existingOrders.length}
                </span>
              )}
            </span>
          }
          subtitle="Record customer orders, delivery details, and payment confirmation."
        />
        <Button
          type="button"
          variant={isOpen ? "secondary" : "primary"}
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? "Close Form" : "+ Capture Order / Lead"}
        </Button>
      </div>

      {existingOrders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Recorded Orders for this Customer
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {existingOrders.map((ord) => {
              const itemsList = Array.isArray(ord.items)
                ? (ord.items as Array<{ name: string; quantity: number; priceGhs: number }>)
                : [{ name: String(ord.items ?? "Order Item"), quantity: 1, priceGhs: Number(ord.totalGhs) }];

              return (
                <div
                  key={ord.id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 text-xs space-y-2 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-bold text-zinc-900">
                      GHS {Number(ord.totalGhs).toFixed(2)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Chip tone={STATUS_TONES[ord.status] ?? "neutral"}>
                        {ord.status.toLowerCase()}
                      </Chip>
                      <Chip tone={PAYMENT_TONES[ord.paymentStatus] ?? "neutral"}>
                        {ord.paymentStatus.toLowerCase().replace(/_/g, " ")}
                      </Chip>
                    </div>
                  </div>

                  <div className="text-zinc-700">
                    <span className="font-medium">Items: </span>
                    {itemsList.map((it, idx) => (
                      <span key={idx} className="inline-block bg-white border border-zinc-200 rounded px-1.5 py-0.5 text-[11px] mr-1 mb-1">
                        {it.quantity}x {it.name}
                      </span>
                    ))}
                  </div>

                  {ord.deliveryAddress && (
                    <p className="text-zinc-600">
                      <span className="font-medium text-zinc-800">Delivery:</span> {ord.deliveryAddress}
                    </p>
                  )}

                  {ord.receiptRef && (
                    <p className="text-zinc-600 font-mono text-[11px]">
                      <span className="font-sans font-medium text-zinc-800">MoMo Ref:</span> {ord.receiptRef}
                    </p>
                  )}

                  <div className="text-[11px] text-zinc-400 flex items-center justify-between pt-1 border-t border-zinc-100">
                    <span>{fmtDateTime(ord.createdAt)}</span>
                    {ord.createdBy && <span>By {ord.createdBy.name}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isOpen && (
        <form ref={formRef} action={action} className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="conversationId" value={conversationId} />
          <h3 className="text-sm font-semibold text-brand-950">Record New Customer Order</h3>

          {state.error && <Alert>{state.error}</Alert>}
          {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer Name">
              <Input name="customerName" defaultValue={defaultCustomerName} required placeholder="Akua Mensah" />
            </Field>
            <Field label="Customer Phone">
              <Input name="customerPhone" defaultValue={defaultCustomerPhone} required placeholder="+233244123456" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Field label="Item(s) Ordered" hint="e.g. 2x Cocoa Butter, 1x Black Soap">
                <Input name="itemName" required placeholder="1x Product / Package" />
              </Field>
            </div>
            <div>
              <Field label="Total Amount (GHS)" hint="e.g. 150">
                <Input name="totalGhs" type="number" step="0.01" min="0" required placeholder="0.00" />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Delivery Address" hint="Pickup station or street address">
              <Input name="deliveryAddress" placeholder="Spintex Road, Shell signpost" />
            </Field>
            <Field label="Delivery Notes">
              <Input name="deliveryNotes" placeholder="Delivery before 3pm" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="status" className="block text-xs font-semibold text-zinc-700 mb-1">
                Order Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue="PENDING"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="DELIVERED">Delivered</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label htmlFor="paymentStatus" className="block text-xs font-semibold text-zinc-700 mb-1">
                Payment Status
              </label>
              <select
                id="paymentStatus"
                name="paymentStatus"
                defaultValue="UNPAID"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="UNPAID">Unpaid</option>
                <option value="PAID">Paid</option>
                <option value="MOMO_VERIFIED">MoMo Verified</option>
                <option value="CASH_ON_DELIVERY">Cash on Delivery</option>
              </select>
            </div>

            <Field label="Payment / MoMo Ref">
              <Input name="receiptRef" placeholder="MTN MoMo Trans ID (optional)" />
            </Field>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving Order…" : "Save Order Lead"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
