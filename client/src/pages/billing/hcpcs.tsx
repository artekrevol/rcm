import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search,
  Copy,
  ChevronRight,
  BookOpen,
  Plus,
  Loader2,
  Clock,
  MapPin,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface HcpcsResult {
  code: string;
  description_official: string;
  description_plain: string;
  unit_type: string;
  unit_interval_minutes: number | null;
  default_pos: string | null;
  requires_modifier: boolean;
  notes: string | null;
  va_rate: string | null;
}

function formatUnitType(unitType: string, intervalMinutes: number | null): string {
  switch (unitType) {
    case "time_based":
      return intervalMinutes ? `Time-based (${intervalMinutes} min intervals)` : "Time-based";
    case "per_visit":
      return "Per visit";
    case "per_diem":
      return "Per diem";
    case "quantity":
      return "Quantity";
    default:
      return unitType;
  }
}

function formatPOS(pos: string | null): string {
  if (!pos) return "N/A";
  const posMap: Record<string, string> = {
    "12": "Home (12)",
    "11": "Office (11)",
    "22": "Outpatient Hospital (22)",
    "31": "Skilled Nursing Facility (31)",
    "32": "Nursing Facility (32)",
    "99": "Other (99)",
  };
  return posMap[pos] || `POS ${pos}`;
}

