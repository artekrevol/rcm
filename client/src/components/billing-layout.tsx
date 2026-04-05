import { BillingSidebar } from "@/components/billing-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Link } from "wouter";

const style = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3.5rem",
};

export function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <BillingSidebar />
        <div className="flex flex-col flex-1 min-w-0">
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
