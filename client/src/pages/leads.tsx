import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LeadStatusBadge } from "@/components/status-badge";
import { CallModal } from "@/components/call-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Plus, Phone, User, Search, Filter, LayoutList, LayoutGrid, 
  MoreHorizontal, CheckCircle, XCircle, UserPlus, Clock
} from "lucide-react";
import { format } from "date-fns";
import type { Lead, InsertLead } from "@shared/schema";

const leadSources = ["website", "referral", "phone", "marketing", "physician_referral", "insurance_portal"];

type WorklistResponse = {
  rows: Lead[];
  countsByQueue: Record<string, number>;
  total: number;
  page: number;
  pageSize: number;
};

const queues = [
  { id: "all", label: "All Leads" },
  { id: "sla_breach", label: "SLA Breach", priority: "P0" },
  { id: "not_contacted", label: "Not Contacted" },
  { id: "incomplete_vob", label: "Incomplete VOB" },
  { id: "vob_complete_needs_admissions", label: "VOB Complete" },
  { id: "follow_up_today", label: "Follow-up Today" },
];

function PriorityBadge({ priority }: { priority: string }) {
  const variants: Record<string, string> = {
    P0: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0",
    P1: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0",
    P2: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-0",
  };
  return (
    <Badge variant="outline" className={variants[priority] || variants.P2}>
      {priority}
    </Badge>
  );
}

function VobScoreChip({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <Progress value={score} className="h-2 w-16" />
      <span className="text-xs text-muted-foreground">{score}%</span>
    </div>
  );
}

