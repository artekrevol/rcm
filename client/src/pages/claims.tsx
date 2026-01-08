import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { StatusBadge, ClaimStatusBadge } from "@/components/status-badge";
import { RiskScore } from "@/components/risk-score";
import { Search, Filter, FileText, AlertTriangle } from "lucide-react";
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


export default function ClaimsPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [payerFilter, setPayerFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");

  const { data: claims, isLoading } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
  });

  const uniquePayers = Array.from(new Set(claims?.map(c => c.payer) || [])).sort();

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
      render: (claim: Claim) => <ClaimStatusBadge status={claim.status} />,
    },
    {
      key: "createdAt",
      header: "Created",
      render: (claim: Claim) => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(claim.createdAt), "MMM d, yyyy")}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold">Claims</h1>
          <p className="text-muted-foreground mt-1">
            Monitor and manage all claims with risk scoring
          </p>
        </div>
        {atRiskCount > 0 && (
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="p-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {atRiskCount} claims at risk
                </p>
                <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                  Require attention
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

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
            data={filteredClaims || []}
            columns={columns}
            keyExtractor={(claim) => claim.id}
            onRowClick={(claim) => setLocation(`/claims/${claim.id}`)}
            emptyMessage="No claims found"
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
