"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { updateOrderLeadStatusAction, createOrderLeadAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert, Chip, Field, Input } from "@/components/ui/field";
import { fmtDateTime } from "@/components/profile/format";
import type { ActionState } from "@/lib/validation/action-state";
import type { OrderLeadItem } from "@/components/whatsapp/order-capture-card";

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

export function OrdersManager({
  businessId,
  orders,
}: {
  businessId: string;
  orders: (OrderLeadItem & { conversationId?: string | null })[];
}) {
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [createState, createAction, createPending] = useActionState<ActionState, FormData>(createOrderLeadAction, {});
  const [updateState, updateAction, updatePending] = useActionState<ActionState, FormData>(updateOrderLeadStatusAction, {});

  const filteredOrders = filterStatus === "ALL" ? orders : orders.filter((o) => o.status === filterStatus);

  const totalGhs = orders.reduce((sum, o) => sum + Number(o.totalGhs), 0);
  const pendingCount = orders.filter((o) => o.status === "PENDING").length;
  const paidCount = orders.filter((o) => o.paymentStatus === "PAID" || o.paymentStatus === "MOMO_VERIFIED").length;

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="card p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Orders</p>
          <p className="mt-1 text-2xl font-bold text-zinc-900">{orders.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Recorded Revenue</p>
          <p className="mt-1 text-2xl font-bold text-brand-600">GHS {totalGhs.toFixed(2)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Pending Orders</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{pendingCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Paid / Verified</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{paidCount}</p>
        </div>
      </div>

      {/* Action Bar & Filter Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {["ALL", "PENDING", "CONFIRMED", "DELIVERED", "CANCELLED"].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilterStatus(status)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                filterStatus === status
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {status === "ALL" ? "All Orders" : status.toLowerCase()}
              {status !== "ALL" && (
                <span className="ml-1 opacity-70">
                  ({orders.filter((o) => o.status === status).length})
                </span>
              )}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="primary"
          onClick={() => setShowCreateModal(!showCreateModal)}
        >
          {showCreateModal ? "Close" : "+ Record New Order"}
        </Button>
      </div>

      {createState.error && <Alert>{createState.error}</Alert>}
      {createState.ok && createState.message && <Alert tone="success">{createState.message}</Alert>}
      {updateState.error && <Alert>{updateState.error}</Alert>}
      {updateState.ok && updateState.message && <Alert tone="success">{updateState.message}</Alert>}

      {/* Manual Create Form */}
      {showCreateModal && (
        <form
          action={async (formData) => {
            await createAction(formData);
            setShowCreateModal(false);
          }}
          className="card p-5 sm:p-6 space-y-4 border-brand-200 bg-brand-50/30"
        >
          <input type="hidden" name="businessId" value={businessId} />
          <h2 className="text-sm font-semibold text-zinc-900">Record Walk-in or Manual Order</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer Name">
              <Input name="customerName" required placeholder="Kwame Mensah" />
            </Field>
            <Field label="Customer Phone">
              <Input name="customerPhone" required placeholder="+233244123456" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Field label="Item(s) Ordered">
                <Input name="itemName" required placeholder="2x Hair Food 200ml" />
              </Field>
            </div>
            <div>
              <Field label="Total Amount (GHS)">
                <Input name="totalGhs" type="number" step="0.01" min="0" required placeholder="0.00" />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Delivery Address">
              <Input name="deliveryAddress" placeholder="Osu, Oxford Street" />
            </Field>
            <Field label="Delivery Notes">
              <Input name="deliveryNotes" placeholder="Payment via MoMo on arrival" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="modal-status" className="block text-xs font-semibold text-zinc-700 mb-1">Status</label>
              <select id="modal-status" name="status" defaultValue="PENDING" className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="DELIVERED">Delivered</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div>
              <label htmlFor="modal-payment" className="block text-xs font-semibold text-zinc-700 mb-1">Payment</label>
              <select id="modal-payment" name="paymentStatus" defaultValue="UNPAID" className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                <option value="UNPAID">Unpaid</option>
                <option value="PAID">Paid</option>
                <option value="MOMO_VERIFIED">MoMo Verified</option>
                <option value="CASH_ON_DELIVERY">Cash on Delivery</option>
              </select>
            </div>
            <Field label="MoMo / Payment Ref">
              <Input name="receiptRef" placeholder="Transaction ref (optional)" />
            </Field>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={createPending}>
              {createPending ? "Saving…" : "Save Order"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Orders List / Table */}
      {filteredOrders.length === 0 ? (
        <div className="card border-dashed p-8 text-center text-sm text-zinc-500">
          No orders found matching the selected filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const isEditing = editingOrderId === order.id;
            const itemsList = Array.isArray(order.items)
              ? (order.items as Array<{ name: string; quantity: number; priceGhs: number }>)
              : [{ name: String(order.items ?? "Order Item"), quantity: 1, priceGhs: Number(order.totalGhs) }];

            return (
              <div
                key={order.id}
                className="card p-4 sm:p-5 space-y-3 transition-colors hover:border-zinc-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-zinc-900 text-sm">{order.customerName}</span>
                      <span className="text-xs text-zinc-500">{order.customerPhone}</span>
                      <Chip tone={STATUS_TONES[order.status] ?? "neutral"}>
                        {order.status.toLowerCase()}
                      </Chip>
                      <Chip tone={PAYMENT_TONES[order.paymentStatus] ?? "neutral"}>
                        {order.paymentStatus.toLowerCase().replace(/_/g, " ")}
                      </Chip>
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs text-zinc-600">
                      {itemsList.map((it, idx) => (
                        <span key={idx} className="bg-zinc-100 rounded px-1.5 py-0.5">
                          {it.quantity}x {it.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-base font-bold text-zinc-900">
                      GHS {Number(order.totalGhs).toFixed(2)}
                    </p>
                    <time className="text-[11px] text-zinc-400">
                      {fmtDateTime(order.createdAt)}
                    </time>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-600 bg-zinc-50/70 p-2.5 rounded-lg">
                  {order.deliveryAddress && (
                    <p>
                      <span className="font-semibold text-zinc-700">Delivery Address:</span> {order.deliveryAddress}
                    </p>
                  )}
                  {order.deliveryNotes && (
                    <p>
                      <span className="font-semibold text-zinc-700">Notes:</span> {order.deliveryNotes}
                    </p>
                  )}
                  {order.receiptRef && (
                    <p className="font-mono">
                      <span className="font-sans font-semibold text-zinc-700">Payment Ref:</span> {order.receiptRef}
                    </p>
                  )}
                  {order.conversationId && (
                    <p>
                      <Link
                        href={`/businesses/${businessId}/whatsapp/${order.conversationId}`}
                        className="text-brand-600 hover:text-brand-800 underline font-medium"
                      >
                        → View WhatsApp Conversation
                      </Link>
                    </p>
                  )}
                </div>

                {isEditing ? (
                  <form
                    action={async (formData) => {
                      await updateAction(formData);
                      setEditingOrderId(null);
                    }}
                    className="pt-3 border-t border-zinc-100 flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="orderId" value={order.id} />

                    <select
                      name="status"
                      defaultValue={order.status}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs"
                    >
                      <option value="PENDING">Pending</option>
                      <option value="CONFIRMED">Confirmed</option>
                      <option value="DELIVERED">Delivered</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>

                    <select
                      name="paymentStatus"
                      defaultValue={order.paymentStatus}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs"
                    >
                      <option value="UNPAID">Unpaid</option>
                      <option value="PAID">Paid</option>
                      <option value="MOMO_VERIFIED">MoMo Verified</option>
                      <option value="CASH_ON_DELIVERY">Cash on Delivery</option>
                    </select>

                    <input
                      name="receiptRef"
                      defaultValue={order.receiptRef ?? ""}
                      placeholder="MoMo ref"
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs"
                    />

                    <Button type="submit" disabled={updatePending}>
                      {updatePending ? "Saving…" : "Update"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setEditingOrderId(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-zinc-400">
                      {order.createdBy ? `Recorded by ${order.createdBy.name}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingOrderId(order.id)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-800 underline"
                    >
                      Update status or payment
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
