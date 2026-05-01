import { useState, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText, Plus, Play, CheckCircle2, XCircle, Clock, AlertCircle, AlertTriangle,
  ChevronDown, ChevronRight, ExternalLink, Trash2, RefreshCw, Pencil,
  BookOpen, Zap, Upload, Link2, Database, BarChart3, List, History,
  ShieldAlert, User, CalendarCheck, RotateCcw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// B1 stopgap: modifiers_and_liability added; "modifiers" kept as legacy alias handled by normalizeSectionType.
// B2 will do the full 15-kind rebuild.
type SectionType = "timely_filing" | "prior_auth" | "modifiers" | "modifiers_and_liability" | "appeals";

/** Map the legacy DB string "modifiers" → "modifiers_and_liability" so migrated rows render correctly. */
function normalizeSectionType(raw: string): SectionType {
  if (raw === "modifiers") return "modifiers_and_liability";
  return raw as SectionType;
}

type DocumentType = "admin_guide" | "supplement" | "pa_list" | "reimbursement_policy" | "medical_policy" | "bulletin" | "contract" | "fee_schedule";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  admin_guide: "Admin Guide",
  supplement: "Supplement",
  pa_list: "Prior Auth List",
  reimbursement_policy: "Reimbursement Policy",
  medical_policy: "Medical Policy",
  bulletin: "Bulletin",
  contract: "Contract",
  fee_schedule: "Fee Schedule",
};

