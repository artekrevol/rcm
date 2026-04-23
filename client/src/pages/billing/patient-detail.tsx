import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { validateNPI } from "@shared/npi-validation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Loader2,
  FileText,
  User,
  Shield,
  MessageSquare,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Save,
  Zap,
  PenLine,
  Info,
  XCircle,
} from "lucide-react";

const REFERRAL_SOURCES = [
  "VA Community Care", "Physician office", "Hospital discharge planner",
  "Skilled nursing facility transition", "Hospice / palliative care transition",
  "Google Search", "Google Maps / Local listing", "Facebook / Instagram",
  "Referral partner", "Community event", "Elder law attorney",
  "Church / faith community", "Word of mouth / family",
  "Website chat", "Inbound AI call", "Other",
];
const SEX_OPTIONS = ["Male", "Female", "Other"];
const RELATIONSHIP_OPTIONS = ["Self", "Spouse", "Child", "Other"];

function ProfileTab({ patient, providers, payers }: { patient: any; providers: any[]; payers: any[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({});
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [npiError, setNpiError] = useState("");

  useEffect(() => {
    if (patient && patient.id !== loadedId) {
      let firstName = patient.first_name || "";
      let lastName = patient.last_name || "";
      if (!firstName && !lastName && patient.lead_name) {
        const parts = patient.lead_name.trim().split(/\s+/);
        firstName = parts[0] || "";
        lastName = parts.slice(1).join(" ") || "";
      }
      setForm({
        firstName,
        lastName,
        dob: patient.dob || "",
        sex: patient.sex || "",
        phone: patient.phone || "",
        email: patient.email || "",
        state: patient.state || "",
        insuranceCarrier: patient.insurance_carrier || "",
        memberId: patient.member_id || "",
        groupNumber: patient.group_number || "",
        insuredName: patient.insured_name || "",
        relationshipToInsured: patient.relationship_to_insured || "",
        authorizationNumber: patient.authorization_number || "",
        referringProviderName: patient.referring_provider_name || "",
        referringProviderNpi: patient.referring_provider_npi || "",
        referralSource: patient.referral_source || "",
        referralPartnerName: patient.referral_partner_name || "",
        defaultProviderId: patient.default_provider_id || "",
        serviceNeeded: patient.service_needed || "",
        preferredName: patient.preferred_name || "",
        secondaryPayer: patient.secondary_payer_id || "",
        secondaryMemberId: patient.secondary_member_id || "",
        secondaryGroupNumber: patient.secondary_group_number || "",
        secondaryPlanName: patient.secondary_plan_name || "",
        secondaryRelationship: patient.secondary_relationship || "Self",
      });
      setLoadedId(patient.id);
    }
  }, [patient, loadedId]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/billing/patients/${patient.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patient.id] });
      toast({ title: "Patient updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleSave() {
    if (form.referringProviderNpi && !validateNPI(form.referringProviderNpi)) {
      setNpiError("Invalid NPI");
      return;
    }
    saveMutation.mutate({
      firstName: form.firstName || null,
      lastName: form.lastName || null,
      dob: form.dob || null,
      sex: form.sex || null,
      phone: form.phone || null,
      email: form.email || null,
      state: form.state || null,
      insuranceCarrier: form.insuranceCarrier || null,
      memberId: form.memberId || null,
      groupNumber: form.groupNumber || null,
      insuredName: form.insuredName || null,
      relationshipToInsured: form.relationshipToInsured || null,
      authorizationNumber: form.authorizationNumber || null,
      referringProviderName: form.referringProviderName || null,
      referringProviderNpi: form.referringProviderNpi || null,
      referralSource: form.referralSource || null,
      referralPartnerName: form.referralPartnerName || null,
      defaultProviderId: form.defaultProviderId || null,
      serviceNeeded: form.serviceNeeded || null,
      preferredName: form.preferredName || null,
      secondaryPayerId: form.secondaryPayer || null,
      secondaryMemberId: form.secondaryMemberId || null,
      secondaryGroupNumber: form.secondaryGroupNumber || null,
      secondaryPlanName: form.secondaryPlanName || null,
      secondaryRelationship: form.secondaryRelationship || null,
    });
  }

  if (!loadedId) return null;
  const set = (updates: any) => setForm({ ...form, ...updates });

  return (
    <div className="space-y-6 max-w-3xl">
      {patient.intake_completed && (
        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md p-3" data-testid="banner-from-intake">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div className="text-sm">
            <span className="font-medium text-emerald-800 dark:text-emerald-200">From Intake ✓</span>
            {patient.updated_at && (
              <span className="text-emerald-700 dark:text-emerald-300 ml-2">
                Converted {new Date(patient.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Demographics</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} data-testid="input-edit-first-name" />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} data-testid="input-edit-last-name" />
            </div>
            <div className="space-y-2">
              <Label>Preferred Name</Label>
              <Input value={form.preferredName} onChange={(e) => set({ preferredName: e.target.value })} data-testid="input-edit-preferred-name" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Date of Birth</Label>
              <Input value={form.dob} onChange={(e) => set({ dob: e.target.value })} data-testid="input-edit-dob" />
            </div>
            <div className="space-y-2">
              <Label>Sex</Label>
              <Select value={form.sex} onValueChange={(v) => set({ sex: v })}>
                <SelectTrigger data-testid="select-edit-sex"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {SEX_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={form.state} onChange={(e) => set({ state: e.target.value })} maxLength={2} data-testid="input-edit-state" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} data-testid="input-edit-phone" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => set({ email: e.target.value })} data-testid="input-edit-email" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Insurance</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Insurance Carrier</Label>
              <Input value={form.insuranceCarrier} onChange={(e) => set({ insuranceCarrier: e.target.value })} list="payer-edit-list" data-testid="input-edit-insurance" />
              <datalist id="payer-edit-list">
                {payers.filter((p: any) => p.is_active).map((p: any) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Member ID</Label>
              <Input value={form.memberId} onChange={(e) => set({ memberId: e.target.value })} data-testid="input-edit-member-id" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Group Number</Label>
              <Input value={form.groupNumber} onChange={(e) => set({ groupNumber: e.target.value })} data-testid="input-edit-group" />
            </div>
            <div className="space-y-2">
              <Label>Insured Name</Label>
              <Input value={form.insuredName} onChange={(e) => set({ insuredName: e.target.value })} data-testid="input-edit-insured-name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship</Label>
              <Select value={form.relationshipToInsured} onValueChange={(v) => set({ relationshipToInsured: v })}>
                <SelectTrigger data-testid="select-edit-relationship"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Authorization Number</Label>
            <Input value={form.authorizationNumber} onChange={(e) => set({ authorizationNumber: e.target.value })} data-testid="input-edit-auth-number" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Secondary Insurance (COB)
            <span className="text-xs font-normal text-muted-foreground ml-1">Coordination of Benefits</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Secondary Payer</Label>
              <Select
                value={form.secondaryPayer || "__none__"}
                onValueChange={(v) => set({ secondaryPayer: v === "__none__" ? "" : v })}
              >
                <SelectTrigger data-testid="select-secondary-payer">
                  <SelectValue placeholder="Select secondary payer…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {payers.filter((p: any) => p.is_active).map((p: any) => (
                    <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Member ID</Label>
              <Input value={form.secondaryMemberId} onChange={(e) => set({ secondaryMemberId: e.target.value })} placeholder="Secondary member ID" data-testid="input-secondary-member-id" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Group Number</Label>
              <Input value={form.secondaryGroupNumber} onChange={(e) => set({ secondaryGroupNumber: e.target.value })} placeholder="Group #" data-testid="input-secondary-group" />
            </div>
            <div className="space-y-2">
              <Label>Plan Name</Label>
              <Input value={form.secondaryPlanName} onChange={(e) => set({ secondaryPlanName: e.target.value })} placeholder="Plan name (optional)" data-testid="input-secondary-plan-name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship</Label>
              <Select value={form.secondaryRelationship} onValueChange={(v) => set({ secondaryRelationship: v })}>
                <SelectTrigger data-testid="select-secondary-relationship"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["Self", "Spouse", "Child", "Other"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Referral & Provider</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Referring Provider</Label>
              <Input value={form.referringProviderName} onChange={(e) => set({ referringProviderName: e.target.value })} data-testid="input-edit-ref-provider" />
            </div>
            <div className="space-y-2">
              <Label>Referring NPI</Label>
              <Input
                value={form.referringProviderNpi}
                maxLength={10}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                  set({ referringProviderNpi: v });
                  if (npiError) setNpiError("");
                }}
                className={npiError ? "border-destructive" : ""}
                data-testid="input-edit-ref-npi"
              />
              {npiError && <p className="text-sm text-destructive">{npiError}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Referral Source</Label>
              <Select value={form.referralSource} onValueChange={(v) => set({ referralSource: v })}>
                <SelectTrigger data-testid="select-edit-referral"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {REFERRAL_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Provider</Label>
              <Select value={form.defaultProviderId} onValueChange={(v) => set({ defaultProviderId: v })}>
                <SelectTrigger data-testid="select-edit-provider"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {providers.filter((p: any) => p.is_active).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.referralSource === "Referral partner" && (
            <div className="space-y-2">
              <Label>Partner Name</Label>
              <Input value={form.referralPartnerName} onChange={(e) => set({ referralPartnerName: e.target.value })} data-testid="input-edit-partner-name" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Service Needed</Label>
            <Input value={form.serviceNeeded} onChange={(e) => set({ serviceNeeded: e.target.value })} data-testid="input-edit-service" />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-profile">
        {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        <Save className="h-4 w-4 mr-2" />
        Save Changes
      </Button>
    </div>
  );
}

function ClaimsTab({ patientId }: { patientId: string }) {
  const [, navigate] = useLocation();
  const { data: claims = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", patientId, "claims"],
    queryFn: async () => {
      const res = await fetch(`/api/billing/patients/${patientId}/claims`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  function getCode(claim: any): string {
    if (claim.service_lines?.length) {
      const sl = claim.service_lines[0];
      return sl.hcpcs_code || sl.cpt_code || sl.code || "—";
    }
    if (claim.cpt_codes?.length) return claim.cpt_codes[0];
    return "—";
  }

  function getDate(claim: any): string {
    const d = claim.service_date || claim.created_at;
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString(); } catch { return d; }
  }

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      submitted: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
      paid: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
      denied: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
      appealed: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
    };
    return colors[status] || "";
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Claims</h3>
        <Button onClick={() => navigate(`/billing/claims/new?patientId=${patientId}`)} data-testid="button-new-claim">
          <Plus className="h-4 w-4 mr-2" />
          New Claim
        </Button>
      </div>

      {claims.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No claims for this patient yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim ID</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Service Date</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c: any) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/billing/claims/${c.id}`)}
                  data-testid={`row-claim-${c.id}`}
                >
                  <TableCell className="font-mono text-sm">{c.id.substring(0, 8)}...</TableCell>
                  <TableCell className="font-mono">{getCode(c)}</TableCell>
                  <TableCell>{getDate(c)}</TableCell>
                  <TableCell>{c.payer || "—"}</TableCell>
                  <TableCell>{c.amount ? `$${Number(c.amount).toFixed(2)}` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColor(c.status)}>
                      {c.status?.charAt(0).toUpperCase() + c.status?.slice(1)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const EMPTY_MANUAL = {
  payerName: "", memberId: "", policyStatus: "Active", planName: "",
  effectiveDate: "", termDate: "", copay: "", deductible: "", deductibleMet: "",
  coinsurance: "", outOfPocketMax: "", priorAuthRequired: false,
  networkStatus: "unknown", payerNotes: "",
};

function EligibilityTab({ patientId, patient }: { patientId: string; patient: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ ...EMPTY_MANUAL });

  const { data: stediStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/billing/stedi/status"],
    queryFn: async () => {
      const res = await fetch("/api/billing/stedi/status");
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });

  const { data: vobs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", patientId, "vob"],
    queryFn: async () => {
      const res = await fetch(`/api/billing/patients/${patientId}/vob`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/billing/patients/${patientId}/vob/check`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Eligibility check failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patientId, "vob"] });
      if (data.status === "error") {
        toast({ title: "Eligibility returned an error", description: data.errorMessage || "Payer returned an error", variant: "destructive" });
      } else {
        toast({ title: `Coverage ${data.status}`, description: `${data.policyStatus}${data.planName ? ` · ${data.planName}` : ""}` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Check failed", description: err.message, variant: "destructive" });
    },
  });

  const manualMutation = useMutation({
    mutationFn: async (form: typeof manualForm) => {
      const payload = {
        ...form,
        copay: form.copay !== "" ? parseFloat(form.copay) : null,
        deductible: form.deductible !== "" ? parseFloat(form.deductible) : null,
        deductibleMet: form.deductibleMet !== "" ? parseFloat(form.deductibleMet) : null,
        coinsurance: form.coinsurance !== "" ? parseFloat(form.coinsurance) : null,
        outOfPocketMax: form.outOfPocketMax !== "" ? parseFloat(form.outOfPocketMax) : null,
      };
      const res = await apiRequest("POST", `/api/billing/patients/${patientId}/vob/manual`, payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patientId, "vob"] });
      setShowManual(false);
      setManualForm({ ...EMPTY_MANUAL });
      toast({ title: "Manual VOB saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  function openManual() {
    setManualForm({
      ...EMPTY_MANUAL,
      payerName: patient?.insurance_carrier || "",
      memberId: patient?.member_id || "",
    });
    setShowManual(true);
  }

  function mf(field: string, value: any) {
    setManualForm(prev => ({ ...prev, [field]: value }));
  }

  const stediConfigured = stediStatus?.configured ?? false;

  const { data: allPayers = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const patientPayerRecord = allPayers.find((p: any) =>
    p.name?.toLowerCase() === patient?.insurance_carrier?.toLowerCase() ||
    (patient?.payer_id && p.id === patient.payer_id)
  );
  const txs: string[] = patientPayerRecord?.supported_transactions && Array.isArray(patientPayerRecord.supported_transactions) ? patientPayerRecord.supported_transactions : [];
  const payerSupports271 = txs.length === 0 || txs.some((t: string) => t.includes("270") || t.includes("271") || t.toLowerCase().includes("eligibility"));

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Eligibility Verifications</h3>
          <div className="flex items-center gap-2">
            {!stediConfigured && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-md px-2 py-1 cursor-default">
                    <Info className="h-3 w-3" />
                    Manual mode
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Live eligibility checks require a STEDI_API_KEY environment variable. Use manual entry to record VOB results from phone calls.
                </TooltipContent>
              </Tooltip>
            )}
            {stediConfigured && !payerSupports271 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-md px-2 py-1 cursor-default" data-testid="badge-eligibility-not-supported">
                    <Info className="h-3 w-3" />
                    Eligibility not supported
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {patient?.insurance_carrier || "This payer"} does not support 270/271 electronic eligibility checks via Stedi. Use "Enter Manually" to record benefits from a phone call.
                </TooltipContent>
              </Tooltip>
            )}
            {stediConfigured && payerSupports271 && (
              <Button
                size="sm"
                onClick={() => checkMutation.mutate()}
                disabled={checkMutation.isPending}
                data-testid="button-check-eligibility"
              >
                {checkMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                Check Eligibility
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={openManual} data-testid="button-manual-vob">
              <PenLine className="h-4 w-4 mr-2" />
              Enter Manually
            </Button>
          </div>
        </div>

        {/* VOB cards */}
        {vobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No eligibility verifications yet.</p>
              <p className="text-muted-foreground text-xs mt-1">
                {stediConfigured ? 'Click "Check Eligibility" for a live check, or "Enter Manually" to record a phone VOB.' : 'Click "Enter Manually" to record benefits collected by phone.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {vobs.map((v: any) => (
              <Card key={v.id} data-testid={`card-vob-${v.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status + badges row */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {v.status === "verified" && v.policy_status !== "error" ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0 gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {v.policy_status || "Active"}
                          </Badge>
                        ) : v.status === "error" ? (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            Error
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs capitalize">{v.status}</Badge>
                        )}
                        <Badge variant="outline" className="text-xs capitalize bg-muted/40">
                          {v.verification_method === "stedi" ? "Stedi live" : v.verification_method === "manual" ? "Manual" : v.context || "unknown"}
                        </Badge>
                        {v.network_status && v.network_status !== "unknown" && (
                          <Badge variant="outline" className={`text-xs ${v.network_status === "in-network" ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950" : "text-orange-600 border-orange-200 bg-orange-50 dark:bg-orange-950"}`}>
                            {v.network_status}
                          </Badge>
                        )}
                        {v.prior_auth_required && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950 gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Prior Auth Required
                          </Badge>
                        )}
                      </div>

                      {/* Plan info */}
                      {(v.plan_name || v.policy_type || v.payer_name) && (
                        <p className="text-sm font-medium mb-2">
                          {v.plan_name || v.payer_name}
                          {v.policy_type ? <span className="font-normal text-muted-foreground"> · {v.policy_type}</span> : null}
                        </p>
                      )}

                      {/* Benefits grid */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                        {v.copay != null && <div><span className="text-muted-foreground">Copay:</span> <span className="font-medium">${v.copay}</span></div>}
                        {v.deductible != null && <div><span className="text-muted-foreground">Deductible:</span> <span className="font-medium">${v.deductible}</span></div>}
                        {v.deductible_met != null && <div><span className="text-muted-foreground">Deductible Met:</span> <span className="font-medium">${v.deductible_met}</span></div>}
                        {v.coinsurance != null && <div><span className="text-muted-foreground">Coinsurance:</span> <span className="font-medium">{v.coinsurance}%</span></div>}
                        {v.out_of_pocket_max != null && <div><span className="text-muted-foreground">OOP Max:</span> <span className="font-medium">${v.out_of_pocket_max}</span></div>}
                        {v.effective_date && <div><span className="text-muted-foreground">Effective:</span> <span className="font-medium">{v.effective_date}</span></div>}
                        {v.term_date && <div><span className="text-muted-foreground">Term:</span> <span className="font-medium">{v.term_date}</span></div>}
                      </div>

                      {/* Error message */}
                      {v.error_message && (
                        <p className="text-xs text-destructive mt-2 bg-destructive/5 rounded p-2">{v.error_message}</p>
                      )}

                      {/* Notes */}
                      {v.payer_notes && (
                        <p className="text-xs text-muted-foreground mt-2 italic">{v.payer_notes}</p>
                      )}
                    </div>

                    <div className="text-right text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {v.verified_at && (
                        <div className="flex items-center gap-1 justify-end">
                          <Clock className="h-3 w-3" />
                          {new Date(v.verified_at).toLocaleDateString()}
                        </div>
                      )}
                      {v.verified_by && <div className="mt-0.5">{v.verified_by}</div>}
                      {v.stedi_transaction_id && (
                        <div className="mt-0.5 font-mono text-[10px] opacity-50">{v.stedi_transaction_id.slice(0, 12)}…</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Manual entry dialog */}
      <Dialog open={showManual} onOpenChange={setShowManual}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Enter Benefits Manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-payer">Payer Name *</Label>
                <Input id="manual-payer" value={manualForm.payerName} onChange={e => mf("payerName", e.target.value)} placeholder="e.g. Aetna" data-testid="input-manual-payer" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-member">Member ID *</Label>
                <Input id="manual-member" value={manualForm.memberId} onChange={e => mf("memberId", e.target.value)} placeholder="W123456789" data-testid="input-manual-member" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-policy-status">Policy Status</Label>
                <Select value={manualForm.policyStatus} onValueChange={v => mf("policyStatus", v)}>
                  <SelectTrigger id="manual-policy-status" data-testid="select-policy-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="Unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-network">Network Status</Label>
                <Select value={manualForm.networkStatus} onValueChange={v => mf("networkStatus", v)}>
                  <SelectTrigger id="manual-network" data-testid="select-network-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in-network">In-Network</SelectItem>
                    <SelectItem value="out-of-network">Out-of-Network</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-plan">Plan Name</Label>
              <Input id="manual-plan" value={manualForm.planName} onChange={e => mf("planName", e.target.value)} placeholder="e.g. PPO Gold" data-testid="input-manual-plan" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-eff">Effective Date</Label>
                <Input id="manual-eff" type="date" value={manualForm.effectiveDate} onChange={e => mf("effectiveDate", e.target.value)} data-testid="input-manual-effective" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-term">Termination Date</Label>
                <Input id="manual-term" type="date" value={manualForm.termDate} onChange={e => mf("termDate", e.target.value)} data-testid="input-manual-term" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-copay">Copay ($)</Label>
                <Input id="manual-copay" type="number" min="0" step="0.01" value={manualForm.copay} onChange={e => mf("copay", e.target.value)} placeholder="0.00" data-testid="input-manual-copay" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-coins">Coinsurance (%)</Label>
                <Input id="manual-coins" type="number" min="0" max="100" step="1" value={manualForm.coinsurance} onChange={e => mf("coinsurance", e.target.value)} placeholder="20" data-testid="input-manual-coinsurance" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-ded">Deductible ($)</Label>
                <Input id="manual-ded" type="number" min="0" step="0.01" value={manualForm.deductible} onChange={e => mf("deductible", e.target.value)} placeholder="1500.00" data-testid="input-manual-deductible" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-ded-met">Deductible Met ($)</Label>
                <Input id="manual-ded-met" type="number" min="0" step="0.01" value={manualForm.deductibleMet} onChange={e => mf("deductibleMet", e.target.value)} placeholder="0.00" data-testid="input-manual-deductible-met" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-oop">Out-of-Pocket Max ($)</Label>
              <Input id="manual-oop" type="number" min="0" step="0.01" value={manualForm.outOfPocketMax} onChange={e => mf("outOfPocketMax", e.target.value)} placeholder="5000.00" data-testid="input-manual-oop" />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="manual-auth"
                checked={manualForm.priorAuthRequired as boolean}
                onChange={e => mf("priorAuthRequired", e.target.checked)}
                className="h-4 w-4"
                data-testid="checkbox-prior-auth"
              />
              <Label htmlFor="manual-auth">Prior Authorization Required</Label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-notes">Notes</Label>
              <Textarea id="manual-notes" value={manualForm.payerNotes} onChange={e => mf("payerNotes", e.target.value)} rows={2} placeholder="Any notes from the phone call..." data-testid="textarea-manual-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManual(false)} data-testid="button-cancel-manual">Cancel</Button>
            <Button
              onClick={() => manualMutation.mutate(manualForm)}
              disabled={manualMutation.isPending || !manualForm.payerName || !manualForm.memberId}
              data-testid="button-save-manual"
            >
              {manualMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save VOB
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function NotesTab({ patient }: { patient: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState("");

  function parseNotes(notesStr: any): any[] {
    if (!notesStr) return [];
    if (Array.isArray(notesStr)) return notesStr;
    try {
      const parsed = JSON.parse(notesStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return notesStr ? [{ text: notesStr, timestamp: null, author: "System" }] : [];
    }
  }

  const notes = parseNotes(patient.notes);

  const saveMutation = useMutation({
    mutationFn: async (noteText: string) => {
      const res = await apiRequest("POST", `/api/billing/patients/${patient.id}/notes`, {
        text: noteText,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patient.id] });
      setNewNote("");
      toast({ title: "Note added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function addNote() {
    if (!newNote.trim()) return;
    saveMutation.mutate(newNote.trim());
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-lg font-medium">Notes</h3>

      <div className="space-y-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          rows={3}
          data-testid="textarea-new-note"
        />
        <Button
          onClick={addNote}
          disabled={!newNote.trim() || saveMutation.isPending}
          size="sm"
          data-testid="button-add-note"
        >
          {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Add Note
        </Button>
      </div>

      {notes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No notes yet. Add the first note above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...notes].reverse().map((n: any, i: number) => (
            <div key={i} className="border rounded-lg p-3" data-testid={`note-${i}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{n.author || "Unknown"}</span>
                {n.timestamp && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(n.timestamp).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-sm">{n.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PatientDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const patientId = params.id!;

  const { data: patient, isLoading, error } = useQuery<any>({
    queryKey: ["/api/billing/patients", patientId],
    queryFn: async () => {
      const res = await fetch(`/api/billing/patients/${patientId}`);
      if (!res.ok) throw new Error("Patient not found");
      return res.json();
    },
  });

  const { data: providers = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/providers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/providers");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: payers = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  function displayName(p: any): string {
    if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
    if (p.first_name) return p.first_name;
    if (p.last_name) return p.last_name;
    if (p.lead_name) return p.lead_name;
    return "Unknown Patient";
  }

  if (isLoading) return (
    <div className="p-6 flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (error || !patient) return (
    <div className="p-6 text-center py-12">
      <p className="text-destructive mb-3">Patient not found</p>
      <Button variant="outline" onClick={() => navigate("/billing/patients")}>Back to Patients</Button>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/billing/patients")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold" data-testid="text-patient-name">{displayName(patient)}</h1>
            {patient.intake_completed && (
              <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 gap-1">
                From Intake ✓
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {patient.dob && `DOB: ${patient.dob}`}
            {patient.insurance_carrier && ` · ${patient.insurance_carrier}`}
            {patient.member_id && ` · ID: ${patient.member_id}`}
          </p>
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList data-testid="tabs-patient-detail">
          <TabsTrigger value="profile" data-testid="tab-profile">
            <User className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="claims" data-testid="tab-claims">
            <FileText className="h-4 w-4 mr-2" />
            Claims
          </TabsTrigger>
          <TabsTrigger value="eligibility" data-testid="tab-eligibility">
            <Shield className="h-4 w-4 mr-2" />
            Eligibility
          </TabsTrigger>
          <TabsTrigger value="notes" data-testid="tab-notes">
            <MessageSquare className="h-4 w-4 mr-2" />
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab patient={patient} providers={providers} payers={payers} />
        </TabsContent>
        <TabsContent value="claims">
          <ClaimsTab patientId={patientId} />
        </TabsContent>
        <TabsContent value="eligibility">
          <EligibilityTab patientId={patientId} patient={patient} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab patient={patient} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
