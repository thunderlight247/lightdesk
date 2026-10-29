import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 disabled:hover:bg-brand-600 focus-visible:ring-brand-500",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 shadow-xs hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 focus-visible:ring-zinc-400",
  danger:
    "border border-red-200 bg-white text-red-700 shadow-xs hover:border-red-300 hover:bg-red-50 active:bg-red-100 focus-visible:ring-red-400",
  ghost:
    "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200 focus-visible:ring-zinc-400",
  outline:
    "border border-brand-300 bg-brand-50/50 text-brand-700 hover:bg-brand-100 active:bg-brand-200 focus-visible:ring-brand-500",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-xs rounded-lg",
  md: "min-h-[42px] sm:min-h-[38px] px-4 py-2 text-sm rounded-xl",
  lg: "min-h-[48px] px-5 py-2.5 text-base sm:text-sm rounded-xl font-semibold",
};

const BASE =
  "inline-flex min-w-0 select-none items-center justify-center gap-2 font-medium tracking-tight transition-all duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...props} />;
}

/** Compact ghost/secondary button for inline actions. */
export function GhostButton({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${SIZES.sm} ${className}`} {...props} />;
}
