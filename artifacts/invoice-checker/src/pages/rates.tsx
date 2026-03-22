import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPanelBaselineDocuments,
  useListPanelRates,
  useCreatePanelBaselineDocument,
  useUpdatePanelBaselineDocumentStatus,
  useExtractRatesFromFile,
  useRequestUploadUrl,
  getListPanelBaselineDocumentsQueryKey,
  getListPanelRatesQueryKey,
  type PanelBaselineDocument,
  type PanelRate,
  type ExtractedRateRow,
  type CreatePanelBaselineDocumentMutationError,
  type UpdatePanelBaselineDocumentStatusMutationError,
} from "@workspace/api-client-react";
import {
  DollarSign, Plus, Search, X, FileText, Trash2,
  ShieldCheck, Archive, CheckCircle2, Clock, AlertCircle,
  Upload, Sparkles, Pencil, Check,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type DocStatus = "draft" | "verified" | "active" | "archived";

type BadgeVariant = "default" | DocStatus;

function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold", {
      "bg-amber-100 text-amber-700": status === "draft",
      "bg-blue-100 text-blue-700": status === "verified",
      "bg-emerald-100 text-emerald-700": status === "active",
      "bg-muted text-muted-foreground": status === "archived",
    })}>
      {status === "draft" && <Clock className="w-3 h-3" />}
      {status === "verified" && <ShieldCheck className="w-3 h-3" />}
      {status === "active" && <CheckCircle2 className="w-3 h-3" />}
      {status === "archived" && <Archive className="w-3 h-3" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

type RateRow = ExtractedRateRow & { _editing?: boolean };

const CURRENCIES = ["GBP", "EUR", "USD", "CHF", "SEK", "NOK", "DKK"];

function ReviewTable({ rows, onUpdate, onRemove, onAdd }: {
  rows: RateRow[];
  onUpdate: (idx: number, field: keyof RateRow, value: string) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  const cellInput = "w-full px-2 py-1 rounded border border-border bg-background text-foreground focus:outline-none focus:border-primary text-xs";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[900px]">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {["Law Firm", "Jurisdiction", "Role Code", "Role Label", "Currency", "Max Rate (£/h)", "Valid From", "Valid To", ""].map(h => (
              <th key={h} className="text-left py-2 px-2 font-semibold text-muted-foreground whitespace-nowrap first:pl-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/20">
              <td className="py-1 px-1 pl-3"><input value={row.lawFirmName} onChange={e => onUpdate(i, "lawFirmName", e.target.value)} className={cellInput} /></td>
              <td className="py-1 px-1"><input value={row.jurisdiction} onChange={e => onUpdate(i, "jurisdiction", e.target.value)} className={cellInput} /></td>
              <td className="py-1 px-1"><input value={row.roleCode} onChange={e => onUpdate(i, "roleCode", e.target.value)} className={cellInput} /></td>
              <td className="py-1 px-1"><input value={row.roleLabel} onChange={e => onUpdate(i, "roleLabel", e.target.value)} className={cellInput} /></td>
              <td className="py-1 px-1">
                <select value={row.currency} onChange={e => onUpdate(i, "currency", e.target.value)} className={cellInput}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td className="py-1 px-1"><input value={row.maxRate} onChange={e => onUpdate(i, "maxRate", e.target.value)} className={cellInput} type="number" step="0.01" min="0" /></td>
              <td className="py-1 px-1"><input value={row.validFrom ?? ""} onChange={e => onUpdate(i, "validFrom", e.target.value)} className={cellInput} type="date" /></td>
              <td className="py-1 px-1"><input value={row.validTo ?? ""} onChange={e => onUpdate(i, "validTo", e.target.value)} className={cellInput} type="date" /></td>
              <td className="py-1 px-1">
                <button type="button" onClick={() => onRemove(i)} className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={onAdd} className="mt-2 ml-3 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
        <Plus className="w-3.5 h-3.5" />Add row manually
      </button>
    </div>
  );
}

function AddRatesDocumentModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreatePanelBaselineDocument();
  const extractMutation = useExtractRatesFromFile();
  const requestUploadUrl = useRequestUploadUrl();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "review">("upload");
  const [versionLabel, setVersionLabel] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [rows, setRows] = useState<RateRow[]>([]);

  const ACCEPTED = ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel", "text/csv", "text/plain"];

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const ok = ACCEPTED.includes(file.type) || ["pdf", "xlsx", "xls", "csv", "txt"].includes(ext);
    if (!ok) { toast({ variant: "destructive", title: "Unsupported file", description: "Please upload a PDF, Excel (.xlsx), or CSV file." }); return; }
    setSelectedFile(file);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleExtract = async () => {
    if (!versionLabel.trim()) { toast({ variant: "destructive", title: "Version label required.", description: "Please enter a label before extracting." }); return; }
    if (!selectedFile) { toast({ variant: "destructive", title: "No file selected.", description: "Please upload a rates file first." }); return; }
    setExtracting(true);
    try {
      const urlData = await requestUploadUrl.mutateAsync({ data: { name: selectedFile.name, size: selectedFile.size, contentType: selectedFile.type || "application/octet-stream" } });
      await fetch(urlData.uploadURL, { method: "PUT", body: selectedFile, headers: { "Content-Type": selectedFile.type || "application/octet-stream" } });
      const result = await extractMutation.mutateAsync({ data: { storagePath: urlData.objectPath, mimeType: selectedFile.type || undefined } });
      const extracted = (result as { rates?: ExtractedRateRow[] }).rates ?? [];
      if (extracted.length === 0) {
        toast({ variant: "destructive", title: "No rates found", description: "AI could not identify any rate rows in this file. Try a different file or check the format." });
        return;
      }
      setRows(extracted.map(r => ({ ...r, validFrom: r.validFrom ?? null, validTo: r.validTo ?? null })));
      setStep("review");
      toast({ title: `${extracted.length} rate rows extracted`, description: "Review and edit below, then save." });
    } catch (err) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? "Extraction failed. Please try again.";
      toast({ variant: "destructive", title: "Extraction failed", description: msg });
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = () => {
    const validRows = rows.filter(r => r.lawFirmName && r.jurisdiction && r.roleCode && r.currency && r.maxRate);
    if (validRows.length === 0) { toast({ variant: "destructive", title: "No valid rate rows." }); return; }
    createMutation.mutate({ data: {
      documentKind: "rates",
      versionLabel,
      fileName: selectedFile?.name ?? null,
      rates: validRows.map(r => ({
        lawFirmName: r.lawFirmName,
        jurisdiction: r.jurisdiction,
        roleCode: r.roleCode,
        roleLabel: r.roleLabel || r.roleCode,
        currency: r.currency,
        maxRate: r.maxRate,
        validFrom: r.validFrom || null,
        validTo: r.validTo || null,
      }))
    }}, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPanelBaselineDocumentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPanelRatesQueryKey() });
        toast({ title: "Rates document saved as Draft", description: `${versionLabel} · ${validRows.length} rate rows. Verify and activate when ready.` });
        onClose();
      },
      onError: (err: CreatePanelBaselineDocumentMutationError) =>
        toast({ variant: "destructive", title: "Error", description: (err.data as { error?: string } | null)?.error || "Failed to save document." })
    });
  };

  const updateRow = (idx: number, field: keyof RateRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));
  const addRow = () => setRows(prev => [...prev, { lawFirmName: "", jurisdiction: "", roleCode: "", roleLabel: "", currency: "GBP", maxRate: "", validFrom: null, validTo: null }]);

  const inputClass = "w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={step === "upload" ? onClose : undefined} />
      <div className="relative bg-card border border-border rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">

        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">
              {step === "upload" ? "Upload Rates Document" : "Review Extracted Rates"}
            </h2>
            {step === "review" && (
              <p className="text-sm text-muted-foreground mt-0.5">
                <span className="text-emerald-600 font-medium">✓ {rows.length} rows extracted.</span> Edit any values, then save as draft.
              </p>
            )}
          </div>
          {step === "upload" && (
            <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
          )}
        </div>

        {step === "upload" ? (
          <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Version Label *</label>
              <input value={versionLabel} onChange={e => setVersionLabel(e.target.value)} placeholder="e.g. Panel Rates 2025 v1.0" className={inputClass} />
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">Rates File *</label>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
                  selectedFile ? "border-primary/50 bg-primary/5" : ""
                )}
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" className="hidden" onChange={e => handleFiles(e.target.files)} />
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-4">
                    <FileText className="w-10 h-10 text-primary flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-semibold text-foreground">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{(selectedFile.size / 1024).toFixed(0)} KB · {selectedFile.type || "document"}</p>
                    </div>
                    <button type="button" onClick={e => { e.stopPropagation(); setSelectedFile(null); }} className="ml-4 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-10 h-10 text-muted-foreground/50" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Drop your rates file here</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF · Excel (.xlsx / .xls) · CSV · TXT</p>
                    </div>
                    <span className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">Browse files</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-muted/30 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground text-xs">What AI extracts:</p>
              <p>Law firm name · Jurisdiction · Role code & label · Currency · Hourly rate · Validity period</p>
              <p className="mt-1">Supports rate schedule PDFs, Excel spreadsheets with rate tables, and CSV exports from billing systems.</p>
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium">Cancel</button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={!selectedFile || !versionLabel.trim() || extracting}
                className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {extracting ? (
                  <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Extracting rates…</>
                ) : (
                  <><Sparkles className="w-4 h-4" />Extract Rates</>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6">
              <ReviewTable rows={rows} onUpdate={updateRow} onRemove={removeRow} onAdd={addRow} />
            </div>
            <div className="p-6 border-t border-border flex items-center justify-between flex-shrink-0">
              <button type="button" onClick={() => setStep("upload")} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                <Pencil className="w-3.5 h-3.5" />Change file
              </button>
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium">Cancel</button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={createMutation.isPending || rows.length === 0}
                  className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-60 flex items-center gap-2 transition-colors"
                >
                  {createMutation.isPending ? (
                    <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</>
                  ) : (
                    <><Check className="w-4 h-4" />Save as Draft</>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddTCDocumentModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreatePanelBaselineDocument();
  const [versionLabel, setVersionLabel] = useState("");
  const [fileName, setFileName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionLabel) { toast({ variant: "destructive", title: "Version label is required." }); return; }
    createMutation.mutate({ data: {
      documentKind: "terms_conditions",
      versionLabel,
      fileName: fileName || null,
    }}, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPanelBaselineDocumentsQueryKey() });
        toast({ title: "Panel T&C document created", description: `${versionLabel} saved as Draft. Verify and activate when ready.` });
        onClose();
      },
      onError: (err: CreatePanelBaselineDocumentMutationError) => toast({ variant: "destructive", title: "Error", description: (err.data as { error?: string } | null)?.error || "Failed to create document." })
    });
  };

  const inputClass = "w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-3xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-display font-bold text-foreground">Add Panel T&C Document</h2>
          <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">Register a Panel Terms &amp; Conditions document version. Once verified, you can activate it — activating a version will automatically archive the current active version.</p>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Version Label *</label>
            <input value={versionLabel} onChange={e => setVersionLabel(e.target.value)} placeholder="e.g. Panel T&C 2025 v2.0" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Source File Name</label>
            <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="e.g. Panel_TC_2025_v2.pdf" className={inputClass} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium">Cancel</button>
            <button type="submit" disabled={createMutation.isPending} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-70 flex items-center gap-2">
              {createMutation.isPending ? "Saving..." : <><Plus className="w-4 h-4" />Create Document</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DocumentStatusActions({ doc, onUpdate }: { doc: PanelBaselineDocument; onUpdate: () => void }) {
  const { toast } = useToast();
  const updateStatus = useUpdatePanelBaselineDocumentStatus();

  const change = (status: DocStatus) => {
    updateStatus.mutate({ id: doc.id, data: { status } }, {
      onSuccess: () => {
        toast({ title: `Document ${status === "active" ? "activated" : status}.`, description: status === "active" ? "Previous active version has been archived." : undefined });
        onUpdate();
      },
      onError: (err: UpdatePanelBaselineDocumentStatusMutationError) =>
        toast({ variant: "destructive", title: "Error", description: (err.data as { error?: string } | null)?.error || "Failed to update status." })
    });
  };

  const isPending = updateStatus.isPending;

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {doc.verificationStatus === "draft" && (
        <button onClick={() => change("verified")} disabled={isPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60 flex items-center gap-1.5 transition-colors">
          <ShieldCheck className="w-3.5 h-3.5" />Verify
        </button>
      )}
      {(doc.verificationStatus === "verified" || doc.verificationStatus === "draft") && (
        <button onClick={() => change("active")} disabled={isPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 flex items-center gap-1.5 transition-colors">
          <CheckCircle2 className="w-3.5 h-3.5" />Activate
        </button>
      )}
      {doc.verificationStatus === "active" && (
        <button onClick={() => change("archived")} disabled={isPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-muted text-muted-foreground hover:bg-muted disabled:opacity-60 flex items-center gap-1.5 transition-colors">
          <Archive className="w-3.5 h-3.5" />Archive
        </button>
      )}
      {doc.verificationStatus === "archived" && (
        <button onClick={() => change("active")} disabled={isPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 flex items-center gap-1.5 transition-colors">
          <CheckCircle2 className="w-3.5 h-3.5" />Re-activate
        </button>
      )}
    </div>
  );
}

function PanelTCSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const { data: docs = [], isLoading } = useListPanelBaselineDocuments(
    { documentKind: "terms_conditions" },
    { query: { queryKey: getListPanelBaselineDocumentsQueryKey({ documentKind: "terms_conditions" }) } }
  );

  const activeDoc = docs.find(d => d.verificationStatus === "active");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPanelBaselineDocumentsQueryKey() });

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h2 className="text-sm font-semibold text-foreground">Panel Terms &amp; Conditions</h2>
          {activeDoc && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="w-3 h-3" />Active: {activeDoc.versionLabel}
            </span>
          )}
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
          <Plus className="w-3.5 h-3.5" />Add Version
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="p-8 flex flex-col items-center text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No Panel T&C documents yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Add a version, verify it, and activate it to use in invoice analysis.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {docs.map(doc => (
            <div key={doc.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-foreground">{doc.versionLabel}</p>
                    <StatusBadge status={doc.verificationStatus as DocStatus} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {doc.fileName && <span>{doc.fileName} · </span>}
                    Added {new Date(doc.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {doc.activatedAt && <span> · Activated {new Date(doc.activatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                  </p>
                </div>
              </div>
              <DocumentStatusActions doc={doc} onUpdate={invalidate} />
            </div>
          ))}
        </div>
      )}

      {showCreate && <AddTCDocumentModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function RatesTable({ documentId, firmFilter, jurisdictionFilter }: { documentId?: number; firmFilter: string; jurisdictionFilter: string }) {
  const { data: rates = [], isLoading } = useListPanelRates(
    { documentId, firmName: firmFilter || undefined, jurisdiction: jurisdictionFilter || undefined },
    { query: { queryKey: getListPanelRatesQueryKey({ documentId, firmName: firmFilter || undefined, jurisdiction: jurisdictionFilter || undefined }) } }
  );

  if (isLoading) return <div className="flex justify-center py-8"><div className="animate-spin text-primary text-xl">⟳</div></div>;
  if (rates.length === 0) return <div className="text-center py-8 text-muted-foreground text-sm">No rates found for the selected filters.</div>;

  const grouped: Record<string, Record<string, PanelRate[]>> = {};
  for (const rate of rates) {
    if (!grouped[rate.lawFirmName]) grouped[rate.lawFirmName] = {};
    if (!grouped[rate.lawFirmName][rate.jurisdiction]) grouped[rate.lawFirmName][rate.jurisdiction] = [];
    grouped[rate.lawFirmName][rate.jurisdiction].push(rate);
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([firmName, byJurisdiction]) => (
        <div key={firmName} className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{firmName}</h3>
          </div>
          {Object.entries(byJurisdiction).map(([jurisdiction, jRates]) => (
            <div key={jurisdiction}>
              <div className="px-5 py-2 bg-muted/10 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{jurisdiction}</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-5 text-xs font-semibold text-muted-foreground">Role</th>
                    <th className="py-2 px-5 text-xs font-semibold text-muted-foreground text-right">Max Rate</th>
                    <th className="py-2 px-5 text-xs font-semibold text-muted-foreground">Currency</th>
                    <th className="py-2 px-5 text-xs font-semibold text-muted-foreground">Valid From</th>
                    <th className="py-2 px-5 text-xs font-semibold text-muted-foreground">Valid To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {jRates.map(rate => (
                    <tr key={rate.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-5 text-foreground font-medium">{rate.roleLabel}</td>
                      <td className="py-2.5 px-5 text-foreground text-right font-mono">{Number(rate.maxRate).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</td>
                      <td className="py-2.5 px-5 text-muted-foreground">{rate.currency}</td>
                      <td className="py-2.5 px-5 text-muted-foreground">{rate.validFrom ?? "—"}</td>
                      <td className="py-2.5 px-5 text-muted-foreground">{rate.validTo ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RatesDocumentsSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [firmFilter, setFirmFilter] = useState("__all__");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("__all__");

  const { data: allRatesForOptions = [] } = useListPanelRates({});
  const uniqueFirmNames = [...new Set(allRatesForOptions.map(r => r.lawFirmName))].sort();
  const uniqueJurisdictions = [...new Set(allRatesForOptions.map(r => r.jurisdiction))].sort();

  const { data: documents = [], isLoading: docsLoading } = useListPanelBaselineDocuments(
    { documentKind: "rates" },
    { query: { queryKey: getListPanelBaselineDocumentsQueryKey({ documentKind: "rates" }) } }
  );

  const activeDoc = documents.find(d => d.verificationStatus === "active");

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-muted-foreground" />Panel Rate Schedules
      </h2>

      {/* Current version card */}
      <div className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Current rates version</p>
            {docsLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : activeDoc ? (
              <>
                <p className="text-sm font-semibold text-foreground">{activeDoc.versionLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {activeDoc.fileName && <span>{activeDoc.fileName} · </span>}
                  {activeDoc.activatedAt
                    ? `Activated ${new Date(activeDoc.activatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                    : `Added ${new Date(activeDoc.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No active rates version — add one to get started.</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:bg-primary/90 transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          {activeDoc ? "Replace Version" : "Add Version"}
        </button>
      </div>

      {/* Rates table with filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Select value={firmFilter} onValueChange={setFirmFilter}>
            <SelectTrigger className="w-full rounded-xl border border-border bg-card text-sm h-10">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <SelectValue placeholder="Filter by firm name..." />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All firms</SelectItem>
              {uniqueFirmNames.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Select value={jurisdictionFilter} onValueChange={setJurisdictionFilter}>
            <SelectTrigger className="w-full rounded-xl border border-border bg-card text-sm h-10">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <SelectValue placeholder="Filter by jurisdiction..." />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All jurisdictions</SelectItem>
              {uniqueJurisdictions.map(j => (
                <SelectItem key={j} value={j}>{j}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <RatesTable
        documentId={activeDoc?.id}
        firmFilter={firmFilter === "__all__" ? "" : firmFilter}
        jurisdictionFilter={jurisdictionFilter === "__all__" ? "" : jurisdictionFilter}
      />

      {showCreate && <AddRatesDocumentModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

export default function Rates() {
  const [tab, setTab] = useState<"rates" | "tc">("rates");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Rates &amp; Panel T&amp;C</h1>
        <p className="text-muted-foreground mt-1">Manage panel rate schedules and Panel Terms &amp; Conditions documents.</p>
      </div>

      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
        <button
          onClick={() => setTab("rates")}
          className={cn("px-5 py-2 rounded-lg text-sm font-semibold transition-colors", tab === "rates" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          Rate Schedules
        </button>
        <button
          onClick={() => setTab("tc")}
          className={cn("px-5 py-2 rounded-lg text-sm font-semibold transition-colors", tab === "tc" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          Panel T&amp;C
        </button>
      </div>

      {tab === "rates" ? <RatesDocumentsSection /> : <PanelTCSection />}
    </div>
  );
}
