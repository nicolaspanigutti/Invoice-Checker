import { FileText, AlertCircle, CheckCircle2, Clock, LayoutDashboard } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
}

function MetricCard({ title, value, icon: Icon }: MetricCardProps) {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50 hover:shadow-md transition-shadow duration-300">
      <div className="flex items-center justify-between">
        <div className="w-12 h-12 bg-primary/5 rounded-xl flex items-center justify-center text-primary">
          <Icon className="w-6 h-6" />
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
        <p className="text-3xl font-display font-bold text-foreground mt-1">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-lg text-muted-foreground">Overview of your invoice review pipeline.</p>
      </div>
      
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Pending Invoices" value="--" icon={FileText} />
        <MetricCard title="Amount at Risk" value="$ --" icon={AlertCircle} />
        <MetricCard title="Confirmed Recovery" value="$ --" icon={CheckCircle2} />
        <MetricCard title="Escalated Issues" value="--" icon={Clock} />
      </div>

      <div className="mt-8 rounded-3xl border border-border bg-card p-10 flex flex-col items-center justify-center text-center min-h-[400px] shadow-sm">
        <div className="w-20 h-20 bg-primary/5 text-primary rounded-3xl flex items-center justify-center mb-6 border border-primary/10">
          <LayoutDashboard className="h-10 w-10" />
        </div>
        <h2 className="text-2xl font-display font-bold text-foreground">Analytics Coming Soon</h2>
        <p className="text-muted-foreground mt-3 max-w-md text-lg leading-relaxed">
          Comprehensive reporting and pipeline analytics will be available here in Phase 1. 
          For now, navigate to the Invoices tab to process pending reviews.
        </p>
      </div>
    </div>
  );
}
