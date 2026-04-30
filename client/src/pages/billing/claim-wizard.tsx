import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  User,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Shield,
  Copy,
  Clock,
  DollarSign,
  Info,
  FlaskConical,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { validateNPI } from "@shared/npi-validation";
import { generateAndDownloadClaimPdf } from "@/lib/generate-claim-pdf";

const ICD10_COMMON = [
  { code: "Z51.11", desc: "Encounter for antineoplastic chemotherapy" },
  { code: "Z51.12", desc: "Encounter for antineoplastic immunotherapy" },
  { code: "I10", desc: "Essential (primary) hypertension" },
  { code: "E11.9", desc: "Type 2 diabetes mellitus without complications" },
  { code: "J44.1", desc: "COPD with acute exacerbation" },
  { code: "I50.9", desc: "Heart failure, unspecified" },
  { code: "M79.3", desc: "Panniculitis, unspecified" },
  { code: "G89.29", desc: "Other chronic pain" },
  { code: "Z96.1", desc: "Presence of intraocular lens" },
  { code: "Z87.39", desc: "Personal history of other diseases of musculoskeletal system" },
  { code: "Z74.1", desc: "Need for assistance with personal care" },
  { code: "Z74.2", desc: "Need for assistance at home" },
  { code: "Z74.3", desc: "Need for continuous supervision" },
  { code: "R26.2", desc: "Difficulty in walking, not elsewhere classified" },
  { code: "Z99.81", desc: "Dependence on supplemental oxygen" },
  { code: "Z99.11", desc: "Dependence on respirator [ventilator] status" },
  { code: "M62.81", desc: "Muscle weakness (generalized)" },
  { code: "R53.1", desc: "Weakness" },
  { code: "Z48.812", desc: "Encounter for surgical aftercare following surgery on the circulatory system" },
  { code: "L89.90", desc: "Pressure ulcer of unspecified site, unstageable" },
];

const POS_OPTIONS = [
  { value: "11", label: "Office (11)" },
  { value: "12", label: "Home (12)" },
  { value: "10", label: "Telehealth - Patient Home (10)" },
  { value: "13", label: "Assisted Living Facility (13)" },
  { value: "19", label: "Off Campus Outpatient Hospital (19)" },
  { value: "21", label: "Inpatient Hospital (21)" },
  { value: "22", label: "Outpatient Hospital (22)" },
  { value: "23", label: "Emergency Room (23)" },
  { value: "24", label: "Ambulatory Surgical Center (24)" },
  { value: "31", label: "Skilled Nursing Facility (31)" },
  { value: "32", label: "Nursing Facility (32)" },
  { value: "49", label: "Independent Clinic (49)" },
  { value: "81", label: "Independent Laboratory (81)" },
  { value: "99", label: "Other (99)" },
];

interface ServiceLine {
  code: string;
  description: string;
  modifier: string;
  diagnosisPointers: string;
  unitType: string;
  unitIntervalMinutes: number | null;
  hours: string;
  units: string;
  ratePerUnit: string;
  totalCharge: string;
  chargeOverridden: boolean;
  requiresModifier: boolean;
  manualEntry: boolean;
  vaRate: string | null;
  locationName: string | null;
  isAverageRate: boolean;
}

const CLAIM_FREQUENCY_CODES = [
  { value: "1", label: "1 – Original claim" },
  { value: "7", label: "7 – Replacement of prior claim" },
  { value: "8", label: "8 – Void/cancel of prior claim" },
];

const DELAY_REASON_CODES = [
  { value: "none", label: "None" },
  { value: "1", label: "1 – Proof of eligibility unknown" },
  { value: "2", label: "2 – Litigation" },
  { value: "3", label: "3 – Authorization delays" },
  { value: "4", label: "4 – Delay in certifying provider" },
  { value: "5", label: "5 – Delay in supplying billing forms" },
  { value: "6", label: "6 – Delay in delivering dental models" },
  { value: "7", label: "7 – Third party processing delay" },
  { value: "8", label: "8 – Administrative delay in review" },
  { value: "9", label: "9 – Original claim rejected or denied" },
  { value: "10", label: "10 – Administration delay in prior auth" },
  { value: "11", label: "11 – Other" },
  { value: "15", label: "15 – Natural disaster" },
];

const VALIDATION_ERROR_MAP: Record<string, { plain: string; fix: string; step: string }> = {
  "SV1-07": { plain: "Diagnosis pointer must be numeric (1,2,3,4)", fix: "Go to service lines and correct the diagnosis pointer", step: "service_lines" },
  "NM109":  { plain: "Provider NPI is missing or invalid (must be 10 digits)", fix: "Check Settings → Providers → NPI field", step: "provider" },
  "CLM05":  { plain: "Place of service code is missing or invalid", fix: "Check the Place of Service field in claim details", step: "claim_info" },
  "HI":     { plain: "Diagnosis code format is invalid — remove any decimal points", fix: "ICD-10 codes in EDI must not contain periods (I10 not I1.0)", step: "diagnoses" },
  "DTP":    { plain: "Date format is invalid — must be CCYYMMDD", fix: "Check date of service format", step: "claim_info" },
  "REF":    { plain: "Reference number (auth/referral) format is invalid", fix: "Check the authorization number field", step: "claim_info" },
  "CLM01":  { plain: "Claim control number is missing or invalid", fix: "Ensure the claim has been saved before submitting", step: "claim_info" },
  "NM103":  { plain: "Organization or last name is missing", fix: "Check Practice Settings → Practice Name", step: "provider" },
  "NM104":  { plain: "First name is missing for individual provider", fix: "Check provider first name in Settings → Providers", step: "provider" },
  "PWK":    { plain: "Attachment control number format is invalid", fix: "Review any attachment references on the claim", step: "claim_info" },
};

function mapValidationError(err: any): { plain: string; fix: string; code: string } {
  const code = (typeof err === "string") ? err : (err.code || "UNKNOWN");
  const rawMsg = (typeof err === "string") ? err : (err.message || "Unknown error");
  for (const [key, val] of Object.entries(VALIDATION_ERROR_MAP)) {
    if (code.includes(key) || rawMsg.includes(key)) {
      return { plain: val.plain, fix: val.fix, code };
    }
  }
  return { plain: rawMsg, fix: "Review the flagged field and correct before resubmitting", code };
}

function emptyLine(): ServiceLine {
  return {
    code: "", description: "", modifier: "", diagnosisPointers: "A",
    unitType: "per_visit", unitIntervalMinutes: null, hours: "", units: "1",
    ratePerUnit: "", totalCharge: "", chargeOverridden: false,
    requiresModifier: false, manualEntry: false, vaRate: null,
    locationName: null, isAverageRate: false,
  };
}

