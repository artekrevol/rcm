import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  FileText,
  Users,
  Loader2,
  Archive,
} from "lucide-react";

export default function PatientList() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(value: string) {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => setDebouncedSearch(value), 300);
    setDebounceTimer(timer);
  }

  const { data: patients = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/patients", debouncedSearch],
    queryFn: async () => {
      const params = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : "";
      const res = await fetch(`/api/billing/patients${params}`);
      if (!res.ok) throw new Error("Failed to fetch patients");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  function displayName(p: any): string {
    if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
    if (p.first_name) return p.first_name;
    if (p.last_name) return p.last_name;
    if (p.lead_name) return p.lead_name;
    return "Unknown Patient";
  }

  function formatClaimDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  }

  function statusBadge(status: string | null) {
    if (!status) return <span className="text-muted-foreground">—</span>;
    const colors: Record<string, string> = {
      submitted: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
      paid: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
      denied: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
      appealed: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
    };
    return (
      <Badge variant="outline" className={colors[status] || ""} data-testid={`badge-claim-status-${status}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Patients</h1>
          <p className="text-muted-foreground">Manage patient records, demographics, and insurance information</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/billing/patients/archived")} data-testid="button-view-archived">
            <Archive className="h-4 w-4 mr-2" />
            Archived
          </Button>
          <Button onClick={() => navigate("/billing/patients/new")} data-testid="button-new-patient">
            <Plus className="h-4 w-4 mr-2" />
            New Patient
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, DOB, insurance carrier, or member ID..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10"
          data-testid="input-patient-search"
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
              {debouncedSearch ? "No patients match your search" : "No patients yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {debouncedSearch
                ? "Try a different search term."
                : "Add your first patient or convert a lead from the Intake module."}
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
                <TableHead>Member ID</TableHead>
                <TableHead>Last Claim</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p: any) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/billing/patients/${p.id}`)}
                  data-testid={`row-patient-${p.id}`}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {displayName(p)}
                      {p.is_demo && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-violet-600 border-violet-200 bg-violet-50 dark:bg-violet-950 dark:border-violet-800 text-[10px] px-1.5 py-0 cursor-default" data-testid={`badge-demo-${p.id}`}>
                                DEMO
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Sample data — will hide automatically once you have 5+ real patients</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{p.dob || "—"}</TableCell>
                  <TableCell>{p.insurance_carrier || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{p.member_id || "—"}</TableCell>
                  <TableCell className="text-sm">{formatClaimDate(p.last_claim_date)}</TableCell>
                  <TableCell>{statusBadge(p.last_claim_status)}</TableCell>
                  <TableCell>
                    {p.intake_completed && (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 gap-1" data-testid={`badge-intake-${p.id}`}>
                        From Intake ✓
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/billing/claims/new?patientId=${p.id}`)}
                      data-testid={`button-new-claim-${p.id}`}
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      New Claim
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
