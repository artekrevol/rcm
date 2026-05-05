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
  AlarmClock,
  Calendar,
  ChevronDown,
  ChevronUp,
  Stethoscope,
  Archive,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";

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

  const { data: enrollments = [] } = useQuery<any[]>({
    queryKey: ["/api/practice/payer-enrollments"],
    queryFn: async () => {
      const res = await fetch("/api/practice/payer-enrollments", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const enrolledPayerIds = new Set(
    enrollments.filter((e: any) => !e.disabled_at).map((e: any) => e.payer_id)
  );
  const enrolledPayers = enrolledPayerIds.size > 0
    ? payers.filter((p: any) => p.is_active && enrolledPayerIds.has(p.id))
    : payers.filter((p: any) => p.is_active);

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
        middleName: patient.middle_name || "",
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
        streetAddress: patient.street_address || "",
        city: patient.city || "",
        zipCode: patient.zip_code || "",
        secondaryPayer: patient.secondary_payer_id || "",
        secondaryMemberId: patient.secondary_member_id || "",
        secondaryGroupNumber: patient.secondary_group_number || "",
        secondaryPlanName: patient.secondary_plan_name || "",
        secondaryRelationship: patient.secondary_relationship || "Self",
        planProduct: patient.plan_product || "",
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
      middleName: form.middleName || null,
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
      streetAddress: form.streetAddress || null,
      city: form.city || null,
      zipCode: form.zipCode || null,
      secondaryPayerId: form.secondaryPayer || null,
      secondaryMemberId: form.secondaryMemberId || null,
      secondaryGroupNumber: form.secondaryGroupNumber || null,
      secondaryPlanName: form.secondaryPlanName || null,
      secondaryRelationship: form.secondaryRelationship || null,
      planProduct: form.planProduct || null,
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
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>First Name <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} data-testid="input-edit-first-name" />
            </div>
            <div className="space-y-2">
              <Label>Middle Name <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.middleName} onChange={(e) => set({ middleName: e.target.value })} data-testid="input-edit-middle-name" />
            </div>
            <div className="space-y-2">
              <Label>Last Name <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} data-testid="input-edit-last-name" />
            </div>
            <div className="space-y-2">
              <Label>Preferred Name <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.preferredName} onChange={(e) => set({ preferredName: e.target.value })} data-testid="input-edit-preferred-name" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Date of Birth <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.dob} onChange={(e) => set({ dob: e.target.value })} data-testid="input-edit-dob" />
            </div>
            <div className="space-y-2">
              <Label>Sex <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Select value={form.sex} onValueChange={(v) => set({ sex: v })}>
                <SelectTrigger data-testid="select-edit-sex"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {SEX_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>State <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.state} onChange={(e) => set({ state: e.target.value })} maxLength={2} data-testid="input-edit-state" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} data-testid="input-edit-phone" />
            </div>
            <div className="space-y-2">
              <Label>Email <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.email} onChange={(e) => set({ email: e.target.value })} data-testid="input-edit-email" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3 space-y-2">
              <Label>Street Address <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.streetAddress} onChange={(e) => set({ streetAddress: e.target.value })} placeholder="123 Main St" data-testid="input-edit-street-address" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>City <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="City" data-testid="input-edit-city" />
            </div>
            <div className="space-y-2">
              <Label>ZIP Code <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.zipCode} onChange={(e) => set({ zipCode: e.target.value })} maxLength={10} placeholder="12345" data-testid="input-edit-zip-code" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Insurance</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Insurance Carrier <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.insuranceCarrier} onChange={(e) => set({ insuranceCarrier: e.target.value })} list="payer-edit-list" data-testid="input-edit-insurance" />
              <datalist id="payer-edit-list">
                {enrolledPayers.map((p: any) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Member ID <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={form.memberId} onChange={(e) => set({ memberId: e.target.value })} data-testid="input-edit-member-id" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Plan Product <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
            <Select
              value={form.planProduct || "__none__"}
              onValueChange={(v) => set({ planProduct: v === "__none__" ? "" : v })}
            >
              <SelectTrigger data-testid="select-plan-product">
                <SelectValue placeholder="Select plan product…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unknown / Not specified</SelectItem>
                <SelectItem value="HMO">HMO</SelectItem>
                <SelectItem value="PPO">PPO</SelectItem>
                <SelectItem value="POS">POS</SelectItem>
                <SelectItem value="EPO">EPO</SelectItem>
                <SelectItem value="Indemnity">Indemnity</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Plan product affects which rules apply. HMOs typically require PCP referrals; PPOs allow out-of-network. Check the patient's insurance card — it usually shows the plan product near the top.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Group Number <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.groupNumber} onChange={(e) => set({ groupNumber: e.target.value })} data-testid="input-edit-group" />
            </div>
            <div className="space-y-2">
              <Label>Insured Name <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.insuredName} onChange={(e) => set({ insuredName: e.target.value })} data-testid="input-edit-insured-name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Select value={form.relationshipToInsured} onValueChange={(v) => set({ relationshipToInsured: v })}>
                <SelectTrigger data-testid="select-edit-relationship"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Authorization Number <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
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
              <Label>Secondary Payer <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Select
                value={form.secondaryPayer || "__none__"}
                onValueChange={(v) => set({ secondaryPayer: v === "__none__" ? "" : v })}
              >
                <SelectTrigger data-testid="select-secondary-payer">
                  <SelectValue placeholder="Select secondary payer…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {enrolledPayers.map((p: any) => (
                    <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Member ID <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.secondaryMemberId} onChange={(e) => set({ secondaryMemberId: e.target.value })} placeholder="Secondary member ID" data-testid="input-secondary-member-id" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Group Number <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.secondaryGroupNumber} onChange={(e) => set({ secondaryGroupNumber: e.target.value })} placeholder="Group #" data-testid="input-secondary-group" />
            </div>
            <div className="space-y-2">
              <Label>Plan Name <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.secondaryPlanName} onChange={(e) => set({ secondaryPlanName: e.target.value })} placeholder="Plan name (optional)" data-testid="input-secondary-plan-name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
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
              <Label>Referring Provider <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={form.referringProviderName} onChange={(e) => set({ referringProviderName: e.target.value })} data-testid="input-edit-ref-provider" />
            </div>
            <div className="space-y-2">
              <Label>Referring NPI <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
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
              <Label>Referral Source <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Select value={form.referralSource} onValueChange={(v) => set({ referralSource: v })}>
                <SelectTrigger data-testid="select-edit-referral"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {REFERRAL_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Provider <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
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
            <Label>Service Needed <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
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

// ── PCP Referrals Tab (Prompt 05) ──────────────────────────────────────────

const CAPTURED_VIA_OPTIONS = [
  { value: "manual_entry", label: "Manual Entry" },
  { value: "card_scan", label: "Card Scan" },
  { value: "fax", label: "Fax" },
  { value: "phone_verification", label: "Phone Verification" },
];

const REFERRAL_STATUS_CONFIG: Record<string, { label: string; badgeClass: string }> = {
  active: { label: "Active", badgeClass: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  expired: { label: "Expired", badgeClass: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  used_up: { label: "Used Up", badgeClass: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  revoked: { label: "Revoked", badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
  pending_verification: { label: "Pending Verification", badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
};

function ReferralsTab({ patientId, patient }: { patientId: string; patient: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [form, setForm] = useState({
    pcp_name: "", pcp_npi: "", pcp_phone: "", pcp_practice_name: "",
    referral_number: "", issue_date: "", expiration_date: "",
    visits_authorized: "", specialty_authorized: "", diagnosis_authorized: "",
    captured_via: "manual_entry", status: "active",
  });

  const planProduct = patient?.plan_product || "";
  const isHmoOrPos = planProduct === "HMO" || planProduct === "POS";

  const { data: referrals = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", patientId, "referrals"],
    queryFn: async () => {
      const res = await fetch(`/api/billing/patients/${patientId}/referrals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load referrals");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/billing/patients/${patientId}/referrals`, {
        ...data,
        visits_authorized: data.visits_authorized ? parseInt(data.visits_authorized) : null,
        expiration_date: data.expiration_date || null,
        pcp_npi: data.pcp_npi || null,
        pcp_phone: data.pcp_phone || null,
        pcp_practice_name: data.pcp_practice_name || null,
        referral_number: data.referral_number || null,
        diagnosis_authorized: data.diagnosis_authorized || null,
      }),
    onSuccess: () => {
      toast({ title: "Referral added" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patientId, "referrals"] });
      setShowAddForm(false);
      setForm({
        pcp_name: "", pcp_npi: "", pcp_phone: "", pcp_practice_name: "",
        referral_number: "", issue_date: "", expiration_date: "",
        visits_authorized: "", specialty_authorized: "", diagnosis_authorized: "",
        captured_via: "manual_entry", status: "active",
      });
    },
    onError: (e: any) => toast({ title: "Failed to add referral", description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/billing/referrals/${id}`, { status: "revoked" }),
    onSuccess: () => {
      toast({ title: "Referral revoked" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patientId, "referrals"] });
    },
  });

  const activeReferrals = referrals.filter((r) => r.status === "active" || r.status === "pending_verification");
  const inactiveReferrals = referrals.filter((r) => r.status !== "active" && r.status !== "pending_verification");

  return (
    <div className="space-y-4">
      {/* HMO/POS highlight banner */}
      {isHmoOrPos && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-lg" data-testid="banner-referral-required">
          <AlarmClock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{planProduct} plan — PCP referral required</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              This patient is on an {planProduct} plan which typically requires a valid PCP referral before specialist visits. Keep referrals current to avoid denials.
            </p>
          </div>
        </div>
      )}

      {/* Active Referrals */}
      <Card data-testid="card-active-referrals">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Stethoscope className="h-4 w-4" />
              Active Referrals
              {activeReferrals.length > 0 && (
                <Badge className="bg-green-600 text-white text-[10px] ml-1">{activeReferrals.length}</Badge>
              )}
            </CardTitle>
            <Button size="sm" onClick={() => setShowAddForm((v) => !v)} data-testid="button-add-referral">
              <Plus className="h-4 w-4 mr-1" />
              Add Referral
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : activeReferrals.length === 0 && !showAddForm ? (
            <div className="py-8 text-center text-muted-foreground" data-testid="empty-active-referrals">
              <Stethoscope className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No active referrals on file.</p>
              {isHmoOrPos && (
                <p className="text-xs mt-1 text-amber-600">An active referral is required for {planProduct} plan submission.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {activeReferrals.map((ref) => (
                <ReferralCard key={ref.id} referral={ref} onRevoke={() => revokeMutation.mutate(ref.id)} />
              ))}
            </div>
          )}

          {/* Add Referral Form */}
          {showAddForm && (
            <div className="mt-4 pt-4 border-t space-y-4" data-testid="form-add-referral">
              <p className="text-sm font-medium">New Referral</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">PCP Name <span className="text-red-500">*</span></Label>
                  <Input value={form.pcp_name} onChange={(e) => setForm({ ...form, pcp_name: e.target.value })} placeholder="Dr. Jane Smith" data-testid="input-pcp-name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PCP Practice Name</Label>
                  <Input value={form.pcp_practice_name} onChange={(e) => setForm({ ...form, pcp_practice_name: e.target.value })} placeholder="Smith Family Medicine" data-testid="input-pcp-practice" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PCP NPI</Label>
                  <Input value={form.pcp_npi} onChange={(e) => setForm({ ...form, pcp_npi: e.target.value })} placeholder="1234567890" data-testid="input-pcp-npi" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PCP Phone</Label>
                  <Input value={form.pcp_phone} onChange={(e) => setForm({ ...form, pcp_phone: e.target.value })} placeholder="(512) 555-0100" data-testid="input-pcp-phone" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Referral Number</Label>
                  <Input value={form.referral_number} onChange={(e) => setForm({ ...form, referral_number: e.target.value })} placeholder="Optional payer-issued number" data-testid="input-referral-number" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Issue Date <span className="text-red-500">*</span></Label>
                  <Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} data-testid="input-issue-date" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expiration Date</Label>
                  <Input type="date" value={form.expiration_date} onChange={(e) => setForm({ ...form, expiration_date: e.target.value })} data-testid="input-expiration-date" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Visits Authorized</Label>
                  <Input type="number" min="1" value={form.visits_authorized} onChange={(e) => setForm({ ...form, visits_authorized: e.target.value })} placeholder="Leave blank if unlimited" data-testid="input-visits-authorized" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Specialty Authorized</Label>
                  <Input value={form.specialty_authorized} onChange={(e) => setForm({ ...form, specialty_authorized: e.target.value })} placeholder="e.g. Cardiology, Physical Therapy" data-testid="input-specialty" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Diagnosis Authorized</Label>
                  <Input value={form.diagnosis_authorized} onChange={(e) => setForm({ ...form, diagnosis_authorized: e.target.value })} placeholder="Optional ICD-10 or description" data-testid="input-diagnosis-authorized" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Captured Via</Label>
                  <Select value={form.captured_via} onValueChange={(v) => setForm({ ...form, captured_via: v })}>
                    <SelectTrigger data-testid="select-captured-via"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAPTURED_VIA_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="pending_verification">Pending Verification</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setShowAddForm(false)} data-testid="button-cancel-referral">Cancel</Button>
                <Button
                  onClick={() => createMutation.mutate(form)}
                  disabled={createMutation.isPending || !form.pcp_name || !form.issue_date}
                  data-testid="button-save-referral"
                >
                  {createMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Save Referral
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical referrals (collapsed) */}
      {inactiveReferrals.length > 0 && (
        <Card data-testid="card-historical-referrals">
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowExpired((v) => !v)}>
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              {showExpired ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Historical Referrals ({inactiveReferrals.length})
            </CardTitle>
          </CardHeader>
          {showExpired && (
            <CardContent>
              <div className="space-y-3">
                {inactiveReferrals.map((ref) => (
                  <ReferralCard key={ref.id} referral={ref} />
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function ReferralCard({ referral: r, onRevoke }: { referral: any; onRevoke?: () => void }) {
  const cfg = REFERRAL_STATUS_CONFIG[r.status] || REFERRAL_STATUS_CONFIG.active;
  const isActive = r.status === "active";
  const visitsRemaining = r.visits_authorized != null
    ? Math.max(0, r.visits_authorized - (r.visits_used || 0))
    : null;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isActive ? "border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10" : "border-border bg-muted/30"}`} data-testid={`referral-card-${r.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="font-medium text-sm" data-testid={`text-pcp-name-${r.id}`}>{r.pcp_name}</p>
          {r.pcp_practice_name && <p className="text-xs text-muted-foreground">{r.pcp_practice_name}</p>}
          {r.pcp_npi && <p className="text-xs text-muted-foreground">NPI: {r.pcp_npi}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${cfg.badgeClass}`}>{cfg.label}</span>
          {isActive && onRevoke && (
            <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground" onClick={onRevoke} data-testid={`button-revoke-${r.id}`}>
              <XCircle className="h-3 w-3 mr-1" />Revoke
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {r.specialty_authorized && (
          <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />{r.specialty_authorized}</span>
        )}
        {r.referral_number && <span>Ref #: {r.referral_number}</span>}
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Issued: {r.issue_date ? format(new Date(r.issue_date), "MMM d, yyyy") : "—"}</span>
        {r.expiration_date && (
          <span className={`flex items-center gap-1 ${isActive && new Date(r.expiration_date) < new Date(Date.now() + 30 * 86400000) ? "text-amber-600 font-medium" : ""}`}>
            <Clock className="h-3 w-3" />Expires: {format(new Date(r.expiration_date), "MMM d, yyyy")}
          </span>
        )}
        {visitsRemaining !== null && (
          <span className={visitsRemaining <= 2 ? "text-orange-600 font-medium" : ""}>
            {visitsRemaining} / {r.visits_authorized} visits remaining
          </span>
        )}
        {r.captured_by_name && <span>Captured by: {r.captured_by_name}</span>}
      </div>
    </div>
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState("");

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

  const { data: enrollments = [] } = useQuery<any[]>({
    queryKey: ["/api/practice/payer-enrollments"],
    queryFn: async () => {
      const res = await fetch("/api/practice/payer-enrollments", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const enrolledPayerIds = new Set(
    enrollments.filter((e: any) => !e.disabled_at).map((e: any) => e.payer_id)
  );
  const enrolledPayers = enrolledPayerIds.size > 0
    ? payers.filter((p: any) => p.is_active && enrolledPayerIds.has(p.id))
    : payers.filter((p: any) => p.is_active);

  const archiveMutation = useMutation({
    mutationFn: async (reason: string) =>
      apiRequest("PATCH", `/api/billing/patients/${patientId}/archive`, { reason }),
    onSuccess: () => {
      setShowArchiveDialog(false);
      setArchiveReason("");
      setArchiveError("");
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients"] });
      toast({ title: "Patient archived", description: "The patient has been archived and hidden from default views." });
    },
    onError: async (err: any) => {
      try {
        const body = await err.response?.json();
        if (body?.code === "ACTIVE_CLAIMS") {
          setArchiveError(body.error);
          return;
        }
        setArchiveError(body?.error || "Failed to archive patient");
      } catch {
        setArchiveError("Failed to archive patient");
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", `/api/billing/patients/${patientId}/restore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients"] });
      toast({ title: "Patient restored", description: "The patient is now visible in your patient list again." });
    },
    onError: () => toast({ title: "Error", description: "Failed to restore patient", variant: "destructive" }),
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
      {/* Archive dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={(open) => { setShowArchiveDialog(open); if (!open) { setArchiveReason(""); setArchiveError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Patient</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This patient will be hidden from your patient list and cannot be used in new claims. Their record and history are permanently retained.
            </p>
            {archiveError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive" data-testid="text-archive-error">
                {archiveError}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="archive-reason">Reason (optional)</Label>
              <Input
                id="archive-reason"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="e.g. Discharged, duplicate record…"
                data-testid="input-archive-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)} data-testid="button-archive-cancel">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => archiveMutation.mutate(archiveReason)}
              disabled={archiveMutation.isPending}
              data-testid="button-archive-confirm"
            >
              {archiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Archive className="h-4 w-4 mr-2" />}
              Archive Patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archived banner */}
      {patient.archived_at && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-2.5" data-testid="banner-archived">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm">
            <Archive className="h-4 w-4 shrink-0" />
            <span>
              This patient was archived on {new Date(patient.archived_at).toLocaleDateString()}
              {patient.archive_reason ? ` · ${patient.archive_reason}` : ""}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
            data-testid="button-restore-patient"
          >
            {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Restore
          </Button>
        </div>
      )}

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
            {patient.is_demo && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-violet-600 border-violet-200 bg-violet-50 dark:bg-violet-950 dark:border-violet-800 cursor-default" data-testid="badge-demo-patient">
                      DEMO
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Sample data — will hide automatically once you have 5+ real patients</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {patient.dob && `DOB: ${patient.dob}`}
            {patient.insurance_carrier && (
              <span data-testid="text-insurance-summary">
                {` · `}
                {patient.insurance_carrier}
                {patient.plan_product && patient.plan_product !== "unknown"
                  ? ` (${patient.plan_product})`
                  : ""}
              </span>
            )}
            {patient.member_id && ` · ID: ${patient.member_id}`}
            {(!patient.plan_product || patient.plan_product === "unknown") && (
              <span className="text-amber-600 dark:text-amber-400 ml-1" data-testid="text-plan-product-missing">
                · Plan product: Not specified
              </span>
            )}
          </p>
        </div>
        {!patient.archived_at && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => { setArchiveError(""); setShowArchiveDialog(true); }}
            data-testid="button-archive-patient"
          >
            <Archive className="h-4 w-4 mr-1.5" />
            Archive Patient
          </Button>
        )}
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
          <TabsTrigger value="referrals" data-testid="tab-referrals" className={patient?.plan_product === "HMO" || patient?.plan_product === "POS" ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
            <Stethoscope className="h-4 w-4 mr-2" />
            Referrals
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
        <TabsContent value="referrals">
          <ReferralsTab patientId={patientId} patient={patient} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab patient={patient} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
