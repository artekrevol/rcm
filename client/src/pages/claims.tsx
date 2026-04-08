import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, ClaimStatusBadge } from "@/components/status-badge";
import { RiskScore } from "@/components/risk-score";
import { Search, Filter, FileText, AlertTriangle, X, Download, ArrowRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import type { Claim } from "@shared/schema";

const claimStatuses = [
  "created",
  "verified",
  "submitted",
  "acknowledged",
  "pending",
  "suspended",
  "denied",
  "appealed",
  "paid",
];


type SortKey = "status" | "amount" | "createdAt" | "payer" | null;
type SortDir = "asc" | "desc";

export default function ClaimsPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const urlStatus = urlParams.get("status");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(urlStatus || "all");
  const [payerFilter, setPayerFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: claims, isLoading } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
  });

  const uniquePayers = Array.from(new Set(claims?.map(c => c.payer) || [])).sort();

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "amount" ? "desc" : "asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  }

  const filteredClaims = claims?.filter((claim) => {
    const matchesSearch =
      claim.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      claim.payer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      claim.cptCodes?.some((code) => code.includes(searchQuery));
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    const matchesPayer = payerFilter === "all" || claim.payer === payerFilter;
    const matchesRisk =
      riskFilter === "all" || claim.readinessStatus === riskFilter;
    return matchesSearch && matchesStatus && matchesPayer && matchesRisk;
  });

  const sortedClaims = useMemo(() => {
    if (!filteredClaims || !sortKey) return filteredClaims;
    return [...filteredClaims].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
        case "createdAt": cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
        case "payer": cmp = (a.payer || "").localeCompare(b.payer || ""); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredClaims, sortKey, sortDir]);

  const atRiskCount = claims?.filter(
    (c) => c.readinessStatus === "YELLOW" || c.readinessStatus === "RED"
  ).length || 0;

  const columns = [
    {
      key: "id",
      header: "Claim ID",
      render: (claim: Claim) => (
        <span className="font-mono text-sm">{claim.id.slice(0, 8)}</span>
      ),
    },
    {
      key: "payer",
      header: "Payer",
      sortable: true,
      render: (claim: Claim) => (
        <span className="text-sm font-medium">{claim.payer}</span>
      ),
    },
    {
      key: "cptCodes",
      header: "CPT Codes",
      render: (claim: Claim) => (
        <span className="font-mono text-xs text-muted-foreground">
          {claim.cptCodes?.join(", ")}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      sortable: true,
      render: (claim: Claim) => (
        <span className="font-medium">${claim.amount.toLocaleString()}</span>
      ),
      className: "text-right",
    },
    {
      key: "riskScore",
      header: "Risk",
      render: (claim: Claim) => <RiskScore score={claim.riskScore} size="sm" />,
    },
    {
      key: "readinessStatus",
      header: "Readiness",
      render: (claim: Claim) => (
        <StatusBadge status={claim.readinessStatus as "GREEN" | "YELLOW" | "RED"} />
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (claim: Claim) => <ClaimStatusBadge status={claim.status} />,
    },
    {
      key: "reason",
      header: "Reason",
      render: (claim: Claim) => (
        <span className="text-sm text-muted-foreground truncate max-w-[120px] block">
          {claim.reason || "—"}
        </span>
      ),
    },
    {
      key: "nextStep",
      header: "Next Step",
      render: (claim: Claim) => (
        <span className="text-sm text-muted-foreground truncate max-w-[120px] block">
          {claim.nextStep || "—"}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (claim: Claim) => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(claim.createdAt), "MMM d, yyyy")}
        </span>
      ),
    },
  ];

  const highRiskCount = claims?.filter(c => c.readinessStatus === "RED").length || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Claims</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and manage all claims with risk scoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {claims?.length || 0} total claims
          </Badge>
          <Button variant="outline" size="sm" className="gap-2" data-testid="button-export-claims">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {highRiskCount > 0 && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="font-medium text-red-700 dark:text-red-300">
                {highRiskCount} high-risk claims need attention
              </p>
              <p className="text-sm text-red-600/80 dark:text-red-400/80">
                These claims have a high probability of denial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRiskFilter("RED")}
              className="gap-1"
              data-testid="button-view-high-risk"
            >
              View Claims
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" data-testid="button-dismiss-alert">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {atRiskCount > 0 && highRiskCount === 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {atRiskCount} claims at moderate risk
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                Require attention
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search claims by ID, payer, or CPT..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-claims"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {claimStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payerFilter} onValueChange={setPayerFilter}>
          <SelectTrigger className="w-48" data-testid="select-payer-filter">
            <SelectValue placeholder="Payer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payers</SelectItem>
            {uniquePayers.map((payer) => (
              <SelectItem key={payer} value={payer}>
                {payer}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-36" data-testid="select-risk-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risk</SelectItem>
            <SelectItem value="GREEN">Ready</SelectItem>
            <SelectItem value="YELLOW">At Risk</SelectItem>
            <SelectItem value="RED">Blocked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            data={sortedClaims || []}
            columns={columns}
            keyExtractor={(claim) => claim.id}
            onRowClick={(claim) => {
              if (claim.status === "draft") {
                setLocation(`/billing/claims/new?claimId=${claim.id}&patientId=${claim.patientId}`);
              } else {
                setLocation(`/claims/${claim.id}`);
              }
            }}
            emptyMessage="No claims found"
            isLoading={isLoading}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key) => toggleSort(key as SortKey)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
