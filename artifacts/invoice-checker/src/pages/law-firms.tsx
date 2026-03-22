import React, { useState, useRef, useCallback } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useListLawFirms,
  useCreateLawFirm,
  useUpdateLawFirm,
  useGetLawFirm,
  useExtractLawFirmTermsFromTc,
  useExtractLawFirmInfo,
  useUpsertLawFirmTerms,
  useRequestUploadUrl,
  useCreatePanelBaselineDocument,
  getListLawFirmsQueryKey,
  getListPanelBaselineDocumentsQueryKey,
  useGetMe,
  type LawFirmDetail,
  type CreateLawFirmMutationError,
  type UpdateLawFirmMutationError,
} from "@workspace/api-client-react";
import {
  Building2, Plus, Search, ChevronRight,
  CheckCircle, Globe, Briefcase, X, Pencil, Save, Trash2, AlertTriangle,
  Upload, FileText, Sparkles, CheckCircle2, Clock, Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TERM_LABELS: Record<string, string> = {
  billing_type_default: "Default Billing Type",
  discount_type: "Discount Type",
  discount_payment_type: "Discount Payment Method",
  discount_thresholds_json: "Volume Discount Thresholds",
  max_daily_hours_per_timekeeper: "Max Daily Hours (per timekeeper)",
  getting_up_to_speed_billable: "Getting Up to Speed Billable?",
  payment_terms_days: "Payment Terms (days)",
  travel_policy: "Travel Policy",
  expense_policy_json: "Expense Policy",
  third_party_services_require_approval: "Third-party Services Require Approval?",
  contract_start_date: "Contract Start Date",
  contract_end_date: "Contract End Date",
  best_friend_firms_json: "Best Friend Firms",
};

type DiscountBand = { from?: number; to?: number | null; pct?: number; threshold?: number; method?: string };
type ExpensePolicy = { allowed?: string[]; not_allowed?: string[]; caps?: Record<string, number> };

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}

