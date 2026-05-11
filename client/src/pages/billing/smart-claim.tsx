import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Upload, FileText, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DroppedFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

function FileDropzone({
  label,
  hint,
  file,
  onFile,
  onClear,
  testId,
}: {
  label: string;
  hint: string;
  file: DroppedFile | null;
  onFile: (f: File) => void;
  onClear: () => void;
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped?.type === "application/pdf") onFile(dropped);
    },
    [onFile]
  );

  return (
    <div
      data-testid={testId}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !file && inputRef.current?.click()}
      className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer
        ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"}
        ${file ? "cursor-default" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {!file ? (
        <div className="flex flex-col items-center gap-3 pointer-events-none">
          <div className="rounded-full bg-muted p-4">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          </div>
          <p className="text-xs text-muted-foreground">Drop PDF here or click to browse</p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2.5 flex-shrink-0
            ${file.status === "done" ? "bg-green-100 dark:bg-green-900/30" :
              file.status === "error" ? "bg-red-100 dark:bg-red-900/30" :
              file.status === "uploading" ? "bg-blue-100 dark:bg-blue-900/30" :
              "bg-muted"}`}
          >
            {file.status === "done" ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : file.status === "error" ? (
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            ) : file.status === "uploading" ? (
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-medium truncate">{file.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.file.size / 1024).toFixed(0)} KB
              {file.status === "uploading" && " — Uploading…"}
              {file.status === "done" && " — Ready"}
              {file.status === "error" && ` — ${file.error ?? "Upload failed"}`}
            </p>
          </div>
          {file.status !== "uploading" && (
            <button
              type="button"
              data-testid={`${testId}-clear`}
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="p-1 rounded hover:bg-muted flex-shrink-0"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SmartClaimPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [vaFile, setVaFile] = useState<DroppedFile | null>(null);
  const [qbFile, setQbFile] = useState<DroppedFile | null>(null);

  const bothReady =
    vaFile?.status === "pending" || vaFile?.status === "done" || vaFile !== null
      ? qbFile !== null
      : false;

  const canSubmit =
    vaFile !== null &&
    qbFile !== null &&
    vaFile.status !== "uploading" &&
    qbFile.status !== "uploading" &&
    vaFile.status !== "error" &&
    qbFile.status !== "error";

  const processMutation = useMutation({
    mutationFn: async () => {
      if (!vaFile || !qbFile) throw new Error("Both files required");

      // 1. Read both files as base64 in parallel
      const toBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // strip "data:application/pdf;base64," prefix
            resolve(result.split(",")[1] ?? result);
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(file);
        });

      setVaFile((f) => f ? { ...f, status: "uploading" } : f);
      setQbFile((f) => f ? { ...f, status: "uploading" } : f);

      const [vaReferralBase64, qbInvoiceBase64] = await Promise.all([
        toBase64(vaFile.file),
        toBase64(qbFile.file),
      ]);

      // 2. Upload via backend proxy (avoids S3 CORS requirement)
      const uploadRes = await apiRequest("POST", "/api/billing/smart-claims/upload", {
        vaReferralBase64,
        qbInvoiceBase64,
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Document upload failed");
      }
      const { draftId, vaKey, qbKey } = await uploadRes.json();

      setVaFile((f) => f ? { ...f, status: "done" } : f);
      setQbFile((f) => f ? { ...f, status: "done" } : f);

      // 3. Create draft and start worker
      const createRes = await apiRequest("POST", "/api/billing/smart-claims", {
        draftId,
        vaKey,
        qbKey,
      });
      if (!createRes.ok) throw new Error("Failed to start extraction");

      return draftId;
    },
    onSuccess: (draftId) => {
      navigate(`/billing/claims/smart-new/${draftId}/preview`);
    },
    onError: (err: any) => {
      setVaFile((f) => f ? { ...f, status: "error", error: err.message } : f);
      setQbFile((f) => f ? { ...f, status: "error", error: err.message } : f);
      toast({
        title: "Upload failed",
        description: err.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-3">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-smart-claim-title">
            Smart Claim
          </h1>
          <p className="text-sm text-muted-foreground">
            Drop a VA referral and a QuickBooks invoice. We'll fill in the claim. Review before saving.
          </p>
        </div>
      </div>

      {/* How it works */}
      <Alert className="border-primary/20 bg-primary/5">
        <Sparkles className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm">
          <strong>How it works:</strong> AWS Textract reads both PDFs, pre-fills all claim fields,
          flags any conflicts, and lets you review before the claim is saved. The full process takes
          about 15–25 seconds.
        </AlertDescription>
      </Alert>

      {/* Drop zones */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Upload Documents</CardTitle>
          <CardDescription>Both documents are required to create a Smart Claim.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            label="VA Referral (Form 10-7080)"
            hint="Multi-page VA referral PDF"
            file={vaFile}
            onFile={(f) => setVaFile({ file: f, status: "pending" })}
            onClear={() => setVaFile(null)}
            testId="dropzone-va-referral"
          />
          <FileDropzone
            label="QuickBooks Invoice"
            hint="Single-page Chajinel QB invoice PDF"
            file={qbFile}
            onFile={(f) => setQbFile({ file: f, status: "pending" })}
            onClear={() => setQbFile(null)}
            testId="dropzone-qb-invoice"
          />
        </CardContent>
      </Card>

      {/* Action */}
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          data-testid="button-smart-claim-cancel"
          onClick={() => navigate("/billing/claims")}
          disabled={processMutation.isPending}
        >
          Cancel
        </Button>
        <Button
          size="lg"
          data-testid="button-smart-claim-process"
          disabled={!canSubmit || processMutation.isPending}
          onClick={() => processMutation.mutate()}
          className="gap-2"
        >
          {processMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Process Claim
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