const DOC_TYPE_COLORS: Record<DocumentType, string> = {
  admin_guide: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  supplement: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  pa_list: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  reimbursement_policy: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  medical_policy: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  bulletin: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  contract: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  fee_schedule: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

function docTypeBadge(type: string) {
  const label = DOC_TYPE_LABELS[type as DocumentType] || type;
  const cls = DOC_TYPE_COLORS[type as DocumentType] || "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}>{label}</span>;
}

const SECTION_LABELS: Record<SectionType, string> = {
  timely_filing: "Timely Filing",
  prior_auth: "Prior Authorization",
  modifiers: "Modifiers (legacy)",
  modifiers_and_liability: "Modifiers & Liability",
  appeals: "Appeals",
};

const SECTION_COLORS: Record<SectionType, string> = {
  timely_filing: "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800",
  prior_auth: "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
  modifiers: "bg-purple-50 border-purple-200 dark:bg-purple-950 dark:border-purple-800",
  modifiers_and_liability: "bg-purple-50 border-purple-200 dark:bg-purple-950 dark:border-purple-800",
  appeals: "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800",
};

const SECTION_BADGE: Record<SectionType, string> = {
  timely_filing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  prior_auth: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  modifiers: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  modifiers_and_liability: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  appeals: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    processing: { label: "Processing…", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
    ready_for_review: { label: "Ready for Review", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
    completed: { label: "Completed", cls: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    failed: { label: "Failed", cls: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  };
  const s = map[status] || { label: status, cls: "bg-muted text-muted-foreground" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function reviewStatusIcon(status: string) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "rejected") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (status === "not_found") return <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (status === "needs_reverification") return <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />;
  return <Clock className="h-4 w-4 text-amber-500 shrink-0" />;
}

function confidenceBadge(confidence: number | null) {
  if (!confidence) return null;
  const pct = Math.round(confidence * 100);
  const color = pct >= 90 ? "text-green-700 bg-green-50" : pct >= 70 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${color}`}>{pct}% confident</span>;
}

function formatExtractedJson(json: any, sectionType: string): ReactNode {
  if (!json) return null;
  const items: { label: string; value: string }[] = [];
  if (sectionType === "timely_filing") {
    if (json.days) items.push({ label: "Days to file", value: `${json.days} days from service date` });
    if (json.exceptions?.length) items.push({ label: "Exceptions", value: json.exceptions.join("; ") });
  } else if (sectionType === "prior_auth") {
    items.push({ label: "Auth required", value: json.requires_auth ? "Yes" : "No" });
    if (json.criteria) items.push({ label: "Criteria", value: json.criteria });
    if (json.cpt_codes?.length) items.push({ label: "Codes", value: json.cpt_codes.join(", ") });
    if (json.threshold_units) items.push({ label: "Threshold", value: `After ${json.threshold_units} units/visits` });
  } else if (sectionType === "modifiers" || sectionType === "modifiers_and_liability") {
    if (json.modifier_code) items.push({ label: "Modifier", value: json.modifier_code });
    if (json.description) items.push({ label: "Description", value: json.description });
    if (json.liability_assignment) items.push({ label: "Liability", value: json.liability_assignment });
    if (json.conditions_required?.length) items.push({ label: "Conditions required", value: json.conditions_required.join("; ") });
    if (json.conditions_excluded?.length) items.push({ label: "Conditions excluded", value: json.conditions_excluded.join("; ") });
    if (json.payer_rule) items.push({ label: "Payer rule", value: json.payer_rule });
    if (json.appeal_path_if_denied) items.push({ label: "Appeal path if denied", value: json.appeal_path_if_denied });
  } else if (sectionType === "appeals") {
    if (json.deadline_days) items.push({ label: "Deadline", value: `${json.deadline_days} days` });
    if (json.level) items.push({ label: "Level", value: json.level });
    if (json.submission_method) items.push({ label: "Method", value: json.submission_method });
    if (json.requirements?.length) items.push({ label: "Requirements", value: json.requirements.join("; ") });
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {items.map((i) => (
        <>
          <dt key={i.label + "-k"} className="font-medium text-muted-foreground whitespace-nowrap">{i.label}:</dt>
          <dd key={i.label + "-v"} className="text-foreground">{i.value}</dd>
        </>
      ))}
    </dl>
  );
}

// ─── Structured JSON editor per section type ─────────────────────────────────

function JsonEditor({ sectionType, value, onChange }: { sectionType: SectionType; value: any; onChange: (v: any) => void }) {
  if (!value) return null;
  if (sectionType === "timely_filing") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Days to file</Label>
          <Input
            type="number"
            value={value.days ?? ""}
            onChange={(e) => onChange({ ...value, days: Number(e.target.value) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-days"
          />
        </div>
        <div>
          <Label className="text-xs">Exceptions (comma-separated)</Label>
          <Input
            value={(value.exceptions || []).join(", ")}
            onChange={(e) => onChange({ ...value, exceptions: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-exceptions"
          />
        </div>
      </div>
    );
  }
  if (sectionType === "prior_auth") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Auth required</Label>
          <Switch
            checked={!!value.requires_auth}
            onCheckedChange={(v) => onChange({ ...value, requires_auth: v })}
            data-testid="switch-edit-requires-auth"
          />
        </div>
        <div>
          <Label className="text-xs">Criteria</Label>
          <Textarea
            value={value.criteria || ""}
            onChange={(e) => onChange({ ...value, criteria: e.target.value })}
            className="text-xs mt-0.5"
            rows={2}
            data-testid="textarea-edit-criteria"
          />
        </div>
        <div>
          <Label className="text-xs">CPT/HCPCS codes (comma-separated)</Label>
          <Input
            value={(value.cpt_codes || []).join(", ")}
            onChange={(e) => onChange({ ...value, cpt_codes: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-cpt-codes"
          />
        </div>
        <div>
          <Label className="text-xs">Threshold units</Label>
          <Input
            type="number"
            value={value.threshold_units ?? ""}
            onChange={(e) => onChange({ ...value, threshold_units: e.target.value ? Number(e.target.value) : null })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-threshold"
          />
        </div>
      </div>
    );
  }
  if (sectionType === "modifiers" || sectionType === "modifiers_and_liability") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Modifier code</Label>
          <Input
            value={value.modifier_code || ""}
            onChange={(e) => onChange({ ...value, modifier_code: e.target.value })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-modifier-code"
          />
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Input
            value={value.description || ""}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-description"
          />
        </div>
        <div>
          <Label className="text-xs">Liability assignment</Label>
          <Input
            value={value.liability_assignment || ""}
            onChange={(e) => onChange({ ...value, liability_assignment: e.target.value })}
            className="h-7 text-xs mt-0.5"
            placeholder="member | provider | payer"
            data-testid="input-edit-liability-assignment"
          />
        </div>
        <div>
          <Label className="text-xs">Conditions required (comma-separated)</Label>
          <Input
            value={(value.conditions_required || []).join(", ")}
            onChange={(e) => onChange({ ...value, conditions_required: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-conditions-required"
          />
        </div>
        <div>
          <Label className="text-xs">Conditions excluded (comma-separated)</Label>
          <Input
            value={(value.conditions_excluded || []).join(", ")}
            onChange={(e) => onChange({ ...value, conditions_excluded: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-conditions-excluded"
          />
        </div>
        <div>
          <Label className="text-xs">Payer rule</Label>
          <Textarea
            value={value.payer_rule || ""}
            onChange={(e) => onChange({ ...value, payer_rule: e.target.value })}
            className="text-xs mt-0.5"
            rows={2}
            data-testid="textarea-edit-payer-rule"
          />
        </div>
        <div>
          <Label className="text-xs">Appeal path if denied</Label>
          <Input
            value={value.appeal_path_if_denied || ""}
            onChange={(e) => onChange({ ...value, appeal_path_if_denied: e.target.value })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-appeal-path"
          />
        </div>
      </div>
    );
  }
  if (sectionType === "appeals") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Deadline (days)</Label>
          <Input
            type="number"
            value={value.deadline_days ?? ""}
            onChange={(e) => onChange({ ...value, deadline_days: Number(e.target.value) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-deadline"
          />
        </div>
        <div>
          <Label className="text-xs">Level</Label>
          <Input
            value={value.level || ""}
            onChange={(e) => onChange({ ...value, level: e.target.value })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-level"
          />
        </div>
        <div>
          <Label className="text-xs">Submission method</Label>
          <Input
            value={value.submission_method || ""}
            onChange={(e) => onChange({ ...value, submission_method: e.target.value })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-submission-method"
          />
        </div>
        <div>
          <Label className="text-xs">Requirements (comma-separated)</Label>
          <Input
            value={(value.requirements || []).join(", ")}
            onChange={(e) => onChange({ ...value, requirements: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
            className="h-7 text-xs mt-0.5"
            data-testid="input-edit-requirements"
          />
        </div>
      </div>
    );
  }
  return null;
}

interface ExtractionItem {
  id: string;
  source_document_id: string;
  section_type: SectionType;
  raw_snippet: string | null;
  extracted_json: any;
  confidence: number | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_rule_id: string | null;
  notes: string | null;
  applies_to_plan_products: string[] | null;
}

const PLAN_PRODUCT_OPTIONS = ["HMO", "PPO", "POS", "EPO", "Indemnity"] as const;

interface PayerManual {
  id: string;
  payer_id: string | null;
  payer_name: string;
  source_url: string | null;
  file_name: string | null;
  status: string;
  error_message: string | null;
  uploaded_by: string | null;
  created_at: string;
  document_type: DocumentType;
  parent_document_id: string | null;
  parent_document_name: string | null;
  effective_start: string | null;
  effective_end: string | null;
  item_count: number;
  approved_count: number;
  rejected_count: number;
  pending_count: number;
  supplement_count: number;
  document_type_label: string | null;
}

type ReviewPayload = { itemId: string; reviewStatus: string; notes?: string; extractedJson?: any; appliesToPlanProducts?: string[] };

interface PayerCoverageRow {
  source_id: string;
  payer_name: string;
  priority: number;
  canonical_url: string | null;
  notes: string | null;
  last_verified_date: string | null;
  linked_manual_id: string | null;
  linked_source_document_id: string | null;
  linked_document_name: string | null;
  manual_status: string | null;
  manual_ingested_at: string | null;
  manual_payer_id: string | null;
  timely_filing: boolean;
  timely_filing_reviewed: boolean;
  prior_auth: boolean;
  prior_auth_reviewed: boolean;
  modifiers: boolean;
  modifiers_reviewed: boolean;
  appeals: boolean;
  appeals_reviewed: boolean;
}

interface CoverageData {
  summary: {
    total_sources: number;
    ingested_count: number;
    timely_filing_pct: number;
    timely_filing_reviewed_pct: number;
    prior_auth_pct: number;
    prior_auth_reviewed_pct: number;
    modifiers_pct: number;
    modifiers_reviewed_pct: number;
    appeals_pct: number;
    appeals_reviewed_pct: number;
  };
  payers: PayerCoverageRow[];
}

interface ValidationResult {
  run_at: string;
  reference_table: Array<{ payer_type: string; label: string; standard_days: number; min_acceptable: number; max_acceptable: number; fixed: boolean; regulatory_source: string }>;
  summary: { total_manuals_checked: number; passed_manuals: number; flagged_manuals: number; discrepancy_count: number };
  discrepancies: Array<{ manual_id: string; payer_name: string; item_id?: string; issue: string; detail: string; severity: string; extracted_days: number | null; expected_hint: any }>;
  passed: Array<{ manual_id: string; payer_name: string; review_status: string; extracted_days: number | null }>;
}

function coverageDot(approved: boolean, reviewed: boolean, label: string) {
  const title = approved ? `${label}: Approved` : reviewed ? `${label}: Reviewed (not found in public manual)` : `${label}: Not yet reviewed`;
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold ${
        approved
          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
          : reviewed
          ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {approved ? "✓" : reviewed ? "○" : "—"}
    </span>
  );
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  edited: "Edited",
  data_corrected: "Data Corrected",
  reopened: "Re-opened",
  needs_reverification: "Flagged for Re-verification",
  created: "Created",
};

function ExtractionItemCard({ item, onReview }: { item: ExtractionItem; onReview: (p: ReviewPayload) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [notes, setNotes] = useState(item.notes || "");
  const [editedJson, setEditedJson] = useState<any>(item.extracted_json ? { ...item.extracted_json } : null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    item.applies_to_plan_products && !item.applies_to_plan_products.includes("all")
      ? item.applies_to_plan_products
      : []
  );
  const [showHistory, setShowHistory] = useState(false);
  const { toast } = useToast();

  const { data: itemHistory = [], isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/extraction-items", item.id, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/extraction-items/${item.id}/history`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showHistory,
  });

  const reverifyMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/extraction-items/${item.id}/reverify`, {}),
    onSuccess: () => {
      toast({ title: "Flagged for re-verification" });
    },
  });

  const isPending = item.review_status === "pending";
  const isNotFound = item.review_status === "not_found";

  function toggleProduct(product: string) {
    setSelectedProducts(prev =>
      prev.includes(product) ? prev.filter(p => p !== product) : [...prev, product]
    );
  }

  function getAppliesToPlanProducts(): string[] {
    return selectedProducts.length === 0 ? ["all"] : selectedProducts;
  }

  function handleApprove() {
    onReview({
      itemId: item.id,
      reviewStatus: "approved",
      notes: notes || undefined,
      extractedJson: editMode && editedJson ? editedJson : undefined,
      appliesToPlanProducts: getAppliesToPlanProducts(),
    });
  }

  function handleReject() {
    onReview({ itemId: item.id, reviewStatus: "rejected", notes: notes || undefined });
  }

  function handleNotFound() {
    onReview({ itemId: item.id, reviewStatus: "not_found", notes: notes || "Section not found in public manual — confirmed absent by reviewer" });
  }

  function handleReopenToPending() {
    onReview({ itemId: item.id, reviewStatus: "pending", notes: "Re-opened for re-review" });
  }

  const normalizedType = normalizeSectionType(item.section_type);
  return (
    <div className={`rounded-lg border p-3 ${SECTION_COLORS[normalizedType] || "bg-muted"}`} data-testid={`card-extraction-${item.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {reviewStatusIcon(item.review_status)}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SECTION_BADGE[normalizedType] || ""}`}>
            {SECTION_LABELS[normalizedType] || item.section_type}
          </span>
          {confidenceBadge(item.confidence)}
          {item.applied_rule_id && (
            <span className="text-xs text-green-700 dark:text-green-400">→ Rule applied</span>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground" data-testid={`button-expand-${item.id}`}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Structured fields — show edit form if in edit mode, else read-only view */}
      {item.extracted_json && !editMode && (
        <div className="mt-2">
          {formatExtractedJson(item.extracted_json, normalizedType)}
        </div>
      )}
      {editMode && editedJson && (
        <div className="mt-2 bg-background/60 rounded p-2 border border-dashed">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Editing extracted fields:</p>
          <JsonEditor sectionType={normalizedType} value={editedJson} onChange={setEditedJson} />
        </div>
      )}
      {(editMode || isPending) && (
        <div className="mt-2 bg-background/40 rounded p-2 border border-dashed">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Plan products this rule applies to:</p>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selectedProducts.length === 0}
                onChange={() => setSelectedProducts([])}
                data-testid={`checkbox-plan-all-${item.id}`}
              />
              All
            </label>
            {PLAN_PRODUCT_OPTIONS.map((prod) => (
              <label key={prod} className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedProducts.includes(prod)}
                  onChange={() => toggleProduct(prod)}
                  disabled={selectedProducts.length === 0 && false}
                  data-testid={`checkbox-plan-${prod}-${item.id}`}
                />
                {prod}
              </label>
            ))}
          </div>
          {selectedProducts.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Rule applies only to: {selectedProducts.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Not found / error notes */}
      {!item.extracted_json && item.notes && (
        <p className="text-xs text-muted-foreground mt-1 italic">{item.notes}</p>
      )}

      {/* Expanded: raw snippet + notes edit */}
      {expanded && (
        <div className="mt-3 space-y-2">
          {item.raw_snippet && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Source text:</p>
              <p className="text-xs bg-background/60 rounded p-2 text-foreground leading-relaxed">{item.raw_snippet}</p>
            </div>
          )}
          {(isPending || editMode) && (
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs mt-1"
                rows={2}
                data-testid={`input-notes-${item.id}`}
              />
            </div>
          )}
          {item.reviewed_by && (
            <p className="text-xs text-muted-foreground">
              Reviewed by {item.reviewed_by}{item.reviewed_at ? ` on ${format(new Date(item.reviewed_at), "MMM d, yyyy")}` : ""}
            </p>
          )}
        </div>
      )}

      {/* Provenance panel (approved items) */}
      {item.review_status === "approved" && (
        <div className="mt-2 px-2 py-1.5 bg-background/50 rounded border border-dashed flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {item.reviewed_by && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {item.reviewed_by}
            </span>
          )}
          {(item as any).last_verified_at && (
            <span className="flex items-center gap-1">
              <CalendarCheck className="h-3 w-3" />
              Verified {formatDistanceToNow(new Date((item as any).last_verified_at), { addSuffix: true })}
            </span>
          )}
          {(item as any).needs_reverification && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
              <ShieldAlert className="h-3 w-3" /> Needs re-verification
            </span>
          )}
          <button
            className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => setShowHistory(true)}
            data-testid={`button-history-${item.id}`}
          >
            <History className="h-3 w-3" /> Rule history
          </button>
          {item.review_status === "approved" && !(item as any).needs_reverification && (
            <button
              className="flex items-center gap-1 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              onClick={() => reverifyMutation.mutate()}
              disabled={reverifyMutation.isPending}
              data-testid={`button-reverify-${item.id}`}
            >
              <RotateCcw className="h-3 w-3" />
              {reverifyMutation.isPending ? "Flagging…" : "Flag for re-verify"}
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      {isPending && !isNotFound && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={handleApprove}
            data-testid={`button-approve-${item.id}`}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> {editMode ? "Save & Approve" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
            onClick={handleReject}
            data-testid={`button-reject-${item.id}`}
          >
            <XCircle className="h-3 w-3 mr-1" /> Reject
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800"
            onClick={handleNotFound}
            data-testid={`button-not-found-${item.id}`}
            title="Confirm this section is genuinely absent from the public manual"
          >
            <AlertCircle className="h-3 w-3 mr-1" /> Not in Manual
          </Button>
          {item.extracted_json && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setEditMode(!editMode);
                if (!editMode) setEditedJson({ ...item.extracted_json });
                setExpanded(true);
              }}
              data-testid={`button-edit-${item.id}`}
            >
              <Pencil className="h-3 w-3 mr-1" /> {editMode ? "Cancel edit" : "Edit fields"}
            </Button>
          )}
        </div>
      )}
      {item.review_status === "rejected" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-red-600 font-medium">Rejected —</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleReopenToPending}
            data-testid={`button-reopen-${item.id}`}
            title="Re-open this item for re-review"
          >
            Re-open for Review
          </Button>
        </div>
      )}

      {/* Rule History Dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-lg" data-testid={`dialog-history-${item.id}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" />
              Rule History — {SECTION_LABELS[normalizedType] || item.section_type}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {historyLoading ? (
              <div className="flex justify-center py-6"><span className="text-sm text-muted-foreground">Loading history…</span></div>
            ) : itemHistory.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No change history recorded for this rule yet.</div>
            ) : (
              itemHistory.map((h: any, i: number) => (
                <div key={h.id || i} className="flex items-start gap-3 py-2 border-b last:border-0" data-testid={`history-entry-${i}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                        h.change_type === "approved" ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" :
                        h.change_type === "rejected" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" :
                        h.change_type === "edited" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" :
                        h.change_type === "needs_reverification" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {CHANGE_TYPE_LABELS[h.change_type] || h.change_type}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="h-3 w-3" />{h.changed_by}
                      </span>
                    </div>
                    {h.change_notes && (
                      <p className="text-xs text-muted-foreground italic mt-0.5">"{h.change_notes}"</p>
                    )}
                    {h.snapshot_json && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{JSON.stringify(h.snapshot_json)}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0" title={h.changed_at ? format(new Date(h.changed_at), "PPpp") : ""}>
                    {h.changed_at ? formatDistanceToNow(new Date(h.changed_at), { addSuffix: true }) : ""}
                  </span>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowHistory(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const P4_SOURCE_PAYER_KEYWORDS: Record<string, string> = {
  "pms-001": "unitedhealth", "pms-002": "blue cross", "pms-003": "cigna",
  "pms-004": "humana",       "pms-005": "aetna",      "pms-006": "wellcare",
  "pms-007": "molina",       "pms-008": "anthem",     "pms-009": "kaiser",
  "pms-010": "health net",   "pms-011": "amerihealth","pms-012": "tufts",
  "pms-013": "hcsc",         "pms-014": "highmark",   "pms-015": "capital blue",
  "pms-016": "medica",       "pms-017": "priority health","pms-018": "independence blue",
  "pms-019": "oscar",        "pms-020": "bright health",
};

export default function PayerManualsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedManualId, setSelectedManualId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("manuals");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMode, setAddMode] = useState<"url" | "file">("url");
  const [addForm, setAddForm] = useState({
    payerName: "", payerId: "", sourceUrl: "",
    documentType: "admin_guide" as DocumentType,
    parentDocumentId: "",
    effectiveStart: "",
    effectiveEnd: "",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filterSection, setFilterSection] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDocType, setFilterDocType] = useState<string>("all");

  const { data: manuals = [], isLoading } = useQuery<PayerManual[]>({
    queryKey: ["/api/admin/payer-manuals"],
  });

  const { data: payers = [] } = useQuery<any[]>({
    queryKey: ["/api/billing/payers"],
  });

  const { data: coverageData, isLoading: coverageLoading } = useQuery<CoverageData>({
    queryKey: ["/api/admin/payer-manual-coverage"],
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery<ExtractionItem[]>({
    queryKey: ["/api/admin/payer-manuals", selectedManualId, "items"],
    queryFn: async () => {
      if (!selectedManualId) return [];
      const res = await fetch(`/api/admin/payer-manuals/${selectedManualId}/items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: !!selectedManualId,
  });

  const { data: cciStats = [], refetch: refetchCciStats } = useQuery<any[]>({
    queryKey: ["/api/admin/cci/stats"],
    enabled: activeTab === "cci",
  });

  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);

  // CCI tab state
  const [cciSearchCode, setCciSearchCode] = useState("");
  const [cciSearchResults, setCciSearchResults] = useState<any[]>([]);
  const [cciSearchLoading, setCciSearchLoading] = useState(false);
  const [cciUploadFile, setCciUploadFile] = useState<File | null>(null);
  const [cciVersion, setCciVersion] = useState("");
  const [cciUploading, setCciUploading] = useState(false);
  const [cciIngestRunning, setCciIngestRunning] = useState(false);
  const cciFileRef = useRef<HTMLInputElement>(null);

  const addMutation = useMutation({
    mutationFn: async () => {
      const commonFields = {
        documentType: addForm.documentType,
        parentDocumentId: addForm.parentDocumentId || undefined,
        effectiveStart: addForm.effectiveStart || undefined,
        effectiveEnd: addForm.effectiveEnd || undefined,
      };
      if (addMode === "file" && uploadFile) {
        const fd = new FormData();
        fd.append("payerName", addForm.payerName);
        if (addForm.payerId) fd.append("payerId", addForm.payerId);
        fd.append("file", uploadFile);
        fd.append("documentType", commonFields.documentType);
        if (commonFields.parentDocumentId) fd.append("parentDocumentId", commonFields.parentDocumentId);
        if (commonFields.effectiveStart) fd.append("effectiveStart", commonFields.effectiveStart);
        if (commonFields.effectiveEnd) fd.append("effectiveEnd", commonFields.effectiveEnd);
        const res = await fetch("/api/admin/payer-manuals", { method: "POST", body: fd, credentials: "include" });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
        return res.json();
      } else {
        const res = await fetch("/api/admin/payer-manuals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ payerName: addForm.payerName, payerId: addForm.payerId, sourceUrl: addForm.sourceUrl, ...commonFields }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
        return res.json();
      }
    },
    onSuccess: async (manual) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manual-coverage"] });
      if (pendingSourceId) {
        try {
          const linkRes = await fetch(`/api/admin/payer-manual-sources/${pendingSourceId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ linkedManualId: manual.id }),
          });
          if (!linkRes.ok) {
            console.warn(`[SourceLink] PATCH failed for source ${pendingSourceId}: HTTP ${linkRes.status}`);
            toast({ title: "Manual added", description: "Manual created, but source registry link could not be saved. Refresh the Source Registry to re-link manually.", variant: "destructive" });
          } else {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manual-sources"] });
            toast({ title: "Manual added", description: "Click 'Run Extraction' to start AI processing." });
          }
        } catch (e: any) {
          console.warn(`[SourceLink] PATCH error for source ${pendingSourceId}:`, e.message);
          toast({ title: "Manual added", description: "Manual created, but source registry link could not be saved. Refresh the Source Registry to re-link manually.", variant: "destructive" });
        }
        setPendingSourceId(null);
      } else {
        toast({ title: "Manual added", description: "Click 'Run Extraction' to start AI processing." });
      }
      setShowAddDialog(false);
      setAddForm({ payerName: "", payerId: "", sourceUrl: "", documentType: "admin_guide", parentDocumentId: "", effectiveStart: "", effectiveEnd: "" });
      setUploadFile(null);
      setSelectedManualId(manual.id);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  async function runValidationSweep() {
    setValidationLoading(true);
    try {
      const res = await fetch("/api/admin/payer-manual-coverage/validate", { credentials: "include" });
      if (!res.ok) throw new Error("Validation sweep failed");
      setValidationResult(await res.json());
    } catch (e: any) {
      toast({ title: "Validation sweep failed", description: e.message, variant: "destructive" });
    } finally {
      setValidationLoading(false);
    }
  }

  function openIngestFromSource(source: PayerCoverageRow) {
    const keyword = P4_SOURCE_PAYER_KEYWORDS[source.source_id];
    let matched: any = null;
    if (keyword) {
      matched = payers.find((p: any) => (p.name || "").toLowerCase().includes(keyword));
    }
    if (!matched) {
      const srcLower = (source.payer_name || "").toLowerCase();
      matched = payers.find((p: any) => {
        const pLower = (p.name || "").toLowerCase();
        return srcLower.split(/[\s\/\(\),]+/).filter((t: string) => t.length > 3).some((t: string) => pLower.includes(t));
      }) ?? null;
    }
    setAddForm({ payerName: source.payer_name, payerId: matched?.id ?? "", sourceUrl: source.canonical_url || "", documentType: "admin_guide", parentDocumentId: "", effectiveStart: "", effectiveEnd: "" });
    setAddMode("url");
    setUploadFile(null);
    setPendingSourceId(source.source_id);
    setShowAddDialog(true);
  }

  const processMutation = useMutation({
    mutationFn: async (manualId: string) => {
      const res = await fetch(`/api/admin/payer-manuals/${manualId}/process`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: "{}",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manuals"] });
      toast({ title: "Extraction started", description: "Refresh in a minute to see extracted rules." });
    },
    onError: (err: any) => toast({ title: "Extraction failed", description: err.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ itemId, reviewStatus, notes, extractedJson, appliesToPlanProducts }: ReviewPayload) => {
      const res = await fetch(`/api/admin/payer-manual-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reviewStatus, notes, extractedJson, appliesToPlanProducts }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manuals", selectedManualId, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manual-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manual-sources"] });
      if (data?.sideEffectErrors?.length) {
        toast({
          title: "Approved with warnings",
          description: `Rule was approved but some downstream writes had issues: ${data.sideEffectErrors[0]}`,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => toast({ title: "Review failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (manualId: string) => {
      const res = await fetch(`/api/admin/payer-manuals/${manualId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manual-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manual-sources"] });
      setSelectedManualId(null);
      toast({ title: "Manual deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const selectedManual = manuals.find((m) => m.id === selectedManualId);

  const filteredItems = items.filter((item) => {
    if (filterSection !== "all" && normalizeSectionType(item.section_type) !== filterSection) return false;
    if (filterStatus !== "all" && item.review_status !== filterStatus) return false;
    return true;
  });

  const sectionTypes: SectionType[] = ["timely_filing", "prior_auth", "modifiers_and_liability", "appeals"];

  const canAdd = addForm.payerName && (addMode === "url" ? !!addForm.sourceUrl : !!uploadFile)
    && (addForm.documentType === "supplement" ? !!addForm.parentDocumentId : true);
  const summary = coverageData?.summary;
  const coveragePayers = coverageData?.payers || [];
  const lastIngested = coveragePayers
    .filter((p) => p.manual_ingested_at)
    .sort((a, b) => new Date(b.manual_ingested_at!).getTime() - new Date(a.manual_ingested_at!).getTime())[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <BookOpen className="h-6 w-6 text-primary" />
            Provider Guide Ingestion
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Ingest and extract billing rules from payer source documents — admin guides, supplements, PA lists, policies, and more.
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-manual">
          <Plus className="h-4 w-4 mr-2" />
          Add Source Document
        </Button>
      </div>

      {/* Manual Coverage Dashboard Widget */}
      <Card data-testid="card-coverage-dashboard">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Manual Coverage
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Ingestion progress across top 20 commercial payers
                {lastIngested?.manual_ingested_at && (
                  <> · Last updated {format(new Date(lastIngested.manual_ingested_at), "MMM d, yyyy")}</>
                )}
              </CardDescription>
            </div>
            {coverageLoading && <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="sm:col-span-2 rounded-lg bg-muted/50 p-3" data-testid="stat-ingested-count">
              <p className="text-xs text-muted-foreground">Payers Ingested</p>
              <p className="text-2xl font-bold mt-0.5">
                {summary?.ingested_count ?? 0}
                <span className="text-sm font-normal text-muted-foreground">/{summary?.total_sources ?? 20}</span>
              </p>
            </div>
            {(["timely_filing", "prior_auth", "modifiers", "appeals"] as const).map((st) => {
              const approvedPct = summary ? (summary[`${st}_pct` as keyof typeof summary] as number ?? 0) : 0;
              const reviewedPct = summary ? (summary[`${st}_reviewed_pct` as keyof typeof summary] as number ?? 0) : 0;
              return (
                <div key={st} className="rounded-lg bg-muted/50 p-3" data-testid={`stat-coverage-${st}`}>
                  <p className="text-xs text-muted-foreground">{SECTION_LABELS[st]}</p>
                  <p className="text-xl font-semibold mt-0.5">{approvedPct}<span className="text-sm font-normal text-muted-foreground">%</span></p>
                  {reviewedPct > approvedPct && (
                    <p className="text-xs text-muted-foreground mt-0.5" title="Approved + not_found">
                      {reviewedPct}% reviewed
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Payer-by-payer status table */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="w-6 text-xs py-2">#</TableHead>
                  <TableHead className="text-xs py-2">Payer</TableHead>
                  <TableHead className="text-xs py-2 text-center">Status</TableHead>
                  <TableHead className="text-xs py-2 text-center">TF</TableHead>
                  <TableHead className="text-xs py-2 text-center">PA</TableHead>
                  <TableHead className="text-xs py-2 text-center">Mod</TableHead>
                  <TableHead className="text-xs py-2 text-center">Appeals</TableHead>
                  <TableHead className="text-xs py-2 text-right">Ingested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coveragePayers.length === 0 && !coverageLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                      No coverage data yet
                    </TableCell>
                  </TableRow>
                )}
                {coveragePayers.map((p) => (
                  <TableRow key={p.source_id} data-testid={`row-coverage-${p.source_id}`}>
                    <TableCell className="text-xs text-muted-foreground py-2">{p.priority}</TableCell>
                    <TableCell className="text-sm font-medium py-2 max-w-[180px] truncate" title={p.payer_name}>
                      {p.payer_name}
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      {p.linked_manual_id ? (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                          p.manual_status === "completed" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                          p.manual_status === "ready_for_review" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                          p.manual_status === "processing" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {p.manual_status === "completed" ? "Ingested" :
                           p.manual_status === "ready_for_review" ? "Review" :
                           p.manual_status === "processing" ? "Processing" : p.manual_status || "Pending"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-center">{coverageDot(p.timely_filing, p.timely_filing_reviewed, "Timely Filing")}</TableCell>
                    <TableCell className="py-2 text-center">{coverageDot(p.prior_auth, p.prior_auth_reviewed, "Prior Auth")}</TableCell>
                    <TableCell className="py-2 text-center">{coverageDot(p.modifiers, p.modifiers_reviewed, "Modifiers")}</TableCell>
                    <TableCell className="py-2 text-center">{coverageDot(p.appeals, p.appeals_reviewed, "Appeals")}</TableCell>
                    <TableCell className="py-2 text-right text-xs text-muted-foreground">
                      {p.manual_ingested_at ? format(new Date(p.manual_ingested_at), "MMM d, yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">TF = Timely Filing · PA = Prior Authorization · Mod = Modifiers · ✓ = approved · ○ = reviewed (not found in public manual)</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0 ml-4"
              onClick={runValidationSweep}
              disabled={validationLoading}
              data-testid="button-validation-sweep"
            >
              {validationLoading ? <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1.5" />}
              CMS Validation Sweep
            </Button>
          </div>

          {/* Validation Sweep Results */}
          {validationResult && (
            <div className="border rounded-lg p-4 space-y-3" data-testid="panel-validation-results">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">CMS Timely Filing Validation Sweep</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {validationResult.run_at ? `Run at ${format(new Date(validationResult.run_at), "MMM d, yyyy h:mm a")} · ` : ""}
                    {validationResult.summary?.total_manuals_checked ?? 0} manuals checked ·
                    {" "}{validationResult.summary?.passed_manuals ?? 0} manuals passed ·
                    {" "}{validationResult.summary?.discrepancy_count ?? 0} discrepanc{(validationResult.summary?.discrepancy_count ?? 0) === 1 ? "y" : "ies"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setValidationResult(null)}>
                  Dismiss
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sources: {(validationResult.reference_table || []).map(r => r.regulatory_source).join(" · ")}
              </p>
              {(validationResult.discrepancies || []).length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Discrepancies requiring review:</p>
                  {(validationResult.discrepancies || []).map((d, i) => (
                    <div key={i} className={`rounded-md p-3 text-xs border ${
                      d.severity === "error"
                        ? "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
                        : "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800"
                    }`} data-testid={`validation-issue-${i}`}>
                      <div className="flex items-start gap-2">
                        <AlertCircle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${d.severity === "error" ? "text-red-600" : "text-amber-600"}`} />
                        <div>
                          <span className="font-semibold">{d.payer_name}</span>
                          <span className="text-muted-foreground mx-1">·</span>
                          <span className="capitalize">{d.issue.replace(/_/g, " ")}</span>
                          <p className="mt-0.5 text-muted-foreground">{d.detail}</p>
                          {d.expected_hint && (
                            <p className="mt-0.5">Expected: <span className="font-medium">{String(d.expected_hint)}</span></p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md p-3 bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800 text-xs text-green-700 dark:text-green-300 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  All timely filing values are within CMS and industry reference thresholds. No discrepancies found.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main tabs: Manuals review vs Source Registry */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-9">
          <TabsTrigger value="manuals" className="text-sm" data-testid="tab-manuals">
            <List className="h-4 w-4 mr-1.5" />
            Source Documents ({manuals.length})
          </TabsTrigger>
          <TabsTrigger value="registry" className="text-sm" data-testid="tab-registry">
            <Database className="h-4 w-4 mr-1.5" />
            Source Registry ({coveragePayers.length})
          </TabsTrigger>
          <TabsTrigger value="cci" className="text-sm" data-testid="tab-cci">
            <BarChart3 className="h-4 w-4 mr-1.5" />
            CCI Edits
          </TabsTrigger>
        </TabsList>

        {/* Source Registry Tab */}
        <TabsContent value="registry">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payer Manual Source Registry</CardTitle>
              <CardDescription>
                Known public billing guideline URLs for the top 20 commercial payers. Click "Ingest" to start ingestion without hunting for the URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="w-8 text-xs pl-4">#</TableHead>
                    <TableHead className="text-xs">Payer Name</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Manual URL</TableHead>
                    <TableHead className="text-xs">Last Verified</TableHead>
                    <TableHead className="text-xs text-right pr-4">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coveragePayers.map((src) => (
                    <TableRow key={src.source_id} data-testid={`row-source-${src.source_id}`}>
                      <TableCell className="text-xs text-muted-foreground pl-4">{src.priority}</TableCell>
                      <TableCell className="text-sm font-medium py-2">{src.payer_name}</TableCell>
                      <TableCell className="py-2">
                        <div className="flex flex-col gap-1">
                        {src.linked_manual_id ? (
                          src.manual_status === "completed" ? (
                            <Badge variant="outline" className="text-xs text-green-700 border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Ingested
                            </Badge>
                          ) : src.manual_status === "ready_for_review" ? (
                            <Badge variant="outline" className="text-xs text-blue-700 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
                              <Clock className="h-3 w-3 mr-1" /> In Review
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800">
                              <Clock className="h-3 w-3 mr-1" /> Processing
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            <Clock className="h-3 w-3 mr-1" /> Not ingested
                          </Badge>
                        )}
                        {src.linked_manual_id && !src.manual_payer_id && (
                          <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800" title="No payer record linked — prior-auth requirements will not auto-populate on approval">
                            <AlertCircle className="h-3 w-3 mr-1" /> No payer link
                          </Badge>
                        )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 max-w-[260px]">
                        {src.canonical_url ? (
                          <a
                            href={src.canonical_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1 truncate"
                            title={src.canonical_url}
                            data-testid={`link-source-url-${src.source_id}`}
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{src.canonical_url.replace(/^https?:\/\//, "")}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">No URL recorded</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {src.last_verified_date ? format(new Date(src.last_verified_date), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="py-2 text-right pr-4">
                        {src.linked_manual_id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => { setSelectedManualId(src.linked_manual_id!); setActiveTab("manuals"); }}
                            data-testid={`button-view-manual-${src.source_id}`}
                          >
                            View Manual
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => openIngestFromSource(src)}
                            data-testid={`button-ingest-${src.source_id}`}
                          >
                            <Zap className="h-3 w-3 mr-1" /> Ingest
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manuals Review Tab */}
        <TabsContent value="manuals">
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Left: manual list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Source Documents ({filterDocType === "all" ? manuals.length : manuals.filter(m => m.document_type === filterDocType).length})
            </h2>
            <Select value={filterDocType} onValueChange={setFilterDocType}>
              <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-filter-doc-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map((dt) => (
                  <SelectItem key={dt} value={dt}>{DOC_TYPE_LABELS[dt]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : manuals.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No source documents ingested yet.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAddDialog(true)}>
                  Add your first document
                </Button>
              </CardContent>
            </Card>
          ) : (
            manuals.filter(m => filterDocType === "all" || m.document_type === filterDocType).map((manual) => (
              <button
                key={manual.id}
                onClick={() => setSelectedManualId(manual.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  selectedManualId === manual.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40"
                } ${manual.parent_document_id ? "ml-4 border-l-2 border-l-violet-300 dark:border-l-violet-700" : ""}`}
                data-testid={`card-manual-${manual.id}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    {docTypeBadge(manual.document_type || "admin_guide")}
                    <p className="text-sm font-medium leading-tight mt-0.5 truncate">{manual.payer_name}</p>
                  </div>
                  {statusBadge(manual.status)}
                </div>
                {manual.parent_document_name && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Link2 className="h-2.5 w-2.5" /> Under: {manual.parent_document_name}
                  </p>
                )}
                {(manual.effective_start || manual.effective_end) && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Effective: {manual.effective_start ? format(new Date(manual.effective_start), "MMM d, yyyy") : "?"} — {manual.effective_end ? format(new Date(manual.effective_end), "MMM d, yyyy") : "current"}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span>{manual.approved_count} approved</span>
                  {manual.pending_count > 0 && <span className="text-amber-600">{manual.pending_count} pending</span>}
                  {manual.rejected_count > 0 && <span className="text-red-500">{manual.rejected_count} rejected</span>}
                  {manual.supplement_count > 0 && <span className="text-violet-600">{manual.supplement_count} supplement{manual.supplement_count !== 1 ? "s" : ""}</span>}
                </div>
                {/* Section coverage dots — only for admin_guide and pa_list types */}
                {["admin_guide", "pa_list"].includes(manual.document_type || "admin_guide") && (
                  <div className="flex items-center gap-1 mt-1.5">
                    {sectionTypes.map((st) => {
                      const hasApproved = items.some((i) => i.source_document_id === manual.id && normalizeSectionType(i.section_type) === st && i.review_status === "approved");
                      return (
                        <span
                          key={st}
                          title={SECTION_LABELS[st]}
                          className={`h-2 w-2 rounded-full ${hasApproved ? "bg-green-500" : "bg-muted-foreground/30"}`}
                        />
                      );
                    })}
                    <span className="text-xs text-muted-foreground ml-1">coverage</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {manual.file_name ? manual.file_name : manual.source_url ? "URL source" : "—"} · Added {manual.created_at ? format(new Date(manual.created_at), "MMM d, yyyy") : "—"}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Right: review panel */}
        <div>
          {!selectedManual ? (
            <Card className="h-full">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <BookOpen className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Select a manual to review extracted rules</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Manual header */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {docTypeBadge(selectedManual.document_type || "admin_guide")}
                        {selectedManual.parent_document_name && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Link2 className="h-2.5 w-2.5" /> Under: {selectedManual.parent_document_name}
                          </span>
                        )}
                      </div>
                      <CardTitle className="text-base">{selectedManual.payer_name}</CardTitle>
                      {(selectedManual.effective_start || selectedManual.effective_end) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <CalendarCheck className="h-3 w-3" />
                          Effective: {selectedManual.effective_start ? format(new Date(selectedManual.effective_start), "MMM d, yyyy") : "—"} — {selectedManual.effective_end ? format(new Date(selectedManual.effective_end), "MMM d, yyyy") : "current"}
                        </p>
                      )}
                      {selectedManual.source_url && (
                        <a
                          href={selectedManual.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                          data-testid="link-source-url"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {selectedManual.source_url.slice(0, 65)}…
                        </a>
                      )}
                      {selectedManual.file_name && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {selectedManual.file_name}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusBadge(selectedManual.status)}
                      {["pending", "failed", "ready_for_review"].includes(selectedManual.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => processMutation.mutate(selectedManual.id)}
                          disabled={processMutation.isPending || selectedManual.status === "processing"}
                          data-testid="button-run-extraction"
                        >
                          <Zap className="h-4 w-4 mr-1" />
                          {selectedManual.status === "processing" ? "Processing…" : "Run Extraction"}
                        </Button>
                      )}
                      {selectedManual.status === "processing" && (
                        <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/payer-manuals"] })}>
                          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => deleteMutation.mutate(selectedManual.id)}
                        data-testid="button-delete-manual"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {selectedManual.error_message && (
                    <p className="text-xs text-red-500 mt-1">Error: {selectedManual.error_message}</p>
                  )}
                </CardHeader>
                <Separator />
                <CardContent className="pt-3 pb-2">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span><strong className="text-foreground">{selectedManual.item_count}</strong> items total</span>
                    <span><strong className="text-green-600">{selectedManual.approved_count}</strong> approved</span>
                    {selectedManual.pending_count > 0 && <span><strong className="text-amber-600">{selectedManual.pending_count}</strong> pending review</span>}
                    {selectedManual.rejected_count > 0 && <span><strong className="text-red-500">{selectedManual.rejected_count}</strong> rejected</span>}
                  </div>
                </CardContent>
              </Card>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <Select value={filterSection} onValueChange={setFilterSection}>
                  <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-filter-section">
                    <SelectValue placeholder="All sections" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sections</SelectItem>
                    {sectionTypes.map((st) => (
                      <SelectItem key={st} value={st}>{SECTION_LABELS[st]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="needs_reverification">Needs re-verification</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="not_found">Not found</SelectItem>
                  </SelectContent>
                </Select>
                {(filterSection !== "all" || filterStatus !== "all") && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterSection("all"); setFilterStatus("all"); }}>
                    Clear
                  </Button>
                )}
                <span className="text-xs text-muted-foreground ml-auto">{filteredItems.length} items</span>
              </div>

              {/* Items */}
              {itemsLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Loading items…</div>
              ) : filteredItems.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      {selectedManual.status === "pending"
                        ? "Click 'Run Extraction' to extract rules from this manual using AI."
                        : "No items match the current filters."}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {sectionTypes.map((st) => {
                    const sectionItems = filteredItems.filter((i) => normalizeSectionType(i.section_type) === st);
                    if (sectionItems.length === 0) return null;
                    return (
                      <div key={st}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                          {SECTION_LABELS[st]}
                        </p>
                        <div className="space-y-2">
                          {sectionItems.map((item) => (
                            <ExtractionItemCard
                              key={item.id}
                              item={item}
                              onReview={(p) => reviewMutation.mutate(p)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
        </TabsContent>

        {/* CCI Edits Tab */}
        <TabsContent value="cci">
          <div className="space-y-4">
            {/* Stats cards */}
            {cciStats.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center text-muted-foreground py-8">
                    <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No CCI edits ingested yet.</p>
                    <p className="text-sm mt-1">Use "Ingest from CMS" to pull the latest NCCI Practitioner PTP file, or upload a CSV/ZIP manually.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cciStats.map((row: any) => (
                  <Card key={row.ncci_version} data-testid={`card-cci-version-${row.ncci_version}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">{row.ncci_version}</span>
                        <Badge variant="outline" className="text-xs">{Number(row.total_edits).toLocaleString()} total</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-green-50 dark:bg-green-950/30 rounded p-2">
                          <p className="font-bold text-green-700 dark:text-green-400">{Number(row.active_edits).toLocaleString()}</p>
                          <p className="text-muted-foreground">Active</p>
                        </div>
                        <div className="bg-red-50 dark:bg-red-950/30 rounded p-2">
                          <p className="font-bold text-red-700 dark:text-red-400">{Number(row.hard_blocks).toLocaleString()}</p>
                          <p className="text-muted-foreground">Hard Blocks</p>
                        </div>
                        <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded p-2">
                          <p className="font-bold text-yellow-700 dark:text-yellow-400">{Number(row.soft_warnings).toLocaleString()}</p>
                          <p className="text-muted-foreground">Soft Warns</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 text-right">
                        Last ingested: {row.last_ingested_at ? format(new Date(row.last_ingested_at), "MMM d, yyyy h:mm a") : "—"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Actions row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Ingest from CMS */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Ingest from CMS (Quarterly)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Downloads the latest NCCI Practitioner PTP ZIP from cms.gov and upserts all edits.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    size="sm"
                    disabled={cciIngestRunning}
                    data-testid="button-cci-ingest-cms"
                    onClick={async () => {
                      setCciIngestRunning(true);
                      try {
                        const res = await fetch("/api/admin/cci/ingest", { method: "POST", credentials: "include" });
                        const data = await res.json();
                        if (data.success) {
                          toast({ title: "CCI ingest complete", description: `Inserted: ${data.stats.inserted}, Updated: ${data.stats.updated}` });
                          refetchCciStats();
                        } else {
                          toast({ title: "Ingest failed", description: data.error, variant: "destructive" });
                        }
                      } catch (e: any) {
                        toast({ title: "Ingest error", description: e.message, variant: "destructive" });
                      } finally {
                        setCciIngestRunning(false);
                      }
                    }}
                  >
                    {cciIngestRunning ? <><RefreshCw className="h-3 w-3 mr-1.5 animate-spin" /> Ingesting...</> : <><Play className="h-3 w-3 mr-1.5" /> Ingest Now</>}
                  </Button>
                </CardContent>
              </Card>

              {/* Manual upload */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Manual Upload (CSV or ZIP)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Upload a CMS NCCI CSV or ZIP file manually for any quarter.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Version label (e.g. 2025Q2)"
                      value={cciVersion}
                      onChange={(e) => setCciVersion(e.target.value)}
                      className="text-sm h-8"
                      data-testid="input-cci-version"
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      ref={cciFileRef}
                      type="file"
                      accept=".csv,.zip"
                      className="hidden"
                      onChange={(e) => setCciUploadFile(e.target.files?.[0] || null)}
                      data-testid="input-cci-file"
                    />
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => cciFileRef.current?.click()} data-testid="button-cci-choose-file">
                      {cciUploadFile ? cciUploadFile.name : "Choose file…"}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!cciUploadFile || cciUploading}
                      data-testid="button-cci-upload"
                      onClick={async () => {
                        if (!cciUploadFile) return;
                        setCciUploading(true);
                        try {
                          const fd = new FormData();
                          fd.append("file", cciUploadFile);
                          if (cciVersion) fd.append("version", cciVersion);
                          const res = await fetch("/api/admin/cci/upload", { method: "POST", credentials: "include", body: fd });
                          const data = await res.json();
                          if (data.success) {
                            toast({ title: "Upload complete", description: `Inserted: ${data.stats.inserted}, Updated: ${data.stats.updated}` });
                            setCciUploadFile(null);
                            setCciVersion("");
                            if (cciFileRef.current) cciFileRef.current.value = "";
                            refetchCciStats();
                          } else {
                            toast({ title: "Upload failed", description: data.error, variant: "destructive" });
                          }
                        } catch (e: any) {
                          toast({ title: "Upload error", description: e.message, variant: "destructive" });
                        } finally {
                          setCciUploading(false);
                        }
                      }}
                    >
                      {cciUploading ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Uploading…</> : <><Upload className="h-3 w-3 mr-1" /> Upload</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Code search */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Code Conflict Lookup
                </CardTitle>
                <CardDescription className="text-xs">
                  Enter a HCPCS/CPT code to see all NCCI conflicts in the current quarter.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. 99213"
                    value={cciSearchCode}
                    onChange={(e) => setCciSearchCode(e.target.value.toUpperCase())}
                    className="text-sm h-8 max-w-[160px] font-mono"
                    data-testid="input-cci-search"
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        if (!cciSearchCode) return;
                        setCciSearchLoading(true);
                        try {
                          const res = await fetch(`/api/admin/cci/search?code=${encodeURIComponent(cciSearchCode)}`, { credentials: "include" });
                          setCciSearchResults(await res.json());
                        } catch { setCciSearchResults([]); }
                        finally { setCciSearchLoading(false); }
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={!cciSearchCode || cciSearchLoading}
                    data-testid="button-cci-search"
                    onClick={async () => {
                      if (!cciSearchCode) return;
                      setCciSearchLoading(true);
                      try {
                        const res = await fetch(`/api/admin/cci/search?code=${encodeURIComponent(cciSearchCode)}`, { credentials: "include" });
                        setCciSearchResults(await res.json());
                      } catch { setCciSearchResults([]); }
                      finally { setCciSearchLoading(false); }
                    }}
                  >
                    {cciSearchLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Search"}
                  </Button>
                </div>

                {cciSearchResults.length > 0 && (
                  <div className="rounded border overflow-x-auto" data-testid="table-cci-results">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Column 1</TableHead>
                          <TableHead className="text-xs">Column 2</TableHead>
                          <TableHead className="text-xs">Modifier</TableHead>
                          <TableHead className="text-xs">Effective</TableHead>
                          <TableHead className="text-xs">Rationale</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cciSearchResults.map((row: any, i: number) => (
                          <TableRow key={i} data-testid={`cci-result-row-${i}`}>
                            <TableCell className="font-mono text-xs">{row.column_1_code}</TableCell>
                            <TableCell className="font-mono text-xs">{row.column_2_code}</TableCell>
                            <TableCell>
                              <Badge className={`text-xs ${row.modifier_indicator === "0" ? "bg-red-600" : "bg-yellow-500"}`}>
                                {row.modifier_indicator === "0" ? "Hard Block" : row.modifier_indicator === "1" ? "Modifier OK" : "Historical"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{row.effective_date ? format(new Date(row.effective_date), "MM/dd/yyyy") : "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{row.ptp_edit_rationale || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {cciSearchResults.length === 0 && cciSearchCode && !cciSearchLoading && (
                  <p className="text-xs text-muted-foreground" data-testid="text-cci-no-results">No conflicts found for {cciSearchCode} in the current NCCI version.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Manual Dialog */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) setPendingSourceId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Source Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">

            {/* Document Type */}
            <div className="space-y-1.5">
              <Label htmlFor="pm-doc-type">Document Type *</Label>
              <Select value={addForm.documentType} onValueChange={(v) => setAddForm({ ...addForm, documentType: v as DocumentType, parentDocumentId: v !== "supplement" ? "" : addForm.parentDocumentId })}>
                <SelectTrigger id="pm-doc-type" data-testid="select-doc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(DOC_TYPE_LABELS) as [DocumentType, string][]).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {addForm.documentType === "admin_guide" && "Main billing/administrative guide published by the payer."}
                {addForm.documentType === "supplement" && "Payer-specific supplement or affiliate addendum (e.g. Empire Plan, Oxford, NHP). Requires a parent admin guide."}
                {addForm.documentType === "pa_list" && "Structured prior authorization CPT/HCPCS code list — separate from the admin guide, updated monthly."}
                {addForm.documentType === "reimbursement_policy" && "Reimbursement/payment policy document covering specific billing scenarios (Modifier 25, 59, bundling, etc)."}
                {addForm.documentType === "medical_policy" && "Medical necessity or coverage policy defining clinical criteria for services."}
                {addForm.documentType === "bulletin" && "Monthly or quarterly update bulletin announcing rule changes."}
                {addForm.documentType === "contract" && "Participation agreement or contract — timely filing and fee schedules may override the admin guide."}
                {addForm.documentType === "fee_schedule" && "Published fee schedule for reimbursement rates."}
              </p>
            </div>

            {/* Parent document — only for supplements */}
            {addForm.documentType === "supplement" && (
              <div className="space-y-1.5">
                <Label htmlFor="pm-parent">Parent Admin Guide *</Label>
                <Select value={addForm.parentDocumentId} onValueChange={(v) => setAddForm({ ...addForm, parentDocumentId: v })}>
                  <SelectTrigger id="pm-parent" data-testid="select-parent-document">
                    <SelectValue placeholder="Select the parent admin guide…" />
                  </SelectTrigger>
                  <SelectContent>
                    {manuals.filter((m) => m.document_type === "admin_guide").map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.payer_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pm-payer-name">Payer / Document Name *</Label>
              <Input
                id="pm-payer-name"
                value={addForm.payerName}
                onChange={(e) => setAddForm({ ...addForm, payerName: e.target.value })}
                placeholder="e.g. UnitedHealthcare Commercial — 2026 Admin Guide"
                data-testid="input-payer-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pm-payer-id">Link to Payer Record (optional)</Label>
              <Select value={addForm.payerId || "__none__"} onValueChange={(v) => setAddForm({ ...addForm, payerId: v === "__none__" ? "" : v })}>
                <SelectTrigger id="pm-payer-id" data-testid="select-payer-id">
                  <SelectValue placeholder="Select existing payer record…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None / unlisted payer</SelectItem>
                  {payers.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Linking allows approved timely filing rules to auto-update the payer record.</p>
            </div>

            {/* Effective dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pm-eff-start">Effective From</Label>
                <Input
                  id="pm-eff-start"
                  type="date"
                  value={addForm.effectiveStart}
                  onChange={(e) => setAddForm({ ...addForm, effectiveStart: e.target.value })}
                  data-testid="input-effective-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-eff-end">Effective Through</Label>
                <Input
                  id="pm-eff-end"
                  type="date"
                  value={addForm.effectiveEnd}
                  onChange={(e) => setAddForm({ ...addForm, effectiveEnd: e.target.value })}
                  placeholder="Leave blank = currently in effect"
                  data-testid="input-effective-end"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Set the date range this document governs. Claims with service dates in range will be evaluated against these rules. Leave "Effective Through" blank for currently-active documents.
            </p>

            {/* Source mode toggle */}
            <div className="space-y-2">
              <Label>Document source</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={addMode === "url" ? "default" : "outline"}
                  onClick={() => setAddMode("url")}
                  data-testid="button-mode-url"
                >
                  <Link2 className="h-4 w-4 mr-1" /> URL
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={addMode === "file" ? "default" : "outline"}
                  onClick={() => setAddMode("file")}
                  data-testid="button-mode-file"
                >
                  <Upload className="h-4 w-4 mr-1" /> Upload PDF
                </Button>
              </div>
            </div>

            {addMode === "url" ? (
              <div className="space-y-1.5">
                <Label htmlFor="pm-url">Document URL *</Label>
                <Input
                  id="pm-url"
                  type="url"
                  value={addForm.sourceUrl}
                  onChange={(e) => setAddForm({ ...addForm, sourceUrl: e.target.value })}
                  placeholder="https://payer.com/billing-guidelines.pdf"
                  data-testid="input-source-url"
                />
                <p className="text-xs text-muted-foreground">Supports HTML pages and text-layer PDFs. Image-only PDFs require Claude vision (ANTHROPIC_API_KEY).</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>PDF / HTML File *</Label>
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="div-file-drop"
                >
                  {uploadFile ? (
                    <p className="text-sm text-foreground">{uploadFile.name} ({(uploadFile.size / 1024).toFixed(0)} KB)</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Click to select a file (max 20 MB)</p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.html,.htm,.txt"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  data-testid="input-file"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); setPendingSourceId(null); }}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !canAdd}
              data-testid="button-submit-add-manual"
            >
              {addMutation.isPending ? "Adding…" : "Add Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
