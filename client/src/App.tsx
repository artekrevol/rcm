import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import { GuidedChatWidget } from "@/components/guided-chat-widget";
import DashboardPage from "@/pages/dashboard";
import LeadsPage from "@/pages/leads";
import LeadDetailPage from "@/pages/lead-detail";
import ClaimsPage from "@/pages/claims";
import ClaimDetailPage from "@/pages/claim-detail";
import IntelligencePage from "@/pages/intelligence";
import RulesPage from "@/pages/rules";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
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

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/login" component={LoginPage} />
      <Route path="/dashboard">
        <AuthenticatedLayout>
          <DashboardPage />
        </AuthenticatedLayout>
      </Route>
      <Route path="/leads">
        <AuthenticatedLayout>
          <LeadsPage />
        </AuthenticatedLayout>
      </Route>
      <Route path="/leads/:id">
        <AuthenticatedLayout>
          <LeadDetailPage />
        </AuthenticatedLayout>
      </Route>
      <Route path="/claims">
        <AuthenticatedLayout>
          <ClaimsPage />
        </AuthenticatedLayout>
      </Route>
      <Route path="/claims/:id">
        <AuthenticatedLayout>
          <ClaimDetailPage />
        </AuthenticatedLayout>
      </Route>
      <Route path="/intelligence">
        <AuthenticatedLayout>
          <IntelligencePage />
        </AuthenticatedLayout>
      </Route>
      <Route path="/rules">
        <AuthenticatedLayout>
          <RulesPage />
        </AuthenticatedLayout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="claimshield-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
          <GuidedChatWidget />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
