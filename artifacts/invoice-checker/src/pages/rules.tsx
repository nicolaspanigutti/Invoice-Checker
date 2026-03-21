import { PlaceholderPage } from "@/components/shared/PlaceholderPage";
import { Shield } from "lucide-react";

export default function Rules() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Rule Engine</h1>
        <p className="text-lg text-muted-foreground">View and configure the 27 objective and heuristic rules.</p>
      </div>
      <div className="border border-border rounded-3xl bg-card p-8 shadow-sm">
        <PlaceholderPage 
          title="Rules Directory" 
          description="Documentation and toggles for all active billing rules, configuration thresholds, and grey area heuristics."
          icon={Shield}
        />
      </div>
    </div>
  );
}