function formatDiscountThresholds(bands: DiscountBand[]): React.ReactNode {
  if (!bands.length) return "—";
  return (
    <div className="space-y-0.5">
      {bands.map((b, i) => {
        const from = b.from ?? b.threshold ?? 0;
        const to = b.to;
        const pct = b.pct ?? 0;
        const range = to != null ? `${fmtNum(from)} – ${fmtNum(to)}` : `${fmtNum(from)}+`;
        return (
          <div key={i} className="text-xs text-right">
            <span className="text-muted-foreground">{range}:</span>{" "}
            <span className="font-semibold">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function formatExpensePolicy(policy: ExpensePolicy): React.ReactNode {
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      {(policy.allowed?.length ?? 0) > 0 && (
        <div>
          <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Allowed</span>
          <ul className="mt-1 space-y-1">
            {policy.allowed!.map((item, i) => (
              <li key={i} className="flex items-start gap-1 text-xs text-foreground">
                <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(policy.not_allowed?.length ?? 0) > 0 && (
        <div>
          <span className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">Not Allowed</span>
          <ul className="mt-1 space-y-1">
            {policy.not_allowed!.map((item, i) => (
              <li key={i} className="flex items-start gap-1 text-xs text-foreground">
                <span className="text-red-500 shrink-0 mt-0.5">✕</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatTermValue(termKey: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);

  if (termKey === "discount_thresholds_json" && Array.isArray(value)) {
    return formatDiscountThresholds(value as DiscountBand[]);
  }
  if (termKey === "expense_policy_json" && typeof value === "object" && !Array.isArray(value)) {
    return formatExpensePolicy(value as ExpensePolicy);
  }
  if (termKey === "best_friend_firms_json" && Array.isArray(value)) {
    return (value as string[]).join(", ");
  }
  if (Array.isArray(value)) return (value as unknown[]).map(v => typeof v === "string" ? v : JSON.stringify(v)).join(", ");
  return JSON.stringify(value);
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "warning" | "muted" | "panel" | "non-panel" }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold", {
      "bg-primary/10 text-primary": variant === "default",
      "bg-emerald-100 text-emerald-700": variant === "success",
      "bg-amber-100 text-amber-700": variant === "warning",
      "bg-muted text-muted-foreground": variant === "muted",
      "bg-blue-100 text-blue-700": variant === "panel",
      "bg-orange-100 text-orange-700": variant === "non-panel",
    })}>
      {children}
    </span>
  );
}

type FormData = {
  name: string; firmType: string; contactName: string; contactEmail: string;
  contactPhone: string; relationshipPartner: string; notes: string;
  jurisdictions: string; practiceAreas: string;
};

const PRACTICE_AREAS = [
  "Mergers & Acquisitions",
  "Corporate Finance",
  "Regulatory & Compliance",
  "Litigation & Dispute Resolution",
  "Real Estate",
  "Employment & Labor",
  "Tax",
  "Intellectual Property",
  "Banking & Finance",
  "Restructuring & Insolvency",
];

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

const JURISDICTIONS = [
  "England & Wales",
  "United States (NY)",
  "Spain",
  "Germany",
  "France",
  "Netherlands",
  "Singapore",
  "Hong Kong",
  "UAE (DIFC)",
  "Australia",
];

function MultiSelectDropdown({ options, value, onChange, placeholder }: {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = value ? value.split(",").map(s => s.trim()).filter(Boolean) : [];

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(opt: string) {
    const next = selected.includes(opt)
      ? selected.filter(s => s !== opt)
      : [...selected, opt];
    onChange(next.join(", "));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-sm text-left flex items-center justify-between gap-2"
      >
        <span className={selected.length === 0 ? "text-muted-foreground" : "text-foreground"}>
          {selected.length === 0 ? placeholder : selected.join(", ")}
        </span>
        <svg className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-52 overflow-y-auto py-1">
            {options.map(opt => (
              <label key={opt} className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/40 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  className="accent-primary h-3.5 w-3.5 flex-shrink-0"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-border px-4 py-2">
              <button type="button" onClick={() => onChange("")} className="text-xs text-muted-foreground hover:text-foreground">Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FirmFormFields({ data, onChange }: { data: FormData; onChange: (field: string, value: string) => void }) {
  const inputClass = "w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-sm";

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="block text-sm font-semibold text-foreground mb-1.5">Firm Name *</label>
        <input className={inputClass} value={data.name} onChange={e => onChange("name", e.target.value)} placeholder="e.g. Harrington & Belmont LLP" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Firm Type *</label>
        <select className={inputClass} value={data.firmType} onChange={e => onChange("firmType", e.target.value)}>
          <option value="panel">Panel</option>
          <option value="non_panel">Non-Panel</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Relationship Partner</label>
        <select className={inputClass} value={data.relationshipPartner} onChange={e => onChange("relationshipPartner", e.target.value)}>
          <option value="">— Select partner —</option>
          {RELATIONSHIP_PARTNERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Contact Name</label>
        <input className={inputClass} value={data.contactName} onChange={e => onChange("contactName", e.target.value)} placeholder="e.g. Oliver Harrington" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Contact Email</label>
        <input className={inputClass} value={data.contactEmail} onChange={e => onChange("contactEmail", e.target.value)} placeholder="e.g. o.h@firm.com" type="email" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Contact Phone</label>
        <input className={inputClass} value={data.contactPhone} onChange={e => onChange("contactPhone", e.target.value)} placeholder="e.g. +44 20 7000 0001" />
      </div>
      <div className="col-span-2">
        <label className="block text-sm font-semibold text-foreground mb-1.5">Jurisdictions</label>
        <MultiSelectDropdown
          options={JURISDICTIONS}
          value={data.jurisdictions}
          onChange={val => onChange("jurisdictions", val)}
          placeholder="Select jurisdictions…"
        />
      </div>
      <div className="col-span-2">
        <label className="block text-sm font-semibold text-foreground mb-1.5">Practice Areas</label>
        <MultiSelectDropdown
          options={PRACTICE_AREAS}
          value={data.practiceAreas}
          onChange={val => onChange("practiceAreas", val)}
          placeholder="Select practice areas…"
        />
      </div>
      <div className="col-span-2">
        <label className="block text-sm font-semibold text-foreground mb-1.5">Notes</label>
        <textarea className={cn(inputClass, "h-20 resize-none")} value={data.notes} onChange={e => onChange("notes", e.target.value)} placeholder="Internal notes about this firm..." />
      </div>
    </div>
  );
}

const emptyForm: FormData = { name: "", firmType: "panel", contactName: "", contactEmail: "", contactPhone: "", relationshipPartner: "", notes: "", jurisdictions: "", practiceAreas: "" };

function parseForm(form: FormData) {
  return {
    name: form.name,
    firmType: form.firmType as "panel" | "non_panel",
    contactName: form.contactName || null,
    contactEmail: form.contactEmail || null,
    contactPhone: form.contactPhone || null,
    relationshipPartner: form.relationshipPartner || null,
    notes: form.notes || null,
    jurisdictions: form.jurisdictions ? form.jurisdictions.split(",").map(s => s.trim()).filter(Boolean) : [],
    practiceAreas: form.practiceAreas ? form.practiceAreas.split(",").map(s => s.trim()).filter(Boolean) : [],
  };
}

function TcUploadStep({ firmId, firmName, onDone }: { firmId: number; firmName: string; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extractedCount, setExtractedCount] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestUploadUrl = useRequestUploadUrl();
  const extractMutation = useExtractLawFirmTermsFromTc();

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    const ok = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/plain"].includes(file.type);
    if (!ok) { toast({ variant: "destructive", title: "Unsupported file type", description: "Please upload a PDF, DOCX, or TXT file." }); return; }
    setSelectedFile(file);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleExtract = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const urlData = await requestUploadUrl.mutateAsync({ data: { name: selectedFile.name, size: selectedFile.size, contentType: selectedFile.type || "application/pdf" } });
      await fetch(urlData.uploadURL, { method: "PUT", body: selectedFile, headers: { "Content-Type": selectedFile.type || "application/pdf" } });
      const result = await extractMutation.mutateAsync({ id: firmId, data: { storagePath: urlData.objectPath, mimeType: selectedFile.type || "application/pdf" } });
      setExtractedCount((result as { extracted?: number }).extracted ?? 0);
      queryClient.invalidateQueries({ queryKey: ["law-firms", firmId] });
      queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
    } catch (err) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? "Failed to extract terms. Please try again.";
      toast({ variant: "destructive", title: "Extraction failed", description: msg });
    } finally {
      setUploading(false);
    }
  };

  if (extractedCount !== null) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <div>
          <p className="text-lg font-bold text-foreground">{extractedCount} commercial term{extractedCount !== 1 ? "s" : ""} extracted</p>
          <p className="text-sm text-muted-foreground mt-1">from <span className="font-medium">{firmName}</span>'s T&C document. You can review and verify them on the firm detail page.</p>
        </div>
        <button onClick={onDone} className="mt-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors">Done</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-base font-bold text-foreground">Upload Terms & Conditions</h3>
        <p className="text-sm text-muted-foreground mt-1">Upload the firm's engagement letter or T&C document. AI will extract commercial terms automatically.</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50",
          selectedFile ? "border-primary/50 bg-primary/5" : ""
        )}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={e => handleFiles(e.target.files)} />
        {selectedFile ? (
          <div className="flex items-center justify-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(0)} KB · {selectedFile.type || "document"}</p>
            </div>
            <button type="button" onClick={e => { e.stopPropagation(); setSelectedFile(null); }} className="ml-2 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Drop file here or click to browse</p>
            <p className="text-xs text-muted-foreground">PDF, DOCX, or TXT · max 50 MB</p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onDone} className="flex-1 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium transition-colors">
          Skip for now
        </button>
        <button
          type="button"
          onClick={handleExtract}
          disabled={!selectedFile || uploading}
          className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {uploading ? (
            <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Extracting…</>
          ) : (
            <><Sparkles className="w-4 h-4" />Extract Terms</>
          )}
        </button>
      </div>
    </div>
  );
}

function CreateFirmModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateLawFirm();
  const requestUploadUrl = useRequestUploadUrl();
  const extractInfoMutation = useExtractLawFirmInfo();
  const extractTermsMutation = useExtractLawFirmTermsFromTc();
  const createPanelTCMutation = useCreatePanelBaselineDocument();
  const [form, setForm] = useState<FormData>(emptyForm);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [uploadedMimeType, setUploadedMimeType] = useState<string>("application/pdf");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/plain"];

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!ACCEPTED.includes(file.type)) {
      toast({ variant: "destructive", title: "Unsupported file type", description: "Please upload a PDF, DOCX, or TXT file." });
      return;
    }
    setSelectedFile(file);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleExtract = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const mimeType = selectedFile.type || "application/pdf";
      const urlData = await requestUploadUrl.mutateAsync({ data: { name: selectedFile.name, size: selectedFile.size, contentType: mimeType } });
      await fetch(urlData.uploadURL, { method: "PUT", body: selectedFile, headers: { "Content-Type": mimeType } });
      setUploadedPath(urlData.objectPath);
      setUploadedMimeType(mimeType);
      const extracted = await extractInfoMutation.mutateAsync({ data: { storagePath: urlData.objectPath, mimeType } });
      const info = extracted as { name?: string | null; firmType?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; relationshipPartner?: string | null; jurisdictions?: string[]; practiceAreas?: string[]; notes?: string | null };
      setForm({
        name: info.name ?? "",
        firmType: (["panel", "preferred", "specialist", "ad_hoc"].includes(info.firmType ?? "") ? info.firmType : "panel") as FormData["firmType"],
        contactName: info.contactName ?? "",
        contactEmail: info.contactEmail ?? "",
        contactPhone: info.contactPhone ?? "",
        relationshipPartner: info.relationshipPartner ?? "",
        jurisdictions: (info.jurisdictions ?? []).join(", "),
        practiceAreas: (info.practiceAreas ?? []).join(", "),
        notes: info.notes ?? "",
      });
      setStep("review");
    } catch (err) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? "Failed to extract. Please try again.";
      toast({ variant: "destructive", title: "Extraction failed", description: msg });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { toast({ variant: "destructive", title: "Firm name is required." }); return; }
    createMutation.mutate({ data: parseForm(form) }, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
        const created = result as { id: number; name: string };
        if (uploadedPath) {
          const tcFileName = selectedFile?.name ?? null;
          const tcVersionLabel = `T&C — ${created.name}`;
          extractTermsMutation.mutateAsync({ id: created.id, data: { storagePath: uploadedPath, mimeType: uploadedMimeType } })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ["law-firms", created.id] });
              queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
            })
            .catch(() => {});
          createPanelTCMutation.mutateAsync({ data: { documentKind: "terms_conditions", versionLabel: tcVersionLabel, fileName: tcFileName } })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: getListPanelBaselineDocumentsQueryKey() });
            })
            .catch(() => {});
        }
        onClose();
      },
      onError: (err: CreateLawFirmMutationError) => toast({ variant: "destructive", title: "Error", description: (err.data as { error?: string } | null)?.error || "Failed to create firm." })
    });
  };

  const STEP_TITLES: Record<typeof step, string> = {
    upload: "Add Law Firm",
    review: "Review Firm Details",
  };

  const STEP_SUBTITLES: Partial<Record<typeof step, React.ReactNode>> = {
    upload: "Upload a document to auto-fill the fields with AI, or skip to enter details manually.",
    review: "Review and edit the extracted details before creating the firm.",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={step === "upload" ? onClose : undefined} />
      <div className="relative bg-card border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">{STEP_TITLES[step]}</h2>
            {STEP_SUBTITLES[step] && <p className="text-sm text-muted-foreground mt-0.5">{STEP_SUBTITLES[step]}</p>}
          </div>
          {step === "upload" && (
            <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
          )}
        </div>

        <div className="p-6">
          {/* Step 1: Upload document for AI extraction */}
          {step === "upload" && (
            <div className="space-y-5">
              {/* Step indicators */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold text-[10px]">1</span>
                <span className="font-medium text-foreground">Upload document</span>
                <span className="flex-1 h-px bg-border" />
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted font-bold text-[10px]">2</span>
                <span>Review &amp; create</span>
              </div>

              {/* Drop zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"
                )}
              >
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={e => handleFiles(e.target.files)} />
                <div className="flex flex-col items-center gap-3">
                  {selectedFile ? (
                    <>
                      <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center">
                        <FileText className="w-6 h-6 text-emerald-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <p className="text-xs text-muted-foreground">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                        <Upload className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">Drop an engagement letter, pitch deck or any firm document</p>
                        <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, or TXT — AI will extract firm details automatically</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setForm(emptyForm); setStep("review"); }}
                  className="flex-1 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium transition-colors"
                >
                  Skip — enter manually
                </button>
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={!selectedFile || uploading}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Extracting…</>
                  ) : (
                    <><Sparkles className="w-4 h-4" />Extract with AI</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Review/edit details and create */}
          {step === "review" && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Step indicators */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white font-bold text-[10px]">✓</span>
                <span className="text-muted-foreground">Upload document</span>
                <span className="flex-1 h-px bg-border" />
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold text-[10px]">2</span>
                <span className="font-medium text-foreground">Review &amp; create</span>
              </div>
              <FirmFormFields data={form} onChange={(f, v) => setForm(prev => ({ ...prev, [f]: v }))} />
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setStep("upload")} className="px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium">Back</button>
                <button type="submit" disabled={createMutation.isPending} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-70 transition-colors flex items-center gap-2">
                  {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : <><Plus className="w-4 h-4" />Create Firm</>}
                </button>
              </div>
            </form>
          )}


        </div>
      </div>
    </div>
  );
}

