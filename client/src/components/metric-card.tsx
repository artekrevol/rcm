import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    label: string;
    isPositive?: boolean;
  };
  subtitle?: string;
  className?: string;
  variant?: "default" | "blue" | "green" | "amber" | "red";
}

export function MetricCard({
  title,
  value,
  icon,
  trend,
  subtitle,
  className,
  variant = "default",
}: MetricCardProps) {
  const getTrendIcon = (value: number) => {
    if (value > 0) return <ArrowUpRight className="h-3.5 w-3.5" />;
    if (value < 0) return <ArrowDownRight className="h-3.5 w-3.5" />;
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = (value: number, isPositive?: boolean) => {
    const effectivePositive = isPositive !== undefined ? isPositive : value > 0;
    if (value === 0) return "text-muted-foreground";
    return effectivePositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  };

  const variantStyles = {
    default: "",
    blue: "metric-blue",
    green: "metric-green",
    amber: "metric-amber",
    red: "metric-red",
  };

  return (
    <Card className={cn(variantStyles[variant], className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">
              {title}
            </p>
            <p className="text-2xl font-bold mt-1 truncate">{value}</p>
            {trend && (
              <div className={cn("flex items-center gap-1 mt-1.5 text-sm", getTrendColor(trend.value, trend.isPositive))}>
                {getTrendIcon(trend.value)}
                <span className="font-medium">
                  {trend.value > 0 && "+"}
                  {trend.value}%
                </span>
                <span className="text-muted-foreground text-xs">{trend.label}</span>
              </div>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>
            )}
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
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
  cleanClaimRate?: number;
  savedThisWeek?: number;
  className?: string;
}

export function RevenueProtectedCard({
  amount,
  claimsProtected,
  cleanClaimRate = 94,
  savedThisWeek = 180000,
  className,
}: RevenueProtectedCardProps) {
  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(amount);

  const formattedSaved = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(savedThisWeek);

  return (
    <div className={cn("space-y-4", className)}>
      <Card className="bg-gradient-to-br from-primary to-primary/80 border-0 text-white">
        <CardContent className="p-5">
          <p className="text-sm text-white/80">
            Revenue Protected
          </p>
          <p className="text-3xl font-bold mt-1">
            {formattedAmount}
          </p>
          <p className="text-sm text-white/70 mt-1">
            From prevented denials this quarter
          </p>
          <Button variant="ghost" size="sm" className="mt-3 -ml-2 text-white/90" data-testid="button-view-revenue-details">
            View Details
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{cleanClaimRate}%</p>
              <p className="text-xs text-muted-foreground">Clean Claim Rate</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formattedSaved}</p>
              <p className="text-xs text-muted-foreground">Saved This Week</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
