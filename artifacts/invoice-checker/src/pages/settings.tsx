import { useState } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Key, Trash2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";

export default function Settings() {
  const { data: user } = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const hasKey = user?.hasOpenaiKey ?? false;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/auth/me/openai-key", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save key");
      }
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "API key saved", description: "Your OpenAI key has been encrypted and saved." });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to save key",
        description: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove your OpenAI API key? AI features (invoice extraction, analysis) will stop working until you add a new key.")) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/auth/me/openai-key", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove key");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "API key removed", description: "Your OpenAI API key has been removed." });
    } catch {
      toast({ variant: "destructive", title: "Failed to remove key" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your account settings and integrations.</p>
      </div>

      <div className="rounded-2xl border bg-card p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold">OpenAI API Key</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Invoice extraction and AI analysis require your own OpenAI API key. It is encrypted at rest and never shared.
            </p>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
            >
              Get an API key from OpenAI <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {hasKey ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">API key configured</p>
              <p className="text-xs text-muted-foreground mt-0.5">Your key is stored securely. You can replace or remove it below.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No API key configured</p>
              <p className="text-xs text-muted-foreground mt-0.5">Add your OpenAI key below to enable invoice extraction and analysis.</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3">
          <label className="text-sm font-medium">
            {hasKey ? "Replace API key" : "Add API key"}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full h-10 px-3 pr-10 rounded-lg border bg-background text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="submit"
              disabled={saving || !apiKey.trim()}
              className="px-4 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>

        {hasKey && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {removing ? "Removing…" : "Remove API key"}
          </button>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Name</p>
            <p className="font-medium mt-1">{user?.displayName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Email</p>
            <p className="font-medium mt-1">{user?.email}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Role</p>
            <p className="font-medium mt-1 capitalize">{user?.role.replace(/_/g, " ")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
