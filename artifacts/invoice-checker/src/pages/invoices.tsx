import { PlaceholderPage } from "@/components/shared/PlaceholderPage";
import { FileText } from "lucide-react";

export default function Invoices() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Invoices</h1>
        <p className="text-lg text-muted-foreground">Manage and review law firm invoices.</p>
      </div>
      <div className="border border-border rounded-3xl bg-card p-8 shadow-sm">
        <PlaceholderPage 
          title="Invoice Pipeline" 
          description="The complete invoice upload, AI extraction, and rule engine review pipeline will be available in the upcoming sprint."
          icon={FileText}
        />
      </div>
    </div>
  );
}
