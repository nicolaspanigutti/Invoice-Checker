import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useGenerateInvoiceReport, useGetInvoice, type InvoiceReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, TriangleAlert, ChevronRight, FileText } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  extracting_data: "Extracting Data",
  in_review: "In Review",
  waiting_internal_lawyer: "With Internal Lawyer",
  pending_law_firm: "Pending Law Firm",
  ready_to_pay: "Ready to Pay",
};

const OUTCOME_LABELS: Record<string, string> = {
  clean: "Clean — No Issues",
  accepted_with_comments: "Accepted with Comments",
  partially_rejected: "Partially Rejected",
  fully_rejected: "Fully Rejected",
};

const OUTCOME_COLOURS: Record<string, string> = {
  clean: "text-green-700 bg-green-50 border-green-200",
  accepted_with_comments: "text-blue-700 bg-blue-50 border-blue-200",
  partially_rejected: "text-amber-700 bg-amber-50 border-amber-200",
  fully_rejected: "text-red-700 bg-red-50 border-red-200",
};

const RULE_TYPE_LABELS: Record<string, string> = {
  objective: "Objective",
  gray: "Grey Area",
  configurable: "Configurable",
  metadata: "Metadata",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  invoice_created: "Invoice created",
  analysis_started: "Analysis started",
  analysis_completed: "Analysis completed",
  analysis_failed: "Analysis failed",
  status_transition: "Status changed",
  issue_accept: "Issue accepted",
  issue_reject: "Issue rejected",
  issue_delegate: "Issue delegated to Internal Lawyer",
  issue_return: "Issue returned to Legal Ops",
  comment_posted: "Comment posted",
  document_added: "Document added",
};

