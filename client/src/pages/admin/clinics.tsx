import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Building2, Search, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdminClinics() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orgs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/super-admin/orgs"],
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/super-admin/orgs", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/orgs"] });
      setShowCreate(false);
      setNewName("");
      toast({ title: "Clinic created", description: "The new organization is ready." });
    },
    onError: async (err: any) => {
      let msg = "Failed to create clinic";
      try { const j = await err.json?.(); msg = j?.error || msg; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const filtered = orgs.filter((o: any) =>
    o.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-clinics-title">All Clinics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{orgs.length} organizations on the platform</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-clinic" className="gap-2">
          <Plus className="h-4 w-4" />
          New Clinic
        </Button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search clinics..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-clinics"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Clinic</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Users</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Claims</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Last 30d</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Modules</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Setup</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((org: any, i: number) => (
                <tr key={org.id} className={`border-t hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`} data-testid={`row-clinic-${org.id}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium">{org.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {format(new Date(org.created_at), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-center">{org.user_count}</td>
                  <td className="px-4 py-3 text-center">{org.total_claims}</td>
                  <td className="px-4 py-3 text-center">{org.claims_last_30d ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {org.has_billing && <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Billing</Badge>}
                      {org.has_intake && <Badge variant="secondary" className="text-xs bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">Intake</Badge>}
                      {!org.has_billing && !org.has_intake && <span className="text-muted-foreground text-xs">None yet</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground">
                    {org.onboarding_steps}/6
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/clinics/${org.id}`}>
                      <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-view-${org.id}`}>
                        View
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No clinics found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create New Clinic Dialog */}
      <Dialog open={showCreate} onOpenChange={(v) => { setShowCreate(v); if (!v) setNewName(""); }}>
        <DialogContent className="max-w-md" data-testid="dialog-create-clinic">
          <DialogHeader>
            <DialogTitle>Create New Clinic</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="clinic-name">Clinic / Organization Name</Label>
              <Input
                id="clinic-name"
                placeholder="e.g. Sunrise Home Health"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) createMutation.mutate(newName.trim());
                }}
                data-testid="input-clinic-name"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                A unique ID will be generated automatically. You can add users and configure modules after creation.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewName(""); }} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-confirm-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Clinic"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
