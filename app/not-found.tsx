import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-sm p-6 pt-20">
      <h1 className="mb-2 text-xl font-semibold">Page not found</h1>
      <p className="mb-4 text-sm text-neutral-600">
        It may not exist, or you may not have access to it.
      </p>
      <Link href="/businesses" className="underline">
        Back to your businesses
      </Link>
    </main>
  );
}
