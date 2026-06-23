import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Activity, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useIsHH } from "@/contexts/segment";

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
  notes?: string;
}

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  discharged: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  recertified: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function EpisodesPage() {
  const isHH = useIsHH();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    patient_id: "",
    cert_period_start: "",
    cert_period_end: "",
    start_of_care_date: "",
    primary_diagnosis: "",
    notes: "",
  });

  const { data: episodes = [], isLoading } = useQuery<Episode[]>({
    queryKey: ["/api/hh/episodes", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/hh/episodes?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load episodes");
      return res.json();
    },
    enabled: isHH,
  });

  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/billing/patients"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) =>
      apiRequest("POST", "/api/hh/episodes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/episodes"] });
      toast({ title: "Episode created", description: "NOA and first billing period auto-created." });
      setOpen(false);
      setForm({ patient_id: "", cert_period_start: "", cert_period_end: "", start_of_care_date: "", primary_diagnosis: "", notes: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not create episode.", variant: "destructive" });
    },
  });

  const filtered = episodes.filter((ep) => {
    const name = `${ep.first_name ?? ""} ${ep.last_name ?? ""}`.toLowerCase();
    return name.includes(search.toLowerCase()) || (ep.primary_diagnosis ?? "").toLowerCase().includes(search.toLowerCase());
  });

  if (!isHH) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Episodes are only available for Home Health organizations.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-episodes">Episodes</h1>
          <p className="text-muted-foreground text-sm mt-0.5">60-day certification periods for skilled home health patients</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-episode" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Episode
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Episode</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="ep-patient">Patient</Label>
                <Select
                  value={form.patient_id}
                  onValueChange={(v) => setForm({ ...form, patient_id: v })}
                >
                  <SelectTrigger id="ep-patient" data-testid="select-episode-patient">
                    <SelectValue placeholder="Select patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ep-soc">Start of Care</Label>
                  <Input
                    id="ep-soc"
                    type="date"
                    data-testid="input-episode-soc"
                    value={form.start_of_care_date}
                    onChange={(e) => setForm({ ...form, start_of_care_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ep-start">Cert Period Start</Label>
                  <Input
                    id="ep-start"
                    type="date"
                    data-testid="input-episode-cert-start"
                    value={form.cert_period_start}
                    onChange={(e) => setForm({ ...form, cert_period_start: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-end">Cert Period End</Label>
                <Input
                  id="ep-end"
                  type="date"
                  data-testid="input-episode-cert-end"
                  value={form.cert_period_end}
                  onChange={(e) => setForm({ ...form, cert_period_end: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-dx">Primary Diagnosis (ICD-10)</Label>
                <Input
                  id="ep-dx"
                  placeholder="e.g. Z87.39"
                  data-testid="input-episode-diagnosis"
                  value={form.primary_diagnosis}
                  onChange={(e) => setForm({ ...form, primary_diagnosis: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-notes">Notes</Label>
                <Input
                  id="ep-notes"
                  placeholder="Optional"
                  data-testid="input-episode-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-episode"
                disabled={createMutation.isPending || !form.patient_id || !form.cert_period_start || !form.cert_period_end || !form.start_of_care_date}
                onClick={() => createMutation.mutate(form)}
              >
                {createMutation.isPending ? "Creating…" : "Create Episode"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search patients or diagnosis…"
            className="pl-8"
            data-testid="input-episodes-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-episodes-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="discharged">Discharged</SelectItem>
            <SelectItem value="recertified">Recertified</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-episodes-empty">
          <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No episodes found.</p>
        </div>
      ) : (
        <div className="rounded-lg border divide-y bg-background">
          {filtered.map((ep) => (
            <Link
              key={ep.id}
              href={`/billing/hh/episodes/${ep.id}`}
              data-testid={`row-episode-${ep.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {ep.first_name} {ep.last_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ep.cert_period_start} → {ep.cert_period_end}
                  {ep.primary_diagnosis && ` · ${ep.primary_diagnosis}`}
                </p>
              </div>
              <Badge
                className={statusColors[ep.episode_status] ?? "bg-gray-100 text-gray-700"}
                data-testid={`badge-episode-status-${ep.id}`}
              >
                {ep.episode_status}
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
