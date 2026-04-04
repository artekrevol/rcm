import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingPatients() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Patients</h1>
        <p className="text-muted-foreground">Patient demographics and insurance information</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Patient Registry</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Full patient management with demographics, insurance details, and encounter history.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
