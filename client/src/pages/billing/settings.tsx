import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingSettings() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Practice Settings</h1>
        <p className="text-muted-foreground">Practice info, providers, and payer configuration</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Practice Information</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Configure practice NPI, tax ID, providers, and default settings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
