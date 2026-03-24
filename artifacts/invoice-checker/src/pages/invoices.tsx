import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInvoices,
  useCreateInvoice,
  useListLawFirms,
  useRequestUploadUrl,
  useExtractInvoiceData,
  useUpdateInvoice,
  useDeleteInvoice,
  useGetInvoiceCompleteness,
  useGetMe,
  type InvoiceSummary,
  type ListInvoicesParams,
  type ExtractionResult,
  type ExtractedInvoiceData,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  FileText,
  ChevronLeft,
  ChevronRight,
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  X,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_review: "In Review",
  escalated: "Escalated",
  disputed: "Disputed",
  accepted: "Accepted",
};

const STATUS_COLOURS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  escalated: "bg-purple-100 text-purple-800",
  disputed: "bg-orange-100 text-orange-800",
  accepted: "bg-green-100 text-green-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

type UploadedFile = {
  file: File;
  documentKind: "invoice_file" | "engagement_letter" | "budget_estimate";
  objectPath?: string;
  uploading?: boolean;
  error?: string;
};

function FileUploadRow({ item, onRemove }: { item: UploadedFile; onRemove: () => void }) {
  const kindLabels: Record<string, string> = {
    invoice_file: "Invoice File",
    engagement_letter: "Engagement Letter",
    budget_estimate: "Budget Estimate",
  };
  return (
    <div className="flex items-center gap-3 p-3 border rounded-xl bg-muted/30">
      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.file.name}</p>
        <p className="text-xs text-muted-foreground">{kindLabels[item.documentKind]}</p>
      </div>
      {item.uploading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      {item.objectPath && !item.uploading && <CheckCircle2 className="h-4 w-4 text-green-600" />}
      {item.error && <AlertTriangle className="h-4 w-4 text-destructive" />}
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onRemove}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ConfidencePill({ score }: { score?: number }) {
  if (score === undefined) return null;
  const pct = Math.round(score * 100);
  const colour = pct >= 80 ? "bg-green-100 text-green-800" : pct >= 50 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
  return <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colour}`}>{pct}%</span>;
}

const RELATIONSHIP_PARTNERS = [
  "Alexandra Morgan",
  "James Harrington",
  "Sophia Belmont",
  "David Caldwell",
  "Emma Richardson",
  "Michael Fraser",
  "Catherine Lawton",
  "Robert Ashford",
  "Victoria Pence",
  "Thomas Whitmore",
];

function AddInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [createdInvoiceId, setCreatedInvoiceId] = useState<number | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [reviewForm, setReviewForm] = useState<Partial<ExtractedInvoiceData>>({});
  const [reviewExtras, setReviewExtras] = useState({
    billingType: "" as "" | "time_and_materials" | "fixed_scope",
    currency: "GBP",
    internalRequestorName: "",
  });
  const [form, setForm] = useState({
    lawFirmId: "",
    documentType: "invoice" as "invoice" | "proforma",
  });

  const { data: lawFirms } = useListLawFirms();
  const requestUploadUrl = useRequestUploadUrl();
  const createInvoice = useCreateInvoice();
  const extractInvoice = useExtractInvoiceData();
  const updateInvoice = useUpdateInvoice();
  const { data: completenessData } = useGetInvoiceCompleteness(createdInvoiceId ?? 0, {
    query: {
      enabled: !!createdInvoiceId && step === "review",
      queryKey: [`/api/invoices/${createdInvoiceId ?? 0}/completeness`] as const,
    },
  });

  // Derive effective completeness by overriding server data with current local form state.
  // This ensures the banner updates immediately as the user fills in fields,
  // without needing to save to the server first.
  const effectiveCompleteness = useMemo(() => {
    if (!completenessData) return null;
    const serverData = completenessData as { canRunAnalysis: boolean; blockingIssues: { code: string; message: string }[] };
    let blockingIssues = [...serverData.blockingIssues];

    if (reviewExtras.billingType) {
      blockingIssues = blockingIssues.filter(i => i.code !== "BILLING_TYPE_MISSING");
    }
    if (reviewForm.matterName && reviewForm.matterName.trim() !== "") {
      blockingIssues = blockingIssues.filter(i => i.code !== "MATTER_NAME_MISSING");
    }

    return { canRunAnalysis: blockingIssues.length === 0, blockingIssues };
  }, [completenessData, reviewExtras.billingType, reviewForm.matterName]);

  const selectedFirmJurisdictions: string[] = (lawFirms?.find(f => String(f.id) === form.lawFirmId) as { jurisdictions?: string[] } | undefined)?.jurisdictions ?? [];


  const resetModal = () => {
    setStep("upload");
    setUploadedFiles([]);
    setCreatedInvoiceId(null);
    setExtractionResult(null);
    setExtracting(false);
    setReviewForm({});
    setReviewExtras({ billingType: "", currency: "GBP", internalRequestorName: "" });
    setForm({ lawFirmId: "", documentType: "invoice" });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, kind: "invoice_file" | "engagement_letter" | "budget_estimate") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const entry: UploadedFile = { file, documentKind: kind, uploading: true };
    setUploadedFiles(prev => [...prev, entry]);

    requestUploadUrl.mutate(
      { data: { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" } },
      {
        onSuccess: async (data) => {
          try {
            await fetch(data.uploadURL, {
              method: "PUT",
              body: file,
              headers: { "Content-Type": file.type || "application/octet-stream" },
            });
            setUploadedFiles(prev => prev.map(f =>
              f.file === file ? { ...f, uploading: false, objectPath: data.objectPath } : f
            ));
          } catch {
            setUploadedFiles(prev => prev.map(f =>
              f.file === file ? { ...f, uploading: false, error: "Upload failed" } : f
            ));
          }
        },
        onError: () => {
          setUploadedFiles(prev => prev.map(f =>
            f.file === file ? { ...f, uploading: false, error: "Failed to get upload URL" } : f
          ));
        },
      }
    );
    e.target.value = "";
  };

  const handleCreateAndExtract = () => {
    if (!form.lawFirmId) {
      toast({ variant: "destructive", title: "Required", description: "Please select a law firm." });
      return;
    }

    const documents = uploadedFiles
      .filter(f => f.objectPath)
      .map(f => ({
        documentKind: f.documentKind,
        fileName: f.file.name,
        mimeType: f.file.type || null,
        storagePath: f.objectPath!,
      }));

    createInvoice.mutate(
      {
        data: {
          lawFirmId: parseInt(form.lawFirmId, 10),
          documentType: form.documentType,
          billingType: null,
          matterName: null,
          projectReference: null,
          jurisdiction: null,
          currency: "GBP",
          invoiceDate: null,
          dueDate: null,
          internalRequestorId: null,
          documents,
        },
      },
      {
        onSuccess: (invoice) => {
          setCreatedInvoiceId(invoice.id);
          const hasInvoiceFile = documents.some(d => d.documentKind === "invoice_file");
          if (hasInvoiceFile) {
            setExtracting(true);
            setStep("review");
            extractInvoice.mutate(
              { id: invoice.id },
              {
                onSuccess: (result) => {
                  setExtractionResult(result);
                  setReviewForm({
                    invoiceDate: result.extracted.invoiceDate ?? undefined,
                    dueDate: result.extracted.dueDate ?? undefined,
                    totalAmount: result.extracted.totalAmount ?? undefined,
                    subtotalAmount: result.extracted.subtotalAmount ?? undefined,
                    taxAmount: result.extracted.taxAmount ?? undefined,
                    currency: result.extracted.currency ?? undefined,
                    matterName: result.extracted.matterName ?? undefined,
                    projectReference: result.extracted.projectReference ?? undefined,
                    jurisdiction: result.extracted.jurisdiction ?? undefined,
                    applicableLaw: result.extracted.applicableLaw ?? undefined,
                    billingPeriodStart: result.extracted.billingPeriodStart ?? undefined,
                    billingPeriodEnd: result.extracted.billingPeriodEnd ?? undefined,
                  });
                  if (result.extracted.currency) {
                    setReviewExtras(e => ({ ...e, currency: result.extracted.currency! }));
                  }
                  setExtracting(false);
                },
                onError: () => {
                  setExtracting(false);
                  toast({ variant: "destructive", title: "Extraction failed", description: "Could not extract data from the invoice. Fill in the details below manually." });
                },
              }
            );
          } else {
            setStep("review");
          }
        },
        onError: () => {
          toast({ variant: "destructive", title: "Error", description: "Failed to create invoice." });
        },
      }
    );
  };

  const handleConfirmReview = () => {
    if (!createdInvoiceId) {
      onClose();
      resetModal();
      return;
    }

    const patchData: Record<string, string | null | number> = {};
    if (reviewForm.invoiceDate !== undefined) patchData.invoiceDate = reviewForm.invoiceDate ?? null;
    if (reviewForm.dueDate !== undefined) patchData.dueDate = reviewForm.dueDate ?? null;
    if (reviewForm.totalAmount !== undefined) patchData.totalAmount = reviewForm.totalAmount ?? null;
    if (reviewForm.subtotalAmount !== undefined) patchData.subtotalAmount = reviewForm.subtotalAmount ?? null;
    if (reviewForm.taxAmount !== undefined) patchData.taxAmount = reviewForm.taxAmount ?? null;
    if (reviewForm.matterName !== undefined) patchData.matterName = reviewForm.matterName ?? null;
    if (reviewForm.projectReference !== undefined) patchData.projectReference = reviewForm.projectReference ?? null;
    if (reviewForm.jurisdiction !== undefined) patchData.jurisdiction = reviewForm.jurisdiction ?? null;
    if (reviewForm.applicableLaw !== undefined) patchData.applicableLaw = reviewForm.applicableLaw ?? null;
    if (reviewForm.billingPeriodStart !== undefined) patchData.billingPeriodStart = reviewForm.billingPeriodStart ?? null;
    if (reviewForm.billingPeriodEnd !== undefined) patchData.billingPeriodEnd = reviewForm.billingPeriodEnd ?? null;
    patchData.currency = reviewExtras.currency || "GBP";
    if (reviewExtras.billingType) patchData.billingType = reviewExtras.billingType;
    if (reviewExtras.internalRequestorName) patchData.internalRequestorName = reviewExtras.internalRequestorName;

    const doNavigate = () => {
      navigate(`/invoices/${createdInvoiceId}`);
      onClose();
      resetModal();
    };

    if (Object.keys(patchData).length > 0) {
      updateInvoice.mutate(
        { id: createdInvoiceId, data: patchData },
        {
          onSuccess: doNavigate,
          onError: () => {
            toast({ variant: "destructive", title: "Warning", description: "Could not save your edits. Opening invoice anyway." });
            doNavigate();
          },
        }
      );
    } else {
      doNavigate();
    }
  };

  const hasInvoiceFile = uploadedFiles.some(f => f.documentKind === "invoice_file");
  const anyUploading = uploadedFiles.some(f => f.uploading);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { resetModal(); onClose(); } }}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-display">Add Invoice</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-6">
          {(["upload", "review"] as const).map((s, i) => {
            const labels = { upload: "Upload & Create", review: "Review & Confirm" };
            const isActive = step === s;
            const isPast = step === "review" && s === "upload";
            return (
              <button
                key={s}
                disabled={!isActive && !isPast}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : isPast ? "text-muted-foreground" : "text-muted-foreground opacity-40"}`}
              >
                <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${isActive ? "bg-white/20" : "bg-muted"}`}>{i + 1}</span>
                {labels[s]}
              </button>
            );
          })}
        </div>

        {step === "upload" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Law Firm <span className="text-destructive">*</span></Label>
                <Select value={form.lawFirmId} onValueChange={v => setForm(f => ({ ...f, lawFirmId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select law firm" /></SelectTrigger>
                  <SelectContent>
                    {lawFirms?.filter(f => f.isActive).map(f => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.name} <span className="text-muted-foreground text-xs">({f.firmType === "panel" ? "Panel" : "Non-panel"})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Document Type <span className="text-destructive">*</span></Label>
                <Select value={form.documentType} onValueChange={v => setForm(f => ({ ...f, documentType: v as "invoice" | "proforma" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="proforma">Proforma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              <div className="border-2 border-dashed border-border rounded-2xl p-6 text-center bg-muted/20">
                <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium mb-1">Invoice File <span className="text-destructive">*</span></p>
                <p className="text-sm text-muted-foreground mb-3">PDF, DOCX, PNG, JPG accepted</p>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
                    <Upload className="h-4 w-4" /> Choose File
                  </span>
                  <input type="file" className="hidden" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" onChange={e => handleFileSelect(e, "invoice_file")} />
                </label>
              </div>

              <div className="border-2 border-dashed border-border rounded-2xl p-4 text-center bg-muted/10">
                <p className="font-medium text-sm mb-1">Engagement Letter <span className="text-muted-foreground">(optional)</span></p>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors">
                    <Plus className="h-3 w-3" /> Add
                  </span>
                  <input type="file" className="hidden" accept=".pdf,.docx,.doc" onChange={e => handleFileSelect(e, "engagement_letter")} />
                </label>
              </div>

              <div className="border-2 border-dashed border-border rounded-2xl p-4 text-center bg-muted/10">
                <p className="font-medium text-sm mb-1">Budget Estimate <span className="text-muted-foreground">(optional)</span></p>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors">
                    <Plus className="h-3 w-3" /> Add
                  </span>
                  <input type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.xls" onChange={e => handleFileSelect(e, "budget_estimate")} />
                </label>
              </div>
            </div>

            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Uploaded Files</p>
                {uploadedFiles.map((f, i) => (
                  <FileUploadRow key={i} item={f} onRemove={() => setUploadedFiles(prev => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => { resetModal(); onClose(); }}>Cancel</Button>
              <Button
                onClick={handleCreateAndExtract}
                disabled={anyUploading || !form.lawFirmId || createInvoice.isPending}
              >
                {createInvoice.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {hasInvoiceFile ? "Create & Extract" : "Create Invoice"}
              </Button>
            </DialogFooter>
          </div>
        )}


        {step === "review" && (
          <div className="space-y-5">
            {extracting && (
              <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="font-medium text-lg">Extracting invoice data with AI...</p>
                <p className="text-sm text-muted-foreground">This usually takes 5–15 seconds. Please wait.</p>
              </div>
            )}

            {!extracting && (
              <>
                {extractionResult ? (
                  <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0" />
                    <p className="text-sm text-blue-800">AI extracted the following fields. Please review and correct any errors before confirming.</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 bg-muted/40 border border-border rounded-xl">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <p className="text-sm text-muted-foreground">No invoice file uploaded — fill in the details below. You can also add files from the invoice page later.</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Billing Type</Label>
                    <Select value={reviewExtras.billingType} onValueChange={v => setReviewExtras(e => ({ ...e, billingType: v as "" | "time_and_materials" | "fixed_scope" }))}>
                      <SelectTrigger><SelectValue placeholder="Select billing type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="time_and_materials">Time &amp; Materials</SelectItem>
                        <SelectItem value="fixed_scope">Fixed Scope</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Currency <span className="text-destructive">*</span></Label>
                    <Select value={reviewExtras.currency} onValueChange={v => setReviewExtras(e => ({ ...e, currency: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["GBP", "EUR", "USD", "CHF", "SGD", "AED"].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Internal Requestor</Label>
                    <Select value={reviewExtras.internalRequestorName || "__none__"} onValueChange={v => setReviewExtras(e => ({ ...e, internalRequestorName: v === "__none__" ? "" : v }))}>
                      <SelectTrigger><SelectValue placeholder="Select requestor (optional)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {RELATIONSHIP_PARTNERS.map(name => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      Invoice Date
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.invoiceDate} />}
                    </Label>
                    <Input
                      type="date"
                      value={reviewForm.invoiceDate ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, invoiceDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Due Date
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.dueDate} />}
                    </Label>
                    <Input
                      type="date"
                      value={reviewForm.dueDate ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, dueDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Total Amount
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.totalAmount} />}
                    </Label>
                    <Input
                      value={reviewForm.totalAmount ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, totalAmount: e.target.value }))}
                      placeholder="e.g. 12500.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Subtotal
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.subtotalAmount} />}
                    </Label>
                    <Input
                      value={reviewForm.subtotalAmount ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, subtotalAmount: e.target.value }))}
                      placeholder="e.g. 11000.00"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>
                      Matter Name
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.matterName} />}
                    </Label>
                    <Input
                      value={reviewForm.matterName ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, matterName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Project Reference
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.projectReference} />}
                    </Label>
                    <Input
                      value={reviewForm.projectReference ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, projectReference: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Jurisdiction
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.jurisdiction} />}
                    </Label>
                    <Input
                      value={reviewForm.jurisdiction ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, jurisdiction: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>
                      Applicable Law
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.applicableLaw} />}
                    </Label>
                    {selectedFirmJurisdictions.length > 0 ? (
                      (() => {
                        const currentVal = reviewForm.applicableLaw ?? "";
                        const options = selectedFirmJurisdictions.includes(currentVal) || !currentVal
                          ? selectedFirmJurisdictions
                          : [currentVal, ...selectedFirmJurisdictions];
                        return (
                          <Select
                            value={currentVal || "__none__"}
                            onValueChange={v => setReviewForm(f => ({ ...f, applicableLaw: v === "__none__" ? "" : v }))}
                          >
                            <SelectTrigger><SelectValue placeholder="Select applicable law" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— Select —</SelectItem>
                              {options.map(j => (
                                <SelectItem key={j} value={j}>{j}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      })()
                    ) : (
                      <Input
                        value={reviewForm.applicableLaw ?? ""}
                        onChange={e => setReviewForm(f => ({ ...f, applicableLaw: e.target.value }))}
                        placeholder="e.g. English Law"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Tax Amount
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.taxAmount} />}
                    </Label>
                    <Input
                      value={reviewForm.taxAmount ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, taxAmount: e.target.value }))}
                      placeholder="e.g. 1500.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Billing Period Start
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.billingPeriodStart} />}
                    </Label>
                    <Input
                      type="date"
                      value={reviewForm.billingPeriodStart ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, billingPeriodStart: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Billing Period End
                      {extractionResult && <ConfidencePill score={extractionResult.confidence?.billingPeriodEnd} />}
                    </Label>
                    <Input
                      type="date"
                      value={reviewForm.billingPeriodEnd ?? ""}
                      onChange={e => setReviewForm(f => ({ ...f, billingPeriodEnd: e.target.value }))}
                    />
                  </div>
                </div>

                {extractionResult && (extractionResult.extracted.lineItems ?? []).length > 0 && (
                  <div className="p-3 bg-muted/30 rounded-xl">
                    <p className="text-sm font-medium mb-1">
                      {(extractionResult.extracted.lineItems ?? []).length} line item{(extractionResult.extracted.lineItems ?? []).length !== 1 ? "s" : ""} extracted
                    </p>
                    <p className="text-xs text-muted-foreground">Line items are available on the invoice detail page for review.</p>
                  </div>
                )}
              </>
            )}

            {!extracting && effectiveCompleteness && (
              <div className={`flex items-start gap-3 p-3 rounded-xl border ${effectiveCompleteness.canRunAnalysis ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                {effectiveCompleteness.canRunAnalysis ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p className={`text-xs font-medium ${effectiveCompleteness.canRunAnalysis ? "text-green-800" : "text-amber-800"}`}>
                    {effectiveCompleteness.canRunAnalysis ? "Invoice is complete — ready for analysis" : "Some required fields are still missing"}
                  </p>
                  {!effectiveCompleteness.canRunAnalysis && effectiveCompleteness.blockingIssues.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {effectiveCompleteness.blockingIssues.map(i => i.message).join("; ")}
                    </p>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleConfirmReview} disabled={extracting || updateInvoice.isPending}>
                {extracting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extracting...</>
                ) : updateInvoice.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                ) : "Confirm & Open Invoice"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Invoices() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const initialStatus = new URLSearchParams(searchString).get("status") ?? "";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceSummary | null>(null);

  const { data: me } = useGetMe();
  const isSuperAdmin = (me as { role?: string } | undefined)?.role === "super_admin";

  const deleteInvoice = useDeleteInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
        toast({ title: "Invoice deleted", description: `${deleteTarget?.invoiceNumber} has been permanently deleted.` });
        setDeleteTarget(null);
      },
      onError: () => {
        toast({ variant: "destructive", title: "Delete failed", description: "Could not delete the invoice. Please try again." });
      },
    },
  });

  useEffect(() => {
    const s = new URLSearchParams(searchString).get("status") ?? "";
    setStatusFilter(s);
    setPage(1);
  }, [searchString]);

  const params: ListInvoicesParams = {
    page,
    pageSize: 10,
    ...(search ? { search } : {}),
    ...(statusFilter ? { status: statusFilter as ListInvoicesParams["status"] } : {}),
  };

  const { data, isLoading } = useListInvoices(params);

  const invoices = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Invoices</h1>
          <p className="text-lg text-muted-foreground mt-1">Manage and review law firm invoices.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" /> Add Invoice
        </Button>
      </div>

      <div className="border border-border rounded-3xl bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoices..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>

          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-20">
            <Building2 className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">No invoices found</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first invoice by clicking &quot;Add Invoice&quot;</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Invoice #</TableHead>
                <TableHead>Law Firm</TableHead>
                <TableHead>Project/Matter</TableHead>
                <TableHead>Team/Area</TableHead>
                <TableHead>Requestor</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Invoice Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                {isSuperAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv: InvoiceSummary) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                >
                  <TableCell className="font-mono font-medium text-sm">{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{inv.lawFirmName ?? <span className="text-muted-foreground">—</span>}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{inv.matterName ?? <span className="text-muted-foreground">—</span>}</span>
                    {inv.projectReference && (
                      <p className="text-xs text-muted-foreground">{inv.projectReference}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{inv.jurisdiction ?? "—"}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{inv.internalRequestorName ?? <span className="text-muted-foreground">—</span>}</span>
                  </TableCell>
                  <TableCell>
                    {inv.totalAmount ? (
                      <span className="font-medium text-sm">
                        {inv.currency} {parseFloat(inv.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {inv.invoiceDate ? format(new Date(inv.invoiceDate), "d MMM yyyy") : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.invoiceStatus} />
                  </TableCell>
                  <TableCell className="text-right">
                    {inv.issueCount > 0 ? (
                      <Badge variant="destructive" className="text-xs">{inv.issueCount}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">0</span>
                    )}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={e => { e.stopPropagation(); setDeleteTarget(inv); }}
                        title="Delete invoice"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} invoices
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm px-2">{page} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <AddInvoiceModal open={addOpen} onClose={() => setAddOpen(false)} />

      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Invoice
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              You are about to permanently delete invoice{" "}
              <span className="font-mono font-semibold text-foreground">{deleteTarget?.invoiceNumber}</span>
              {deleteTarget?.lawFirmName && (
                <> from <span className="font-medium text-foreground">{deleteTarget.lawFirmName}</span></>
              )}.
            </p>
            <p className="text-sm text-muted-foreground">
              This will also delete all associated documents, extracted line items, analysis runs, issues, and audit history. <span className="font-semibold text-destructive">This action cannot be undone.</span>
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteInvoice.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteInvoice.mutate({ id: deleteTarget.id })}
              disabled={deleteInvoice.isPending}
            >
              {deleteInvoice.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
