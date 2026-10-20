import { Header } from "@/components/workspace/header";
import { requireUserForPage } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserForPage();
  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-zinc-400 sm:px-6">
        LightDesk · drafts are simulations until a live channel is connected and approved by the owner
      </footer>
    </>
  );
}
