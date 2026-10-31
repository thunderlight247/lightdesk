"use client";

import { useState, useTransition } from "react";
import { inspectReceiptAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert, Chip } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import type { ReceiptInspectionResult } from "@/modules/media/receipt-and-audio";

export function ReceiptInspector({
  businessId,
}: {
  businessId: string;
  conversationId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptInspectionResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewUrl(dataUrl);
      const base64Data = dataUrl.split(",")[1];
      const mimeType = file.type || "image/jpeg";

      startTransition(async () => {
        const formData = new FormData();
        formData.append("businessId", businessId);
        formData.append("base64Data", base64Data);
        formData.append("mimeType", mimeType);

        const res = await inspectReceiptAction({}, formData);
        if (res.error) {
          setError(res.error);
        } else if (res.inspection) {
          setResult(res.inspection as ReceiptInspectionResult);
        }
      });
    };
    reader.onerror = () => {
      setError("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const insertIntoReply = (text: string) => {
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea[name='text']");
    if (textarea) {
      const cur = textarea.value;
      textarea.value = cur ? `${cur}\n${text}` : text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    } else {
      copyToClipboard(text);
    }
  };

  return (
    <section aria-labelledby="receipt-inspector-heading" className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle
          title="MoMo &amp; Receipt Verifier"
          subtitle="AI-assisted verification for Mobile Money screenshots and payment slips."
        />
        <Button
          type="button"
          variant={isOpen ? "secondary" : "primary"}
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? "Close Inspector" : "Verify Payment Slip"}
        </Button>
      </div>

      {isOpen && (
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              Select or drop MoMo screenshot / receipt image
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isPending}
              className="block w-full text-xs text-zinc-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>

          {isPending && (
            <div className="flex items-center gap-2 text-xs text-brand-700 animate-pulse font-medium">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-600 animate-ping" />
              Scanning and analyzing payment receipt via Gemini Vision…
            </div>
          )}

          {error && <Alert>{error}</Alert>}

          {result && (
            <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5 text-xs shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-zinc-900">{result.platform ?? "Payment Receipt"}</span>
                  <Chip
                    tone={
                      result.status === "SUCCESS"
                        ? "success"
                        : result.status === "FAILED"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {result.status.toLowerCase()}
                  </Chip>
                  {result.confidence > 0 && (
                    <span className="text-[11px] text-zinc-400">
                      {(result.confidence * 100).toFixed(0)}% confidence
                    </span>
                  )}
                </div>
                {result.amountGhs !== null && result.amountGhs !== undefined && (
                  <span className="text-sm font-bold text-emerald-700">
                    GHS {Number(result.amountGhs).toFixed(2)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-zinc-700">
                {result.transactionId && (
                  <div>
                    <span className="text-zinc-400">Transaction ID: </span>
                    <span className="font-mono font-semibold text-zinc-900">{result.transactionId}</span>
                  </div>
                )}
                {result.recipientNameOrPhone && (
                  <div>
                    <span className="text-zinc-400">Recipient: </span>
                    <span className="font-medium text-zinc-800">{result.recipientNameOrPhone}</span>
                  </div>
                )}
                {result.senderNameOrPhone && (
                  <div>
                    <span className="text-zinc-400">Sender: </span>
                    <span className="font-medium text-zinc-800">{result.senderNameOrPhone}</span>
                  </div>
                )}
              </div>

              {result.summary && (
                <p className="rounded bg-zinc-50 p-2 text-zinc-600 text-[11px] italic">
                  {result.summary}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
                {result.transactionId && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (result.transactionId) {
                        insertIntoReply(
                          `We have confirmed receipt of GHS ${result.amountGhs ?? ""}. Transaction ID: ${result.transactionId}. Thank you for your payment!`,
                        );
                      }
                    }}
                  >
                    Insert Confirmation into Reply
                  </Button>
                )}
                {result.transactionId && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(result.transactionId!)}
                    className="text-xs text-brand-700 hover:text-brand-900 underline font-medium"
                  >
                    Copy Trans ID
                  </button>
                )}
              </div>

              {previewUrl && (
                <div className="mt-2 pt-2 border-t border-zinc-100">
                  <details className="text-[11px] text-zinc-500">
                    <summary className="cursor-pointer hover:text-zinc-700">Show receipt image preview</summary>
                    <div className="mt-2 max-w-xs overflow-hidden rounded-lg border border-zinc-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="Receipt preview" className="w-full h-auto object-contain" />
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
