import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { validateNPI } from "@shared/npi-validation";
import {
  Plus,
  Star,
  AlertTriangle,
  Loader2,
  UserCheck,
  UserX,
  Building2,
  Users,
  CreditCard,
  DollarSign,
  Trash2,
  Pencil,
  MapPin,
  Clock,
  Search,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

import { CheckCircle, Send, Wifi, FileText, Zap, XCircle, Info, RefreshCw, CheckCheck, AlertCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const CREDENTIAL_OPTIONS = [
  "MD", "DO", "NP", "PA", "DPT", "DC", "PsyD", "LCSW", "LMFT", "PhD",
  "DDS", "DMD", "OD", "RN", "LPN", "PT", "OT", "SLP", "HHA", "PCA", "Other",
];

const TAXONOMY_SUGGESTIONS: Record<string, Array<{ code: string; label: string }>> = {
  MD: [
    { code: "207Q00000X", label: "Family Medicine" },
    { code: "208000000X", label: "Pediatrics" },
    { code: "207R00000X", label: "Internal Medicine" },
    { code: "207P00000X", label: "Emergency Medicine" },
    { code: "2086S0120X", label: "Surgery – Surgical Oncology" },
  ],
  DO: [
    { code: "207Q00000X", label: "Family Medicine (DO)" },
    { code: "207R00000X", label: "Internal Medicine (DO)" },
    { code: "207N00000X", label: "Dermatology" },
  ],
  NP: [
    { code: "363L00000X", label: "Nurse Practitioner" },
    { code: "363LF0000X", label: "NP – Family" },
    { code: "363LP0200X", label: "NP – Pediatrics" },
  ],
  PA: [
    { code: "363A00000X", label: "Physician Assistant" },
    { code: "363AM0700X", label: "PA – Medical" },
    { code: "363AS0400X", label: "PA – Surgical" },
  ],
  DPT: [
    { code: "225100000X", label: "Physical Therapist" },
    { code: "2251G0003X", label: "PT – Geriatrics" },
    { code: "2251H0300X", label: "PT – Hand" },
    { code: "2251H1300X", label: "PT – Human Factors" },
    { code: "2251N0400X", label: "PT – Neurology" },
    { code: "2251S0007X", label: "PT – Sports" },
  ],
  PT: [
    { code: "225100000X", label: "Physical Therapist" },
    { code: "2251G0003X", label: "PT – Geriatrics" },
    { code: "2251N0400X", label: "PT – Neurology" },
  ],
  OT: [
    { code: "225X00000X", label: "Occupational Therapist" },
    { code: "225XE0001X", label: "OT – Environmental Modification" },
    { code: "225XG0600X", label: "OT – Gerontology" },
    { code: "225XH1200X", label: "OT – Hand" },
  ],
  SLP: [
    { code: "235Z00000X", label: "Speech-Language Pathologist" },
  ],
  DC: [
    { code: "111N00000X", label: "Chiropractor" },
    { code: "111NI0013X", label: "Chiropractor – Independent Medical Examiner" },
  ],
  PsyD: [
    { code: "103TC0700X", label: "Psychologist – Clinical" },
    { code: "103TP2700X", label: "Psychologist – Private Practice" },
  ],
  PhD: [
    { code: "103TC0700X", label: "Psychologist – Clinical" },
    { code: "1041C0700X", label: "Counselor – Clinical" },
  ],
  LCSW: [
    { code: "1041C0700X", label: "Counselor – Clinical" },
    { code: "101YM0800X", label: "Counselor – Mental Health" },
  ],
  LMFT: [
    { code: "106H00000X", label: "Marriage & Family Therapist" },
  ],
  RN: [
    { code: "163W00000X", label: "Registered Nurse" },
    { code: "163WC0400X", label: "RN – Case Management" },
    { code: "163WH0500X", label: "RN – Home Health" },
  ],
  LPN: [
    { code: "164W00000X", label: "Licensed Practical Nurse" },
  ],
  HHA: [
    { code: "374U00000X", label: "Home Health Aide" },
  ],
  PCA: [
    { code: "376G00000X", label: "Nursing Home Administrator" },
    { code: "374T00000X", label: "Christian Science Practitioner (PCA)" },
  ],
  DDS: [
    { code: "122300000X", label: "Dentist" },
  ],
  DMD: [
    { code: "122300000X", label: "Dentist (DMD)" },
  ],
  OD: [
    { code: "152W00000X", label: "Optometrist" },
  ],
};

function ProvidersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any>(null);
  const [form, setForm] = useState({
    entityType: "individual" as "individual" | "organization",
    organizationName: "",
    firstName: "",
    lastName: "",
    credentials: "",
    customCredentials: "",
    npi: "",
    taxonomyCode: "",
    individualTaxId: "",
    licenseNumber: "",
    isDefault: false,
  });
  const [npiError, setNpiError] = useState("");
  const [npiLookup, setNpiLookup] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });
  const [taxonomySearch, setTaxonomySearch] = useState("");
  const [showTaxonomyPicker, setShowTaxonomyPicker] = useState(false);

  const { data: taxonomyCodes = [] } = useQuery<any[]>({
    queryKey: ["/api/taxonomy-codes"],
    queryFn: async () => {
      const r = await fetch("/api/taxonomy-codes", { credentials: "include" });
      return r.json();
    },
  });

  async function verifyNPI() {
    if (!validateNPI(form.npi)) {
      setNpiError("Invalid NPI — must be 10 digits and pass the NPI checksum");
      return;
    }
    setNpiLookup({ loading: true, result: null });
    try {
      const r = await fetch(`/api/npi-lookup?npi=${form.npi}`, { credentials: "include" });
      const data = await r.json();
      if (!data.found) {
        setNpiLookup({ loading: false, result: { found: false } });
        toast({ title: "NPI not found in registry", description: "Verify the number is correct.", variant: "destructive" });
        return;
      }
      setNpiLookup({ loading: false, result: data });
      setNpiError("");
    } catch {
      setNpiLookup({ loading: false, result: null });
      toast({ title: "Registry lookup failed", description: "Check your internet connection.", variant: "destructive" });
    }
  }

  function applyNpiLookup() {
    if (!npiLookup.result) return;
    const r = npiLookup.result;
    const registryType: "individual" | "organization" = r.entityType === "organization" ? "organization" : "individual";
    setForm((f) => ({
      ...f,
      entityType: registryType,
      organizationName: registryType === "organization" ? (r.organizationName || f.organizationName) : f.organizationName,
      firstName: registryType === "individual" ? (r.firstName || f.firstName) : f.firstName,
      lastName: registryType === "individual" ? (r.lastName || f.lastName) : f.lastName,
      taxonomyCode: r.taxonomyCode || f.taxonomyCode,
      credentials: registryType === "individual" && r.credential && CREDENTIAL_OPTIONS.includes(r.credential) ? r.credential : f.credentials,
    }));
    setNpiLookup({ loading: false, result: null });
    toast({ title: "Provider details filled from NPI Registry" });
  }

  const { data: providers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/providers", showDeactivated ? "all" : "active"],
    queryFn: async () => {
      const res = await fetch(`/api/billing/providers?all=${showDeactivated}`);
      if (!res.ok) throw new Error("Failed to fetch providers");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/billing/providers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/providers"] });
      setShowDialog(false);
      resetForm();
      toast({ title: "Provider added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/billing/providers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/providers"] });
      setShowDialog(false);
      setEditingProvider(null);
      resetForm();
      toast({ title: "Provider updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setForm({ entityType: "individual", organizationName: "", firstName: "", lastName: "", credentials: "", customCredentials: "", npi: "", taxonomyCode: "", individualTaxId: "", licenseNumber: "", isDefault: false });
    setNpiError("");
    setNpiLookup({ loading: false, result: null });
    setTaxonomySearch("");
  }

  function openAdd() {
    resetForm();
    setEditingProvider(null);
    setShowDialog(true);
  }

  function openEdit(provider: any) {
    const isOrg = provider.entity_type === 'organization';
    const cred = CREDENTIAL_OPTIONS.includes(provider.credentials) ? provider.credentials : provider.credentials ? "Other" : "";
    setForm({
      entityType: isOrg ? "organization" : "individual",
      organizationName: isOrg ? provider.first_name : "",
      firstName: isOrg ? "" : (provider.first_name || ""),
      lastName: isOrg ? "" : (provider.last_name || ""),
      credentials: isOrg ? "" : cred,
      customCredentials: cred === "Other" ? provider.credentials : "",
      npi: provider.npi,
      taxonomyCode: provider.taxonomy_code || "",
      individualTaxId: provider.individual_tax_id || "",
      licenseNumber: isOrg ? "" : (provider.license_number || ""),
      isDefault: provider.is_default,
    });
    setNpiError("");
    setEditingProvider(provider);
    setShowDialog(true);
  }

  function handleSubmit() {
    const isOrg = form.entityType === "organization";
    if (isOrg) {
      if (!form.organizationName.trim()) {
        toast({ title: "Organization name is required", variant: "destructive" });
        return;
      }
    } else {
      if (!form.firstName.trim() || !form.lastName.trim()) {
        toast({ title: "First and last name are required", variant: "destructive" });
        return;
      }
    }
    if (!validateNPI(form.npi)) {
      setNpiError("Invalid NPI — must be 10 digits and pass the NPI checksum");
      return;
    }
    const credentials = form.credentials === "Other" ? form.customCredentials : form.credentials;
    const payload: any = {
      entityType: form.entityType,
      npi: form.npi,
      taxonomyCode: form.taxonomyCode || null,
      individualTaxId: form.individualTaxId || null,
      isDefault: form.isDefault,
    };
    if (isOrg) {
      payload.organizationName = form.organizationName.trim();
    } else {
      payload.firstName = form.firstName.trim();
      payload.lastName = form.lastName.trim();
      payload.credentials = credentials || null;
      payload.licenseNumber = form.licenseNumber || null;
    }
    if (editingProvider) {
      updateMutation.mutate({ id: editingProvider.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function toggleActive(provider: any) {
    updateMutation.mutate({ id: provider.id, isActive: !provider.is_active });
  }

  function setDefault(provider: any) {
    updateMutation.mutate({ id: provider.id, isDefault: true });
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium">Providers</h3>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Switch checked={showDeactivated} onCheckedChange={setShowDeactivated} data-testid="toggle-show-deactivated" />
            Show deactivated
          </label>
        </div>
        <Button onClick={openAdd} data-testid="button-add-provider">
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No providers yet. Add your first provider to start creating claims.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Credentials</TableHead>
                <TableHead>NPI</TableHead>
                <TableHead>Taxonomy</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p: any) => (
                <TableRow key={p.id} className={!p.is_active ? "opacity-50" : ""} data-testid={`row-provider-${p.id}`}>
                  <TableCell className="font-medium">{p.first_name} {p.last_name}</TableCell>
                  <TableCell>{p.credentials || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{p.npi}</TableCell>
                  <TableCell className="text-sm">{p.taxonomy_code || "—"}</TableCell>
                  <TableCell>
                    {p.is_default ? (
                      <Badge variant="default" className="gap-1" data-testid={`badge-default-${p.id}`}>
                        <Star className="h-3 w-3" /> Default
                      </Badge>
                    ) : p.is_active ? (
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setDefault(p)} data-testid={`button-set-default-${p.id}`}>
                        Set default
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {p.is_active && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)} data-testid={`button-edit-provider-${p.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(p)}
                        data-testid={`button-toggle-active-${p.id}`}
                      >
                        {p.is_active ? <UserX className="h-4 w-4 text-destructive" /> : <UserCheck className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditingProvider(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProvider ? "Edit Provider" : "Add Provider"}</DialogTitle>
            <DialogDescription>
              {editingProvider ? "Update provider details." : "Enter the provider's information. NPI is validated using the standard checksum."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Entity type — Type 1 (Individual) or Type 2 (Organization) */}
            <div className="space-y-2">
              <Label>Provider Type</Label>
              <div className="flex gap-3">
                {(["individual", "organization"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-testid={`button-entity-type-${t}`}
                    onClick={() => setForm({ ...form, entityType: t, organizationName: "", firstName: "", lastName: "" })}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                      form.entityType === t
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border bg-background hover:border-primary/50"
                    }`}
                  >
                    <span className="font-semibold">{t === "individual" ? "Type 1 — Individual" : "Type 2 — Organization"}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {t === "individual" ? "Solo practitioner or employee provider" : "Group practice, clinic, or facility NPI"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {form.entityType === "organization" ? (
              <div className="space-y-2">
                <Label htmlFor="prov-org-name">Organization Name *</Label>
                <Input
                  id="prov-org-name"
                  value={form.organizationName}
                  onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
                  placeholder="e.g. Sunrise Medical Group LLC"
                  data-testid="input-provider-org-name"
                />
                <p className="text-xs text-muted-foreground">Type 2 NPI — used as billing entity name on claims.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="prov-first">First Name *</Label>
                  <Input id="prov-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-provider-first-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prov-last">Last Name *</Label>
                  <Input id="prov-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-provider-last-name" />
                </div>
              </div>
            )}
            {form.entityType === "individual" && (
            <div className="space-y-2">
              <Label>Credentials</Label>
              <Select value={form.credentials} onValueChange={(v) => {
                const suggestions = TAXONOMY_SUGGESTIONS[v] || [];
                const autoFill = suggestions.length === 1 && !form.taxonomyCode;
                setForm({ ...form, credentials: v, taxonomyCode: autoFill ? suggestions[0].code : form.taxonomyCode });
              }}>
                <SelectTrigger data-testid="select-provider-credentials">
                  <SelectValue placeholder="Select credentials" />
                </SelectTrigger>
                <SelectContent>
                  {CREDENTIAL_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.credentials === "Other" && (
                <Input placeholder="Enter credentials" value={form.customCredentials} onChange={(e) => setForm({ ...form, customCredentials: e.target.value })} data-testid="input-provider-custom-credentials" />
              )}
              {form.credentials && TAXONOMY_SUGGESTIONS[form.credentials] && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Suggested taxonomy codes for {form.credentials}:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TAXONOMY_SUGGESTIONS[form.credentials].map((s) => (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => setForm({ ...form, taxonomyCode: s.code })}
                        data-testid={`button-taxonomy-suggest-${s.code}`}
                        className={`inline-flex flex-col items-start rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                          form.taxonomyCode === s.code
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/40 text-foreground border-border hover:border-primary/50 hover:bg-muted"
                        }`}
                      >
                        <span className="font-mono font-semibold">{s.code}</span>
                        <span className="text-[10px] opacity-80">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="prov-npi">NPI * (10 digits)</Label>
              <div className="flex gap-2">
                <Input
                  id="prov-npi"
                  value={form.npi}
                  maxLength={10}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setForm({ ...form, npi: v });
                    setNpiLookup({ loading: false, result: null });
                    if (npiError && v.length === 10 && validateNPI(v)) setNpiError("");
                  }}
                  className={npiError ? "border-destructive" : ""}
                  data-testid="input-provider-npi"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1 text-xs"
                  disabled={npiLookup.loading || form.npi.length !== 10}
                  onClick={verifyNPI}
                  data-testid="button-verify-npi"
                >
                  {npiLookup.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  Verify
                </Button>
              </div>
              {npiError && <p className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{npiError}</p>}
              {npiLookup.result?.found && (() => {
                const registryType: "individual" | "organization" = npiLookup.result.entityType === "organization" ? "organization" : "individual";
                const typeMismatch = form.entityType !== registryType;
                return (
                  <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-sm space-y-1">
                    <p className="font-medium text-green-800 dark:text-green-300 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Found in NPI Registry — {registryType === "organization" ? "Type 2 (Organization)" : "Type 1 (Individual)"}
                    </p>
                    {typeMismatch && (
                      <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium" data-testid="text-npi-type-mismatch">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        NPI type mismatch: registry says <strong className="mx-0.5">{registryType}</strong> but form is set to <strong className="mx-0.5">{form.entityType}</strong>. Auto-fill will correct this.
                      </p>
                    )}
                    <p className="text-green-700 dark:text-green-400">
                      {registryType === "organization"
                        ? (npiLookup.result.organizationName || npiLookup.result.firstName)
                        : `${npiLookup.result.firstName} ${npiLookup.result.lastName}`}
                      {registryType === "individual" && npiLookup.result.credential ? `, ${npiLookup.result.credential}` : ""}
                    </p>
                    {npiLookup.result.taxonomyDesc && (
                      <p className="text-green-600 dark:text-green-500 text-xs">{npiLookup.result.taxonomyDesc} ({npiLookup.result.taxonomyCode})</p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs mt-1 border-green-300 dark:border-green-700 text-green-800 dark:text-green-300"
                      onClick={applyNpiLookup}
                      data-testid="button-apply-npi-lookup"
                    >
                      Auto-fill name &amp; taxonomy{typeMismatch ? " (and fix type)" : ""}
                    </Button>
                  </div>
                );
              })()}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prov-taxonomy">Taxonomy Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="prov-taxonomy"
                    value={form.taxonomyCode}
                    onChange={(e) => setForm({ ...form, taxonomyCode: e.target.value })}
                    placeholder="e.g. 207Q00000X"
                    data-testid="input-provider-taxonomy"
                  />
                  <Popover open={showTaxonomyPicker} onOpenChange={(o) => { setShowTaxonomyPicker(o); if (!o) setTaxonomySearch(""); }}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        data-testid="button-taxonomy-picker"
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-2" align="end" onOpenAutoFocus={(e) => e.preventDefault()}>
                      <Input
                        placeholder="Search specialty…"
                        value={taxonomySearch}
                        onChange={(e) => setTaxonomySearch(e.target.value)}
                        className="mb-2 h-8 text-sm"
                        data-testid="input-taxonomy-search"
                      />
                      <div className="max-h-52 overflow-y-auto space-y-0.5">
                        {taxonomyCodes
                          .filter((t) =>
                            !taxonomySearch ||
                            t.display.toLowerCase().includes(taxonomySearch.toLowerCase()) ||
                            t.code.toLowerCase().includes(taxonomySearch.toLowerCase())
                          )
                          .map((t) => (
                            <button
                              key={t.code}
                              type="button"
                              className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent cursor-pointer"
                              onClick={() => {
                                setForm((f) => ({ ...f, taxonomyCode: t.code }));
                                setShowTaxonomyPicker(false);
                                setTaxonomySearch("");
                              }}
                            >
                              <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                              <span className="ml-2">{t.display}</span>
                            </button>
                          ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="prov-taxid">Individual Tax ID</Label>
                <Input id="prov-taxid" value={form.individualTaxId} onChange={(e) => setForm({ ...form, individualTaxId: e.target.value })} placeholder="9 digits" data-testid="input-provider-tax-id" />
              </div>
              {form.entityType === "individual" && (
                <div className="space-y-2">
                  <Label htmlFor="prov-license">State License Number <span className="text-muted-foreground text-xs">(included as REF*1C in EDI — required by many payers)</span></Label>
                  <Input id="prov-license" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} placeholder="e.g. TX-12345678" data-testid="input-provider-license" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} data-testid="toggle-provider-default" />
              <Label className="cursor-pointer">Set as default provider</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="button-save-provider">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingProvider ? "Save Changes" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PracticeInfoTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    practiceName: "",
    primaryNpi: "",
    taxId: "",
    taxonomyCode: "",
    phone: "",
    defaultPos: "11",
    street: "",
    city: "",
    state: "",
    zip: "",
    billingLocation: "",
    defaultVaLocality: "",
  });
  const [npiError, setNpiError] = useState("");
  const [locationSearch, setLocationSearch] = useState("");

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/practice-settings"],
    queryFn: async () => {
      const res = await fetch("/api/billing/practice-settings");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: vaLocations } = useQuery<string[]>({
    queryKey: ["/api/billing/va-locations"],
    queryFn: async () => {
      const res = await fetch("/api/billing/va-locations");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: ratesAge } = useQuery<{ lastUpdated: string | null }>({
    queryKey: ["/api/billing/va-rates-age"],
    queryFn: async () => {
      const res = await fetch("/api/billing/va-rates-age");
      if (!res.ok) return { lastUpdated: null };
      return res.json();
    },
  });

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (settings && !initialized) {
      const addr = typeof settings.address === "string" ? JSON.parse(settings.address) : settings.address || {};
      setForm({
        practiceName: settings.practice_name || "",
        primaryNpi: settings.primary_npi || "",
        taxId: settings.tax_id || "",
        taxonomyCode: settings.taxonomy_code || "",
        phone: settings.phone || "",
        defaultPos: settings.default_pos || "11",
        street: addr.street || "",
        city: addr.city || "",
        state: addr.state || "",
        zip: addr.zip || "",
        billingLocation: settings.billing_location || "",
        defaultVaLocality: settings.default_va_locality || "",
      });
      setInitialized(true);
    }
  }, [settings, initialized]);

  const filteredLocations = (vaLocations || []).filter(
    (loc) => loc.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const ratesStale = ratesAge?.lastUpdated
    ? (Date.now() - new Date(ratesAge.lastUpdated).getTime()) > 90 * 24 * 60 * 60 * 1000
    : false;

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", "/api/billing/practice-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/practice-settings"] });
      toast({ title: "Practice settings saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleSave() {
    if (form.primaryNpi && !validateNPI(form.primaryNpi)) {
      setNpiError("Invalid NPI");
      return;
    }
    saveMutation.mutate({
      practiceName: form.practiceName,
      primaryNpi: form.primaryNpi || null,
      taxId: form.taxId || null,
      taxonomyCode: form.taxonomyCode || null,
      phone: form.phone || null,
      defaultPos: form.defaultPos,
      address: { street: form.street, city: form.city, state: form.state, zip: form.zip },
      billingLocation: form.billingLocation || null,
      defaultVaLocality: form.defaultVaLocality || null,
    });
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      {!settings && (
        <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-4" data-testid="banner-practice-setup">
          <Building2 className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-800 dark:text-blue-200">Complete your practice setup</p>
            <p className="text-blue-700 dark:text-blue-300">Enter your practice details below to start generating claims and reports.</p>
          </div>
        </div>
      )}
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label>Practice Name</Label>
          <Input value={form.practiceName} onChange={(e) => setForm({ ...form, practiceName: e.target.value })} data-testid="input-practice-name" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Primary NPI</Label>
            <Input value={form.primaryNpi} maxLength={10} onChange={(e) => { setForm({ ...form, primaryNpi: e.target.value.replace(/\D/g, "").slice(0, 10) }); setNpiError(""); }} className={npiError ? "border-destructive" : ""} data-testid="input-practice-npi" />
            {npiError && <p className="text-sm text-destructive">{npiError}</p>}
          </div>
          <div className="space-y-2">
            <Label>Tax ID (EIN)</Label>
            <Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder="XX-XXXXXXX" data-testid="input-practice-tax-id" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Taxonomy Code</Label>
            <Input value={form.taxonomyCode} onChange={(e) => setForm({ ...form, taxonomyCode: e.target.value })} data-testid="input-practice-taxonomy" />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-practice-phone" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Default Place of Service</Label>
          <Select value={form.defaultPos} onValueChange={(v) => setForm({ ...form, defaultPos: v })}>
            <SelectTrigger data-testid="select-practice-pos"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="11">11 — Office</SelectItem>
              <SelectItem value="12">12 — Home</SelectItem>
              <SelectItem value="10">10 — Telehealth - Patient Home</SelectItem>
              <SelectItem value="13">13 — Assisted Living Facility</SelectItem>
              <SelectItem value="19">19 — Off Campus Outpatient Hospital</SelectItem>
              <SelectItem value="21">21 — Inpatient Hospital</SelectItem>
              <SelectItem value="22">22 — Outpatient Hospital</SelectItem>
              <SelectItem value="23">23 — Emergency Room</SelectItem>
              <SelectItem value="24">24 — Ambulatory Surgical Center</SelectItem>
              <SelectItem value="31">31 — Skilled Nursing Facility</SelectItem>
              <SelectItem value="32">32 — Nursing Facility</SelectItem>
              <SelectItem value="49">49 — Independent Clinic</SelectItem>
              <SelectItem value="81">81 — Independent Laboratory</SelectItem>
              <SelectItem value="99">99 — Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />VA Fee Schedule Locality</Label>
        <p className="text-xs text-muted-foreground">Select the locality that matches your practice location. This pre-fills the VA locality in claim service lines and determines the applicable VA Community Care fee schedule rate.</p>
        <Select value={form.defaultVaLocality} onValueChange={(v) => setForm({ ...form, defaultVaLocality: v })}>
          <SelectTrigger data-testid="select-billing-location">
            <SelectValue placeholder="Select VA locality..." />
          </SelectTrigger>
          <SelectContent>
            <div className="p-2">
              <Input
                placeholder="Search locations..."
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                className="h-8 text-sm"
                data-testid="input-location-search"
              />
            </div>
            {filteredLocations.map((loc) => (
              <SelectItem key={loc} value={loc}>{loc}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {ratesStale && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3" data-testid="banner-rates-stale">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200">VA fee schedule rates may be outdated</p>
            <p className="text-amber-700 dark:text-amber-300">
              Rates were last updated {ratesAge?.lastUpdated ? new Date(ratesAge.lastUpdated).toLocaleDateString() : "unknown"}.
              CMS updates rates annually in January. Download the new fee schedule from CMS.gov and contact support to update your rates.
            </p>
          </div>
        </div>
      )}
      <div>
        <h4 className="text-sm font-medium mb-3">Address</h4>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>Street</Label>
            <Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} data-testid="input-practice-street" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="input-practice-city" />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={2} data-testid="input-practice-state" />
            </div>
            <div className="space-y-2">
              <Label>ZIP</Label>
              <Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} data-testid="input-practice-zip" />
            </div>
          </div>
        </div>
      </div>
      <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-practice">
        {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save Practice Settings
      </Button>
    </div>
  );
}

const TOS_OPTIONS = [
  { value: "1", label: "1 – Medical Care" },
  { value: "2", label: "2 – Surgery" },
  { value: "3", label: "3 – Consultation" },
  { value: "4", label: "4 – Diagnostic Radiology" },
  { value: "5", label: "5 – Diagnostic Laboratory" },
  { value: "6", label: "6 – Radiation Therapy" },
  { value: "7", label: "7 – Anesthesia" },
  { value: "8", label: "8 – Assistant at Surgery" },
  { value: "9", label: "9 – Other Medical" },
  { value: "0", label: "0 – Blood or Packed Red Cells" },
];

function ClaimDefaultsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [initialized, setInitialized] = useState(false);
  const [form, setForm] = useState({
    defaultPos: "11",
    defaultTos: "none",
    defaultOrderingProviderId: "none",
    homeboundDefault: false,
    excludeFacility: false,
  });

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/practice-settings"],
  });

  const { data: wizardData } = useQuery<any>({
    queryKey: ["/api/billing/claims/wizard-data"],
  });
  const providers: any[] = wizardData?.providers || [];

  useEffect(() => {
    if (settings && !initialized) {
      setForm({
        defaultPos: settings.default_pos || "11",
        defaultTos: settings.default_tos || "none",
        defaultOrderingProviderId: settings.default_ordering_provider_id || "none",
        homeboundDefault: settings.homebound_default ?? false,
        excludeFacility: settings.exclude_facility ?? false,
      });
      setInitialized(true);
    }
  }, [settings, initialized]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const existing = settings || {};
      const addr = typeof existing.address === "string" ? JSON.parse(existing.address) : existing.address || {};
      const res = await apiRequest("PUT", "/api/billing/practice-settings", {
        practiceName: existing.practice_name || "",
        primaryNpi: existing.primary_npi || null,
        taxId: existing.tax_id || null,
        taxonomyCode: existing.taxonomy_code || null,
        phone: existing.phone || null,
        defaultPos: existing.default_pos || "12",
        address: addr,
        billingLocation: existing.billing_location || null,
        ...data,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/practice-settings"] });
      toast({ title: "Claim defaults saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleSave() {
    saveMutation.mutate({
      defaultTos: form.defaultTos === "none" ? null : form.defaultTos,
      defaultOrderingProviderId: form.defaultOrderingProviderId === "none" ? null : form.defaultOrderingProviderId,
      homeboundDefault: form.homeboundDefault,
      excludeFacility: form.excludeFacility,
    });
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claim Defaults</CardTitle>
          <CardDescription>These values pre-populate new claims. Billers can override any field on a per-claim basis.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Place of Service</Label>
              <Select value={form.defaultPos} onValueChange={(v) => setForm({ ...form, defaultPos: v })}>
                <SelectTrigger data-testid="select-default-pos"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="11">11 — Office</SelectItem>
                  <SelectItem value="12">12 — Home</SelectItem>
                  <SelectItem value="10">10 — Telehealth - Patient Home</SelectItem>
                  <SelectItem value="13">13 — Assisted Living Facility</SelectItem>
                  <SelectItem value="19">19 — Off Campus Outpatient Hospital</SelectItem>
                  <SelectItem value="21">21 — Inpatient Hospital</SelectItem>
                  <SelectItem value="22">22 — Outpatient Hospital</SelectItem>
                  <SelectItem value="23">23 — Emergency Room</SelectItem>
                  <SelectItem value="24">24 — Ambulatory Surgical Center</SelectItem>
                  <SelectItem value="31">31 — Skilled Nursing Facility</SelectItem>
                  <SelectItem value="32">32 — Nursing Facility</SelectItem>
                  <SelectItem value="49">49 — Independent Clinic</SelectItem>
                  <SelectItem value="81">81 — Independent Laboratory</SelectItem>
                  <SelectItem value="99">99 — Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Type of Service</Label>
              <Select value={form.defaultTos} onValueChange={(v) => setForm({ ...form, defaultTos: v })}>
                <SelectTrigger data-testid="select-default-tos"><SelectValue placeholder="No default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No default</SelectItem>
                  {TOS_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Default Ordering Provider</Label>
            <Select value={form.defaultOrderingProviderId} onValueChange={(v) => setForm({ ...form, defaultOrderingProviderId: v })}>
              <SelectTrigger data-testid="select-default-ordering-provider"><SelectValue placeholder="No default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default</SelectItem>
                {providers.filter((p: any) => p.is_active !== false).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}{p.credentials ? `, ${p.credentials}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used as the ordering provider in Box 17/17b of CMS-1500.</p>
          </div>

          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm font-medium">Homebound Default</p>
                <p className="text-xs text-muted-foreground">Pre-check Homebound Indicator = Y on new claims (enable only for home health / VA CCN practices)</p>
              </div>
              <Switch
                checked={form.homeboundDefault}
                onCheckedChange={(v) => setForm({ ...form, homeboundDefault: v })}
                data-testid="toggle-homebound-default"
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm font-medium">Exclude Facility from Claims</p>
                <p className="text-xs text-muted-foreground">Leave Box 32 (facility address) blank on new claims. Enable only for practices that never bill a facility.</p>
              </div>
              <Switch
                checked={form.excludeFacility}
                onCheckedChange={(v) => setForm({ ...form, excludeFacility: v })}
                data-testid="toggle-exclude-facility"
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-claim-defaults">
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Claim Defaults
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PayersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingPayer, setEditingPayer] = useState<any>(null);
  const [form, setForm] = useState({ name: "", payerId: "", timelyFilingDays: "365", authRequired: false });
  const [editForm, setEditForm] = useState({
    payerId: "", timelyFilingDays: "365", authRequired: false,
    autoFollowupDays: "30",
    eraAutoPostClean: false, eraAutoPostContractual: false,
    eraAutoPostSecondary: true, eraAutoPostRefunds: true, eraHoldIfMismatch: true,
    payerClassification: "" as string,
    claimFilingIndicator: "" as string,
  });
  const [payerSearch, setPayerSearch] = useState("");
  const [payerDialogTab, setPayerDialogTab] = useState("settings");
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [stediSuggestion, setStediSuggestion] = useState<any>(null);
  const [stediSearching, setStediSearching] = useState(false);
  const [addReqForm, setAddReqForm] = useState({
    code: "", codeType: "HCPCS", authRequired: true,
    authConditions: "", authValidityDays: "", authNumberFormatHint: "",
    typicalTurnaroundDays: "", submissionMethod: "", portalUrl: "", notes: "",
  });
  const [addingReq, setAddingReq] = useState(false);

  const { data: payerAuthReqs = [], refetch: refetchAuthReqs } = useQuery<any[]>({
    queryKey: ["/api/billing/payer-auth-requirements", editingPayer?.id],
    queryFn: async () => {
      if (!editingPayer?.id) return [];
      const res = await fetch(`/api/billing/payer-auth-requirements?payerId=${editingPayer.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!editingPayer?.id && payerDialogTab === "auth-reqs",
  });

  const addReqMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/billing/payer-auth-requirements", data);
      return res.json();
    },
    onSuccess: () => {
      refetchAuthReqs();
      setAddReqForm({ code: "", codeType: "HCPCS", authRequired: true, authConditions: "", authValidityDays: "", authNumberFormatHint: "", typicalTurnaroundDays: "", submissionMethod: "", portalUrl: "", notes: "" });
      setAddingReq(false);
      toast({ title: "Auth requirement saved" });
    },
    onError: () => toast({ title: "Error saving requirement", variant: "destructive" }),
  });

  const deleteReqMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/billing/payer-auth-requirements/${id}`),
    onSuccess: () => { refetchAuthReqs(); toast({ title: "Requirement deleted" }); },
    onError: () => toast({ title: "Error deleting requirement", variant: "destructive" }),
  });

  const { data: payers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiRequest("POST", "/api/billing/payers/sync-stedi");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncResult(data);
      setShowSyncModal(true);
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payers"] });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const name = form.name.trim();
    if (name.length < 3) { setStediSuggestion(null); return; }
    const timer = setTimeout(async () => {
      setStediSearching(true);
      try {
        const res = await fetch(`/api/billing/payers/stedi-search?q=${encodeURIComponent(name)}`);
        const matches = await res.json();
        setStediSuggestion(matches[0] || null);
      } catch { setStediSuggestion(null); }
      finally { setStediSearching(false); }
    }, 600);
    return () => clearTimeout(timer);
  }, [form.name]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/billing/payers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payers"] });
      setShowDialog(false);
      setForm({ name: "", payerId: "", timelyFilingDays: "365", authRequired: false });
      toast({ title: "Payer added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/billing/payers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payers"] });
      setEditingPayer(null);
      toast({ title: "Payer updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: any) => {
      const res = await apiRequest("PATCH", `/api/billing/payers/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payers"] });
      toast({ title: "Payer updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredPayers = payers.filter((p) =>
    !payerSearch ||
    p.name.toLowerCase().includes(payerSearch.toLowerCase()) ||
    (p.payer_id || "").toLowerCase().includes(payerSearch.toLowerCase())
  );

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Payers</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing} data-testid="button-sync-stedi-payers">
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync from Stedi
          </Button>
          <Button onClick={() => { setShowDialog(true); setStediSuggestion(null); }} data-testid="button-add-payer">
            <Plus className="h-4 w-4 mr-2" />
            Add Custom Payer
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search payers by name or ID…"
          value={payerSearch}
          onChange={(e) => setPayerSearch(e.target.value)}
          data-testid="input-payer-search"
        />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payer Name</TableHead>
              <TableHead>EDI Payer ID</TableHead>
              <TableHead>Transactions</TableHead>
              <TableHead>Timely Filing</TableHead>
              <TableHead>Auth Required</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPayers.map((p: any) => (
              <TableRow key={p.id} className={!p.is_active ? "opacity-50" : ""} data-testid={`row-payer-${p.id}`}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.name}
                    {p.is_custom && <Badge variant="outline" className="text-xs">Custom</Badge>}
                    {p.stedi_payer_id && (
                      <span className="inline-flex items-center gap-0.5 text-xs bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800 rounded-full px-1.5 py-0.5" data-testid={`badge-stedi-payer-${p.id}`}>
                        <Zap className="h-2.5 w-2.5" /> Stedi
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {p.payer_id ? (
                    <span className="font-mono text-sm">{p.payer_id}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">No ID set</span>
                  )}
                </TableCell>
                <TableCell>
                  {p.supported_transactions && Array.isArray(p.supported_transactions) && p.supported_transactions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {p.supported_transactions.slice(0, 3).map((tx: string) => (
                        <span key={tx} className="text-xs bg-muted rounded px-1 py-0.5 font-mono">{tx}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>{p.timely_filing_days} days</TableCell>
                <TableCell>{p.auth_required ? "Yes" : "No"}</TableCell>
                <TableCell>
                  {p.is_active ? (
                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingPayer(p);
                        setEditForm({
                          payerId: p.payer_id || "",
                          timelyFilingDays: String(p.timely_filing_days || 365),
                          authRequired: !!p.auth_required,
                          autoFollowupDays: String(p.auto_followup_days ?? 30),
                          eraAutoPostClean: !!p.era_auto_post_clean,
                          eraAutoPostContractual: !!p.era_auto_post_contractual,
                          eraAutoPostSecondary: p.era_auto_post_secondary !== false,
                          eraAutoPostRefunds: p.era_auto_post_refunds !== false,
                          eraHoldIfMismatch: p.era_hold_if_mismatch !== false,
                          payerClassification: p.payer_classification || "",
                          claimFilingIndicator: p.claim_filing_indicator || "",
                        });
                      }}
                      data-testid={`button-edit-payer-${p.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: p.id, isActive: !p.is_active })}
                      data-testid={`button-toggle-payer-${p.id}`}
                    >
                      {p.is_active ? <UserX className="h-4 w-4 text-destructive" /> : <UserCheck className="h-4 w-4 text-green-600" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredPayers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No payers match your search.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editingPayer} onOpenChange={(o) => { if (!o) { setEditingPayer(null); setPayerDialogTab("settings"); setAddingReq(false); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Payer — {editingPayer?.name}</DialogTitle>
            <DialogDescription>Update EDI settings, billing rules, and per-code authorization requirements.</DialogDescription>
          </DialogHeader>

          <Tabs value={payerDialogTab} onValueChange={setPayerDialogTab}>
            <TabsList className="w-full" data-testid="tabs-payer-edit">
              <TabsTrigger value="settings" className="flex-1" data-testid="tab-payer-settings">Settings</TabsTrigger>
              <TabsTrigger value="auth-reqs" className="flex-1" data-testid="tab-payer-auth-reqs">Auth Requirements</TabsTrigger>
            </TabsList>

            {/* Settings tab — existing fields */}
            <TabsContent value="settings" className="mt-4">
              <div className="grid gap-5">
                <div className="space-y-2">
                  <Label>EDI Payer ID</Label>
                  <Input
                    value={editForm.payerId}
                    onChange={(e) => setEditForm({ ...editForm, payerId: e.target.value })}
                    placeholder="e.g. 00052 or BCBSMA"
                    data-testid="input-edit-payer-id"
                  />
                  <p className="text-xs text-muted-foreground">This ID is used in the ISA/GS segments of 837P EDI submissions.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Payer Classification</Label>
                    <Select value={editForm.payerClassification} onValueChange={(v) => setEditForm({ ...editForm, payerClassification: v })}>
                      <SelectTrigger data-testid="select-payer-classification">
                        <SelectValue placeholder="Select classification" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— Unclassified —</SelectItem>
                        <SelectItem value="va_community_care">VA Community Care</SelectItem>
                        <SelectItem value="medicare_part_b">Medicare Part B</SelectItem>
                        <SelectItem value="medicare_advantage">Medicare Advantage</SelectItem>
                        <SelectItem value="medicaid">Medicaid</SelectItem>
                        <SelectItem value="commercial">Commercial / Private</SelectItem>
                        <SelectItem value="bcbs">Blue Cross Blue Shield</SelectItem>
                        <SelectItem value="tricare">TRICARE</SelectItem>
                        <SelectItem value="workers_comp">Workers' Comp</SelectItem>
                        <SelectItem value="auto">Auto / Liability</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Drives VA/Medicare rules engine logic — replaces name-based heuristics.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Claim Filing Indicator (SBR09)</Label>
                    <Select value={editForm.claimFilingIndicator} onValueChange={(v) => setEditForm({ ...editForm, claimFilingIndicator: v })}>
                      <SelectTrigger data-testid="select-claim-filing-indicator">
                        <SelectValue placeholder="Select code" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— Use default (CI) —</SelectItem>
                        <SelectItem value="CI">CI — Commercial Insurance</SelectItem>
                        <SelectItem value="VA">VA — Veterans Affairs Plan</SelectItem>
                        <SelectItem value="MB">MB — Medicare Part B</SelectItem>
                        <SelectItem value="MC">MC — Medicaid</SelectItem>
                        <SelectItem value="CH">CH — CHAMPUS/TRICARE</SelectItem>
                        <SelectItem value="WC">WC — Workers' Comp</SelectItem>
                        <SelectItem value="AM">AM — Automobile Medical</SelectItem>
                        <SelectItem value="OF">OF — Other Federal Program</SelectItem>
                        <SelectItem value="BL">BL — Blue Cross / Blue Shield</SelectItem>
                        <SelectItem value="HM">HM — HMO Medicare Risk</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Written into SBR09 of the 837P EDI transaction.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Timely Filing (days)</Label>
                    <Input
                      type="number"
                      value={editForm.timelyFilingDays}
                      onChange={(e) => setEditForm({ ...editForm, timelyFilingDays: e.target.value })}
                      data-testid="input-edit-payer-filing-days"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Auto Follow-Up After (days)</Label>
                    <Input
                      type="number"
                      value={editForm.autoFollowupDays}
                      onChange={(e) => setEditForm({ ...editForm, autoFollowupDays: e.target.value })}
                      placeholder="30"
                      data-testid="input-edit-payer-followup-days"
                    />
                    <p className="text-xs text-muted-foreground">Days after submission to schedule follow-up</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editForm.authRequired}
                    onCheckedChange={(v) => setEditForm({ ...editForm, authRequired: v })}
                    data-testid="toggle-edit-payer-auth-required"
                  />
                  <div>
                    <Label>Prior authorization required (default)</Label>
                    <p className="text-xs text-muted-foreground">Applies to all codes unless overridden in the Auth Requirements tab.</p>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-semibold">ERA Auto-Posting Rules</p>
                  <p className="text-xs text-muted-foreground">Configure which ERA line types are automatically posted without manual review.</p>
                  {[
                    { key: "eraAutoPostClean", label: "Auto-post clean paid lines", testId: "toggle-era-clean" },
                    { key: "eraAutoPostContractual", label: "Auto-post contractual adjustments (CO-45)", testId: "toggle-era-contractual" },
                    { key: "eraAutoPostSecondary", label: "Auto-post secondary payer credits", testId: "toggle-era-secondary" },
                    { key: "eraAutoPostRefunds", label: "Auto-post refund / credit balance adjustments", testId: "toggle-era-refunds" },
                  ].map(({ key, label, testId }) => (
                    <div key={key} className="flex items-center justify-between px-1">
                      <span className="text-sm">{label}</span>
                      <Switch
                        checked={(editForm as any)[key]}
                        onCheckedChange={(v) => setEditForm({ ...editForm, [key]: v })}
                        data-testid={testId}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-1 pt-1 border-t">
                    <div>
                      <span className="text-sm">Hold ERA if payment differs from allowable</span>
                      <p className="text-xs text-muted-foreground">Flag for manual review when paid ≠ contracted rate</p>
                    </div>
                    <Switch
                      checked={editForm.eraHoldIfMismatch}
                      onCheckedChange={(v) => setEditForm({ ...editForm, eraHoldIfMismatch: v })}
                      data-testid="toggle-era-hold-mismatch"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="outline" onClick={() => setEditingPayer(null)}>Cancel</Button>
                <Button
                  onClick={() => updateMutation.mutate({
                    id: editingPayer?.id,
                    payerId: editForm.payerId,
                    timelyFilingDays: parseInt(editForm.timelyFilingDays) || 365,
                    authRequired: editForm.authRequired,
                    autoFollowupDays: parseInt(editForm.autoFollowupDays) || 30,
                    eraAutoPostClean: editForm.eraAutoPostClean,
                    eraAutoPostContractual: editForm.eraAutoPostContractual,
                    eraAutoPostSecondary: editForm.eraAutoPostSecondary,
                    eraAutoPostRefunds: editForm.eraAutoPostRefunds,
                    eraHoldIfMismatch: editForm.eraHoldIfMismatch,
                    payerClassification: editForm.payerClassification || null,
                    claimFilingIndicator: editForm.claimFilingIndicator || null,
                  })}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-edit-payer"
                >
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </TabsContent>

            {/* Auth Requirements tab */}
            <TabsContent value="auth-reqs" className="mt-4 space-y-4" data-testid="content-auth-reqs">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Per-Code Authorization Rules</p>
                  <p className="text-xs text-muted-foreground">Override the default payer auth policy for specific HCPCS/CPT codes.</p>
                </div>
                <Button size="sm" onClick={() => setAddingReq(!addingReq)} data-testid="button-add-auth-req">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Rule
                </Button>
              </div>

              {addingReq && (
                <div className="border rounded-lg p-4 space-y-3 bg-muted/20" data-testid="form-add-auth-req">
                  <p className="text-sm font-semibold">New Authorization Rule</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Code *</Label>
                      <Input
                        placeholder="e.g. 99213"
                        value={addReqForm.code}
                        onChange={(e) => setAddReqForm({ ...addReqForm, code: e.target.value.toUpperCase() })}
                        data-testid="input-req-code"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Code Type</Label>
                      <Select value={addReqForm.codeType} onValueChange={(v) => setAddReqForm({ ...addReqForm, codeType: v })}>
                        <SelectTrigger data-testid="select-req-code-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HCPCS">HCPCS</SelectItem>
                          <SelectItem value="CPT">CPT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Auth Validity (days)</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 365"
                        value={addReqForm.authValidityDays}
                        onChange={(e) => setAddReqForm({ ...addReqForm, authValidityDays: e.target.value })}
                        data-testid="input-req-validity"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Typical Turnaround (days)</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 3"
                        value={addReqForm.typicalTurnaroundDays}
                        onChange={(e) => setAddReqForm({ ...addReqForm, typicalTurnaroundDays: e.target.value })}
                        data-testid="input-req-turnaround"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Submission Method</Label>
                      <Select value={addReqForm.submissionMethod || "_none"} onValueChange={(v) => setAddReqForm({ ...addReqForm, submissionMethod: v === "_none" ? "" : v })}>
                        <SelectTrigger data-testid="select-req-method"><SelectValue placeholder="Select method" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">— None —</SelectItem>
                          <SelectItem value="portal">Provider portal</SelectItem>
                          <SelectItem value="phone">Phone</SelectItem>
                          <SelectItem value="fax">Fax</SelectItem>
                          <SelectItem value="edi">EDI 278</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Auth Number Format Hint</Label>
                      <Input
                        placeholder="e.g. VA-XXXXXXXX-XXXX"
                        value={addReqForm.authNumberFormatHint}
                        onChange={(e) => setAddReqForm({ ...addReqForm, authNumberFormatHint: e.target.value })}
                        data-testid="input-req-hint"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Portal URL</Label>
                    <Input
                      placeholder="https://..."
                      value={addReqForm.portalUrl}
                      onChange={(e) => setAddReqForm({ ...addReqForm, portalUrl: e.target.value })}
                      data-testid="input-req-portal-url"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Conditions / Notes</Label>
                    <Textarea
                      placeholder="e.g. Required for all new PT episodes > 12 visits"
                      value={addReqForm.authConditions}
                      onChange={(e) => setAddReqForm({ ...addReqForm, authConditions: e.target.value })}
                      rows={2}
                      data-testid="textarea-req-conditions"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={addReqForm.authRequired}
                      onCheckedChange={(v) => setAddReqForm({ ...addReqForm, authRequired: v })}
                      data-testid="toggle-req-auth-required"
                    />
                    <Label className="text-xs">Auth required for this code</Label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddingReq(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      disabled={!addReqForm.code || addReqMutation.isPending}
                      onClick={() => addReqMutation.mutate({
                        payerId: editingPayer?.id,
                        payerName: editingPayer?.name,
                        code: addReqForm.code,
                        codeType: addReqForm.codeType,
                        authRequired: addReqForm.authRequired,
                        authConditions: addReqForm.authConditions || null,
                        authValidityDays: addReqForm.authValidityDays ? parseInt(addReqForm.authValidityDays) : null,
                        authNumberFormatHint: addReqForm.authNumberFormatHint || null,
                        typicalTurnaroundDays: addReqForm.typicalTurnaroundDays ? parseInt(addReqForm.typicalTurnaroundDays) : null,
                        submissionMethod: addReqForm.submissionMethod || null,
                        portalUrl: addReqForm.portalUrl || null,
                        notes: addReqForm.notes || null,
                      })}
                      data-testid="button-save-auth-req"
                    >
                      {addReqMutation.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                      Save Rule
                    </Button>
                  </div>
                </div>
              )}

              {payerAuthReqs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg" data-testid="empty-auth-reqs">
                  No per-code auth rules yet. The payer-level default applies.
                </div>
              ) : (
                <Table data-testid="table-auth-reqs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Auth?</TableHead>
                      <TableHead>Conditions</TableHead>
                      <TableHead>Valid (days)</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payerAuthReqs.map((r: any) => (
                      <TableRow key={r.id} data-testid={`row-auth-req-${r.id}`}>
                        <TableCell className="font-mono text-xs font-medium">{r.code}</TableCell>
                        <TableCell>
                          {r.auth_required
                            ? <Badge variant="destructive" className="text-xs">Required</Badge>
                            : <Badge variant="secondary" className="text-xs">Not required</Badge>
                          }
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.auth_conditions || "—"}</TableCell>
                        <TableCell className="text-xs">{r.auth_validity_days || "—"}</TableCell>
                        <TableCell className="text-xs capitalize">{r.submission_method || "—"}</TableCell>
                        <TableCell>
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteReqMutation.mutate(r.id)}
                            disabled={deleteReqMutation.isPending}
                            data-testid={`button-delete-req-${r.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={showDialog} onOpenChange={(o) => { setShowDialog(o); if (!o) { setStediSuggestion(null); setForm({ name: "", payerId: "", timelyFilingDays: "365", authRequired: false }); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Payer</DialogTitle>
            <DialogDescription>Add a payer not in the default list.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Payer Name *</Label>
              <div className="relative">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-payer-name" />
                {stediSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              {stediSuggestion && (
                <div className="flex items-center justify-between p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm" data-testid="banner-stedi-suggestion">
                  <span className="flex items-center gap-1.5 text-yellow-800 dark:text-yellow-200">
                    <Zap className="h-3.5 w-3.5 text-yellow-600" />
                    Found in Stedi network: <span className="font-mono font-semibold">{stediSuggestion.payerId}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-yellow-700 dark:text-yellow-300 hover:text-yellow-900"
                    onClick={() => setForm({ ...form, payerId: stediSuggestion.payerId })}
                    data-testid="button-accept-stedi-suggestion"
                  >
                    Use this ID
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payer ID</Label>
                <Input value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })} placeholder={stediSuggestion ? stediSuggestion.payerId : ""} data-testid="input-payer-id" />
              </div>
              <div className="space-y-2">
                <Label>Timely Filing (days)</Label>
                <Input type="number" value={form.timelyFilingDays} onChange={(e) => setForm({ ...form, timelyFilingDays: e.target.value })} data-testid="input-payer-filing-days" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.authRequired} onCheckedChange={(v) => setForm({ ...form, authRequired: v })} data-testid="toggle-payer-auth-required" />
              <Label>Prior authorization required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ name: form.name, payerId: form.payerId, timelyFilingDays: parseInt(form.timelyFilingDays) || 365, authRequired: form.authRequired, billingType: "professional" })} disabled={!form.name.trim() || createMutation.isPending} data-testid="button-save-payer">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Payer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Results Modal */}
      <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              Stedi Payer Sync Results
            </DialogTitle>
            <DialogDescription>
              Matched against {syncResult?.total_stedi_payers?.toLocaleString()} payers in the Stedi network.
            </DialogDescription>
          </DialogHeader>
          {syncResult && (
            <div className="space-y-4 py-2">
              {/* Matched */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-300">
                  <CheckCheck className="h-4 w-4" />
                  {syncResult.matched.length} payer{syncResult.matched.length !== 1 ? "s" : ""} updated
                </div>
                {syncResult.matched.length > 0 && (
                  <div className="rounded-md border divide-y text-sm">
                    {syncResult.matched.map((p: any) => (
                      <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-2" data-testid={`sync-matched-${p.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{p.name}</span>
                          {p.match_strategy === "manual_override" && (
                            <span className="shrink-0 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">manual override</span>
                          )}
                        </div>
                        <span className="shrink-0 text-muted-foreground font-mono text-xs">
                          {p.old_payer_id || "—"} → <span className="text-green-700 dark:text-green-400 font-semibold">{p.new_payer_id}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Already correct */}
              {syncResult.already_correct.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    {syncResult.already_correct.length} payer{syncResult.already_correct.length !== 1 ? "s" : ""} already correct
                  </div>
                </div>
              )}

              {/* Unmatched */}
              {syncResult.unmatched.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    {syncResult.unmatched.length} payer{syncResult.unmatched.length !== 1 ? "s" : ""} could not be matched — set their Payer IDs manually
                  </div>
                  <div className="rounded-md border divide-y text-sm">
                    {syncResult.unmatched.map((p: any) => (
                      <div key={p.id} className="px-3 py-2 flex items-center justify-between" data-testid={`sync-unmatched-${p.id}`}>
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">{p.current_payer_id || "No ID"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timely filing updates */}
              {syncResult.timely_filing_updated > 0 && (
                <div className="space-y-1.5 border-t pt-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                    <CheckCheck className="h-4 w-4" />
                    {syncResult.timely_filing_updated} payer{syncResult.timely_filing_updated !== 1 ? "s" : ""} updated with industry-standard timely filing limits
                  </div>
                  <div className="rounded-md border divide-y text-sm max-h-40 overflow-y-auto">
                    {syncResult.timely_filing_updates.map((p: any, i: number) => (
                      <div key={i} className="px-3 py-1.5 flex items-center justify-between">
                        <span className="text-muted-foreground truncate">{p.name}</span>
                        <span className="font-mono text-xs font-semibold">{p.days} days</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Billers can override per-payer in the Payers tab.</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowSyncModal(false)} data-testid="button-close-sync-modal">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RateTablesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingRate, setEditingRate] = useState<any>(null);
  const [form, setForm] = useState({ hcpcsCode: "", payerName: "", payerId: "", ratePerUnit: "", unitIntervalMinutes: "", effectiveDate: "" });

  const { data: rates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/rates"],
    queryFn: async () => {
      const res = await fetch("/api/billing/rates");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: hcpcsCodes = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/hcpcs"],
    queryFn: async () => {
      const res = await fetch("/api/billing/hcpcs");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: payers = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: vaRatesData } = useQuery<{ rows: any[]; localityCode: string | null }>({
    queryKey: ["/api/billing/va-rates"],
    queryFn: async () => {
      const res = await fetch("/api/billing/va-rates");
      if (!res.ok) return { rows: [], localityCode: null };
      return res.json();
    },
  });
  const vaRates = vaRatesData?.rows || [];
  const vaLocalityCode = vaRatesData?.localityCode || null;

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (data.id) {
        const res = await apiRequest("PATCH", `/api/billing/rates/${data.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/billing/rates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/rates"] });
      setShowDialog(false);
      setEditingRate(null);
      toast({ title: editingRate ? "Rate updated" : "Rate added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/billing/rates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/rates"] });
      toast({ title: "Rate deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function openAdd() {
    setForm({ hcpcsCode: "", payerName: "", payerId: "", ratePerUnit: "", unitIntervalMinutes: "", effectiveDate: new Date().toISOString().split("T")[0] });
    setEditingRate(null);
    setShowDialog(true);
  }

  function openEdit(rate: any) {
    setForm({
      hcpcsCode: rate.hcpcs_code,
      payerName: rate.payer_name,
      payerId: rate.payer_id || "",
      ratePerUnit: String(rate.rate_per_unit),
      unitIntervalMinutes: rate.unit_interval_minutes ? String(rate.unit_interval_minutes) : "",
      effectiveDate: rate.effective_date?.split("T")[0] || "",
    });
    setEditingRate(rate);
    setShowDialog(true);
  }

  const outdatedRates = rates.filter((r: any) => {
    if (!r.effective_date) return false;
    const effYear = new Date(r.effective_date).getFullYear();
    const currentYear = new Date().getFullYear();
    return effYear < currentYear;
  });

  const grouped = rates.reduce((acc: Record<string, any[]>, r: any) => {
    const key = r.payer_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {vaRates.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">VA Community Care Rates</h3>
              <p className="text-xs text-muted-foreground">
                Federal fee schedule — read-only{vaLocalityCode ? ` (Locality ${vaLocalityCode})` : ""}. Configure your billing location in Practice Info to see locality-specific rates.
              </p>
            </div>
          </div>
          <Card>
            <CardContent className="pt-0 p-0">
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>HCPCS</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Facility Rate</TableHead>
                      <TableHead>Non-Facility Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vaRates.map((r: any) => (
                      <TableRow key={`${r.locality_code}-${r.hcpcs_code}`} data-testid={`row-va-rate-${r.hcpcs_code}`}>
                        <TableCell className="font-mono font-medium">{r.hcpcs_code}</TableCell>
                        <TableCell className="text-sm max-w-[260px] truncate">{r.description_plain || r.description_official || "—"}</TableCell>
                        <TableCell className="font-medium">{r.facility_rate ? `$${Number(r.facility_rate).toFixed(2)}` : "—"}</TableCell>
                        <TableCell className="font-medium">{r.non_facility_rate ? `$${Number(r.non_facility_rate).toFixed(2)}` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Custom Rate Tables</h3>
        <Button onClick={openAdd} data-testid="button-add-rate">
          <Plus className="h-4 w-4 mr-2" />
          Add Rate
        </Button>
      </div>

      {outdatedRates.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3" data-testid="banner-outdated-rates">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200">Some rates may be outdated</p>
            <p className="text-amber-700 dark:text-amber-300">
              {outdatedRates.length} rate(s) have an effective date from a prior year. Check cms.gov for the current fee schedule.
            </p>
          </div>
        </div>
      )}

      {Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No rates configured. Add rates to calculate claim amounts automatically.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([payerName, payerRates]) => (
          <Card key={payerName}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{payerName}</CardTitle>
              <CardDescription>{payerRates.length} rate(s)</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>HCPCS</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Rate/Unit</TableHead>
                      <TableHead>Interval</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payerRates.map((r: any) => (
                      <TableRow key={r.id} data-testid={`row-rate-${r.id}`}>
                        <TableCell className="font-mono font-medium">{r.hcpcs_code}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{r.description_plain || r.description_official || "—"}</TableCell>
                        <TableCell className="font-medium">${Number(r.rate_per_unit).toFixed(2)}</TableCell>
                        <TableCell>{r.unit_interval_minutes ? `${r.unit_interval_minutes} min` : "—"}</TableCell>
                        <TableCell className="text-sm">{r.effective_date?.split("T")[0] || "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(r)} data-testid={`button-edit-rate-${r.id}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(r.id)} data-testid={`button-delete-rate-${r.id}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditingRate(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRate ? "Edit Rate" : "Add Rate"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!editingRate && (
              <>
                <div className="space-y-2">
                  <Label>HCPCS Code *</Label>
                  <Select value={form.hcpcsCode} onValueChange={(v) => setForm({ ...form, hcpcsCode: v })}>
                    <SelectTrigger data-testid="select-rate-hcpcs"><SelectValue placeholder="Select code" /></SelectTrigger>
                    <SelectContent>
                      {hcpcsCodes.map((c: any) => (
                        <SelectItem key={c.code} value={c.code}>{c.code} — {c.description_plain?.substring(0, 60) || c.description_official.substring(0, 60)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payer *</Label>
                  <Select value={form.payerId} onValueChange={(v) => {
                    const payer = payers.find((p: any) => p.id === v);
                    setForm({ ...form, payerId: v, payerName: payer?.name || "" });
                  }}>
                    <SelectTrigger data-testid="select-rate-payer"><SelectValue placeholder="Select payer" /></SelectTrigger>
                    <SelectContent>
                      {payers.filter((p: any) => p.is_active).map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rate Per Unit ($) *</Label>
                <Input type="number" step="0.01" value={form.ratePerUnit} onChange={(e) => setForm({ ...form, ratePerUnit: e.target.value })} data-testid="input-rate-amount" />
              </div>
              <div className="space-y-2">
                <Label>Unit Interval (min)</Label>
                <Input type="number" value={form.unitIntervalMinutes} onChange={(e) => setForm({ ...form, unitIntervalMinutes: e.target.value })} data-testid="input-rate-interval" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Effective Date *</Label>
              <Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} data-testid="input-rate-effective-date" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              const payload: any = {
                ratePerUnit: parseFloat(form.ratePerUnit),
                unitIntervalMinutes: form.unitIntervalMinutes ? parseInt(form.unitIntervalMinutes) : null,
                effectiveDate: form.effectiveDate,
              };
              if (editingRate) {
                payload.id = editingRate.id;
              } else {
                payload.hcpcsCode = form.hcpcsCode;
                payload.payerId = form.payerId;
                payload.payerName = form.payerName;
              }
              saveMutation.mutate(payload);
            }} disabled={saveMutation.isPending || (!editingRate && (!form.hcpcsCode || !form.payerName)) || !form.ratePerUnit || !form.effectiveDate} data-testid="button-save-rate">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingRate ? "Save Changes" : "Add Rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

function ClearinghouseTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: practiceSettings } = useQuery<any>({
    queryKey: ["/api/billing/practice-settings"],
  });
  const [togglingFrcpb, setTogglingFrcpb] = useState(false);
  const frcpbEnrolled = !!(practiceSettings?.frcpb_enrolled);
  const frcpbEnrolledAt: string | null = practiceSettings?.frcpb_enrolled_at ?? null;

  const handleToggleFrcpb = async () => {
    setTogglingFrcpb(true);
    try {
      await apiRequest("PATCH", "/api/billing/practice-settings/frcpb-enrollment", { enrolled: !frcpbEnrolled });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/practice-settings"] });
      toast({ title: !frcpbEnrolled ? "FRCPB enrollment activated" : "FRCPB enrollment removed" });
    } catch (err: any) {
      toast({ title: "Error updating FRCPB enrollment", description: err.message, variant: "destructive" });
    } finally {
      setTogglingFrcpb(false);
    }
  };
  const { data: stediStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/billing/stedi/status"],
    queryFn: async () => {
      const res = await fetch("/api/billing/stedi/status");
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });
  const stediConfigured = stediStatus?.configured ?? false;
  const { data: allPayers = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers");
      if (!res.ok) return [];
      return res.json();
    },
  });
  const stediEnrolledPayers = allPayers.filter((p: any) => p.stedi_payer_id);

  const [oaForm, setOaForm] = useState({
    submitterId: "",
    username: "",
    password: "",
  });
  const [initialized, setInitialized] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (practiceSettings && !initialized) {
      setOaForm({
        submitterId: practiceSettings.oa_submitter_id || "",
        username: practiceSettings.oa_sftp_username || "",
        password: "",
      });
      setInitialized(true);
    }
  }, [practiceSettings, initialized]);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const res = await fetch("/api/billing/test-oa-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: oaForm.username,
          password: oaForm.password,
        }),
      });
      const result = await res.json();
      setConnectionTestResult(result);
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/billing/practice-settings"] });
      }
    } catch {
      setConnectionTestResult({
        success: false,
        message: "Network error — could not reach the server",
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveOASettings = async () => {
    setSavingCredentials(true);
    try {
      await apiRequest("PUT", "/api/billing/practice-settings", {
        practiceName: practiceSettings?.practice_name,
        primaryNpi: practiceSettings?.primary_npi,
        taxId: practiceSettings?.tax_id,
        taxonomyCode: practiceSettings?.taxonomy_code,
        phone: practiceSettings?.phone,
        defaultPos: practiceSettings?.default_pos,
        address: practiceSettings?.address,
        billingLocation: practiceSettings?.billing_location,
        oa_submitter_id: oaForm.submitterId,
        oa_sftp_username: oaForm.username,
        oa_sftp_password: oaForm.password || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/practice-settings"] });
      toast({ title: "Office Ally credentials saved" });
    } catch (err: any) {
      toast({ title: "Error saving credentials", description: err.message, variant: "destructive" });
    } finally {
      setSavingCredentials(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">

      {/* ── Stedi Clearinghouse Section ─────────────────────────────────────── */}
      <div className="rounded-lg border p-4 space-y-4" data-testid="section-stedi">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" />
              <h3 className="text-base font-semibold">Stedi Clearinghouse</h3>
              {stediConfigured ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-medium px-2 py-0.5" data-testid="badge-stedi-connected">
                  <CheckCircle className="h-3 w-3" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs font-medium px-2 py-0.5" data-testid="badge-stedi-disconnected">
                  <XCircle className="h-3 w-3" /> Not configured
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Primary clearinghouse for real-time claim submission, 277CA acknowledgment tracking, and 835 ERA retrieval. Set <code className="bg-muted px-1 rounded text-xs">STEDI_API_KEY</code> in your environment secrets to activate.
            </p>
          </div>
        </div>

        {stediConfigured ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200" data-testid="banner-stedi-active">
            <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
            <div>
              <p className="font-medium">Stedi is your active clearinghouse</p>
              <p className="text-xs mt-0.5">Claims submitted from the wizard route through Stedi 837P. 277CA acknowledgments poll every 15 minutes. 835 ERAs poll every 6 hours.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200" data-testid="banner-stedi-setup">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
            <div>
              <p className="font-medium">Set up Stedi for electronic claim submission</p>
              <p className="text-xs mt-0.5">Add <strong>STEDI_API_KEY</strong> in your Replit Secrets panel. Claims will then route through Stedi instead of requiring manual Availity upload.</p>
            </div>
          </div>
        )}

        {/* Payer enrollment table — dynamic from Stedi-synced payers */}
        <div data-testid="section-stedi-payers">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payer Enrollment Status</p>
            {stediEnrolledPayers.length === 0 && (
              <span className="text-xs text-muted-foreground">Run "Sync from Stedi" in the Payers tab to populate</span>
            )}
          </div>
          {stediEnrolledPayers.length > 0 ? (
            <div className="rounded-md border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Payer</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">EDI Payer ID</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Supported Transactions</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Eligibility</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stediEnrolledPayers.map((p: any) => {
                    const txs: string[] = Array.isArray(p.supported_transactions) ? p.supported_transactions : [];
                    const supports271 = txs.length === 0 || txs.some((t) => t.includes("270") || t.includes("271") || t.toLowerCase().includes("eligibility"));
                    return (
                      <tr key={p.id} data-testid={`row-enrollment-${p.id}`}>
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{p.stedi_payer_id}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {txs.length > 0 ? txs.join(" · ") : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {supports271 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><CheckCircle className="h-3 w-3" /> Supported</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><XCircle className="h-3 w-3" /> Not supported</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {stediConfigured ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300 font-medium"><CheckCircle className="h-3 w-3 text-green-500" /> Enrolled</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending API key</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No Stedi-synced payers yet. Go to the Payers tab and click "Sync from Stedi" to match your payers against the Stedi network and populate this table.
            </div>
          )}
        </div>

        {/* FRCPB E2E Test Payer enrollment status */}
        <div data-testid="section-frcpb-enrollment">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Stedi E2E Test Payer (FRCPB)</p>
          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div className="flex items-center gap-3">
              {frcpbEnrolled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-medium px-2.5 py-1" data-testid="badge-frcpb-enrolled">
                  <CheckCircle className="h-3 w-3" /> Enrolled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs font-medium px-2.5 py-1" data-testid="badge-frcpb-not-enrolled">
                  <XCircle className="h-3 w-3" /> Not enrolled
                </span>
              )}
              <div>
                <p className="text-sm font-medium">Stedi E2E Test Payer</p>
                <p className="text-xs text-muted-foreground">
                  Payer ID: <span className="font-mono">FRCPB</span>
                  {frcpbEnrolled && frcpbEnrolledAt && (
                    <> · Enrolled {new Date(frcpbEnrolledAt).toLocaleDateString()}</>
                  )}
                </p>
              </div>
            </div>
            <Button
              variant={frcpbEnrolled ? "outline" : "default"}
              size="sm"
              onClick={handleToggleFrcpb}
              disabled={togglingFrcpb}
              data-testid="button-frcpb-toggle"
            >
              {togglingFrcpb ? "Saving…" : frcpbEnrolled ? "Unenroll" : "Mark Enrolled"}
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t pt-2" />

      {/* ── Office Ally Section ──────────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-semibold" data-testid="text-clearinghouse-title">Office Ally Integration <span className="text-xs font-normal text-muted-foreground">(fallback clearinghouse)</span></h3>
        <p className="text-sm text-muted-foreground mt-1">
          Fallback clearinghouse when Stedi is not configured. Office Ally is free for Medicare and many commercial payers.{" "}
          <a
            href="https://cms.officeally.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
            data-testid="link-office-ally"
          >
            Create a free Office Ally account
          </a>
        </p>
      </div>

      {practiceSettings?.oa_connected && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg" data-testid="banner-oa-connected">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <span className="text-sm text-green-700 dark:text-green-300 font-medium">
            Connected to Office Ally
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 max-w-lg">
        <div className="space-y-1">
          <Label htmlFor="oa_submitter_id">Submitter ID</Label>
          <Input
            id="oa_submitter_id"
            value={oaForm.submitterId}
            onChange={(e) => setOaForm((f) => ({ ...f, submitterId: e.target.value }))}
            placeholder="e.g. CLAIMSHIELD01"
            className="mt-1"
            data-testid="input-oa-submitter-id"
          />
          <p className="text-xs text-muted-foreground">
            Found in Office Ally under Account Settings
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="oa_username">Office Ally Username</Label>
          <Input
            id="oa_username"
            value={oaForm.username}
            onChange={(e) => setOaForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="Your Office Ally login username"
            className="mt-1"
            data-testid="input-oa-username"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="oa_password">Office Ally Password</Label>
          <Input
            id="oa_password"
            type="password"
            value={oaForm.password}
            onChange={(e) => setOaForm((f) => ({ ...f, password: e.target.value }))}
            placeholder={practiceSettings?.oa_sftp_username ? "••••••••  (saved)" : "Enter password"}
            className="mt-1"
            data-testid="input-oa-password"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={!oaForm.username || !oaForm.password || testingConnection}
            data-testid="button-test-connection"
          >
            {testingConnection ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4 mr-2" />
                Test Connection
              </>
            )}
          </Button>

          <Button
            onClick={handleSaveOASettings}
            disabled={!oaForm.username || savingCredentials}
            data-testid="button-save-oa"
          >
            {savingCredentials ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Credentials"
            )}
          </Button>
        </div>

        {connectionTestResult && (
          <div
            className={`p-3 rounded-lg text-sm ${
              connectionTestResult.success
                ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
            }`}
            data-testid="text-connection-result"
          >
            {connectionTestResult.message}
          </div>
        )}
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium mb-2">How it works</h4>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Create a free account at officeally.com</li>
          <li>Enter your username and password above and click Test Connection</li>
          <li>Once connected, a "Submit via Office Ally" button appears on every claim</li>
          <li>Claims are submitted automatically and denial reasons are tracked in real time</li>
        </ol>
      </div>
    </div>
  );
}

export default function BillingSettings() {
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const defaultTab = tabFromUrl && ["providers", "practice", "payers", "rates", "clearinghouse", "claim-defaults"].includes(tabFromUrl) ? tabFromUrl : "providers";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Practice Settings</h1>
        <p className="text-muted-foreground">Practice info, providers, payers, and rate configuration</p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList data-testid="tabs-settings" className="flex-wrap h-auto gap-1">
          <TabsTrigger value="providers" data-testid="tab-providers">
            <Users className="h-4 w-4 mr-2" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="practice" data-testid="tab-practice">
            <Building2 className="h-4 w-4 mr-2" />
            Practice Info
          </TabsTrigger>
          <TabsTrigger value="payers" data-testid="tab-payers">
            <CreditCard className="h-4 w-4 mr-2" />
            Payers
          </TabsTrigger>
          <TabsTrigger value="claim-defaults" data-testid="tab-claim-defaults">
            <FileText className="h-4 w-4 mr-2" />
            Claim Defaults
          </TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-rates">
            <DollarSign className="h-4 w-4 mr-2" />
            Rate Tables
          </TabsTrigger>
          <TabsTrigger value="clearinghouse" data-testid="tab-clearinghouse">
            <Wifi className="h-4 w-4 mr-2" />
            Clearinghouse
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          <ProvidersTab />
        </TabsContent>
        <TabsContent value="practice">
          <PracticeInfoTab />
        </TabsContent>
        <TabsContent value="payers">
          <PayersTab />
        </TabsContent>
        <TabsContent value="claim-defaults">
          <ClaimDefaultsTab />
        </TabsContent>
        <TabsContent value="rates">
          <RateTablesTab />
        </TabsContent>
        <TabsContent value="clearinghouse">
          <ClearinghouseTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
