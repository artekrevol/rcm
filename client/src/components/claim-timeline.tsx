import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  FileText,
  CheckCircle2,
  Send,
  Eye,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  DollarSign,
} from "lucide-react";
import type { ClaimEvent } from "@shared/schema";

const eventConfig: Record<
  string,
  { icon: typeof FileText; color: string; bgColor: string }
> = {
  Created: {
    icon: FileText,
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-800",
  },
  Verified: {
    icon: CheckCircle2,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  Submitted: {
    icon: Send,
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
  Acknowledged: {
    icon: Eye,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  Pending: {
    icon: Clock,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  Suspended: {
    icon: AlertTriangle,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
  },
  Denied: {
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  Appealed: {
    icon: RefreshCw,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
  },
  Paid: {
    icon: DollarSign,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
};

interface ClaimTimelineProps {
  events: ClaimEvent[];
  isStuck?: boolean;
  stuckDays?: number;
  className?: string;
}

export function ClaimTimeline({
  events,
  isStuck = false,
  stuckDays = 0,
  className,
}: ClaimTimelineProps) {
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return (
    <div className={cn("relative", className)}>
      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />

      <div className="space-y-6">
        {sortedEvents.map((event, index) => {
          const config = eventConfig[event.type] || eventConfig.Created;
          const Icon = config.icon;
          const isLast = index === sortedEvents.length - 1;
          const showStuckWarning = isLast && isStuck && event.type === "Pending";

          return (
            <div key={event.id} className="relative flex gap-4">
              <div
                className={cn(
                  "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                  config.bgColor,
                  showStuckWarning && "animate-pulse ring-2 ring-red-500 ring-offset-2 ring-offset-background"
                )}
              >
                <Icon className={cn("h-5 w-5", config.color)} />
              </div>

              <div className="flex-1 pt-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{event.type}</span>
                  {showStuckWarning && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      Stuck {stuckDays} days
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {format(new Date(event.timestamp), "MMM d, yyyy 'at' h:mm a")}
                </p>
                {event.notes && (
                  <p className="text-sm text-muted-foreground mt-2 bg-muted/50 rounded-lg p-3">
                    {event.notes}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
