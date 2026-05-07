import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { validateNPI } from "@shared/npi-validation";
import { Plus, Pencil, Trash2, Loader2, UserRound, Building2, Search } from "lucide-react";

interface ReferringProvider {
  id: string;
  first_name: string;
  last_name: string;
  npi: string | null;
  va_composite_id: string | null;
  verification_status: "verified" | "pending" | null;
  provider_type: "1" | "2";
  notes: string | null;
  created_at: string;
}

const emptyForm = {
  first_name: "",
  last_name: "",
  npi: "",
  va_composite_id: "",
  provider_type: "1" as "1" | "2",
  notes: "",
};

function getNpiStatus(npi: string): "idle" | "invalid-format" | "invalid-luhn" | "valid" {
  if (!npi) return "idle";
  if (!/^\d{10}$/.test(npi)) return "invalid-format";
  if (!validateNPI(npi)) return "invalid-luhn";
  return "valid";
}

function ProviderDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: ReferringProvider | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(
    existing
      ? { first_name: existing.first_name, last_name: existing.last_name, npi: existing.npi ?? "", va_composite_id: existing.va_composite_id ?? "", provider_type: existing.provider_type, notes: existing.notes ?? "" }
      : { ...emptyForm }
  );

  const npiStatus = getNpiStatus(form.npi);
  const hasPendingId = !form.npi && !!form.va_composite_id.trim();

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      existing
        ? apiRequest("PATCH", `/api/billing/referring-providers/${existing.id}`, {
            ...data,
            npi: data.npi || null,
            va_composite_id: data.va_composite_id || null,
          })
        : apiRequest("POST", "/api/billing/referring-providers", {
            ...data,
            npi: data.npi || null,
            va_composite_id: data.va_composite_id || null,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/billing/referring-providers"] });
      toast({ title: existing ? "Provider updated" : "Provider created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: err?.message ?? "Failed to save provider", variant: "destructive" });
    },
  });

  const f = (k: keyof typeof form) => (e: any) =>
    setForm(prev => ({ ...prev, [k]: e.target?.value ?? e }));

  const canSave = form.first_name.trim() && form.last_name.trim() && (npiStatus === "valid" || hasPendingId);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Referring Provider" : "New Referring Provider"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rp-first-name">First Name *</Label>
              <Input
                id="rp-first-name"
                value={form.first_name}
                onChange={f("first_name")}
                maxLength={50}
                placeholder="Jessica"
                data-testid="input-rp-first-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-last-name">Last Name *</Label>
              <Input
                id="rp-last-name"
                value={form.last_name}
                onChange={f("last_name")}
                maxLength={50}
                placeholder="Capistrano"
                data-testid="input-rp-last-name"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rp-npi">
              NPI (10 digits{hasPendingId ? " — optional when VA composite ID provided" : " *"})
            </Label>
            <Input
              id="rp-npi"
              value={form.npi}
              onChange={f("npi")}
              maxLength={10}
              placeholder="1234567890"
              data-testid="input-rp-npi"
              className={
                npiStatus === "valid"
                  ? "border-emerald-500 focus-visible:ring-emerald-500"
                  : npiStatus !== "idle"
                  ? "border-red-500 focus-visible:ring-red-500"
                  : ""
              }
            />
            {npiStatus === "invalid-format" && (
              <p className="text-xs text-red-600" data-testid="text-npi-error">
                NPI must be exactly 10 numeric digits.
              </p>
            )}
            {npiStatus === "invalid-luhn" && (
              <p className="text-xs text-red-600" data-testid="text-npi-error">
                NPI fails the CMS check-digit (Luhn) validation. Please verify the number.
              </p>
            )}
            {npiStatus === "valid" && (
              <p className="text-xs text-emerald-600" data-testid="text-npi-valid">
                NPI passes check-digit validation.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="rp-va-id">VA Composite ID (optional)</Label>
            <Input
              id="rp-va-id"
              value={form.va_composite_id}
              onChange={f("va_composite_id")}
              maxLength={20}
              placeholder="662_1375949"
              data-testid="input-rp-va-id"
            />
            <p className="text-xs text-muted-foreground">
              Required only for VA Community Care referrals without an NPI (e.g. 662_1375949).
            </p>
            {hasPendingId && (
              <p className="text-xs text-amber-600" data-testid="text-rp-pending-notice">
                Provider will be saved as <strong>pending</strong> — locate and add the NPI to upgrade to verified.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Provider Type *</Label>
            <RadioGroup
              value={form.provider_type}
              onValueChange={v => setForm(prev => ({ ...prev, provider_type: v as "1" | "2" }))}
              className="flex gap-6"
              data-testid="radio-rp-type"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="1" id="rp-type-individual" data-testid="radio-rp-individual" />
                <Label htmlFor="rp-type-individual" className="font-normal cursor-pointer">
                  <UserRound className="h-4 w-4 inline mr-1" />
                  Individual
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="2" id="rp-type-org" data-testid="radio-rp-org" />
                <Label htmlFor="rp-type-org" className="font-normal cursor-pointer">
                  <Building2 className="h-4 w-4 inline mr-1" />
                  Organization
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rp-notes">Notes (optional)</Label>
            <Textarea
              id="rp-notes"
              value={form.notes}
              onChange={f("notes")}
              maxLength={500}
              rows={3}
              placeholder="e.g. SF VAMC PACT MP"
              data-testid="input-rp-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-rp-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate(form)}
            disabled={!canSave || saveMutation.isPending}
            data-testid="button-rp-save"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save Changes" : "Create Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReferringProvidersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReferringProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReferringProvider | null>(null);
  const [search, setSearch] = useState("");
  const [filterPending, setFilterPending] = useState(false);

  const { data: providers = [], isLoading } = useQuery<ReferringProvider[]>({
    queryKey: ["/api/billing/referring-providers"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/billing/referring-providers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/billing/referring-providers"] });
      toast({ title: "Provider removed" });
      setDeleteTarget(null);
    },
    onError: () => toast({ title: "Failed to remove provider", variant: "destructive" }),
  });

  const pendingCount = providers.filter(p => p.verification_status === "pending").length;

  const filtered = providers.filter(p => {
    if (filterPending && p.verification_status !== "pending") return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.first_name.toLowerCase().includes(q) ||
      p.last_name.toLowerCase().includes(q) ||
      (p.npi || "").includes(q) ||
      (p.va_composite_id || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold" data-testid="heading-referring-providers">
            Referring Providers
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reusable provider directory — link to prior auths for Loop 2310A (NM1*DN) in 837P claims.
          </p>
        </div>
        <Button
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          data-testid="button-add-referring-provider"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, NPI, or VA ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-rp-search"
          />
        </div>
        <Button
          variant={filterPending ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterPending(v => !v)}
          data-testid="button-filter-pending"
        >
          Needs review
          {pendingCount > 0 && (
            <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${filterPending ? "bg-white/20" : "bg-amber-100 text-amber-700"}`}>
              {pendingCount}
            </span>
          )}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-rp-empty">
          {search ? "No providers match your search." : "No referring providers added yet."}
        </div>
      ) : (
        <Table data-testid="table-referring-providers">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>NPI / ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(p => (
              <TableRow key={p.id} data-testid={`row-rp-${p.id}`}>
                <TableCell className="font-medium" data-testid={`text-rp-name-${p.id}`}>
                  {p.first_name} {p.last_name}
                </TableCell>
                <TableCell className="font-mono text-sm" data-testid={`text-rp-npi-${p.id}`}>
                  {p.npi ? (
                    p.npi
                  ) : p.va_composite_id ? (
                    <span className="text-amber-600">VA {p.va_composite_id}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell data-testid={`badge-rp-status-${p.id}`}>
                  {p.verification_status === "pending" ? (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                      Pending NPI
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20">
                      Verified
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" data-testid={`badge-rp-type-${p.id}`}>
                    {p.provider_type === "1" ? (
                      <><UserRound className="h-3 w-3 mr-1" />Individual</>
                    ) : (
                      <><Building2 className="h-3 w-3 mr-1" />Organization</>
                    )}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate" data-testid={`text-rp-notes-${p.id}`}>
                  {p.notes || "—"}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditing(p); setDialogOpen(true); }}
                      data-testid={`button-edit-rp-${p.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setDeleteTarget(p)}
                      data-testid={`button-delete-rp-${p.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialogOpen && (
        <ProviderDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditing(null); }}
          existing={editing}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove referring provider?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{deleteTarget?.first_name} {deleteTarget?.last_name}</strong> (NPI {deleteTarget?.npi}) from the directory. Any prior auths or claims that reference this provider will retain the ID link but the provider record will be gone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-rp">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete-rp"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
