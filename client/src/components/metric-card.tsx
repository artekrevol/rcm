import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  subtitle?: string;
  className?: string;
}

export function MetricCard({
  title,
  value,
  icon,
  trend,
  subtitle,
  className,
}: MetricCardProps) {
  const getTrendIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="h-3 w-3" />;
    if (value < 0) return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = (value: number) => {
    if (value > 0) return "text-emerald-600 dark:text-emerald-400";
    if (value < 0) return "text-red-600 dark:text-red-400";
    return "text-muted-foreground";
  };

  return (
    <Card className={cn("", className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p className="text-3xl font-bold mt-2 truncate">{value}</p>
            {trend && (
              <div className={cn("flex items-center gap-1 mt-2", getTrendColor(trend.value))}>
                {getTrendIcon(trend.value)}
                <span className="text-xs font-medium">
                  {trend.value > 0 && "+"}
                  {trend.value}% {trend.label}
                </span>
              </div>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>
            )}
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface RevenueProtectedCardProps {
  amount: number;
  claimsProtected: number;
  className?: string;
}

export function RevenueProtectedCard({
  amount,
  claimsProtected,
  className,
}: RevenueProtectedCardProps) {
  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

  return (
    <Card className={cn("border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20", className)}>
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Revenue Protected
          </p>
        </div>
        <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
          {formattedAmount}
        </p>
        <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mt-1">
          from {claimsProtected} prevented denials
        </p>
      </CardContent>
    </Card>
  );
}
