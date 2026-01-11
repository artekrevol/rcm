import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Lead, InsertLead } from "@shared/schema";

const leadSources = ["website", "phone", "referral", "marketing", "social_media", "other"];
const priorities = ["P0", "P1", "P2"];

interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
  mode: "create" | "edit";
}

export function LeadFormDialog({ open, onOpenChange, lead, mode }: LeadFormDialogProps) {
  const { toast } = useToast();

  const [formData, setFormData] = useState<Partial<InsertLead>>({
    name: "",
    phone: "",
    email: "",
    source: "website",
    status: "new",
    state: "",
    preferredName: "",
    serviceNeeded: "",
    bestTimeToCall: "",
    notes: "",
    insuranceCarrier: "",
    memberId: "",
    planType: "",
    priority: "P2",
  });

  useEffect(() => {
    if (mode === "edit" && lead) {
      setFormData({
        name: lead.name || "",
        phone: lead.phone || "",
        email: lead.email || "",
        source: lead.source || "website",
        status: lead.status || "new",
        state: lead.state || "",
        preferredName: lead.preferredName || "",
        serviceNeeded: lead.serviceNeeded || "",
        bestTimeToCall: lead.bestTimeToCall || "",
        notes: lead.notes || "",
        insuranceCarrier: lead.insuranceCarrier || "",
        memberId: lead.memberId || "",
        planType: lead.planType || "",
        priority: lead.priority || "P2",
      });
    } else if (mode === "create") {
      setFormData({
        name: "",
        phone: "",
        email: "",
        source: "website",
        status: "new",
        state: "",
        preferredName: "",
        serviceNeeded: "",
        bestTimeToCall: "",
        notes: "",
        insuranceCarrier: "",
        memberId: "",
        planType: "",
        priority: "P2",
      });
    }
  }, [mode, lead, open]);

  const createMutation = useMutation({
    mutationFn: async (data: InsertLead) => {
      return apiRequest("POST", "/api/leads", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      onOpenChange(false);
      toast({ title: "Lead created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create lead", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Lead>) => {
      return apiRequest("PATCH", `/api/leads/${lead?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      onOpenChange(false);
      toast({ title: "Lead updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update lead", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!formData.name || !formData.phone) {
      toast({ title: "Please fill required fields", variant: "destructive" });
      return;
    }
    if (mode === "create") {
      createMutation.mutate(formData as InsertLead);
    } else {
      updateMutation.mutate(formData as Partial<Lead>);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create New Lead" : "Edit Lead"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "Add a new intake lead" : "Update lead information"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Smith"
                data-testid="input-lead-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preferredName">Preferred Name</Label>
              <Input
                id="preferredName"
                value={formData.preferredName || ""}
                onChange={(e) => setFormData({ ...formData, preferredName: e.target.value })}
                placeholder="Nickname"
                data-testid="input-lead-preferred-name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone *</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
                data-testid="input-lead-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
                data-testid="input-lead-email"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state || ""}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="TX, CA, NY..."
                data-testid="input-lead-state"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Select
                value={formData.source}
                onValueChange={(v) => setFormData({ ...formData, source: v })}
              >
                <SelectTrigger data-testid="select-lead-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leadSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={formData.priority || "P2"}
                onValueChange={(v) => setFormData({ ...formData, priority: v })}
              >
                <SelectTrigger data-testid="select-lead-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorities.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p === "P0" ? "P0 - Urgent" : p === "P1" ? "P1 - High" : "P2 - Normal"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="serviceNeeded">Service Needed</Label>
              <Select
                value={formData.serviceNeeded || ""}
                onValueChange={(v) => setFormData({ ...formData, serviceNeeded: v })}
              >
                <SelectTrigger data-testid="select-lead-service">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="detox">Detox</SelectItem>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="PHP">Partial Hospitalization (PHP)</SelectItem>
                  <SelectItem value="IOP">Intensive Outpatient (IOP)</SelectItem>
                  <SelectItem value="outpatient">Outpatient</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bestTimeToCall">Best Time to Call</Label>
              <Select
                value={formData.bestTimeToCall || ""}
                onValueChange={(v) => setFormData({ ...formData, bestTimeToCall: v })}
              >
                <SelectTrigger data-testid="select-lead-best-time">
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">Morning (8am-12pm)</SelectItem>
                  <SelectItem value="afternoon">Afternoon (12pm-5pm)</SelectItem>
                  <SelectItem value="evening">Evening (5pm-8pm)</SelectItem>
                  <SelectItem value="anytime">Anytime</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-medium mb-3">Insurance Information</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="insuranceCarrier">Insurance Carrier</Label>
                <Input
                  id="insuranceCarrier"
                  value={formData.insuranceCarrier || ""}
                  onChange={(e) => setFormData({ ...formData, insuranceCarrier: e.target.value })}
                  placeholder="Blue Cross, Aetna..."
                  data-testid="input-lead-insurance-carrier"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="memberId">Member ID</Label>
                <Input
                  id="memberId"
                  value={formData.memberId || ""}
                  onChange={(e) => setFormData({ ...formData, memberId: e.target.value })}
                  placeholder="Member ID"
                  data-testid="input-lead-member-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planType">Plan Type</Label>
                <Select
                  value={formData.planType || ""}
                  onValueChange={(v) => setFormData({ ...formData, planType: v })}
                >
                  <SelectTrigger data-testid="select-lead-plan-type">
                    <SelectValue placeholder="Select plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PPO">PPO</SelectItem>
                    <SelectItem value="HMO">HMO</SelectItem>
                    <SelectItem value="EPO">EPO</SelectItem>
                    <SelectItem value="POS">POS</SelectItem>
                    <SelectItem value="Medicare">Medicare</SelectItem>
                    <SelectItem value="Medicaid">Medicaid</SelectItem>
                    <SelectItem value="Self-Pay">Self-Pay</SelectItem>
                    <SelectItem value="Unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Internal notes about this lead"
              data-testid="input-lead-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="button-submit-lead">
            {mode === "create" ? "Create Lead" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