function fmt(amount: string | null | undefined, currency: string) {
  if (!amount) return "—";
  return `${currency} ${parseFloat(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "error") return <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />;
  return <TriangleAlert className="h-4 w-4 text-amber-500 flex-shrink-0" />;
}

type ReportIssueItem = InvoiceReport["rejectedIssues"][0];

function IssueTable({ issues, title, colour }: { issues: ReportIssueItem[]; title: string; colour: string }) {
  if (issues.length === 0) return null;
  return (
    <section className="mb-8 print:break-inside-avoid">
      <h3 className={`text-sm font-semibold uppercase tracking-widest mb-3 ${colour}`}>{title} ({issues.length})</h3>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-6"></th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Issue</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Type</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Recovery</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {issues.map(issue => (
              <tr key={issue.id} className="hover:bg-muted/20">
                <td className="px-4 py-3">
                  <SeverityIcon severity={issue.severity} />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground leading-snug">{issue.explanationText}</p>
                  {issue.suggestedAction && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{issue.suggestedAction}</p>
                  )}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                    {RULE_TYPE_LABELS[issue.ruleType] ?? issue.ruleType}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {issue.recoverableAmount ? (
                    <span className="text-red-700 font-semibold">
                      {parseFloat(issue.recoverableAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {issue.decisionAction ? (
                    <div className="text-xs">
                      <span className="font-medium capitalize">{issue.decisionAction}</span>
                      {issue.decisionActorName && <span className="text-muted-foreground"> by {issue.decisionActorName}</span>}
                      {issue.decisionNote && <p className="text-muted-foreground italic mt-0.5">"{issue.decisionNote}"</p>}
                    </div>
                  ) : <span className="text-muted-foreground text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function InvoiceReportPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);
  const id = parseInt(params.id, 10);

  const [report, setReport] = useState<InvoiceReport | null>(null);
  const generateReport = useGenerateInvoiceReport();
  const { data: invoice } = useGetInvoice(id);

  const handleGenerate = async () => {
    try {
      const data = await generateReport.mutateAsync({ id });
      setReport(data);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to generate report. Please try again." });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!report) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <FileText className="h-10 w-10 text-primary" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground mb-2">
          Generate Review Report
        </h1>
        <p className="text-muted-foreground mb-2">
          {invoice ? `Invoice ${invoice.invoiceNumber}${invoice.lawFirmName ? ` · ${invoice.lawFirmName}` : ""}` : ""}
        </p>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
          This report includes an AI-generated executive summary, a breakdown of all review findings, and the full audit trail. It can be exported as PDF.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => navigate(`/invoices/${id}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Invoice
          </Button>
          <Button onClick={handleGenerate} disabled={generateReport.isPending}>
            {generateReport.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
            ) : (
              <><FileText className="h-4 w-4 mr-2" /> Generate Report</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; font-size: 11pt; }
          .print-full { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
          .shadow-sm { box-shadow: none !important; }
          section { page-break-inside: avoid; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          @page {
            margin: 1.5cm 2cm;
            size: A4 portrait;
          }
          h1, h2, h3 { page-break-after: avoid; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="no-print mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/invoices/${id}`)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm text-muted-foreground">Review Report</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generateReport.isPending}>
            {generateReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Regenerate"}
          </Button>
          <Button size="sm" onClick={handlePrint} className="gap-2">
            <Download className="h-4 w-4" /> Export PDF
          </Button>
        </div>
      </div>

      <div ref={reportRef} className="max-w-5xl mx-auto print-full">
        <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-primary px-8 py-6 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-primary-foreground/70 text-sm font-medium uppercase tracking-widest mb-1">Invoice Review Report</p>
                <h1 className="text-2xl font-display font-bold">{report.invoiceNumber}</h1>
                {report.lawFirmName && <p className="text-primary-foreground/80 mt-1">{report.lawFirmName}</p>}
              </div>
              <div className="text-right text-sm text-primary-foreground/70">
                <p>Generated {fmtDateTime(report.generatedAt)}</p>
                {report.invoiceDate && <p>Invoice date: {fmtDate(report.invoiceDate)}</p>}
              </div>
            </div>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 pb-8 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Matter</p>
                <p className="font-medium text-sm">{report.matterName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Jurisdiction</p>
                <p className="font-medium text-sm">{report.jurisdiction ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Invoiced</p>
                <p className="font-semibold text-sm">{fmt(report.totalAmount, report.currency)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                <p className="font-medium text-sm">{STATUS_LABELS[report.invoiceStatus] ?? report.invoiceStatus}</p>
              </div>
            </div>

            <section className="mb-8">
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-primary" /> Review Outcome
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`border rounded-xl px-4 py-3 ${report.reviewOutcome ? OUTCOME_COLOURS[report.reviewOutcome] ?? "text-gray-700 bg-gray-50 border-gray-200" : "text-gray-700 bg-gray-50 border-gray-200"}`}>
                  <p className="text-xs font-medium uppercase tracking-wider mb-1">Outcome</p>
                  <p className="font-semibold">{report.reviewOutcome ? (OUTCOME_LABELS[report.reviewOutcome] ?? report.reviewOutcome) : "In Progress"}</p>
                </div>
                <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-amber-700 uppercase tracking-wider mb-1">Amount at Risk</p>
                  <p className="font-semibold text-amber-800">{fmt(report.amountAtRisk, report.currency)}</p>
                </div>
                <div className="border border-red-200 bg-red-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-red-700 uppercase tracking-wider mb-1">Confirmed Recovery</p>
                  <p className="font-semibold text-red-800">{fmt(report.confirmedRecovery, report.currency)}</p>
                </div>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-primary" /> Executive Findings Summary
              </h2>
              <div className="bg-muted/30 border border-border rounded-xl px-5 py-4">
                <p className="text-sm leading-relaxed text-foreground">{report.executiveSummary}</p>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-primary" /> Issue Breakdown
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {[
                  { label: "Rejected", count: report.rejectedIssues.length, colour: "text-red-700 bg-red-50 border-red-200", icon: <XCircle className="h-5 w-5 text-red-600" /> },
                  { label: "Accepted", count: report.acceptedIssues.length, colour: "text-green-700 bg-green-50 border-green-200", icon: <CheckCircle2 className="h-5 w-5 text-green-600" /> },
                  { label: "Escalated", count: report.escalatedIssues.length, colour: "text-purple-700 bg-purple-50 border-purple-200", icon: <TriangleAlert className="h-5 w-5 text-purple-600" /> },
                  { label: "Open", count: report.openIssues.length, colour: "text-gray-700 bg-gray-50 border-gray-200", icon: <Clock className="h-5 w-5 text-gray-500" /> },
                ].map(({ label, count, colour, icon }) => (
                  <div key={label} className={`border rounded-xl px-4 py-3 flex items-center gap-3 ${colour}`}>
                    {icon}
                    <div>
                      <p className="text-2xl font-bold leading-none">{count}</p>
                      <p className="text-xs font-medium mt-0.5">{label}</p>
                    </div>
                  </div>
                ))}
              </div>

              <IssueTable issues={report.rejectedIssues} title="Rejected Issues" colour="text-red-700" />
              <IssueTable issues={report.acceptedIssues} title="Accepted Issues" colour="text-green-700" />
              <IssueTable issues={report.escalatedIssues} title="Escalated to Internal Lawyer" colour="text-purple-700" />
              <IssueTable issues={report.openIssues} title="Open Issues" colour="text-gray-600" />
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-primary" /> Audit Trail
              </h2>
              <div className="space-y-0 border border-border rounded-xl overflow-hidden">
                {report.auditTrail.map((event, i) => (
                  <div key={i} className={`flex items-start gap-3 px-4 py-3 text-sm ${i % 2 === 0 ? "bg-white" : "bg-muted/20"}`}>
                    <div className="w-36 flex-shrink-0 text-xs text-muted-foreground font-mono pt-0.5">
                      {fmtDateTime(event.createdAt)}
                    </div>
                    <div className="flex-1">
                      <span className="font-medium text-foreground">
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType.replace(/_/g, " ")}
                      </span>
                      {event.actorName && (
                        <span className="text-muted-foreground ml-1">by {event.actorName}</span>
                      )}
                    </div>
                  </div>
                ))}
                {report.auditTrail.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">No audit events recorded</div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
