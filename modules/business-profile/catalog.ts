import { ValidationError } from "@/lib/security/errors";
import { CAPABILITIES, CAPABILITY_INFO } from "@/modules/permissions/platform-policy";

export type ModuleName = "IDENTITY" | "OFFERINGS" | "COMMUNICATION" | "POLICY" | "PERMISSION";
export type FieldKind = "text" | "textarea" | "select" | "phone" | "email" | "toggle";
export type Option = { value: string; label: string };

export type EntryDef = {
  module: ModuleName;
  key: string;
  label: string;
  help: string;
  why: string;
  kind: FieldKind;
  options?: readonly Option[];
  maxLength: number;
  /** Material = a business fact, policy or permission: changes need explicit owner approval. */
  material: boolean;
  /** Must be approved before the profile can become ACTIVE. */
  requiredForActivation: boolean;
  /** Shown in the checklist as recommended; leaving it unknown is always allowed. */
  recommended: boolean;
};

const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

const base = { requiredForActivation: false, recommended: false } as const;

const IDENTITY: EntryDef[] = [
  {
    ...base, module: "IDENTITY", key: "business_category", label: "Business category", kind: "text", maxLength: 80,
    material: true, requiredForActivation: true,
    help: "What kind of business this is, e.g. “Mobile phone retailer” or “Hair salon”.",
    why: "Tells LightDesk what kind of business it is speaking for.",
  },
  {
    ...base, module: "IDENTITY", key: "service_area", label: "Location and service area", kind: "text", maxLength: 200,
    material: true,
    help: "Where customers find you or where you deliver. Your address is not required.",
    why: "Stops LightDesk guessing where you operate.",
  },
  {
    ...base, module: "IDENTITY", key: "public_phone", label: "Public phone number", kind: "phone", maxLength: 20,
    material: true,
    help: "A number you are happy for customers to be given.",
    why: "Only numbers you approve can ever be shared with customers.",
  },
  {
    ...base, module: "IDENTITY", key: "public_email", label: "Public email address", kind: "email", maxLength: 254,
    material: true,
    help: "An address you are happy for customers to be given.",
    why: "Only addresses you approve can ever be shared with customers.",
  },
];

const OFFERINGS: EntryDef[] = [
  {
    ...base, module: "OFFERINGS", key: "offerings_summary", label: "What the business sells or offers", kind: "textarea",
    maxLength: 1000, material: true, requiredForActivation: true,
    help: "In your own words. Describe the kinds of products or services. Do not list prices or stock here.",
    why: "Descriptive only: this is not a price list or stock record and is never treated as one.",
  },
];

const TONES = opts(["friendly", "Friendly"], ["professional", "Professional"], ["warm", "Warm"], ["direct", "Direct"]);
const COMMUNICATION: EntryDef[] = [
  {
    ...base, module: "COMMUNICATION", key: "tone", label: "Tone", kind: "select", options: TONES, maxLength: 20,
    material: false, recommended: true,
    help: "How LightDesk should sound when speaking for you.",
    why: "Instruction, not a fact about the business. Applied once the profile is active.",
  },
  {
    ...base, module: "COMMUNICATION", key: "formality", label: "Formality", kind: "select", maxLength: 20, material: false,
    options: opts(["casual", "Casual"], ["neutral", "Neutral"], ["formal", "Formal"]),
    help: "How formal the wording should be.", why: "Matches your customers' expectations.",
  },
  {
    ...base, module: "COMMUNICATION", key: "response_length", label: "Response length", kind: "select", maxLength: 20, material: false,
    options: opts(["brief", "Brief"], ["standard", "Standard"], ["detailed", "Detailed"]),
    help: "How much detail replies should usually contain.", why: "Keeps replies suited to chat.",
  },
  {
    ...base, module: "COMMUNICATION", key: "primary_language", label: "Primary language", kind: "select", maxLength: 10, material: false,
    options: opts(["en", "English"], ["tw", "Twi"], ["fat", "Fante"], ["gaa", "Ga"], ["ee", "Ewe"], ["ha", "Hausa"], ["fr", "French"]),
    help: "The language replies should normally use.", why: "Replies should match how your customers write.",
  },
  {
    ...base, module: "COMMUNICATION", key: "additional_languages", label: "Other languages", kind: "text", maxLength: 120, material: false,
    help: "Any other languages customers may use, e.g. “Twi, Ga”.", why: "Helps LightDesk know when to switch language.",
  },
  {
    ...base, module: "COMMUNICATION", key: "greeting", label: "Greeting", kind: "text", maxLength: 200, material: false,
    help: "How a first reply should begin, e.g. “Hello! Thanks for contacting us.”", why: "Gives replies your business's voice.",
  },
  {
    ...base, module: "COMMUNICATION", key: "sign_off", label: "Sign-off", kind: "text", maxLength: 200, material: false,
    help: "How replies should end, e.g. “Thank you for choosing us.”", why: "Gives replies your business's voice.",
  },
  {
    ...base, module: "COMMUNICATION", key: "terminology", label: "Preferred wording", kind: "textarea", maxLength: 1000, material: false,
    help: "One per line: word customers use => wording you prefer. e.g. “cheap => affordable”.",
    why: "Keeps business-specific terms consistent.",
  },
];

