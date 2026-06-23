import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle, Circle, AlertTriangle, ChevronLeft,
  Plus, Calendar, ClipboardList, Activity, User,
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
}: {
  period: BillingPeriod;
  visits: EpisodeVisit[];
  onStatusChange: (periodId: string, status: string) => void;
  onAddVisit: (periodId: string) => void;
}) {
  const allComplete = visits.length > 0 && visits.every(v => v.documented && v.signed);
  const canMarkReady = period.period_status === "open" && allComplete;

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
        {period.hipps_code && (
          <CardDescription>HIPPS: {period.hipps_code}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
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
            visits.map(v => <div key={v.id}>{v.discipline} — {v.visit_date}</div>)
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EpisodeDetailPage() {
  const [, params] = useRoute("/billing/hh/episodes/:id");
  const episodeId = params?.id ?? "";
  const { toast } = useToast();
  const [addVisitPeriodId, setAddVisitPeriodId] = useState<string | null>(null);
  const [visitForm, setVisitForm] = useState({
    discipline: "",
    visit_date: "",
    notes: "",
    documented: false,
    signed: false,
    counts_against_auth: true,
  });

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
    </div>
  );
}
