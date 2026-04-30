import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthGuard } from "@/components/auth-guard";
import { IntakeLayout } from "@/components/intake-layout";
import { BillingLayout } from "@/components/billing-layout";
import { AdminLayout } from "@/components/admin-layout";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import ModuleSelector from "@/pages/module-selector";
import AdminOverview from "@/pages/admin/overview";
import AdminClinics from "@/pages/admin/clinics";
import ClinicDetail from "@/pages/admin/clinic-detail";
import PayerManualsPage from "@/pages/admin/payer-manuals";
import DataToolsPage from "@/pages/admin/data-tools";
import RulesDatabasePage from "@/pages/admin/rules-database";
import ClinicHome from "@/pages/billing/clinic-home";

import IntakeDashboard from "@/pages/intake/dashboard";
import FlowsPage from "@/pages/intake/flows";
import FlowDetailPage from "@/pages/intake/flow-detail";
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
import PriorAuthPage from "@/pages/billing/prior-auth";
import ActivityLogPage from "@/pages/billing/activity-log";
import ComplianceReportsPage from "@/pages/billing/compliance-reports";
import UserManagement from "@/pages/billing/user-management";
import ClaimsPage from "@/pages/claims";
import ClaimDetailPage from "@/pages/claim-detail";
import IntelligencePage from "@/pages/intelligence";
import RulesPage from "@/pages/rules";
import ClaimTrackerPage from "@/pages/billing/claim-tracker";
import ERAPage from "@/pages/billing/era";
import FollowUpPage from "@/pages/billing/follow-up";
import FilingAlertsPage from "@/pages/billing/filing-alerts";

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
          <IntakeLayout><IntakeDashboard /></IntakeLayout>
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
      <Route path="/intake/flows/:id">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout><FlowDetailPage /></IntakeLayout>
        </AuthGuard>
      </Route>
      <Route path="/intake/flows">
        <AuthGuard allowedRoles={["admin", "intake"]}>
          <IntakeLayout><FlowsPage /></IntakeLayout>
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

      {/* ===== ADMIN MODULE ===== */}
      <Route path="/admin/clinics/:orgId">
        <AuthGuard allowedRoles={["super_admin"]}>
          <AdminLayout><ClinicDetail /></AdminLayout>
        </AuthGuard>
      </Route>
      <Route path="/admin/clinics">
        <AuthGuard allowedRoles={["super_admin"]}>
          <AdminLayout><AdminClinics /></AdminLayout>
        </AuthGuard>
      </Route>
      <Route path="/admin/payer-manuals">
        <AuthGuard allowedRoles={["super_admin"]}>
          <AdminLayout><PayerManualsPage /></AdminLayout>
        </AuthGuard>
      </Route>
      <Route path="/admin/rules-database">
        <AuthGuard allowedRoles={["super_admin"]}>
          <RulesDatabasePage />
        </AuthGuard>
      </Route>
      <Route path="/admin/data-tools">
        <AuthGuard allowedRoles={["super_admin"]}>
          <DataToolsPage />
        </AuthGuard>
      </Route>
      <Route path="/admin">
        <AuthGuard allowedRoles={["super_admin"]}>
          <AdminLayout><AdminOverview /></AdminLayout>
        </AuthGuard>
      </Route>

      {/* ===== BILLING MODULE ===== */}
      <Route path="/billing/clinic">
        <AuthGuard allowedRoles={["admin"]}>
          <BillingLayout><ClinicHome /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/my-practice">
        <AuthGuard allowedRoles={["admin"]}>
          <BillingLayout><ClinicHome /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/practice">
        <AuthGuard allowedRoles={["admin"]}>
          <BillingLayout><ClinicHome /></BillingLayout>
        </AuthGuard>
      </Route>
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
      <Route path="/billing/claims/prior-auth">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><PriorAuthPage /></BillingLayout>
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
      <Route path="/billing/claim-tracker">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ClaimTrackerPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/follow-up">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><FollowUpPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/filing-alerts">
        <AuthGuard allowedRoles={["admin", "rcm_manager", "biller"]}>
          <BillingLayout><FilingAlertsPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/era">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><ERAPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/codes">
        <AuthGuard allowedRoles={["admin", "rcm_manager"]}>
          <BillingLayout><BillingHcpcs /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/intelligence/logs">
        <AuthGuard allowedRoles={["admin"]}>
          <BillingLayout><ActivityLogPage /></BillingLayout>
        </AuthGuard>
      </Route>
      <Route path="/billing/intelligence/reports">
        <AuthGuard allowedRoles={["admin"]}>
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
      <Route path="/billing/settings/users">
        <AuthGuard allowedRoles={["admin"]}>
          <BillingLayout><UserManagement /></BillingLayout>
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
