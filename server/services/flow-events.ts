import { pool } from "../db";

export async function logFlowEvent(
  flowRunId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO flow_run_events (flow_run_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [flowRunId, eventType, JSON.stringify(payload)]
    );
  } catch (err) {
    console.error("[flow-events] logFlowEvent error:", err);
  }
}
