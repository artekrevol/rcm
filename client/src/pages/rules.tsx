import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Shield, Plus, Pencil, Trash2, ShieldCheck, Search } from "lucide-react";
import { format } from "date-fns";
import type { Rule, InsertRule } from "@shared/schema";

export default function RulesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const [newRule, setNewRule] = useState<Partial<InsertRule>>({
    name: "",
    description: "",
    payer: "",
    cptCode: "",
    triggerPattern: "",
    preventionAction: "",
    enabled: true,
  });

  const { data: rules, isLoading } = useQuery<Rule[]>({
    queryKey: ["/api/rules"],
  });

  const createRuleMutation = useMutation({
    mutationFn: async (rule: InsertRule) => {
      return apiRequest("POST", "/api/rules", rule);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      setCreateOpen(false);
      setNewRule({
        name: "",
        description: "",
        payer: "",
        cptCode: "",
        triggerPattern: "",
        preventionAction: "",
        enabled: true,
      });
      toast({ title: "Rule created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create rule", variant: "destructive" });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PATCH", `/api/rules/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const handleCreateRule = () => {
    if (!newRule.name || !newRule.triggerPattern || !newRule.preventionAction) {
      toast({ title: "Please fill required fields", variant: "destructive" });
      return;
    }
    createRuleMutation.mutate(newRule as InsertRule);
  };

  const filteredRules = rules?.filter(
    (rule) =>
      rule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.payer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.cptCode?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalImpact = rules?.reduce((sum, r) => sum + r.impactCount, 0) || 0;
  const enabledCount = rules?.filter((r) => r.enabled).length || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            Prevention Rules
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage denial prevention rules that protect your revenue
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-rule">
              <Plus className="h-4 w-4" />
              New Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Prevention Rule</DialogTitle>
              <DialogDescription>
                Define a new rule to prevent claim denials
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Rule Name *</Label>
                <Input
                  id="name"
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="Auth Required for Inpatient"
                  data-testid="input-rule-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newRule.description}
                  onChange={(e) =>
                    setNewRule({ ...newRule, description: e.target.value })
                  }
                  placeholder="Describe when this rule applies..."
                  data-testid="input-rule-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payer">Payer (optional)</Label>
                  <Input
                    id="payer"
                    value={newRule.payer || ""}
                    onChange={(e) => setNewRule({ ...newRule, payer: e.target.value })}
                    placeholder="Payor A"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cptCode">CPT Code (optional)</Label>
                  <Input
                    id="cptCode"
                    value={newRule.cptCode || ""}
                    onChange={(e) => setNewRule({ ...newRule, cptCode: e.target.value })}
                    placeholder="90834"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="trigger">Trigger Pattern *</Label>
                <Input
                  id="trigger"
                  value={newRule.triggerPattern}
                  onChange={(e) =>
                    setNewRule({ ...newRule, triggerPattern: e.target.value })
                  }
                  placeholder="serviceType=Inpatient AND authStatus=missing"
                  data-testid="input-rule-trigger"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="action">Prevention Action *</Label>
                <Input
                  id="action"
                  value={newRule.preventionAction}
                  onChange={(e) =>
                    setNewRule({ ...newRule, preventionAction: e.target.value })
                  }
                  placeholder="Block submission, require prior authorization"
                  data-testid="input-rule-action"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={newRule.enabled}
                  onCheckedChange={(checked) =>
                    setNewRule({ ...newRule, enabled: checked })
                  }
                />
                <Label>Enable immediately</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateRule}
                disabled={createRuleMutation.isPending}
                data-testid="button-submit-rule"
              >
                Create Rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{rules?.length || 0}</p>
                <p className="text-sm text-muted-foreground">Total Rules</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{enabledCount}</p>
                <p className="text-sm text-muted-foreground">Active Rules</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {totalImpact}
                </p>
                <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80">
                  Denials Prevented
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search rules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-rules"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : filteredRules?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Active</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>CPT</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRules.map((rule) => (
                  <TableRow key={rule.id} data-testid={`rule-row-${rule.id}`}>
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) =>
                          toggleRuleMutation.mutate({ id: rule.id, enabled: checked })
                        }
                        data-testid={`switch-rule-${rule.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="max-w-md">
                        <p className="font-medium">{rule.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {rule.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {rule.payer ? (
                        <Badge variant="outline">{rule.payer}</Badge>
                      ) : (
                        <span className="text-muted-foreground">Any</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {rule.cptCode ? (
                        <code className="text-xs bg-muted px-2 py-0.5 rounded">
                          {rule.cptCode}
                        </code>
                      ) : (
                        <span className="text-muted-foreground">Any</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {rule.impactCount > 0 ? (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                          {rule.impactCount} prevented
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(rule.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteRuleMutation.mutate(rule.id)}
                          data-testid={`button-delete-rule-${rule.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No rules found</p>
              <Button
                variant="outline"
                className="mt-4 gap-2"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Create First Rule
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
