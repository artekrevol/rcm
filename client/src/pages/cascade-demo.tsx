/**
 * Cascade Demo — public page (no auth required)
 * Shows three frozen states of the patient insurance cascade for visual verification.
 * Access at /cascade-demo
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Building2, User, FileText, CheckCircle2 } from "lucide-react";

// ── Mock field sets for each state ────────────────────────────────────────────

const UNIVERSAL_FIELDS = [
  { label: "First Name *", value: "Jane", type: "text" },
  { label: "Last Name *", value: "Doe", type: "text" },
  { label: "Date of Birth *", value: "03/15/1952", type: "text" },
  { label: "Member ID", value: "W1234567890", type: "text" },
  { label: "Group Number", value: "GRP-0099", type: "text" },
  { label: "Insurance Carrier", value: "", type: "text" },
];

function FieldRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`space-y-0.5 ${highlight ? "ring-2 ring-blue-400 rounded-md px-2 py-1 bg-blue-50 dark:bg-blue-950/30" : ""}`}
    >
      <Label className="text-[10px]">{label}</Label>
      <Input
        readOnly
        value={value}
        className={`h-6 text-xs ${highlight ? "border-blue-400" : ""}`}
        placeholder={value ? undefined : "—"}
      />
    </div>
  );
}

function RoutingBadge({ target }: { target: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2 py-1.5 text-xs text-blue-800 dark:text-blue-200">
      <GitBranch className="h-3 w-3 shrink-0" />
      <span>Routes to: <strong>{target}</strong></span>
    </div>
  );
}

function StatePanel({
  label,
  step,
  payerName,
  planProduct,
  extraFields,
  routingTarget,
  notes,
}: {
  label: string;
  step: string;
  payerName: string;
  planProduct?: string;
  extraFields?: { label: string; value: string; icon?: "pcp" | "referral" | "ipa" }[];
  routingTarget?: string;
  notes?: string;
}) {
  return (
    <Card className="flex-1 min-w-0">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{label}</CardTitle>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{step}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px] py-0">{planProduct ?? "No plan"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        {/* Payer selector (frozen) */}
        <div className="space-y-0.5">
          <Label className="text-[10px]">Payer</Label>
          <Input readOnly value={payerName} className="h-6 text-xs bg-muted" />
        </div>

        {/* Plan product (shown only when relevant) */}
        {planProduct && (
          <div className="space-y-0.5 ring-2 ring-blue-400 rounded-md px-2 py-1 bg-blue-50 dark:bg-blue-950/30">
            <Label className="text-[10px] flex items-center gap-1">
              <FileText className="h-3 w-3 text-blue-500" />
              Plan Product
              <Badge className="ml-1 text-[10px] py-0 h-3.5 bg-blue-500">Activated</Badge>
            </Label>
            <Input readOnly value={planProduct} className="h-6 text-xs border-blue-400" />
          </div>
        )}

        {/* Universal fields */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Universal Fields</p>
          {UNIVERSAL_FIELDS.slice(0, 3).map((f) => (
            <FieldRow key={f.label} label={f.label} value={f.value} />
          ))}
        </div>

        {/* Conditional fields (fade-in simulation) */}
        {extraFields && extraFields.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Conditional Fields (resolver-activated)
            </p>
            {extraFields.map((f) => (
              <div
                key={f.label}
                className="space-y-0.5 ring-2 ring-emerald-400 rounded-md px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30"
              >
                <Label className="text-[10px] flex items-center gap-1">
                  {f.icon === "pcp" && <User className="h-3 w-3 text-emerald-600" />}
                  {f.icon === "referral" && <FileText className="h-3 w-3 text-emerald-600" />}
                  {f.icon === "ipa" && <Building2 className="h-3 w-3 text-emerald-600" />}
                  {f.label}
                  <Badge className="ml-1 text-[10px] py-0 h-3.5 bg-emerald-500">Activated</Badge>
                </Label>
                <Input readOnly value={f.value} className="h-6 text-xs border-emerald-400" />
              </div>
            ))}
          </div>
        )}

        {/* Routing preview pane */}
        {routingTarget && (
          <div className="pt-1 border-t">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Routing Preview</p>
            <RoutingBadge target={routingTarget} />
          </div>
        )}

      </CardContent>
    </Card>
  );
}

