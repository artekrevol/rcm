import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText, Filter, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { format } from "date-fns";

export default function ActivityLogPage() {
  const { user } = useAuth();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activityType, setActivityType] = useState("");
  const [performedBy, setPerformedBy] = useState("");

  const params = new URLSearchParams();
  if (startDate) params.set("startDate", new Date(startDate).toISOString());
  if (endDate) params.set("endDate", new Date(endDate + "T23:59:59").toISOString());
  if (activityType) params.set("activityType", activityType);
  if (performedBy) params.set("performedBy", performedBy);
  const qs = params.toString();

  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/activity-logs", qs],
    queryFn: () => fetch(`/api/billing/activity-logs?${qs}`, { credentials: "include" }).then(r => r.json()),
    enabled: user?.role === "admin",
  });

  if (user?.role !== "admin") {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <ScrollText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold" data-testid="text-admin-required">Admin access required</h2>
            <p className="text-muted-foreground text-sm mt-1">Only administrators can view the activity log.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Activity Log</h1>
        <p className="text-muted-foreground">Audit trail for billing actions</p>
      </div>

      <Card data-testid="card-filters">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" data-testid="input-start-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" data-testid="input-end-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Activity Type</Label>
              <Select value={activityType} onValueChange={setActivityType}>
                <SelectTrigger className="w-44" data-testid="select-activity-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="updated">Updated</SelectItem>
                  <SelectItem value="exported">Exported</SelectItem>
                  <SelectItem value="export_pdf">PDF Export</SelectItem>
                  <SelectItem value="status_change">Status Change</SelectItem>
                  <SelectItem value="view_patient">View Patient</SelectItem>
                  <SelectItem value="view_claim">View Claim</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Performed By</Label>
              <Input placeholder="Search by email..." value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} className="w-48" data-testid="input-performed-by" />
            </div>
            <Button variant="outline" size="sm" onClick={() => { setStartDate(""); setEndDate(""); setActivityType(""); setPerformedBy(""); }} data-testid="button-clear-filters">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-log-table">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium text-muted-foreground">Timestamp</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">User</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Action</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Record</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-log-${log.id}`}>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {log.created_at ? format(new Date(log.created_at), "MMM d, yyyy h:mm a") : "—"}
                      </td>
                      <td className="p-3">{log.user_email || log.performed_by || "System"}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted">
                          {log.activity_type || "—"}
                        </span>
                      </td>
                      <td className="p-3">
                        {log.claim_id && (
                          <Link href={`/billing/claims/${log.claim_id}`} className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                            Claim {log.claim_id.slice(0, 8)} <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                        {log.patient_id && !log.claim_id && (
                          <Link href={`/billing/patients/${log.patient_id}`} className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                            Patient {log.patient_id.slice(0, 8)} <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                        {!log.claim_id && !log.patient_id && "—"}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-xs truncate">{log.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center" data-testid="empty-state">
              <ScrollText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No activity recorded in this period</p>
              <p className="text-sm text-muted-foreground mt-1">Activity is logged as your team creates and manages claims.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
