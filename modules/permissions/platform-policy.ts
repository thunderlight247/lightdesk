/**
 * PLATFORM-level policy for AI capabilities. This is deliberately separate from the
 * business-level settings stored in the profile: a business can only ever narrow what the
 * platform allows, never widen it. Changing this file is a code change, not a business setting.
 */
export const CAPABILITIES = [
  "answer_routine_enquiries",
  "use_approved_knowledge",
  "prepare_suggested_response",
  "send_messages_automatically",
  "escalate_to_human",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_INFO: Readonly<Record<Capability, { label: string; description: string }>> = {
  answer_routine_enquiries: {
    label: "Answer routine enquiries",
    description: "Future: let LightDesk respond to common customer questions.",
  },
  use_approved_knowledge: {
    label: "Use approved business knowledge",
    description: "Future: let LightDesk draw on the approved FAQ entries and policies in this profile.",
  },
  prepare_suggested_response: {
    label: "Prepare suggested responses",
    description: "Future: let LightDesk draft a reply for a person to review before anything is sent.",
  },
  send_messages_automatically: {
    label: "Send messages automatically",
    description: "Future: let LightDesk send replies without a person reviewing them first.",
  },
  escalate_to_human: {
    label: "Escalate to a human",
    description: "Future: let LightDesk hand a conversation to a person when it should not continue alone.",
  },
};

export const PLATFORM_POLICY: Readonly<Record<Capability, { allowed: boolean; note?: string }>> = {
  answer_routine_enquiries: { allowed: true },
  use_approved_knowledge: { allowed: true },
  prepare_suggested_response: { allowed: true },
  send_messages_automatically: {
    allowed: false,
    note: "Automatic sending is not permitted by the platform in this release.",
  },
  escalate_to_human: { allowed: true },
};

export function isCapability(key: string): key is Capability {
  return (CAPABILITIES as readonly string[]).includes(key);
}

/** Unknown capabilities are never allowed (deny by default). */
export function platformAllows(key: string): boolean {
  return isCapability(key) && PLATFORM_POLICY[key].allowed;
}
