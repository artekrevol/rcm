import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { CalendarDays, Clock, Loader2 } from "lucide-react";

interface ScheduleAppointmentDialogProps {
  leadId: string;
  leadName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScheduleAppointmentDialog({
  leadId,
  leadName,
  open,
  onOpenChange,
}: ScheduleAppointmentDialogProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [title, setTitle] = useState("Initial Consultation");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");

  const availableSlotsQuery = useQuery({
    queryKey: ["/api/availability/slots", selectedDate?.toISOString()],
    queryFn: async () => {
      if (!selectedDate) return [];
      const response = await fetch(`/api/availability/slots?date=${selectedDate.toISOString()}`);
      return response.json();
    },
    enabled: !!selectedDate,
  });

  const createAppointmentMutation = useMutation({
    mutationFn: async (data: { scheduledAt: string; title: string; description: string; duration: number }) => {
      return apiRequest("POST", `/api/leads/${leadId}/appointments`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Appointment scheduled successfully" });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to schedule appointment",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedDate(undefined);
    setSelectedTime("");
    setTitle("Initial Consultation");
    setDescription("");
    setDuration("30");
  };

  const handleSchedule = () => {
    if (!selectedDate || !selectedTime) {
      toast({ title: "Please select a date and time", variant: "destructive" });
      return;
    }

    createAppointmentMutation.mutate({
      scheduledAt: selectedTime,
      title,
      description,
      duration: parseInt(duration),
    });
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const availableSlots = availableSlotsQuery.data || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Schedule Appointment
          </DialogTitle>
          <DialogDescription>
            Schedule an appointment with {leadName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">Select Date</Label>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < today || date.getDay() === 0 || date.getDay() === 6}
              className="rounded-md border"
              data-testid="appointment-calendar"
            />
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Appointment Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Initial Consultation"
                data-testid="input-appointment-title"
              />
            </div>

            <div>
              <Label htmlFor="duration">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger data-testid="select-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="45">45 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="90">1.5 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                Available Times
              </Label>
              {!selectedDate ? (
                <p className="text-sm text-muted-foreground py-2">Select a date to see available times</p>
              ) : availableSlotsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading times...</span>
                </div>
              ) : availableSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No available times for this date</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 mt-2 max-h-[150px] overflow-y-auto">
                  {availableSlots.map((slot: { time: string; display: string }) => (
                    <Button
                      key={slot.time}
                      variant={selectedTime === slot.time ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedTime(slot.time)}
                      data-testid={`time-slot-${slot.display.replace(/\s/g, "-")}`}
                    >
                      {slot.display}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="description">Notes (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Any additional notes..."
                rows={2}
                data-testid="input-appointment-notes"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-appointment">
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={!selectedDate || !selectedTime || createAppointmentMutation.isPending}
            data-testid="button-confirm-appointment"
          >
            {createAppointmentMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <CalendarDays className="h-4 w-4 mr-2" />
                Schedule Appointment
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
