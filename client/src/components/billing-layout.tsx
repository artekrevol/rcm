import { BillingSidebar } from "@/components/billing-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Plus, UserCheck, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const style = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3.5rem",
};

function ImpersonationBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/super-admin/stop-impersonate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      window.location.href = "/admin/clinics";
    },
  });

  if (!user?.impersonatingOrgId) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500 text-white text-sm font-medium"
      data-testid="banner-impersonation"
    >
      <div className="flex items-center gap-2">
        <UserCheck className="h-4 w-4 flex-shrink-0" />
        <span>
          Impersonating <strong>{user.impersonatingOrgName}</strong> — you are acting on behalf of this clinic
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-white hover:bg-amber-600 hover:text-white gap-1"
        data-testid="button-stop-impersonating"
        onClick={() => stopMutation.mutate()}
        disabled={stopMutation.isPending}
      >
        <X className="h-3.5 w-3.5" />
        {stopMutation.isPending ? "Stopping..." : "Stop Impersonating"}
      </Button>
    </div>
  );
}

export function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <BillingSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <ImpersonationBanner />
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link href="/billing/claims/new">
                <Button size="sm" className="gap-1.5" data-testid="button-new-claim-header">
                  <Plus className="h-4 w-4" />
                  New Claim
                </Button>
              </Link>
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-muted/30">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