const policy = (key: string, label: string, help: string, extra: Partial<EntryDef> = {}): EntryDef => ({
  ...base, module: "POLICY", key, label, help, kind: "textarea", maxLength: 1000, material: true,
  why: "A business rule customers may ask about. If you leave it empty, LightDesk treats it as unknown and will not guess.",
  ...extra,
});
const POLICY: EntryDef[] = [
  policy("opening_hours", "Opening hours", "When you are open, including days you are closed.", { recommended: true }),
  policy("delivery", "Delivery", "Whether you deliver, where, and any conditions. Write “We do not deliver” if that is the case.", { recommended: true }),
  policy("returns", "Returns and refunds", "What customers can return and on what terms.", { recommended: true }),
  policy("appointments", "Appointments and bookings", "How customers book, change or cancel.", { recommended: true }),
  policy("escalation", "Handing over to a person", "When and how a customer should be passed to a person, and who that is.", {
    requiredForActivation: true,
    why: "Required: a conversation must always have a clear route to a human.",
  }),
];

const TOGGLE = opts(["enabled", "Enabled"], ["disabled", "Disabled"]);
const PERMISSION: EntryDef[] = CAPABILITIES.map((cap) => ({
  ...base, module: "PERMISSION" as const, key: cap, label: CAPABILITY_INFO[cap].label, kind: "toggle" as const,
  options: TOGGLE, maxLength: 10, material: true,
  help: CAPABILITY_INFO[cap].description,
  why: "Everything is disabled until the owner approves it, and the platform can still forbid it.",
}));

export const ENTRY_DEFS: readonly EntryDef[] = [...IDENTITY, ...OFFERINGS, ...COMMUNICATION, ...POLICY, ...PERMISSION];

const BY_KEY = new Map(ENTRY_DEFS.map((d) => [d.key, d]));
export function getEntryDef(key: string): EntryDef | undefined {
  return BY_KEY.get(key);
}
export function defsForModule(module: ModuleName): EntryDef[] {
  return ENTRY_DEFS.filter((d) => d.module === module);
}

export type SectionSlug = "identity" | "offerings" | "faq" | "communication" | "policies" | "permissions";
export const SECTIONS: readonly { slug: SectionSlug; title: string; module: ModuleName | null; intro: string }[] = [
  { slug: "identity", title: "Identity", module: "IDENTITY",
    intro: "Who the business is. Name, description and location are managed in Settings; this adds the details customers may ask about." },
  { slug: "offerings", title: "Products & services", module: "OFFERINGS",
    intro: "A plain description of what you sell or offer. This is a summary, not a catalogue, price list or stock record." },
  { slug: "faq", title: "FAQs", module: null,
    intro: "Questions customers ask, with the answer you approve. Only approved, active answers can ever be used." },
  { slug: "communication", title: "Communication", module: "COMMUNICATION",
    intro: "How LightDesk should speak for you. These are instructions, not facts, so they take effect when saved." },
  { slug: "policies", title: "Policies", module: "POLICY",
    intro: "Your approved rules for common enquiries. Leave anything you have not decided as “not provided”." },
  { slug: "permissions", title: "AI permissions", module: "PERMISSION",
    intro: "What LightDesk may be allowed to do in future. Everything starts disabled and only the owner can change it." },
];
export const SECTION_BY_MODULE: Readonly<Record<ModuleName, SectionSlug>> = {
  IDENTITY: "identity", OFFERINGS: "offerings", COMMUNICATION: "communication", POLICY: "policies", PERMISSION: "permissions",
};

