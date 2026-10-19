/** Only allow same-site relative paths (prevents open redirects). */
export function safeRedirectPath(input: unknown, fallback = "/businesses"): string {
  if (typeof input !== "string") return fallback;
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  if (input.includes("\\") || /[\u0000-\u001f]/.test(input)) return fallback;
  return input;
}
