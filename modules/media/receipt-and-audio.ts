import { readLabConfig } from "@/modules/lab/config";

export type ReceiptInspectionResult = {
  isReceipt: boolean;
  platform?: string;
  transactionId?: string | null;
  amountGhs?: number | null;
  recipientNameOrPhone?: string | null;
  senderNameOrPhone?: string | null;
  status: "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN";
  confidence: number;
  summary: string;
};

export type AudioTranscriptionResult = {
  transcript: string;
  summary: string;
};

/**
 * Inspects a payment screenshot or transaction receipt (e.g. MTN MoMo, Telecel Cash, bank transfer).
 */
export async function inspectReceipt(input: {
  base64Data: string;
  mimeType: string;
}): Promise<ReceiptInspectionResult> {
  const config = readLabConfig();
  if (config.provider !== "gemini" || !config.apiKey) {
    return {
      isReceipt: false,
      status: "UNKNOWN",
      confidence: 0,
      summary: "AI provider is not configured for receipt inspection.",
    };
  }

  const prompt = `Inspect this payment receipt or Mobile Money (MoMo) screenshot.
Return STRICT JSON ONLY matching this schema:
{
  "isReceipt": boolean,
  "platform": "MTN MoMo" | "Telecel Cash" | "AT Money" | "Bank Transfer" | "Other" | "None",
  "transactionId": string | null,
  "amountGhs": number | null,
  "recipientNameOrPhone": string | null,
  "senderNameOrPhone": string | null,
  "status": "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN",
  "confidence": number,
  "summary": string
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: input.base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        },
      }),
    });

    if (!res.ok) {
      return {
        isReceipt: false,
        status: "UNKNOWN",
        confidence: 0,
        summary: `Receipt inspection failed with status ${res.status}.`,
      };
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return {
        isReceipt: false,
        status: "UNKNOWN",
        confidence: 0,
        summary: "No inspection data returned.",
      };
    }

    const parsed = JSON.parse(rawText) as ReceiptInspectionResult;
    return parsed;
  } catch (err) {
    return {
      isReceipt: false,
      status: "UNKNOWN",
      confidence: 0,
      summary: err instanceof Error ? err.message : "Failed to parse receipt image.",
    };
  }
}

/**
 * Transcribes an incoming voice note using multimodal audio comprehension.
 */
export async function transcribeAudio(input: {
  base64Data: string;
  mimeType: string;
}): Promise<AudioTranscriptionResult> {
  const config = readLabConfig();
  if (config.provider !== "gemini" || !config.apiKey) {
    return {
      transcript: "[Voice note received — AI provider not configured for audio transcription]",
      summary: "Voice note received",
    };
  }

  const prompt = `Listen to this customer voice note. Transcribe verbatim and provide a concise summary.
Return STRICT JSON ONLY matching this schema:
{
  "transcript": string,
  "summary": string
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: input.base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.2,
        },
      }),
    });

    if (!res.ok) {
      return {
        transcript: "[Voice note received — audio transcription failed]",
        summary: "Audio transcription error",
      };
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return {
        transcript: "[Voice note received — empty transcription]",
        summary: "Empty audio",
      };
    }

    return JSON.parse(rawText) as AudioTranscriptionResult;
  } catch (err) {
    return {
      transcript: `[Voice note received — error: ${err instanceof Error ? err.message : "unknown error"}]`,
      summary: "Voice note",
    };
  }
}