export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQueue, setActiveQueue] = useState("all");
  const [viewMode, setViewMode] = useState<"worklist" | "board">(() => {
    return (localStorage.getItem("leadsView") as "worklist" | "board") || "worklist";
  });

  const [newLead, setNewLead] = useState<Partial<InsertLead>>({
    name: "",
    phone: "",
    email: "",
    source: "website",
    status: "new",
  });

  useEffect(() => {
    localStorage.setItem("leadsView", viewMode);
  }, [viewMode]);

  const { data: worklistData, isLoading, error } = useQuery<WorklistResponse>({
    queryKey: ["/api/leads/worklist", activeQueue],
    queryFn: async () => {
      const res = await fetch(`/api/leads/worklist?queue=${activeQueue}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch worklist: ${res.status}`);
      }
      return res.json();
    },
  });

  const { data: allLeads } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    enabled: viewMode === "board",
  });

  const createLeadMutation = useMutation({
    mutationFn: async (lead: InsertLead) => {
      return apiRequest("POST", "/api/leads", lead);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      setCreateOpen(false);
      setNewLead({ name: "", phone: "", email: "", source: "website", status: "new" });
      toast({ title: "Lead created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create lead", variant: "destructive" });
    },
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Lead> }) => {
      return apiRequest("PATCH", `/api/leads/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      toast({ title: "Lead updated" });
    },
    onError: () => {
      toast({ title: "Failed to update lead", variant: "destructive" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      toast({ title: "Call saved successfully" });
    }
  };

  const handleQuickAction = (lead: Lead, action: string) => {
    switch (action) {
      case "mark_contacted":
        updateLeadMutation.mutate({
          id: lead.id,
          updates: { 
            status: "contacted",
            lastContactedAt: new Date().toISOString(),
            attemptCount: (lead.attemptCount || 0) + 1
          } as any
        });
        break;
      case "mark_qualified":
        updateLeadMutation.mutate({ id: lead.id, updates: { status: "qualified" } });
        break;
      case "mark_lost":
        updateLeadMutation.mutate({ id: lead.id, updates: { status: "lost" } });
        break;
      case "call":
        setSelectedLead(lead);
        setCallModalOpen(true);
        break;
    }
  };

  const filteredLeads = (worklistData?.rows || []).filter((lead) => {
    if (!searchQuery) return true;
    return (
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.phone.includes(searchQuery) ||
      lead.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const leadStatuses = ["new", "contacted", "qualified", "unqualified", "converted"];
  const boardLeads = allLeads?.filter((lead) => {
    if (!searchQuery) return true;
    return (
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.phone.includes(searchQuery)
    );
  });

  const leadsByStatus = leadStatuses.reduce((acc, status) => {
    acc[status] = boardLeads?.filter((l) => l.status === status) || [];
    return acc;
  }, {} as Record<string, Lead[]>);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Manage intake leads and VOB workflow
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "worklist" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1 rounded-r-none"
              onClick={() => setViewMode("worklist")}
              data-testid="button-view-worklist"
            >
              <LayoutList className="h-4 w-4" />
              Worklist
            </Button>
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1 rounded-l-none"
              onClick={() => setViewMode("board")}
              data-testid="button-view-board"
            >
              <LayoutGrid className="h-4 w-4" />
              Board
            </Button>
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
                <DialogDescription>Add a new intake lead</DialogDescription>
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
                          {source.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
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
      </div>

      {viewMode === "worklist" && (
        <>
          {/* Queue Tabs */}
          <div className="flex items-center gap-4 overflow-x-auto pb-2">
            <Tabs value={activeQueue} onValueChange={setActiveQueue}>
              <TabsList className="h-9">
                {queues.map((queue) => (
                  <TabsTrigger
                    key={queue.id}
                    value={queue.id}
                    className="gap-2 text-sm"
                    data-testid={`tab-queue-${queue.id}`}
                  >
                    {queue.priority && (
                      <span className={queue.priority === "P0" ? "text-red-500" : ""}>
                        {queue.priority}
                      </span>
                    )}
                    {queue.label}
                    {worklistData?.countsByQueue[queue.id] !== undefined && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                        {worklistData.countsByQueue[queue.id]}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Search */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9"
                data-testid="input-search-leads"
              />
            </div>
          </div>

          {/* Worklist Table */}
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[200px]">Lead</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Next Action</TableHead>
                      <TableHead>Last Outcome</TableHead>
                      <TableHead className="text-center">Attempts</TableHead>
                      <TableHead>VOB</TableHead>
                      <TableHead>Insurance</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeads.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                          No leads in this queue
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLeads.map((lead) => (
                        <TableRow
                          key={lead.id}
                          className="cursor-pointer group"
                          onClick={() => setLocation(`/leads/${lead.id}`)}
                          data-testid={`row-lead-${lead.id}`}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <User className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{lead.name}</p>
                                <p className="text-xs text-muted-foreground">{lead.phone}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <LeadStatusBadge status={lead.status} />
                          </TableCell>
                          <TableCell>
                            <PriorityBadge priority={lead.priority || "P2"} />
                          </TableCell>
                          <TableCell>
                            {lead.nextAction ? (
                              <Badge variant="outline" className="font-normal">
                                {lead.nextAction}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {lead.lastOutcome || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-sm">{lead.attemptCount || 0}</span>
                          </TableCell>
                          <TableCell>
                            <VobScoreChip score={lead.vobScore || 0} />
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <p className="truncate max-w-[120px]">
                                {lead.insuranceCarrier || "—"}
                              </p>
                              {lead.planType && (
                                <p className="text-xs text-muted-foreground">{lead.planType}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">{lead.serviceNeeded || "—"}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {format(new Date(lead.createdAt), "MMM d")}
                            </span>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 opacity-0 group-hover:opacity-100"
                                  data-testid={`button-actions-${lead.id}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleQuickAction(lead, "call")}>
                                  <Phone className="h-4 w-4 mr-2" />
                                  Call
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleQuickAction(lead, "mark_contacted")}>
                                  <Clock className="h-4 w-4 mr-2" />
                                  Mark Contacted
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleQuickAction(lead, "mark_qualified")}>
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Mark Qualified
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleQuickAction(lead, "mark_lost")}>
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Mark Lost
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {viewMode === "board" && (
        <>
          {/* Search for board view */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-leads-board"
              />
            </div>
          </div>

          {/* Board View */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {leadStatuses.map((status) => (
              <div key={status} className="space-y-3">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-sm font-medium capitalize">{status}</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {leadsByStatus[status]?.length || 0}
                  </span>
                </div>
                <div className="space-y-3 min-h-[200px]">
                  {leadsByStatus[status]?.map((lead) => (
                    <Card
                      key={lead.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => setLocation(`/leads/${lead.id}`)}
                      data-testid={`lead-card-${lead.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{lead.name}</p>
                            <p className="text-xs text-muted-foreground">{lead.phone}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <PriorityBadge priority={lead.priority || "P2"} />
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(lead.createdAt), "MMM d")}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selectedLead && (
        <CallModal
          open={callModalOpen}
          onOpenChange={setCallModalOpen}
          leadId={selectedLead.id}
          leadName={selectedLead.name}
          leadPhone={selectedLead.phone}
          onCallComplete={handleCallComplete}
        />
      )}
    </div>
  );
}
