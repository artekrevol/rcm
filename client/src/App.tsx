import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthGuard } from "@/components/auth-guard";
import { IntakeLayout } from "@/components/intake-layout";
import { BillingLayout } from "@/components/billing-layout";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import ModuleSelector from "@/pages/module-selector";

import DashboardPage from "@/pages/dashboard";
import DealsPage from "@/pages/deals";
import DealDetailPage from "@/pages/deal-detail";
import LeadAnalyticsPage from "@/pages/lead-analytics";

import BillingDashboard from "@/pages/billing/dashboard";
import PatientList from "@/pages/billing/patient-list";
import PatientCreate from "@/pages/billing/patient-create";
import PatientDetail from "@/pages/billing/patient-detail";
import BillingHcpcs from "@/pages/billing/hcpcs";
import ClaimWizard from "@/pages/billing/claim-wizard";
import BillingSettings from "@/pages/billing/settings";
import BillingReports from "@/pages/billing/reports";
import ActivityLogPage from "@/pages/billing/activity-log";
import ComplianceReportsPage from "@/pages/billing/compliance-reports";
import ClaimsPage from "@/pages/claims";
import ClaimDetailPage from "@/pages/claim-detail";
import IntelligencePage from "@/pages/intelligence";
import RulesPage from "@/pages/rules";

function Router() {
  return (
    <Switch>
      <Route path="/">
        <AuthGuard>
          <ModuleSelector />
        </AuthGuard>
      </Route>

      <Route path="/auth/login" component={LoginPage} />

      {/* Legacy redirect */}
      <Route path="/login">
        <Redirect to="/auth/login" />
      </Route>

      {/* ===== INTAKE MODULE ===== */}
      <Route path="/intake/dashboard">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout><DashboardPage /></IntakeLayout>
        </AuthGuard>
      </Route>
      <Route path="/intake/deals/:id">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout><DealDetailPage /></IntakeLayout>
        </AuthGuard>
      </Route>
      <Route path="/intake/deals">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout><DealsPage /></IntakeLayout>
        </AuthGuard>
      </Route>
      <Route path="/intake/lead-analytics">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout><LeadAnalyticsPage /></IntakeLayout>
        </AuthGuard>
      </Route>
      <Route path="/intake/scheduling">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout>
            <div className="p-6">
              <h1 className="text-2xl font-semibold" data-testid="text-page-title">Scheduling</h1>
              <p className="text-muted-foreground mt-1">Appointment management and availability</p>
            </div>
          </IntakeLayout>
        </AuthGuard>
      </Route>

      {/* ===== BILLING MODULE ===== */}
      <Route path="/billing/dashboard">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><BillingDashboard /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/patients/new">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><PatientCreate /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/patients/:id">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><PatientDetail /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/patients">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><PatientList /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/claims/new">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ClaimWizard /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/claims/:id">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ClaimDetailPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/claims">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ClaimsPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/codes">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><BillingHcpcs /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/intelligence/logs">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ActivityLogPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/intelligence/reports">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ComplianceReportsPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/intelligence">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><IntelligencePage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/rules">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><RulesPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/reports">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><BillingReports /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/settings">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><BillingSettings /></BillingLayout>
        </AuthGuard>
      </Route>

      {/* Legacy route redirects */}
      <Route path="/dashboard">
        <Redirect to="/" />
      </Route>
      <Route path="/deals/:id">
        {(params) => <Redirect to={`/intake/deals/${params.id}`} />}
      </Route>
      <Route path="/deals">
        <Redirect to="/intake/deals" />
      </Route>
      <Route path="/claims/:id">
        {(params) => <Redirect to={`/billing/claims/${params.id}`} />}
      </Route>
      <Route path="/claims">
        <Redirect to="/billing/claims" />
      </Route>
      <Route path="/intelligence">
        <Redirect to="/billing/intelligence" />
      </Route>
      <Route path="/rules">
        <Redirect to="/billing/rules" />
      </Route>
      <Route path="/lead-analytics">
        <Redirect to="/intake/lead-analytics" />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="claim-shield-health-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
