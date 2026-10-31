import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui/card";
import { OrdersManager } from "@/components/orders/orders-manager";
import { requireUserForPage, loadMembershipOrNotFound } from "@/lib/auth/guards";
import { businessIdSchema } from "@/lib/validation/schemas";
import { listOrderLeads } from "@/modules/frontline/orders";

export default async function BusinessOrdersPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const user = await requireUserForPage();
  const { businessId: rawBusinessId } = await params;
  const parsed = businessIdSchema.safeParse(rawBusinessId);
  if (!parsed.success) notFound();
  const businessId = parsed.data;

  await loadMembershipOrNotFound(user.id, businessId);
  const rawOrders = await listOrderLeads(user.id, businessId);

  const orders = rawOrders.map((o) => ({
    ...o,
    totalGhs: Number(o.totalGhs),
  }));

  return (
    <div className="space-y-6">
      <PageHeading
        title="Orders &amp; Leads"
        lead="LightDesk frontline mini-CRM. Track customer orders captured on WhatsApp, delivery fulfillment, and Mobile Money payments in one unified place."
      />

      <OrdersManager businessId={businessId} orders={orders} />
    </div>
  );
}
