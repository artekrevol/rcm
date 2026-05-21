/**
 * Wave 2c — Preflight Rules Fixture
 *
 * Moved from the inline SQL VALUES block in routes.ts (second seeder block).
 * Each entry maps to the extended rules table schema that includes
 * trigger_pattern, rule_code, threshold_value, threshold_action, and
 * specialty_tags columns added in earlier sprints.
 *
 * These run with ON CONFLICT DO NOTHING so re-seeding is safe.
 */

export interface PreflightRule {
  name: string;
  description: string;
  trigger_pattern: string;
  prevention_action: "block" | "warn";
  enabled: boolean;
  rule_code: string;
  threshold_value: string;
  threshold_action: "block" | "warn";
  threshold_enabled: boolean;
  specialty_tags: string[];
  payer_match: string | null;
}

export const PREFLIGHT_RULES: PreflightRule[] = [
  {
    name: "Missing NPI",
    description: "Rendering provider NPI is missing or not 10 digits",
    trigger_pattern: "provider_npi_invalid",
    prevention_action: "block",
    enabled: true,
    rule_code: "provider_npi_invalid",
    threshold_value: "true",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
  {
    name: "Missing Diagnosis",
    description: "No primary ICD-10 diagnosis code on claim",
    trigger_pattern: "diagnosis_missing",
    prevention_action: "block",
    enabled: true,
    rule_code: "diagnosis_missing",
    threshold_value: "true",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
  {
    name: "Zero Charges",
    description: "All service line charges total $0.00",
    trigger_pattern: "total_charges_zero",
    prevention_action: "block",
    enabled: true,
    rule_code: "total_charges_zero",
    threshold_value: "true",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
  {
    name: "Missing Payer",
    description: "No payer assigned to claim",
    trigger_pattern: "payer_missing",
    prevention_action: "block",
    enabled: true,
    rule_code: "payer_missing",
    threshold_value: "true",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
  {
    name: "Future Service Date",
    description: "Date of service is more than 1 day in the future",
    trigger_pattern: "service_date_future",
    prevention_action: "warn",
    enabled: true,
    rule_code: "service_date_future",
    threshold_value: "1",
    threshold_action: "warn",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
  {
    name: "Missing Service Date",
    description: "Date of service is not set",
    trigger_pattern: "service_date_missing",
    prevention_action: "block",
    enabled: true,
    rule_code: "service_date_missing",
    threshold_value: "true",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
  {
    name: "VA Missing Auth Number",
    description: "TriWest/VA CCN claims require an authorization number",
    trigger_pattern: "va_auth_missing",
    prevention_action: "block",
    enabled: true,
    rule_code: "va_auth_missing",
    threshold_value: "TWVACCN",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["VA Community Care"],
    payer_match: null,
  },
  {
    name: "VA Timely Filing Warning",
    description: "Claim approaching 150-day VA filing deadline",
    trigger_pattern: "days_since_service_gt",
    prevention_action: "warn",
    enabled: true,
    rule_code: "days_since_service_gt",
    threshold_value: "150",
    threshold_action: "warn",
    threshold_enabled: true,
    specialty_tags: ["VA Community Care"],
    payer_match: null,
  },
  {
    name: "VA Timely Filing Block",
    description: "Claim past 180-day VA filing deadline",
    trigger_pattern: "days_since_service_gt",
    prevention_action: "block",
    enabled: true,
    rule_code: "days_since_service_gt",
    threshold_value: "180",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["VA Community Care"],
    payer_match: null,
  },
  {
    name: "VA Wrong Place of Service",
    description: "VA CCN home health claims require POS 12",
    trigger_pattern: "va_wrong_pos",
    prevention_action: "warn",
    enabled: true,
    rule_code: "va_wrong_pos",
    threshold_value: "12",
    threshold_action: "warn",
    threshold_enabled: true,
    specialty_tags: ["VA Community Care"],
    payer_match: null,
  },
  {
    name: "VA G-Code Requires POS 12",
    description: "Home health G-codes must be billed with POS 12",
    trigger_pattern: "gcode_wrong_pos",
    prevention_action: "block",
    enabled: true,
    rule_code: "gcode_wrong_pos",
    threshold_value: "12",
    threshold_action: "block",
    threshold_enabled: true,
    specialty_tags: ["VA Community Care", "Home Health"],
    payer_match: null,
  },
  {
    name: "Duplicate Claim",
    description: "A claim with same patient, service date, and code exists",
    trigger_pattern: "duplicate_claim",
    prevention_action: "warn",
    enabled: true,
    rule_code: "duplicate_claim",
    threshold_value: "true",
    threshold_action: "warn",
    threshold_enabled: true,
    specialty_tags: ["Universal"],
    payer_match: null,
  },
];
