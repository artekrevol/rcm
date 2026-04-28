import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Database, CheckCircle2 } from "lucide-react";

const PLAN_PRODUCT_OPTIONS = [
  { value: "HMO", label: "HMO" },
  { value: "PPO", label: "PPO" },
  { value: "POS", label: "POS" },
  { value: "EPO", label: "EPO" },
  { value: "Indemnity", label: "Indemnity" },
  { value: "unknown", label: "Unknown / Not specified" },
];

interface BackfillRecord {
  id: string;
  first_name: string | null;
  last_name: string | null;
  insurance_carrier: string | null;
  member_id: string | null;
  plan_product: string | null;
  payer_name: string | null;
}

function BackfillRow({
  record,
  onSaved,
}: {
  record: BackfillRecord;
  onSaved: (id: string, value: string) => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/data-tools/backfill-plan-products/${record.id}`,
        { planProduct: selected }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      onSaved(record.id, selected);
      toast({ title: `Plan product set to ${selected}` });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const displayName =
    [record.first_name, record.last_name].filter(Boolean).join(" ") || "Unknown";
  const payer = record.payer_name || record.insurance_carrier || "—";

  return (
    <tr
      className={`border-b text-sm ${saved ? "opacity-50" : ""}`}
      data-testid={`row-backfill-${record.id}`}
    >
      <td className="py-2 px-3 font-medium">{displayName}</td>
      <td className="py-2 px-3 text-muted-foreground">{payer}</td>
      <td className="py-2 px-3 text-muted-foreground">{record.member_id || "—"}</td>
      <td className="py-2 px-3">
        {saved ? (
          <Badge
            variant="outline"
            className="text-green-700 border-green-300 bg-green-50 dark:bg-green-950 gap-1"
          >
            <CheckCircle2 className="h-3 w-3" />
            {selected}
          </Badge>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger
                className="h-7 text-xs w-44"
                data-testid={`select-backfill-plan-${record.id}`}
              >
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_PRODUCT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!selected || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              data-testid={`button-save-backfill-${record.id}`}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function DataToolsPage() {
  const queryClient = useQueryClient();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const { data: records = [], isLoading } = useQuery<BackfillRecord[]>({
    queryKey: ["/api/admin/data-tools/backfill-plan-products"],
  });

  const displayRecords = records.filter((r) => !savedIds.has(r.id));

  function handleSaved(id: string, _value: string) {
    setSavedIds((prev) => new Set(Array.from(prev).concat(id)));
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/data-tools/backfill-plan-products"],
    });
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Database className="h-6 w-6" /> Data Tools
          </h1>
          <p className="text-muted-foreground mt-1">
            Operational tools for admin data cleanup. Not for end users.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Backfill Plan Products</CardTitle>
            <CardDescription>
              Lists all patient insurance records where the plan product (HMO, PPO, POS, EPO,
              Indemnity) has not been set. Use this to bulk-update existing records. Changes
              apply only to the patient profile — existing claims retain the plan product that
              was snapshotted at the time they were created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : displayRecords.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2"
                data-testid="text-backfill-complete"
              >
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <p className="font-medium text-green-600">All patient records have a plan product set.</p>
                <p className="text-sm">Nothing to backfill.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  {displayRecords.length} patient{displayRecords.length !== 1 ? "s" : ""} without
                  a plan product.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full" data-testid="table-backfill">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="py-2 px-3 text-left font-medium">Patient</th>
                        <th className="py-2 px-3 text-left font-medium">Payer</th>
                        <th className="py-2 px-3 text-left font-medium">Member ID</th>
                        <th className="py-2 px-3 text-left font-medium">Plan Product</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRecords.map((r) => (
                        <BackfillRow key={r.id} record={r} onSaved={handleSaved} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
