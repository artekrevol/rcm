/**
 * Segment context — provides care_model awareness to the billing UI.
 *
 * Usage:
 *   const { careModel, isHH, isOutpatient } = useSegment();
 *   if (isHH) { ... }  // show episode / NOA nav
 *
 * SegmentProvider reads care_model from the practice settings API.
 * It is mounted in BillingLayout so every billing page has access.
 *
 * G1 guardrail (UI layer): HH-only components must call useIsHH() and
 * return null when it returns false. The server-side requireCareModel
 * middleware is the binding enforcement; this is the UX convenience layer.
 */
import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export type CareModel =
  | "outpatient_professional"
  | "home_health_skilled"
  | "home_health_personal_care";

interface SegmentContextValue {
  careModel: CareModel;
  isHH: boolean;
  isOutpatient: boolean;
  isLoading: boolean;
}

const SegmentContext = createContext<SegmentContextValue>({
  careModel: "outpatient_professional",
  isHH: false,
  isOutpatient: true,
  isLoading: false,
});

interface PracticeSettingsResponse {
  careModel?: string;
  care_model?: string;
}

export function SegmentProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery<PracticeSettingsResponse>({
    queryKey: ["/api/billing/practice-settings"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const careModel: CareModel = (
    (data?.careModel ?? data?.care_model ?? "outpatient_professional") as CareModel
  );

  const value = useMemo<SegmentContextValue>(
    () => ({
      careModel,
      isHH: careModel === "home_health_skilled",
      isOutpatient: careModel === "outpatient_professional",
      isLoading,
    }),
    [careModel, isLoading],
  );

  return (
    <SegmentContext.Provider value={value}>
      {children}
    </SegmentContext.Provider>
  );
}

/** Returns full segment context — prefer the convenience hooks below for most uses. */
export function useSegment(): SegmentContextValue {
  return useContext(SegmentContext);
}

/** Returns true only when the org is configured as home_health_skilled. */
export function useIsHH(): boolean {
  return useContext(SegmentContext).isHH;
}
