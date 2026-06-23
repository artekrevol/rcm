/**
 * NOA (Notice of Admission) utilities for Home Health billing.
 *
 * CMS counts CALENDAR days — all arithmetic operates on date parts,
 * not UTC milliseconds, to avoid timezone boundary shifts.
 */

export interface NoaStatusInput {
  soc_date: string;
  filed_date: string | null;
}

export interface NoaStatusResult {
  due_date: string;
  status: "pending" | "filed" | "late";
  penalty_days: number;
}

/**
 * Compute NOA due date (SOC + 5 calendar days), filing status, and
 * penalty day count.
 *
 * due_date = soc_date + 5 calendar days (CMS PDGM requirement).
 * penalty_days = MAX(0, filed_date − due_date) in calendar days.
 */
export function computeNoaStatus(input: NoaStatusInput): NoaStatusResult {
  const [sy, sm, sd] = input.soc_date.split("-").map(Number);
  const soc = new Date(sy, sm - 1, sd);

  const due = new Date(soc);
  due.setDate(due.getDate() + 5);
  const due_date = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;

  if (!input.filed_date) {
    return { due_date, status: "pending", penalty_days: 0 };
  }

  const [fy, fm, fd] = input.filed_date.split("-").map(Number);
  const filed = new Date(fy, fm - 1, fd);

  const msPerDay = 24 * 60 * 60 * 1000;
  const penalty_days = Math.max(0, Math.floor((filed.getTime() - due.getTime()) / msPerDay));
  const status: NoaStatusResult["status"] = penalty_days > 0 ? "late" : "filed";

  return { due_date, status, penalty_days };
}
