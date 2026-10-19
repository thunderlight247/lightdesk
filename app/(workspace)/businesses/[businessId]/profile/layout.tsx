import { SectionNav } from "@/components/profile/section-nav";
import { SECTIONS } from "@/modules/business-profile/catalog";

/** Navigation only. Every page below performs its own authentication and membership checks. */
export default async function ProfileLayout({ children, params }: { children: React.ReactNode; params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const base = `/businesses/${encodeURIComponent(businessId)}/profile`;
  return (
    <div>
      <SectionNav items={[{ href: base, label: "Overview", exact: true }, ...SECTIONS.map((s) => ({ href: `${base}/${s.slug}`, label: s.title }))]} />
      {children}
    </div>
  );
}
