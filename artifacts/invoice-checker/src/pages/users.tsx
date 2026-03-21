import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import type { AuthUser } from "@workspace/api-client-react";
import { Users, Plus, Search, X, Pencil, Shield, UserCheck, UserX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatRole } from "@/lib/utils";

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700",
  legal_ops: "bg-blue-100 text-blue-700",
  internal_lawyer: "bg-emerald-100 text-emerald-700",
};

function UserModal({ user, onClose }: { user?: AuthUser; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();

  const [form, setForm] = useState({
    displayName: user?.displayName ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "legal_ops" as "super_admin" | "legal_ops" | "internal_lawyer",
    password: "",
    isActive: user?.isActive ?? true,
  });

  const inputClass = "w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm";

  const isEditing = !!user;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.displayName || (!isEditing && !form.email) || (!isEditing && !form.password)) {
      toast({ variant: "destructive", title: "Please fill in all required fields." });
      return;
    }

    if (isEditing) {
      updateMutation.mutate({ id: user.id, data: {
        displayName: form.displayName,
        role: form.role,
        isActive: form.isActive,
        password: form.password || null,
      }}, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({ title: "User updated." });
          onClose();
        },
        onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.data?.error || "Failed to update user." })
      });
    } else {
      createMutation.mutate({ data: {
        displayName: form.displayName,
        email: form.email,
        password: form.password,
        role: form.role,
      }}, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({ title: "User created.", description: `${form.displayName} can now sign in.` });
          onClose();
        },
        onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.data?.error || "Failed to create user." })
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-3xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-display font-bold text-foreground">{isEditing ? "Edit User" : "Add User"}</h2>
          <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Display Name *</label>
            <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="e.g. Sophie Cartwright" className={inputClass} />
          </div>
          {!isEditing && (
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Email Address *</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. s.cartwright@company.com" className={inputClass} type="email" />
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">Role *</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))} className={inputClass}>
              <option value="super_admin">Super Admin</option>
              <option value="legal_ops">Legal Ops</option>
              <option value="internal_lawyer">Internal Lawyer</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">{isEditing ? "New Password (leave blank to keep current)" : "Password *"}</label>
            <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={isEditing ? "Leave blank to keep current password" : "Min 8 characters"} className={inputClass} type="password" />
          </div>
          {isEditing && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded" />
                <span className="text-sm font-medium text-foreground">Account active</span>
              </label>
              <span className="text-xs text-muted-foreground ml-auto">{form.isActive ? "User can sign in" : "User cannot sign in"}</span>
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-muted text-sm font-medium">Cancel</button>
            <button type="submit" disabled={isPending} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-70 flex items-center gap-2">
              {isPending ? "Saving..." : isEditing ? "Save Changes" : <><Plus className="w-4 h-4" />Create User</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AuthUser | null>(null);

  const { data: users = [], isLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  const filtered = users.filter(u =>
    !search || u.displayName.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">Users</h1>
          <p className="text-muted-foreground mt-1">Manage access for Super Admins, Legal Ops, and Internal Lawyers.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />Add User
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><div className="animate-spin text-primary text-3xl">⟳</div></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-12 flex flex-col items-center text-center">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-display font-bold text-foreground">No users found</h3>
          <p className="text-muted-foreground mt-1 text-sm">Try adjusting the search or add a new user.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
          {filtered.map(user => (
            <div key={user.id} className="flex items-center gap-4 p-4 hover:bg-muted/20 transition-colors group">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm", ROLE_COLORS[user.role] ?? "bg-muted text-muted-foreground")}>
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{user.displayName}</p>
                  {!user.isActive && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">Inactive</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn("hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold", ROLE_COLORS[user.role] ?? "bg-muted text-muted-foreground")}>
                  {formatRole(user.role)}
                </span>
                <button onClick={() => setEditUser(user)} className="p-2 rounded-xl text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <UserModal onClose={() => setShowCreate(false)} />}
      {editUser && <UserModal user={editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}
