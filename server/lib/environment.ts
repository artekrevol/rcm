/**
 * Environment configuration for Stedi EDI mode.
 *
 * Stedi has ONE API account and ONE API key. Production vs test separation is
 * controlled exclusively by ISA15 inside the EDI envelope:
 *   ISA15='T' → Stedi validates, returns 277CA, does NOT forward to the real payer
 *   ISA15='P' → Stedi validates, returns 277CA, AND forwards to the real payer
 *
 * Set STEDI_ENV=production only in Railway/production deployments.
 * All other environments (dev, staging, qa, preview, undefined) default to 'test'.
 */
export const STEDI_ENV: "production" | "test" = (() => {
  const env = (process.env.STEDI_ENV || process.env.NODE_ENV || "").toLowerCase();
  return env === "production" ? "production" : "test";
})();

/**
 * Default ISA15 indicator for this environment.
 * The wizard's "Submit as test" override takes precedence over this value.
 */
export const ISA15_INDICATOR: "P" | "T" = STEDI_ENV === "production" ? "P" : "T";

/**
 * Returns the ISA15 to embed in a generated 837P.
 * @param testModeOverride  When true (wizard checkbox or forced by FRCPB payer),
 *                          always returns 'T' regardless of STEDI_ENV.
 */
export function resolveISA15(testModeOverride: boolean = false): "P" | "T" {
  if (testModeOverride) return "T";
  return ISA15_INDICATOR;
}

/**
 * Returns true if this request context is automated (no human session).
 * Used to block automated agents from reaching Stedi endpoints.
 */
export function isAutomatedContext(opts: {
  hasUserSession: boolean;
  nodeEnv?: string;
  userAgent?: string;
  xAutomatedAgent?: string;
}): boolean {
  if (!opts.hasUserSession) return true;
  if (opts.nodeEnv === "test") return true;
  if (opts.xAutomatedAgent === "true") return true;
  const ua = (opts.userAgent || "").toLowerCase();
  if (ua.includes("jest") || ua.includes("vitest") || ua.includes("node-fetch/ci")) return true;
  return false;
}
