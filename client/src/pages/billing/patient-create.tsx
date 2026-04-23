import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, ArrowLeft, AlertTriangle } from "lucide-react";

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

export default function PatientCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [npiError, setNpiError] = useState("");

  const [form, setForm] = useState({
    firstName: "", lastName: "", dob: "", sex: "",
    payerId: "", insuranceCarrier: "", memberId: "", groupNumber: "",
    insuredName: "", relationshipToInsured: "", authorizationNumber: "",
    referringProviderName: "", referringProviderNpi: "",
    referralSource: "", referralPartnerName: "", otherReferralSource: "",
    defaultProviderId: "", serviceNeeded: "",
    phone: "", email: "", street: "", city: "", state: "", zip: "",
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
    });
  }

  const f = form;
  const set = (updates: Partial<typeof form>) => setForm({ ...form, ...updates });

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

      <Card>
        <CardHeader>
          <CardTitle>Demographics</CardTitle>
          <CardDescription>Required fields marked with *</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First Name *</Label>
              <Input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} data-testid="input-first-name" />
            </div>
            <div className="space-y-2">
              <Label>Last Name *</Label>
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

      <Card>
        <CardHeader>
          <CardTitle>Insurance Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Insurance Carrier</Label>
              <Select
                value={f.payerId || "__custom__"}
                onValueChange={(v) => {
                  if (v === "__custom__") {
                    set({ payerId: "", insuranceCarrier: "" });
                  } else {
                    const payer = payers.find((p: any) => p.id === v);
                    set({ payerId: v, insuranceCarrier: payer?.name || "" });
                  }
                }}
              >
                <SelectTrigger data-testid="select-insurance-carrier">
                  <SelectValue placeholder="Select payer..." />
                </SelectTrigger>
                <SelectContent>
                  {payers.filter((p: any) => p.is_active).map((p: any) => (
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

      <Card>
        <CardHeader>
          <CardTitle>Referral & Provider</CardTitle>
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
