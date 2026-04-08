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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { validateNPI } from "@shared/npi-validation";
import {
  ArrowLeft,
  Loader2,
  FileText,
  User,
  Shield,
  MessageSquare,
  Plus,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Save,
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
                <TableHead className="text-right">Actions</TableHead>
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
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" data-testid={`button-clone-claim-${c.id}`}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Clone claim (coming soon)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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

function EligibilityTab({ patientId }: { patientId: string }) {
  const { data: vobs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", patientId, "vob"],
    queryFn: async () => {
      const res = await fetch(`/api/billing/patients/${patientId}/vob`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Eligibility Verifications</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" data-testid="button-run-eligibility">
                <Shield className="h-4 w-4 mr-2" />
                Run Eligibility Check
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming in next update</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {vobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No eligibility verifications found for this patient.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {vobs.map((v: any) => (
            <Card key={v.id} data-testid={`card-vob-${v.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs capitalize">{v.context || "unknown"}</Badge>
                      <Badge variant={v.status === "verified" ? "default" : "outline"} className="text-xs">
                        {v.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 mt-2 text-sm">
                      {v.copay && <div><span className="text-muted-foreground">Copay:</span> ${v.copay}</div>}
                      {v.deductible && <div><span className="text-muted-foreground">Deductible:</span> ${v.deductible}</div>}
                      {v.out_of_pocket_max && <div><span className="text-muted-foreground">OOP Max:</span> ${v.out_of_pocket_max}</div>}
                      {v.coinsurance && <div><span className="text-muted-foreground">Coinsurance:</span> {v.coinsurance}%</div>}
                      {v.network_status && <div><span className="text-muted-foreground">Network:</span> {v.network_status}</div>}
                    </div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    {v.verified_at && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(v.verified_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
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
          <EligibilityTab patientId={patientId} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab patient={patient} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
