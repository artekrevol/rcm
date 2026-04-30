import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  MessageCircle,
  CalendarDays,
  LogOut,
  ShieldCheck,
  ArrowLeft,
  Workflow,
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

const intakeNavItems = [
  { title: "Dashboard", url: "/intake/dashboard", icon: LayoutDashboard },
  { title: "Chat Analytics", url: "/intake/lead-analytics", icon: MessageCircle },
  { title: "Lead Worklist", url: "/intake/deals", icon: Users },
  { title: "Flows", url: "/intake/flows", icon: Workflow },
  { title: "Scheduling", url: "/intake/scheduling", icon: CalendarDays },
];

export function IntakeSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "IN";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/intake/dashboard" className="flex items-center gap-3">
          <img
            src="/brand/logo_icon.png"
            alt="Claim Shield Health"
            className="h-10 w-10 rounded-lg object-contain"
          />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Claim Shield Health</h1>
            <p className="text-xs text-muted-foreground">Intake Module</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium uppercase tracking-wide">
            Intake
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {intakeNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      location === item.url ||
                      (item.url !== "/intake/dashboard" && location.startsWith(item.url))
                    }
                  >
                    <Link href={item.url} data-testid={`nav-intake-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
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
            <p className="text-sm font-medium truncate">{user?.name || "Intake User"}</p>
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
