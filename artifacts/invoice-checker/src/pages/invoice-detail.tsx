import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetInvoice,
  useListInvoiceDocuments,
  useListInvoiceItems,
  useAddInvoiceDocument,
  useExtractInvoiceData,
  useRequestUploadUrl,
  useRunInvoiceAnalysis,
  useListInvoiceIssues,
  type InvoiceItem,
  type InvoiceDocument,
  type InvoiceIssue,
  type AnalysisRunResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetInvoiceQueryKey,
  getListInvoiceDocumentsQueryKey,
  getListInvoiceIssuesQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Loader2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Sparkles,
  Upload,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  TriangleAlert,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { format } from "date-fns";

const STATUS_LABELS: Record<string, string> = {
  extracting_data: "Extracting Data",
  in_review: "In Review",
  waiting_internal_lawyer: "Awaiting Lawyer",
  pending_law_firm: "Pending Firm",
  ready_to_pay: "Ready to Pay",
};

const STATUS_COLOURS: Record<string, string> = {
  extracting_data: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  waiting_internal_lawyer: "bg-purple-100 text-purple-800",
  pending_law_firm: "bg-orange-100 text-orange-800",
  ready_to_pay: "bg-green-100 text-green-800",
};

const KIND_LABELS: Record<string, string> = {
  invoice_file: "Invoice File",
  engagement_letter: "Engagement Letter",
  budget_estimate: "Budget Estimate",
};

const RULE_LABELS: Record<string, string> = {
  WRONG_CURRENCY: "Wrong Currency",
  MISSING_DOCUMENTS_FIXED_SCOPE: "Missing EL (Fixed Scope)",
  FIXED_SCOPE_AMOUNT_MISMATCH: "Fixed Scope Amount Mismatch",
  LINE_ITEMS_IN_FIXED_SCOPE: "Line Items in Fixed Scope",
  TAX_OR_VAT_MISMATCH: "Tax / VAT Mismatch",
  VOLUME_DISCOUNT_NOT_APPLIED: "Volume Discount Not Applied",
  UNAUTHORIZED_EXPENSE_TYPE: "Unauthorised Expense",
  EXPENSE_CAP_EXCEEDED: "Expense Cap Exceeded",
  DUPLICATE_LINE: "Duplicate Line",
  ARITHMETIC_ERROR: "Arithmetic Error",
  DAILY_HOURS_EXCEEDED: "Daily Hours Exceeded",
  BILLING_PERIOD_OUTSIDE_EL: "Billing Outside EL Period",
  INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER: "Inconsistent Rate",
  RATE_CARD_EXPIRED_OR_MISSING: "Rate Card Missing",
  LAWYER_ROLE_MISMATCH: "Role Not Recognised",
  RATE_EXCESS: "Rate Excess",
  MEETING_OVERSTAFFING: "Meeting Overstaffing",
  EL_CONFLICT_WITH_PANEL_BASELINE: "EL / Panel Conflict",
  HOURS_DISPROPORTIONATE: "Hours Disproportionate",
  PARALLEL_BILLING: "Parallel Billing",
  SCOPE_CREEP: "Scope Creep",
  SENIORITY_OVERKILL: "Seniority Overkill",
  ESTIMATE_EXCESS: "Estimate Exceeded",
  INTERNAL_COORDINATION: "Internal Coordination",
  MISSING_LINE_DETAIL: "Missing Line Detail",
  JURISDICTION_UNCLEAR: "Jurisdiction Unclear",
};

const RULE_TYPE_LABELS: Record<string, string> = {
  objective: "Objective",
  gray: "Grey Area",
  configurable: "Configurable",
  metadata: "Metadata",
};

function DocKindBadge({ kind }: { kind: string }) {
  const colours: Record<string, string> = {
    invoice_file: "bg-blue-100 text-blue-700",
    engagement_letter: "bg-purple-100 text-purple-700",
    budget_estimate: "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colours[kind] ?? "bg-gray-100 text-gray-700"}`}>
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function ExtractionStatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "error") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        <AlertCircle className="h-3 w-3" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
      <TriangleAlert className="h-3 w-3" /> Warning
    </span>
  );
}

