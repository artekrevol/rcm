import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  Brain,
  Shield,
  Settings,
  LogOut,
  ArrowLeft,
  ScrollText,
  BarChart3,
  BookOpen,
  ClipboardList,
  ShieldCheck,
  UserCog,
  Radar,
  CreditCard,
  ListChecks,
  Building2,
  AlarmClock,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";

const billingNavItems = [
  { title: "Dashboard", url: "/billing/dashboard", icon: LayoutDashboard },
  { title: "My Practice", url: "/billing/clinic", icon: Building2, adminOnly: true },
  { title: "Patients", url: "/billing/patients", icon: Users },
  { title: "Claims", url: "/billing/claims", icon: FileText },
  { title: "Claim Tracker", url: "/billing/claim-tracker", icon: Radar },
  { title: "Follow-Up Queue", url: "/billing/follow-up", icon: ListChecks },
  { title: "Filing Alerts", url: "/billing/filing-alerts", icon: AlarmClock, badge: true },
  { title: "Prior Auth", url: "/billing/claims/prior-auth", icon: ShieldCheck },
  { title: "ERA Posting", url: "/billing/era", icon: CreditCard },
  { title: "Code Lookup", url: "/billing/codes", icon: BookOpen },
  { title: "Intelligence", url: "/billing/intelligence", icon: Brain },
  { title: "Activity Log", url: "/billing/intelligence/logs", icon: ScrollText, adminOnly: true },
  { title: "Compliance", url: "/billing/intelligence/reports", icon: ClipboardList, adminOnly: true },
  { title: "Rules", url: "/billing/rules", icon: Shield },
  { title: "Reports", url: "/billing/reports", icon: BarChart3 },
  { title: "Settings", url: "/billing/settings", icon: Settings },
  { title: "User Management", url: "/billing/settings/users", icon: UserCog, adminOnly: true },
];

export function BillingSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "BL";

  const { data: alertSummary } = useQuery<{ summary: Record<string, number> }>({
    queryKey: ["/api/billing/filing-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/billing/filing-alerts?page_size=1", { credentials: "include" });
      if (!res.ok) return { summary: {} };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const unacknowledgedCount = alertSummary?.summary
    ? Object.values(alertSummary.summary).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/billing/dashboard" className="flex items-center gap-3">
          <img
            src="/brand/logo_icon.png"
            alt="Claim Shield Health"
            className="h-10 w-10 rounded-lg object-contain"
          />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Claim Shield Health</h1>
            <p className="text-xs text-muted-foreground">Billing Module</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium uppercase tracking-wide">
            Billing
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {billingNavItems
                .filter((item) => !("adminOnly" in item && (item as any).adminOnly) || user?.role === "admin")
                .map((item) => {
                const hasBadge = (item as any).badge && unacknowledgedCount > 0;
                return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      location === item.url ||
                      (item.url !== "/billing/dashboard" && location.startsWith(item.url))
                    }
                  >
                    <Link href={item.url} data-testid={`nav-billing-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon className="h-5 w-5" />
                      <span className="flex-1">{item.title}</span>
                      {hasBadge && (
                        <Badge
                          className="bg-red-600 text-white text-[10px] h-4 min-w-4 px-1 ml-auto"
                          data-testid="badge-filing-alerts-count"
                        >
                          {unacknowledgedCount > 99 ? "99+" : unacknowledgedCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(user?.role === "admin" || user?.role === "super_admin") && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/" data-testid="nav-switch-module">
                      <ArrowLeft className="h-5 w-5" />
                      <span>Switch Module</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {user?.role === "super_admin" && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/admin" data-testid="nav-platform-admin">
                        <Shield className="h-5 w-5" />
                        <span>Platform Admin</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent p-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || "Billing User"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button onClick={() => logout()} data-testid="button-logout">
            <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
