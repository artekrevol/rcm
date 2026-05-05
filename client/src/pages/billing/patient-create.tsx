import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { validateNPI } from "@shared/npi-validation";
import { Loader2, ArrowLeft, AlertTriangle, Info, Building2, GitBranch, User, FileText } from "lucide-react";

const REFERRAL_SOURCES_CLINICAL = [
  "Physician office",
  "Hospital discharge planner",
  "Emergency department",
  "Specialist referral",
  "Urgent care",
  "Skilled nursing facility transition",
  "Hospice / palliative care transition",
  "VA Community Care",
];
const REFERRAL_SOURCES_MARKETING = [
  "Google Search",
  "Google Maps / Local listing",
  "Facebook / Instagram",
  "Referral partner",
  "Community event",
  "Elder law attorney",
  "Church / faith community",
  "Word of mouth / family",
  "Website chat",
  "Inbound AI call",
  "Other",
];
const SEX_OPTIONS = ["Male", "Female", "Other"];
const RELATIONSHIP_OPTIONS = ["Self", "Spouse", "Child", "Other"];

interface ActivatedField {
  code: string;
  label: string;
  applies_to: string;
  data_type: string;
  required: boolean;
  activated_by: string[];
}

interface PlanProduct {
  code: string;
  label: string;
  parent_plan_family: string;
  plan_type: string;
  requires_pcp: boolean;
  requires_referral: boolean;
  is_government: boolean;
}

interface DelegatedEntity {
  id: string;
  name: string;
  entity_type: string;
  state: string | null;
  claims_payer_id_override: string | null;
}

function FadeField({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(visible);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else {
      timerRef.current = setTimeout(() => setMounted(false), 220);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [visible]);

  if (!mounted && !visible) return null;
  return (
    <div
      style={{
        transition: "opacity 200ms ease, transform 200ms ease",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-4px)",
      }}
    >
      {children}
    </div>
  );
}

