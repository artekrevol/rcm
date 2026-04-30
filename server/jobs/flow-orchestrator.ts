import { pool } from "../db";
import { executeStep } from "../services/flow-step-executor";

const TICK_INTERVAL_MS = 30_000; // check every 30 seconds

async function tick(): Promise<void> {
  try {
    // Find all running flow_runs whose next_action_at has passed.
    // Guard: skip (and auto-fail) any run where attempt_count has reached or exceeded the
    // current step's max_attempts to prevent edge-case re-picks.
    const dueRuns = await pool.query(
      `SELECT fr.id, fr.lead_id, fr.current_step_index, fr.attempt_count,
              COALESCE(fs.max_attempts, 3) AS max_attempts
       FROM flow_runs fr
       LEFT JOIN LATERAL (
         SELECT max_attempts FROM flow_steps
         WHERE flow_id = fr.flow_id
         ORDER BY step_order ASC
         LIMIT 1 OFFSET fr.current_step_index
       ) fs ON true
       WHERE fr.status = 'running'
         AND fr.next_action_at <= NOW()
       LIMIT 20`
    );

    if (dueRuns.rows.length > 0) {
      console.log(`[orchestrator] Processing ${dueRuns.rows.length} due flow run(s)`);
    }

    for (const run of dueRuns.rows) {
      // Guard: if attempt_count >= max_attempts, the executor should have already
      // set status='failed'. Force it here to close the race window.
      if ((run.attempt_count ?? 0) >= (run.max_attempts ?? 3)) {
        await pool.query(
          `UPDATE flow_runs
           SET status = 'failed',
               failure_reason = COALESCE(failure_reason, 'Exceeded max attempts (orchestrator guard)'),
               updated_at = NOW()
           WHERE id = $1 AND status = 'running'`,
          [run.id]
        );
        console.warn(`[orchestrator] Force-failed run ${run.id} at attempt cap`);
        continue;
      }

      // Optimistically mark as being processed by bumping next_action_at
      // so concurrent ticks don't double-execute the same run
      const claimed = await pool.query(
        `UPDATE flow_runs
         SET next_action_at = NOW() + INTERVAL '60 seconds', updated_at = NOW()
         WHERE id = $1 AND status = 'running' AND next_action_at <= NOW()
         RETURNING id`,
        [run.id]
      );

      if (!claimed.rows.length) continue; // Another tick grabbed it

      executeStep(run.id, run.lead_id).catch((err) => {
        console.error(`[orchestrator] executeStep failed for run ${run.id}:`, err);
      });
    }
  } catch (err) {
    console.error("[orchestrator] tick error:", err);
  }
}

export function startOrchestrator(): void {
  console.log("[orchestrator] Flow orchestrator started (interval: 30s)");
  setInterval(() => {
    tick().catch((err) =>
      console.error("[orchestrator] Unhandled tick error:", err)
    );
  }, TICK_INTERVAL_MS);

  // Run once immediately after startup
  setTimeout(() => {
    tick().catch((err) =>
      console.error("[orchestrator] Initial tick error:", err)
    );
  }, 5000);
}