// ---- validation ---------------------------------------------------------------------------
const CONTROL_SINGLE = /[\u0000-\u001f\u007f]/;
const CONTROL_MULTI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function fail(field: string, message: string): never {
  throw new ValidationError("Invalid input", { [field]: [message] });
}

/** Normalises and validates a value for a catalogue entry. Throws ValidationError. */
export function normalizeEntryValue(def: EntryDef, raw: unknown): string {
  if (typeof raw !== "string") fail("value", "Enter a value");
  const v = def.kind === "textarea" ? raw.replace(/\r\n?/g, "\n").trim() : raw.trim();
  if (v === "") fail("value", "Enter a value, or use Clear to mark it as not provided");
  if (v.length > def.maxLength) fail("value", `Use at most ${def.maxLength} characters`);
  if ((def.kind === "textarea" ? CONTROL_MULTI : CONTROL_SINGLE).test(v)) fail("value", "Contains invalid characters");

  if (def.kind === "select" || def.kind === "toggle") {
    if (!def.options?.some((o) => o.value === v)) fail("value", "Choose one of the listed options");
  }
  if (def.kind === "phone" && !/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/.test(v)) fail("value", "Enter a valid phone number");
  if (def.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fail("value", "Enter a valid email address");
  if (def.key === "terminology") {
    const lines = v.split("\n").filter((l) => l.trim() !== "");
    if (lines.length > 20) fail("value", "Use at most 20 lines");
    for (const line of lines) {
      const [left, ...rest] = line.split("=>");
      if (rest.length !== 1 || left.trim() === "" || rest[0].trim() === "") {
        fail("value", "Each line must look like: word customers use => wording you prefer");
      }
    }
  }
  return v;
}

export type FaqInput = { question?: string; answer?: string; category?: string | null };

/** Validates FAQ fields. With `requireAll`, question and answer must be present (create). */
export function normalizeFaqInput(input: { question?: unknown; answer?: unknown; category?: unknown }, requireAll: boolean): FaqInput {
  const out: FaqInput = {};
  if (input.question !== undefined || requireAll) {
    if (typeof input.question !== "string") fail("question", "Enter the customer's question");
    const q = input.question.trim();
    if (q.length < 5) fail("question", "Use at least 5 characters");
    if (q.length > 300) fail("question", "Use at most 300 characters");
    if (CONTROL_SINGLE.test(q)) fail("question", "Contains invalid characters");
    out.question = q;
  }
  if (input.answer !== undefined || requireAll) {
    if (typeof input.answer !== "string") fail("answer", "Enter the approved answer");
    const a = input.answer.replace(/\r\n?/g, "\n").trim();
    if (a.length < 1) fail("answer", "Enter the approved answer");
    if (a.length > 1500) fail("answer", "Use at most 1500 characters");
    if (CONTROL_MULTI.test(a)) fail("answer", "Contains invalid characters");
    out.answer = a;
  }
  if (input.category !== undefined && input.category !== null) {
    if (typeof input.category !== "string") fail("category", "Invalid category");
    const c = input.category.trim();
    if (c.length > 60) fail("category", "Use at most 60 characters");
    if (CONTROL_SINGLE.test(c)) fail("category", "Contains invalid characters");
    out.category = c === "" ? null : c;
  } else if (input.category === null) {
    out.category = null;
  }
  return out;
}

export const MAX_FAQS_PER_PROFILE = 200;
