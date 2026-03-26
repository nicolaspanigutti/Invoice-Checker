import { useState } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Key, Trash2, CheckCircle2, AlertCircle, ExternalLink, Cpu } from "lucide-react";

type Provider = "openai" | "anthropic" | "gemini";

const PROVIDERS: { id: Provider; label: string; description: string; placeholder: string; link: string; linkLabel: string }[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Use GPT-4o for invoice extraction and AI analysis.",
    placeholder: "sk-...",
    link: "https://platform.openai.com/api-keys",
    linkLabel: "Get an API key from OpenAI",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Use Claude 3.5 Sonnet for invoice extraction and AI analysis.",
    placeholder: "sk-ant-...",
    link: "https://console.anthropic.com/settings/keys",
    linkLabel: "Get an API key from Anthropic",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Use Gemini 1.5 Pro for invoice extraction and AI analysis.",
    placeholder: "AIza...",
    link: "https://aistudio.google.com/app/apikey",
    linkLabel: "Get an API key from Google AI Studio",
  },
];

function ProviderCard({
  provider,
  hasKey,
  isActive,
  onSetActive,
}: {
  provider: (typeof PROVIDERS)[0];
  hasKey: boolean;
  isActive: boolean;
  onSetActive: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/auth/me/ai-key/${provider.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save key");
      }
      setKey("");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "API key saved", description: `Your ${provider.label} key has been encrypted and saved.` });
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
    if (!confirm(`Remove your ${provider.label} API key? AI features will stop working if this is your active provider.`)) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/auth/me/ai-key/${provider.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove key");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "API key removed", description: `Your ${provider.label} API key has been removed.` });
    } catch {
      toast({ variant: "destructive", title: "Failed to remove key" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className={`rounded-xl border p-5 space-y-4 transition-colors ${isActive ? "border-primary bg-primary/5" : "bg-card"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{provider.label}</h3>
            {isActive && (
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">Active</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{provider.description}</p>
          <a
            href={provider.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
          >
            {provider.linkLabel} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {hasKey && !isActive && (
          <button
            onClick={onSetActive}
            className="text-xs px-3 py-1.5 rounded-lg border border-primary text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
          >
            Use this provider
          </button>
        )}
      </div>

      {hasKey ? (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Key configured — stored securely</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No key configured</p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-2">
        <label className="text-sm font-medium">{hasKey ? "Replace key" : "Add key"}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder={provider.placeholder}
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
            disabled={saving || !key.trim()}
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
          {removing ? "Removing…" : "Remove key"}
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const { data: user } = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [switchingProvider, setSwitchingProvider] = useState(false);

  const currentProvider: Provider = (user?.aiProvider as Provider) ?? "openai";

  async function handleSetProvider(provider: Provider) {
    if (provider === currentProvider) return;
    setSwitchingProvider(true);
    try {
      const res = await fetch("/api/auth/me/ai-provider", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) throw new Error("Failed to switch provider");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      const label = PROVIDERS.find(p => p.id === provider)?.label ?? provider;
      toast({ title: "Provider switched", description: `Now using ${label} for AI features.` });
    } catch {
      toast({ variant: "destructive", title: "Failed to switch provider" });
    } finally {
      setSwitchingProvider(false);
    }
  }

  const hasKeyMap: Record<Provider, boolean> = {
    openai: user?.hasOpenaiKey ?? false,
    anthropic: user?.hasAnthropicKey ?? false,
    gemini: user?.hasGeminiKey ?? false,
  };

  const activeHasKey = hasKeyMap[currentProvider];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your account settings and integrations.</p>
      </div>

      <div className="rounded-2xl border bg-card p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">AI Provider</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Invoice extraction and AI analysis use your own API key. Keys are encrypted at rest and never shared.
              Add a key for any provider and set it as active.
            </p>
          </div>
        </div>

        {!activeHasKey && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No active provider configured</p>
              <p className="text-xs text-muted-foreground mt-0.5">Add an API key below to enable AI features.</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {PROVIDERS.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              hasKey={hasKeyMap[p.id]}
              isActive={currentProvider === p.id}
              onSetActive={() => handleSetProvider(p.id)}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Account</h2>
          </div>
        </div>
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
