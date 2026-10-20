"use client";

export default function BusinessError({ reset }: { error: Error; reset: () => void }) {
  // Never render error.message: it may contain internals.
  return (
    <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold text-red-900">Something went wrong</h1>
      <p className="mb-4">We couldn&apos;t load this page. Try again, and if it keeps happening let an administrator know.</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        Try again
      </button>
    </section>
  );
}