function RuleTypeBadge({ ruleType }: { ruleType: string }) {
  const colours: Record<string, string> = {
    objective: "bg-blue-50 text-blue-700 border border-blue-200",
    gray: "bg-purple-50 text-purple-700 border border-purple-200",
    configurable: "bg-orange-50 text-orange-700 border border-orange-200",
    metadata: "bg-gray-50 text-gray-600 border border-gray-200",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colours[ruleType] ?? "bg-gray-50 text-gray-600"}`}>
      {RULE_TYPE_LABELS[ruleType] ?? ruleType}
    </span>
  );
}

function IssueCard({ issue }: { issue: InvoiceIssue }) {
  const [expanded, setExpanded] = useState(false);
  const evidence = issue.evidenceJson as Record<string, unknown> | null;
  const recoverable = issue.recoverableAmount ? parseFloat(issue.recoverableAmount) : null;

  return (
    <div className={`rounded-2xl border ${issue.severity === "error" ? "border-red-200 bg-red-50/40" : "border-amber-200 bg-amber-50/30"} overflow-hidden`}>
      <div
        className="flex items-start gap-3 p-4 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-shrink-0 mt-0.5">
          {issue.severity === "error"
            ? <AlertCircle className="h-5 w-5 text-red-600" />
            : <TriangleAlert className="h-5 w-5 text-amber-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono text-xs font-bold text-muted-foreground tracking-wide">{issue.ruleCode}</span>
            <RuleTypeBadge ruleType={issue.ruleType} />
            <SeverityBadge severity={issue.severity} />
            {recoverable !== null && recoverable > 0 && (
              <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 flex-shrink-0">
                At risk: {recoverable.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-foreground">{RULE_LABELS[issue.ruleCode] ?? issue.ruleCode}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{issue.explanationText}</p>
        </div>
        <div className="flex-shrink-0 ml-2 mt-0.5">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-inherit px-4 pb-4 pt-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Full Explanation</p>
            <p className="text-sm text-foreground leading-relaxed">{issue.explanationText}</p>
          </div>

          {evidence && Object.keys(evidence).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Evidence</p>
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(evidence).map(([k, v]) => (
                      <tr key={k} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5 font-mono text-muted-foreground font-medium w-1/3">{k}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {issue.suggestedAction && (
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suggested Action:</p>
              <p className="text-xs text-foreground font-medium">{issue.suggestedAction}</p>
            </div>
          )}

          {issue.routeToRole && (
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Route to:</p>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                {issue.routeToRole === "legal_ops" ? "Legal Ops" : issue.routeToRole === "internal_lawyer" ? "Internal Lawyer" : issue.routeToRole}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IssuesPanel({ invoiceId, currency }: { invoiceId: number; currency: string | null }) {
  const { data: issues, isLoading } = useListInvoiceIssues(invoiceId);
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!issues || issues.length === 0) {
    return (
      <div className="text-center py-8">
        <ShieldCheck className="mx-auto h-8 w-8 text-green-500 mb-3" />
        <p className="text-sm font-medium text-green-700">No issues found</p>
        <p className="text-xs text-muted-foreground mt-1">This invoice passed all compliance checks.</p>
      </div>
    );
  }

  const errorIssues = issues.filter(i => i.severity === "error");
  const warningIssues = issues.filter(i => i.severity === "warning");
  const totalAtRisk = issues.reduce((sum, i) => sum + (i.recoverableAmount ? parseFloat(i.recoverableAmount) : 0), 0);

  const displayedIssues = showAll ? issues : issues.filter(i => i.severity === "error");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          {errorIssues.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
              <AlertCircle className="h-3.5 w-3.5" /> {errorIssues.length} error{errorIssues.length !== 1 ? "s" : ""}
            </span>
          )}
          {warningIssues.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
              <TriangleAlert className="h-3.5 w-3.5" /> {warningIssues.length} warning{warningIssues.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {totalAtRisk > 0 && (
          <span className="text-sm font-bold text-red-700">
            {currency} {totalAtRisk.toLocaleString("en-GB", { minimumFractionDigits: 2 })} at risk
          </span>
        )}
      </div>

      {warningIssues.length > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAll ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showAll ? "Show errors only" : `Show all ${issues.length} issues (incl. ${warningIssues.length} warning${warningIssues.length !== 1 ? "s" : ""})`}
        </button>
      )}

      <div className="space-y-2">
        {displayedIssues.map(issue => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
  );
}

function AddDocumentModal({ invoiceId, open, onClose }: { invoiceId: number; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<"invoice_file" | "engagement_letter" | "budget_estimate">("engagement_letter");
  const [uploading, setUploading] = useState(false);
  const requestUploadUrl = useRequestUploadUrl();
  const addDocument = useAddInvoiceDocument();
  const queryClient = useQueryClient();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const urlData = await requestUploadUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" } });
      await fetch(urlData.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });

      await addDocument.mutateAsync({
        id: invoiceId,
        data: {
          documentKind: kind,
          fileName: file.name,
          mimeType: file.type || null,
          storagePath: urlData.objectPath,
        },
      });

      toast({ title: "Document added", description: "Document uploaded successfully." });
      queryClient.invalidateQueries({ queryKey: getListInvoiceDocumentsQueryKey(invoiceId) });
      onClose();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to upload document." });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={kind} onValueChange={v => setKind(v as typeof kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice_file">Invoice File</SelectItem>
                <SelectItem value="engagement_letter">Engagement Letter</SelectItem>
                <SelectItem value="budget_estimate">Budget Estimate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="border-2 border-dashed border-border rounded-xl p-6 text-center">
            <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">PDF, DOCX, PNG, JPG accepted</p>
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading…" : "Choose File"}
              </span>
              <input type="file" className="hidden" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" onChange={handleFile} disabled={uploading} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoiceDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = parseInt(params.id, 10);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [analysisRan, setAnalysisRan] = useState(false);

  const { data: invoice, isLoading } = useGetInvoice(id);
  const { data: documents } = useListInvoiceDocuments(id);
  const { data: items } = useListInvoiceItems(id);
  const { data: issues } = useListInvoiceIssues(id);
  const extractData = useExtractInvoiceData();
  const runAnalysis = useRunInvoiceAnalysis();
  const [showAllLines, setShowAllLines] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button variant="link" onClick={() => navigate("/invoices")}>Back to Invoices</Button>
      </div>
    );
  }

  const completeness = invoice.completeness;
  const canRunAnalysis = completeness?.canRunAnalysis ?? false;
  const blockingIssues = completeness?.blockingIssues ?? [];

  const serverHasIssues = (issues ?? []).length > 0;
  const showIssuesPanel = analysisRan || serverHasIssues || (invoice.invoiceStatus !== "extracting_data" && invoice.invoiceStatus !== "in_review");

  const flaggedItemIds = new Set<number>(
    (issues ?? []).map(iss => iss.invoiceItemId).filter((itemId): itemId is number => itemId != null)
  );
  const hasIssues = (issues ?? []).length > 0;
  const allItems = items ?? [];
  const displayItems = (showIssuesPanel && hasIssues && !showAllLines && flaggedItemIds.size > 0)
    ? allItems.filter(item => flaggedItemIds.has(item.id))
    : allItems;

  const handleExtract = async () => {
    setExtracting(true);
    try {
      await extractData.mutateAsync({ id });
      toast({ title: "Extraction complete", description: "AI has extracted invoice data. Review the fields below." });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
    } catch (err: unknown) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? "Failed to extract invoice data.";
      toast({ variant: "destructive", title: "Extraction failed", description: msg });
    } finally {
      setExtracting(false);
    }
  };

  const handleRunAnalysis = async () => {
    try {
      const result: AnalysisRunResult = await runAnalysis.mutateAsync({ id });
      setAnalysisRan(true);
      const issueCount = result.issueCount ?? 0;
      const outcome = result.outcome ?? null;
      if (outcome === "clean") {
        toast({ title: "Analysis complete — Clean", description: "No compliance issues found. Invoice moved to Ready to Pay." });
      } else {
        toast({ title: `Analysis complete — ${issueCount} issue${issueCount !== 1 ? "s" : ""} found`, description: "Review the issues panel below." });
      }
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListInvoiceIssuesQueryKey(id) });
    } catch (err: unknown) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? "Analysis failed.";
      toast({ variant: "destructive", title: "Analysis failed", description: msg });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/invoices")} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="font-mono text-sm text-muted-foreground">{invoice.invoiceNumber}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[invoice.invoiceStatus] ?? "bg-gray-100 text-gray-700"}`}>
          {STATUS_LABELS[invoice.invoiceStatus] ?? invoice.invoiceStatus}
        </span>
        {invoice.amountAtRisk && parseFloat(invoice.amountAtRisk) > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
            <AlertCircle className="h-3.5 w-3.5" />
            {invoice.currency} {parseFloat(invoice.amountAtRisk).toLocaleString("en-GB", { minimumFractionDigits: 2 })} at risk
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-border rounded-3xl bg-card p-6 shadow-sm">
            <h2 className="text-lg font-display font-semibold mb-5">Invoice Summary</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Law Firm</dt>
                <dd className="mt-1 font-medium">{invoice.lawFirmName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Document Type</dt>
                <dd className="mt-1 capitalize">{invoice.documentType}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Matter Name</dt>
                <dd className="mt-1">{invoice.matterName ?? <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project Reference</dt>
                <dd className="mt-1 font-mono text-sm">{invoice.projectReference ?? <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Jurisdiction</dt>
                <dd className="mt-1">{invoice.jurisdiction ?? <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Billing Type</dt>
                <dd className="mt-1">
                  {invoice.billingType
                    ? invoice.billingType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                    : <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice Date</dt>
                <dd className="mt-1">{invoice.invoiceDate ? format(new Date(invoice.invoiceDate), "d MMM yyyy") : <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Due Date</dt>
                <dd className="mt-1">{invoice.dueDate ? format(new Date(invoice.dueDate), "d MMM yyyy") : <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Currency</dt>
                <dd className="mt-1 font-mono">{invoice.currency}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Amount</dt>
                <dd className="mt-1 text-lg font-bold">
                  {invoice.totalAmount
                    ? `${invoice.currency} ${parseFloat(invoice.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
                    : <span className="text-muted-foreground font-normal text-base">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subtotal</dt>
                <dd className="mt-1">{invoice.subtotalAmount ? `${invoice.currency} ${parseFloat(invoice.subtotalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tax Amount</dt>
                <dd className="mt-1">{invoice.taxAmount ? `${invoice.currency} ${parseFloat(invoice.taxAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Internal Requestor</dt>
                <dd className="mt-1">{invoice.internalRequestorName ?? <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{format(new Date(invoice.createdAt), "d MMM yyyy, HH:mm")}</dd>
              </div>
            </dl>
          </div>

          {showIssuesPanel && (
            <div className="border border-border rounded-3xl bg-card shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-gradient-to-r from-red-50 to-card">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  <h2 className="text-lg font-display font-semibold">Compliance Issues</h2>
                </div>
              </div>
              <div className="p-6">
                <IssuesPanel invoiceId={id} currency={invoice.currency} />
              </div>
            </div>
          )}

          <div className="border border-border rounded-3xl bg-card shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-display font-semibold">Line Items</h2>
                <span className="text-sm text-muted-foreground">{allItems.length} lines</span>
                {showIssuesPanel && hasIssues && flaggedItemIds.size > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    <AlertCircle className="h-3 w-3" /> {flaggedItemIds.size} flagged
                  </span>
                )}
              </div>
              {showIssuesPanel && hasIssues && flaggedItemIds.size > 0 && (
                <button
                  onClick={() => setShowAllLines(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAllLines ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showAllLines ? `Show flagged only (${flaggedItemIds.size})` : `Show all ${allItems.length} lines`}
                </button>
              )}
            </div>
            {allItems.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No line items extracted yet. Run AI extraction to populate.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Timekeeper</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayItems.map((item: InvoiceItem) => (
                      <TableRow key={item.id} className={flaggedItemIds.has(item.id) ? "bg-red-50/50" : item.isExpenseLine ? "bg-amber-50/40" : ""}>
                        <TableCell className="text-muted-foreground text-xs">
                          {item.lineNo}
                          {flaggedItemIds.has(item.id) && <AlertCircle className="inline h-3 w-3 text-red-500 ml-1" />}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{item.timekeeperLabel ?? "—"}</TableCell>
                        <TableCell className="text-sm">{item.roleRaw ?? (item.isExpenseLine ? <span className="text-amber-700 text-xs font-medium">Expense</span> : "—")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.workDate ? format(new Date(item.workDate), "d MMM yy") : "—"}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{item.hours ?? "—"}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{item.rateCharged ?? "—"}</TableCell>
                        <TableCell className="text-right text-sm font-mono font-medium">{item.amount ? parseFloat(item.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 }) : "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{item.description ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {showIssuesPanel && hasIssues && !showAllLines && flaggedItemIds.size < allItems.length && (
                  <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground text-center">
                    Showing {displayItems.length} flagged line{displayItems.length !== 1 ? "s" : ""} of {allItems.length} total.{" "}
                    <button className="underline hover:text-foreground" onClick={() => setShowAllLines(true)}>
                      Show all lines
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border border-border rounded-3xl bg-card p-6 shadow-sm">
            <h2 className="text-lg font-display font-semibold mb-4">General Comments</h2>
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No comments yet. Comments will be available in a future update.</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="border border-border rounded-3xl bg-card p-5 shadow-sm">
            <h2 className="text-base font-display font-semibold mb-4">Analysis Readiness</h2>
            <div className="space-y-3">
              {canRunAnalysis ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Ready for analysis</span>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <span className="text-sm font-medium">Completeness warnings</span>
                  </div>
                  <div className="space-y-2">
                    {blockingIssues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-amber-800">{issue.code}</p>
                          <p className="text-xs text-amber-700 mt-0.5">{issue.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <Button
                className="w-full gap-2"
                onClick={handleRunAnalysis}
                disabled={runAnalysis.isPending}
              >
                {runAnalysis.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</>
                  : <><Sparkles className="h-4 w-4" /> Run Checking Analysis</>}
              </Button>
            </div>
          </div>

          <div className="border border-border rounded-3xl bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-display font-semibold">Documents</h2>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddDocOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>

            {!documents || documents.length === 0 ? (
              <div className="text-center py-6">
                <FileText className="mx-auto h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No documents uploaded</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc: InvoiceDocument) => (
                  <div key={doc.id} className="flex items-start gap-3 p-3 rounded-xl border border-border">
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.fileName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <DocKindBadge kind={doc.documentKind} />
                        <ExtractionStatusIcon status={doc.extractionStatus} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-border rounded-3xl bg-card p-5 shadow-sm">
            <h2 className="text-base font-display font-semibold mb-4">AI Extraction</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Extract invoice header fields and line items automatically from the uploaded invoice file.
            </p>
            <Button
              className="w-full gap-2"
              variant="outline"
              onClick={handleExtract}
              disabled={extracting || !documents?.some((d: InvoiceDocument) => d.documentKind === "invoice_file")}
            >
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {extracting ? "Extracting…" : "Run AI Extraction"}
            </Button>
            {!documents?.some((d: InvoiceDocument) => d.documentKind === "invoice_file") && (
              <p className="text-xs text-muted-foreground mt-2 text-center">Upload an invoice file first</p>
            )}
          </div>
        </div>
      </div>

      <AddDocumentModal invoiceId={id} open={addDocOpen} onClose={() => setAddDocOpen(false)} />
    </div>
  );
}
