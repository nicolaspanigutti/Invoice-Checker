import { useListInvoices } from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { FileText, AlertTriangle, CheckCircle2, TrendingDown, ArrowRight } from "lucide-react";
import { Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  extracting_data: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-700",
  waiting_internal_lawyer: "bg-purple-100 text-purple-700",
  pending_law_firm: "bg-orange-100 text-orange-700",
  ready_to_pay: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<string, string> = {
  extracting_data: "Extracting",
  in_review: "In Review",
  waiting_internal_lawyer: "Awaiting Lawyer",
  pending_law_firm: "Pending Firm",
  ready_to_pay: "Ready to Pay",
};

function fmt(amount: string | null | undefined, currency?: string | null) {
  if (!amount) return "—";
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency ?? "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return d; }
}

export default function Dashboard() {
  const { data } = useListInvoices({ pageSize: 50 });
  const invoices = data?.data ?? [];

  const pending = invoices.filter(i => ["in_review", "extracting_data", "pending_law_firm"].includes(i.invoiceStatus as string)).length;
  const escalated = invoices.filter(i => (i.invoiceStatus as string) === "waiting_internal_lawyer").length;
  const approved = invoices.filter(i => (i.invoiceStatus as string) === "ready_to_pay").length;

  const totalAmount = invoices.reduce((sum, i) => {
    const v = parseFloat(i.totalAmount ?? "0");
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  const recent = [...invoices]
    .sort((a, b) => new Date(b.invoiceDate ?? 0).getTime() - new Date(a.invoiceDate ?? 0).getTime())
    .slice(0, 6);

  const statusCounts = invoices.reduce<Record<string, number>>((acc, inv) => {
    acc[inv.invoiceStatus] = (acc[inv.invoiceStatus] ?? 0) + 1;
    return acc;
  }, {});

  const chartData = [
    { name: "Extracting", value: statusCounts["extracting_data"] ?? 0, fill: "#f59e0b" },
    { name: "In Review", value: statusCounts["in_review"] ?? 0, fill: "#3b82f6" },
    { name: "Awaiting Lawyer", value: statusCounts["waiting_internal_lawyer"] ?? 0, fill: "#EC0000" },
    { name: "Pending Firm", value: statusCounts["pending_law_firm"] ?? 0, fill: "#f97316" },
    { name: "Ready to Pay", value: statusCounts["ready_to_pay"] ?? 0, fill: "#22c55e" },
  ];

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your invoice review pipeline.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Pending */}
        <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium text-muted-foreground">Total Pending</p>
            <FileText className="w-5 h-5 text-muted-foreground/50" />
          </div>
          <p className="text-4xl font-display font-bold text-foreground mt-3">{pending}</p>
          <p className="text-xs text-muted-foreground mt-1">Invoices requiring action</p>
        </div>

        {/* Escalated */}
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium text-orange-600">Escalated</p>
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          </div>
          <p className="text-4xl font-display font-bold text-orange-600 mt-3">{escalated}</p>
          <p className="text-xs text-orange-500 mt-1">Awaiting Legal review</p>
        </div>

        {/* Approved */}
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium text-green-700">Approved</p>
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-4xl font-display font-bold text-green-700 mt-3">{approved}</p>
          <p className="text-xs text-green-600 mt-1">Successfully processed</p>
        </div>

        {/* Total Value */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium text-blue-700">Total Value</p>
            <TrendingDown className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-display font-bold text-blue-700 mt-3 leading-tight">
            {totalAmount > 0
              ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", notation: "compact", maximumFractionDigits: 1 }).format(totalAmount)
              : "—"}
          </p>
          <p className="text-xs text-blue-600 mt-1">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} tracked</p>
        </div>
      </div>

      {/* Content Row */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Recent Invoices */}
        <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="font-display font-bold text-foreground">Recent Invoices</h2>
            <Link href="/invoices" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No invoices yet.</p>
              <Link href="/invoices" className="text-sm text-primary font-medium hover:underline mt-1 inline-block">Add your first invoice</Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Firm</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invoice #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Date</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="text-left px-4 py-3 pr-6 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((inv, idx) => (
                  <tr key={inv.id} className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-6 py-3.5 font-medium text-foreground">{inv.lawFirmName ?? "—"}</td>
                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3.5 text-muted-foreground hidden sm:table-cell">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-4 py-3.5 text-right font-medium">{fmt(inv.totalAmount, inv.currency)}</td>
                    <td className="px-4 py-3.5 pr-6">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[inv.invoiceStatus] ?? "bg-gray-100 text-gray-600"}`}>
                        {STATUS_LABELS[inv.invoiceStatus] ?? inv.invoiceStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Invoice Pipeline Chart */}
        <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-display font-bold text-foreground">Invoice Pipeline</h2>
            <p className="text-xs text-muted-foreground mt-0.5">By status</p>
          </div>
          <div className="p-5">
            {invoices.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} barSize={28} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  />
                  <Bar dataKey="value" name="Invoices" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            <div className="mt-3 space-y-1.5">
              {chartData.filter(d => d.value > 0).map(d => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.fill }} />
                    <span className="text-muted-foreground">{d.name}</span>
                  </div>
                  <span className="font-semibold text-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
