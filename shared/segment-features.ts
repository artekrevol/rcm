/**
 * Segment feature resolver — pure function, no React deps.
 * Importable from server tests, client contexts, and shared utilities.
 */

export interface SegmentFeatures {
  showEpisodes: boolean;
  showNoaDashboard: boolean;
  showRcdPanel: boolean;
  showHippsEntry: boolean;
  showVisitLog: boolean;
}

/**
 * Determine which segment features are visible for a given care_model value.
 * Pure function — no side-effects, no React hooks, no DB access.
 */
export function resolveSegmentFeatures(settings: { care_model: string }): SegmentFeatures {
  const isHH = settings.care_model === "home_health_skilled";
  return {
    showEpisodes: isHH,
    showNoaDashboard: isHH,
    showRcdPanel: isHH,
    showHippsEntry: isHH,
    showVisitLog: isHH,
  };
}
