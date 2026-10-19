export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-4">
      <span className="sr-only">Loading profile…</span>
      <div className="h-6 w-1/3 rounded bg-neutral-200" />
      <div className="h-32 rounded bg-neutral-200" />
      <div className="h-32 rounded bg-neutral-200" />
    </div>
  );
}
