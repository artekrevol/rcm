import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  FlaskConical,
  ShieldAlert,
  Clock,
  TrendingUp,
  CheckCircle,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Zap,
  Shield,
} from "lucide-react";

interface Scenario {
  id: string;
  name: string;
  description: string;
  icon: typeof ShieldAlert;
  color: string;
  bgColor: string;
}

const scenarios: Scenario[] = [
  {
    id: "high-risk-auth",
    name: "High-Risk Auth Required",
    description:
      "Triggers a claim to be flagged as RED with authorization required, blocking submission",
    icon: ShieldAlert,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  {
    id: "claim-stuck",
    name: "Claim Stuck in Pending",
    description:
      "Creates an alert for a claim stuck in pending status for more than 7 days",
    icon: Clock,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  {
    id: "denial-spike",
    name: "Denial Spike Detected",
    description:
      "Triggers a spike in denials from a specific payer, highlighting patterns in intelligence",
    icon: TrendingUp,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
  },
  {
    id: "clean-claim",
    name: "Low-Risk Clean Claim",
    description:
      "Creates a GREEN claim that passes all checks and can be submitted immediately",
    icon: CheckCircle,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  {
    id: "rule-prevents",
    name: "Rule Prevents Denial",
    description:
      "Shows before/after comparison of a claim that would have been denied without prevention rules",
    icon: Shield,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
];

export default function DemoScenariosPage() {
  const { toast } = useToast();
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [triggeredScenarios, setTriggeredScenarios] = useState<Set<string>>(new Set());

  const triggerScenarioMutation = useMutation({
    mutationFn: async (scenarioId: string) => {
      return apiRequest("POST", `/api/demo/trigger/${scenarioId}`);
    },
    onSuccess: (_, scenarioId) => {
      setTriggeredScenarios((prev) => new Set([...prev, scenarioId]));
      setActiveScenario(scenarioId);
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/clusters"] });
      
      const scenario = scenarios.find((s) => s.id === scenarioId);
      toast({
        title: "Scenario triggered",
        description: `${scenario?.name} is now active`,
      });
    },
    onError: () => {
      toast({
        title: "Failed to trigger scenario",
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/demo/reset");
    },
    onSuccess: () => {
      setTriggeredScenarios(new Set());
      setActiveScenario(null);
      queryClient.invalidateQueries();
      toast({ title: "Demo reset successfully" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-3">
            <FlaskConical className="h-8 w-8 text-primary" />
            Demo Scenarios
          </h1>
          <p className="text-muted-foreground mt-1">
            Trigger controlled scenarios to demonstrate platform capabilities
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          data-testid="button-reset-demo"
        >
          <RefreshCw className={`h-4 w-4 ${resetMutation.isPending ? "animate-spin" : ""}`} />
          Reset Demo
        </Button>
      </div>

      {activeScenario && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                Active Scenario: {scenarios.find((s) => s.id === activeScenario)?.name}
              </p>
              <p className="text-sm text-muted-foreground">
                Navigate to other pages to see the effects
              </p>
            </div>
            <Badge variant="outline" className="gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Active
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {scenarios.map((scenario) => {
          const Icon = scenario.icon;
          const isTriggered = triggeredScenarios.has(scenario.id);
          const isLoading =
            triggerScenarioMutation.isPending &&
            triggerScenarioMutation.variables === scenario.id;

          return (
            <Card
              key={scenario.id}
              className={`relative ${
                activeScenario === scenario.id
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : ""
              }`}
              data-testid={`scenario-card-${scenario.id}`}
            >
              <CardHeader>
                <div className="flex items-start gap-4">
                  <div
                    className={`h-12 w-12 rounded-lg ${scenario.bgColor} flex items-center justify-center shrink-0`}
                  >
                    <Icon className={`h-6 w-6 ${scenario.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {scenario.name}
                      {isTriggered && (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                        >
                          Triggered
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {scenario.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full gap-2"
                  variant={isTriggered ? "secondary" : "default"}
                  onClick={() => triggerScenarioMutation.mutate(scenario.id)}
                  disabled={isLoading}
                  data-testid={`button-trigger-${scenario.id}`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Triggering...
                    </>
                  ) : isTriggered ? (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      Trigger Again
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Trigger Scenario
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Demo Walkthrough
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <li className="flex gap-4">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                1
              </span>
              <div>
                <p className="font-medium">Trigger High-Risk Auth Required</p>
                <p className="text-sm text-muted-foreground">
                  Creates a claim that will be blocked before submission
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                2
              </span>
              <div>
                <p className="font-medium">Navigate to Claims</p>
                <p className="text-sm text-muted-foreground">
                  View the RED claim and click to see explainability panel
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                3
              </span>
              <div>
                <p className="font-medium">Check Intelligence</p>
                <p className="text-sm text-muted-foreground">
                  See denial patterns and generate a prevention rule
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                4
              </span>
              <div>
                <p className="font-medium">Enable Rule in Rules Page</p>
                <p className="text-sm text-muted-foreground">
                  Turn on the generated rule and see impact metrics
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                5
              </span>
              <div>
                <p className="font-medium">Trigger Clean Claim</p>
                <p className="text-sm text-muted-foreground">
                  Show a GREEN claim that can be submitted immediately
                </p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
