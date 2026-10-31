import { Header } from "@/components/workspace/header";
import { requireUserForPage } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserForPage();
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/60">
      <Header user={user} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-zinc-200/60 bg-white/50 py-6 text-center text-xs text-zinc-400">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          LightDesk · test mode: AI drafts are sent only after owner approval
        </div>
      </footer>
    </div>
  );
}
