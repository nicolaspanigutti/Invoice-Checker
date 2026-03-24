import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe, getGetMeQueryKey, AuthUser } from "@workspace/api-client-react";
import { Loader2, ShieldAlert } from "lucide-react";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Invoices from "@/pages/invoices";
import InvoiceDetail from "@/pages/invoice-detail";
import InvoiceReport from "@/pages/invoice-report";
import LawFirms from "@/pages/law-firms";
import Rates from "@/pages/rates";
import Rules from "@/pages/rules";
import Users from "@/pages/users";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";

const queryClient = new QueryClient();

function ProtectedRoute({ 
  component: Component, 
  allowedRoles, 
  user 
}: { 
  component: React.ComponentType; 
  allowedRoles?: string[]; 
  user: AuthUser; 
}) {
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-destructive/10 rounded-3xl flex items-center justify-center mb-6">
          <ShieldAlert className="h-10 w-10 text-destructive" strokeWidth={1.5} />
        </div>
        <h2 className="text-3xl font-display font-bold text-foreground">Access Denied</h2>
        <p className="text-muted-foreground mt-3 text-lg max-w-md">
          Your role ({user.role.replace('_', ' ')}) does not have permission to view this section.
        </p>
      </div>
    );
  }
  return <Component />;
}

function MainApp() {
  const { data: user, isLoading, error } = useGetMe({ 
    query: { 
      queryKey: getGetMeQueryKey(),
      retry: (failureCount, err) => {
        // Never retry on 401 — the user is definitely not authenticated.
        // Retry up to 3 times for network/server errors so a brief restart
        // does not immediately kick the user back to the login page.
        const status = (err as { status?: number })?.status;
        if (status === 401) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      staleTime: Infinity 
    } 
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground font-medium animate-pulse">Authenticating session...</p>
        </div>
      </div>
    );
  }

  const is401 = (error as { status?: number } | null)?.status === 401;
  if (is401 || (!isLoading && !error && !user)) {
    return <Redirect to="/login" replace />;
  }

  // Still retrying after a transient error — keep showing the loading screen
  if (error && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground font-medium animate-pulse">Reconnecting...</p>
        </div>
      </div>
    );
  }

  const authedUser = user!;
  return (
    <AppLayout user={authedUser}>
      <Switch>
        <Route path="/"><ProtectedRoute component={Dashboard} user={authedUser} /></Route>
        <Route path="/invoices"><ProtectedRoute component={Invoices} user={authedUser} /></Route>
        <Route path="/invoices/:id/report"><ProtectedRoute component={InvoiceReport} user={authedUser} /></Route>
        <Route path="/invoices/:id"><ProtectedRoute component={InvoiceDetail} user={authedUser} /></Route>
        <Route path="/law-firms"><ProtectedRoute component={LawFirms} allowedRoles={["super_admin", "legal_ops"]} user={authedUser} /></Route>
        <Route path="/rates"><ProtectedRoute component={Rates} allowedRoles={["super_admin", "legal_ops"]} user={authedUser} /></Route>
        <Route path="/rules"><ProtectedRoute component={Rules} user={authedUser} /></Route>
        <Route path="/analytics"><ProtectedRoute component={Analytics} user={authedUser} /></Route>
        <Route path="/users"><ProtectedRoute component={Users} allowedRoles={["super_admin"]} user={authedUser} /></Route>
        <Route><NotFound /></Route>
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="*" component={MainApp} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
