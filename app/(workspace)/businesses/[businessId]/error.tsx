"use client";

export default function BusinessError({ reset }: { error: Error; reset: () => void }) {
  // Never render error.message: it may contain internals.
  return (
    <section role="alert" className="rounded-md border border-red-300 bg-red-50 p-6 text-sm text-red-900">
      <h1 className="mb-1 text-lg font-semibold">Something went wrong</h1>
      <p className="mb-3">We couldn&apos;t load this page. Try again, and if it keeps happening let an administrator know.</p>
      <button type="button" onClick={reset} className="rounded-md bg-red-900 px-3 py-1.5 text-white">
        Try again
      </button>
    </section>
  );
}
