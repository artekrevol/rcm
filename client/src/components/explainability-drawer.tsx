import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  FileInput,
  AlertTriangle,
  Shield,
  Target,
  CheckSquare,
} from "lucide-react";
import type { RiskExplanation } from "@shared/schema";
import { cn } from "@/lib/utils";

interface ExplainabilityDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  explanation: RiskExplanation | null;
  claimId?: string;
}

export function ExplainabilityDrawer({
  open,
  onOpenChange,
  explanation,
  claimId,
}: ExplainabilityDrawerProps) {
  if (!explanation) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-96 overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Why this decision?
          </SheetTitle>
          <SheetDescription>
            Risk analysis breakdown {claimId && `for claim ${claimId}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section>
            <div className="flex items-center gap-2 mb-4">
              <FileInput className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide">
                Inputs Used
              </h3>
            </div>
            <div className="space-y-3">
              {explanation.inputs.map((input, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{input.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                      {input.value}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({input.weight}pts)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide">
                Risk Factors
              </h3>
            </div>
            <div className="space-y-4">
              {explanation.factors.map((factor, idx) => (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{factor.name}</span>
                    <span className="text-sm text-muted-foreground">
                      +{factor.contribution}
                    </span>
                  </div>
                  <Progress value={factor.contribution} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {factor.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide">
                Applied Rules
              </h3>
            </div>
            {explanation.appliedRules.length > 0 ? (
              <div className="space-y-3">
                {explanation.appliedRules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="bg-muted/50 rounded-lg p-3 border border-border/50"
                  >
                    <p className="text-sm font-medium">{rule.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {rule.description}
                    </p>
                    <p className="text-xs font-medium text-primary mt-2">
                      {rule.impact}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No prevention rules were applied
              </p>
            )}
          </section>

          <Separator />

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  Confidence Score
                </h3>
              </div>
              <span
                className={cn(
                  "text-2xl font-bold",
                  explanation.confidence >= 80
                    ? "text-emerald-600 dark:text-emerald-400"
                    : explanation.confidence >= 60
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {explanation.confidence}%
              </span>
            </div>
            <Progress value={explanation.confidence} className="h-3" />
          </section>

          <Separator />

          <section>
            <div className="flex items-center gap-2 mb-4">
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide">
                Recommended Actions
              </h3>
            </div>
            <div className="space-y-3">
              {explanation.recommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50"
                >
                  <Checkbox
                    checked={rec.completed}
                    disabled
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm">{rec.action}</p>
                    <span
                      className={cn(
                        "inline-block mt-1 text-xs font-medium",
                        rec.priority === "high"
                          ? "text-red-600 dark:text-red-400"
                          : rec.priority === "medium"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {rec.priority.toUpperCase()} PRIORITY
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
