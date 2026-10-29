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
      <span className="mb-1.5 block font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">{hint}</span>}
      {errors?.map((e) => (
        <span key={e} className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {e}
        </span>
      ))}
    </label>
  );
}

// text-base on mobile avoids iOS Safari auto-zoom; sm:text-sm for desktop precision
const control =
  "w-full rounded-xl border border-zinc-300/90 bg-white px-3.5 py-2.5 text-base sm:text-sm text-zinc-900 shadow-xs transition duration-150 placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500";

export function Input({ className = "", ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} className={`${control} ${className}`} {...props} />;
}
export function Textarea({ className = "", ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={`${control} ${className}`} {...props} />;
}
export function Select({ className = "", ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { ref?: React.Ref<HTMLSelectElement> }) {
  return <select ref={ref} className={`${control} ${className}`} {...props} />;
}

const TONES = {
  error: {
    container: "border-red-200/80 bg-red-50/80 text-red-900",
    icon: (
      <svg className="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  info: {
    container: "border-amber-200/80 bg-amber-50/80 text-amber-950",
    icon: (
      <svg className="h-4 w-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  success: {
    container: "border-emerald-200/80 bg-emerald-50/80 text-emerald-950",
    icon: (
      <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
} as const;

export function Alert({
  children,
  tone = "error",
  className = "",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm leading-relaxed ${t.container} ${className}`}
    >
      <div className="mt-0.5">{t.icon}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type ChipTone = "neutral" | "brand" | "success" | "warning" | "danger" | "sky";

const CHIP: Record<ChipTone, { bg: string; dot: string }> = {
  neutral: { bg: "bg-zinc-100/90 text-zinc-700 border-zinc-200/60", dot: "bg-zinc-400" },
  brand: { bg: "bg-brand-50 text-brand-800 border-brand-200/60", dot: "bg-brand-500" },
  success: { bg: "bg-emerald-50 text-emerald-800 border-emerald-200/60", dot: "bg-emerald-500" },
  warning: { bg: "bg-amber-50 text-amber-900 border-amber-200/60", dot: "bg-amber-500" },
  danger: { bg: "bg-red-50 text-red-800 border-red-200/60", dot: "bg-red-500" },
  sky: { bg: "bg-sky-50 text-sky-800 border-sky-200/60", dot: "bg-sky-500" },
};

/** Small status pill. Used for roles, states and meta labels. */
export function Chip({
  tone = "neutral",
  className = "",
  withDot = false,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  withDot?: boolean;
  children: React.ReactNode;
}) {
  const c = CHIP[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight ${c.bg} ${className}`}
    >
      {withDot && <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden />}
      {children}
    </span>
  );
}
