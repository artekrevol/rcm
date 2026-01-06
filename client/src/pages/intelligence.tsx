import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  Sparkles,
  Shield,
  AlertTriangle,
} from "lucide-react";
import type { DenialCluster } from "@shared/schema";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const payers = ["All Payers", "Payor A", "Payor B", "Payor C", "Payor D", "Payor E"];

export default function IntelligencePage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [payerFilter, setPayerFilter] = useState("All Payers");

  const { data: clusters, isLoading } = useQuery<DenialCluster[]>({
    queryKey: ["/api/intelligence/clusters"],
  });

  const { data: topPatterns } = useQuery<
    Array<{ rootCause: string; count: number; change: number }>
  >({
    queryKey: ["/api/intelligence/top-patterns"],
  });

  const generateRuleMutation = useMutation({
    mutationFn: async (cluster: DenialCluster) => {
      return apiRequest("POST", "/api/rules/generate", {
        payer: cluster.payer,
        cptCode: cluster.cptCode,
        rootCause: cluster.rootCause,
        suggestedRule: cluster.suggestedRule,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      toast({ title: "Prevention rule generated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to generate rule", variant: "destructive" });
    },
  });

  const filteredClusters = clusters?.filter((cluster) => {
    const matchesSearch =
      cluster.payer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cluster.cptCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cluster.rootCause.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPayer =
      payerFilter === "All Payers" || cluster.payer === payerFilter;
    return matchesSearch && matchesPayer;
  });

  const chartData = topPatterns?.map((p) => ({
    name: p.rootCause.length > 20 ? p.rootCause.slice(0, 20) + "..." : p.rootCause,
    count: p.count,
    fullName: p.rootCause,
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-3">
            <Brain className="h-8 w-8 text-primary" />
            Denial Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">
            AI-powered pattern detection and prevention rule generation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-base font-medium">
              Denial Patterns by Root Cause
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {topPatterns ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={150}
                      className="text-xs"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value, name, props) => [
                        value,
                        props.payload.fullName,
                      ]}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {chartData?.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            index === 0
                              ? "hsl(0 72% 50%)"
                              : index === 1
                              ? "hsl(25 95% 53%)"
                              : "hsl(var(--primary))"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Skeleton className="w-full h-full" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top Patterns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topPatterns?.slice(0, 5).map((pattern, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{pattern.rootCause}</p>
                  <p className="text-xs text-muted-foreground">
                    {pattern.count} denials
                  </p>
                </div>
                <div
                  className={`flex items-center gap-1 text-xs ${
                    pattern.change > 0
                      ? "text-red-600 dark:text-red-400"
                      : pattern.change < 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {pattern.change > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : pattern.change < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : null}
                  {pattern.change !== 0 && `${Math.abs(pattern.change)}%`}
                </div>
              </div>
            )) || (
              <>
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search patterns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-patterns"
          />
        </div>
        <Select value={payerFilter} onValueChange={setPayerFilter}>
          <SelectTrigger className="w-40" data-testid="select-payer-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {payers.map((payer) => (
              <SelectItem key={payer} value={payer}>
                {payer}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClusters?.map((cluster, idx) => (
            <Card key={idx} className="relative overflow-visible" data-testid={`cluster-card-${idx}`}>
              <CardContent className="p-6">
                <div className="absolute -top-3 -right-3">
                  <Badge className="text-lg font-bold px-3 py-1 bg-red-500 text-white border-0">
                    {cluster.count}
                  </Badge>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      Payer
                    </p>
                    <p className="font-medium">{cluster.payer}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      CPT Code
                    </p>
                    <p className="font-mono">{cluster.cptCode}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      Root Cause
                    </p>
                    <Badge variant="outline" className="mt-1 gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {cluster.rootCause}
                    </Badge>
                  </div>

                  <div className="h-12 flex items-end gap-1">
                    {cluster.trend.map((value, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-primary/20 rounded-t"
                        style={{ height: `${(value / Math.max(...cluster.trend)) * 100}%` }}
                      />
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full mt-4 gap-2"
                  variant="outline"
                  onClick={() => generateRuleMutation.mutate(cluster)}
                  disabled={generateRuleMutation.isPending}
                  data-testid={`button-generate-rule-${idx}`}
                >
                  <Sparkles className="h-4 w-4" />
                  Generate Prevention Rule
                </Button>
              </CardContent>
            </Card>
          ))}
          {filteredClusters?.length === 0 && (
            <div className="col-span-full py-12 text-center">
              <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No denial patterns found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
