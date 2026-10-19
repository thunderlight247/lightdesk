import { Header } from "@/components/workspace/header";
import { requireUserForPage } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserForPage();
  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </>
  );
}
