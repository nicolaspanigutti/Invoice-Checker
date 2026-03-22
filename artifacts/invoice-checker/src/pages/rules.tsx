import { useState } from "react";
import { ChevronDown, ChevronRight, Settings, AlertTriangle, Info } from "lucide-react";
import { useListRules, useUpdateRule, useGetMe } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { Rule } from "@workspace/api-client-react";

const RULE_TYPE_LABELS: Record<string, string> = {
  objective: "Objective",
  gray: "Grey Area",
  configurable: "Configurable",
  warning: "Warning",
};

const RULE_TYPE_COLORS: Record<string, string> = {
  objective: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  gray: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  configurable: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  warning: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

const SEVERITY_COLORS: Record<string, string> = {
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

function RuleRow({
  rule,
  isSuperAdmin,
  onToggle,
  onConfigure,
  expanded,
  onExpand,
}: {
  rule: Rule;
  isSuperAdmin: boolean;
  onToggle: (code: string, isActive: boolean) => void;
  onConfigure: (rule: Rule) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  return (
    <div className={`border-b border-border last:border-0 transition-colors ${!rule.isActive ? "opacity-60" : ""}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40"
        onClick={onExpand}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{rule.displayName}</span>
            <code className="text-xs text-muted-foreground font-mono">{rule.code}</code>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RULE_TYPE_COLORS[rule.ruleType]}`}>
              {RULE_TYPE_LABELS[rule.ruleType]}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[rule.severity]}`}>
              {rule.severity}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rule.description}</p>
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {rule.hasConfig && isSuperAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onConfigure(rule)}
            >
              <Settings className="w-3.5 h-3.5 mr-1" />
              Configure
            </Button>
          )}
          {isSuperAdmin ? (
            <Switch
              checked={rule.isActive}
              onCheckedChange={(checked) => onToggle(rule.code, checked)}
            />
          ) : (
            <Badge variant={rule.isActive ? "outline" : "secondary"} className="text-xs">
              {rule.isActive ? "Active" : "Inactive"}
            </Badge>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-10 pb-4 space-y-2 bg-muted/20">
          <p className="text-sm text-foreground">{rule.description}</p>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Scope: <strong>{rule.scope === "invoice_item" ? "Line item" : "Invoice"}</strong></span>
            <span>Routes to: <strong>{rule.routeToRole === "legal_ops" ? "Legal Ops" : "Internal Lawyer"}</strong></span>
            {rule.hasConfig && rule.configJson && (
              <span>Config: <strong>{Object.entries(rule.configJson as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(", ")}</strong></span>
            )}
            {rule.updatedAt && (
              <span>Last updated: <strong>{new Date(rule.updatedAt).toLocaleDateString()}</strong></span>
            )}
          </div>
          {!rule.isActive && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mt-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              This rule is inactive and will be skipped on subsequent analysis runs.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigureDialog({
  rule,
  open,
  onClose,
  onSave,
}: {
  rule: Rule | null;
  open: boolean;
  onClose: () => void;
  onSave: (configJson: Record<string, unknown>) => void;
}) {
  const currentConfig = (rule?.configJson as Record<string, unknown> | null) ?? {};
  const [minAttendees, setMinAttendees] = useState<string>(String(currentConfig.min_attendees ?? 3));
  const [maxAttendees, setMaxAttendees] = useState<string>(String(currentConfig.max_attendees ?? 5));

  const handleSave = () => {
    const min = parseInt(minAttendees, 10);
    const max = parseInt(maxAttendees, 10);
    if (isNaN(min) || isNaN(max) || min < 1 || max < min) {
      toast.error("Invalid thresholds. Min must be ≥ 1 and Max must be ≥ Min.");
      return;
    }
    onSave({ min_attendees: min, max_attendees: max });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Configure {rule?.displayName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Set the attendee thresholds for detecting meeting overstaffing. When unique timekeepers billing for the same meeting exceed the maximum, an issue is raised.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="min-attendees">Minimum expected attendees</Label>
              <Input
                id="min-attendees"
                type="number"
                min={1}
                value={minAttendees}
                onChange={e => setMinAttendees(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-attendees">Maximum allowed attendees</Label>
              <Input
                id="max-attendees"
                type="number"
                min={1}
                value={maxAttendees}
                onChange={e => setMaxAttendees(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Issues fire when attendee count exceeds this value.</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Rules() {
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.role === "super_admin";
  const { data: rules, isLoading, refetch } = useListRules();
  const { mutateAsync: updateRuleMutation } = useUpdateRule();

  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"all" | "objective" | "gray" | "configurable" | "warning">("all");
  const [configureRule, setConfigureRule] = useState<Rule | null>(null);

  const handleToggle = async (code: string, isActive: boolean) => {
    try {
      await updateRuleMutation({ code, data: { isActive } });
      toast.success(`Rule ${isActive ? "activated" : "deactivated"} — will apply to future analysis runs.`);
      refetch();
    } catch {
      toast.error("Failed to update rule. Please try again.");
    }
  };

  const handleConfigure = (rule: Rule) => {
    setConfigureRule(rule);
  };

  const handleSaveConfig = async (configJson: Record<string, unknown>) => {
    if (!configureRule) return;
    try {
      await updateRuleMutation({ code: configureRule.code, data: { configJson } });
      toast.success("Rule configuration saved.");
      setConfigureRule(null);
      refetch();
    } catch {
      toast.error("Failed to save configuration.");
    }
  };

  const toggleExpand = (code: string) => {
    setExpandedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const filteredRules = (rules ?? []).filter(r => tab === "all" || r.ruleType === tab);

  const activeCount = (rules ?? []).filter(r => r.isActive).length;
  const totalCount = rules?.length ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Rule Engine</h1>
        <p className="text-lg text-muted-foreground">
          {isSuperAdmin
            ? "View, activate, deactivate, and configure the 27 compliance rules."
            : "View all 27 compliance rules applied during invoice analysis."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border border-border rounded-2xl bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Total Rules</p>
          <p className="text-3xl font-bold text-foreground mt-1">{totalCount}</p>
        </div>
        <div className="border border-border rounded-2xl bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Active</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{activeCount}</p>
        </div>
        <div className="border border-border rounded-2xl bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Inactive</p>
          <p className="text-3xl font-bold text-muted-foreground mt-1">{totalCount - activeCount}</p>
        </div>
      </div>

      {!isSuperAdmin && (
        <div className="flex items-start gap-3 border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 rounded-2xl p-4">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Only Super Admins can activate, deactivate, or configure rules. Contact your admin to adjust rule settings.
          </p>
        </div>
      )}

      <div className="border border-border rounded-2xl bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 pt-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="bg-transparent gap-1">
              <TabsTrigger value="all" className="text-xs">All ({totalCount})</TabsTrigger>
              <TabsTrigger value="objective" className="text-xs">Objective</TabsTrigger>
              <TabsTrigger value="gray" className="text-xs">Grey Area</TabsTrigger>
              <TabsTrigger value="configurable" className="text-xs">Configurable</TabsTrigger>
              <TabsTrigger value="warning" className="text-xs">Warnings</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading rules…</div>
        ) : filteredRules.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No rules found.</div>
        ) : (
          <div>
            {filteredRules.map(rule => (
              <RuleRow
                key={rule.code}
                rule={rule}
                isSuperAdmin={isSuperAdmin}
                onToggle={handleToggle}
                onConfigure={handleConfigure}
                expanded={expandedCodes.has(rule.code)}
                onExpand={() => toggleExpand(rule.code)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfigureDialog
        rule={configureRule}
        open={!!configureRule}
        onClose={() => setConfigureRule(null)}
        onSave={handleSaveConfig}
      />
    </div>
  );
}
