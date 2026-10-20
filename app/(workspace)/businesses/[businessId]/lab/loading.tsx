export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-4">
      <span className="sr-only">Loading the conversation lab…</span>
      <div className="h-6 w-1/3 rounded bg-zinc-200" />
      <div className="card h-24" />
      <div className="card h-24" />
    </div>
  );
}
