import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { useLogin, getGetMeQueryKey, type LoginMutationError } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

function CrownDocumentIcon() {
  return (
    <div className="w-28 h-28 bg-white rounded-3xl flex items-center justify-center shadow-2xl">
      <svg viewBox="0 0 80 80" className="w-20 h-20" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Crown */}
        <path
          d="M20 36L28 24L40 32L52 24L60 36H20Z"
          fill="#EC0000"
        />
        {/* Crown base bar */}
        <rect x="20" y="35" width="40" height="6" rx="2" fill="#EC0000" />
        {/* Document body */}
        <rect x="24" y="43" width="32" height="26" rx="3" fill="#EC0000" opacity="0.9" />
        {/* Document lines */}
        <rect x="30" y="50" width="20" height="3" rx="1.5" fill="white" opacity="0.9" />
        <rect x="30" y="57" width="20" height="3" rx="1.5" fill="white" opacity="0.9" />
        <rect x="30" y="64" width="12" height="3" rx="1.5" fill="white" opacity="0.9" />
      </svg>
    </div>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const [showPw, setShowPw] = useState(false);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  const onSubmit = (data: LoginForm) => {
    loginMutation.mutate({ data }, {
      onSuccess: (user) => {
        queryClient.setQueryData(getGetMeQueryKey(), user);
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
    <div className="min-h-screen flex font-sans">
      {/* Left panel — corporate red */}
      <div className="hidden lg:flex w-[42%] flex-col relative overflow-hidden" style={{ backgroundColor: "#EC0000" }}>
        {/* Diagonal pattern overlay */}
        <div className="absolute inset-0 opacity-10">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="diag" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
                <line x1="0" y1="0" x2="0" y2="40" stroke="white" strokeWidth="12"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#diag)"/>
          </svg>
        </div>

        {/* Gradient orbs */}
        <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-20" style={{ background: "radial-gradient(circle, #ff4444, transparent)", transform: "translate(-30%, -30%)" }} />
        <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full opacity-15" style={{ background: "radial-gradient(circle, #ff6666, transparent)", transform: "translate(30%, 30%)" }} />

        <div className="relative z-10 flex flex-col items-center justify-center flex-1 px-12 text-center">
          <CrownDocumentIcon />

          <h1 className="text-4xl font-display font-extrabold text-white mt-10 leading-tight">
            Invoice Checker
          </h1>
          <p className="text-white/70 text-sm font-semibold tracking-widest uppercase mt-2 mb-8">
            Legal Department · Company HQ
          </p>

          <p className="text-white/85 text-base leading-relaxed max-w-xs">
            Automated platform for external legal invoice review with AI validation and incident management.
          </p>

          <div className="mt-10 space-y-3 w-full max-w-xs text-left">
            {[
              "Automatic rate validation against the law firm panel",
              "Savings analytics and excess identification by firm",
              "Workflow management and audit trail",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-white/20 border border-white/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
                <p className="text-white/80 text-sm leading-snug">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 px-12 pb-8 text-center">
          <p className="text-white/40 text-xs">© {new Date().getFullYear()} Invoice Checker. All rights reserved.</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex justify-end items-center px-8 py-5">
          <span className="text-sm text-gray-400 font-medium">GB English</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-4 h-4 rounded-sm flex items-center justify-center" style={{ backgroundColor: "#EC0000" }}>
                  <svg viewBox="0 0 8 8" className="w-3 h-3" fill="white">
                    <path d="M1 4 L3.5 6.5 L7 1.5" strokeWidth="1.5" stroke="white" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="text-lg font-display font-bold text-gray-900">Invoice Checker</span>
              </div>
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase ml-6">Legal Ops · HQ Platform</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-7 shadow-sm">
              <h2 className="text-xl font-display font-bold text-gray-900 mb-0.5">Sign in</h2>
              <p className="text-sm text-gray-400 mb-6">Sign in with your corporate credentials</p>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="email">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 transition-all"
                    {...form.register("email")}
                    disabled={loginMutation.isPending}
                  />
                  {form.formState.errors.email && (
                    <p className="text-xs text-red-600 mt-1">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPw ? "text" : "password"}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 transition-all pr-10"
                      {...form.register("password")}
                      disabled={loginMutation.isPending}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium"
                      tabIndex={-1}
                    >
                      {showPw ? "Hide" : "Show"}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-red-600 mt-1">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loginMutation.isPending}
                  className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-white text-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  style={{ backgroundColor: "#EC0000" }}
                  onMouseEnter={e => !loginMutation.isPending && ((e.target as HTMLButtonElement).style.backgroundColor = "#cc0000")}
                  onMouseLeave={e => ((e.target as HTMLButtonElement).style.backgroundColor = "#EC0000")}
                >
                  {loginMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Authenticating...</>
                  ) : "Sign in"}
                </button>
              </form>
            </div>

            <p className="text-center text-xs text-gray-400 mt-5">
              Restricted to authorised company personnel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
