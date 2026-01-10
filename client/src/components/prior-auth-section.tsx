import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Calendar,
  FileText,
} from "lucide-react";
import { format, differenceInDays, isPast } from "date-fns";
import type { PriorAuth } from "@shared/schema";

interface PriorAuthSectionProps {
  encounterId: string;
  patientId: string;
  payer: string;
  serviceType?: string;
}

export function PriorAuthSection({
  encounterId,
  patientId,
  payer,
  serviceType,
}: PriorAuthSectionProps) {
  const { toast } = useToast();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    authNumber: "",
    status: "pending",
    approvedUnits: "",
    expirationDate: "",
    notes: "",
  });

  const { data: auths, isLoading } = useQuery<PriorAuth[]>({
    queryKey: ["/api/prior-auth/encounter", encounterId],
  });

  const createAuthMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/prior-auth", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prior-auth/encounter", encounterId] });
      toast({ title: "Prior authorization created" });
      setCreateModalOpen(false);
      setFormData({
        authNumber: "",
        status: "pending",
        approvedUnits: "",
        expirationDate: "",
        notes: "",
      });
    },
    onError: () => {
      toast({ title: "Failed to create authorization", variant: "destructive" });
    },
  });

  const updateAuthMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      return apiRequest("PATCH", `/api/prior-auth/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prior-auth/encounter", encounterId] });
      toast({ title: "Authorization updated" });
    },
    onError: () => {
      toast({ title: "Failed to update authorization", variant: "destructive" });
    },
  });

  const handleCreateAuth = () => {
    createAuthMutation.mutate({
      encounterId,
      patientId,
      payer,
      serviceType: serviceType || "General",
      authNumber: formData.authNumber || null,
      status: formData.status,
      approvedUnits: formData.approvedUnits ? parseInt(formData.approvedUnits) : null,
      expirationDate: formData.expirationDate ? new Date(formData.expirationDate) : null,
      notes: formData.notes || null,
    });
  };

  const getStatusBadge = (auth: PriorAuth) => {
    const isExpired = auth.expirationDate && isPast(new Date(auth.expirationDate));
    const isExpiringSoon = auth.expirationDate && 
      differenceInDays(new Date(auth.expirationDate), new Date()) <= 7 &&
      differenceInDays(new Date(auth.expirationDate), new Date()) > 0;

    if (isExpired) {
      return (
        <Badge variant="outline" className="gap-1 bg-slate-50 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400 border-0">
          <XCircle className="h-3 w-3" />
          Expired
        </Badge>
      );
    }

    if (auth.status === "approved") {
      return (
        <Badge variant="outline" className={`gap-1 border-0 ${
          isExpiringSoon 
            ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
        }`}>
          {isExpiringSoon ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          {isExpiringSoon ? "Expiring Soon" : "Approved"}
        </Badge>
      );
    }

    if (auth.status === "denied") {
      return (
        <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0">
          <XCircle className="h-3 w-3" />
          Denied
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Prior Authorizations
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1"
            onClick={() => setCreateModalOpen(true)}
            data-testid="button-add-auth"
          >
            <Plus className="h-3 w-3" />
            Add Auth
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : auths && auths.length > 0 ? (
          <div className="space-y-4">
            {auths.map((auth) => (
              <div
                key={auth.id}
                className="border rounded-lg p-3 space-y-3"
                data-testid={`prior-auth-${auth.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(auth)}
                      {auth.authNumber && (
                        <span className="text-sm font-mono text-muted-foreground">
                          #{auth.authNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1">{auth.serviceType}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {auth.approvedUnits !== null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Units</p>
                      <p className="font-medium">
                        {auth.usedUnits || 0} / {auth.approvedUnits} used
                      </p>
                    </div>
                  )}
                  {auth.expirationDate && (
                    <div>
                      <p className="text-xs text-muted-foreground">Expires</p>
                      <p className="font-medium">
                        {format(new Date(auth.expirationDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  )}
                </div>

                {auth.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => updateAuthMutation.mutate({
                        id: auth.id,
                        updates: { status: "approved", approvedDate: new Date() }
                      })}
                      data-testid={`button-approve-${auth.id}`}
                    >
                      Mark Approved
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-600 dark:text-red-400"
                      onClick={() => updateAuthMutation.mutate({
                        id: auth.id,
                        updates: { status: "denied" }
                      })}
                      data-testid={`button-deny-${auth.id}`}
                    >
                      Mark Denied
                    </Button>
                  </div>
                )}

                {auth.denialReason && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Denial reason: {auth.denialReason}
                  </p>
                )}

                {auth.notes && (
                  <p className="text-xs text-muted-foreground">{auth.notes}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No prior authorizations</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1"
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus className="h-3 w-3" />
              Request Authorization
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Prior Authorization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payer</Label>
                <Input value={payer} disabled />
              </div>
              <div className="space-y-2">
                <Label>Service Type</Label>
                <Input value={serviceType || "General"} disabled />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData({ ...formData, status: v })}
              >
                <SelectTrigger data-testid="select-auth-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Auth Number (if approved)</Label>
                <Input
                  value={formData.authNumber}
                  onChange={(e) => setFormData({ ...formData, authNumber: e.target.value })}
                  placeholder="AUTH-12345"
                  data-testid="input-auth-number"
                />
              </div>
              <div className="space-y-2">
                <Label>Approved Units</Label>
                <Input
                  type="number"
                  value={formData.approvedUnits}
                  onChange={(e) => setFormData({ ...formData, approvedUnits: e.target.value })}
                  placeholder="10"
                  data-testid="input-approved-units"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Expiration Date</Label>
              <Input
                type="date"
                value={formData.expirationDate}
                onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                data-testid="input-expiration-date"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="textarea-auth-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateAuth}
              disabled={createAuthMutation.isPending}
              data-testid="button-submit-auth"
            >
              Create Authorization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
