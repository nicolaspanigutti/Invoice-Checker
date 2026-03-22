import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPanelBaselineDocuments,
  useListPanelRates,
  useCreatePanelBaselineDocument,
  useUpdatePanelBaselineDocumentStatus,
  getListPanelBaselineDocumentsQueryKey,
  getListPanelRatesQueryKey,
  type PanelBaselineDocument,
  type PanelRate,
  type CreatePanelRateItem,
  type CreatePanelBaselineDocumentMutationError,
  type UpdatePanelBaselineDocumentStatusMutationError,
} from "@workspace/api-client-react";
import {
  DollarSign, Plus, Search, X, FileText, Trash2,
  ShieldCheck, Archive, CheckCircle2, Clock, AlertCircle,
} from "lucide-react";
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

const emptyRateRow = (): Omit<CreatePanelRateItem, "validFrom" | "validTo"> & { validFrom: string; validTo: string } => ({
  lawFirmName: "", jurisdiction: "", roleCode: "", roleLabel: "", currency: "EUR", maxRate: "", validFrom: "", validTo: ""
});

function AddRatesDocumentModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreatePanelBaselineDocument();
  const [versionLabel, setVersionLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([emptyRateRow()]);

  const inputClass = "w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-xs";

  const updateRow = (idx: number, field: string, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  const addRow = () => setRows(prev => [...prev, emptyRateRow()]);
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionLabel) { toast({ variant: "destructive", title: "Version label is required." }); return; }
    const validRows = rows.filter(r => r.lawFirmName && r.jurisdiction && r.roleCode && r.currency && r.maxRate);
    createMutation.mutate({ data: {
      documentKind: "rates",
      versionLabel,
      fileName: fileName || null,
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
        toast({ title: "Rates document created", description: `${versionLabel} with ${validRows.length} rate rows saved as Draft.` });
        onClose();
      },
      onError: (err: CreatePanelBaselineDocumentMutationError) => toast({ variant: "destructive", title: "Error", description: (err.data as { error?: string } | null)?.error || "Failed to create document." })
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-display font-bold text-foreground">Add Panel Rates Document</h2>
          <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 border-b border-border grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Version Label *</label>
              <input value={versionLabel} onChange={e => setVersionLabel(e.target.value)} placeholder="e.g. Panel Rates 2025 v1.0" className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-sm" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Source File Name</label>
              <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="e.g. Panel_Rates_2025_v1.pdf" className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-sm" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Rate Rows</h3>
              <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Row
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Law Firm Name", "Jurisdiction", "Role Code", "Role Label", "Currency", "Max Rate (hourly)", "Valid From", "Valid To", ""].map(h => (
                      <th key={h} className="text-left py-2 px-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-1"><input value={row.lawFirmName} onChange={e => updateRow(i, "lawFirmName", e.target.value)} placeholder="Firm name" className={inputClass} /></td>
                      <td className="py-1.5 px-1"><input value={row.jurisdiction} onChange={e => updateRow(i, "jurisdiction", e.target.value)} placeholder="England & Wales" className={inputClass} /></td>
                      <td className="py-1.5 px-1"><input value={row.roleCode} onChange={e => updateRow(i, "roleCode", e.target.value)} placeholder="Partner" className={inputClass} /></td>
                      <td className="py-1.5 px-1"><input value={row.roleLabel} onChange={e => updateRow(i, "roleLabel", e.target.value)} placeholder="Partner" className={inputClass} /></td>
                      <td className="py-1.5 px-1">
                        <select value={row.currency} onChange={e => updateRow(i, "currency", e.target.value)} className={inputClass}>
                          {["EUR", "GBP", "USD", "CHF", "SEK", "NOK", "DKK"].map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 px-1"><input value={row.maxRate} onChange={e => updateRow(i, "maxRate", e.target.value)} placeholder="850.00" className={inputClass} type="number" step="0.01" min="0" /></td>
                      <td className="py-1.5 px-1"><input value={row.validFrom} onChange={e => updateRow(i, "validFrom", e.target.value)} className={inputClass} type="date" /></td>
                      <td className="py-1.5 px-1"><input value={row.validTo} onChange={e => updateRow(i, "validTo", e.target.value)} className={inputClass} type="date" /></td>
                      <td className="py-1.5 px-1">
                        <button type="button" onClick={() => removeRow(i)} className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-6 border-t border-border flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium">Cancel</button>
            <button type="submit" disabled={createMutation.isPending} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-70 flex items-center gap-2">
              {createMutation.isPending ? "Saving..." : <><Plus className="w-4 h-4" />Save Document</>}
            </button>
          </div>
        </form>
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
  const [firmFilter, setFirmFilter] = useState("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");

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
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={firmFilter} onChange={e => setFirmFilter(e.target.value)} placeholder="Filter by firm name..." className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm" />
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={jurisdictionFilter} onChange={e => setJurisdictionFilter(e.target.value)} placeholder="Filter by jurisdiction..." className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm" />
        </div>
      </div>

      <RatesTable documentId={activeDoc?.id} firmFilter={firmFilter} jurisdictionFilter={jurisdictionFilter} />

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
