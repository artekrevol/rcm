import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Search,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Download,
  Building2,
  Loader2,
  Clock,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Lead, Patient, VobVerification } from "@shared/schema";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

interface Payer {
  id: string;
  name: string;
  type?: string;
}

interface VobVerificationCardProps {
  lead: Lead;
  patient: Patient | null;
}

export function VobVerificationCard({ lead, patient }: VobVerificationCardProps) {
  const { toast } = useToast();
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [payerSearch, setPayerSearch] = useState("");
  const [selectedPayer, setSelectedPayer] = useState<Payer | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState(patient?.dob || "");
  const [memberId, setMemberId] = useState(patient?.memberId || lead.memberId || "");

  const debouncedPayerSearch = useDebounce(payerSearch, 300);
  const shouldSearchPayers = debouncedPayerSearch.length >= 2;

  const { data: verifications, isLoading: verificationsLoading } = useQuery<VobVerification[]>({
    queryKey: ["/api/leads", lead.id, "vob-verifications"],
  });

  const { data: verifytxStatus } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/verifytx/status"],
  });

  const { data: payers, isLoading: payersLoading } = useQuery<Payer[]>({
    queryKey: [`/api/verifytx/payers?q=${encodeURIComponent(debouncedPayerSearch)}`],
    enabled: verifyDialogOpen && verifytxStatus?.configured === true && shouldSearchPayers,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPayer) throw new Error("Please select a payer");
      if (!dateOfBirth) throw new Error("Date of birth is required");
      if (!memberId) throw new Error("Member ID is required");
      
      return apiRequest("POST", `/api/leads/${lead.id}/verify-insurance`, {
        payerId: selectedPayer.id,
        payerName: selectedPayer.name,
        dateOfBirth,
        memberId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id, "vob-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id, "activity"] });
      toast({ title: "Insurance verification started" });
      setVerifyDialogOpen(false);
      setSelectedPayer(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Verification failed", 
        description: error.message || "Unable to verify insurance",
        variant: "destructive" 
      });
    },
  });

  const exportPdfMutation = useMutation({
    mutationFn: async (verificationId: string) => {
      const response = await fetch(`/api/vob-verifications/${verificationId}/pdf`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to export PDF");
      }
      return response.json();
    },
    onSuccess: (data: { pdfUrl: string }) => {
      window.open(data.pdfUrl, "_blank");
      toast({ title: "PDF exported" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Export failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const reverifyMutation = useMutation({
    mutationFn: async (verificationId: string) => {
      return apiRequest("POST", `/api/vob-verifications/${verificationId}/reverify`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id, "vob-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id] });
      toast({ title: "Re-verification started" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Re-verification failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const latestVerification = verifications?.[0];
  const isVerified = latestVerification?.status === "verified";
  const isPending = latestVerification?.status === "pending";
  const hasError = latestVerification?.status === "error";

  if (verificationsLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Benefits Verification
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          <CardTitle className="text-sm font-medium">Benefits Verification</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {latestVerification?.verifytxVobId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => exportPdfMutation.mutate(latestVerification.id)}
              disabled={exportPdfMutation.isPending}
              data-testid="button-export-vob-pdf"
            >
              {exportPdfMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
          )}
          <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-7"
                disabled={!verifytxStatus?.configured}
                data-testid="button-verify-insurance"
              >
                <Shield className="h-3 w-3" />
                {latestVerification ? "Re-verify" : "Verify"}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Verify Insurance Benefits</DialogTitle>
                <DialogDescription>
                  Search and select the insurance payer, then verify benefits with VerifyTX.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="payer-search">Insurance Payer</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="payer-search"
                      placeholder="Search payers..."
                      value={payerSearch}
                      onChange={(e) => setPayerSearch(e.target.value)}
                      className="pl-9"
                      data-testid="input-payer-search"
                    />
                  </div>
                  
                  {selectedPayer ? (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span className="font-medium">{selectedPayer.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedPayer(null);
                          setPayerSearch("");
                        }}
                        data-testid="button-clear-payer"
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <ScrollArea className="h-48 border rounded-md">
                      {!shouldSearchPayers ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          Type at least 2 characters to search payers
                        </div>
                      ) : payersLoading ? (
                        <div className="p-4 space-y-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ) : payers && payers.length > 0 ? (
                        <div className="p-1">
                          {payers.slice(0, 20).map((payer) => (
                            <button
                              key={payer.id}
                              type="button"
                              className="w-full p-2 text-left rounded-md hover-elevate flex items-center gap-2"
                              onClick={() => setSelectedPayer(payer)}
                              data-testid={`button-select-payer-${payer.id}`}
                            >
                              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="text-sm truncate">{payer.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          {verifytxStatus?.configured 
                            ? "No payers found. Try a different search term."
                            : "VerifyTX is not configured. Add API credentials to search payers."}
                        </div>
                      )}
                    </ScrollArea>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dob">Date of Birth</Label>
                    <Input
                      id="dob"
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      data-testid="input-dob"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="member-id">Member ID</Label>
                    <Input
                      id="member-id"
                      value={memberId}
                      onChange={(e) => setMemberId(e.target.value)}
                      placeholder="Enter member ID"
                      data-testid="input-member-id"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setVerifyDialogOpen(false)}
                  data-testid="button-cancel-verify"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => verifyMutation.mutate()}
                  disabled={!selectedPayer || !dateOfBirth || !memberId || verifyMutation.isPending}
                  data-testid="button-submit-verify"
                >
                  {verifyMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Benefits"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      
      <CardContent>
        {!verifytxStatus?.configured && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">VerifyTX Not Configured</span>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
              Add VERIFYTX_API_KEY and VERIFYTX_API_SECRET to enable real-time insurance verification.
            </p>
          </div>
        )}

        {latestVerification ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {isVerified && (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Verified
                  </span>
                </>
              )}
              {isPending && (
                <>
                  <Clock className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    Pending
                  </span>
                </>
              )}
              {hasError && (
                <>
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    Error
                  </span>
                </>
              )}
              
              {latestVerification.networkStatus && (
                <Badge variant="outline" className="ml-auto text-xs">
                  {latestVerification.networkStatus === "in_network" ? "In-Network" : "Out-of-Network"}
                </Badge>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{latestVerification.payerName}</span>
              {latestVerification.verifiedAt && (
                <> verified {formatDistanceToNow(new Date(latestVerification.verifiedAt), { addSuffix: true })}</>
              )}
            </div>

            {isVerified && (
              <>
                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  {latestVerification.copay !== null && latestVerification.copay !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Copay</p>
                      <p className="text-sm font-semibold">${latestVerification.copay}</p>
                    </div>
                  )}
                  {latestVerification.coinsurance !== null && latestVerification.coinsurance !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Coinsurance</p>
                      <p className="text-sm font-semibold">{latestVerification.coinsurance}%</p>
                    </div>
                  )}
                  {latestVerification.deductible !== null && latestVerification.deductible !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Deductible</p>
                      <p className="text-sm font-semibold">
                        ${latestVerification.deductibleMet || 0} / ${latestVerification.deductible}
                      </p>
                    </div>
                  )}
                  {latestVerification.outOfPocketMax !== null && latestVerification.outOfPocketMax !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground">Out-of-Pocket Max</p>
                      <p className="text-sm font-semibold">
                        ${latestVerification.outOfPocketMet || 0} / ${latestVerification.outOfPocketMax}
                      </p>
                    </div>
                  )}
                </div>

                {latestVerification.priorAuthRequired && (
                  <div className="flex items-center gap-2 pt-2">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-sm text-amber-600 dark:text-amber-400">
                      Prior Authorization Required
                    </span>
                  </div>
                )}

                {(latestVerification.effectiveDate || latestVerification.termDate) && (
                  <div className="text-xs text-muted-foreground pt-2">
                    Coverage: {latestVerification.effectiveDate || "—"} to {latestVerification.termDate || "Ongoing"}
                  </div>
                )}
              </>
            )}

            {hasError && latestVerification.errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
                {latestVerification.errorMessage}
              </div>
            )}

            {latestVerification.verifytxVobId && isVerified && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => reverifyMutation.mutate(latestVerification.id)}
                  disabled={reverifyMutation.isPending}
                  data-testid="button-reverify"
                >
                  {reverifyMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Refresh Benefits
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Not yet verified</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click "Verify" to check insurance benefits with VerifyTX
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
