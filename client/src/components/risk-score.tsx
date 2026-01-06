import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RiskScoreProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showExplainButton?: boolean;
  onExplainClick?: () => void;
  className?: string;
}

export function RiskScore({
  score,
  size = "md",
  showExplainButton = false,
  onExplainClick,
  className,
}: RiskScoreProps) {
  const getColor = (score: number) => {
    if (score < 40) return "text-emerald-600 dark:text-emerald-400";
    if (score < 70) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const getProgressColor = (score: number) => {
    if (score < 40) return "bg-emerald-500";
    if (score < 70) return "bg-amber-500";
    return "bg-red-500";
  };

  const sizeStyles = {
    sm: {
      container: "w-16",
      score: "text-lg font-bold",
      bar: "h-1",
    },
    md: {
      container: "w-24",
      score: "text-2xl font-bold",
      bar: "h-1.5",
    },
    lg: {
      container: "w-32",
      score: "text-3xl font-bold",
      bar: "h-2",
    },
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("flex flex-col", sizeStyles[size].container)}>
        <span className={cn(sizeStyles[size].score, getColor(score))}>
          {score}
        </span>
        <div className={cn("w-full bg-muted rounded-full", sizeStyles[size].bar)}>
          <div
            className={cn("rounded-full transition-all", sizeStyles[size].bar, getProgressColor(score))}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      {showExplainButton && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onExplainClick}
          data-testid="button-explain-risk"
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

interface RiskScoreCircleProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function RiskScoreCircle({
  score,
  size = 80,
  strokeWidth = 8,
  className,
}: RiskScoreCircleProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (score: number) => {
    if (score < 40) return "stroke-emerald-500";
    if (score < 70) return "stroke-amber-500";
    return "stroke-red-500";
  };

  const getTextColor = (score: number) => {
    if (score < 40) return "text-emerald-600 dark:text-emerald-400";
    if (score < 70) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-500", getColor(score))}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn("text-2xl font-bold", getTextColor(score))}>{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Risk</span>
      </div>
    </div>
  );
}
