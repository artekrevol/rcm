import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  Brain,
  Shield,
  LogOut,
  ShieldCheck,
  MessageCircle,
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

const mainNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Lead Analytics", url: "/lead-analytics", icon: MessageCircle },
  { title: "Deals", url: "/deals", icon: Users },
  { title: "Claims", url: "/claims", icon: FileText },
  { title: "Intelligence", url: "/intelligence", icon: Brain },
  { title: "Rules", url: "/rules", icon: Shield },
];


export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <img 
            src="/brand/logo_icon.png" 
            alt="Claim Shield Health" 
            className="h-10 w-10 rounded-lg object-contain"
          />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Claim Shield Health</h1>
            <p className="text-xs text-muted-foreground">RCM Platform</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium uppercase tracking-wide">
            Main
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.url !== "/dashboard" && location.startsWith(item.url))}
                  >
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase()}`}>
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent p-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm">
              RCM
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">RCM Admin</p>
            <p className="text-xs text-muted-foreground truncate">admin@claimshield.health</p>
          </div>
          <Link href="/login">
            <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer" data-testid="button-logout" />
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
