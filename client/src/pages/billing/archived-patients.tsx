import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Search,
  Users,
  Loader2,
  RotateCcw,
  Archive,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ArchivedPatients() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function handleSearch(value: string) {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => setDebouncedSearch(value), 300);
    setDebounceTimer(timer);
  }

  const { data: patients = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", "archived", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ archived: "true" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/billing/patients?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch archived patients");
      return res.json();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      setRestoringId(id);
      return apiRequest("PATCH", `/api/billing/patients/${id}/restore`, {});
    },
    onSuccess: () => {
      setRestoringId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/billing/patients"] });
      toast({ title: "Patient restored", description: "The patient is now visible in your patient list." });
    },
    onError: () => {
      setRestoringId(null);
      toast({ title: "Error", description: "Failed to restore patient", variant: "destructive" });
    },
  });

  function displayName(p: any): string {
    if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
    if (p.first_name) return p.first_name;
    if (p.last_name) return p.last_name;
    if (p.lead_name) return p.lead_name;
    return "Unknown Patient";
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    try { return new Date(dateStr).toLocaleDateString(); } catch { return dateStr; }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/billing/patients")} data-testid="button-back-to-patients">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Archive className="h-5 w-5 text-muted-foreground" />
            Archived Patients
          </h1>
          <p className="text-muted-foreground text-sm">Records are retained per HIPAA and state requirements. Use Restore to make a patient active again.</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search archived patients…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10"
          data-testid="input-archived-search"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : patients.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium mb-1">
              {debouncedSearch ? "No archived patients match your search" : "No archived patients"}
            </p>
            <p className="text-sm text-muted-foreground">
              {debouncedSearch ? "Try a different search term." : "When you archive a patient they will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>DOB</TableHead>
                <TableHead>Insurance Carrier</TableHead>
                <TableHead>Archived On</TableHead>
                <TableHead>Archived By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p: any) => (
                <TableRow key={p.id} className="hover:bg-muted/50" data-testid={`row-archived-patient-${p.id}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {displayName(p)}
                      {p.is_demo && (
                        <Badge variant="outline" className="text-violet-600 border-violet-200 bg-violet-50 dark:bg-violet-950 dark:border-violet-800 text-[10px] px-1.5 py-0" data-testid={`badge-demo-${p.id}`}>
                          DEMO
                        </Badge>
                      )}
                      {p.archived_by === "system" && (
                        <Badge variant="outline" className="text-slate-500 border-slate-200 bg-slate-50 dark:bg-slate-900 dark:border-slate-700 text-[10px] px-1.5 py-0">
                          Auto
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{p.dob || "—"}</TableCell>
                  <TableCell>{p.insurance_carrier || "—"}</TableCell>
                  <TableCell className="text-sm">{formatDate(p.archived_at)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.archived_by || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{p.archive_reason || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restoreMutation.mutate(p.id)}
                      disabled={restoringId === p.id}
                      data-testid={`button-restore-${p.id}`}
                    >
                      {restoringId === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <RotateCcw className="h-4 w-4 mr-1" />
                      )}
                      Restore
                    </Button>
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
