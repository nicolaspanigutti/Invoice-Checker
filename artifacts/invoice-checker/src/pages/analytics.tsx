import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend, Area, AreaChart,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, FileText, AlertTriangle,
  CheckCircle2, ShieldAlert, BarChart2, Building2, Globe, Loader2, Handshake,
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
interface ByJurisdiction {
  jurisdiction: string;
  invoiceCount: number;
  totalAmount: number;
  confirmedRecovery: number;
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

const BILLING_TYPE_LABELS: Record<string, string> = {
  time_and_materials: "Time & Materials",
  fixed_scope: "Fixed Scope",
  closed_scope: "Closed Scope",
  unknown: "Unknown",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  accepted_by_legal_ops: "False Positive (Legal Ops)",
  rejected_by_legal_ops: "Confirmed (Legal Ops)",
  escalated_to_internal_lawyer: "Escalated",
  accepted_by_internal_lawyer: "False Positive (Lawyer)",
  rejected_by_internal_lawyer: "Confirmed (Lawyer)",
  no_longer_applicable: "No Longer Applicable",
};

const STATUS_COLOURS: Record<string, string> = {
  open: "#94a3b8",
  accepted_by_legal_ops: "#f59e0b",
  rejected_by_legal_ops: "#EC0000",
  escalated_to_internal_lawyer: "#8b5cf6",
  accepted_by_internal_lawyer: "#f59e0b",
  rejected_by_internal_lawyer: "#EC0000",
  no_longer_applicable: "#cbd5e1",
};

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
            {trend === "down" && <TrendingDown className="w-3 h-3 text-red-500" />}
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

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
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
type FirmTab = "recovery" | "volume" | "issues";

export default function Analytics() {
  const [firmTab, setFirmTab] = useState<FirmTab>("recovery");

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

  const { summary, roiSummary, recoveryByMonth, rejectedVsAcknowledgedByMonth, issuesByRule, issuesByStatus, byFirm, byJurisdiction, byBillingType } = data;

  // Billing type pie
  const billingPieData = byBillingType.map(b => ({
    name: BILLING_TYPE_LABELS[b.billingType] ?? b.billingType,
    value: b.count,
  }));

  // Issue status pie (group minor statuses)
  const statusPieData = issuesByStatus.map(s => ({
    name: STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
    color: STATUS_COLOURS[s.status] ?? "#94a3b8",
  }));

  // Top 10 rules by issue count
  const topRules = issuesByRule.slice(0, 10);

  // Firm chart data depending on selected tab
  const firmChartData = byFirm.map(f => ({
    name: f.firmName.length > 18 ? f.firmName.slice(0, 16) + "…" : f.firmName,
    fullName: f.firmName,
    recovery: f.confirmedRecovery,
    amount: f.totalAmount,
    issues: f.issueCount,
    confirmed: f.confirmedIssues,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Invoice review performance, savings, and billing compliance trends.</p>
      </div>

      {/* ── KPI summary row ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Invoices Reviewed"
          value={String(summary.totalInvoices)}
          sub={`${summary.acceptedInvoices} accepted · ${summary.disputedInvoices} disputed`}
          icon={FileText}
          accent="bg-slate-700"
        />
        <KpiCard
          label="Total Amount Reviewed"
          value={`${fmtCurrency(summary.totalAmountReviewed, true)}`}
          sub={`${summary.inProgressInvoices} currently in review`}
          icon={DollarSign}
          accent="bg-slate-700"
        />
        <KpiCard
          label="Confirmed Recovery"
          value={fmtCurrency(summary.totalConfirmedRecovery, true)}
          sub={`${fmtPct(summary.recoveryRate)} of amount reviewed`}
          icon={TrendingUp}
          accent="bg-red-600"
          trend="up"
        />
        <KpiCard
          label="Amount at Risk"
          value={fmtCurrency(summary.totalAmountAtRisk, true)}
          sub="Across open issues"
          icon={ShieldAlert}
          accent="bg-amber-500"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Issues Detected"
          value={String(summary.totalIssues)}
          sub={`${summary.confirmedIssues} confirmed · ${summary.falsePositives} false positives`}
          icon={AlertTriangle}
          accent="bg-slate-700"
        />
        <KpiCard
          label="Confirmation Rate"
          value={fmtPct(summary.confirmRate)}
          sub="Issues confirmed as billing errors"
          icon={CheckCircle2}
          accent="bg-emerald-600"
          trend="up"
        />
        <KpiCard
          label="False Positive Rate"
          value={fmtPct(summary.totalIssues > 0 ? (summary.falsePositives / summary.totalIssues) * 100 : 0)}
          sub="Issues dismissed by reviewers"
          icon={TrendingDown}
          accent="bg-amber-500"
        />
        <KpiCard
          label="Escalation Rate"
          value={fmtPct(summary.escalationRate)}
          sub="Issues sent to Internal Lawyer"
          icon={ShieldAlert}
          accent="bg-violet-600"
        />
      </div>

      {/* ── Firm acknowledgement / ROI funnel ───────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Value Detected"
          value={fmtCurrency(roiSummary.totalDetectedValue, true)}
          sub={`Recoverable across all reviewed issues`}
          icon={DollarSign}
          accent="bg-slate-700"
        />
        <KpiCard
          label="Rejected (Confirmed Errors)"
          value={fmtCurrency(roiSummary.totalRejectedValue, true)}
          sub={`${roiSummary.rejectedCount} issue${roiSummary.rejectedCount !== 1 ? "s" : ""} disputed with firms`}
          icon={TrendingUp}
          accent="bg-red-600"
          trend="up"
        />
        <KpiCard
          label="Acknowledged by Firm"
          value={fmtCurrency(roiSummary.totalAcknowledgedValue, true)}
          sub={`${fmtPct(roiSummary.acknowledgementRate)} acknowledgement rate · ${roiSummary.acknowledgedCount} issue${roiSummary.acknowledgedCount !== 1 ? "s" : ""}`}
          icon={Handshake}
          accent="bg-teal-600"
          trend="up"
        />
      </div>

      {/* ── Rejected vs Firm-Acknowledged by month ───────────────── */}
      {rejectedVsAcknowledgedByMonth.length > 0 && (
        <div>
          <SectionHeader
            title="Disputed vs Firm-Acknowledged (Monthly)"
            subtitle="Comparison of value disputed with firms vs confirmed by firm acknowledgement"
          />
          <ChartCard title="Rejected vs Acknowledged Value" subtitle="Monthly trend — disputes raised vs firm acceptance">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={rejectedVsAcknowledgedByMonth} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => fmtCurrency(v, true)} tick={{ fontSize: 11 }} width={52} />
                <Tooltip content={<CurrencyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="rejectedValue" name="Disputed (Rejected)" fill={BRAND} radius={[4, 4, 0, 0]} />
                <Bar dataKey="acknowledgedValue" name="Acknowledged by Firm" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* ── Recovery over time ───────────────────────────────────── */}
      {recoveryByMonth.length > 0 && (
        <div>
          <SectionHeader title="Recovery & Volume Over Time" subtitle="Last 12 months · confirmed recovery and amount reviewed by invoice creation date" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Confirmed Recovery (monthly)" subtitle="Sum of confirmed billing error recoveries">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={recoveryByMonth} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="recoveryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BRAND} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => fmtCurrency(v, true)} tick={{ fontSize: 11 }} width={52} />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Area type="monotone" dataKey="confirmedRecovery" name="Recovery" stroke={BRAND} fill="url(#recoveryGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Invoice Volume & Amount Reviewed (monthly)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={recoveryByMonth} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => fmtCurrency(v, true)} tick={{ fontSize: 11 }} width={52} />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Bar dataKey="amountReviewed" name="Amount Reviewed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="amountAtRisk" name="At Risk" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}

      {/* ── By firm ─────────────────────────────────────────────── */}
      {byFirm.length > 0 && (
        <div>
          <SectionHeader title="Performance by Law Firm" subtitle="Top 10 firms by amount reviewed" />
          <ChartCard
            title="Law Firm Comparison"
            subtitle={firmTab === "recovery" ? "Confirmed recovery" : firmTab === "volume" ? "Total amount reviewed" : "Issues detected vs confirmed"}
          >
            {/* Tab strip */}
            <div className="flex gap-1 mb-4 p-1 bg-muted rounded-xl w-fit">
              {([["recovery", "Recovery"], ["volume", "Volume"], ["issues", "Issues"]] as [FirmTab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFirmTab(key)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    firmTab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              {firmTab === "issues" ? (
                <BarChart data={firmChartData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !Array.isArray(payload) || !payload.length) return null;
                      return (
                        <div className={CustomTooltipStyle}>
                          <p className="font-semibold mb-1">{String(label)}</p>
                          {payload.map((p: Record<string, unknown>, i: number) => (
                            <p key={i} style={{ color: String(p.color) }}>{String(p.name)}: {String(p.value)}</p>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="issues" name="Total Issues" fill="#94a3b8" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="confirmed" name="Confirmed" fill={BRAND} radius={[0, 4, 4, 0]} />
                </BarChart>
              ) : (
                <BarChart data={firmChartData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tickFormatter={v => fmtCurrency(v, true)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Bar
                    dataKey={firmTab === "recovery" ? "recovery" : "amount"}
                    name={firmTab === "recovery" ? "Confirmed Recovery" : "Amount Reviewed"}
                    fill={firmTab === "recovery" ? BRAND : "#3b82f6"}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* ── Issues by rule & by status ────────────────────────── */}
      <div>
        <SectionHeader title="Issue Analysis" subtitle="Rule frequency, decision outcomes, and issue routing" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top rules bar chart */}
          <div className="lg:col-span-2">
            <ChartCard title="Top Rules by Issue Frequency" subtitle="Number of times each rule fired across all analysis runs">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topRules} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="ruleCode" tick={{ fontSize: 10 }} width={180} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !Array.isArray(payload) || !payload.length) return null;
                      const rule = topRules.find(r => r.ruleCode === label);
                      return (
                        <div className={CustomTooltipStyle}>
                          <p className="font-semibold mb-1">{String(label)}</p>
                          <p>Total: {rule?.issueCount ?? 0}</p>
                          <p className="text-red-600">Confirmed: {rule?.confirmedCount ?? 0}</p>
                          <p className="text-amber-600">False positive: {rule?.falsePositiveCount ?? 0}</p>
                          <p className="text-slate-500">Recoverable: {fmtCurrency(rule?.totalRecoverable ?? 0)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="issueCount" name="Total Issues" radius={[0, 4, 4, 0]}>
                    {topRules.map((r, i) => (
                      <Cell key={i} fill={r.severity === "error" ? BRAND : "#f59e0b"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-3 justify-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#EC0000] inline-block" /> Error</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Warning</span>
              </div>
            </ChartCard>
          </div>

          {/* Issue status pie */}
          <ChartCard title="Issue Decision Outcomes" subtitle="How issues were resolved by reviewers">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {statusPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !Array.isArray(payload) || !payload.length) return null;
                    const p = payload[0] as Record<string, unknown>;
                    return (
                      <div className={CustomTooltipStyle}>
                        <p className="font-semibold">{String(p.name)}</p>
                        <p>{String(p.value)} issues</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {statusPieData.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-muted-foreground truncate max-w-[150px]">{s.name}</span>
                  </span>
                  <span className="font-medium text-foreground">{s.value}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      </div>

      {/* ── Jurisdiction & Billing type ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By jurisdiction */}
        {byJurisdiction.length > 0 && (
          <ChartCard title="By Jurisdiction" subtitle="Invoice volume and recovery by applicable law">
            <div className="space-y-2 mt-1">
              {byJurisdiction.slice(0, 8).map((j, i) => {
                const pct = summary.totalAmountReviewed > 0
                  ? (j.totalAmount / summary.totalAmountReviewed) * 100
                  : 0;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="flex items-center gap-1.5 text-foreground font-medium">
                        <Globe className="w-3 h-3 text-muted-foreground" />
                        {j.jurisdiction}
                        <span className="text-muted-foreground font-normal">({j.invoiceCount} inv.)</span>
                      </span>
                      <span className="text-muted-foreground">
                        {fmtCurrency(j.confirmedRecovery, true)} recovered
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%`, background: PALETTE[i % PALETTE.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </ChartCard>
        )}

        {/* By billing type */}
        {byBillingType.length > 0 && (
          <ChartCard title="Billing Type Distribution" subtitle="Invoice count by agreed billing structure">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={billingPieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {billingPieData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !Array.isArray(payload) || !payload.length) return null;
                    const p = payload[0] as Record<string, unknown>;
                    const bt = byBillingType.find(b => BILLING_TYPE_LABELS[b.billingType] === p.name || b.billingType === p.name);
                    return (
                      <div className={CustomTooltipStyle}>
                        <p className="font-semibold">{String(p.name)}</p>
                        <p>{String(p.value)} invoices</p>
                        {bt && <p className="text-muted-foreground">Amount: {fmtCurrency(bt.totalAmount, true)}</p>}
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>

      {/* ── Firm league table ─────────────────────────────────── */}
      {byFirm.length > 0 && (
        <div>
          <SectionHeader title="Law Firm League Table" subtitle="Summary metrics across all reviewed invoices" />
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Firm</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Invoices</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Amount Reviewed</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Issues</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Confirmed</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Recovery</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Recovery %</th>
                </tr>
              </thead>
              <tbody>
                {byFirm.map((f, i) => {
                  const recoveryPct = f.totalAmount > 0 ? (f.confirmedRecovery / f.totalAmount) * 100 : 0;
                  return (
                    <tr key={f.firmId} className={cn("border-b border-border last:border-0 hover:bg-muted/30 transition-colors", i === 0 && "bg-red-50/30")}>
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
                      <td className="px-4 py-3 text-right">{f.issueCount}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn("font-semibold", f.confirmedIssues > 0 ? "text-red-600" : "text-muted-foreground")}>
                          {f.confirmedIssues}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-emerald-700">
                        {fmtCurrency(f.confirmedRecovery)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          recoveryPct > 5 ? "bg-red-100 text-red-700" : recoveryPct > 1 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
                        )}>
                          {fmtPct(recoveryPct)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
