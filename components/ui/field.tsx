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
      <span className="mb-1 block font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
      {errors?.map((e) => (
        <span key={e} className="mt-1 block text-xs text-red-700">
          {e}
        </span>
      ))}
    </label>
  );
}

const control =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition-colors placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500";

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
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-amber-200 bg-amber-50 text-amber-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
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
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  );
}

type ChipTone = "neutral" | "brand" | "success" | "warning" | "danger" | "sky";

const CHIP: Record<ChipTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  brand: "bg-brand-50 text-brand-800",
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-900",
  danger: "bg-red-50 text-red-800",
  sky: "bg-sky-50 text-sky-800",
};

/** Small status pill. Used for roles, states and meta labels. */
export function Chip({ tone = "neutral", className = "", children }: { tone?: ChipTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP[tone]} ${className}`}>
      {children}
    </span>
  );
}
