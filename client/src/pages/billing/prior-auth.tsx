import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Clock, CheckCircle2, XCircle, AlertTriangle, Calendar, Plus, Loader2, FileText, Send } from "lucide-react";
import { format, isPast, differenceInDays, addDays } from "date-fns";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PriorAuthRecord {
  id: string;
  patient_id: string;
  patient_name: string;
  payer: string;
  auth_number: string | null;
  service_type: string;
  status: string;
  expiration_date: string | null;
  approved_units: number | null;
  used_units: number | null;
  notes: string | null;
  mode: string | null;
  source: string | null;
  request_submitted_date: string | null;
  denial_reason: string | null;
  created_at: string;
  requested_date?: string;
}

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  pending: { icon: Clock, color: "bg-amber-500/10 text-amber-700 dark:text-amber-400", label: "Pending" },
  submitted: { icon: Send, color: "bg-blue-500/10 text-blue-700 dark:text-blue-400", label: "Submitted" },
  approved: { icon: CheckCircle2, color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", label: "Approved" },
  denied: { icon: XCircle, color: "bg-red-500/10 text-red-700 dark:text-red-400", label: "Denied" },
  expired: { icon: AlertTriangle, color: "bg-gray-500/10 text-gray-600 dark:text-gray-400", label: "Expired" },
  "partially approved": { icon: CheckCircle2, color: "bg-amber-500/10 text-amber-700 dark:text-amber-400", label: "Partial" },
  "under review": { icon: Clock, color: "bg-purple-500/10 text-purple-700 dark:text-purple-400", label: "Under Review" },
  appealing: { icon: AlertTriangle, color: "bg-orange-500/10 text-orange-700 dark:text-orange-400", label: "Appealing" },
};

