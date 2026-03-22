import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn, formatRole } from "@/lib/utils";
import { AuthUser } from "@workspace/api-client-react";
import { useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, FileText, Building2, DollarSign,
  Shield, Users, LogOut, Menu, X
} from "lucide-react";

function InvoiceCheckerLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Rook battlements — 3 teeth */}
      <rect x="9"    y="4" width="5.5" height="7" rx="1" fill="currentColor" />
      <rect x="17.5" y="4" width="5.5" height="7" rx="1" fill="currentColor" />
      <rect x="26"   y="4" width="5.5" height="7" rx="1" fill="currentColor" />
      {/* Rook neck — connects teeth to body */}
      <rect x="9" y="10" width="22" height="3.5" fill="currentColor" />
      {/* Rook/document body — the invoice */}
      <rect x="9" y="14" width="22" height="22" rx="2.5" fill="currentColor" />
      {/* Invoice lines (white notches on the document) */}
      <rect x="13" y="19" width="14" height="2" rx="1" fill="white" opacity="0.85" />
      <rect x="13" y="24" width="14" height="2" rx="1" fill="white" opacity="0.85" />
      <rect x="13" y="29" width="9"  height="2" rx="1" fill="white" opacity="0.85" />
    </svg>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
  user: AuthUser;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin", "legal_ops", "internal_lawyer"] },
  { href: "/invoices", label: "Invoices", icon: FileText, roles: ["super_admin", "legal_ops", "internal_lawyer"] },
  { href: "/law-firms", label: "Law Firms", icon: Building2, roles: ["super_admin", "legal_ops"] },
  { href: "/rates", label: "Rates", icon: DollarSign, roles: ["super_admin", "legal_ops"] },
  { href: "/rules", label: "Rules", icon: Shield, roles: ["super_admin", "legal_ops", "internal_lawyer"] },
  { href: "/users", label: "Users", icon: Users, roles: ["super_admin"] },
];

export function AppLayout({ children, user }: AppLayoutProps) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const logoutMutation = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'bg-purple-500/20 text-purple-200 border-purple-500/30';
      case 'legal_ops': return 'bg-blue-500/20 text-blue-200 border-blue-500/30';
      case 'internal_lawyer': return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30';
      default: return 'bg-gray-500/20 text-gray-200 border-gray-500/30';
    }
  };

  const SidebarContent = () => (
    <>
      <div className="flex items-center gap-3 px-6 py-8">
        <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center shadow-lg">
          <InvoiceCheckerLogo className="w-7 h-7 text-white" />
        </div>
        <span className="text-xl font-bold font-display tracking-tight text-sidebar-foreground">
          Invoice Checker
        </span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto">
        {navItems.filter(item => item.roles.includes(user.role)).map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-black/10"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 mt-auto">
        <div className="p-4 rounded-2xl bg-sidebar-accent border border-sidebar-border">
          <div className="flex flex-col gap-1 mb-4">
            <span className="text-sm font-semibold text-sidebar-foreground truncate" title={user.displayName}>
              {user.displayName}
            </span>
            <div className="flex">
              <span className={cn("text-xs px-2 py-0.5 rounded-full border", getRoleColor(user.role))}>
                {formatRole(user.role)}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sidebar-border/50 text-sidebar-foreground/80 hover:bg-destructive hover:text-destructive-foreground transition-colors duration-200 text-sm font-medium disabled:opacity-50"
          >
            {logoutMutation.isPending ? <span className="animate-spin">⟳</span> : <LogOut className="w-4 h-4" />}
            Log out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-72 flex-col bg-sidebar border-r border-border">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setIsMobileMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-border flex flex-col shadow-2xl animate-in slide-in-from-left duration-300">
            <div className="absolute top-4 right-4">
              <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <X className="w-6 h-6" />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-20 lg:hidden flex items-center px-6 border-b bg-card/50 backdrop-blur-md sticky top-0 z-40">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 -ml-2 text-foreground/70 hover:text-foreground"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="ml-4 font-display font-bold">Invoice Checker</div>
        </header>

        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6 md:p-8 lg:p-10">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
