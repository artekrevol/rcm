import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Building2,
  LogOut,
  Shield,
  BookOpen,
  Wrench,
  Database,
  Radio,
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
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";

function AdminSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const { data: orgs = [] } = useQuery<any[]>({
    queryKey: ["/api/super-admin/orgs"],
  });

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "SA";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/admin" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Claim Shield Health</h1>
            <p className="text-xs text-muted-foreground">Platform Admin</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium uppercase tracking-wide">
            Platform
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin"}>
                  <Link href="/admin" data-testid="nav-admin-overview">
                    <LayoutDashboard className="h-5 w-5" />
                    <span>Platform Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin/clinics"}>
                  <Link href="/admin/clinics" data-testid="nav-admin-clinics">
                    <Building2 className="h-5 w-5" />
                    <span>All Clinics</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin/payer-manuals"}>
                  <Link href="/admin/payer-manuals" data-testid="nav-admin-payer-manuals">
                    <BookOpen className="h-5 w-5" />
                    <span>Payer Manuals</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin/rules-database"}>
                  <Link href="/admin/rules-database" data-testid="nav-admin-rules-database">
                    <Database className="h-5 w-5" />
                    <span>Rules Database</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin/data-tools"}>
                  <Link href="/admin/data-tools" data-testid="nav-admin-data-tools">
                    <Wrench className="h-5 w-5" />
                    <span>Data Tools</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin/scrapers"}>
                  <Link href="/admin/scrapers" data-testid="nav-admin-scrapers">
                    <Radio className="h-5 w-5" />
                    <span>Crawler Engine</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {orgs.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium uppercase tracking-wide">
              Clinics
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {orgs.map((org: any) => (
                  <SidebarMenuItem key={org.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === `/admin/clinics/${org.id}`}
                    >
                      <Link href={`/admin/clinics/${org.id}`} data-testid={`nav-clinic-${org.id}`}>
                        <Building2 className="h-4 w-4" />
                        <span className="truncate">{org.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
            <p className="text-sm font-medium truncate">{user?.name || "Super Admin"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button onClick={() => logout()} data-testid="button-logout-admin">
            <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

const style = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3.5rem",
};

export function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-admin-sidebar-toggle" />
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
