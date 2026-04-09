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
} from "lucide-react";

const CREDENTIAL_OPTIONS = ["RN", "LPN", "PT", "OT", "SLP", "HHA", "PCA", "Other"];

function ProvidersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    credentials: "",
    customCredentials: "",
    npi: "",
    taxonomyCode: "",
    individualTaxId: "",
    isDefault: false,
  });
  const [npiError, setNpiError] = useState("");

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
    setForm({ firstName: "", lastName: "", credentials: "", customCredentials: "", npi: "", taxonomyCode: "", individualTaxId: "", isDefault: false });
    setNpiError("");
  }

  function openAdd() {
    resetForm();
    setEditingProvider(null);
    setShowDialog(true);
  }

  function openEdit(provider: any) {
    const cred = CREDENTIAL_OPTIONS.includes(provider.credentials) ? provider.credentials : provider.credentials ? "Other" : "";
    setForm({
      firstName: provider.first_name,
      lastName: provider.last_name,
      credentials: cred,
      customCredentials: cred === "Other" ? provider.credentials : "",
      npi: provider.npi,
      taxonomyCode: provider.taxonomy_code || "",
      individualTaxId: provider.individual_tax_id || "",
      isDefault: provider.is_default,
    });
    setNpiError("");
    setEditingProvider(provider);
    setShowDialog(true);
  }

  function handleSubmit() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    if (!validateNPI(form.npi)) {
      setNpiError("Invalid NPI — must be 10 digits and pass the NPI checksum");
      return;
    }
    const credentials = form.credentials === "Other" ? form.customCredentials : form.credentials;
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      credentials: credentials || null,
      npi: form.npi,
      taxonomyCode: form.taxonomyCode || null,
      individualTaxId: form.individualTaxId || null,
      isDefault: form.isDefault,
    };
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
            <div className="space-y-2">
              <Label>Credentials</Label>
              <Select value={form.credentials} onValueChange={(v) => setForm({ ...form, credentials: v })}>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-npi">NPI * (10 digits)</Label>
              <Input
                id="prov-npi"
                value={form.npi}
                maxLength={10}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setForm({ ...form, npi: v });
                  if (npiError && v.length === 10 && validateNPI(v)) setNpiError("");
                }}
                className={npiError ? "border-destructive" : ""}
                data-testid="input-provider-npi"
              />
              {npiError && <p className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{npiError}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prov-taxonomy">Taxonomy Code</Label>
                <Input id="prov-taxonomy" value={form.taxonomyCode} onChange={(e) => setForm({ ...form, taxonomyCode: e.target.value })} placeholder="e.g. 251E00000X" data-testid="input-provider-taxonomy" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prov-taxid">Individual Tax ID</Label>
                <Input id="prov-taxid" value={form.individualTaxId} onChange={(e) => setForm({ ...form, individualTaxId: e.target.value })} placeholder="9 digits" data-testid="input-provider-tax-id" />
              </div>
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
    defaultPos: "12",
    street: "",
    city: "",
    state: "",
    zip: "",
    billingLocation: "",
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
        defaultPos: settings.default_pos || "12",
        street: addr.street || "",
        city: addr.city || "",
        state: addr.state || "",
        zip: addr.zip || "",
        billingLocation: settings.billing_location || "",
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
              <SelectItem value="12">12 — Home</SelectItem>
              <SelectItem value="11">11 — Office</SelectItem>
              <SelectItem value="21">21 — Inpatient Hospital</SelectItem>
              <SelectItem value="22">22 — Outpatient Hospital</SelectItem>
              <SelectItem value="99">99 — Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />VA Fee Schedule Location</Label>
        <p className="text-xs text-muted-foreground">Select the location that matches your practice's billing address. This determines the VA reimbursement rate used in your claims.</p>
        <Select value={form.billingLocation} onValueChange={(v) => setForm({ ...form, billingLocation: v })}>
          <SelectTrigger data-testid="select-billing-location">
            <SelectValue placeholder="Select VA billing location..." />
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

function PayersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ name: "", payerId: "", timelyFilingDays: "365", authRequired: false });

  const { data: payers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

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

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Payers</h3>
        <Button onClick={() => setShowDialog(true)} data-testid="button-add-payer">
          <Plus className="h-4 w-4 mr-2" />
          Add Custom Payer
        </Button>
      </div>

      <p className="text-sm text-muted-foreground bg-muted/50 border rounded-md p-3">
        Facility billing (UB-04) is not supported in this release. Select Professional for all payers.
      </p>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payer Name</TableHead>
              <TableHead>Payer ID</TableHead>
              <TableHead>Timely Filing</TableHead>
              <TableHead>Auth Required</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payers.map((p: any) => (
              <TableRow key={p.id} className={!p.is_active ? "opacity-50" : ""} data-testid={`row-payer-${p.id}`}>
                <TableCell className="font-medium">
                  {p.name}
                  {p.is_custom && <Badge variant="outline" className="ml-2 text-xs">Custom</Badge>}
                </TableCell>
                <TableCell className="font-mono text-sm">{p.payer_id || "—"}</TableCell>
                <TableCell>{p.timely_filing_days} days</TableCell>
                <TableCell>{p.auth_required ? "Yes" : "No"}</TableCell>
                <TableCell className="capitalize">{p.billing_type}</TableCell>
                <TableCell>
                  {p.is_active ? (
                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleMutation.mutate({ id: p.id, isActive: !p.is_active })}
                    data-testid={`button-toggle-payer-${p.id}`}
                  >
                    {p.is_active ? <UserX className="h-4 w-4 text-destructive" /> : <UserCheck className="h-4 w-4 text-green-600" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Payer</DialogTitle>
            <DialogDescription>Add a payer not in the default list.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Payer Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-payer-name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payer ID</Label>
                <Input value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })} data-testid="input-payer-id" />
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Rate Tables</h3>
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
  );
}

export default function BillingSettings() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Practice Settings</h1>
        <p className="text-muted-foreground">Practice info, providers, payers, and rate configuration</p>
      </div>

      <Tabs defaultValue="providers" className="space-y-4">
        <TabsList data-testid="tabs-settings">
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
          <TabsTrigger value="rates" data-testid="tab-rates">
            <DollarSign className="h-4 w-4 mr-2" />
            Rate Tables
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
        <TabsContent value="rates">
          <RateTablesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
