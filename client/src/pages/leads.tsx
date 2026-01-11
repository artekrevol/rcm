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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Plus, Phone, User, Search, Filter, LayoutList, LayoutGrid, 
  MoreHorizontal, CheckCircle, XCircle, UserPlus, Clock, AlertTriangle,
  PhoneCall, PhoneForwarded, FileCheck, FileText, Send, Ban
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { Lead, InsertLead, Call } from "@shared/schema";

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

function VobCompletenessChip({ score, missingFields }: { score: number; missingFields?: string[] }) {
  const missing = missingFields || [];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 cursor-help">
          <Progress value={score} className="h-2 w-16" />
          <span className="text-xs text-muted-foreground">{score}%</span>
          {missing.length > 0 && (
            <AlertTriangle className="h-3 w-3 text-amber-500" />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          {missing.length > 0 ? (
            <div>
              <p className="font-medium mb-1">Missing:</p>
              <ul className="list-disc pl-3 space-y-0.5">
                {missing.map((field, i) => (
                  <li key={i}>{field}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-emerald-500">VOB Complete</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function NextActionBadge({ actionType, dueAt }: { actionType?: string; dueAt?: string | Date | null }) {
  const actionConfig: Record<string, { label: string; icon: typeof PhoneCall; variant: "destructive" | "warning" | "success" | "default" }> = {
    call: { label: "CALL NOW", icon: PhoneCall, variant: "destructive" },
    callback: { label: "CALLBACK", icon: PhoneForwarded, variant: "warning" },
    verify_insurance: { label: "VERIFY INSURANCE", icon: FileCheck, variant: "warning" },
    request_docs: { label: "REQUEST DOCS", icon: FileText, variant: "default" },
    create_claim: { label: "READY FOR CLAIM", icon: Send, variant: "success" },
    none: { label: "NO ACTION", icon: Ban, variant: "default" },
  };

  const config = actionConfig[actionType || "call"] || actionConfig.call;
  const Icon = config.icon;
  
  const variantStyles: Record<string, string> = {
    destructive: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    default: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700",
  };

  const dueTime = dueAt ? formatDistanceToNow(new Date(dueAt), { addSuffix: true }) : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`${variantStyles[config.variant]} font-medium text-xs gap-1`}>
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
      </TooltipTrigger>
      {dueTime && (
        <TooltipContent>
          <p className="text-xs">Due {dueTime}</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

export default function LeadsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [attemptsModalLead, setAttemptsModalLead] = useState<Lead | null>(null);
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

  // Fetch calls for attempts timeline modal
  const { data: attemptsCalls } = useQuery<Call[]>({
    queryKey: ["/api/leads", attemptsModalLead?.id, "calls"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${attemptsModalLead?.id}/calls`);
      return res.json();
    },
    enabled: !!attemptsModalLead,
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
          {/* Manager KPI Strip */}
          <div className="flex items-center gap-6 bg-muted/50 rounded-lg px-4 py-2">
            <button
              onClick={() => setActiveQueue("sla_breach")}
              className="flex items-center gap-2 text-sm hover:underline"
              data-testid="kpi-sla-breach"
            >
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="font-medium text-red-600 dark:text-red-400">
                {worklistData?.countsByQueue?.sla_breach || 0} leads breaching SLA
              </span>
            </button>
            <button
              onClick={() => setActiveQueue("incomplete_vob")}
              className="flex items-center gap-2 text-sm hover:underline"
              data-testid="kpi-incomplete-vob"
            >
              <FileCheck className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {worklistData?.countsByQueue?.incomplete_vob || 0} incomplete VOBs
              </span>
            </button>
            <button
              onClick={() => setActiveQueue("vob_complete_needs_admissions")}
              className="flex items-center gap-2 text-sm hover:underline"
              data-testid="kpi-ready-for-claim"
            >
              <Send className="h-4 w-4 text-emerald-500" />
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {worklistData?.countsByQueue?.vob_complete_needs_admissions || 0} ready for claim
              </span>
            </button>
          </div>

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
                      <TableHead>Next Action</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Last Outcome</TableHead>
                      <TableHead className="text-center">Attempts</TableHead>
                      <TableHead>VOB Completeness</TableHead>
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
                      filteredLeads.map((lead) => {
                        const slaDeadline = (lead as any).slaDeadlineAt;
                        const isSlaBreach = slaDeadline && new Date(slaDeadline) < new Date();
                        
                        return (
                        <TableRow
                          key={lead.id}
                          className={`cursor-pointer group ${isSlaBreach ? "border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20" : ""}`}
                          onClick={() => setLocation(`/leads/${lead.id}`)}
                          data-testid={`row-lead-${lead.id}`}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {isSlaBreach && (
                                <Clock className="h-4 w-4 text-red-500 shrink-0" />
                              )}
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
                            <NextActionBadge 
                              actionType={(lead as any).nextActionType || "call"} 
                              dueAt={(lead as any).nextActionAt}
                            />
                          </TableCell>
                          <TableCell>
                            <PriorityBadge priority={lead.priority || "P2"} />
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {lead.lastOutcome || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setAttemptsModalLead(lead)}
                              className="text-sm underline-offset-2 hover:underline text-primary cursor-pointer"
                              data-testid={`button-attempts-${lead.id}`}
                            >
                              {lead.attemptCount || 0}
                            </button>
                          </TableCell>
                          <TableCell>
                            <VobCompletenessChip 
                              score={lead.vobScore || 0} 
                              missingFields={(lead as any).vobMissingFields}
                            />
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
                        );
                      })
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

      {/* Attempts Timeline Modal */}
      <Dialog open={!!attemptsModalLead} onOpenChange={(open) => !open && setAttemptsModalLead(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Contact Attempts</DialogTitle>
            <DialogDescription>
              {attemptsModalLead?.name} - {attemptsModalLead?.attemptCount || 0} attempts
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {attemptsCalls && attemptsCalls.length > 0 ? (
              attemptsCalls.map((call) => (
                <div key={call.id} className="flex gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Phone className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium capitalize">{call.disposition}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(call.createdAt), "MMM d, h:mm a")}
                      </span>
                    </div>
                    {call.duration && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Duration: {Math.floor(call.duration / 60)}m {call.duration % 60}s
                      </p>
                    )}
                    {call.summary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {call.summary}
                      </p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Phone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No call records found</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttemptsModalLead(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