function ManualEntryForm({ searchTerm, onClose }: { searchTerm: string; onClose: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState(searchTerm.toUpperCase());
  const [description, setDescription] = useState("");
  const [unitType, setUnitType] = useState("per_visit");
  const [intervalMinutes, setIntervalMinutes] = useState("");
  const [ratePerUnit, setRatePerUnit] = useState("");

  function handleSave() {
    if (!code.trim() || !description.trim()) {
      toast({ title: "Code and description are required", variant: "destructive" });
      return;
    }
    const pendingCode = {
      code: code.trim().toUpperCase(),
      description: description.trim(),
      unit_type: unitType,
      unit_interval_minutes: unitType === "time_based" ? Number(intervalMinutes) || null : null,
      rate_per_unit: ratePerUnit ? Number(ratePerUnit) : null,
      is_manual: true,
    };
    sessionStorage.setItem("pendingHcpcsCode", JSON.stringify(pendingCode));
    toast({ title: `Code ${pendingCode.code} saved`, description: "Ready to use in the claim wizard" });
    onClose();
  }

  return (
    <Card className="border-dashed border-2 border-muted-foreground/30" data-testid="card-manual-entry">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Enter Code Manually</h3>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-manual">
            Cancel
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="manual-code">Code</Label>
            <Input
              id="manual-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 97110"
              data-testid="input-manual-code"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-desc">Short Description</Label>
            <Input
              id="manual-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Therapeutic exercises"
              data-testid="input-manual-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unit Type</Label>
            <Select value={unitType} onValueChange={setUnitType}>
              <SelectTrigger data-testid="select-manual-unit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="time_based">Time-based</SelectItem>
                <SelectItem value="per_visit">Per visit</SelectItem>
                <SelectItem value="per_diem">Per diem</SelectItem>
                <SelectItem value="quantity">Quantity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {unitType === "time_based" && (
            <div className="space-y-1.5">
              <Label htmlFor="manual-interval">Interval (minutes)</Label>
              <Input
                id="manual-interval"
                type="number"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                placeholder="e.g. 15"
                data-testid="input-manual-interval"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="manual-rate">Rate per Unit ($)</Label>
            <Input
              id="manual-rate"
              type="number"
              step="0.01"
              value={ratePerUnit}
              onChange={(e) => setRatePerUnit(e.target.value)}
              placeholder="e.g. 14.25"
              data-testid="input-manual-rate"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} data-testid="button-save-manual">
            Save & Use in Claim
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CodeCard({ result }: { result: HcpcsResult }) {
  const { toast } = useToast();

  function copyCode() {
    navigator.clipboard.writeText(result.code);
    toast({
      title: `Code ${result.code} copied`,
      description: "Open a claim to use it",
    });
  }

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`card-hcpcs-${result.code}`}>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="font-mono text-sm px-2 py-0.5" data-testid={`badge-code-${result.code}`}>
                {result.code}
              </Badge>
              {result.requires_modifier && (
                <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Modifier Required
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium text-foreground mt-2" data-testid={`text-official-${result.code}`}>
              {result.description_official}
            </p>
          </div>
        </div>

        <div className="border-t pt-3">
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-plain-${result.code}`}>
            {result.description_plain}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Unit type:</span>
            <span className="font-medium">{formatUnitType(result.unit_type, result.unit_interval_minutes)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">VA rate (2025):</span>
            <span className="font-medium">
              {result.va_rate ? `$${Number(result.va_rate).toFixed(2)} / unit` : "N/A"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Place of service:</span>
            <span className="font-medium">{formatPOS(result.default_pos)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="default"
            size="sm"
            onClick={copyCode}
            className="gap-1.5"
            data-testid={`button-use-code-${result.code}`}
          >
            <Copy className="h-3.5 w-3.5" />
            Use this code
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          <Accordion type="single" collapsible className="w-auto">
            <AccordionItem value="details" className="border-none">
              <AccordionTrigger className="py-0 text-sm text-muted-foreground hover:text-foreground hover:no-underline gap-1" data-testid={`button-details-${result.code}`}>
                More details
              </AccordionTrigger>
              <AccordionContent className="pt-3 pb-1">
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Official Description:</span>
                    <p className="mt-0.5">{result.description_official}</p>
                  </div>
                  {result.notes && (
                    <div>
                      <span className="font-medium text-muted-foreground">Notes:</span>
                      <p className="mt-0.5">{result.notes}</p>
                    </div>
                  )}
                  <div className="flex gap-4 text-muted-foreground">
                    <span>Modifier required: {result.requires_modifier ? "Yes" : "No"}</span>
                    <span>Default POS: {result.default_pos || "N/A"}</span>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BillingHcpcs() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => setDebouncedSearch(value.trim()), 300);
    setDebounceTimer(t);
  }

  const { data: results = [], isLoading, isFetching } = useQuery<HcpcsResult[]>({
    queryKey: ["/api/billing/hcpcs/search", debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch) return [];
      const res = await fetch(`/api/billing/hcpcs/search?q=${encodeURIComponent(debouncedSearch)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedSearch.length > 0,
  });

  const hasSearched = debouncedSearch.length > 0 && !isLoading;
  const noResults = hasSearched && !isFetching && results.length === 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Code Lookup</h1>
        <p className="text-muted-foreground">Search HCPCS/CPT codes with payer-specific rates</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder='Search by code or description (e.g. G0299 or skilled nursing)'
          className="pl-10 h-12 text-base"
          data-testid="input-hcpcs-search"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground animate-spin" />
        )}
      </div>

      {!debouncedSearch && !showManualEntry && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <BookOpen className="h-12 w-12 mb-4 opacity-40" />
          <p className="text-lg font-medium">Search the Code Library</p>
          <p className="text-sm mt-1 max-w-md">
            Enter a code (like G0299) or description (like "skilled nursing") to find HCPCS codes with VA rates.
          </p>
        </div>
      )}

      {noResults && (
        <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="no-results">
          <p className="text-lg font-medium" data-testid="text-no-results">
            No results for "{debouncedSearch}"
          </p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            This may be a CPT code not in our library.
            You can still add it to a claim manually.
          </p>
          {!showManualEntry && (
            <Button
              variant="outline"
              className="mt-4 gap-2"
              onClick={() => setShowManualEntry(true)}
              data-testid="button-enter-manual"
            >
              <Plus className="h-4 w-4" />
              Enter code manually
            </Button>
          )}
        </div>
      )}

      {showManualEntry && (
        <ManualEntryForm
          searchTerm={debouncedSearch || search}
          onClose={() => setShowManualEntry(false)}
        />
      )}

      {results.length > 0 && (
        <div className="space-y-4" data-testid="search-results">
          <p className="text-sm text-muted-foreground" data-testid="text-result-count">
            {results.length} result{results.length !== 1 ? "s" : ""} for "{debouncedSearch}"
          </p>
          {results.map((result) => (
            <CodeCard key={result.code} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}
