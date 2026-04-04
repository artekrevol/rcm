import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";

export default function BillingHcpcs() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">HCPCS Codes</h1>
        <p className="text-muted-foreground">Service code lookup with payer-specific rates</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Code Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            HCPCS code lookup, rate schedules, and service descriptions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