export default function PatientCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [npiError, setNpiError] = useState("");

  const [form, setForm] = useState({
    firstName: "", middleName: "", lastName: "", dob: "", sex: "",
    payerId: "", insuranceCarrier: "", memberId: "", groupNumber: "",
    insuredName: "", relationshipToInsured: "", authorizationNumber: "",
    referringProviderName: "", referringProviderNpi: "",
    referralSource: "", referralPartnerName: "", otherReferralSource: "",
    defaultProviderId: "", serviceNeeded: "",
    phone: "", email: "", street: "", city: "", state: "", zip: "",
    secondaryPayerId: "", secondaryMemberId: "", secondaryGroupNumber: "",
    secondaryPlanName: "", secondaryRelationship: "Self",
    planProductCode: "",
    pcpId: "",
    pcpReferralNumber: "",
    delegatedEntityId: "",
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

  // Only show payers that the practice is enrolled with — so the claim will
  // actually process. Fall back to all active payers if no enrollments exist yet.
  const enrolledPayerIds = new Set(
    enrollments.filter((e: any) => !e.disabled_at).map((e: any) => e.payer_id)
  );
  const enrolledPayers = enrolledPayerIds.size > 0
    ? payers.filter((p: any) => p.is_active && enrolledPayerIds.has(p.id))
    : payers.filter((p: any) => p.is_active);
  const hasEnrollmentFilter = enrolledPayerIds.size > 0;

  // ── Activated fields (resolver) ───────────────────────────────────────────
  const activatedQuery = useQuery<ActivatedField[]>({
    queryKey: ["/api/practice/activated-fields", form.payerId, form.planProductCode],
    queryFn: async () => {
      if (!form.payerId || form.payerId === "__custom__") return [];
      const params = new URLSearchParams({ payerId: form.payerId });
      if (form.planProductCode) params.set("planProductCode", form.planProductCode);
      const res = await fetch(`/api/practice/activated-fields?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: Boolean(form.payerId && form.payerId !== "__custom__"),
    staleTime: 5 * 60 * 1000,
  });

  const activatedCodes = new Set((activatedQuery.data ?? []).map((f) => f.code));
  const showPlanProduct = activatedCodes.has("patient_plan_product");
  const showPcp = activatedCodes.has("patient_pcp_id");
  const showPcpReferral = activatedCodes.has("patient_pcp_referral_id");
  const showDelegatedEntity = activatedCodes.has("patient_delegated_entity_id");

  // ── Payer plan products ───────────────────────────────────────────────────
  const planProductsQuery = useQuery<PlanProduct[]>({
    queryKey: ["/api/billing/payers", form.payerId, "plan-products"],
    queryFn: async () => {
      const res = await fetch(`/api/billing/payers/${form.payerId}/plan-products`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: Boolean(showPlanProduct && form.payerId && form.payerId !== "__custom__"),
    staleTime: 10 * 60 * 1000,
  });

  // ── Delegated entities ────────────────────────────────────────────────────
  const delegatedQuery = useQuery<DelegatedEntity[]>({
    queryKey: ["/api/billing/payers", form.payerId, "delegated-entities", form.planProductCode, form.state],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (form.planProductCode) params.set("planProductCode", form.planProductCode);
      if (form.state) params.set("state", form.state.toUpperCase().slice(0, 2));
      const res = await fetch(`/api/billing/payers/${form.payerId}/delegated-entities?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: Boolean(showDelegatedEntity && form.payerId && form.payerId !== "__custom__"),
    staleTime: 5 * 60 * 1000,
  });

  // When payer changes, clear plan product and downstream fields
  function handlePayerChange(v: string) {
    if (v === "__custom__") {
      set({ payerId: "", insuranceCarrier: "", planProductCode: "", delegatedEntityId: "", pcpId: "", pcpReferralNumber: "" });
    } else {
      const payer = payers.find((p: any) => p.id === v);
      set({ payerId: v, insuranceCarrier: payer?.name || "", planProductCode: "", delegatedEntityId: "", pcpId: "", pcpReferralNumber: "" });
    }
  }

  // When plan product changes, clear downstream delegation/pcp fields
  function handlePlanProductChange(v: string) {
    set({ planProductCode: v, delegatedEntityId: "", pcpId: "", pcpReferralNumber: "" });
  }

  // ── Routing preview ───────────────────────────────────────────────────────
  const selectedPayer = payers.find((p: any) => p.id === form.payerId);
  const selectedDelegated = (delegatedQuery.data ?? []).find((d) => d.id === form.delegatedEntityId);
  const selectedPlanProduct = (planProductsQuery.data ?? []).find((pp) => pp.code === form.planProductCode);

  function getRoutingTarget() {
    if (!form.payerId || form.payerId === "__custom__") return null;
    if (selectedDelegated?.claims_payer_id_override) {
      return `${selectedDelegated.name} (EDI ID: ${selectedDelegated.claims_payer_id_override})`;
    }
    if (selectedDelegated) {
      return `${selectedDelegated.name} via ${selectedPayer?.name || "selected payer"}`;
    }
    return selectedPayer?.name || null;
  }

  const routingTarget = getRoutingTarget();

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/billing/patients", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients"] });
      toast({ title: "Patient created" });
      navigate(`/billing/patients/${data.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Error creating patient", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit() {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.dob.trim()) {
      toast({ title: "First name, last name, and date of birth are required", variant: "destructive" });
      return;
    }
    if (form.referringProviderNpi && !validateNPI(form.referringProviderNpi)) {
      setNpiError("Invalid NPI — must be 10 digits and pass checksum");
      return;
    }
    const referralSource = form.referralSource === "Other" ? form.otherReferralSource : form.referralSource;
    createMutation.mutate({
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim() || null,
      lastName: form.lastName.trim(),
      dob: form.dob,
      sex: form.sex || null,
      insuranceCarrier: form.insuranceCarrier || null,
      memberId: form.memberId || null,
      groupNumber: form.groupNumber || null,
      insuredName: form.insuredName || null,
      relationshipToInsured: form.relationshipToInsured || null,
      authorizationNumber: form.authorizationNumber || null,
      referringProviderName: form.referringProviderName || null,
      referringProviderNpi: form.referringProviderNpi || null,
      referralSource: referralSource || null,
      referralPartnerName: form.referralSource === "Referral partner" ? form.referralPartnerName : null,
      defaultProviderId: form.defaultProviderId || null,
      serviceNeeded: form.serviceNeeded || null,
      phone: form.phone || null,
      email: form.email || null,
      payerId: form.payerId || null,
      state: form.state || null,
      address: {
        street: form.street || "",
        city: form.city || "",
        zip: form.zip || "",
      },
      secondaryPayerId: form.secondaryPayerId || null,
      secondaryMemberId: form.secondaryMemberId || null,
      secondaryGroupNumber: form.secondaryGroupNumber || null,
      secondaryPlanName: form.secondaryPlanName || null,
      secondaryRelationship: form.secondaryRelationship || null,
      planProductCode: form.planProductCode || null,
      delegatedEntityId: form.delegatedEntityId || null,
      pcpId: form.pcpId || null,
      pcpReferralNumber: form.pcpReferralNumber || null,
    });
  }

  const f = form;
  const set = (updates: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...updates }));

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/billing/patients")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">New Patient</h1>
          <p className="text-muted-foreground">Create a new patient record for billing</p>
        </div>
      </div>

      {/* Demographics */}
      <Card>
        <CardHeader>
          <CardTitle>Demographics</CardTitle>
          <CardDescription>Fields marked <span className="text-red-600 font-semibold">Required</span> must be completed before saving.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>First Name <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} data-testid="input-first-name" />
            </div>
            <div className="space-y-2">
              <Label>Middle Name <span className="ml-1 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optional</span></Label>
              <Input value={f.middleName} onChange={(e) => set({ middleName: e.target.value })} data-testid="input-middle-name" />
            </div>
            <div className="space-y-2">
              <Label>Last Name <span className="ml-1 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Required</span></Label>
              <Input value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} data-testid="input-last-name" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Date of Birth *</Label>
              <Input value={f.dob} onChange={(e) => set({ dob: e.target.value })} placeholder="MM/DD/YYYY" data-testid="input-dob" />
            </div>
            <div className="space-y-2">
              <Label>Sex</Label>
              <Select value={f.sex} onValueChange={(v) => set({ sex: v })}>
                <SelectTrigger data-testid="select-sex"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {SEX_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={f.phone} onChange={(e) => set({ phone: e.target.value })} data-testid="input-phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Street Address <span className="text-muted-foreground text-xs font-normal">(used in EDI — CMS-1500 Box 5)</span></Label>
              <Input value={f.street} onChange={(e) => set({ street: e.target.value })} placeholder="208 Cypress Avenue" data-testid="input-street" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>City</Label>
              <Input value={f.city} onChange={(e) => set({ city: e.target.value })} placeholder="South San Francisco" data-testid="input-city" />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={f.state} onChange={(e) => set({ state: e.target.value })} maxLength={2} placeholder="CA" data-testid="input-state" />
            </div>
            <div className="space-y-2">
              <Label>ZIP</Label>
              <Input value={f.zip} onChange={(e) => set({ zip: e.target.value })} maxLength={10} placeholder="94080" data-testid="input-zip" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={f.email} onChange={(e) => set({ email: e.target.value })} type="email" data-testid="input-email" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insurance Information */}
      <Card>
        <CardHeader>
          <CardTitle>Insurance Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Insurance Carrier
                {hasEnrollmentFilter && (
                  <span className="text-[10px] font-normal text-muted-foreground border rounded px-1 py-0.5">Enrolled only</span>
                )}
              </Label>
              <Select
                value={f.payerId || "__custom__"}
                onValueChange={handlePayerChange}
              >
                <SelectTrigger data-testid="select-insurance-carrier">
                  <SelectValue placeholder="Select payer..." />
                </SelectTrigger>
                <SelectContent>
                  {enrolledPayers.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                  <SelectItem value="__custom__">Other / Enter manually</SelectItem>
                </SelectContent>
              </Select>
              {(f.payerId === "" || f.payerId === "__custom__") && (
                <Input
                  value={f.insuranceCarrier}
                  onChange={(e) => set({ insuranceCarrier: e.target.value })}
                  placeholder="Enter carrier name"
                  data-testid="input-insurance-carrier"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Member ID</Label>
              <Input value={f.memberId} onChange={(e) => set({ memberId: e.target.value })} data-testid="input-member-id" />
            </div>
          </div>

          {/* ── Plan Product (conditional) ── */}
          <FadeField visible={showPlanProduct}>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Plan Product
                  <Badge variant="secondary" className="text-xs font-normal">Required for billing rules</Badge>
                </Label>
                {planProductsQuery.isLoading ? (
                  <div className="flex items-center gap-2 h-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Loading plan products…
                  </div>
                ) : (
                  <Select value={f.planProductCode || "__none__"} onValueChange={(v) => handlePlanProductChange(v === "__none__" ? "" : v)}>
                    <SelectTrigger data-testid="select-plan-product">
                      <SelectValue placeholder="Select plan product…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select plan product…</SelectItem>
                      {(planProductsQuery.data ?? []).map((pp) => (
                        <SelectItem key={pp.code} value={pp.code}>
                          {pp.label}
                          <span className="ml-1.5 text-xs text-muted-foreground">({pp.plan_type})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </FadeField>

          {/* ── Delegated Entity (conditional) ── */}
          <FadeField visible={showDelegatedEntity && Boolean(f.planProductCode)}>
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Delegated Medical Group / IPA
                </Label>
                {delegatedQuery.isLoading ? (
                  <div className="flex items-center gap-2 h-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Loading delegated entities…
                  </div>
                ) : (delegatedQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No delegated entities on file for this payer / plan / state combination.</p>
                ) : (
                  <Select value={f.delegatedEntityId || "__none__"} onValueChange={(v) => set({ delegatedEntityId: v === "__none__" ? "" : v })}>
                    <SelectTrigger data-testid="select-delegated-entity">
                      <SelectValue placeholder="Select IPA / medical group…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None / Not delegated</SelectItem>
                      {(delegatedQuery.data ?? []).map((de) => (
                        <SelectItem key={de.id} value={de.id}>
                          {de.name}
                          {de.state && <span className="ml-1.5 text-xs text-muted-foreground">({de.state})</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </FadeField>

          {/* ── PCP fields (conditional) ── */}
          <FadeField visible={showPcp || showPcpReferral}>
            <div className="grid grid-cols-2 gap-4">
              <FadeField visible={showPcp}>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <User className="h-4 w-4 text-muted-foreground" />
                    PCP Name
                  </Label>
                  <Input
                    value={f.pcpId}
                    onChange={(e) => set({ pcpId: e.target.value })}
                    placeholder="Primary Care Physician name"
                    data-testid="input-pcp-id"
                  />
                </div>
              </FadeField>
              <FadeField visible={showPcpReferral}>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    PCP Referral #
                  </Label>
                  <Input
                    value={f.pcpReferralNumber}
                    onChange={(e) => set({ pcpReferralNumber: e.target.value })}
                    placeholder="Referral authorization number"
                    data-testid="input-pcp-referral-number"
                  />
                </div>
              </FadeField>
            </div>
            {(showPcp || showPcpReferral) && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mt-2">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Required for HMO plans. Missing PCP referral may result in claim denial.
              </p>
            )}
          </FadeField>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Group Number</Label>
              <Input value={f.groupNumber} onChange={(e) => set({ groupNumber: e.target.value })} data-testid="input-group-number" />
            </div>
            <div className="space-y-2">
              <Label>Insured Name</Label>
              <Input value={f.insuredName} onChange={(e) => set({ insuredName: e.target.value })} data-testid="input-insured-name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship to Insured</Label>
              <Select value={f.relationshipToInsured} onValueChange={(v) => set({ relationshipToInsured: v })}>
                <SelectTrigger data-testid="select-relationship"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Authorization Number</Label>
            <Input value={f.authorizationNumber} onChange={(e) => set({ authorizationNumber: e.target.value })} data-testid="input-auth-number" />
          </div>
        </CardContent>
      </Card>

      {/* Secondary Insurance (COB) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Secondary Insurance (COB)
            <span className="text-xs font-normal text-muted-foreground ml-1">Coordination of Benefits — optional</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Secondary Payer</Label>
              <Select
                value={f.secondaryPayerId || "__none__"}
                onValueChange={(v) => set({ secondaryPayerId: v === "__none__" ? "" : v })}
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
              <Label>Member ID</Label>
              <Input value={f.secondaryMemberId} onChange={(e) => set({ secondaryMemberId: e.target.value })} placeholder="Secondary member ID" data-testid="input-secondary-member-id" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Group Number</Label>
              <Input value={f.secondaryGroupNumber} onChange={(e) => set({ secondaryGroupNumber: e.target.value })} placeholder="Group #" data-testid="input-secondary-group" />
            </div>
            <div className="space-y-2">
              <Label>Plan Name</Label>
              <Input value={f.secondaryPlanName} onChange={(e) => set({ secondaryPlanName: e.target.value })} placeholder="Plan name (optional)" data-testid="input-secondary-plan-name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship</Label>
              <Select value={f.secondaryRelationship} onValueChange={(v) => set({ secondaryRelationship: v })}>
                <SelectTrigger data-testid="select-secondary-relationship"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["Self", "Spouse", "Child", "Other"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Referral & Provider */}
      <Card>
        <CardHeader>
          <CardTitle>Referral &amp; Provider</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Referring Provider Name</Label>
              <Input value={f.referringProviderName} onChange={(e) => set({ referringProviderName: e.target.value })} data-testid="input-referring-provider-name" />
            </div>
            <div className="space-y-2">
              <Label>Referring Provider NPI</Label>
              <Input
                value={f.referringProviderNpi}
                maxLength={10}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                  set({ referringProviderNpi: v });
                  if (npiError && v.length === 10 && validateNPI(v)) setNpiError("");
                }}
                className={npiError ? "border-destructive" : ""}
                data-testid="input-referring-provider-npi"
              />
              {npiError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />{npiError}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Referral Source</Label>
            <Select value={f.referralSource} onValueChange={(v) => set({ referralSource: v })}>
              <SelectTrigger data-testid="select-referral-source"><SelectValue placeholder="Select referral source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__clinical_header" disabled>— Clinical Referrals —</SelectItem>
                {REFERRAL_SOURCES_CLINICAL.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="__marketing_header" disabled>— Marketing / Business Development —</SelectItem>
                {REFERRAL_SOURCES_MARKETING.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {f.referralSource === "Referral partner" && (
              <Input value={f.referralPartnerName} onChange={(e) => set({ referralPartnerName: e.target.value })} placeholder="Partner name" data-testid="input-referral-partner-name" />
            )}
            {f.referralSource === "Other" && (
              <Input value={f.otherReferralSource} onChange={(e) => set({ otherReferralSource: e.target.value })} placeholder="Describe referral source" data-testid="input-other-referral-source" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Provider</Label>
              <Select value={f.defaultProviderId} onValueChange={(v) => set({ defaultProviderId: v })}>
                <SelectTrigger data-testid="select-default-provider"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  {providers.filter((p: any) => p.is_active).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}{p.credentials ? `, ${p.credentials}` : ""}{p.is_default ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Service Needed</Label>
              <Input value={f.serviceNeeded} onChange={(e) => set({ serviceNeeded: e.target.value })} placeholder="e.g. Skilled Nursing" data-testid="input-service-needed" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Routing Preview Pane */}
      {form.payerId && form.payerId !== "__custom__" && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <GitBranch className="h-4 w-4" />
              Claim Routing Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {activatedQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Evaluating payer rules…
              </div>
            ) : (
              <div className="space-y-2 text-sm" data-testid="routing-preview">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground min-w-28">Claims route to:</span>
                  <span className="font-medium" data-testid="text-routing-target">
                    {routingTarget ?? <span className="text-muted-foreground italic">—</span>}
                  </span>
                </div>
                {selectedPlanProduct && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-28">Plan type:</span>
                    <span className="font-medium">{selectedPlanProduct.label}</span>
                    <div className="flex gap-1 flex-wrap">
                      {selectedPlanProduct.requires_pcp && <Badge variant="outline" className="text-xs">PCP Required</Badge>}
                      {selectedPlanProduct.requires_referral && <Badge variant="outline" className="text-xs">Referral Required</Badge>}
                      {selectedPlanProduct.is_government && <Badge variant="outline" className="text-xs">Government</Badge>}
                    </div>
                  </div>
                )}
                {activatedCodes.size > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-28">Active rules:</span>
                    <span className="text-xs text-muted-foreground">
                      {(activatedQuery.data ?? []).filter(f => !f.required).map(f => f.label).join(", ") || "Universal fields only"}
                    </span>
                  </div>
                )}
                {!form.planProductCode && showPlanProduct && (
                  <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs">
                    <Info className="h-3.5 w-3.5" />
                    Select a plan product to see full field requirements for this payer.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate("/billing/patients")} data-testid="button-cancel">Cancel</Button>
        <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-create-patient">
          {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create Patient
        </Button>
      </div>
    </div>
  );
}
