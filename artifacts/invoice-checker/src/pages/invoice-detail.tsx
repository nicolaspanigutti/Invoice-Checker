import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetInvoice,
  useListInvoiceDocuments,
  useListInvoiceItems,
  useUpdateInvoice,
  useAddInvoiceDocument,
  useExtractInvoiceData,
  useRequestUploadUrl,
  type InvoiceItem,
  type InvoiceDocument,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { getGetInvoiceQueryKey, getListInvoiceDocumentsQueryKey } from "@workspace/api-client-react";
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
  Building2,
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

  const { data: invoice, isLoading } = useGetInvoice(id);
  const { data: documents } = useListInvoiceDocuments(id);
  const { data: items } = useListInvoiceItems(id);
  const extractData = useExtractInvoiceData();

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

  const displayItems = items ?? [];

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

          <div className="border border-border rounded-3xl bg-card shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-display font-semibold">Line Items</h2>
              <span className="text-sm text-muted-foreground">{items?.length ?? 0} lines</span>
            </div>
            {!items || items.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No line items extracted yet. Run AI extraction to populate.</p>
              </div>
            ) : (
              <>
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
                        <TableRow key={item.id} className={item.isExpenseLine ? "bg-amber-50/40" : ""}>
                          <TableCell className="text-muted-foreground text-xs">{item.lineNo}</TableCell>
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
                </div>
              </>
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
            {canRunAnalysis ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Ready for analysis</span>
                </div>
                <Button className="w-full gap-2" disabled>
                  <Sparkles className="h-4 w-4" />
                  Run Checking Analysis
                  <span className="text-xs opacity-70">(Sprint 3)</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <span className="text-sm font-medium">Not ready for analysis</span>
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
                <Button className="w-full gap-2" disabled>
                  <Sparkles className="h-4 w-4" />
                  Run Checking Analysis
                </Button>
              </div>
            )}
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
