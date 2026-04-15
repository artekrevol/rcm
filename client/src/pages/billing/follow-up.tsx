import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecks, Plus, Copy, Download, CalendarClock, Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";

const CHARGE_STATUSES = [
  "At Insurance", "Appeal at Insurance", "Denied", "Balance Due Patient", "Paid", "On Hold"
];

function daysColor(days: number) {
  if (days <= 30) return "text-gray-500";
  if (days <= 60) return "text-yellow-600";
  if (days <= 90) return "text-orange-600";
  return "text-red-600 font-bold";
}

function daysBadge(days: number) {
  if (days <= 30) return <Badge variant="outline" className="text-gray-600">{days}d</Badge>;
  if (days <= 60) return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{days}d</Badge>;
  if (days <= 90) return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{days}d</Badge>;
  return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{days}d</Badge>;
}

export default function FollowUpPage() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [noteDialogClaimId, setNoteDialogClaimId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [followUpDialogClaimId, setFollowUpDialogClaimId] = useState<string | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [bulkFollowUpDate, setBulkFollowUpDate] = useState("");
  const [showBulkFollowUp, setShowBulkFollowUp] = useState(false);

  const { data: claims = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/follow-up"],
  });

  const patchClaimMutation = useMutation({
    mutationFn: async ({ claimId, data }: { claimId: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/billing/claims/${claimId}`, data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/billing/follow-up"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ claim_id, note_text }: { claim_id: string; note_text: string }) => {
      const res = await apiRequest("POST", "/api/billing/follow-up-notes", { claim_id, note_text });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/follow-up"] });
      setNoteDialogClaimId(null);
      setNoteText("");
      toast({ title: "Note added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const copyNoteMutation = useMutation({
    mutationFn: async ({ source_claim_id, note_text }: { source_claim_id: string; note_text: string }) => {
      const res = await apiRequest("POST", "/api/billing/follow-up-notes/copy-to-patient", { source_claim_id, note_text });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/follow-up"] });
      toast({ title: `Note copied to ${data.copied} other claim(s)` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === claims.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(claims.map((c: any) => c.id)));
    }
  }

  async function handleBulkFollowUpDate() {
    for (const id of Array.from(selectedIds)) {
      await patchClaimMutation.mutateAsync({ claimId: id, data: { followUpDate: bulkFollowUpDate } });
    }
    setShowBulkFollowUp(false);
    setBulkFollowUpDate("");
    toast({ title: `Follow-up date set for ${selectedIds.size} claim(s)` });
  }

  function exportCSV() {
    const selected = claims.filter((c: any) => selectedIds.has(c.id));
    const rows = selected.map((c: any) => [
      `"${c.patient_name || ""}"`,
      `"${c.payer_display || c.payer || ""}"`,
      `"${c.id?.slice(0, 8)}"`,
      `"${c.service_date || ""}"`,
      `"${(c.amount || 0).toFixed(2)}"`,
      `"${c.days_outstanding || 0}"`,
      `"${(c.last_note || "").replace(/"/g, '""')}"`,
    ].join(","));
    const csv = ["Patient,Payer,Claim #,DOS,Amount,Days Outstanding,Last Note", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `follow-up-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const noteDialogClaim = claims.find((c: any) => c.id === noteDialogClaimId);
  const followUpDialogClaim = claims.find((c: any) => c.id === followUpDialogClaimId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Follow-Up Work Queue</h1>
        <p className="text-muted-foreground">Claims at insurance pending payment, ordered by follow-up date</p>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20" data-testid="bulk-actions-bar">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setShowBulkFollowUp(true)} data-testid="button-bulk-follow-up-date">
            <CalendarClock className="h-4 w-4 mr-1" /> Set Follow-Up Date
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ListChecks className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No outstanding claims</p>
            <p className="text-sm mt-1">Claims that are at insurance and not yet paid will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={selectedIds.size === claims.length}
                        onCheckedChange={toggleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Patient</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Payer</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Claim #</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">DOS</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Billed</th>
                    <th className="text-center p-3 font-medium text-muted-foreground">Days Out</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Follow-Up</th>
                    <th className="text-left p-3 font-medium text-muted-foreground min-w-[180px]">Last Note</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c: any) => {
                    const days = c.days_outstanding || 0;
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-follow-up-${c.id?.slice(0, 8)}`}>
                        <td className="p-3">
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={() => toggleSelect(c.id)}
                            data-testid={`checkbox-claim-${c.id?.slice(0, 8)}`}
                          />
                        </td>
                        <td className="p-3 font-medium">{c.patient_name || "Unknown"}</td>
                        <td className="p-3 text-muted-foreground">{c.payer_display || c.payer || "—"}</td>
                        <td className="p-3">
                          <Link href={`/billing/claims/${c.id}`} className="font-mono text-primary hover:underline">
                            {c.id?.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="p-3 text-muted-foreground">{c.service_date ? format(new Date(c.service_date), "MM/dd/yyyy") : "—"}</td>
                        <td className="p-3 text-right font-medium">${(c.amount || 0).toFixed(2)}</td>
                        <td className="p-3 text-center">{daysBadge(days)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {c.follow_up_date ? (
                              <span className="text-xs">{format(new Date(c.follow_up_date), "MM/dd/yyyy")}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not set</span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => { setFollowUpDialogClaimId(c.id); setFollowUpDate(c.follow_up_date || ""); }}
                              data-testid={`button-set-follow-up-${c.id?.slice(0, 8)}`}
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="p-3 max-w-[220px]">
                          {c.last_note ? (
                            <div>
                              <p className="text-xs truncate" title={c.last_note}>{c.last_note}</p>
                              {c.last_note_at && (
                                <p className="text-xs text-muted-foreground">{format(new Date(c.last_note_at), "MM/dd")}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No notes</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => { setNoteDialogClaimId(c.id); setNoteText(""); }}
                              data-testid={`button-add-note-${c.id?.slice(0, 8)}`}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Note
                            </Button>
                            <Select
                              value={c.follow_up_status || "At Insurance"}
                              onValueChange={(v) => patchClaimMutation.mutate({ claimId: c.id, data: { followUpStatus: v } })}
                            >
                              <SelectTrigger className="h-7 text-xs w-[130px]" data-testid={`select-charge-status-${c.id?.slice(0, 8)}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CHARGE_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {c.last_note && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => copyNoteMutation.mutate({ source_claim_id: c.id, note_text: c.last_note })}
                                disabled={copyNoteMutation.isPending}
                                data-testid={`button-copy-note-${c.id?.slice(0, 8)}`}
                              >
                                <Copy className="h-3 w-3 mr-1" /> Copy Note
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!noteDialogClaimId} onOpenChange={(o) => !o && setNoteDialogClaimId(null)}>
        <DialogContent data-testid="dialog-add-note">
          <DialogHeader>
            <DialogTitle>Add Follow-Up Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {noteDialogClaim && (
              <p className="text-sm text-muted-foreground">
                Claim: {noteDialogClaim.id?.slice(0, 8)} — {noteDialogClaim.patient_name}
              </p>
            )}
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Enter follow-up note..."
              rows={4}
              data-testid="input-note-text"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogClaimId(null)}>Cancel</Button>
            <Button
              onClick={() => noteDialogClaimId && addNoteMutation.mutate({ claim_id: noteDialogClaimId, note_text: noteText })}
              disabled={!noteText.trim() || addNoteMutation.isPending}
              data-testid="button-save-note"
            >
              {addNoteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!followUpDialogClaimId} onOpenChange={(o) => !o && setFollowUpDialogClaimId(null)}>
        <DialogContent data-testid="dialog-set-follow-up">
          <DialogHeader>
            <DialogTitle>Set Follow-Up Date</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {followUpDialogClaim && (
              <p className="text-sm text-muted-foreground">
                {followUpDialogClaim.patient_name} — Claim {followUpDialogClaim.id?.slice(0, 8)}
              </p>
            )}
            <div className="space-y-1">
              <Label>Follow-Up Date</Label>
              <Input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                data-testid="input-follow-up-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpDialogClaimId(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (followUpDialogClaimId) {
                  patchClaimMutation.mutate({ claimId: followUpDialogClaimId, data: { followUpDate } });
                  setFollowUpDialogClaimId(null);
                }
              }}
              disabled={!followUpDate || patchClaimMutation.isPending}
              data-testid="button-save-follow-up-date"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkFollowUp} onOpenChange={setShowBulkFollowUp}>
        <DialogContent data-testid="dialog-bulk-follow-up">
          <DialogHeader>
            <DialogTitle>Set Follow-Up Date for {selectedIds.size} Claims</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Follow-Up Date</Label>
            <Input type="date" value={bulkFollowUpDate} onChange={(e) => setBulkFollowUpDate(e.target.value)} data-testid="input-bulk-follow-up-date" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkFollowUp(false)}>Cancel</Button>
            <Button onClick={handleBulkFollowUpDate} disabled={!bulkFollowUpDate || patchClaimMutation.isPending} data-testid="button-save-bulk-follow-up">
              {patchClaimMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply to All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
