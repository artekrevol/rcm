import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [location, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Redirect to="/auth/login" />;
  }

  if (allowedRoles && user.role !== "super_admin" && !allowedRoles.includes(user.role)) {
    const isAdminRoute = location.startsWith("/admin");

    if (isAdminRoute) {
      return (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <ShieldOff className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <h1 className="text-2xl font-semibold mb-2">Platform Administration</h1>
            <p className="text-muted-foreground mb-6">
              This area is restricted to ClaimShield platform administrators. If you need access, contact your administrator.
            </p>
            <Button variant="outline" onClick={() => navigate("/billing/dashboard")}>
              ← Back to Billing
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldOff className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold mb-2">Access Restricted</h1>
          <p className="text-muted-foreground mb-6">
            This area requires elevated permissions. Your current role ({user.role?.replace(/_/g, " ")}) does not have access to this section. Contact your administrator to request access.
          </p>
          <Button variant="outline" onClick={() => window.history.back()}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
