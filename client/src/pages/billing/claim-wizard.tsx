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
  { value: "12", label: "Home (12)" },
  { value: "11", label: "Office (11)" },
  { value: "13", label: "Assisted Living Facility (13)" },
  { value: "10", label: "Telehealth - Patient Home (10)" },
  { value: "22", label: "Outpatient Hospital (22)" },
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

function PatientSearch({ onSelect, selectedPatient }: {
  onSelect: (patient: any) => void;
  selectedPatient: any;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

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
    return (
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
                {selectedPatient.insurance_carrier && <p>Insurance: {selectedPatient.insurance_carrier}</p>}
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
        </CardContent>
      </Card>
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

function InlineCodeSearch({ onSelect }: { onSelect: (result: any) => void }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const { toast } = useToast();

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
    onChange(index, { locationName: location, isAverageRate: false });
  }

  async function handleCodeSelect(result: any) {
    const isVA = patientPayer?.toLowerCase().includes("va");
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

    onChange(index, {
      code: result.code,
      description: result.description_plain || result.description_official || "",
      unitType: result.unit_type || "per_visit",
      unitIntervalMinutes: result.unit_interval_minutes || null,
      vaRate: rate || (result.va_rate ? String(result.va_rate) : null),
      ratePerUnit: rate,
      requiresModifier: result.requires_modifier || false,
      manualEntry: result.manual || false,
      hours: "",
      units: result.unit_type === "time_based" ? "" : "1",
      totalCharge: "",
      chargeOverridden: false,
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
              onChange={(e) => onChange(index, { code: e.target.value.toUpperCase() })}
              placeholder="e.g. G0299"
              className="font-mono"
              data-testid={`input-line-code-${index}`}
              onFocus={() => { if (!line.code) setShowCodeSearch(true); }}
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

      {showCodeSearch && <InlineCodeSearch onSelect={handleCodeSelect} />}

      {line.requiresModifier && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This code commonly requires a modifier — verify with your payer.
        </div>
      )}
      {line.code && isVACode(line.code) && patientPayer?.toLowerCase().includes("va") && (
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
                  <Label>Rate / unit {line.vaRate ? "" : <span className="text-amber-600 text-xs">(enter manually)</span>}</Label>
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
                <Label>Rate {!line.ratePerUnit && <span className="text-amber-600 text-xs">(enter manually)</span>}</Label>
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
  const [placeOfService, setPlaceOfService] = useState("12");
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
  const [delayReasonCode, setDelayReasonCode] = useState("none");

  const [riskResult, setRiskResult] = useState<{ riskScore: number; readinessStatus: string; factors: string[] } | null>(null);
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

  useEffect(() => {
    if (providers.length > 0 && !providerId) {
      const def = providers.find((p: any) => p.is_default);
      if (def) setProviderId(def.id);
    }
  }, [providers, providerId]);

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
      orderingProviderId: orderingProviderId || null,
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

    if (!authNumber) {
      const matchedPayer = payers.find((p: any) => p.name === patient?.insurance_carrier || p.id === patient?.payer_id);
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
        await apiRequest("PATCH", `/api/billing/patients/${patient.id}`, { authorization_number: authNumber });
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
                  billingLocation={wizardData?.practiceSettings?.billing_location || null}
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
            <CardHeader><CardTitle>Authorization</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Authorization Number</Label>
                <Input
                  value={authNumber}
                  onChange={(e) => setAuthNumber(e.target.value)}
                  placeholder="Enter auth number..."
                  data-testid="input-auth-number"
                />
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
                <Label>Ordering Provider <span className="text-xs text-muted-foreground">(if different from rendering)</span></Label>
                <Select value={orderingProviderId || "__none__"} onValueChange={(v) => setOrderingProviderId(v === "__none__" ? "" : v)}>
                  <SelectTrigger data-testid="select-ordering-provider">
                    <SelectValue placeholder="Same as rendering provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Same as rendering provider</SelectItem>
                    {providers.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}{p.credentials ? `, ${p.credentials}` : ""} — NPI: {p.npi}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  <p className="text-xs text-muted-foreground">Required for VA home health and certain Medicare claims</p>
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

          <div className="flex flex-wrap gap-3 justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(1)} data-testid="button-step3-back">Back to Service</Button>
            <div className="flex gap-3">
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
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={() => setShowSubmitModal(true)}
                disabled={validationErrors.length > 0 || (validationWarnings.length > 0 && !warningsAcknowledged)}
                data-testid="button-submit-claim"
              >
                Submit to Availity
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={showSubmitModal} onOpenChange={setShowSubmitModal}>
        <DialogContent data-testid="dialog-submit">
          <DialogHeader>
            <DialogTitle>Submit to Availity</DialogTitle>
            <DialogDescription>
              Direct submission is coming in a future update. Use Generate PDF and upload to your Availity portal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitModal(false)} data-testid="button-close-submit-dialog">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
