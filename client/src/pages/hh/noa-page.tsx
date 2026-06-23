import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileClock, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useIsHH } from "@/contexts/segment";

interface NoaFiling {
  id: string;
  episode_id: string;
  first_name?: string;
  last_name?: string;
  soc_date: string;
  due_date: string;
  filed_date?: string;
  status: string;
  penalty_days: number;
  noa_control_number?: string;
  cert_period_start?: string;
  cert_period_end?: string;
}

const statusIcon: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-amber-500" />,
  filed: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  late: <AlertTriangle className="h-4 w-4 text-red-500" />,
};

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  filed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  late: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function NoaPage() {
  const isHH = useIsHH();
  const { toast } = useToast();
  const [filing, setFiling] = useState<NoaFiling | null>(null);
  const [filedDate, setFiledDate] = useState("");
  const [controlNumber, setControlNumber] = useState("");

  const { data: noaList = [], isLoading } = useQuery<NoaFiling[]>({
    queryKey: ["/api/hh/noa"],
    queryFn: async () => {
      const res = await fetch("/api/hh/noa", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load NOA filings");
      return res.json();
    },
    enabled: isHH,
  });

  const fileMutation = useMutation({
    mutationFn: async ({ id, filed_date, noa_control_number }: { id: string; filed_date: string; noa_control_number?: string }) =>
      apiRequest("PATCH", `/api/hh/noa/${id}/file`, { filed_date, noa_control_number }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hh/noa"] });
      toast({ title: "NOA filed", description: vars.noa_control_number ? `Control #${vars.noa_control_number}` : "NOA recorded." });
      setFiling(null);
      setFiledDate("");
      setControlNumber("");
    },
    onError: () => {
      toast({ title: "Error", description: "Could not record NOA filing.", variant: "destructive" });
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  if (!isHH) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        NOA Filings are only available for Home Health organizations.
      </div>
    );
  }

  const overdue = noaList.filter((n) => n.status === "pending" && n.due_date < today);
  const pending = noaList.filter((n) => n.status === "pending" && n.due_date >= today);
  const completed = noaList.filter((n) => n.status !== "pending");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-noa">NOA Filings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Notice of Admission — must be filed within 5 calendar days of start of care
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-background p-4" data-testid="card-noa-overdue">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium">Overdue</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{overdue.length}</p>
        </div>
        <div className="rounded-lg border bg-background p-4" data-testid="card-noa-pending">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Due soon</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{pending.length}</p>
        </div>
        <div className="rounded-lg border bg-background p-4" data-testid="card-noa-filed">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">Filed</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{completed.length}</p>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : noaList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-noa-empty">
          <FileClock className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No NOA filings yet. Create an episode to start the NOA clock.</p>
        </div>
      ) : (
        <div className="rounded-lg border divide-y bg-background">
          {noaList.map((noa) => {
            const isOverdue = noa.status === "pending" && noa.due_date < today;
            return (
              <div
                key={noa.id}
                className="flex items-center gap-4 px-4 py-3"
                data-testid={`row-noa-${noa.id}`}
              >
                <div className="shrink-0">{statusIcon[noa.status] ?? <Clock className="h-4 w-4" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {noa.first_name} {noa.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    SOC: {noa.soc_date} · Due: {noa.due_date}
                    {noa.filed_date && ` · Filed: ${noa.filed_date}`}
                    {noa.penalty_days > 0 && (
                      <span className="text-red-500 ml-1">({noa.penalty_days}d penalty)</span>
                    )}
                  </p>
                </div>
                <Badge
                  className={isOverdue ? statusColors.late : (statusColors[noa.status] ?? "")}
                  data-testid={`badge-noa-status-${noa.id}`}
                >
                  {isOverdue ? "overdue" : noa.status}
                </Badge>
                {noa.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`button-file-noa-${noa.id}`}
                    onClick={() => {
                      setFiling(noa);
                      setFiledDate(today);
                    }}
                  >
                    File
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* File NOA dialog */}
      <Dialog open={!!filing} onOpenChange={(o) => { if (!o) { setFiling(null); setFiledDate(""); setControlNumber(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record NOA Filing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {filing && (
              <p className="text-sm text-muted-foreground">
                {filing.first_name} {filing.last_name} — Due {filing.due_date}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="noa-filed-date">Date Filed</Label>
              <Input
                id="noa-filed-date"
                type="date"
                data-testid="input-noa-filed-date"
                value={filedDate}
                onChange={(e) => setFiledDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noa-control">Control Number (optional)</Label>
              <Input
                id="noa-control"
                placeholder="NOA control #"
                data-testid="input-noa-control-number"
                value={controlNumber}
                onChange={(e) => setControlNumber(e.target.value)}
              />
            </div>
            {filing && filedDate && filedDate > filing.due_date && (
              <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300" data-testid="alert-noa-late">
                <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                Filed after due date — penalty days will be calculated automatically.
              </div>
            )}
            <Button
              className="w-full"
              data-testid="button-submit-noa-filing"
              disabled={!filedDate || fileMutation.isPending}
              onClick={() => filing && fileMutation.mutate({ id: filing.id, filed_date: filedDate, noa_control_number: controlNumber || undefined })}
            >
              {fileMutation.isPending ? "Recording…" : "Record Filing"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
