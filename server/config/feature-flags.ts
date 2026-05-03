/**
 * Centralized feature flags (Phase 3 Sprint 0).
 *
 * Each flag is a function (not a constant) so tests and runtime overrides
 * can flip the underlying env var without re-importing the module.
 *
 * Default for every Phase-3 flag is OFF. Sprint 0 ships the foundation; flags
 * stay OFF until a later sprint flips them after operator review.
 */

function readBool(envName: string, defaultValue: boolean): boolean {
  const raw = process.env[envName];
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * USE_PROFILE_AWARE_QUERIES — Phase 3 master switch.
 *
 * When TRUE, helper services in `server/services/practice-profile-helpers.ts`
 * are allowed to be invoked by routes/cron jobs that opt into profile-aware
 * behavior. When FALSE (Sprint 0 default), the helpers can still be imported
 * and unit-tested, but production code paths that branch on this flag must
 * fall through to the legacy hard-coded behavior.
 *
 * The flag does NOT control:
 *   - whether RLS policies exist (always on)
 *   - whether tenant-context middleware runs (always on)
 *   - whether the helpers' DB queries themselves work (they do)
 *
 * It controls only whether routes/jobs are *expected* to use the new
 * helpers. This separation means we can unit-test the helpers without
 * activating any production behavior change.
 */
export function useProfileAwareQueries(): boolean {
  return readBool("USE_PROFILE_AWARE_QUERIES", false);
}

/** Snapshot of all flag values, for logging/diagnostics. */
export function snapshotFeatureFlags() {
  return {
    USE_PROFILE_AWARE_QUERIES: useProfileAwareQueries(),
  };
}
