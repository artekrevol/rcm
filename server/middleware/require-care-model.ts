/**
 * require-care-model.ts — Route-level guard for HH-only endpoints.
 *
 * Usage:
 *   app.get("/api/hh/episodes", requireCareModel("home_health_skilled"), async (req, res) => { ... });
 *
 * Returns 403 with a clear message for orgs whose practice_settings.care_model
 * does not match the required model. This keeps care-model checks out of shared
 * route handlers — each HH-only route calls this guard at the top, not inline ifs.
 *
 * G1 guardrail: outpatient orgs must NEVER access episode, NOA, RCD, or billing-
 * period data. This guard is the server-side enforcement point.
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db";

export type CareModel =
  | "outpatient_professional"
  | "home_health_skilled"
  | "home_health_personal_care";

function getOrgId(req: Request): string | null {
  const user = (req as any).user;
  return user?.organizationId ?? user?.organization_id ?? null;
}

/**
 * Returns an Express middleware that reads practice_settings.care_model for
 * the current org and rejects with 403 if it does not match `required`.
 * If the org has care_model = 'home_health_personal_care', returns 501
 * (not yet implemented) so callers get a clear signal.
 *
 * @param required - the care_model value that must be present
 */
export function requireCareModel(required: CareModel) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = getOrgId(req);
    if (!orgId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await pool.query(
        "SELECT care_model FROM practice_settings WHERE organization_id = $1 LIMIT 1",
        [orgId],
      );

      const careModel: string = result.rows[0]?.care_model ?? "outpatient_professional";

      // home_health_personal_care is defined in the type system but not yet implemented.
      // Return 501 so callers receive a clear "not implemented" signal rather than a
      // misleading 403 access-denied.
      if (careModel === "home_health_personal_care") {
        res.status(501).json({
          error: "not_implemented",
          message: "Home Health Personal Care segment is not yet available.",
          actualCareModel: careModel,
        });
        return;
      }

      if (careModel !== required) {
        res.status(403).json({
          error: "care_model_mismatch",
          message: `This feature requires care model "${required}". Your organization is configured as "${careModel}".`,
          requiredCareModel: required,
          actualCareModel: careModel,
        });
        return;
      }

      next();
    } catch (err: any) {
      console.error("[requireCareModel] DB error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to verify care model" });
    }
  };
}

/**
 * Convenience guard for home_health_* orgs (either skilled or personal care).
 * Returns 403 if the org is outpatient_professional.
 */
export function requireAnyHomeHealth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = getOrgId(req);
    if (!orgId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await pool.query(
        "SELECT care_model FROM practice_settings WHERE organization_id = $1 LIMIT 1",
        [orgId],
      );

      const careModel: string = result.rows[0]?.care_model ?? "outpatient_professional";

      if (!careModel.startsWith("home_health_")) {
        res.status(403).json({
          error: "care_model_mismatch",
          message: `This feature requires a home health care model. Your organization is configured as "${careModel}".`,
          actualCareModel: careModel,
        });
        return;
      }

      next();
    } catch (err: any) {
      console.error("[requireAnyHomeHealth] DB error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to verify care model" });
    }
  };
}
