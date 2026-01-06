import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BookOpen, ChevronRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const demoSteps = [
  {
    id: 1,
    title: "Trigger Demo Scenario",
    description: "Go to Demo Scenarios and click 'High-risk auth required'",
    path: "/demo-scenarios",
  },
  {
    id: 2,
    title: "Create a Lead",
    description: "Navigate to Leads and create a new lead or use 'Call with AI'",
    path: "/leads",
  },
  {
    id: 3,
    title: "View Blocked Claim",
    description: "Open the claim to see RED status and explainability panel",
    path: "/claims",
  },
  {
    id: 4,
    title: "Explore Intelligence",
    description: "Check denial patterns and generate a prevention rule",
    path: "/intelligence",
  },
  {
    id: 5,
    title: "Enable Rule",
    description: "Go to Rules and enable the generated prevention rule",
    path: "/rules",
  },
];

export function DemoGuide() {
  const [currentStep, setCurrentStep] = useState(0);
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-testid="button-demo-guide">
          <BookOpen className="h-4 w-4" />
          Demo Guide
        </Button>
      </SheetTrigger>
      <SheetContent className="w-80">
        <SheetHeader>
          <SheetTitle>Demo Walkthrough</SheetTitle>
          <SheetDescription>
            Follow these steps for a 15-minute demo
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {demoSteps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "flex gap-3 p-3 rounded-lg transition-colors cursor-pointer",
                index === currentStep
                  ? "bg-primary/10 border border-primary/20"
                  : index < currentStep
                  ? "bg-muted/50"
                  : "hover:bg-muted/30"
              )}
              onClick={() => setCurrentStep(index)}
            >
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  index < currentStep
                    ? "bg-emerald-500 text-white"
                    : index === currentStep
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {index < currentStep ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  step.id
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    index < currentStep && "text-muted-foreground line-through"
                  )}
                >
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {step.description}
                </p>
              </div>
              {index === currentStep && (
                <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className="flex-1"
          >
            Previous
          </Button>
          <Button
            size="sm"
            onClick={() =>
              setCurrentStep(Math.min(demoSteps.length - 1, currentStep + 1))
            }
            disabled={currentStep === demoSteps.length - 1}
            className="flex-1"
          >
            Next Step
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
