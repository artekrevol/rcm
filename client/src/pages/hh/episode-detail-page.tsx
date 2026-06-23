import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle, Circle, AlertTriangle, ChevronLeft,
  Plus, Calendar, ClipboardList, Activity, User, FileText, Pencil, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

interface Episode {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
  cert_period_start: string;
  cert_period_end: string;
  start_of_care_date: string;
  episode_status: string;
  primary_diagnosis?: string;
  authorization_id?: string;
  notes?: string;
}

interface BillingPeriod {
  id: string;
  episode_id: string;
  period_number: number;
  period_start: string;
  period_end: string;
  period_status: string;
  hipps_code?: string;
  oasis_date?: string;
  cbsa_code?: string;
  fips_county?: string;
  claim_id?: string;
}

interface EpisodeVisit {
  id: string;
  episode_id: string;
  billing_period_id: string;
  visit_date: string;
  discipline: string;
  provider_id?: string;
  documented: boolean;
  signed: boolean;
  counts_against_auth: boolean;
  notes?: string;
}

const PERIOD_STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ready_to_bill: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  billed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  voided: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const EPISODE_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  discharged: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  recertified: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const DISCIPLINES = ["RN", "PT", "OT", "SLP", "SW", "HHA", "MSW"];

function VisitRow({ visit, onToggle }: { visit: EpisodeVisit; onToggle: (field: "documented" | "signed", val: boolean) => void }) {
  const complete = visit.documented && visit.signed;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors"
      data-testid={`row-visit-${visit.id}`}
    >
      {complete ? (
        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{visit.discipline}</span>
        <span className="text-xs text-muted-foreground ml-2">{visit.visit_date}</span>
        {visit.notes && <span className="text-xs text-muted-foreground ml-2">· {visit.notes}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onToggle("documented", !visit.documented)}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${visit.documented ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          data-testid={`toggle-documented-${visit.id}`}
        >
          Documented
        </button>
        <button
          onClick={() => onToggle("signed", !visit.signed)}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${visit.signed ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          data-testid={`toggle-signed-${visit.id}`}
        >
          Signed
        </button>
      </div>
    </div>
  );
}

function CompletenessChecklist({ visits }: { visits: EpisodeVisit[] }) {
  const total = visits.length;
  const documented = visits.filter(v => v.documented).length;
  const signed = visits.filter(v => v.signed).length;
  const complete = visits.filter(v => v.documented && v.signed).length;
  const pct = total === 0 ? 100 : Math.round((complete / total) * 100);

  return (
    <div className="space-y-3" data-testid="panel-checklist">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Visit Completeness</span>
        <span className="text-sm font-bold text-primary">{pct}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary rounded-full h-2 transition-all"
          style={{ width: `${pct}%` }}
          data-testid="progress-completeness"
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-lg font-bold">{total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-lg font-bold">{documented}</p>
          <p className="text-xs text-muted-foreground">Documented</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-lg font-bold">{signed}</p>
          <p className="text-xs text-muted-foreground">Signed</p>
        </div>
      </div>
      {pct < 100 && (
        <div className="flex items-center gap-1.5 text-amber-600 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{total - complete} visit(s) not fully documented and signed</span>
        </div>
      )}
    </div>
  );
}

function BillingPeriodCard({
  period,
  visits,
  onStatusChange,
  onAddVisit,
  onEditEdiFields,
  onGenerateClaim,
}: {
  period: BillingPeriod;
  visits: EpisodeVisit[];
  onStatusChange: (periodId: string, status: string) => void;
  onAddVisit: (periodId: string) => void;
  onEditEdiFields: (period: BillingPeriod) => void;
  onGenerateClaim: (period: BillingPeriod) => void;
}) {
  const allComplete = visits.length > 0 && visits.every(v => v.documented && v.signed);
  const canMarkReady = period.period_status === "open" && allComplete;
  const canGenerateClaim = period.period_status === "ready_to_bill" && !!period.hipps_code;

  return (
    <Card data-testid={`card-period-${period.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Period {period.period_number}
            <span className="text-xs font-normal text-muted-foreground">
              {period.period_start} → {period.period_end}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              className={PERIOD_STATUS_COLORS[period.period_status] ?? "bg-gray-100 text-gray-700"}
              data-testid={`badge-period-status-${period.id}`}
            >
              {period.period_status.replace(/_/g, " ")}
            </Badge>
            {period.period_status === "open" && (
              <Button
                size="sm"
                variant={canMarkReady ? "default" : "outline"}
                disabled={!canMarkReady}
                data-testid={`button-mark-ready-${period.id}`}
                onClick={() => onStatusChange(period.id, "ready_to_bill")}
                title={!allComplete ? "All visits must be documented and signed first" : ""}
              >
                Mark Ready
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 837I EDI Fields */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">837I Fields</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
              data-testid={`button-edit-edi-fields-${period.id}`}
              onClick={() => onEditEdiFields(period)}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">HIPPS Code</span>
            <span className="font-mono font-medium" data-testid={`text-hipps-${period.id}`}>
              {period.hipps_code || <span className="text-muted-foreground italic">not set</span>}
            </span>
            <span className="text-muted-foreground">OASIS Date</span>
            <span data-testid={`text-oasis-date-${period.id}`}>
              {period.oasis_date || <span className="text-muted-foreground italic">not set</span>}
            </span>
            <span className="text-muted-foreground">CBSA Code</span>
            <span data-testid={`text-cbsa-${period.id}`}>
              {period.cbsa_code || <span className="text-muted-foreground italic">not set</span>}
            </span>
            <span className="text-muted-foreground">FIPS County</span>
            <span data-testid={`text-fips-${period.id}`}>
              {period.fips_county || <span className="text-muted-foreground italic">not set</span>}
            </span>
          </div>
          {period.claim_id ? (
            <div className="flex items-center gap-2 pt-1 border-t mt-2">
              <FileText className="h-3.5 w-3.5 text-green-600" />
              <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                Claim generated — ID: <span className="font-mono">{period.claim_id.slice(0, 8)}…</span>
              </span>
            </div>
          ) : (
            <div className="pt-1 border-t mt-2">
              <Button
                size="sm"
                className="w-full h-7 text-xs gap-1.5"
                variant={canGenerateClaim ? "default" : "outline"}
                disabled={!canGenerateClaim}
                data-testid={`button-generate-claim-${period.id}`}
                title={
                  !period.hipps_code ? "HIPPS code required before generating claim" :
                  period.period_status !== "ready_to_bill" ? "Period must be Ready to Bill" : ""
                }
                onClick={() => onGenerateClaim(period)}
              >
                <FileText className="h-3 w-3" />
                Generate 837I Claim
              </Button>
            </div>
          )}
        </div>

        <CompletenessChecklist visits={visits} />
        <Separator />
        <div className="space-y-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Visits</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs gap-1"
              data-testid={`button-add-visit-${period.id}`}
              onClick={() => onAddVisit(period.id)}
            >
              <Plus className="h-3 w-3" />
              Add Visit
            </Button>
          </div>
          {visits.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No visits recorded yet.</p>
          ) : (
            visits.map(v => (
              <div key={v.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-muted/40">
                <span className="font-medium">{v.discipline}</span>
                <span className="text-muted-foreground">{v.visit_date}</span>
                {v.documented && v.signed
                  ? <CheckCircle className="h-3 w-3 text-green-500 ml-auto shrink-0" />
                  : <Circle className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface Payer { id: string; name: string; payer_id: string; }
interface Provider { id: string; first_name: string; last_name: string; npi: string; }
interface PcrRecord {
  id: string;
  review_status: string;
  outcome: string | null;
  utn_number: string | null;
  bundle_ref: string | null;
  created_at: string;
}
interface RcdStatus {
  rcd_review_choice: 'pre_claim_review' | 'postpayment_review' | null;
  pcrs: PcrRecord[];
  noa: { id: string; status: string; filed_date: string | null; noa_control_number: string | null } | null;
}

export default function EpisodeDetailPage() {
  const [, params] = useRoute("/billing/hh/episodes/:id");
  const episodeId = params?.id ?? "";
  const { toast } = useToast();

  const [editRcdChoice, setEditRcdChoice] = useState(false);
  const [pendingRcdChoice, setPendingRcdChoice] = useState<string | null>(null);
  const [editingUtnId, setEditingUtnId] = useState<string | null>(null);
  const [utnDraft, setUtnDraft] = useState("");
  const [bundleRefDraft, setBundleRefDraft] = useState("");
  const [addVisitPeriodId, setAddVisitPeriodId] = useState<string | null>(null);
  const [visitForm, setVisitForm] = useState({
    discipline: "",
    visit_date: "",
    notes: "",
    documented: false,
    signed: false,
    counts_against_auth: true,
  });

  const [editEdiPeriod, setEditEdiPeriod] = useState<BillingPeriod | null>(null);
  const [ediForm, setEdiForm] = useState({ hipps_code: "", oasis_date: "", cbsa_code: "", fips_county: "" });

  const [generateClaimPeriod, setGenerateClaimPeriod] = useState<BillingPeriod | null>(null);
  const [claimForm, setClaimForm] = useState({ payer_fk_id: "", attending_provider_id: "" });

  const { data: episode, isLoading: epLoading } = useQuery<Episode>({
    queryKey: ["/api/hh/episodes", episodeId],
    queryFn: async () => {
      const res = await fetch(`/api/hh/episodes/${episodeId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load episode");
      return res.json();
    },
    enabled: !!episodeId,
  });

  const { data: periods = [] } = useQuery<BillingPeriod[]>({
    queryKey: ["/api/hh/episodes", episodeId, "billing-periods"],
    queryFn: async () => {
      const res = await fetch(`/api/hh/episodes/${episodeId}/billing-periods`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load billing periods");
      return res.json();
    },
    enabled: !!episodeId,
  });

  const { data: visits = [] } = useQuery<EpisodeVisit[]>({
    queryKey: ["/api/hh/episodes", episodeId, "visits"],
    queryFn: async () => {
      const res = await fetch(`/api/hh/episodes/${episodeId}/visits`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load visits");
      return res.json();
    },
    enabled: !!episodeId,
  });

  const periodStatusMutation = useMutation({
    mutationFn: async ({ periodId, status }: { periodId: string; status: string }) =>
      apiRequest("PATCH", `/api/hh/billing-periods/${periodId}/status`, { period_status: status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "billing-periods"] });
      toast({ title: "Billing period updated" });
    },
    onError: async (err: any) => {
      let msg = "Could not update period status.";
      try {
        const body = await err?.response?.json?.();
        msg = body?.message ?? msg;
      } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const addVisitMutation = useMutation({
    mutationFn: async (data: typeof visitForm & { billing_period_id: string }) =>
      apiRequest("POST", `/api/hh/episodes/${episodeId}/visits`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "visits"] });
      toast({ title: "Visit added" });
      setAddVisitPeriodId(null);
      setVisitForm({ discipline: "", visit_date: "", notes: "", documented: false, signed: false, counts_against_auth: true });
    },
    onError: () => toast({ title: "Error", description: "Could not add visit.", variant: "destructive" }),
  });

  const toggleVisitMutation = useMutation({
    mutationFn: async ({ visitId, field, value }: { visitId: string; field: string; value: boolean }) =>
      apiRequest("PATCH", `/api/hh/visits/${visitId}`, { [field]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "visits"] });
    },
  });

  const { data: payers = [] } = useQuery<Payer[]>({
    queryKey: ["/api/billing/payers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/payers", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ["/api/billing/providers"],
    queryFn: async () => {
      const res = await fetch("/api/billing/providers", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: rcdStatus } = useQuery<RcdStatus>({
    queryKey: ["/api/hh/episodes", episodeId, "rcd-status"],
    queryFn: async () => {
      const res = await fetch(`/api/hh/episodes/${episodeId}/rcd-status`, { credentials: "include" });
      if (!res.ok) return { rcd_review_choice: null, pcrs: [], noa: null };
      return res.json();
    },
    enabled: !!episodeId,
  });

  const rcdChoiceMutation = useMutation({
    mutationFn: async (choice: string) =>
      apiRequest("PATCH", "/api/hh/settings/rcd-choice", { rcd_review_choice: choice }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "rcd-status"] });
      toast({ title: "RCD review choice updated" });
      setEditRcdChoice(false);
      setPendingRcdChoice(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update RCD choice. Admin or RCM manager role required.", variant: "destructive" });
      setPendingRcdChoice(null);
    },
  });

  const updatePcrMutation = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; utn_number?: string; bundle_ref?: string; review_status?: string }) =>
      apiRequest("PATCH", `/api/hh/pre-claim-reviews/${id}`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "rcd-status"] });
      toast({ title: "PCR record updated" });
      setEditingUtnId(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message ?? "Could not update PCR record.", variant: "destructive" }),
  });

  const createPcrMutation = useMutation({
    mutationFn: async (fields: { episode_id: string; utn_number?: string; bundle_ref?: string }) =>
      apiRequest("POST", "/api/hh/pre-claim-reviews", fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "rcd-status"] });
      toast({ title: "PCR record created" });
    },
    onError: () => toast({ title: "Error", description: "Could not create PCR record.", variant: "destructive" }),
  });

  const ediFieldsMutation = useMutation({
    mutationFn: async ({ periodId, fields }: { periodId: string; fields: typeof ediForm }) =>
      apiRequest("PATCH", `/api/hh/billing-periods/${periodId}/edi-fields`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "billing-periods"] });
      toast({ title: "837I fields saved" });
      setEditEdiPeriod(null);
    },
    onError: async (err: any) => {
      let msg = "Could not save EDI fields.";
      try { const b = await err?.response?.json?.(); msg = b?.error ?? msg; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const generateClaimMutation = useMutation({
    mutationFn: async ({ periodId, body }: { periodId: string; body: typeof claimForm }) =>
      apiRequest("POST", `/api/hh/billing-periods/${periodId}/generate-claim`, body),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes", episodeId, "billing-periods"] });
      toast({
        title: "837I claim generated",
        description: `Claim ID: ${(data.claimId ?? "").slice(0, 8)}…`,
      });
      setGenerateClaimPeriod(null);
    },
    onError: async (err: any) => {
      let msg = "Could not generate claim.";
      try {
        const b = await err?.response?.json?.();
        if (b?.gates?.length) {
          msg = b.gates.map((g: any) => g.message).join(" | ");
        } else {
          msg = b?.error ?? msg;
        }
      } catch {}
      toast({ title: "Gate check failed", description: msg, variant: "destructive" });
    },
  });

  if (epLoading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="text-episode-not-found">
        Episode not found.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Back + Header */}
      <div className="space-y-1">
        <Link href="/billing/hh/episodes" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
          <ChevronLeft className="h-3.5 w-3.5" />
          Episodes
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-episode-detail">
              {episode.first_name} {episode.last_name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {episode.cert_period_start} → {episode.cert_period_end}
              {episode.primary_diagnosis && ` · ${episode.primary_diagnosis}`}
            </p>
          </div>
          <Badge
            className={EPISODE_STATUS_COLORS[episode.episode_status] ?? "bg-gray-100 text-gray-700"}
            data-testid="badge-episode-status"
          >
            {episode.episode_status}
          </Badge>
        </div>
      </div>

      {/* Episode Info Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Episode Details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Start of Care</p>
            <p className="font-medium" data-testid="text-soc-date">{episode.start_of_care_date}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cert Period</p>
            <p className="font-medium">{episode.cert_period_start} – {episode.cert_period_end}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Primary Diagnosis</p>
            <p className="font-medium">{episode.primary_diagnosis ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Notes</p>
            <p className="font-medium">{episode.notes ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {/* RCD / PCR Panel */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                Review Choice &amp; PCR Status
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                RCD review path and Pre-Claim Review / UTN tracking
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Confirmation dialog for RCD choice change (admin-only action) */}
          <AlertDialog open={!!pendingRcdChoice} onOpenChange={(open) => { if (!open) setPendingRcdChoice(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Change Organization Billing Review Policy?</AlertDialogTitle>
                <AlertDialogDescription>
                  This changes the RCD review path for your entire organization.{" "}
                  {pendingRcdChoice === 'pre_claim_review'
                    ? 'Switching to Pre-Claim Review requires a valid, affirmed UTN before any final claim submission.'
                    : 'Switching to Postpayment Review requires documentation readiness attestation before submission.'}
                  {" "}This action requires admin or RCM manager role.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => { setPendingRcdChoice(null); setEditRcdChoice(false); }}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => pendingRcdChoice && rcdChoiceMutation.mutate(pendingRcdChoice)}
                  data-testid="button-confirm-rcd-choice"
                >
                  Confirm Change
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* RCD choice row */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">RCD Review Choice</p>
            {editRcdChoice ? (
              <div className="flex items-center gap-2">
                <Select
                  value={rcdStatus?.rcd_review_choice ?? ""}
                  onValueChange={(v) => { setPendingRcdChoice(v); }}
                >
                  <SelectTrigger className="h-8 text-xs w-52" data-testid="select-rcd-choice">
                    <SelectValue placeholder="Select review path…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_claim_review">Pre-Claim Review (PCR)</SelectItem>
                    <SelectItem value="postpayment_review">Postpayment Review</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setEditRcdChoice(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    rcdStatus?.rcd_review_choice === 'pre_claim_review'
                      ? 'text-blue-700 border-blue-300 dark:text-blue-300'
                      : rcdStatus?.rcd_review_choice === 'postpayment_review'
                      ? 'text-amber-700 border-amber-300 dark:text-amber-300'
                      : 'text-muted-foreground'
                  }
                  data-testid="badge-rcd-choice"
                >
                  {rcdStatus?.rcd_review_choice === 'pre_claim_review'
                    ? 'Pre-Claim Review'
                    : rcdStatus?.rcd_review_choice === 'postpayment_review'
                    ? 'Postpayment Review'
                    : 'Not configured'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setEditRcdChoice(true)}
                  data-testid="button-edit-rcd-choice"
                  title="Admin or RCM manager role required"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* PCR / UTN records (pre_claim_review path) */}
          {rcdStatus?.rcd_review_choice === 'pre_claim_review' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">Pre-Claim Reviews &amp; UTN Records</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  data-testid="button-add-pcr"
                  onClick={() => createPcrMutation.mutate({ episode_id: episodeId })}
                  disabled={createPcrMutation.isPending}
                >
                  <Plus className="h-3 w-3" />
                  New PCR
                </Button>
              </div>
              {rcdStatus.pcrs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">No PCR records on file for this episode.</p>
              ) : (
                <div className="space-y-2">
                  {rcdStatus.pcrs.map((pcr) => {
                    const isAffirmed = pcr.review_status === 'affirmed';
                    const isEditing = editingUtnId === pcr.id;
                    return (
                      <div
                        key={pcr.id}
                        className="rounded border px-3 py-2.5 bg-muted/20 space-y-2"
                        data-testid={`row-pcr-${pcr.id}`}
                      >
                        {/* Status + date row */}
                        <div className="flex items-center gap-2 text-xs">
                          <Badge
                            variant={isAffirmed ? 'default' : pcr.review_status === 'rejected' ? 'destructive' : 'secondary'}
                            className="text-[10px] shrink-0"
                          >
                            {pcr.review_status}
                          </Badge>
                          {pcr.outcome && <span className="text-muted-foreground">{pcr.outcome}</span>}
                          <span className="ml-auto text-muted-foreground shrink-0">
                            {new Date(pcr.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        {/* UTN + Bundle Ref edit row */}
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <Label className="text-[10px] text-muted-foreground">UTN Number</Label>
                                <Input
                                  className="h-7 text-xs font-mono"
                                  value={utnDraft}
                                  onChange={(e) => setUtnDraft(e.target.value)}
                                  placeholder="Enter UTN…"
                                  data-testid={`input-utn-${pcr.id}`}
                                />
                              </div>
                              <div className="flex-1">
                                <Label className="text-[10px] text-muted-foreground">Bundle Ref</Label>
                                <Input
                                  className="h-7 text-xs font-mono"
                                  value={bundleRefDraft}
                                  onChange={(e) => setBundleRefDraft(e.target.value)}
                                  placeholder="Submission bundle ID…"
                                  data-testid={`input-bundle-ref-${pcr.id}`}
                                />
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                className="h-6 text-xs"
                                disabled={!utnDraft.trim() || updatePcrMutation.isPending}
                                onClick={() => updatePcrMutation.mutate({
                                  id: pcr.id,
                                  utn_number: utnDraft.trim(),
                                  bundle_ref: bundleRefDraft.trim() || undefined,
                                })}
                                data-testid={`button-save-utn-${pcr.id}`}
                              >
                                Save UTN
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                className="h-6 text-xs bg-green-600 hover:bg-green-700"
                                disabled={!utnDraft.trim() || updatePcrMutation.isPending}
                                onClick={() => updatePcrMutation.mutate({
                                  id: pcr.id,
                                  utn_number: utnDraft.trim(),
                                  bundle_ref: bundleRefDraft.trim() || undefined,
                                  review_status: 'affirmed',
                                })}
                                data-testid={`button-affirm-utn-${pcr.id}`}
                              >
                                Save &amp; Affirm
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => setEditingUtnId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 text-xs">
                            {pcr.utn_number ? (
                              <span className="font-mono font-medium text-green-700 dark:text-green-400" data-testid={`text-utn-${pcr.id}`}>
                                UTN: {pcr.utn_number}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic">No UTN on file</span>
                            )}
                            {pcr.bundle_ref && (
                              <span className="text-muted-foreground font-mono text-[10px]" data-testid={`text-bundle-ref-${pcr.id}`}>
                                Bundle: {pcr.bundle_ref}
                              </span>
                            )}
                            {isAffirmed ? (
                              <span className="ml-auto flex items-center gap-1 text-green-600 text-[10px]">
                                <Lock className="h-3 w-3" />
                                Locked
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-auto h-5 px-1.5 text-[10px] gap-1"
                                onClick={() => {
                                  setEditingUtnId(pcr.id);
                                  setUtnDraft(pcr.utn_number ?? "");
                                  setBundleRefDraft(pcr.bundle_ref ?? "");
                                }}
                                data-testid={`button-edit-utn-${pcr.id}`}
                              >
                                <Pencil className="h-2.5 w-2.5" />
                                Edit UTN
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Postpayment readiness notice */}
          {rcdStatus?.rcd_review_choice === 'postpayment_review' && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs">
              <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">Postpayment Readiness Required</p>
              <p className="text-amber-700 dark:text-amber-400">
                All visit notes, OASIS assessments, and physician orders must be signed and accessible
                before final claim submission. Ensure documentation readiness is confirmed.
              </p>
            </div>
          )}

          {/* NOA status */}
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">NOA Status:</p>
            <Badge
              variant="outline"
              className={
                rcdStatus?.noa?.status === 'accepted'
                  ? 'text-green-700 border-green-300 dark:text-green-400 text-xs'
                  : rcdStatus?.noa?.status === 'submitted'
                  ? 'text-blue-700 border-blue-300 dark:text-blue-300 text-xs'
                  : 'text-muted-foreground text-xs'
              }
              data-testid="badge-noa-status"
            >
              {rcdStatus?.noa ? rcdStatus.noa.status : 'Not filed'}
            </Badge>
            {rcdStatus?.noa?.noa_control_number && (
              <span className="text-xs text-muted-foreground font-mono">
                #{rcdStatus.noa.noa_control_number}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Overall Completeness */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Overall Completeness
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CompletenessChecklist visits={visits} />
        </CardContent>
      </Card>

      {/* Billing Period Cards */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm" data-testid="heading-billing-periods">Billing Periods</h2>
        </div>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No billing periods found.</p>
        ) : (
          periods.map(period => {
            const periodVisits = visits.filter(v => v.billing_period_id === period.id);
            return (
              <BillingPeriodCard
                key={period.id}
                period={period}
                visits={periodVisits}
                onStatusChange={(periodId, status) =>
                  periodStatusMutation.mutate({ periodId, status })
                }
                onAddVisit={(periodId) => {
                  setAddVisitPeriodId(periodId);
                }}
                onEditEdiFields={(p) => {
                  setEditEdiPeriod(p);
                  setEdiForm({
                    hipps_code: p.hipps_code ?? "",
                    oasis_date: p.oasis_date ?? "",
                    cbsa_code: p.cbsa_code ?? "",
                    fips_county: p.fips_county ?? "",
                  });
                }}
                onGenerateClaim={(p) => {
                  setGenerateClaimPeriod(p);
                  setClaimForm({ payer_fk_id: "", attending_provider_id: "" });
                }}
              />
            );
          })
        )}
      </div>

      {/* Add Visit Dialog */}
      <Dialog open={!!addVisitPeriodId} onOpenChange={(o) => !o && setAddVisitPeriodId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Visit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Discipline</Label>
              <Select
                value={visitForm.discipline}
                onValueChange={(v) => setVisitForm({ ...visitForm, discipline: v })}
              >
                <SelectTrigger data-testid="select-visit-discipline">
                  <SelectValue placeholder="Select discipline" />
                </SelectTrigger>
                <SelectContent>
                  {DISCIPLINES.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Visit Date</Label>
              <Input
                type="date"
                data-testid="input-visit-date"
                value={visitForm.visit_date}
                onChange={e => setVisitForm({ ...visitForm, visit_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="Optional"
                data-testid="input-visit-notes"
                value={visitForm.notes}
                onChange={e => setVisitForm({ ...visitForm, notes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="checkbox-documented"
                  checked={visitForm.documented}
                  onChange={e => setVisitForm({ ...visitForm, documented: e.target.checked })}
                />
                Documented
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="checkbox-signed"
                  checked={visitForm.signed}
                  onChange={e => setVisitForm({ ...visitForm, signed: e.target.checked })}
                />
                Signed
              </label>
            </div>
            <Button
              className="w-full"
              data-testid="button-submit-visit"
              disabled={addVisitMutation.isPending || !visitForm.discipline || !visitForm.visit_date}
              onClick={() => {
                if (!addVisitPeriodId) return;
                addVisitMutation.mutate({ ...visitForm, billing_period_id: addVisitPeriodId });
              }}
            >
              {addVisitMutation.isPending ? "Adding…" : "Add Visit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit 837I EDI Fields Dialog */}
      <Dialog open={!!editEdiPeriod} onOpenChange={(o) => !o && setEditEdiPeriod(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit 837I Fields — Period {editEdiPeriod?.period_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="input-hipps">HIPPS Code <span className="text-red-500">*</span></Label>
              <Input
                id="input-hipps"
                placeholder="e.g. 1A111"
                data-testid="input-hipps-code"
                value={ediForm.hipps_code}
                onChange={e => setEdiForm({ ...ediForm, hipps_code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="input-oasis-date">OASIS Assessment Date (Occurrence Code 50)</Label>
              <Input
                id="input-oasis-date"
                type="date"
                data-testid="input-oasis-date"
                value={ediForm.oasis_date}
                onChange={e => setEdiForm({ ...ediForm, oasis_date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="input-cbsa">CBSA Code (Value 61)</Label>
                <Input
                  id="input-cbsa"
                  placeholder="e.g. 33100"
                  data-testid="input-cbsa-code"
                  value={ediForm.cbsa_code}
                  onChange={e => setEdiForm({ ...ediForm, cbsa_code: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="input-fips">FIPS County (Value 85)</Label>
                <Input
                  id="input-fips"
                  placeholder="e.g. FL086"
                  data-testid="input-fips-county"
                  value={ediForm.fips_county}
                  onChange={e => setEdiForm({ ...ediForm, fips_county: e.target.value })}
                />
              </div>
            </div>
            <Button
              className="w-full"
              data-testid="button-save-edi-fields"
              disabled={ediFieldsMutation.isPending || !ediForm.hipps_code}
              onClick={() => {
                if (!editEdiPeriod) return;
                ediFieldsMutation.mutate({ periodId: editEdiPeriod.id, fields: ediForm });
              }}
            >
              {ediFieldsMutation.isPending ? "Saving…" : "Save EDI Fields"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate 837I Claim Dialog */}
      <Dialog open={!!generateClaimPeriod} onOpenChange={(o) => !o && setGenerateClaimPeriod(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate 837I Claim — Period {generateClaimPeriod?.period_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {generateClaimPeriod && (
              <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
                <p><span className="text-muted-foreground">HIPPS:</span> <span className="font-mono font-medium">{generateClaimPeriod.hipps_code}</span></p>
                <p><span className="text-muted-foreground">Period:</span> {generateClaimPeriod.period_start} → {generateClaimPeriod.period_end}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="select-payer">Payer <span className="text-red-500">*</span></Label>
              <Select
                value={claimForm.payer_fk_id}
                onValueChange={(v) => setClaimForm({ ...claimForm, payer_fk_id: v })}
              >
                <SelectTrigger id="select-payer" data-testid="select-payer-claim">
                  <SelectValue placeholder={payers.length === 0 ? "No payers configured" : "Select payer"} />
                </SelectTrigger>
                <SelectContent>
                  {payers.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.payer_id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="select-provider">Attending Physician <span className="text-red-500">*</span></Label>
              <Select
                value={claimForm.attending_provider_id}
                onValueChange={(v) => setClaimForm({ ...claimForm, attending_provider_id: v })}
              >
                <SelectTrigger id="select-provider" data-testid="select-provider-claim">
                  <SelectValue placeholder={providers.length === 0 ? "No providers configured" : "Select provider"} />
                </SelectTrigger>
                <SelectContent>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name} · {p.npi}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {generateClaimMutation.isPending && (
              <p className="text-xs text-muted-foreground text-center animate-pulse">Running gate checks + generating EDI…</p>
            )}
            <Button
              className="w-full"
              data-testid="button-submit-generate-claim"
              disabled={generateClaimMutation.isPending || !claimForm.payer_fk_id || !claimForm.attending_provider_id}
              onClick={() => {
                if (!generateClaimPeriod) return;
                generateClaimMutation.mutate({ periodId: generateClaimPeriod.id, body: claimForm });
              }}
            >
              {generateClaimMutation.isPending ? "Generating…" : "Generate Claim"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