const modeConfig: Record<string, { label: string; color: string }> = {
  received: { label: "Received Auth", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  request: { label: "PA Request", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

function NewAuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"received" | "request">("received");
  const { data: patients = [] } = useQuery<any[]>({ queryKey: ["/api/billing/patients"] });
  const { data: payers = [] } = useQuery<any[]>({ queryKey: ["/api/payers"] });

  const [form, setForm] = useState({
    patientId: "", payer: "", authNumber: "", serviceType: "", startDate: "", endDate: "",
    authorizedUnits: "", referringProviderName: "", referringProviderNpi: "", notes: "", source: "Payer Portal",
    requestSubmittedDate: "", requestMethod: "Portal", clinicalJustification: "",
    status: "pending", denialReason: "", approvedUnits: "",
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/prior-auth", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/prior-auths"] });
      toast({ title: "Prior authorization saved" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save authorization", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.patientId || !form.payer || !form.serviceType) {
      toast({ title: "Patient, payer, and service type are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      patientId: form.patientId,
      payer: form.payer,
      serviceType: form.serviceType,
      authNumber: form.authNumber || null,
      expiration_date: form.endDate || null,
      approvedUnits: form.authorizedUnits ? parseInt(form.authorizedUnits) : null,
      notes: form.notes || null,
      status: mode === "received" ? (form.status || "approved") : form.status,
      mode,
      source: form.source,
      referringProviderName: form.referringProviderName || null,
      referringProviderNpi: form.referringProviderNpi || null,
      requestSubmittedDate: form.requestSubmittedDate || null,
      requestMethod: form.requestMethod || null,
      clinicalJustification: form.clinicalJustification || null,
      denialReason: form.denialReason || null,
    });
  }

  const f = (k: string) => (e: any) => setForm(prev => ({ ...prev, [k]: e.target?.value ?? e }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Prior Authorization</DialogTitle>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="received" data-testid="tab-mode-received">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mode A — Record Received Auth
            </TabsTrigger>
            <TabsTrigger value="request" data-testid="tab-mode-request">
              <Send className="h-4 w-4 mr-2" />
              Mode B — Track PA Request
            </TabsTrigger>
          </TabsList>

          <div className="mt-1 mb-3 p-2 rounded bg-muted/40 text-xs text-muted-foreground">
            {mode === "received"
              ? "Use when auth number arrives with a referral or is issued proactively by the payer (VA Community Care, some Medicaid/commercial plans)."
              : "Use when you must submit a PA request and track its status through approval or denial (most commercial payers, Medicare Advantage)."}
          </div>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Patient *</Label>
                <Select value={form.patientId} onValueChange={f("patientId")}>
                  <SelectTrigger data-testid="select-pa-patient"><SelectValue placeholder="Search patient…" /></SelectTrigger>
                  <SelectContent>
                    {patients.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payer *</Label>
                <Select value={form.payer} onValueChange={f("payer")}>
                  <SelectTrigger data-testid="select-pa-payer"><SelectValue placeholder="Select payer…" /></SelectTrigger>
                  <SelectContent>
                    {payers.map((p: any) => <SelectItem key={p.payer_id || p.id} value={p.name}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Authorized Service(s) / Type *</Label>
                <Input value={form.serviceType} onChange={f("serviceType")} placeholder="e.g. Physical Therapy, 97110" data-testid="input-pa-service-type" />
              </div>
              <div className="space-y-1">
                <Label>Authorization Number</Label>
                <Input value={form.authNumber} onChange={f("authNumber")} placeholder="AUTH-123456" data-testid="input-pa-auth-number" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Authorization Start Date</Label>
                <Input type="date" value={form.startDate} onChange={f("startDate")} data-testid="input-pa-start-date" />
              </div>
              <div className="space-y-1">
                <Label>Authorization End Date</Label>
                <Input type="date" value={form.endDate} onChange={f("endDate")} data-testid="input-pa-end-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Authorized Units / Visits</Label>
                <Input type="number" value={form.authorizedUnits} onChange={f("authorizedUnits")} placeholder="e.g. 12" data-testid="input-pa-authorized-units" />
              </div>
              <div className="space-y-1">
                <Label>Source</Label>
                <Select value={form.source} onValueChange={f("source")}>
                  <SelectTrigger data-testid="select-pa-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["VA Referral", "Payer Portal", "Fax", "Phone", "Electronic", "Other"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Referring/Ordering Provider Name</Label>
                <Input value={form.referringProviderName} onChange={f("referringProviderName")} placeholder="Dr. Jane Smith" data-testid="input-pa-referring-name" />
              </div>
              <div className="space-y-1">
                <Label>Referring/Ordering NPI</Label>
                <Input value={form.referringProviderNpi} onChange={f("referringProviderNpi")} placeholder="1234567890" data-testid="input-pa-referring-npi" />
              </div>
            </div>

            <TabsContent value="request" className="mt-0 space-y-4 border-t pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Request Submitted Date</Label>
                  <Input type="date" value={form.requestSubmittedDate} onChange={f("requestSubmittedDate")} data-testid="input-pa-submitted-date" />
                </div>
                <div className="space-y-1">
                  <Label>Request Method</Label>
                  <Select value={form.requestMethod} onValueChange={f("requestMethod")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Portal", "Fax", "Phone", "Electronic"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={f("status")}>
                  <SelectTrigger data-testid="select-pa-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pending", "submitted", "approved", "denied", "partially approved", "under review", "appealing"].map(s =>
                      <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Clinical Justification Notes</Label>
                <Textarea value={form.clinicalJustification} onChange={f("clinicalJustification")} placeholder="Medical necessity, diagnosis, treatment plan…" data-testid="input-pa-clinical-notes" />
              </div>
              {form.status === "denied" && (
                <div className="space-y-1">
                  <Label>Denial Reason</Label>
                  <Input value={form.denialReason} onChange={f("denialReason")} placeholder="Reason for denial" data-testid="input-pa-denial-reason" />
                </div>
              )}
            </TabsContent>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={f("notes")} placeholder="Additional notes…" data-testid="input-pa-notes" />
            </div>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-save-auth">
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Authorization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PriorAuthPage() {
  const [, navigate] = useLocation();
  const [showNew, setShowNew] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: auths, isLoading } = useQuery<PriorAuthRecord[]>({
    queryKey: ["/api/billing/prior-auths"],
    queryFn: () => fetch("/api/billing/prior-auths", { credentials: "include" }).then(r => r.json()),
  });

  const filtered = (auths || []).filter(a => filterStatus === "all" || a.status === filterStatus);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Prior Authorizations</h1>
          <p className="text-muted-foreground text-sm">Track received authorizations and submitted PA requests</p>
        </div>
        <Button className="gap-2" onClick={() => setShowNew(true)} data-testid="button-new-auth">
          <Plus className="h-4 w-4" />
          New Authorization
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "pending", "submitted", "approved", "denied", "expired"].map(s => (
          <Button key={s} variant={filterStatus === s ? "default" : "outline"} size="sm"
            className="capitalize h-7 text-xs rounded-full"
            onClick={() => setFilterStatus(s)} data-testid={`filter-status-${s}`}>
            {s === "all" ? "All" : s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Shield className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold" data-testid="text-empty">
              {auths?.length === 0 ? "No prior authorizations yet" : "No authorizations match this filter"}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              {auths?.length === 0
                ? "Use \"New Authorization\" to record a received auth or start tracking a PA request."
                : "Try selecting a different status filter."}
            </p>
            {auths?.length === 0 && (
              <Button className="mt-4 gap-2" onClick={() => setShowNew(true)} data-testid="button-add-first-auth">
                <Plus className="h-4 w-4" /> Add First Authorization
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((auth) => {
            const cfg = statusConfig[auth.status] || statusConfig.pending;
            const Icon = cfg.icon;
            const isExpiringSoon = auth.expiration_date && !isPast(new Date(auth.expiration_date)) && differenceInDays(new Date(auth.expiration_date), new Date()) <= 14;
            const isExpired = auth.expiration_date && isPast(new Date(auth.expiration_date));
            const utilPct = auth.approved_units && auth.used_units ? (auth.used_units / auth.approved_units) * 100 : 0;
            const nearExhausted = utilPct >= 80 && auth.approved_units;
            const modeCfg = auth.mode ? modeConfig[auth.mode] : null;

            return (
              <Card key={auth.id} className="hover:border-primary/30 transition-colors" data-testid={`card-auth-${auth.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{auth.patient_name}</p>
                        <p className="text-xs text-muted-foreground">{auth.service_type} • {auth.payer}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {modeCfg && <Badge className={`${modeCfg.color} border-0 text-[10px]`}>{modeCfg.label}</Badge>}
                      {nearExhausted && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400 text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {Math.round(utilPct)}% Used
                        </Badge>
                      )}
                      {isExpiringSoon && !isExpired && (
                        <Badge variant="destructive" className="text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Expiring Soon
                        </Badge>
                      )}
                      {isExpired && <Badge variant="secondary" className="text-[10px]">Expired</Badge>}
                      <Badge className={`${cfg.color} border-0`}>{cfg.label}</Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
                    {auth.auth_number && <span className="font-mono">Auth #: {auth.auth_number}</span>}
                    {auth.approved_units && (
                      <span>{auth.used_units || 0} / {auth.approved_units} units used</span>
                    )}
                    {auth.expiration_date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Expires {format(new Date(auth.expiration_date), "MMM d, yyyy")}
                      </span>
                    )}
                    {auth.source && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{auth.source}</span>}
                    {auth.denial_reason && <span className="text-red-600">Denied: {auth.denial_reason}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <NewAuthDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
