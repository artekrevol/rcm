import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingReports() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Reports</h1>
        <p className="text-muted-foreground">Revenue cycle analytics and export</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Report Center</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Aging reports, denial trends, and revenue analysis.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
