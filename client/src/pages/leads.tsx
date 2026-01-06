import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/status-badge";
import { CallModal } from "@/components/call-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Phone, User, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import type { Lead, InsertLead } from "@shared/schema";

const leadStatuses = ["new", "contacted", "qualified", "unqualified", "converted"];
const leadSources = ["website", "referral", "phone", "event", "other"];

export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [newLead, setNewLead] = useState<Partial<InsertLead>>({
    name: "",
    phone: "",
    email: "",
    source: "website",
    status: "new",
  });

  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const createLeadMutation = useMutation({
    mutationFn: async (lead: InsertLead) => {
      return apiRequest("POST", "/api/leads", lead);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setCreateOpen(false);
      setNewLead({ name: "", phone: "", email: "", source: "website", status: "new" });
      toast({ title: "Lead created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create lead", variant: "destructive" });
    },
  });

  const handleCreateLead = () => {
    if (!newLead.name || !newLead.phone) {
      toast({ title: "Please fill required fields", variant: "destructive" });
      return;
    }
    createLeadMutation.mutate(newLead as InsertLead);
  };

  const handleCallComplete = async (data: any) => {
    if (selectedLead) {
      await apiRequest("POST", `/api/leads/${selectedLead.id}/call`, data);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Call saved successfully" });
    }
  };

  const filteredLeads = leads?.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.phone.includes(searchQuery) ||
      lead.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const leadsByStatus = leadStatuses.reduce((acc, status) => {
    acc[status] = filteredLeads?.filter((l) => l.status === status) || [];
    return acc;
  }, {} as Record<string, Lead[]>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold">Leads</h1>
          <p className="text-muted-foreground mt-1">
            Manage intake leads and initiate VOB calls
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-lead">
              <Plus className="h-4 w-4" />
              New Lead
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Lead</DialogTitle>
              <DialogDescription>
                Add a new intake lead to the system
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={newLead.name}
                  onChange={(e) => setNewLead({ ...newLead, name: e.target.value })}
                  placeholder="John Smith"
                  data-testid="input-lead-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  value={newLead.phone}
                  onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  data-testid="input-lead-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={newLead.email || ""}
                  onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                  placeholder="john@example.com"
                  data-testid="input-lead-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <Select
                  value={newLead.source}
                  onValueChange={(v) => setNewLead({ ...newLead, source: v })}
                >
                  <SelectTrigger data-testid="select-lead-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {leadSources.map((source) => (
                      <SelectItem key={source} value={source}>
                        {source.charAt(0).toUpperCase() + source.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateLead}
                disabled={createLeadMutation.isPending}
                data-testid="button-submit-lead"
              >
                Create Lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-leads"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {leadStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {leadStatuses.map((status) => (
            <Card key={status}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {leadStatuses.map((status) => (
            <div key={status} className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-sm font-medium capitalize">{status}</h3>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {leadsByStatus[status].length}
                </span>
              </div>
              <div className="space-y-3 min-h-[200px]">
                {leadsByStatus[status].map((lead) => (
                  <Card
                    key={lead.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setLocation(`/leads/${lead.id}`)}
                    data-testid={`lead-card-${lead.id}`}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{lead.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {lead.phone}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground capitalize">
                          {lead.source}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(lead.createdAt), "MMM d")}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLead(lead);
                          setCallModalOpen(true);
                        }}
                        data-testid={`button-call-${lead.id}`}
                      >
                        <Phone className="h-3 w-3" />
                        Call with AI
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {leadsByStatus[status].length === 0 && (
                  <div className="h-24 border border-dashed rounded-lg flex items-center justify-center">
                    <p className="text-xs text-muted-foreground">No leads</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedLead && (
        <CallModal
          open={callModalOpen}
          onOpenChange={setCallModalOpen}
          leadName={selectedLead.name}
          leadPhone={selectedLead.phone}
          onCallComplete={handleCallComplete}
        />
      )}
    </div>
  );
}