function StepIndicator({ current }: { current: number }) {
  const steps = ["Patient", "Service", "Review"];
  return (
    <div className="flex items-center gap-2 mb-6" data-testid="step-indicator">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
            i === current ? "bg-primary text-primary-foreground" : i < current ? "bg-green-600 text-white" : "bg-muted text-muted-foreground"
          }`} data-testid={`step-${i}`}>
            {i < current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </div>
          <span className={`text-sm ${i === current ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
          {i < 2 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

const PLAN_PRODUCT_OPTIONS = [
  { value: "HMO", label: "HMO" },
  { value: "PPO", label: "PPO" },
  { value: "POS", label: "POS" },
  { value: "EPO", label: "EPO" },
  { value: "Indemnity", label: "Indemnity" },
  { value: "unknown", label: "Unknown / Not specified" },
];

function PatientSearch({ onSelect, selectedPatient }: {
  onSelect: (patient: any) => void;
  selectedPatient: any;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [planProduct, setPlanProduct] = useState<string>(selectedPatient?.plan_product || "");
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    setPlanProduct(selectedPatient?.plan_product || "");
  }, [selectedPatient?.id]);

  async function handlePlanProductChange(value: string) {
    if (!selectedPatient?.id) return;
    setPlanProduct(value);
    setSavingPlan(true);
    try {
      const res = await apiRequest("PATCH", `/api/billing/patients/${selectedPatient.id}`, {
        planProduct: value === "unknown" ? "unknown" : value || null,
      });
      if (!res.ok) throw new Error("Failed to save");
      onSelect({ ...selectedPatient, plan_product: value });
    } catch {
      toast({ title: "Error saving plan product", variant: "destructive" });
    } finally {
      setSavingPlan(false);
    }
  }

  function handleChange(val: string) {
    setSearch(val);
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => setDebouncedSearch(val.trim()), 300));
  }

  const { data: patients = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", "search", debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch) return [];
      const res = await fetch(`/api/billing/patients?search=${encodeURIComponent(debouncedSearch)}`, { credentials: "include" });
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: debouncedSearch.length > 0,
  });

  useEffect(() => {
    setShowDropdown(debouncedSearch.length > 0 && patients.length > 0 && !selectedPatient);
  }, [patients, debouncedSearch, selectedPatient]);

  if (selectedPatient) {
    const effectivePlanProduct = planProduct || selectedPatient.plan_product || "";
    return (
      <div className="space-y-3">
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20" data-testid="card-selected-patient">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg" data-testid="text-selected-name">
                    {selectedPatient.first_name || ""} {selectedPatient.last_name || selectedPatient.lead_name || "Unknown"}
                  </h3>
                  {selectedPatient.vob_verified && (
                    <Badge variant="outline" className="text-green-700 border-green-300 bg-green-100" data-testid="badge-vob-verified">
                      <CheckCircle2 className="h-3 w-3 mr-1" />VOB Verified
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  {selectedPatient.dob && <p>DOB: {selectedPatient.dob}</p>}
                  {selectedPatient.insurance_carrier && (
                    <p data-testid="text-wizard-insurance">
                      Insurance: {selectedPatient.insurance_carrier}
                      {effectivePlanProduct && effectivePlanProduct !== "unknown" ? ` (${effectivePlanProduct})` : ""}
                    </p>
                  )}
                  {selectedPatient.member_id && <p>Member ID: {selectedPatient.member_id}</p>}
                  {selectedPatient.authorization_number && <p>Auth #: {selectedPatient.authorization_number}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/billing/patients/${selectedPatient.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                  data-testid="link-edit-patient"
                >
                  Edit patient <ExternalLink className="h-3 w-3" />
                </a>
                <Button variant="ghost" size="sm" onClick={() => { onSelect(null); setSearch(""); setDebouncedSearch(""); }} data-testid="button-change-patient">
                  Change
                </Button>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-800">
              <div className="flex items-center gap-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Plan Product</Label>
                <Select
                  value={effectivePlanProduct || "__none__"}
                  onValueChange={(v) => handlePlanProductChange(v === "__none__" ? "unknown" : v)}
                  disabled={savingPlan}
                >
                  <SelectTrigger className="h-7 text-xs w-48" data-testid="select-wizard-plan-product">
                    <SelectValue placeholder="Select plan product…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unknown / Not specified</SelectItem>
                    {PLAN_PRODUCT_OPTIONS.filter(o => o.value !== "unknown").map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {savingPlan && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Plan product affects which rules apply and will be recorded on the claim.
              </p>
            </div>
          </CardContent>
        </Card>
        {effectivePlanProduct === "HMO" && (
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg" data-testid="banner-hmo-referral">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <span className="font-medium">HMO plan detected.</span> HMO plans typically require a PCP referral for specialist visits. We'll prompt for referral info before claim submission.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search patients by name or DOB..."
          className="pl-10"
          data-testid="input-patient-search"
          onFocus={() => { if (patients.length > 0) setShowDropdown(true); }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        />
        {showDropdown && (
          <Card className="absolute z-50 w-full mt-1 shadow-lg" data-testid="dropdown-patients">
            <CardContent className="p-1 max-h-60 overflow-y-auto">
              {patients.map((p: any) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent rounded text-sm flex justify-between items-center"
                  onMouseDown={(e) => { e.preventDefault(); onSelect(p); setShowDropdown(false); }}
                  data-testid={`option-patient-${p.id}`}
                >
                  <span className="font-medium">
                    {p.first_name || ""} {p.last_name || p.lead_name || "Unknown"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {p.dob || ""} {p.insurance_carrier ? `• ${p.insurance_carrier}` : ""}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      {debouncedSearch && patients.length === 0 && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          No patients found.
          <a href="/billing/patients/new" target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1" data-testid="link-create-patient">
            Create new patient <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

function ManualInlineForm({ code, onSelect }: { code: string; onSelect: (result: any) => void }) {
  const { toast } = useToast();
  const [mc, setMc] = useState(code);
  const [desc, setDesc] = useState("");
  const [unitType, setUnitType] = useState("per_visit");
  const [interval, setInterval] = useState("");
  const [rate, setRate] = useState("");

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="grid grid-cols-2 gap-2">
        <Input value={mc} onChange={(e) => setMc(e.target.value)} placeholder="Code" className="h-8 text-sm" data-testid="input-inline-manual-code" />
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className="h-8 text-sm" data-testid="input-inline-manual-desc" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select value={unitType} onValueChange={setUnitType}>
          <SelectTrigger className="h-8 text-sm" data-testid="select-inline-unit-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="time_based">Time-based</SelectItem>
            <SelectItem value="per_visit">Per visit</SelectItem>
            <SelectItem value="per_diem">Per diem</SelectItem>
            <SelectItem value="quantity">Quantity</SelectItem>
          </SelectContent>
        </Select>
        {unitType === "time_based" && (
          <Input value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="Interval (min)" type="number" className="h-8 text-sm" data-testid="input-inline-interval" />
        )}
        <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate/unit ($)" type="number" step="0.01" className="h-8 text-sm" data-testid="input-inline-rate" />
      </div>
      <Button size="sm" variant="outline" onClick={() => {
        if (!mc.trim() || !desc.trim()) { toast({ title: "Code and description required", variant: "destructive" }); return; }
        onSelect({
          code: mc.trim().toUpperCase(),
          description_plain: desc.trim(),
          unit_type: unitType,
          unit_interval_minutes: unitType === "time_based" ? (Number(interval) || 15) : null,
          va_rate: rate || null,
          requires_modifier: false,
          manual: true,
        });
      }} data-testid="button-use-manual-code">Use this code</Button>
    </div>
  );
}

function InlineCodeSearch({ onSelect, initialQuery = "" }: { onSelect: (result: any) => void; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [dq, setDq] = useState(initialQuery.trim());
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (initialQuery) {
      setQ(initialQuery);
      setDq(initialQuery.trim());
    }
  }, [initialQuery]);

  function handleChange(val: string) {
    setQ(val);
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => setDq(val.trim()), 300));
  }

  const { data: results = [], isFetching } = useQuery<any[]>({
    queryKey: ["/api/billing/hcpcs/search", dq],
    queryFn: async () => {
      if (!dq) return [];
      const res = await fetch(`/api/billing/hcpcs/search?q=${encodeURIComponent(dq)}`, { credentials: "include" });
      const data = await res.json();
      return Array.isArray(data) ? data : data?.results || data?.data || [];
    },
    enabled: dq.length > 0,
  });

  const safeResults = Array.isArray(results) ? results : [];
  const noResults = dq.length > 0 && !isFetching && safeResults.length === 0;

  return (
    <div className="space-y-2 border rounded-md p-3 bg-muted/30">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search code or description..."
          className="pl-8 h-8 text-sm"
          data-testid="input-code-search"
        />
      </div>
      {safeResults.map((r: any) => (
        <button
          key={r.code}
          className="w-full text-left p-2 hover:bg-accent rounded text-sm border bg-background"
          onClick={() => onSelect(r)}
          data-testid={`option-code-${r.code}`}
        >
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">{r.code}</Badge>
            <span className="truncate">{r.description_plain || r.description_official}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {r.va_rate ? `VA: $${Number(r.va_rate).toFixed(2)}` : ""} • {r.unit_type === "time_based" ? `Time-based (${r.unit_interval_minutes}min)` : r.unit_type}
          </div>
        </button>
      ))}
      {noResults && !showManual && (
        <div className="text-sm text-center py-2">
          <p className="text-muted-foreground">No results for "{dq}"</p>
          <Button variant="link" size="sm" onClick={() => { setShowManual(true); setManualCode(dq.toUpperCase()); }} data-testid="button-manual-code-entry">
            <Plus className="h-3 w-3 mr-1" /> Enter code manually
          </Button>
        </div>
      )}
      {showManual && (
        <ManualInlineForm code={manualCode} onSelect={(result) => { onSelect(result); setShowManual(false); }} />
      )}
    </div>
  );
}

function isVACode(code: string) {
  const upper = code.toUpperCase();
  return /^(G02|G01|T10|S91)/.test(upper);
}

function ServiceLineRow({ line, index, onChange, onRemove, patientPayer, billingLocation }: {
  line: ServiceLine; index: number;
  onChange: (index: number, updates: Partial<ServiceLine>) => void;
  onRemove: (index: number) => void;
  patientPayer: string | null;
  billingLocation: string | null;
}) {
  const [showCodeSearch, setShowCodeSearch] = useState(false);
  const { data: vaLocations = [] } = useQuery<string[]>({
    queryKey: ["/api/billing/va-locations"],
    queryFn: () => fetch("/api/billing/va-locations", { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  async function lookupRate(code: string, location: string | null) {
    try {
      const params = new URLSearchParams({ code });
      if (location) params.set("location", location);
      const res = await fetch(`/api/billing/va-rate?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.rate_per_unit) {
          const rate = String(data.rate_per_unit);
          const units = parseInt(line.units) || 0;
          const total = units * parseFloat(rate);
          onChange(index, {
            ratePerUnit: rate,
            vaRate: rate,
            locationName: data.location_name || null,
            isAverageRate: !!data.is_average,
            totalCharge: total > 0 ? total.toFixed(2) : "",
            chargeOverridden: false,
          });
          return;
        }
      }
    } catch {}
    onChange(index, { locationName: null, isAverageRate: false });
  }

  const payerLowerForEffect = (patientPayer || "").toLowerCase().replace(/\s+/g, "");
  const isVAForEffect = payerLowerForEffect.includes("va") || payerLowerForEffect.includes("triwest") || payerLowerForEffect.includes("vaccn");

  // Auto-trigger rate lookup when a VA code is added and locality isn't set yet
  useEffect(() => {
    if (line.code && isVACode(line.code) && isVAForEffect && !line.locationName && !line.ratePerUnit) {
      lookupRate(line.code, billingLocation);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.code, billingLocation]);

  async function handleCodeSelect(result: any) {
    const payerLower = (patientPayer || "").toLowerCase().replace(/\s+/g, "");
    const isVA = payerLower.includes("va") || payerLower.includes("triwest") || payerLower.includes("vaccn");
    let rate = "";
    let locationName: string | null = null;
    let isAverageRate = false;

    if (isVA && result.code) {
      try {
        const loc = billingLocation;
        const params = new URLSearchParams({ code: result.code });
        if (loc) params.set("location", loc);
        const res = await fetch(`/api/billing/va-rate?${params}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.rate_per_unit) {
            rate = String(data.rate_per_unit);
            locationName = data.location_name || loc || null;
            isAverageRate = !!data.is_average;
          }
        }
      } catch {}
    }

    const newRate = rate || (result.va_rate ? String(result.va_rate) : null);
    const finalRate = newRate || "";
    const existingUnits = line.units || (result.unit_type === "time_based" ? "" : "1");
    const unitsNum = parseInt(existingUnits) || 0;
    const rateNum = parseFloat(finalRate) || 0;
    const computedTotal = unitsNum > 0 && rateNum > 0 ? (unitsNum * rateNum).toFixed(2) : "";
    onChange(index, {
      code: result.code,
      description: result.description_plain || result.description_official || "",
      unitType: result.unit_type || "per_visit",
      unitIntervalMinutes: result.unit_interval_minutes || null,
      vaRate: newRate,
      ratePerUnit: finalRate,
      requiresModifier: result.requires_modifier || false,
      manualEntry: result.manual || false,
      hours: line.hours || "",
      units: existingUnits,
      totalCharge: computedTotal || (line.chargeOverridden ? line.totalCharge : ""),
      chargeOverridden: computedTotal ? false : (line.chargeOverridden || false),
      locationName,
      isAverageRate,
    });
    setShowCodeSearch(false);
  }

  function handleHoursChange(hours: string) {
    const h = parseFloat(hours) || 0;
    const interval = line.unitIntervalMinutes || 15;
    const units = h > 0 ? Math.ceil(h * (60 / interval)) : 0;
    const rate = parseFloat(line.ratePerUnit) || 0;
    const total = units * rate;
    onChange(index, { hours, units: String(units), totalCharge: total > 0 ? total.toFixed(2) : "", chargeOverridden: false });
  }

  function handleUnitsChange(units: string) {
    const u = parseInt(units) || 0;
    const rate = parseFloat(line.ratePerUnit) || 0;
    const total = u * rate;
    onChange(index, { units, totalCharge: total > 0 ? total.toFixed(2) : "", chargeOverridden: false });
  }

  function handleRateChange(ratePerUnit: string) {
    const rate = parseFloat(ratePerUnit) || 0;
    const units = parseInt(line.units) || 0;
    const total = units * rate;
    onChange(index, { ratePerUnit, totalCharge: total > 0 ? total.toFixed(2) : "", chargeOverridden: false });
  }

  function handleTotalChange(totalCharge: string) {
    onChange(index, { totalCharge, chargeOverridden: true });
  }

  const isTimeBased = line.unitType === "time_based";
  const unitsNum = parseInt(line.units) || 0;
  const rateNum = parseFloat(line.ratePerUnit) || 0;
  const hoursNum = parseFloat(line.hours) || 0;
  const interval = line.unitIntervalMinutes || 15;

  return (
    <Card className="p-4 space-y-3" data-testid={`card-service-line-${index}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Service Line {index + 1}</h4>
        {index > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onRemove(index)} data-testid={`button-remove-line-${index}`}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Code</Label>
          <div className="flex gap-1">
            <Input
              value={line.code}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                onChange(index, { code: val });
                if (val) setShowCodeSearch(true);
              }}
              placeholder="e.g. 99213"
              className="font-mono"
              data-testid={`input-line-code-${index}`}
              onFocus={() => setShowCodeSearch(true)}
            />
            <Button variant="outline" size="icon" className="shrink-0" onClick={() => setShowCodeSearch(!showCodeSearch)} data-testid={`button-search-code-${index}`}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Description</Label>
          <Input value={line.description} onChange={(e) => onChange(index, { description: e.target.value })} placeholder="Code description" className="text-sm" data-testid={`input-line-desc-${index}`} readOnly={!!line.code && !line.manualEntry} />
        </div>
      </div>

      {showCodeSearch && <InlineCodeSearch onSelect={handleCodeSelect} initialQuery={line.code} />}

      {line.requiresModifier && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This code commonly requires a modifier — verify with your payer.
        </div>
      )}
      {line.code && isVACode(line.code) && (() => { const p = (patientPayer || "").toLowerCase().replace(/\s+/g, ""); return p.includes("va") || p.includes("triwest") || p.includes("vaccn"); })() && (
        <div className="flex items-center gap-3 bg-muted/50 rounded px-3 py-2" data-testid={`section-va-locality-${index}`}>
          <span className="text-xs text-muted-foreground whitespace-nowrap">VA locality:</span>
          <Select
            value={line.locationName || billingLocation || ""}
            onValueChange={(loc) => lookupRate(line.code, loc)}
          >
            <SelectTrigger className="h-7 text-xs w-56" data-testid={`select-va-location-${index}`}>
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {vaLocations.map((loc: string) => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {line.ratePerUnit && (
            <span className="text-xs font-medium" data-testid={`text-location-rate-${index}`}>
              ${parseFloat(line.ratePerUnit).toFixed(2)}/unit
              {line.isAverageRate && " (avg)"}
            </span>
          )}
        </div>
      )}
      {line.code && line.isAverageRate && !isVACode(line.code) && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded" data-testid={`banner-avg-rate-${index}`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Using national average rate. Set your location in Practice Settings for accurate rates.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Modifier</Label>
          <Input
            value={line.modifier}
            onChange={(e) => onChange(index, { modifier: e.target.value.toUpperCase() })}
            placeholder="Optional (e.g. GT, 59)"
            className="font-mono"
            data-testid={`input-line-modifier-${index}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label title="Enter diagnosis pointer letters: A=primary, B=1st secondary, C=2nd, D=3rd">DX Pointers <span className="text-xs text-muted-foreground">(A/AB/ABCD)</span></Label>
          <Input
            value={line.diagnosisPointers}
            onChange={(e) => onChange(index, { diagnosisPointers: e.target.value.toUpperCase().replace(/[^ABCD]/g, "") })}
            placeholder="A"
            maxLength={4}
            className="font-mono w-24"
            data-testid={`input-line-dx-pointers-${index}`}
          />
        </div>
      </div>

      {line.code && (
        <div className="border-t pt-3 space-y-3">
          {isTimeBased ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label>Service hours</Label>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    value={line.hours}
                    onChange={(e) => handleHoursChange(e.target.value)}
                    placeholder="e.g. 4.0"
                    data-testid={`input-line-hours-${index}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Units ({interval} min each)</Label>
                  <Input value={line.units} readOnly className="bg-muted" data-testid={`input-line-units-${index}`} />
                </div>
                <div className="space-y-1.5">
                  <Label>Rate / unit {line.vaRate ? <span className="text-green-600 text-xs ml-1">Rate from VA fee schedule</span> : <span className="text-amber-600 text-xs">(enter manually)</span>}</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="number"
                      step="0.01"
                      value={line.ratePerUnit}
                      onChange={(e) => handleRateChange(e.target.value)}
                      placeholder={line.vaRate ? "" : "Rate not on file"}
                      className="pl-7"
                      data-testid={`input-line-rate-${index}`}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Total charge {line.chargeOverridden && <Badge variant="outline" className="text-xs ml-1">Overridden</Badge>}</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="number"
                      step="0.01"
                      value={line.totalCharge}
                      onChange={(e) => handleTotalChange(e.target.value)}
                      className="pl-7"
                      data-testid={`input-line-total-${index}`}
                    />
                  </div>
                </div>
              </div>
              {hoursNum > 0 && unitsNum > 0 && rateNum > 0 && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded p-2 font-mono" data-testid={`text-calc-${index}`}>
                  {hoursNum} hrs × {60 / interval} units/hr = {unitsNum} units × ${rateNum.toFixed(2)} = ${(unitsNum * rateNum).toFixed(2)}
                </p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  value={line.units}
                  onChange={(e) => handleUnitsChange(e.target.value)}
                  data-testid={`input-line-qty-${index}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rate {line.vaRate ? <span className="text-green-600 text-xs ml-1">VA fee schedule</span> : !line.ratePerUnit ? <span className="text-amber-600 text-xs">(enter manually)</span> : null}</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input type="number" step="0.01" value={line.ratePerUnit} onChange={(e) => handleRateChange(e.target.value)} className="pl-7" data-testid={`input-line-rate-${index}`} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Total {line.chargeOverridden && <Badge variant="outline" className="text-xs ml-1">Overridden</Badge>}</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input type="number" step="0.01" value={line.totalCharge} onChange={(e) => handleTotalChange(e.target.value)} className="pl-7" data-testid={`input-line-total-${index}`} />
                </div>
              </div>
            </div>
          )}
          {!line.ratePerUnit && line.code && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Rate not on file — enter manually.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function ICD10Search({ label, value, onChange, testId }: {
  label: string; value: { code: string; desc: string };
  onChange: (val: { code: string; desc: string }) => void;
  testId: string;
}) {
  const [q, setQ] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [apiResults, setApiResults] = useState<{ code: string; desc: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) {
      setApiResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/billing/icd10/search?q=${encodeURIComponent(q.trim())}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data) ? data : [];
          setApiResults(items.map((r: any) => ({ code: r.code, desc: r.description })));
        } else {
          setApiResults(ICD10_COMMON.filter(
            (d) => d.code.toLowerCase().includes(q.toLowerCase()) || d.desc.toLowerCase().includes(q.toLowerCase())
          ).slice(0, 8));
        }
      } catch {
        setApiResults(ICD10_COMMON.filter(
          (d) => d.code.toLowerCase().includes(q.toLowerCase()) || d.desc.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 8));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  const filtered = q.trim() && q.trim().length >= 2
    ? apiResults
    : q.trim()
      ? ICD10_COMMON.filter(
          (d) => d.code.toLowerCase().includes(q.toLowerCase()) || d.desc.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 8)
      : ICD10_COMMON.slice(0, 8);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value.code ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">{value.code}</Badge>
          <span className="text-sm truncate">{value.desc}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => onChange({ code: "", desc: "" })} data-testid={`button-clear-${testId}`}>
            <XCircle className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="Search ICD-10 code or description..."
            className="text-sm"
            data-testid={`input-${testId}`}
          />
          {showDropdown && (
            <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {loading && <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>}
              {filtered.map((d) => (
                <button
                  key={d.code}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent text-sm flex gap-2"
                  onMouseDown={() => { onChange(d); setQ(""); setShowDropdown(false); }}
                  data-testid={`option-icd10-${d.code}`}
                >
                  <Badge variant="outline" className="font-mono text-xs shrink-0">{d.code}</Badge>
                  <span className="truncate">{d.desc}</span>
                </button>
              ))}
              {q.trim() && !loading && filtered.length === 0 && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-accent text-sm text-primary"
                  onMouseDown={() => { onChange({ code: q.trim().toUpperCase(), desc: "Custom code" }); setQ(""); setShowDropdown(false); }}
                >
                  Use "{q.trim().toUpperCase()}" as custom code
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClaimWizard() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const preselectedPatientId = params.get("patientId");
  const resumeClaimId = params.get("claimId");
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [patient, setPatient] = useState<any>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);

  const [providerId, setProviderId] = useState("");
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [placeOfService, setPlaceOfService] = useState("11");
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>([emptyLine()]);
  const [icd10Primary, setIcd10Primary] = useState<{ code: string; desc: string }>({ code: "", desc: "" });
  const [icd10Secondary, setIcd10Secondary] = useState<{ code: string; desc: string }[]>([
    { code: "", desc: "" }, { code: "", desc: "" }, { code: "", desc: "" },
  ]);
  const [authNumber, setAuthNumber] = useState("");
  const [saveAuthToPatient, setSaveAuthToPatient] = useState(false);
  const [serviceDateError, setServiceDateError] = useState("");
  const [claimFrequencyCode, setClaimFrequencyCode] = useState("1");
  const [origClaimNumber, setOrigClaimNumber] = useState("");
  const [homeboundIndicator, setHomeboundIndicator] = useState(false);
  const [orderingProviderId, setOrderingProviderId] = useState("");
  const [externalOrderingFirstName, setExternalOrderingFirstName] = useState("");
  const [externalOrderingLastName, setExternalOrderingLastName] = useState("");
  const [externalOrderingOrg, setExternalOrderingOrg] = useState("");
  const [externalOrderingNpi, setExternalOrderingNpi] = useState("");
  const [delayReasonCode, setDelayReasonCode] = useState("none");

  const [riskResult, setRiskResult] = useState<{
    riskScore: number;
    readinessStatus: string;
    factors: string[];
    cciFactors?: Array<{
      type: string;
      severity: "high" | "medium";
      primary_code: string;
      secondary_code: string;
      modifier_indicator: string;
      message: string;
      fix_suggestion: string;
    }>;
  } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [pdfGenerated, setPdfGenerated] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [cms1500Loading, setCms1500Loading] = useState(false);
  const [cms1500Done, setCms1500Done] = useState(false);
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  const { data: wizardData } = useQuery<any>({
    queryKey: ["/api/billing/claims/wizard-data"],
  });

  const providers = wizardData?.providers || [];
  const payers = wizardData?.payers || [];

  // Resolve matched payer from patient's payer_id or insurance_carrier name
  const matchedPayer = payers.find((p: any) => p.id === patient?.payer_id || p.name === patient?.insurance_carrier) || null;
  const isVAPayer = !!matchedPayer && (
    matchedPayer.payer_id === "VACCN" || matchedPayer.payer_id === "TWVACCN" || matchedPayer.payer_id === "TRWST" ||
    (matchedPayer.name || "").toLowerCase().includes("va community care") ||
    (matchedPayer.name || "").toLowerCase().includes("triwest")
  );
  const activeCodes = serviceLines.filter((l) => l.code).map((l) => l.code);
  const paCodesParam = activeCodes.join(",");

  const { data: paCheckResult = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/billing/payer-auth-requirements/check", matchedPayer?.id, paCodesParam],
    queryFn: async () => {
      if (!matchedPayer?.id || !paCodesParam) return {};
      const res = await fetch(`/api/billing/payer-auth-requirements/check?payerId=${matchedPayer.id}&codes=${encodeURIComponent(paCodesParam)}`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!matchedPayer?.id && activeCodes.length > 0,
  });

  const { data: stediStatus } = useQuery<{ configured: boolean; ediMode?: "P" | "T"; stediEnv?: string }>({
    queryKey: ["/api/billing/stedi/status"],
    queryFn: async () => {
      const res = await fetch("/api/billing/stedi/status");
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });
  const stediConfigured = stediStatus?.configured ?? false;
  // ediMode from server environment — 'T' in dev/staging, 'P' only in production
  const ediMode: "P" | "T" = stediStatus?.ediMode ?? "T";
  // FRCPB is the Stedi E2E test payer — always force test mode for it
  const isFrcpbPayer = matchedPayer?.payer_id === "FRCPB";

  const [stediSubmitting, setStediSubmitting] = useState(false);
  const [stediResult, setStediResult] = useState<{ success: boolean; transactionId?: string; status?: string; error?: string; validationErrors?: any[]; blockedBy?: "claimshield" | "stedi" } | null>(null);
  const [testingClaim, setTestingClaim] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testClaimResult, setTestClaimResult] = useState<{ success: boolean; status?: string; transactionId?: string; validationErrors?: any[]; summary?: string; payerName?: string; error?: string } | null>(null);
  // Test-mode override — user can force ISA15=T even in production environment
  const [testModeOverride, setTestModeOverride] = useState(false);
  // Production submission confirmation modal
  const [showProdConfirmModal, setShowProdConfirmModal] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");

  // Effective test mode: override checkbox OR FRCPB payer auto-lock
  const effectiveTestMode = testModeOverride || isFrcpbPayer;
  // isProductionMode = true when EDI will be sent to a real payer (ISA15=P)
  const isProductionMode = ediMode === "P" && !effectiveTestMode;

  useEffect(() => {
    if (providers.length > 0 && !providerId) {
      const def = providers.find((p: any) => p.is_default);
      if (def) setProviderId(def.id);
    }
  }, [providers, providerId]);

  // Pre-populate from practice defaults (only on fresh wizard, not when resuming a claim)
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  useEffect(() => {
    if (!defaultsApplied && wizardData?.practiceSettings && !resumeClaimId) {
      const ps = wizardData.practiceSettings;
      if (ps.homebound_default !== null && ps.homebound_default !== undefined) {
        setHomeboundIndicator(!!ps.homebound_default);
      }
      if (ps.default_ordering_provider_id) {
        setOrderingProviderId(ps.default_ordering_provider_id);
      }
      if (ps.default_pos) {
        setPlaceOfService(ps.default_pos);
      }
      setDefaultsApplied(true);
    }
  }, [wizardData, defaultsApplied, resumeClaimId]);

  useEffect(() => {
    if (resumeClaimId && preselectedPatientId && !patient) {
      fetch(`/api/billing/patients/${preselectedPatientId}`, { credentials: "include" })
        .then((r) => r.json())
        .then((p) => {
          if (p && p.id) {
            setPatient(p);
            if (p.authorization_number) setAuthNumber(p.authorization_number);
            setClaimId(resumeClaimId);
            fetch(`/api/claims/${resumeClaimId}`, { credentials: "include" })
              .then((r) => r.json())
              .then((claim) => {
                if (claim && claim.id) {
                  if (claim.encounterId) setEncounterId(claim.encounterId);
                  if (claim.providerId) setProviderId(claim.providerId);
                  if (claim.serviceDate) setServiceDate(claim.serviceDate);
                  if (claim.placeOfService) setPlaceOfService(claim.placeOfService);
                  if (claim.authorizationNumber) setAuthNumber(claim.authorizationNumber);
                  if (claim.icd10Primary) setIcd10Primary({ code: claim.icd10Primary, desc: "" });
                  if (claim.icd10Secondary && Array.isArray(claim.icd10Secondary)) {
                    const sec = claim.icd10Secondary.map((c: string) => ({ code: c, desc: "" }));
                    while (sec.length < 3) sec.push({ code: "", desc: "" });
                    setIcd10Secondary(sec.slice(0, 3));
                  }
                  if (claim.serviceLines && Array.isArray(claim.serviceLines) && claim.serviceLines.length > 0) {
                    setServiceLines(claim.serviceLines.map((sl: any) => ({
                      id: crypto.randomUUID(),
                      code: sl.code || "",
                      description: sl.description || "",
                      modifier: sl.modifier || "",
                      units: sl.units || "1",
                      ratePerUnit: sl.ratePerUnit ? String(sl.ratePerUnit) : "",
                      total: sl.total ? String(sl.total) : "",
                      unitType: sl.unitType || "per_visit",
                      unitIntervalMinutes: sl.unitIntervalMinutes || null,
                      manualEntry: true,
                      hours: "",
                      minutes: "",
                    })));
                  }
                  setStep(1);
                }
              })
              .catch(() => setStep(1));
          }
        })
        .catch(() => {});
    } else if (preselectedPatientId && !patient && !resumeClaimId) {
      fetch(`/api/billing/patients/${preselectedPatientId}`, { credentials: "include" })
        .then((r) => r.json())
        .then((p) => {
          if (p && p.id) {
            setPatient(p);
            if (p.authorization_number) setAuthNumber(p.authorization_number);
            draftMutation.mutate(p.id);
          }
        })
        .catch(() => {});
    }
  }, [preselectedPatientId, resumeClaimId]);

  useEffect(() => {
    const pending = sessionStorage.getItem("pendingHcpcsCode");
    if (pending && step === 1) {
      try {
        const parsed = JSON.parse(pending);
        const line = { ...emptyLine() };
        line.code = parsed.code || "";
        line.description = parsed.description || "";
        line.unitType = parsed.unit_type || "per_visit";
        line.unitIntervalMinutes = parsed.unit_interval_minutes || null;
        line.ratePerUnit = parsed.rate_per_unit ? String(parsed.rate_per_unit) : "";
        line.manualEntry = true;
        setServiceLines((prev) => {
          if (prev.length === 1 && !prev[0].code) return [line];
          return [...prev, line];
        });
        sessionStorage.removeItem("pendingHcpcsCode");
      } catch {}
    }
  }, [step]);

  const draftMutation = useMutation({
    mutationFn: async (patientId: string) => {
      const res = await apiRequest("POST", "/api/billing/claims/draft", { patientId });
      return res.json();
    },
    onSuccess: (data) => {
      setClaimId(data.claimId);
      setEncounterId(data.encounterId);
      setStep(1);
    },
    onError: (err: any) => {
      toast({ title: "Error creating draft", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: any) => {
      if (!claimId) throw new Error("No draft claim");
      const res = await apiRequest("PATCH", `/api/billing/claims/${claimId}`, body);
      return res.json();
    },
  });

  const riskMutation = useMutation({
    mutationFn: async () => {
      if (!claimId) throw new Error("No draft claim");
      const res = await apiRequest("POST", `/api/billing/claims/${claimId}/risk`, {});
      return res.json();
    },
    onSuccess: (data) => setRiskResult(data),
  });

  function handlePatientSelect(p: any) {
    if (!p) { setPatient(null); return; }
    setPatient(p);
    if (p.authorization_number) setAuthNumber(p.authorization_number);
    if (preselectedPatientId) {
      draftMutation.mutate(p.id);
    }
  }

  function handleStep1Next() {
    if (!patient) { toast({ title: "Select a patient first", variant: "destructive" }); return; }
    if (!claimId) {
      draftMutation.mutate(patient.id);
    } else {
      setStep(1);
    }
  }

  function validateServiceDate(date: string) {
    if (!date) { setServiceDateError("Service date is required"); return; }
    const d = new Date(date);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (d > today) { setServiceDateError("Service date cannot be in the future"); return; }

    const daysSince = Math.floor((Date.now() - d.getTime()) / 86400000);
    const payerName = patient?.insurance_carrier || "";
    const matchedPayer = payers.find((p: any) => p.name === payerName || p.id === patient?.payer_id);
    const filingLimit = matchedPayer?.timely_filing_days || 365;

    if (daysSince > filingLimit) {
      setServiceDateError(`This date is ${daysSince} days ago — ${payerName || "this payer"} requires claims within ${filingLimit} days of service.`);
      return;
    }
    setServiceDateError("");
  }

  function handleServiceDateChange(date: string) {
    setServiceDate(date);
    validateServiceDate(date);
  }

  function updateServiceLine(index: number, updates: Partial<ServiceLine>) {
    setServiceLines((prev) => prev.map((l, i) => i === index ? { ...l, ...updates } : l));
  }

  function removeServiceLine(index: number) {
    setServiceLines((prev) => prev.filter((_, i) => i !== index));
  }

  function addServiceLine() {
    if (serviceLines.length >= 6) { toast({ title: "Maximum 6 service lines", variant: "destructive" }); return; }
    setServiceLines((prev) => [...prev, emptyLine()]);
  }

  function buildClaimPayload() {
    const amount = serviceLines.reduce((sum, l) => sum + (parseFloat(l.totalCharge) || 0), 0);
    const cptCodes = serviceLines.filter((l) => l.code).map((l) => l.code);
    const slData = serviceLines.filter((l) => l.code).map((l) => ({
      hcpcs_code: l.code,
      description: l.description,
      modifier: l.modifier || null,
      diagnosis_pointer: l.diagnosisPointers || "A",
      unit_type: l.unitType,
      unit_interval_minutes: l.unitIntervalMinutes,
      units: parseInt(l.units) || 0,
      rate_per_unit: parseFloat(l.ratePerUnit) || 0,
      total_charge: parseFloat(l.totalCharge) || 0,
      charge_overridden: l.chargeOverridden,
      manual_entry: l.manualEntry,
    }));

    return {
      encounterId,
      providerId: providerId || null,
      serviceDate: serviceDate || null,
      placeOfService,
      cptCodes,
      serviceLines: slData,
      amount,
      icd10Primary: icd10Primary.code || null,
      icd10Secondary: icd10Secondary.filter((d) => d.code).map((d) => d.code),
      authorizationNumber: authNumber || null,
      chargeOverridden: serviceLines.some((l) => l.chargeOverridden),
      claimFrequencyCode: claimFrequencyCode || "1",
      origClaimNumber: origClaimNumber || null,
      homeboundIndicator,
      orderingProviderId: orderingProviderId === "__external__" ? null : (orderingProviderId || null),
      externalOrderingProviderName: orderingProviderId === "__external__" ? ([externalOrderingFirstName, externalOrderingLastName].filter(Boolean).join(" ") || null) : null,
      externalOrderingProviderNpi: orderingProviderId === "__external__" ? (externalOrderingNpi || null) : null,
      orderingProviderFirstName: orderingProviderId === "__external__" ? (externalOrderingFirstName || null) : null,
      orderingProviderLastName: orderingProviderId === "__external__" ? (externalOrderingLastName || null) : null,
      orderingProviderNpi: orderingProviderId === "__external__" ? (externalOrderingNpi || null) : null,
      orderingProviderOrg: orderingProviderId === "__external__" ? (externalOrderingOrg || null) : null,
      delayReasonCode: (delayReasonCode && delayReasonCode !== "none") ? delayReasonCode : null,
    };
  }

  function validateStep2(): boolean {
    const errors: Record<string, string> = {};
    if (!providerId) errors.provider = "Rendering provider is required";
    if (!serviceDate) errors.serviceDate = "Service date is required";
    const filledLines = serviceLines.filter(l => l.code);
    if (filledLines.length === 0) errors.serviceLines = "At least one service line with a code is required";
    filledLines.forEach((l, i) => {
      if ((parseInt(l.units) || 0) <= 0) errors[`line_${i}_units`] = `Line ${i + 1}: units must be greater than zero`;
    });
    if (!icd10Primary.code) errors.icd10 = "At least one ICD-10 diagnosis code is required";
    setStep2Errors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleStep2Next() {
    if (!validateStep2()) {
      toast({ title: "Please fix the highlighted errors before continuing", variant: "destructive" });
      return;
    }
    const payload = buildClaimPayload();
    try {
      await saveMutation.mutateAsync(payload);
      runValidation();
      await riskMutation.mutateAsync();
      setStep(2);
    } catch (err: any) {
      toast({ title: "Error saving claim", description: err.message, variant: "destructive" });
    }
  }

  function runValidation() {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!patient?.first_name || !patient?.last_name) errors.push("Patient first or last name missing");
    if (!patient?.dob) errors.push("Patient DOB missing");
    if (!patient?.insurance_carrier) errors.push("No insurance carrier / payer");
    if (!patient?.member_id) errors.push("No member ID");
    if (!providerId) errors.push("No rendering provider selected");
    else {
      const selProv = providers.find((p: any) => p.id === providerId);
      if (selProv?.npi && !validateNPI(selProv.npi)) errors.push("Provider NPI fails Luhn validation");
    }
    if (!serviceDate) errors.push("Service date missing");
    if (serviceDateError) errors.push(serviceDateError);
    if (serviceLines.filter((l) => l.code).length === 0) errors.push("No service lines");
    serviceLines.forEach((l, i) => {
      if (l.code) {
        if ((parseInt(l.units) || 0) <= 0) errors.push(`Line ${i + 1}: zero units`);
        if ((parseFloat(l.totalCharge) || 0) <= 0) errors.push(`Line ${i + 1}: zero total charge`);
      }
    });
    if (!icd10Primary.code) errors.push("No primary ICD-10 diagnosis");

    // PA check: use granular auth requirements first, then fall back to payer-level flag
    const paCodesRequiringAuth = Object.values(paCheckResult).filter((v: any) => v.authRequired);
    if (paCodesRequiringAuth.length > 0) {
      if (!authNumber) {
        if (isVAPayer) {
          errors.push("VA Community Care requires the authorization number from the VA referral. Claim cannot be submitted without it.");
        } else {
          for (const pa of paCodesRequiringAuth) {
            const portalRef = pa.portalUrl ? ` Get it from ${pa.portalUrl}` : "";
            warnings.push(`Auth required for ${pa.code} — enter authorization number before submitting.${portalRef}`);
          }
        }
      } else if (authNumber) {
        // Check auth validity window
        for (const pa of paCodesRequiringAuth) {
          if (pa.validityDays && serviceDate) {
            const today = new Date();
            const svcDate = new Date(serviceDate);
            const diffDays = Math.floor((today.getTime() - svcDate.getTime()) / 86400000);
            if (diffDays > pa.validityDays) {
              warnings.push(`Authorization may have expired. Typical validity is ${pa.validityDays} days — confirm the auth number is still active with ${matchedPayer?.name || "the payer"} before submitting.`);
              break;
            }
          }
        }
      }
    } else if (!authNumber) {
      // Fallback: payer-level auth_required boolean for payers without granular data
      if (matchedPayer?.auth_required) warnings.push("Authorization number blank — payer requires prior auth");
    }
    serviceLines.forEach((l, i) => {
      if (l.requiresModifier && !l.modifier) warnings.push(`Line ${i + 1}: modifier commonly required but not entered`);
      if (l.chargeOverridden) warnings.push(`Line ${i + 1}: charge was manually overridden`);
      if (l.unitType === "time_based" && parseInt(l.units) > 32) warnings.push(`Line ${i + 1}: ${l.units} units on a 15-min code (> 8 hours)`);
    });
    if (!patient?.vob_verified) warnings.push("Patient VOB not verified");

    setValidationErrors(errors);
    setValidationWarnings(warnings);
    setWarningsAcknowledged(false);
  }

  async function handleSaveDraft() {
    const payload = buildClaimPayload();
    payload.status = "draft" as any;
    try {
      await saveMutation.mutateAsync(payload);
      if (saveAuthToPatient && authNumber && patient?.id) {
        await apiRequest("PATCH", `/api/billing/patients/${patient.id}`, { authorizationNumber: authNumber });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients", patient?.id] });
      toast({ title: "Draft saved successfully" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  const { data: draftClaims } = useQuery<any[]>({
    queryKey: ["/api/billing/claims/drafts"],
    queryFn: async () => {
      const res = await fetch("/api/claims", { credentials: "include" });
      if (!res.ok) return [];
      const claims = await res.json();
      return (claims || []).filter((c: any) => c.status === "draft" && new Date(c.createdAt) > new Date(Date.now() - 7 * 86400000));
    },
    enabled: step === 0 && !claimId,
  });
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

  const totalAmount = serviceLines.reduce((sum, l) => sum + (parseFloat(l.totalCharge) || 0), 0);
  const selectedProvider = providers.find((p: any) => p.id === providerId);

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">New Claim</h1>
        <p className="text-muted-foreground">Create a new claim for billing</p>
      </div>

      {step === 0 && !draftBannerDismissed && draftClaims && draftClaims.length > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20" data-testid="banner-drafts">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              You have {draftClaims.length} unfinished claim{draftClaims.length > 1 ? "s" : ""} from the past 7 days.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate("/billing/claims?status=draft")} data-testid="link-view-drafts">
              View drafts
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraftBannerDismissed(true)} data-testid="button-dismiss-drafts">
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <StepIndicator current={step} />

      {step === 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Select Patient</CardTitle>
            </CardHeader>
            <CardContent>
              <PatientSearch onSelect={handlePatientSelect} selectedPatient={patient} />
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button onClick={handleStep1Next} disabled={!patient || draftMutation.isPending} data-testid="button-step1-next">
              {draftMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Next: Service Details
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {patient && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900" data-testid="banner-step2-patient">
              <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                Creating claim for: {patient.first_name} {patient.last_name}
              </span>
              {patient.insurance_carrier && (
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                  {patient.insurance_carrier}
                </span>
              )}
            </div>
          )}
          <Card>
            <CardHeader><CardTitle>Rendering Provider</CardTitle></CardHeader>
            <CardContent>
              <Select value={providerId} onValueChange={(v) => { setProviderId(v); setStep2Errors(prev => { const n = {...prev}; delete n.provider; return n; }); }}>
                <SelectTrigger data-testid="select-provider" className={step2Errors.provider ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select provider..." />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}{p.credentials ? `, ${p.credentials}` : ""} — NPI: {p.npi}
                      {p.is_default ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {step2Errors.provider && <p className="text-sm text-red-500 mt-1" data-testid="error-provider">{step2Errors.provider}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Service Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Service Date</Label>
                  <Input
                    type="date"
                    value={serviceDate}
                    onChange={(e) => handleServiceDateChange(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    data-testid="input-service-date"
                  />
                  {serviceDateError && (
                    <p className="text-sm text-destructive flex items-center gap-1" data-testid="text-date-error">
                      <AlertCircle className="h-3 w-3" /> {serviceDateError}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Place of Service</Label>
                  <Select value={placeOfService} onValueChange={setPlaceOfService}>
                    <SelectTrigger data-testid="select-pos">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Service Lines
                <Button variant="outline" size="sm" onClick={addServiceLine} disabled={serviceLines.length >= 6} data-testid="button-add-line">
                  <Plus className="h-4 w-4 mr-1" /> Add Line
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {step2Errors.serviceLines && <p className="text-sm text-red-500" data-testid="error-service-lines">{step2Errors.serviceLines}</p>}
              {serviceLines.map((line, i) => (
                <ServiceLineRow
                  key={i}
                  line={line}
                  index={i}
                  onChange={updateServiceLine}
                  onRemove={removeServiceLine}
                  patientPayer={patient?.insurance_carrier || null}
                  billingLocation={wizardData?.practiceSettings?.default_va_locality || wizardData?.practiceSettings?.billing_location || null}
                />
              ))}
              <Separator />
              <div className="flex justify-end text-lg font-semibold" data-testid="text-total-amount">
                Total: ${totalAmount.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card className={step2Errors.icd10 ? "border-red-500" : ""}>
            <CardHeader><CardTitle>ICD-10 Diagnosis</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {step2Errors.icd10 && <p className="text-sm text-red-500" data-testid="error-icd10">{step2Errors.icd10}</p>}
              <ICD10Search label="Primary Diagnosis (required)" value={icd10Primary} onChange={(val) => { setIcd10Primary(val); setStep2Errors(prev => { const n = {...prev}; delete n.icd10; return n; }); }} testId="icd10-primary" />
              {icd10Secondary.map((d, i) => (
                <ICD10Search
                  key={i}
                  label={`Secondary ${i + 1}`}
                  value={d}
                  onChange={(val) => {
                    setIcd10Secondary((prev) => prev.map((s, j) => j === i ? val : s));
                  }}
                  testId={`icd10-secondary-${i}`}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Prior Authorization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* VA Community Care special banner */}
              {isVAPayer && activeCodes.length > 0 && (
                <div className="flex gap-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30" data-testid="banner-va-auth">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-semibold mb-0.5">VA Community Care Authorization</p>
                    <p className="text-xs leading-relaxed">The VA issues a referral authorization number on the patient's Community Care referral paperwork. Enter that number here exactly as it appears on the referral. Do not submit a PA request — the VA provides this proactively.</p>
                  </div>
                </div>
              )}

              {/* PA checklist per code */}
              {activeCodes.length > 0 && Object.keys(paCheckResult).length > 0 && (
                <div className="space-y-2" data-testid="panel-pa-checklist">
                    {activeCodes.filter((code) => paCheckResult[code]?.authRequired).map((code) => {
                      const pa = paCheckResult[code];
                      const hasAuth = !!authNumber;
                      return (
                        <div key={code} className="flex items-start gap-3 p-2.5 rounded-md border bg-muted/30" data-testid={`pa-row-${code}`}>
                          <div className="mt-0.5 shrink-0">
                            {hasAuth ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : isVAPayer ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-amber-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-medium">{code}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                hasAuth
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : isVAPayer
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                              }`}>
                                {hasAuth ? "Auth number on file" : isVAPayer ? "Auth missing — required" : "Auth required — not entered"}
                              </span>
                              {pa.turnaroundDays === 0 && (
                                <span className="text-xs text-muted-foreground">VA provides auth</span>
                              )}
                              {pa.turnaroundDays > 0 && (
                                <span className="text-xs text-muted-foreground">~{pa.turnaroundDays} day turnaround</span>
                              )}
                            </div>
                            {pa.conditions && (
                              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{pa.conditions}</p>
                            )}
                            {pa.portalUrl && !isVAPayer && (
                              <a href={pa.portalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-0.5 hover:underline" data-testid={`link-pa-portal-${code}`}>
                                <ExternalLink className="h-3 w-3" />
                                Submit PA →
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {activeCodes.some((c) => paCheckResult[c] && !paCheckResult[c].authRequired) && (
                      <p className="text-xs text-muted-foreground px-1">
                        {activeCodes.filter((c) => paCheckResult[c] && !paCheckResult[c].authRequired).join(", ")} — no prior auth required
                      </p>
                    )}
                </div>
              )}

              {/* Auth number input */}
              <div className="space-y-1.5">
                <Label>Authorization Number</Label>
                <Input
                  value={authNumber}
                  onChange={(e) => setAuthNumber(e.target.value)}
                  placeholder={isVAPayer ? "Enter VA referral auth number exactly as on paperwork..." : paCheckResult && Object.values(paCheckResult).some((v: any) => v.hint) ? Object.values(paCheckResult).find((v: any) => v.hint)?.hint : "Enter auth number..."}
                  data-testid="input-auth-number"
                />
                {activeCodes.length > 0 && activeCodes.some((c) => paCheckResult[c]?.authRequired) && (
                  <p className="text-xs text-muted-foreground">This auth number applies to all service lines on this claim.</p>
                )}
              </div>
              {authNumber && authNumber !== patient?.authorization_number && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={saveAuthToPatient}
                    onCheckedChange={(c) => setSaveAuthToPatient(c as boolean)}
                    id="save-auth"
                    data-testid="checkbox-save-auth"
                  />
                  <label htmlFor="save-auth" className="text-sm">Save to patient profile</label>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Additional Billing Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Claim Frequency Code</Label>
                  <Select value={claimFrequencyCode} onValueChange={setClaimFrequencyCode}>
                    <SelectTrigger data-testid="select-frequency-code">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CLAIM_FREQUENCY_CODES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Delay Reason Code</Label>
                  <Select value={delayReasonCode} onValueChange={setDelayReasonCode}>
                    <SelectTrigger data-testid="select-delay-reason">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DELAY_REASON_CODES.map((c) => (
                        <SelectItem key={c.value || "none"} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(claimFrequencyCode === "7" || claimFrequencyCode === "8") && (
                <div className="space-y-1.5">
                  <Label>Original Claim Number (ICN/TCN) <span className="text-destructive">*</span></Label>
                  <Input
                    value={origClaimNumber}
                    onChange={(e) => setOrigClaimNumber(e.target.value)}
                    placeholder="Enter original claim number..."
                    data-testid="input-orig-claim-number"
                  />
                  <p className="text-xs text-muted-foreground">Required for replacement or void claims (CLM05-3)</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Ordering Provider <span className="text-xs text-muted-foreground">(CMS-1500 Box 17 — if different from rendering)</span></Label>
                <Select value={orderingProviderId || "__none__"} onValueChange={(v) => setOrderingProviderId(v === "__none__" ? "" : v)}>
                  <SelectTrigger data-testid="select-ordering-provider">
                    <SelectValue placeholder="Same as rendering provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Same as rendering provider</SelectItem>
                    <SelectItem value="__external__">Enter external ordering provider (VA physician, etc.)</SelectItem>
                    {providers.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}{p.credentials ? `, ${p.credentials}` : ""} — NPI: {p.npi}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {orderingProviderId === "__external__" && (
                  <div className="grid grid-cols-2 gap-2 mt-2 p-3 border rounded-md bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-xs">First Name</Label>
                      <Input
                        value={externalOrderingFirstName}
                        onChange={(e) => setExternalOrderingFirstName(e.target.value)}
                        placeholder="James"
                        data-testid="input-external-ordering-first-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Last Name</Label>
                      <Input
                        value={externalOrderingLastName}
                        onChange={(e) => setExternalOrderingLastName(e.target.value)}
                        placeholder="Walsh"
                        data-testid="input-external-ordering-last-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Organization / Group (optional)</Label>
                      <Input
                        value={externalOrderingOrg}
                        onChange={(e) => setExternalOrderingOrg(e.target.value)}
                        placeholder="VA Medical Center"
                        data-testid="input-external-ordering-org"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Provider NPI</Label>
                      <Input
                        value={externalOrderingNpi}
                        onChange={(e) => setExternalOrderingNpi(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        placeholder="1234567890"
                        maxLength={10}
                        data-testid="input-external-ordering-npi"
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <Checkbox
                  checked={homeboundIndicator}
                  onCheckedChange={(c) => setHomeboundIndicator(c as boolean)}
                  id="homebound-indicator"
                  data-testid="checkbox-homebound"
                />
                <div>
                  <label htmlFor="homebound-indicator" className="text-sm font-medium cursor-pointer">
                    Patient is homebound (CLM10)
                  </label>
                  <p className="text-xs text-muted-foreground">Required for Medicare home health (CLM10=Y) and VA CCN home-based claims</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)} data-testid="button-step2-back">Back</Button>
            <Button onClick={handleStep2Next} disabled={saveMutation.isPending || riskMutation.isPending} data-testid="button-step2-next">
              {(saveMutation.isPending || riskMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Next: Review
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {riskResult && (
            <Card className={`border-2 ${
              riskResult.readinessStatus === "GREEN" ? "border-green-500 bg-green-50/50 dark:bg-green-950/20" :
              riskResult.readinessStatus === "YELLOW" ? "border-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20" :
              "border-red-500 bg-red-50/50 dark:bg-red-950/20"
            }`} data-testid="card-risk-panel">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className={`h-6 w-6 ${
                    riskResult.readinessStatus === "GREEN" ? "text-green-600" :
                    riskResult.readinessStatus === "YELLOW" ? "text-yellow-600" :
                    "text-red-600"
                  }`} />
                  <div>
                    <h3 className="font-semibold" data-testid="text-risk-status">
                      Claim Readiness: {riskResult.readinessStatus}
                    </h3>
                    <p className="text-sm text-muted-foreground">Risk score: {riskResult.riskScore}/100</p>
                  </div>
                  <Badge className={`ml-auto ${
                    riskResult.readinessStatus === "GREEN" ? "bg-green-600" :
                    riskResult.readinessStatus === "YELLOW" ? "bg-yellow-600" :
                    "bg-red-600"
                  }`} data-testid="badge-readiness">
                    {riskResult.readinessStatus}
                  </Badge>
                </div>
                {riskResult.factors.length > 0 && (
                  <ul className="text-sm space-y-1 mt-2" data-testid="list-risk-factors">
                    {riskResult.factors.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* CCI Edit Conflicts Panel */}
          {riskResult?.cciFactors && riskResult.cciFactors.length > 0 && (
            <Card className="border-2 border-orange-400 bg-orange-50/50 dark:bg-orange-950/20" data-testid="card-cci-panel">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
                  <div>
                    <h3 className="font-semibold text-orange-700 dark:text-orange-400">
                      CCI Edit Conflicts Detected
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      CMS NCCI (National Correct Coding Initiative) flagged {riskResult.cciFactors.length} conflict{riskResult.cciFactors.length > 1 ? "s" : ""} on this claim.
                    </p>
                  </div>
                </div>
                <div className="space-y-2" data-testid="list-cci-conflicts">
                  {riskResult.cciFactors.map((cf, i) => (
                    <div
                      key={i}
                      className={`rounded-md p-3 text-sm border ${
                        cf.modifier_indicator === "0"
                          ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                          : "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-700"
                      }`}
                      data-testid={`cci-conflict-${i}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={`text-xs font-mono ${cf.modifier_indicator === "0" ? "border-red-500 text-red-600" : "border-yellow-500 text-yellow-700"}`}>
                          {cf.primary_code}
                        </Badge>
                        <span className="text-muted-foreground">+</span>
                        <Badge variant="outline" className={`text-xs font-mono ${cf.modifier_indicator === "0" ? "border-red-500 text-red-600" : "border-yellow-500 text-yellow-700"}`}>
                          {cf.secondary_code}
                        </Badge>
                        <Badge className={`ml-auto text-xs ${cf.modifier_indicator === "0" ? "bg-red-600" : "bg-yellow-500"}`}>
                          {cf.modifier_indicator === "0" ? "Hard Block" : "Modifier Required"}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{cf.message}</p>
                      <p className="text-xs mt-1 font-medium">
                        Fix: {cf.fix_suggestion}
                      </p>
                    </div>
                  ))}
                </div>
                {riskResult.cciFactors.some((cf) => cf.modifier_indicator === "0") && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-semibold mt-3 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Hard-block conflicts must be resolved before this claim can be submitted.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Patient
                <Button variant="link" size="sm" onClick={() => setStep(0)} data-testid="button-edit-patient">Edit</Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Name:</span> {patient?.first_name} {patient?.last_name}</div>
                <div><span className="text-muted-foreground">DOB:</span> {patient?.dob || "—"}</div>
                <div><span className="text-muted-foreground">Insurance:</span> {patient?.insurance_carrier || "—"}</div>
                <div><span className="text-muted-foreground">Member ID:</span> {patient?.member_id || "—"}</div>
                {patient?.secondary_payer_id && (
                  <div className="col-span-2 border-t pt-2 mt-1">
                    <span className="text-muted-foreground font-medium text-xs uppercase tracking-wide">Secondary (COB):</span>
                    <span className="ml-2">{patient.secondary_payer_id}</span>
                    {patient.secondary_member_id && <span className="ml-2 text-muted-foreground">#{patient.secondary_member_id}</span>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Service Details
                <Button variant="link" size="sm" onClick={() => setStep(1)} data-testid="button-edit-service">Edit</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Provider:</span> {selectedProvider ? `${selectedProvider.first_name} ${selectedProvider.last_name}` : "—"}</div>
                <div><span className="text-muted-foreground">Service Date:</span> {serviceDate || "—"}</div>
                {orderingProviderId && orderingProviderId !== "__none__" && (() => {
                  if (orderingProviderId === "__external__") {
                    const name = [externalOrderingFirstName, externalOrderingLastName].filter(Boolean).join(" ");
                    return name || externalOrderingNpi ? (
                      <div className="col-span-2"><span className="text-muted-foreground">Ordering Provider:</span> {name || "—"}{externalOrderingNpi ? ` (NPI: ${externalOrderingNpi})` : ""}</div>
                    ) : null;
                  }
                  const op = providers.find((p: any) => p.id === orderingProviderId);
                  return op ? (
                    <div className="col-span-2"><span className="text-muted-foreground">Ordering Provider:</span> {op.first_name} {op.last_name}{op.npi ? ` (NPI: ${op.npi})` : ""}</div>
                  ) : null;
                })()}
                <div><span className="text-muted-foreground">Place of Service:</span> {POS_OPTIONS.find((o) => o.value === placeOfService)?.label || placeOfService}</div>
                <div><span className="text-muted-foreground">Auth #:</span> {authNumber || "—"}</div>
              </div>

              <Separator />
              <h4 className="font-medium text-sm">Service Lines</h4>
              {serviceLines.filter((l) => l.code).map((l, i) => (
                <div key={i} className="text-sm border rounded p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono">{l.code}</Badge>
                    <span className="truncate">{l.description}</span>
                    {l.modifier && <Badge variant="outline" className="text-xs">Mod: {l.modifier}</Badge>}
                  </div>
                  <div className="text-muted-foreground">
                    {l.units} unit{l.units !== "1" ? "s" : ""} × ${parseFloat(l.ratePerUnit || "0").toFixed(2)} = <span className="font-medium text-foreground">${parseFloat(l.totalCharge || "0").toFixed(2)}</span>
                    {l.chargeOverridden && <Badge variant="outline" className="text-xs ml-2 text-amber-600">Overridden</Badge>}
                  </div>
                </div>
              ))}
              <div className="text-right font-semibold" data-testid="text-review-total">
                Total: ${totalAmount.toFixed(2)}
              </div>

              <Separator />
              <h4 className="font-medium text-sm">Diagnosis</h4>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Primary:</span>{" "}
                  {icd10Primary.code ? <><Badge variant="secondary" className="font-mono text-xs">{icd10Primary.code}</Badge> {icd10Primary.desc}</> : <span className="text-destructive">Not set</span>}
                </div>
                {icd10Secondary.filter((d) => d.code).map((d, i) => (
                  <div key={i}>
                    <span className="text-muted-foreground">Secondary {i + 1}:</span>{" "}
                    <Badge variant="secondary" className="font-mono text-xs">{d.code}</Badge> {d.desc}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {validationErrors.length > 0 && (
            <Card className="border-destructive bg-red-50/50 dark:bg-red-950/20" data-testid="card-validation-errors">
              <CardContent className="pt-4">
                <h3 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                  <XCircle className="h-5 w-5" /> Validation Errors
                </h3>
                <ul className="text-sm space-y-1">
                  {validationErrors.map((e, i) => (
                    <li key={i} className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-3 w-3 shrink-0" /> {e}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {validationWarnings.length > 0 && (
            <Card className="border-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20" data-testid="card-validation-warnings">
              <CardContent className="pt-4">
                <h3 className="font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5" /> Warnings
                </h3>
                <ul className="text-sm space-y-1 mb-3">
                  {validationWarnings.map((w, i) => (
                    <li key={i} className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={warningsAcknowledged}
                    onCheckedChange={(c) => setWarningsAcknowledged(c as boolean)}
                    id="ack-warnings"
                    data-testid="checkbox-acknowledge-warnings"
                  />
                  <label htmlFor="ack-warnings" className="text-sm">I acknowledge these warnings and wish to proceed</label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stedi submission result */}
          {stediResult && (
            <div className={`p-3 rounded-lg border text-sm ${stediResult.success ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"}`} data-testid="panel-stedi-result">
              {stediResult.success ? (
                <div className="flex items-start gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
                  <div>
                    <p className="font-semibold">Claim submitted via Stedi clearinghouse</p>
                    {stediResult.transactionId && <p className="text-xs mt-0.5">Transaction ID: <span className="font-mono">{stediResult.transactionId}</span></p>}
                    <p className="text-xs mt-0.5">Status: {stediResult.status || "Accepted"}. You'll be notified when the payer acknowledges (usually within 30 minutes).</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-red-800 dark:text-red-200">
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
                  <div>
                    <p className="font-semibold">
                      {stediResult.blockedBy === "claimshield"
                        ? "Submission blocked by ClaimShield"
                        : "Stedi rejected the submission"}
                    </p>
                    <p className="text-xs mt-0.5">{stediResult.error}</p>
                    {stediResult.validationErrors && stediResult.validationErrors.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {stediResult.validationErrors.map((e: string, i: number) => (
                          <li key={i} className="text-xs font-mono bg-red-100/50 dark:bg-red-900/20 rounded px-1.5 py-0.5">{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stedi not configured notice (when OA is the fallback) */}
          {!stediConfigured && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300" data-testid="notice-stedi-not-configured">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Connect Stedi for real-time electronic submission and automatic 277CA status tracking.
            </div>
          )}

          <div className="flex flex-wrap gap-3 justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(1)} data-testid="button-step3-back">Back to Service</Button>
            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={handleSaveDraft} disabled={saveMutation.isPending} data-testid="button-save-draft">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save as Draft
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={validationErrors.length > 0 || pdfGenerating || cms1500Loading}
                    data-testid="button-generate-pdf"
                  >
                    {(pdfGenerating || cms1500Loading) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                    {(pdfGenerating || cms1500Loading) ? "Generating..." : "Download PDF"}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid="menu-cms1500-wizard"
                    onClick={async () => {
                      if (!claimId) return;
                      setCms1500Loading(true);
                      try {
                        const { buildCMS1500DataFromClaim, generateCMS1500PDF } = await import('@/lib/generate-cms1500');
                        const formData = await buildCMS1500DataFromClaim(claimId);
                        const pdfBytes = await generateCMS1500PDF(formData);
                        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `CMS1500-${formData.patientLastName || 'claim'}-${formData.serviceDate || 'date'}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        await fetch(`/api/billing/claims/${claimId}/pdf-generated`, { method: 'PATCH', credentials: 'include' });
                        queryClient.invalidateQueries({ queryKey: ["/api/billing/claims", claimId] });
                        setCms1500Done(true);
                        toast({ title: "CMS-1500 downloaded", description: "Upload this form to your Availity portal to submit the claim." });
                      } catch (err: any) {
                        toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
                      } finally {
                        setCms1500Loading(false);
                      }
                    }}
                  >
                    {cms1500Done ? "Re-download CMS-1500 form" : "CMS-1500 form"} — for Availity upload
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="menu-summary-pdf-wizard"
                    onClick={async () => {
                      if (!claimId) return;
                      setPdfGenerating(true);
                      try {
                        await generateAndDownloadClaimPdf(claimId);
                        setPdfGenerated(true);
                        queryClient.invalidateQueries({ queryKey: ["/api/billing/claims", claimId] });
                        toast({ title: "Claim summary downloaded." });
                      } catch (err: any) {
                        toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
                      } finally {
                        setPdfGenerating(false);
                      }
                    }}
                  >
                    Claim summary — readable format
                  </DropdownMenuItem>
                  {stediConfigured && claimId && (
                    <DropdownMenuItem
                      data-testid="menu-download-edi-wizard"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/billing/claims/${claimId}/edi`, { credentials: "include" });
                          if (!res.ok) throw new Error("EDI generation failed");
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `claim_${claimId}_837P.edi`;
                          a.click();
                          URL.revokeObjectURL(url);
                          toast({ title: "837P EDI downloaded" });
                        } catch (err: any) {
                          toast({ title: "EDI download failed", description: err.message, variant: "destructive" });
                        }
                      }}
                    >
                      Download 837P EDI file
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {stediConfigured ? (
                <div className="flex flex-col items-end gap-2">

                  {/* ── Environment badge (Task 4c) ─────────────────────── */}
                  <div className="flex items-center gap-1.5 mb-1" data-testid="env-badge-wrapper">
                    {isProductionMode ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300 dark:bg-red-950/50 dark:text-red-400 dark:border-red-700" data-testid="badge-env-production">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                        LIVE — ISA15=P — Payer receives claim
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-700" data-testid="badge-env-test">
                        <FlaskConical className="h-3 w-3" />
                        TEST — ISA15=T — No payer forwarding
                      </span>
                    )}
                  </div>

                  {/* ── FRCPB auto-lock notice (Task 4f) ───────────────── */}
                  {isFrcpbPayer && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 text-right max-w-[240px]" data-testid="notice-frcpb-lock">
                      <Shield className="h-3 w-3 inline mr-1" />
                      FRCPB is the Stedi E2E test payer. Test mode locked.
                    </p>
                  )}

                  {/* ── Test-mode override checkbox (Task 3d) ────────────── */}
                  {!isFrcpbPayer && ediMode === "P" && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" data-testid="label-test-mode-override">
                      <Checkbox
                        checked={testModeOverride}
                        onCheckedChange={(v) => setTestModeOverride(!!v)}
                        data-testid="checkbox-test-mode-override"
                      />
                      Submit as test (ISA15=T) — no payer forwarding
                    </label>
                  )}

                  {/* ── Main submit button (Task 3a/3c) ─────────────────── */}
                  <Button
                    onClick={async () => {
                      if (!claimId) return;
                      if (isProductionMode) {
                        // Open production confirmation modal before submitting
                        setConfirmationText("");
                        setShowProdConfirmModal(true);
                        return;
                      }
                      // Test mode — submit directly
                      setStediSubmitting(true);
                      setStediResult(null);
                      try {
                        const res = await fetch(`/api/billing/claims/${claimId}/submit-stedi`, {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ testMode: effectiveTestMode }),
                        });
                        const result = await res.json();
                        setStediResult(result);
                        if (result.success) {
                          queryClient.invalidateQueries({ queryKey: ["/api/billing/claims"] });
                          toast({ title: "Claim submitted via Stedi", description: `Transaction ID: ${result.transactionId || "N/A"}` });
                        } else {
                          toast({ title: "Stedi submission failed", description: result.error, variant: "destructive" });
                        }
                      } catch (err: any) {
                        setStediResult({ success: false, error: err.message });
                        toast({ title: "Submission error", description: err.message, variant: "destructive" });
                      } finally {
                        setStediSubmitting(false);
                      }
                    }}
                    disabled={validationErrors.length > 0 || (validationWarnings.length > 0 && !warningsAcknowledged) || stediSubmitting || stediResult?.success || (riskResult?.cciFactors?.some((cf) => cf.modifier_indicator === "0") ?? false)}
                    data-testid="button-submit-stedi"
                    className={isProductionMode ? "bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800" : ""}
                  >
                    {stediSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {stediResult?.success
                      ? "Submitted ✓"
                      : stediSubmitting
                      ? "Submitting..."
                      : isProductionMode
                      ? "Submit to Payer (Live) →"
                      : "Submit Claim (Test) →"}
                  </Button>

                  {/* ── Test validation button (Task 3a) ────────────────── */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!claimId) return;
                      setTestingClaim(true);
                      setTestClaimResult(null);
                      try {
                        const res = await fetch(`/api/billing/claims/${claimId}/test-stedi`, {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                        });
                        const result = await res.json();
                        setTestClaimResult(result);
                        setShowTestModal(true);
                        queryClient.invalidateQueries({ queryKey: ["/api/billing/claims"] });
                      } catch (err: any) {
                        toast({ title: "Test failed", description: err.message, variant: "destructive" });
                      } finally {
                        setTestingClaim(false);
                      }
                    }}
                    disabled={testingClaim || validationErrors.length > 0 || stediResult?.success}
                    data-testid="button-test-stedi"
                    className="text-xs"
                  >
                    {testingClaim ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Validating claim with Stedi...</> : <><FlaskConical className="h-3 w-3 mr-1.5" /> Test This Claim First — Free</>}
                  </Button>
                  <p className="text-xs text-muted-foreground text-right max-w-[220px]">
                    Not sure if your claim is ready? Run a free test first — Stedi will validate your EDI and tell you exactly what to fix.
                  </p>
                </div>
              ) : (
                <Button
                  onClick={() => setShowSubmitModal(true)}
                  disabled={validationErrors.length > 0 || (validationWarnings.length > 0 && !warningsAcknowledged) || (riskResult?.cciFactors?.some((cf) => cf.modifier_indicator === "0") ?? false)}
                  data-testid="button-submit-claim"
                >
                  Submit via Office Ally
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={showSubmitModal} onOpenChange={setShowSubmitModal}>
        <DialogContent data-testid="dialog-submit">
          <DialogHeader>
            <DialogTitle>Electronic Submission</DialogTitle>
            <DialogDescription>
              Configure a clearinghouse in Settings → Clearinghouse to enable automated electronic submission. Stedi (recommended) or Office Ally SFTP are both supported.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitModal(false)} data-testid="button-close-submit-dialog">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stedi Test Validation Result Modal */}
      {/* ── Production submission confirmation modal (Task 3c) ─────────────── */}
      <Dialog open={showProdConfirmModal} onOpenChange={(o) => { setShowProdConfirmModal(o); if (!o) setConfirmationText(""); }}>
        <DialogContent className="max-w-md" data-testid="dialog-prod-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Submit to Real Payer — Live Claim
            </DialogTitle>
            <DialogDescription>
              This claim will be transmitted to the payer with <strong>ISA15=P</strong>. The payer will receive and adjudicate it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 text-sm">
              <p className="font-medium text-red-800 dark:text-red-300">You are about to submit a live claim.</p>
              <ul className="mt-1.5 text-xs text-red-700 dark:text-red-400 space-y-1 list-disc list-inside">
                <li>The payer will receive this 837P and adjudicate it</li>
                <li>This counts against your timely filing window</li>
                <li>Duplicate submission will trigger denial for duplicate</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="confirm-submit-input">
                Type <strong>SUBMIT TO PAYER</strong> to confirm:
              </label>
              <Input
                id="confirm-submit-input"
                data-testid="input-confirm-submit"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                placeholder="SUBMIT TO PAYER"
                className="font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowProdConfirmModal(false); setConfirmationText(""); }} data-testid="button-cancel-prod-confirm">
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800"
              disabled={confirmationText.trim() !== "SUBMIT TO PAYER" || stediSubmitting}
              data-testid="button-confirm-prod-submit"
              onClick={async () => {
                if (!claimId || confirmationText.trim() !== "SUBMIT TO PAYER") return;
                setShowProdConfirmModal(false);
                setConfirmationText("");
                setStediSubmitting(true);
                setStediResult(null);
                try {
                  const res = await fetch(`/api/billing/claims/${claimId}/submit-stedi`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ testMode: false }),
                  });
                  const result = await res.json();
                  setStediResult(result);
                  if (result.success) {
                    queryClient.invalidateQueries({ queryKey: ["/api/billing/claims"] });
                    toast({ title: "Claim submitted to payer (live)", description: `Transaction ID: ${result.transactionId || "N/A"}` });
                  } else {
                    toast({ title: "Stedi submission failed", description: result.error, variant: "destructive" });
                  }
                } catch (err: any) {
                  setStediResult({ success: false, error: err.message });
                  toast({ title: "Submission error", description: err.message, variant: "destructive" });
                } finally {
                  setStediSubmitting(false);
                }
              }}
            >
              {stediSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : "Confirm — Submit to Payer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTestModal} onOpenChange={setShowTestModal}>
        <DialogContent className="max-w-lg" data-testid="dialog-test-result">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {testClaimResult?.success
                ? <><CheckCircle2 className="h-5 w-5 text-green-600" /> Claim Passed Validation</>
                : <><XCircle className="h-5 w-5 text-red-600" /> Claim Failed Validation</>
              }
            </DialogTitle>
          </DialogHeader>

          {testClaimResult?.success ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your claim is EDI-valid and ready to submit to {testClaimResult.payerName || "the payer"}.
              </p>
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-green-800 dark:text-green-200">Stedi confirmed:</p>
                <ul className="text-xs text-green-700 dark:text-green-300 space-y-0.5">
                  <li>• EDI structure is correct</li>
                  <li>• All required segments present</li>
                  <li>• Payer ID routes correctly</li>
                  <li>• Segment counts verified</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2.5">
                Note: This validates EDI format only. The payer may still deny based on medical necessity or coverage rules that only apply during adjudication.
              </p>
              {testClaimResult.transactionId && (
                <p className="text-xs text-muted-foreground font-mono">Transaction ID: {testClaimResult.transactionId}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {(testClaimResult?.validationErrors || []).length > 0
                  ? `${(testClaimResult?.validationErrors || []).length} issue(s) must be fixed before this claim can be submitted.`
                  : testClaimResult?.error || "Stedi returned an unexpected response. Check the Activity Log for raw details."
                }
              </p>
              {(testClaimResult?.validationErrors || []).length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(testClaimResult?.validationErrors || []).map((err: any, i: number) => {
                    const mapped = mapValidationError(err);
                    return (
                      <div key={i} className="border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 rounded-lg p-3 text-sm" data-testid={`validation-error-${i}`}>
                        <div className="flex items-start gap-2">
                          <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                          <div className="space-y-1">
                            {mapped.code && mapped.code !== "UNKNOWN" && (
                              <span className="font-mono text-xs bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded text-red-700 dark:text-red-300">{mapped.code}</span>
                            )}
                            <p className="font-medium text-sm">{mapped.plain}</p>
                            <p className="text-xs text-muted-foreground">→ Fix: {mapped.fix}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowTestModal(false)} data-testid="button-close-test-modal">
              {testClaimResult?.success ? "Close" : "Fix These Issues"}
            </Button>
            {testClaimResult?.success && (
              <Button
                onClick={async () => {
                  setShowTestModal(false);
                  if (!claimId) return;
                  setStediSubmitting(true);
                  setStediResult(null);
                  try {
                    const res = await fetch(`/api/billing/claims/${claimId}/submit-stedi`, {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                    });
                    const result = await res.json();
                    setStediResult(result);
                    if (result.success) {
                      queryClient.invalidateQueries({ queryKey: ["/api/billing/claims"] });
                      toast({ title: "Claim submitted via Stedi", description: `Transaction ID: ${result.transactionId || "N/A"}` });
                    } else {
                      toast({ title: "Stedi submission failed", description: result.error, variant: "destructive" });
                    }
                  } catch (err: any) {
                    setStediResult({ success: false, error: err.message });
                    toast({ title: "Submission error", description: err.message, variant: "destructive" });
                  } finally {
                    setStediSubmitting(false);
                  }
                }}
                data-testid="button-submit-after-test"
              >
                Submit Claim Now
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