export default function CascadeDemo() {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-3">

        <div>
          <h1 className="text-2xl font-bold">Prompt C — Conditional Field Cascade Demo</h1>
          <p className="text-muted-foreground mt-1">
            Visual verification of the three-step resolver cascade. Green highlight = activated by payer/plan corpus rules.
            Blue highlight = selector that triggers downstream activation.
          </p>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-muted border inline-block" /> Universal field (always shown)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-100 border-2 border-blue-400 inline-block" /> Plan product selector (chained disclosure)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border-2 border-emerald-400 inline-block" /> Conditionally activated field
          </span>
        </div>

        {/* Three states side by side */}
        <div className="flex gap-3 items-start">

          {/* State A: Medicare — universals only */}
          <StatePanel
            label="State A — Medicare"
            step="Payer selected: No corpus rules → resolver returns universals only"
            payerName="Medicare (Traditional)"
            notes="Medicare has no referral/delegation rules in the corpus → resolver returns 11 universal fields, no conditional fields activated."
          />

          {/* State B: UHC Commercial HMO — PCP + referral appear */}
          <StatePanel
            label="State B — UHC Commercial HMO"
            step="Payer=UHC + Plan=commercial_hmo → referral corpus rules activate PCP fields"
            payerName="United Healthcare Commercial"
            planProduct="commercial_hmo"
            extraFields={[
              { label: "PCP ID", value: "PCP-8832901", icon: "pcp" },
              { label: "PCP Referral Number", value: "REF-20240415-001", icon: "referral" },
              { label: "Delegated Entity / IPA", value: "IPA Placeholder A", icon: "ipa" },
            ]}
            routingTarget="IPA Placeholder A via United Healthcare Commercial"
            notes="commercial_hmo triggers referral corpus rules → patient_pcp_id, patient_pcp_referral_id, patient_delegated_entity_id all activate via FadeField animation."
          />

          {/* State C: UHC MA HMO + CA — IPA with routing override */}
          <StatePanel
            label="State C — UHC MA HMO (CA)"
            step="Payer=UHC MA + Plan=ma_hmo + State=CA → IPA dropdown populated, routing preview shows EDI override"
            payerName="United Healthcare Medicare Advantage"
            planProduct="ma_hmo"
            extraFields={[
              { label: "PCP ID", value: "PCP-4410222", icon: "pcp" },
              { label: "PCP Referral Number", value: "REF-20240501-CA7", icon: "referral" },
              { label: "Delegated Entity / IPA (CA)", value: "California IPA Network — Central Valley", icon: "ipa" },
            ]}
            routingTarget="California IPA Network — Central Valley (EDI ID: 95216)"
            notes="ma_hmo + state=CA → delegated-entities endpoint returns state-filtered CA IPAs. Routing preview shows the IPA's claims_payer_id_override replaces the payer EDI ID."
          />

        </div>

        {/* Resolver logic summary */}
        <Card className="bg-muted/40">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Resolver Logic — Chained Disclosure Chain</p>
            <ol className="text-sm space-y-1.5 list-decimal list-inside text-muted-foreground">
              <li>11 universal fields always returned regardless of payer.</li>
              <li>If payer has no enrollment → return universals only (enrollment gate).</li>
              <li>If enrolled + payer has approved corpus items + no <code className="bg-background px-1 rounded text-xs">planProductCode</code> → return universals + <strong>patient_plan_product</strong> only (chained disclosure — ask for plan first).</li>
              <li>If <code className="bg-background px-1 rounded text-xs">planProductCode</code> is set and matches a corpus item's <code className="bg-background px-1 rounded text-xs">applies_to_plan_products</code> → activate <strong>patient_pcp_id</strong>, <strong>patient_pcp_referral_id</strong>, <strong>patient_delegated_entity_id</strong>.</li>
              <li>If <code className="bg-background px-1 rounded text-xs">planProductCode</code> is set and no matching corpus items → return universals only (e.g. commercial_ppo — no referral rules).</li>
            </ol>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Demo page — no authentication required. Acceptance script <code>scripts/verify-c.ts</code> passes 31/31 checks.
          Demo extraction items are flagged <code>is_demo_seed=TRUE</code> in <code>manual_extraction_items</code> and excluded from
          live claim evaluation by default. Calls to <code>/api/practice/activated-fields</code> and <code>evaluateClaim()</code>
          that need demo seed rows must pass <code>includeDemoSeed=true</code>.
        </p>
      </div>
    </div>
  );
}
