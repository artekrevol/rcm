import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ReadinessStatus = "GREEN" | "YELLOW" | "RED";

interface StatusBadgeProps {
  status: ReadinessStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StatusBadge({ status, size = "sm", className }: StatusBadgeProps) {
  const baseStyles = {
    GREEN: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    YELLOW: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    RED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  const sizeStyles = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-3 py-1",
    lg: "text-base px-4 py-1.5 font-semibold",
  };

  const labels = {
    GREEN: "Ready",
    YELLOW: "At Risk",
    RED: "Blocked",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 font-medium",
        baseStyles[status],
        sizeStyles[size],
        className
      )}
    >
      {labels[status]}
    </Badge>
  );
}

interface ClaimStatusBadgeProps {
  status: string;
  className?: string;
}

export function ClaimStatusBadge({ status, className }: ClaimStatusBadgeProps) {
  const statusStyles: Record<string, string> = {
    created: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
    verified: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    submitted: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    acknowledged: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    suspended: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    denied: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    appealed: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 text-xs font-medium capitalize",
        statusStyles[status] || statusStyles.created,
        className
      )}
    >
      {status}
    </Badge>
  );
}

interface LeadStatusBadgeProps {
  status: string;
  className?: string;
}

export function LeadStatusBadge({ status, className }: LeadStatusBadgeProps) {
  const statusStyles: Record<string, string> = {
    new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    contacted: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    qualified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    unqualified: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
    converted: "bg-primary/10 text-primary dark:bg-primary/20",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 text-xs font-medium capitalize",
        statusStyles[status] || statusStyles.new,
        className
      )}
    >
      {status}
    </Badge>
  );
}
