import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Shield, Loader2, Lock, Mail } from "lucide-react";
import { useLogin, getGetMeQueryKey, type LoginMutationError } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  const onSubmit = (data: LoginForm) => {
    loginMutation.mutate({ data }, {
      onSuccess: (user) => {
        queryClient.setQueryData(getGetMeQueryKey(), user);
        toast({ title: "Welcome back", description: `Successfully logged in as ${user.displayName}.` });
        setLocation("/");
      },
      onError: (error: LoginMutationError) => {
        const msg = (error.data as { error?: string } | null)?.error;
        toast({ 
          variant: "destructive", 
          title: "Login failed", 
          description: msg || "Invalid credentials. Please try again." 
        });
      }
    });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background font-sans">
      {/* Left side - Branding */}
      <div className="hidden lg:flex flex-col justify-between bg-sidebar p-16 text-sidebar-foreground relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[100px] opacity-60" />
          <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] opacity-40 translate-x-1/3 translate-y-1/3" />
        </div>
        
        <div className="relative z-10 animate-in fade-in slide-in-from-left-8 duration-700">
          <div className="flex items-center gap-4 text-primary-foreground mb-16">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-xl shadow-primary/20">
              <Shield className="w-7 h-7" />
            </div>
            <span className="text-3xl font-bold font-display tracking-tight">Invoice Checker</span>
          </div>
          
          <div className="max-w-lg mt-32">
            <h1 className="text-5xl font-display font-extrabold leading-[1.15] mb-6">
              Enterprise legal invoice review, automated.
            </h1>
            <p className="text-sidebar-foreground/70 text-xl leading-relaxed">
              Ensure compliance, control costs, and streamline your review workflow with our intelligent, deterministic rule engine.
            </p>
          </div>
        </div>
        
        <div className="relative z-10 text-sidebar-foreground/40 text-sm font-medium">
          © {new Date().getFullYear()} Arcturus Legal Ops. All rights reserved.
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex items-center justify-center p-8 relative">
        <div className="w-full max-w-[420px] space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 fill-mode-both">
          <div className="text-center lg:text-left">
            <div className="lg:hidden flex justify-center mb-8">
              <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-xl shadow-primary/20">
                <Shield className="w-7 h-7 text-primary-foreground" />
              </div>
            </div>
            <h2 className="text-3xl font-display font-bold tracking-tight text-foreground">Welcome back</h2>
            <p className="text-muted-foreground mt-2 text-lg">Sign in to your account to continue</p>
          </div>

          <div className="bg-card border border-border/50 shadow-2xl shadow-black/[0.03] rounded-3xl p-8">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="email">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    className="w-full pl-11 pr-4 py-3 rounded-xl border-2 border-border/50 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200"
                    {...form.register("email")}
                    disabled={loginMutation.isPending}
                  />
                </div>
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive font-medium mt-1 animate-in fade-in slide-in-from-top-1">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-foreground" htmlFor="password">Password</label>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="w-full pl-11 pr-4 py-3 rounded-xl border-2 border-border/50 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200"
                    {...form.register("password")}
                    disabled={loginMutation.isPending}
                  />
                </div>
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive font-medium mt-1 animate-in fade-in slide-in-from-top-1">
                    {form.formState.errors.password.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="w-full mt-2 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none transition-all duration-200 ease-out"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  "Sign in to account"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
