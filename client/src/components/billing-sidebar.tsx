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
  Sparkles,
  ChevronRight,
  SlidersHorizontal,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";

const claimsChildren = [
  { title: "Smart Claim", url: "/billing/claims/smart-new", icon: Sparkles },
  { title: "Claim Tracker", url: "/billing/claim-tracker", icon: Radar },
  { title: "Follow-Up Queue", url: "/billing/follow-up", icon: ListChecks },
];

const intelligenceChildren = [
  { title: "Reports", url: "/billing/reports", icon: BarChart3 },
  { title: "Activity Log", url: "/billing/intelligence/logs", icon: ScrollText, adminOnly: true },
  { title: "Compliance", url: "/billing/intelligence/reports", icon: ClipboardList, adminOnly: true },
];

const adminChildren = [
  { title: "My Practice", url: "/billing/clinic", icon: Building2 },
  { title: "Rules", url: "/billing/rules", icon: Shield },
  { title: "Settings", url: "/billing/settings", icon: Settings },
  { title: "User Management", url: "/billing/settings/users", icon: UserCog },
];

export function BillingSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

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

  const claimsOpen =
    location === "/billing/claims" ||
    claimsChildren.some((c) => location.startsWith(c.url));

  const intelligenceOpen =
    location === "/billing/intelligence" ||
    intelligenceChildren.some((c) => location.startsWith(c.url));

  const adminOpen = adminChildren.some((c) => location.startsWith(c.url));

  const isActive = (url: string, exact = false) =>
    exact ? location === url : location === url || location.startsWith(url);

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

              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/billing/dashboard", true)}>
                  <Link href="/billing/dashboard" data-testid="nav-billing-dashboard">
                    <LayoutDashboard className="h-5 w-5" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Patients */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/billing/patients")}>
                  <Link href="/billing/patients" data-testid="nav-billing-patients">
                    <Users className="h-5 w-5" />
                    <span>Patients</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Claims — collapsible */}
              <Collapsible defaultOpen={claimsOpen} className="group/claims">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      isActive={isActive("/billing/claims")}
                      data-testid="nav-billing-claims"
                    >
                      <FileText className="h-5 w-5" />
                      <span className="flex-1">Claims</span>
                      <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/claims:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {claimsChildren.map((item) => (
                        <SidebarMenuSubItem key={item.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive(item.url)}
                          >
                            <Link
                              href={item.url}
                              data-testid={`nav-billing-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Filing Alerts */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/billing/filing-alerts")}>
                  <Link href="/billing/filing-alerts" data-testid="nav-billing-filing-alerts">
                    <AlarmClock className="h-5 w-5" />
                    <span className="flex-1">Filing Alerts</span>
                    {unacknowledgedCount > 0 && (
                      <Badge
                        className="bg-red-600 text-white text-[10px] h-4 min-w-4 px-1"
                        data-testid="badge-filing-alerts-count"
                      >
                        {unacknowledgedCount > 99 ? "99+" : unacknowledgedCount}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Prior Auth */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/billing/claims/prior-auth")}>
                  <Link href="/billing/claims/prior-auth" data-testid="nav-billing-prior-auth">
                    <ShieldCheck className="h-5 w-5" />
                    <span>Prior Auth</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* ERA Posting */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/billing/era")}>
                  <Link href="/billing/era" data-testid="nav-billing-era-posting">
                    <CreditCard className="h-5 w-5" />
                    <span>ERA Posting</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Code Lookup */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/billing/codes")}>
                  <Link href="/billing/codes" data-testid="nav-billing-code-lookup">
                    <BookOpen className="h-5 w-5" />
                    <span>Code Lookup</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Intelligence — collapsible */}
              <Collapsible defaultOpen={intelligenceOpen} className="group/intel">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      isActive={isActive("/billing/intelligence")}
                      data-testid="nav-billing-intelligence"
                    >
                      <Brain className="h-5 w-5" />
                      <span className="flex-1">Intelligence</span>
                      <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/intel:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {intelligenceChildren
                        .filter((c) => !c.adminOnly || isAdmin)
                        .map((item) => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isActive(item.url)}
                            >
                              <Link
                                href={item.url}
                                data-testid={`nav-billing-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                              >
                                <item.icon className="h-4 w-4" />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Admin — collapsible, admin only */}
              {isAdmin && (
                <Collapsible defaultOpen={adminOpen} className="group/admin">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={adminChildren.some((c) => isActive(c.url))}
                        data-testid="nav-billing-admin"
                      >
                        <SlidersHorizontal className="h-5 w-5" />
                        <span className="flex-1">Admin</span>
                        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/admin:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {adminChildren.map((item) => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isActive(item.url)}
                            >
                              <Link
                                href={item.url}
                                data-testid={`nav-billing-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                              >
                                <item.icon className="h-4 w-4" />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
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
