import { pool } from "../db";
import { logFlowEvent } from "./flow-events";

interface LeadForTrigger {
  id: string;
  source?: string | null;
  organizationId?: string | null;
  [key: string]: unknown;
}

export async function triggerMatchingFlows(lead: LeadForTrigger): Promise<void> {
  try {
    // Find all active flows triggered by lead_created
    const flowsResult = await pool.query(
      `SELECT id, name, trigger_conditions, organization_id
       FROM flows
       WHERE trigger_event = 'lead_created'
         AND is_active = true`
    );

    for (const flow of flowsResult.rows) {
      const conditions: Record<string, unknown> = flow.trigger_conditions || {};

      // Check trigger conditions against the lead
      let matches = true;
      for (const [key, value] of Object.entries(conditions)) {
        // Map condition keys to lead fields
        const leadValue =
          key === "source" ? lead.source : (lead as Record<string, unknown>)[key];
        if (leadValue !== value) {
          matches = false;
          break;
        }
      }

      if (!matches) continue;

      // Get the first step of this flow to compute next_action_at
      const firstStep = await pool.query(
        `SELECT id, step_order, delay_minutes
         FROM flow_steps
         WHERE flow_id = $1
         ORDER BY step_order ASC
         LIMIT 1`,
        [flow.id]
      );

      const delayMinutes =
        firstStep.rows.length > 0 ? firstStep.rows[0].delay_minutes || 0 : 0;
      const nextActionAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      // Create flow run
      const runResult = await pool.query(
        `INSERT INTO flow_runs
           (flow_id, lead_id, status, current_step_index, next_action_at, organization_id)
         VALUES ($1, $2, 'running', 0, $3, $4)
         RETURNING id`,
        [flow.id, lead.id, nextActionAt, lead.organizationId || flow.organization_id || null]
      );

      const flowRunId = runResult.rows[0].id;

      await logFlowEvent(flowRunId, "flow_started", {
        message: `Flow '${flow.name}' started for lead ${lead.id}`,
        leadId: lead.id,
        flowId: flow.id,
      });

      console.log(
        `[flow-trigger] Started flow_run ${flowRunId} (flow: ${flow.name}) for lead ${lead.id}`
      );
    }
  } catch (err) {
    console.error("[flow-trigger] triggerMatchingFlows error:", err);
  }
}
