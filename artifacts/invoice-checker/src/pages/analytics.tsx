import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend,
} from "recharts";
import {
  TrendingUp, FileText, AlertTriangle,
  ShieldAlert, BarChart2, Building2, Loader2, Handshake, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AnalyticsSummary {
  totalInvoices: number;
  acceptedInvoices: number;
  disputedInvoices: number;
  inProgressInvoices: number;
  totalAmountReviewed: number;
  totalConfirmedRecovery: number;
  totalAmountAtRisk: number;
  recoveryRate: number;
  totalIssues: number;
  confirmedIssues: number;
  falsePositives: number;
  escalatedIssues: number;
  confirmRate: number;
  escalationRate: number;
}
interface MonthBucket {
  month: string;
  invoiceCount: number;
  amountReviewed: number;
  confirmedRecovery: number;
  amountAtRisk: number;
}
interface IssueByRule {
  ruleCode: string;
  severity: string;
  evaluatorType: string;
  issueCount: number;
  totalRecoverable: number;
  confirmedCount: number;
  falsePositiveCount: number;
}
interface IssueByStatus { status: string; count: number }
interface ByFirm {
  firmId: number;
  firmName: string;
  firmType: string;
  invoiceCount: number;
  totalAmount: number;
  confirmedRecovery: number;
  amountAtRisk: number;
  issueCount: number;
  confirmedIssues: number;
}
interface ByBillingType {
  billingType: string;
  count: number;
  totalAmount: number;
  confirmedRecovery: number;
}
interface RoiSummary {
  totalDetectedValue: number;
  totalRejectedValue: number;
  rejectedCount: number;
  totalAcknowledgedValue: number;
  acknowledgedCount: number;
  acknowledgementRate: number;
}
interface RejectedVsAcknowledgedBucket {
  month: string;
  rejectedValue: number;
  acknowledgedValue: number;
  rejectedCount: number;
  acknowledgedCount: number;
}
interface AnalyticsData {
  summary: AnalyticsSummary;
  roiSummary: RoiSummary;
  recoveryByMonth: MonthBucket[];
  rejectedVsAcknowledgedByMonth: RejectedVsAcknowledgedBucket[];
  issuesByRule: IssueByRule[];
  issuesByStatus: IssueByStatus[];
  byFirm: ByFirm[];
  byJurisdiction: ByJurisdiction[];
  byBillingType: ByBillingType[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const BRAND = "#EC0000";
const PALETTE = ["#EC0000", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#f97316", "#06b6d4", "#84cc16"];

function fmtCurrency(n: number, compact = false): string {
  if (compact && n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (compact && n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }
function shortMonth(m: string): string {
  const [year, month] = m.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, icon: Icon, accent, trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("p-2 rounded-xl", accent ?? "bg-muted")}>
          <Icon className={cn("w-4 h-4", accent ? "text-white" : "text-muted-foreground")} />
        </span>
      </div>
      <div>
        <p className="text-2xl font-display font-bold text-foreground">{value}</p>
        {sub && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            {trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-500" />}
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-display font-bold text-foreground">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      {title && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

const CustomTooltipStyle =
  "bg-card border border-border rounded-xl shadow-lg p-3 text-xs text-foreground";

function CurrencyTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  return (
    <div className={CustomTooltipStyle}>
      <p className="font-semibold mb-1">{String(label)}</p>
      {payload.map((p: Record<string, unknown>, i: number) => (
        <p key={i} style={{ color: String(p.color) }}>
          {String(p.name)}: {fmtCurrency(Number(p.value))}
        </p>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Analytics() {

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ["analytics"],
    queryFn: async () => {
      const res = await fetch("/api/analytics", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json() as Promise<AnalyticsData>;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading analytics…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <AlertTriangle className="w-5 h-5 text-destructive" />
        <span className="text-sm">Failed to load analytics data.</span>
      </div>
    );
  }

  const { summary, roiSummary, rejectedVsAcknowledgedByMonth, issuesByRule, byFirm: byFirmRaw } = data;

  // Sort by confirmed recovery (absolute amount disputed) descending — most impactful firms first
  const byFirm = [...byFirmRaw].sort((a, b) => b.confirmedRecovery - a.confirmedRecovery);

  const maxDisputeRate = byFirm.length > 0
    ? Math.max(...byFirm.map(f => f.totalAmount > 0 ? (f.confirmedRecovery / f.totalAmount) * 100 : 0))
    : 1;

  // Top 10 rules by issue count
  const topRules = issuesByRule.slice(0, 10);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* ── 1. Savings funnel — the main story ───────────────────── */}
      <div>
        <div className="mb-5">
          <h1 className="text-2xl font-display font-bold text-foreground">Analytics</h1>
          <p className="text-xs text-muted-foreground mt-1">Financial impact of invoice review across all law firms.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Amount Reviewed"
            value={fmtCurrency(summary.totalAmountReviewed, true)}
            sub={`${summary.totalInvoices} invoices · ${summary.inProgressInvoices} currently in review`}
            icon={FileText}
            accent="bg-slate-700"
          />
          <KpiCard
            label="Potential Savings"
            value={fmtCurrency(roiSummary.totalDetectedValue, true)}
            sub="Recoverable amount flagged by the system"
            icon={AlertTriangle}
            accent="bg-amber-500"
          />
          <KpiCard
            label="Amount Disputed"
            value={fmtCurrency(roiSummary.totalRejectedValue, true)}
            sub={`Formally challenged with the firm · ${roiSummary.rejectedCount} issue${roiSummary.rejectedCount !== 1 ? "s" : ""}`}
            icon={TrendingUp}
            accent="bg-red-600"
          />
          <KpiCard
            label="Amount Recovered"
            value={fmtCurrency(roiSummary.totalAcknowledgedValue, true)}
            sub={`Accepted by the firm · ${fmtPct(roiSummary.acknowledgementRate)} of what was disputed`}
            icon={Handshake}
            accent="bg-teal-600"
            trend="up"
          />
        </div>
      </div>

      {/* ── 2. Supporting context ─────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Amount Still at Risk"
          value={fmtCurrency(summary.totalAmountAtRisk, true)}
          sub="Recoverable amount in issues not yet resolved"
          icon={ShieldAlert}
          accent="bg-amber-500"
        />
        <KpiCard
          label="Invoices in Dispute"
          value={String(summary.disputedInvoices)}
          sub={`${summary.acceptedInvoices} cleared · ${summary.inProgressInvoices} under review`}
          icon={FileText}
          accent="bg-slate-700"
        />
        <KpiCard
          label="Total Issues Detected"
          value={String(summary.totalIssues)}
          sub={`${summary.confirmedIssues} confirmed errors · ${summary.falsePositives} false positives`}
          icon={AlertTriangle}
          accent="bg-slate-700"
        />
        <KpiCard
          label="False Positive Rate"
          value={fmtPct(summary.totalIssues > 0 ? (summary.falsePositives / summary.totalIssues) * 100 : 0)}
          sub="Issues flagged by the system that reviewers dismissed"
          icon={ShieldAlert}
          accent="bg-amber-500"
        />
      </div>

      {/* ── 3. Recovery trend ─────────────────────────────────────── */}
      {rejectedVsAcknowledgedByMonth.length > 0 && (
        <div>
          <SectionHeader
            title="Disputes & Recoveries Over Time"
            subtitle="What we challenged each month vs what the firm accepted — shows how effectively disputes convert into savings"
          />
          <ChartCard>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={rejectedVsAcknowledgedByMonth} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => fmtCurrency(v, true)} tick={{ fontSize: 11 }} width={56} />
                <Tooltip content={<CurrencyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="rejectedValue" name="Disputed with firm" fill={BRAND} radius={[4, 4, 0, 0]} />
                <Bar dataKey="acknowledgedValue" name="Accepted by firm" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* ── 4. Which firms are the problem ───────────────────────── */}
      {byFirm.length > 0 && (
        <div>
          <SectionHeader
            title="Ranking by Law Firm"
            subtitle="Ordered by amount disputed — firms where the most money has been formally challenged, regardless of invoice volume"
          />
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground w-10">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Firm</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Invoices</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">
                    <span className="flex items-center justify-end gap-1">
                      Total Billed
                      <span title="Total invoice amount submitted by this firm that has been reviewed in the system">
                        <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                      </span>
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Issues Found</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Errors Confirmed</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">
                    <span className="flex items-center justify-end gap-1">
                      Disputed with Firm
                      <span title="Amount formally challenged with the firm — sum of recoverable value in issues that reviewers marked as confirmed errors">
                        <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                      </span>
                    </span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground" style={{ minWidth: 140 }}>
                    <span className="flex items-center gap-1">
                      Dispute Rate
                      <span title="Disputed amount as a percentage of total fees billed — the higher this is, the more the firm overbills relative to what they charge">
                        <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                      </span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {byFirm.map((f, i) => {
                  const recoveryPct = f.totalAmount > 0 ? (f.confirmedRecovery / f.totalAmount) * 100 : 0;
                  const barWidth = maxDisputeRate > 0 ? (recoveryPct / maxDisputeRate) * 100 : 0;
                  const rankColors = ["bg-red-600", "bg-red-400", "bg-amber-500"];
                  const rankColor = rankColors[i] ?? "bg-muted-foreground/30";
                  return (
                    <tr key={f.firmId} className={cn("border-b border-border last:border-0 hover:bg-muted/30 transition-colors", i === 0 && "bg-red-50/30")}>
                      <td className="px-3 py-3 text-center">
                        <span className={cn(
                          "inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white",
                          rankColor
                        )}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-foreground">{f.firmName}</span>
                          {f.firmType === "panel" && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Panel</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{f.invoiceCount}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{fmtCurrency(f.totalAmount)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{f.issueCount}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn("font-semibold", f.confirmedIssues > 0 ? "text-red-600" : "text-muted-foreground")}>
                          {f.confirmedIssues}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-red-700">
                        {fmtCurrency(f.confirmedRecovery)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                recoveryPct > 5 ? "bg-red-500" : recoveryPct > 1 ? "bg-amber-400" : "bg-slate-300"
                              )}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className={cn(
                            "text-xs font-semibold w-10 text-right",
                            recoveryPct > 5 ? "text-red-700" : recoveryPct > 1 ? "text-amber-700" : "text-muted-foreground"
                          )}>
                            {fmtPct(recoveryPct)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 5. Most common error types ────────────────────────────── */}
      {topRules.length > 0 && (
        <div>
          <SectionHeader
            title="Most Common Billing Errors"
            subtitle="Types of errors detected most often — useful for negotiating better terms with firms or flagging systemic issues"
          />
          <ChartCard>
            <ResponsiveContainer width="100%" height={Math.max(240, topRules.length * 30)}>
              <BarChart data={topRules} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="ruleCode" tick={{ fontSize: 10 }} width={190} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !Array.isArray(payload) || !payload.length) return null;
                    const rule = topRules.find(r => r.ruleCode === label);
                    return (
                      <div className={CustomTooltipStyle}>
                        <p className="font-semibold mb-1">{String(label)}</p>
                        <p>Times detected: {rule?.issueCount ?? 0}</p>
                        <p className="text-red-600">Confirmed errors: {rule?.confirmedCount ?? 0}</p>
                        <p className="text-slate-500">Recoverable value: {fmtCurrency(rule?.totalRecoverable ?? 0)}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="issueCount" name="Times detected" radius={[0, 4, 4, 0]}>
                  {topRules.map((r, i) => (
                    <Cell key={i} fill={r.severity === "error" ? BRAND : "#f59e0b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-3 justify-center text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#EC0000] inline-block" /> Critical error</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Warning</span>
            </div>
          </ChartCard>
        </div>
      )}


      {/* Empty state */}
      {summary.totalInvoices === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <BarChart2 className="w-10 h-10" />
          <p className="font-medium">No data yet</p>
          <p className="text-sm">Analytics will populate as invoices are reviewed and analysis runs are completed.</p>
        </div>
      )}
    </div>
  );
}
