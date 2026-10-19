import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Field({
  label,
  errors,
  hint,
  children,
}: {
  label: string;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-neutral-600">{hint}</span>}
      {errors?.map((e) => (
        <span key={e} className="mt-1 block text-red-700">
          {e}
        </span>
      ))}
    </label>
  );
}

const control =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={control} {...props} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={control} {...props} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={control} {...props} />;
}

const TONES = {
  error: "border-red-300 bg-red-50 text-red-800",
  info: "border-amber-300 bg-amber-50 text-amber-900",
  success: "border-green-300 bg-green-50 text-green-900",
} as const;

export function Alert({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  // errors interrupt (alert); success/info are polite status updates
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border p-3 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  );
}
