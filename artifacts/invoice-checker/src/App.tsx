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
import LawFirms from "@/pages/law-firms";
import Rates from "@/pages/rates";
import Rules from "@/pages/rules";
import Users from "@/pages/users";
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
      retry: false,
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

  if (error || !user) {
    return <Redirect to="/login" replace />;
  }

  return (
    <AppLayout user={user}>
      <Switch>
        <Route path="/"><ProtectedRoute component={Dashboard} user={user} /></Route>
        <Route path="/invoices"><ProtectedRoute component={Invoices} user={user} /></Route>
        <Route path="/invoices/:id"><ProtectedRoute component={InvoiceDetail} user={user} /></Route>
        <Route path="/law-firms"><ProtectedRoute component={LawFirms} allowedRoles={["super_admin", "legal_ops"]} user={user} /></Route>
        <Route path="/rates"><ProtectedRoute component={Rates} allowedRoles={["super_admin", "legal_ops"]} user={user} /></Route>
        <Route path="/rules"><ProtectedRoute component={Rules} user={user} /></Route>
        <Route path="/users"><ProtectedRoute component={Users} allowedRoles={["super_admin"]} user={user} /></Route>
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
