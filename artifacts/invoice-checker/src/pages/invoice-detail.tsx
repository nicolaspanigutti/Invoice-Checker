import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { EmailDraftModal } from "@/components/EmailDraftModal";
import {
  useGetInvoice,
  useListInvoiceDocuments,
  useListInvoiceItems,
  useAddInvoiceDocument,
  useExtractInvoiceData,
  useRequestUploadUrl,
  useRunInvoiceAnalysis,
  useListInvoiceIssues,
  useGetMe,
  useDecideIssue,
  useListInvoiceComments,
  usePostInvoiceComment,
  useListInvoiceAuditEvents,
  getListInvoiceCommentsQueryKey,
  getListInvoiceAuditEventsQueryKey,
  type InvoiceItem,
  type InvoiceDocument,
  type InvoiceIssue,
  type AnalysisRunResult,
  type CommentResponse,
  type AuditEventResponse,
  type ListInvoiceCommentsParams,
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
  ThumbsUp,
  ThumbsDown,
  ArrowRightCircle,
  Undo2,
  MessageSquare,
  Send,
  Activity,
  UserCircle,
  Mail,
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

const DECISION_ACTION_LABELS: Record<string, string> = {
  accept: "Accepted",
  reject: "Rejected",
  delegate: "Delegated to Lawyer",
  return: "Returned to Legal Ops",
};

const DECISION_ACTION_COLOURS: Record<string, string> = {
  accept: "bg-green-100 text-green-800",
  reject: "bg-red-100 text-red-800",
  delegate: "bg-purple-100 text-purple-800",
  return: "bg-orange-100 text-orange-800",
};

function IssueDecisionBadge({ action, actorName, note }: { action: string; actorName?: string | null; note?: string | null }) {
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs font-medium ${DECISION_ACTION_COLOURS[action] ?? "bg-gray-100 text-gray-700"}`}>
      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold">{DECISION_ACTION_LABELS[action] ?? action}</span>
        {actorName && <span className="font-normal opacity-70"> by {actorName}</span>}
        {note && <p className="mt-0.5 font-normal opacity-80 italic">"{note}"</p>}
      </div>
    </div>
  );
}

function IssueCard({ issue, invoiceId, userRole, onDecided }: {
  issue: InvoiceIssue;
  invoiceId: number;
  userRole: string | null;
  onDecided: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showComments, setShowComments] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const decideIssue = useDecideIssue();
  const { data: inlineComments } = useListInvoiceComments(invoiceId, { issueId: issue.id, scope: "issue_inline" } as ListInvoiceCommentsParams);
  const postComment = usePostInvoiceComment();
  const [commentText, setCommentText] = useState("");

  const evidence = issue.evidenceJson as Record<string, unknown> | null;
  const recoverable = issue.recoverableAmount ? parseFloat(issue.recoverableAmount) : null;

  const latestDecision = issue.latestDecision ?? null;
  const hasDecision = latestDecision !== null;


  const handleDecide = async (action: string) => {
    if (action === "return" && !note.trim()) {
      setShowNoteInput(action);
      return;
    }
    if (showNoteInput === action && !note.trim()) {
      toast({ variant: "destructive", title: "Note required", description: "Please add a note before returning." });
      return;
    }
    try {
      await decideIssue.mutateAsync({ id: invoiceId, issueId: issue.id, data: { action: action as import("@workspace/api-client-react").DecideIssueRequestAction, note: note || undefined } });
      toast({ title: "Decision recorded", description: `Issue ${DECISION_ACTION_LABELS[action] ?? action}.` });
      setShowNoteInput(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: getListInvoiceIssuesQueryKey(invoiceId) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
      queryClient.invalidateQueries({ queryKey: getListInvoiceAuditEventsQueryKey(invoiceId) });
      onDecided();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to record decision." });
    }
  };

  const handlePostComment = async () => {
    if (!commentText.trim()) return;
    try {
      await postComment.mutateAsync({ id: invoiceId, data: { content: commentText.trim(), commentScope: "issue_inline", issueId: issue.id } });
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: getListInvoiceCommentsQueryKey(invoiceId) });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to post comment." });
    }
  };

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
            {hasDecision && (
              <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${DECISION_ACTION_COLOURS[latestDecision!.action] ?? "bg-gray-100"}`}>
                <CheckCircle2 className="h-3 w-3" />
                {DECISION_ACTION_LABELS[latestDecision!.action] ?? latestDecision!.action}
              </span>
            )}
            {!hasDecision && recoverable !== null && recoverable > 0 && (
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

          {hasDecision && (
            <IssueDecisionBadge action={latestDecision!.action} actorName={latestDecision!.actorName} note={latestDecision!.note} />
          )}

          {(() => {
            const currentIssueStatus = issue.issueStatus;
            const isOpen = currentIssueStatus === "open";
            const isEscalated = currentIssueStatus === "escalated_to_internal_lawyer";

            const actionsForLegalOps = isOpen && (userRole === "legal_ops" || userRole === "super_admin")
              ? (userRole === "legal_ops" ? ["accept", "reject", "delegate"] : ["accept", "reject", "delegate", "return"])
              : [];
            const actionsForLawyer = isEscalated && (userRole === "internal_lawyer" || userRole === "super_admin")
              ? ["accept", "reject", "return"]
              : [];
            const availableActions = [...new Set([...actionsForLegalOps, ...actionsForLawyer])];

            if (availableActions.length === 0) return null;

            const sectionLabel = isEscalated && userRole === "internal_lawyer"
              ? "Internal Lawyer Decision"
              : hasDecision && latestDecision?.action === "return"
              ? "Re-evaluate Issue"
              : "Your Decision";

            return (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{sectionLabel}</p>
                <div className="flex flex-wrap gap-2">
                  {availableActions.includes("accept") && (
                    <Button size="sm" variant="outline" className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                      onClick={() => handleDecide("accept")} disabled={decideIssue.isPending}>
                      <ThumbsUp className="h-3.5 w-3.5" /> Accept
                    </Button>
                  )}
                  {availableActions.includes("reject") && (
                    <Button size="sm" variant="outline" className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                      onClick={() => handleDecide("reject")} disabled={decideIssue.isPending}>
                      <ThumbsDown className="h-3.5 w-3.5" /> Reject
                    </Button>
                  )}
                  {availableActions.includes("delegate") && (
                    <Button size="sm" variant="outline" className="gap-1.5 border-purple-300 text-purple-700 hover:bg-purple-50"
                      onClick={() => handleDecide("delegate")} disabled={decideIssue.isPending}>
                      <ArrowRightCircle className="h-3.5 w-3.5" /> Delegate
                    </Button>
                  )}
                  {availableActions.includes("return") && (
                    <Button size="sm" variant="outline" className="gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
                      onClick={() => { setShowNoteInput("return"); }} disabled={decideIssue.isPending}>
                      <Undo2 className="h-3.5 w-3.5" /> {isEscalated ? "Return to Legal Ops" : "Return"}
                    </Button>
                  )}
                </div>
                {showNoteInput && (
                  <div className="space-y-2">
                    <textarea
                      className="w-full text-sm border border-border rounded-xl p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[72px]"
                      placeholder={showNoteInput === "return" ? "Reason for returning (required)…" : "Add a note (optional)…"}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleDecide(showNoteInput)} disabled={decideIssue.isPending || (showNoteInput === "return" && !note.trim())}>
                        {decideIssue.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowNoteInput(null); setNote(""); }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div>
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowComments(v => !v)}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {showComments ? "Hide comments" : `Comments ${inlineComments && inlineComments.length > 0 ? `(${inlineComments.length})` : ""}`}
            </button>
            {showComments && (
              <div className="mt-2 space-y-2">
                {inlineComments && inlineComments.length > 0 ? (
                  <div className="space-y-1.5">
                    {inlineComments.map((c: CommentResponse) => (
                      <div key={c.id} className="flex items-start gap-2 bg-card border border-border rounded-xl px-3 py-2">
                        <UserCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{c.authorName ?? "Unknown"}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "d MMM yyyy HH:mm")}</span>
                          </div>
                          <p className="text-xs text-foreground mt-0.5">{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No comments yet.</p>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Add a comment…"
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                  />
                  <Button size="sm" variant="outline" className="px-2.5" onClick={handlePostComment} disabled={postComment.isPending || !commentText.trim()}>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IssuesPanel({ invoiceId, currency, userRole }: { invoiceId: number; currency: string | null; userRole: string | null }) {
  const queryClient = useQueryClient();
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
          <IssueCard
            key={issue.id}
            issue={issue}
            invoiceId={invoiceId}
            userRole={userRole}
            onDecided={() => {
              queryClient.invalidateQueries({ queryKey: getListInvoiceIssuesQueryKey(invoiceId) });
              queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
            }}
          />
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
  const [generalComment, setGeneralComment] = useState("");
  const [emailDraftOpen, setEmailDraftOpen] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const { data: invoice, isLoading } = useGetInvoice(id);
  const { data: documents } = useListInvoiceDocuments(id);
  const { data: items } = useListInvoiceItems(id);
  const { data: issues } = useListInvoiceIssues(id);
  const { data: me } = useGetMe();
  const { data: generalComments } = useListInvoiceComments(id, { scope: "general" } as ListInvoiceCommentsParams);
  const { data: auditEvents } = useListInvoiceAuditEvents(id);
  const postComment = usePostInvoiceComment();
  const extractData = useExtractInvoiceData();
  const runAnalysis = useRunInvoiceAnalysis();
  const [showAllLines, setShowAllLines] = useState(false);

  const userRole = me?.role ?? null;

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

  const reportableStatuses = ["in_review", "waiting_internal_lawyer", "pending_law_firm", "ready_to_pay"];
  const canViewReport = reportableStatuses.includes(invoice.invoiceStatus);
  const canDraftEmail = invoice.invoiceStatus === "pending_law_firm";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <EmailDraftModal invoiceId={id} open={emailDraftOpen} onClose={() => setEmailDraftOpen(false)} />
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/invoices")} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="font-mono text-sm text-muted-foreground">{invoice.invoiceNumber}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[invoice.invoiceStatus] ?? "bg-gray-100 text-gray-700"}`}>
          {STATUS_LABELS[invoice.invoiceStatus] ?? invoice.invoiceStatus}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {invoice.amountAtRisk && parseFloat(invoice.amountAtRisk) > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {invoice.currency} {parseFloat(invoice.amountAtRisk).toLocaleString("en-GB", { minimumFractionDigits: 2 })} at risk
            </span>
          )}
          {canDraftEmail && (
            <Button size="sm" variant="outline" onClick={() => setEmailDraftOpen(true)} className="gap-2">
              <Mail className="h-4 w-4" /> Draft Email
            </Button>
          )}
          {canViewReport && (
            <Button size="sm" onClick={() => navigate(`/invoices/${id}/report`)} className="gap-2">
              <FileText className="h-4 w-4" /> Generate Report
            </Button>
          )}
        </div>
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
                <IssuesPanel invoiceId={id} currency={invoice.currency} userRole={userRole} />
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
            {showIssuesPanel && hasIssues && flaggedItemIds.size === 0 && allItems.length > 0 && !showAllLines && (
              <div className="px-4 py-3 bg-amber-50/60 border-b border-amber-200 text-xs text-amber-800 text-center">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Issues found are invoice-level (not linked to specific lines). Showing all lines for reference.
              </div>
            )}
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
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-display font-semibold">General Comments</h2>
              {generalComments && generalComments.length > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">{generalComments.length} comment{generalComments.length !== 1 ? "s" : ""}</span>
              )}
            </div>
            <div className="space-y-3">
              {(!generalComments || generalComments.length === 0) ? (
                <div className="text-center py-6">
                  <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No comments yet. Be the first to add one.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {generalComments.map((c: CommentResponse) => (
                    <div key={c.id} className="flex items-start gap-3 bg-muted/40 rounded-2xl px-4 py-3">
                      <UserCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold">{c.authorName ?? "Unknown"}</span>
                          <span className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "d MMM yyyy, HH:mm")}</span>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">{c.content}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={commentsEndRef} />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <textarea
                  className="flex-1 text-sm border border-border rounded-xl p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[72px]"
                  placeholder="Add a general comment about this invoice…"
                  value={generalComment}
                  onChange={e => setGeneralComment(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === "Enter" && e.ctrlKey) {
                      e.preventDefault();
                      if (!generalComment.trim()) return;
                      try {
                        await postComment.mutateAsync({ id, data: { content: generalComment.trim(), commentScope: "general" } });
                        setGeneralComment("");
                        queryClient.invalidateQueries({ queryKey: getListInvoiceCommentsQueryKey(id) });
                      } catch {
                        toast({ variant: "destructive", title: "Error", description: "Failed to post comment." });
                      }
                    }
                  }}
                />
                <Button
                  className="self-end gap-2"
                  onClick={async () => {
                    if (!generalComment.trim()) return;
                    try {
                      await postComment.mutateAsync({ id, data: { content: generalComment.trim(), commentScope: "general" } });
                      setGeneralComment("");
                      queryClient.invalidateQueries({ queryKey: getListInvoiceCommentsQueryKey(id) });
                    } catch {
                      toast({ variant: "destructive", title: "Error", description: "Failed to post comment." });
                    }
                  }}
                  disabled={postComment.isPending || !generalComment.trim()}
                >
                  {postComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Post
                </Button>
              </div>
            </div>
          </div>

          <div className="border border-border rounded-3xl bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-display font-semibold">Audit Trail</h2>
            </div>
            {(!auditEvents || auditEvents.length === 0) ? (
              <div className="text-center py-6">
                <Activity className="mx-auto h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No audit events yet.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-4">
                  {(auditEvents as AuditEventResponse[]).map((evt) => (
                    <div key={evt.id} className="relative flex items-start gap-4 pl-12">
                      <div className="absolute left-3.5 top-1 h-3 w-3 rounded-full bg-primary border-2 border-background shadow" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold capitalize">{String(evt.eventType).replace(/_/g, " ")}</span>
                          {evt.actorName && <span className="text-xs text-muted-foreground">by {evt.actorName}</span>}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {format(new Date(evt.createdAt), "d MMM yyyy, HH:mm")}
                          </span>
                        </div>
                        {evt.afterJson != null && typeof evt.afterJson === "object" && !Array.isArray(evt.afterJson) && Object.keys(evt.afterJson as Record<string, unknown>).length > 0 && (() => {
                          const entries = Object.entries(evt.afterJson as Record<string, unknown>);
                          return (
                            <div className="mt-1.5 rounded-xl bg-muted/50 border border-border px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto">
                              {entries.map(([k, v]) => (
                                <div key={k}><span className="text-foreground font-medium">{k}:</span> {String(v)}</div>
                              ))}
                            </div>
                          );
                        })()}
                        {evt.reason && (
                          <p className="mt-1 text-xs text-muted-foreground italic">Note: {evt.reason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