function FirmDetailPanel({ firmId, onClose }: { firmId: number; onClose: () => void }) {
  const { data: firm, isLoading } = useGetLawFirm(firmId, { query: { queryKey: ["law-firms", firmId] } });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateLawFirm();
  const upsertTerms = useUpsertLawFirmTerms();
  const { data: me } = useGetMe();
  const isSuperAdmin = (me as { role?: string } | undefined)?.role === "super_admin";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [showTcUpload, setShowTcUpload] = useState(false);
  const [verifyingTermKey, setVerifyingTermKey] = useState<string | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/law-firms/${firmId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to delete law firm");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
      toast({ title: "Law firm deleted." });
      onClose();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Error", description: err.message }),
  });

  const handleStartEdit = () => {
    if (!firm) return;
    setForm({
      name: firm.name, firmType: firm.firmType,
      contactName: firm.contactName ?? "", contactEmail: firm.contactEmail ?? "",
      contactPhone: firm.contactPhone ?? "", relationshipPartner: firm.relationshipPartner ?? "",
      notes: firm.notes ?? "", jurisdictions: firm.jurisdictions.join(", "),
      practiceAreas: firm.practiceAreas.join(", "),
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({ id: firmId, data: parseForm(form) }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["law-firms", firmId] });
        toast({ title: "Changes saved." });
        setEditing(false);
      },
      onError: (err: UpdateLawFirmMutationError) => toast({ variant: "destructive", title: "Error", description: (err.data as { error?: string } | null)?.error || "Failed to update." })
    });
  };

  const handleToggleActive = () => {
    if (!firm) return;
    updateMutation.mutate({ id: firmId, data: { isActive: !firm.isActive } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["law-firms", firmId] });
        toast({ title: firm.isActive ? "Firm deactivated." : "Firm reactivated." });
      }
    });
  };

  const handleVerifyTerm = async (termKey: string) => {
    const typedFirm = firm as LawFirmDetail & { terms?: Array<{ id: number; termKey: string; termValue: unknown; verificationStatus: string; sourceType: string }> };
    if (!typedFirm.terms) return;
    setVerifyingTermKey(termKey);
    try {
      await upsertTerms.mutateAsync({
        id: firmId,
        data: {
          terms: typedFirm.terms.map(t => ({
            termKey: t.termKey,
            termValue: t.termValue,
            verificationStatus: (t.termKey === termKey ? "verified" : t.verificationStatus) as "draft" | "verified",
          })),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["law-firms", firmId] });
      queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
      toast({ title: "Term verified", description: "The term has been marked as manually verified." });
    } catch {
      toast({ variant: "destructive", title: "Verification failed", description: "Could not verify term. Please try again." });
    } finally {
      setVerifyingTermKey(null);
    }
  };

  const handleVerifyAll = async () => {
    const typedFirm = firm as LawFirmDetail & { terms?: Array<{ id: number; termKey: string; termValue: unknown; verificationStatus: string; sourceType: string }> };
    if (!typedFirm.terms) return;
    setVerifyingAll(true);
    try {
      await upsertTerms.mutateAsync({
        id: firmId,
        data: {
          terms: typedFirm.terms.map(t => ({
            termKey: t.termKey,
            termValue: t.termValue,
            verificationStatus: "verified" as const,
          })),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["law-firms", firmId] });
      queryClient.invalidateQueries({ queryKey: getListLawFirmsQueryKey() });
      toast({ title: "All terms verified", description: "All commercial terms have been marked as manually verified." });
    } catch {
      toast({ variant: "destructive", title: "Verification failed", description: "Could not verify terms. Please try again." });
    } finally {
      setVerifyingAll(false);
    }
  };

  if (isLoading || !firm) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-end">
        <div className="absolute inset-0 bg-black/20" onClick={onClose} />
        <div className="relative w-full lg:w-[520px] h-full bg-card border-l border-border flex items-center justify-center">
          <div className="text-primary text-2xl animate-spin">⟳</div>
        </div>
      </div>
    );
  }

  const typedFirm = firm as LawFirmDetail;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full lg:w-[520px] h-full bg-card border-l border-border overflow-y-auto animate-in slide-in-from-right duration-300 shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">{firm.name}</h2>
            <div className="flex gap-2 mt-1">
              <Badge variant={firm.firmType === "panel" ? "panel" : "non-panel"}>{firm.firmType === "panel" ? "Panel" : "Non-Panel"}</Badge>
              <Badge variant={firm.isActive ? "success" : "muted"}>{firm.isActive ? "Active" : "Inactive"}</Badge>
            </div>
          </div>
          <div className="flex gap-1">
            {!editing && !confirmingDelete && (
              <button onClick={handleStartEdit} title="Edit firm" className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><Pencil className="w-4 h-4" /></button>
            )}
            {isSuperAdmin && !editing && !confirmingDelete && (
              <button onClick={() => setConfirmingDelete(true)} title="Delete firm" className="p-2 rounded-xl text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
            )}
            <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Confirm delete banner */}
        {confirmingDelete && (
          <div className="mx-6 mt-0 mb-0 flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">Delete this law firm?</p>
              <p className="text-xs text-red-600 mt-0.5">This will permanently delete the firm and all its commercial terms. Invoices linked to this firm will not be deleted but will lose their firm reference. This action cannot be undone.</p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-1.5 transition-colors"
                >
                  {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6">
          {editing ? (
            <>
              <FirmFormFields data={form} onChange={(f, v) => setForm(prev => ({ ...prev, [f]: v }))} />
              <div className="flex gap-3">
                <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium">Cancel</button>
                <button onClick={handleSave} disabled={updateMutation.isPending} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-70 flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" />Save Changes
                </button>
              </div>
            </>
          ) : (
            <>
              {firm.jurisdictions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><Globe className="w-3 h-3" />Jurisdictions</p>
                  <div className="flex flex-wrap gap-1.5">{firm.jurisdictions.map(j => <Badge key={j}>{j}</Badge>)}</div>
                </div>
              )}
              {firm.practiceAreas.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><Briefcase className="w-3 h-3" />Practice Areas</p>
                  <div className="flex flex-wrap gap-1.5">{firm.practiceAreas.map(a => <Badge key={a} variant="muted">{a}</Badge>)}</div>
                </div>
              )}
              {(firm.contactName || firm.relationshipPartner) && (
                <div className="grid grid-cols-2 gap-4">
                  {firm.contactName && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Contact</p>
                      <p className="text-sm text-foreground">{firm.contactName}</p>
                      {firm.contactEmail && <p className="text-xs text-muted-foreground">{firm.contactEmail}</p>}
                      {firm.contactPhone && <p className="text-xs text-muted-foreground">{firm.contactPhone}</p>}
                    </div>
                  )}
                  {firm.relationshipPartner && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Relationship Partner</p>
                      <p className="text-sm text-foreground">{firm.relationshipPartner}</p>
                    </div>
                  )}
                </div>
              )}
              {firm.notes && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{firm.notes}</p>
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center justify-between">
                  Commercial Terms
                  <div className="flex items-center gap-2">
                    {typedFirm.terms && typedFirm.terms.length > 0 && (
                      <Badge variant={typedFirm.terms.some(t => t.verificationStatus === "verified") ? "success" : "warning"}>
                        {typedFirm.terms.filter(t => t.verificationStatus === "verified").length}/{typedFirm.terms.length} Verified
                      </Badge>
                    )}
                    {typedFirm.terms && typedFirm.terms.some(t => t.verificationStatus !== "verified") && (
                      <button
                        onClick={handleVerifyAll}
                        disabled={verifyingAll}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-400 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {verifyingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Verify All
                      </button>
                    )}
                    <button
                      onClick={() => setShowTcUpload(v => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      <Upload className="w-3 h-3" />
                      {typedFirm.terms && typedFirm.terms.length > 0 ? "Re-upload T&C" : "Upload T&C"}
                    </button>
                  </div>
                </h3>
                {showTcUpload && (
                  <div className="mb-4 p-4 bg-muted/30 rounded-2xl border border-border">
                    <TcUploadStep
                      firmId={firmId}
                      firmName={firm.name}
                      onDone={() => {
                        setShowTcUpload(false);
                        queryClient.invalidateQueries({ queryKey: ["law-firms", firmId] });
                      }}
                    />
                  </div>
                )}
                {typedFirm.terms && typedFirm.terms.length > 0 && !showTcUpload && (
                  <div className="space-y-2 bg-muted/30 rounded-2xl p-4">
                    {typedFirm.terms.map(term => {
                      const isWide = term.termKey === "travel_policy" || term.termKey === "expense_policy_json";
                      const verifyBtn = term.verificationStatus === "verified" ? (
                        <span title="Verified manually"><CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" /></span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span title="AI-extracted — pending manual verification"><Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" /></span>
                          <button
                            onClick={() => handleVerifyTerm(term.termKey)}
                            disabled={verifyingTermKey === term.termKey}
                            title="Click to verify this term"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-emerald-400 text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {verifyingTermKey === term.termKey
                              ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              : <CheckCircle2 className="w-2.5 h-2.5" />}
                            Verify
                          </button>
                        </div>
                      );

                      if (isWide) {
                        return (
                          <div key={term.id} className="flex flex-col gap-1.5 text-sm pt-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground text-xs font-medium">{TERM_LABELS[term.termKey] ?? term.termKey}</span>
                              {verifyBtn}
                            </div>
                            <div className="text-foreground text-xs">{formatTermValue(term.termKey, term.termValue)}</div>
                          </div>
                        );
                      }

                      return (
                      <div key={term.id} className="flex items-start justify-between gap-4 text-sm">
                        <span className="text-muted-foreground min-w-0 flex-1 pt-0.5">{TERM_LABELS[term.termKey] ?? term.termKey}</span>
                        <div className="flex items-start gap-2 flex-shrink-0">
                          <div className="text-foreground text-right text-xs max-w-[200px]">{formatTermValue(term.termKey, term.termValue)}</div>
                          {verifyBtn}
                        </div>
                      </div>
                    );
                    })}
                    <div className="pt-2 mt-1 border-t border-border/50 flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                        Verified manually
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400" />
                        AI-extracted, pending verification
                      </span>
                    </div>
                  </div>
                )}
                {(!typedFirm.terms || typedFirm.terms.length === 0) && !showTcUpload && (
                  <div className="text-center py-6 bg-muted/30 rounded-2xl border border-dashed border-border">
                    <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No commercial terms on file.</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Upload the firm's T&C to extract them automatically.</p>
                  </div>
                )}
              </div>
              <button
                onClick={handleToggleActive}
                disabled={updateMutation.isPending}
                className={cn(
                  "w-full py-2.5 rounded-xl text-sm font-semibold transition-colors border",
                  firm.isActive ? "border-destructive/30 text-destructive hover:bg-destructive/5" : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-50"
                )}
              >
                {firm.isActive ? "Deactivate Firm" : "Reactivate Firm"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LawFirms() {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "panel" | "non_panel">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: firms = [], isLoading } = useListLawFirms(
    { includeInactive: showInactive },
    { query: { queryKey: getListLawFirmsQueryKey({ includeInactive: showInactive }) } }
  );

  const filtered = firms.filter(f => {
    if (filterType !== "all" && f.firmType !== filterType) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Law Firms</h1>
          <p className="text-muted-foreground mt-1">Manage panel and non-panel law firm relationships.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />Add Law Firm
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search firms..." className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm" />
        </div>
        <div className="flex gap-2">
          {(["all", "panel", "non_panel"] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)} className={cn("px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors", filterType === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-muted")}>
              {t === "all" ? "All" : t === "panel" ? "Panel" : "Non-Panel"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer px-3">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><div className="animate-spin text-primary text-3xl">⟳</div></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-12 flex flex-col items-center text-center">
          <Building2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-display font-bold text-foreground">No firms found</h3>
          <p className="text-muted-foreground mt-1 text-sm">Adjust filters or add a new firm.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
          {filtered.map(firm => (
            <div key={firm.id} onClick={() => setSelectedId(firm.id)} className="flex items-center gap-4 p-4 hover:bg-muted/30 cursor-pointer transition-colors group">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", firm.firmType === "panel" ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600")}>
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground truncate">{firm.name}</p>
                  {!firm.isActive && <Badge variant="muted">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <Badge variant={firm.firmType === "panel" ? "panel" : "non-panel"}>{firm.firmType === "panel" ? "Panel" : "Non-Panel"}</Badge>
                  {firm.jurisdictions.slice(0, 2).map(j => <span key={j} className="text-xs text-muted-foreground">{j}</span>)}
                  {firm.jurisdictions.length > 2 && <span className="text-xs text-muted-foreground">+{firm.jurisdictions.length - 2} more</span>}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateFirmModal onClose={() => setShowCreate(false)} />}
      {selectedId !== null && <FirmDetailPanel firmId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
