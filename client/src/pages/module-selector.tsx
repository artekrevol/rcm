import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { FileText, Users, Loader2, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const modules = [
  {
    id: "billing",
    title: "Billing",
    description: "Claims, patients, HCPCS codes, denial intelligence, and reporting",
    icon: FileText,
    href: "/billing/dashboard",
    roles: ["admin", "rcm_manager"],
  },
  {
    id: "intake",
    title: "Intake",
    description: "Lead management, AI calling, chat widget, VOB, and scheduling",
    icon: Users,
    href: "/intake/dashboard",
    roles: ["admin", "intake"],
  },
  {
    id: "platform-admin",
    title: "Platform Admin",
    description: "Monitor all clinics, usage, and billing health across the platform",
    icon: Shield,
    href: "/admin",
    roles: ["super_admin"],
  },
];

export default function ModuleSelector() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth/login" />;
  }

  const available = modules.filter((m) => m.roles.includes(user.role));

  if (available.length === 1) {
    return <Redirect to={available[0].href} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-semibold">Welcome, {user.name}</h1>
          <p className="text-muted-foreground mt-2">Select a module to get started</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {available.map((mod) => (
            <a key={mod.id} href={mod.href} data-testid={`card-module-${mod.id}`}>
              <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <mod.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{mod.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{mod.description}</CardDescription>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
