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
import { useAuth } from "@/hooks/use-auth";

const billingNavItems = [
  { title: "Dashboard", url: "/billing/dashboard", icon: LayoutDashboard },
  { title: "Patients", url: "/billing/patients", icon: Users },
  { title: "Claims", url: "/billing/claims", icon: FileText },
  { title: "Prior Auth", url: "/billing/claims/prior-auth", icon: ShieldCheck },
  { title: "Code Lookup", url: "/billing/codes", icon: BookOpen },
  { title: "Intelligence", url: "/billing/intelligence", icon: Brain },
  { title: "Activity Log", url: "/billing/intelligence/logs", icon: ScrollText, adminOnly: true },
  { title: "Compliance", url: "/billing/intelligence/reports", icon: ClipboardList, adminOnly: true },
  { title: "Rules", url: "/billing/rules", icon: Shield },
  { title: "Reports", url: "/billing/reports", icon: BarChart3 },
  { title: "Settings", url: "/billing/settings", icon: Settings },
  { title: "User Management", url: "/billing/settings/users", icon: UserCog, adminOnly: true },
] as const;

export function BillingSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "BL";

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
                .filter((item) => !("adminOnly" in item && item.adminOnly) || user?.role === "admin")
                .map((item) => (
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
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "admin" && (
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
