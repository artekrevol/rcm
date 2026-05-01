import twilio from "twilio";
import nodemailer from "nodemailer";
import { pool } from "../db";
import { acquireLock, releaseLock } from "./comm-locks";
import { logFlowEvent } from "./flow-events";
import { checkEligibility, isStediConfigured } from "./stedi-eligibility";
import { getOrgContext, resolveCarrierToPayerId, OrgContext } from "./org-context";

// ── Twilio / email config ──────────────────────────────────────────────────────
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
const twilioMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
const emailTransporter =
  gmailUser && gmailAppPassword
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailAppPassword },
      })
    : null;

// ── Template variable substitution ────────────────────────────────────────────
function applyTemplateVars(
  template: string,
  vars: Record<string, string>
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "")
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+1${digits}`;
}

// ── Condition evaluator (Phase C.3) ───────────────────────────────────────────
interface StepCondition {
  field: string;
  operator: "eq" | "neq" | "in" | "not_in" | "exists" | "not_exists" | "gt" | "gte" | "lt" | "lte" | "contains";
  value?: unknown;
}

function evaluateCondition(
  condition: StepCondition | null | undefined,
  lead: Record<string, unknown>,
  run: Record<string, unknown>
): boolean {
  if (!condition) return true;

  const { field, operator, value } = condition;

  // Resolve field path: lead.*, run.*, run.metadata.*
  let actual: unknown;
  if (field.startsWith("lead.")) {
    actual = lead[field.slice(5)];
  } else if (field.startsWith("run.metadata.")) {
    const meta = (run.metadata as Record<string, unknown>) || {};
    actual = meta[field.slice(13)];
  } else if (field.startsWith("run.")) {
    actual = run[field.slice(4)];
  } else {
    actual = lead[field];
  }

  switch (operator) {
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    case "in":
      return Array.isArray(value) && value.includes(actual);
    case "not_in":
      return Array.isArray(value) && !value.includes(actual);
    case "exists":
      return actual !== null && actual !== undefined && actual !== "";
    case "not_exists":
      return actual === null || actual === undefined || actual === "";
    case "gt":
      return typeof actual === "number" && typeof value === "number" && actual > value;
    case "gte":
      return typeof actual === "number" && typeof value === "number" && actual >= value;
    case "lt":
      return typeof actual === "number" && typeof value === "number" && actual < value;
    case "lte":
      return typeof actual === "number" && typeof value === "number" && actual <= value;
    case "contains":
      return typeof actual === "string" && typeof value === "string" && actual.includes(value);
    default:
      return true;
  }
}

// ── Retry / failure helper ────────────────────────────────────────────────────
export async function handleStepFailure(
  flowRunId: string,
  stepId: string,
  failureReason: string
): Promise<boolean> {
  try {
    const runRes = await pool.query(
      `SELECT attempt_count FROM flow_runs WHERE id = $1`,
      [flowRunId]
    );
    const stepRes = await pool.query(
      `SELECT max_attempts FROM flow_steps WHERE id = $1`,
      [stepId]
    );

    const currentAttempts: number = runRes.rows[0]?.attempt_count ?? 0;
    const maxAttempts: number = stepRes.rows[0]?.max_attempts ?? 3;
    const newAttemptCount = currentAttempts + 1;

    if (newAttemptCount >= maxAttempts) {
      await pool.query(
        `UPDATE flow_runs
         SET status = 'failed',
             attempt_count = $1,
             failure_reason = $2,
             failed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [newAttemptCount, failureReason, flowRunId]
      );
      await logFlowEvent(flowRunId, "step_failed_terminal", {
        message: `Failed permanently after ${newAttemptCount} attempt(s)`,
        reason: failureReason,
      });
      console.warn(
        `[flow-step-executor] Run ${flowRunId} permanently failed after ${newAttemptCount} attempt(s): ${failureReason}`
      );
      return true;
    }

    // Exponential backoff: attempt 1 = +5min, attempt 2 = +15min
    const backoffMinutes = newAttemptCount === 1 ? 5 : 15;
    await pool.query(
      `UPDATE flow_runs
       SET attempt_count = $1,
           failure_reason = $2,
           next_action_at = NOW() + ($3 || ' minutes')::INTERVAL,
           updated_at = NOW()
       WHERE id = $4`,
      [newAttemptCount, failureReason, String(backoffMinutes), flowRunId]
    );
    console.log(
      `[flow-step-executor] Run ${flowRunId} step failed (attempt ${newAttemptCount}/${maxAttempts}), ` +
      `retrying in ${backoffMinutes} min`
    );
    return false;
  } catch (err) {
    console.error("[flow-step-executor] handleStepFailure error:", err);
    return false;
  }
}

// ── Advance to next step ───────────────────────────────────────────────────────
export async function advanceToNextStep(
  flowRunId: string,
  outcome: "success" | "failure"
): Promise<void> {
  try {
    const runResult = await pool.query(
      `SELECT fr.*, f.id AS flow_id_val
       FROM flow_runs fr
       JOIN flows f ON f.id = fr.flow_id
       WHERE fr.id = $1`,
      [flowRunId]
    );

    if (!runResult.rows.length) return;
    const run = runResult.rows[0];

    const nextIndex = (run.current_step_index ?? 0) + 1;

    const nextStep = await pool.query(
      `SELECT id, step_order, delay_minutes, step_type
       FROM flow_steps
       WHERE flow_id = $1
       ORDER BY step_order ASC
       LIMIT 1 OFFSET $2`,
      [run.flow_id, nextIndex]
    );

    if (!nextStep.rows.length) {
      await pool.query(
        `UPDATE flow_runs
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [flowRunId]
      );
      await logFlowEvent(flowRunId, "flow_completed", {
        message: "All steps completed",
        outcome,
      });
      return;
    }

    const step = nextStep.rows[0];
    const delayMs = (step.delay_minutes ?? 0) * 60 * 1000;
    const nextActionAt = new Date(Date.now() + delayMs);

    await pool.query(
      `UPDATE flow_runs
       SET current_step_index = $1, next_action_at = $2,
           attempt_count = 0, failure_reason = NULL, updated_at = NOW()
       WHERE id = $3`,
      [nextIndex, nextActionAt, flowRunId]
    );

    await logFlowEvent(flowRunId, "step_advanced", {
      message: `Advanced to step index ${nextIndex} (type: ${step.step_type})`,
      stepId: step.id,
      outcome,
    });
  } catch (err) {
    console.error("[flow-step-executor] advanceToNextStep error:", err);
  }
}

// ── Provider matching helper ───────────────────────────────────────────────────
async function executeProviderMatch(
  flowRunId: string,
  step: Record<string, unknown>,
  lead: Record<string, unknown>,
  orgCtx: OrgContext
): Promise<void> {
  const leadId = lead.id as string;
  const serviceTypeRequested = (lead.service_type_requested || lead.service_needed) as string | null;
  const languagePref = (lead.language_preference || "en") as string;

  let candidates = orgCtx.providers.filter((p) => p.is_active);

  if (serviceTypeRequested) {
    const byService = candidates.filter((p) =>
      (p.service_types as string[]).includes(serviceTypeRequested)
    );
    if (byService.length > 0) candidates = byService;
  }

  if (languagePref) {
    const byLang = candidates.filter((p) =>
      (p.languages as string[]).includes(languagePref)
    );
    if (byLang.length > 0) candidates = byLang;
  }

  if (candidates.length === 0) {
    await logFlowEvent(flowRunId, "no_provider_match", {
      message: "No provider matched lead criteria",
      serviceTypeRequested,
      languagePref,
      stepId: step.id,
    });
    await advanceToNextStep(flowRunId, "failure");
    return;
  }

  // Round-robin: pick based on lead ID hash for determinism
  const idx = Math.abs(leadId.charCodeAt(0)) % candidates.length;
  const matched = candidates[idx];

  await pool.query(
    `UPDATE leads SET matched_provider_id = $1, updated_at = NOW() WHERE id = $2`,
    [matched.id, leadId]
  );

  await logFlowEvent(flowRunId, "provider_matched", {
    providerId: matched.id,
    providerName: `${matched.first_name} ${matched.last_name}`,
    stepId: step.id,
  });

  await advanceToNextStep(flowRunId, "success");
}

// ── Appointment schedule helper ────────────────────────────────────────────────
async function executeAppointmentSchedule(
  flowRunId: string,
  step: Record<string, unknown>,
  lead: Record<string, unknown>,
  orgCtx: OrgContext
): Promise<void> {
  const config = (step.config as Record<string, unknown>) || {};
  const mode = config.mode || "manual_handoff";

  if (mode === "manual_handoff") {
    const admins = await pool.query(
      `SELECT email, first_name FROM users WHERE organization_id = $1 AND role = 'admin'`,
      [orgCtx.organization_id]
    );

    const providerResult = lead.matched_provider_id
      ? await pool.query(
          `SELECT first_name, last_name FROM org_providers WHERE id = $1`,
          [lead.matched_provider_id]
        )
      : { rows: [] };

    const providerName = providerResult.rows.length > 0
      ? `${providerResult.rows[0].first_name} ${providerResult.rows[0].last_name}`
      : "your provider";

    const leadUrl = `https://claimshield.health/intake/leads/${lead.id}`;
    const notifyMsg = `New lead ${lead.first_name || ""} ${lead.last_name || ""} matched to ${providerName}. Please schedule appointment: ${leadUrl}`;

    for (const admin of admins.rows) {
      if (twilioClient && lead.phone) {
        await twilioClient.messages.create({
          body: notifyMsg,
          to: formatPhone(admin.phone || ""),
          ...(twilioMessagingServiceSid
            ? { messagingServiceSid: twilioMessagingServiceSid }
            : { from: process.env.TWILIO_PHONE_NUMBER }),
        } as any).catch((e: unknown) =>
          console.error("[appointment_schedule] SMS to admin failed:", e)
        );
      }
      if (emailTransporter && admin.email) {
        const templateKey = "admin_handoff_email";
        const tmpl = orgCtx.templates[`${templateKey}::email`] || orgCtx.templates[templateKey];
        const subject = tmpl?.subject
          ? applyTemplateVars(tmpl.subject, {
              first_name: String(lead.first_name || ""),
              last_name: String(lead.last_name || ""),
              provider_name: providerName,
            })
          : `New lead for scheduling: ${lead.first_name || ""}`;
        const body = tmpl?.body
          ? applyTemplateVars(tmpl.body, {
              first_name: String(lead.first_name || ""),
              last_name: String(lead.last_name || ""),
              provider_name: providerName,
              service_type: String(lead.service_type_requested || lead.service_needed || ""),
              lead_id: String(lead.id),
            })
          : notifyMsg;
        await emailTransporter.sendMail({
          from: gmailUser,
          to: admin.email,
          subject,
          text: body,
        }).catch((e: unknown) =>
          console.error("[appointment_schedule] Email to admin failed:", e)
        );
      }
    }

    await logFlowEvent(flowRunId, "appointment_handoff_sent", {
      adminsNotified: admins.rows.length,
      providerName,
      stepId: step.id,
    });
  }

  await advanceToNextStep(flowRunId, "success");
}

// ── Main execute step ──────────────────────────────────────────────────────────
export async function executeStep(
  flowRunId: string,
  leadId: string
): Promise<void> {
  let lockId: string | null = null;
  let currentStepId: string | null = null;

  try {
    // Load flow run + current step
    const runResult = await pool.query(
      `SELECT fr.current_step_index, fr.flow_id, fr.organization_id, fr.metadata
       FROM flow_runs fr
       WHERE fr.id = $1`,
      [flowRunId]
    );
    if (!runResult.rows.length) return;
    const run = runResult.rows[0];

    // Determine org — run's organization_id takes priority, then flow's
    let organizationId = run.organization_id as string | null;
    if (!organizationId) {
      const flowRes = await pool.query(
        `SELECT organization_id FROM flows WHERE id = $1`,
        [run.flow_id]
      );
      organizationId = flowRes.rows[0]?.organization_id || null;
    }

    const stepResult = await pool.query(
      `SELECT *
       FROM flow_steps
       WHERE flow_id = $1
       ORDER BY step_order ASC
       LIMIT 1 OFFSET $2`,
      [run.flow_id, run.current_step_index]
    );
    if (!stepResult.rows.length) {
      await advanceToNextStep(flowRunId, "success");
      return;
    }
    const step = stepResult.rows[0];
    currentStepId = step.id;

    // Load lead
    const leadResult = await pool.query(
      `SELECT * FROM leads WHERE id = $1`,
      [leadId]
    );
    if (!leadResult.rows.length) {
      console.warn(`[flow-step-executor] Lead ${leadId} not found`);
      return;
    }
    const lead = leadResult.rows[0];

    // ── Engagement halt guard ──────────────────────────────────────────────────
    if (lead.engagement_halted === true) {
      await pool.query(
        `UPDATE flow_runs SET status = 'halted', halted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'running'`,
        [flowRunId]
      );
      await logFlowEvent(flowRunId, "flow_halted", {
        reason: "Lead engagement_halted flag is set — all steps blocked",
      });
      console.warn(`[flow-step-executor] Run ${flowRunId} halted — lead ${leadId} has engagement_halted=true`);
      return;
    }

    // ── Load org context (cached 60s) ──────────────────────────────────────────
    const orgCtx = organizationId
      ? await getOrgContext(organizationId)
      : { organization_id: "", templates: {}, personas: {}, service_types: [], payers: [], lead_sources: [], providers: [] };

    // ── Condition evaluator (Phase C.3) ───────────────────────────────────────
    const condition = step.condition as StepCondition | null;
    if (condition && !evaluateCondition(condition, lead, run)) {
      await logFlowEvent(flowRunId, "step_skipped", {
        reason: `condition_false: ${condition.field} ${condition.operator} ${JSON.stringify(condition.value)}`,
        stepId: step.id,
        stepType: step.step_type,
      });
      console.log(
        `[flow-step-executor] Step ${step.step_order} (${step.step_type}) skipped — condition false`
      );
      await advanceToNextStep(flowRunId, "success");
      return;
    }

    const firstName = lead.first_name || lead.name?.split(" ")[0] || "";
    const templateVars: Record<string, string> = {
      first_name: firstName,
      last_name: lead.last_name || "",
      name: lead.name || firstName,
      state: lead.state || "",
      service_type: lead.service_needed || lead.service_type_requested || "",
      appointment_date: lead.appointment_date || "",
      appointment_time: lead.appointment_time || "",
      provider_name: "",
      lead_id: String(lead.id),
    };

    await logFlowEvent(flowRunId, "step_started", {
      stepType: step.step_type,
      stepId: step.id,
      stepOrder: step.step_order,
    });

    // ── Step type handlers ─────────────────────────────────────────────────────

    if (step.step_type === "wait") {
      await advanceToNextStep(flowRunId, "success");
      return;
    }

    // ── sms_message ────────────────────────────────────────────────────────────
    if (step.step_type === "sms_message" || step.step_type === "sms") {
      if (!twilioClient) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Twilio not configured",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }
      if (!lead.phone) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Lead has no phone",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      lockId = await acquireLock({
        leadId,
        acquiredByType: "flow",
        acquiredById: flowRunId,
        channel: "sms",
        reason: `Flow SMS step ${step.step_order}`,
        durationMinutes: 5,
      });
      if (!lockId) {
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '2 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        return;
      }

      // Resolve body: template_key lookup → template_inline fallback
      let body: string;
      if (step.template_key && orgCtx.templates[step.template_key]) {
        body = applyTemplateVars(orgCtx.templates[step.template_key].body, templateVars);
      } else if (step.template_inline) {
        body = applyTemplateVars(step.template_inline, templateVars);
      } else {
        body = `Hi ${firstName}, this is a follow-up from our team.`;
      }

      let smsSent = false;
      try {
        const msgParams: Record<string, string> = {
          body,
          to: formatPhone(lead.phone),
        };
        if (twilioMessagingServiceSid) {
          msgParams.messagingServiceSid = twilioMessagingServiceSid;
        } else if (process.env.TWILIO_PHONE_NUMBER) {
          msgParams.from = process.env.TWILIO_PHONE_NUMBER;
        }
        await twilioClient!.messages.create(msgParams as any);
        smsSent = true;

        await pool.query(
          `INSERT INTO activity_logs (lead_id, activity_type, description, created_at, organization_id)
           VALUES ($1, 'sms_sent', $2, NOW(), $3)`,
          [leadId, `[Flow] SMS sent: ${body.slice(0, 80)}`, lead.organization_id]
        );
        await logFlowEvent(flowRunId, "sms_sent", {
          message: `SMS sent: ${body.slice(0, 60)}`,
          stepId: step.id,
        });
      } catch (smsErr: any) {
        console.error("[flow-step-executor] Twilio SMS error:", smsErr?.message || smsErr);
        await logFlowEvent(flowRunId, "step_failed", {
          reason: `Twilio error: ${smsErr?.message || String(smsErr)}`,
          stepId: step.id,
        });
      } finally {
        await releaseLock(lockId);
        lockId = null;
      }

      await advanceToNextStep(flowRunId, smsSent ? "success" : "failure");
      return;
    }

    // ── voice_call ─────────────────────────────────────────────────────────────
    if (step.step_type === "voice_call" || step.step_type === "call") {
      const vapiApiKey = process.env.VAPI_API_KEY;
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
      const stepConfig = (step.config as Record<string, unknown>) || {};
      const personaKey = (stepConfig.persona_key as string) || "intake_coordinator";
      const persona = orgCtx.personas[personaKey];
      const assistantId = persona?.vapi_assistant_id || process.env.VAPI_ASSISTANT_ID;

      if (!vapiApiKey || !assistantId || !phoneNumberId) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Vapi not configured (missing API key, assistant ID, or phone number ID)",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }
      if (!lead.phone) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Lead has no phone",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }
      if (lead.consent_to_call === false) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Lead declined consent to call (consent_to_call=false)",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      // Business hours guard (8am-8pm ET)
      if (!process.env.CALL_WINDOW_OVERRIDE) {
        const utcHour = new Date().getUTCHours();
        const etHour = ((utcHour - 5) % 24 + 24) % 24;
        if (etHour < 8 || etHour >= 20) {
          const nextCallAt = new Date();
          nextCallAt.setUTCHours(13, 0, 0, 0);
          if (nextCallAt <= new Date()) nextCallAt.setUTCDate(nextCallAt.getUTCDate() + 1);
          await pool.query(
            `UPDATE flow_runs SET next_action_at = $1, updated_at = NOW() WHERE id = $2`,
            [nextCallAt, flowRunId]
          );
          await logFlowEvent(flowRunId, "step_deferred", {
            reason: `Outside calling hours (ET hour: ${etHour}). Next attempt at ${nextCallAt.toISOString()}`,
            stepId: step.id,
          });
          return;
        }
      }

      // In-progress call dedup guard
      const existingCall = await pool.query(
        `SELECT id FROM calls WHERE lead_id = $1 AND disposition = 'in_progress' LIMIT 1`,
        [leadId]
      );
      if (existingCall.rows.length > 0) {
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '30 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        await logFlowEvent(flowRunId, "step_deferred", {
          reason: "Existing in_progress call found for lead — waiting for webhook",
          stepId: step.id,
        });
        return;
      }

      lockId = await acquireLock({
        leadId,
        acquiredByType: "flow",
        acquiredById: flowRunId,
        channel: "call",
        reason: `Flow Vapi call step ${step.step_order}`,
        durationMinutes: 240,
      });
      if (!lockId) {
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '2 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        return;
      }

      const lFirstName = lead.first_name || (lead.name as string)?.split(" ")[0] || "Unknown";
      const lLastName = lead.last_name || (lead.name as string)?.split(" ").slice(1).join(" ") || "";

      const vapiPayload = {
        assistantId,
        phoneNumberId,
        customer: {
          number: formatPhone(lead.phone),
          name: lead.name || "Patient",
        },
        metadata: {
          leadId,
          flowRunId,
          lockId,
          orgId: organizationId,
        },
        assistantOverrides: {
          variableValues: {
            patient_first_name: lFirstName,
            patient_last_name: lLastName,
            patient_full_name: lead.name || `${lFirstName} ${lLastName}`.trim(),
            patient_phone: lead.phone || "Unknown",
            patient_state: lead.state || "Unknown",
            service_needed: lead.service_needed || "Unknown",
            insurance_carrier: lead.insurance_carrier || "Unknown",
            clinic_name: persona?.persona_name || "Care Coordinator",
          },
          transcriber: {
            provider: "deepgram",
            model: "nova-2",
            language: "en",
            endpointing: 300,
          },
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            temperature: 0.2,
          },
          voice: {
            provider: "11labs",
            voiceId: "21m00Tcm4TlvDq8ikWAM",
            stability: 0.5,
            similarityBoost: 0.75,
          },
          silenceTimeoutSeconds: 30,
          maxDurationSeconds: 900,
          backgroundDenoisingEnabled: true,
        },
      };

      const response = await fetch("https://api.vapi.ai/call/phone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vapiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(vapiPayload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const errMsg = JSON.stringify(err);
        console.error("[flow-step-executor] Vapi call failed:", err);
        await releaseLock(lockId);
        lockId = null;
        await logFlowEvent(flowRunId, "step_failed", {
          reason: "Vapi call initiation failed",
          stepId: step.id,
          error: errMsg,
        });
        await handleStepFailure(flowRunId, step.id, `Vapi call initiation failed: ${errMsg}`);
        return;
      }

      const callData = await response.json();
      console.log(`[flow-step-executor] Vapi call created: vapi_call_id=${callData.id}`);

      await pool.query(
        `INSERT INTO calls
           (id, lead_id, vapi_call_id, transcript, summary, disposition, organization_id, channel)
         VALUES (gen_random_uuid()::text, $1, $2, '', 'Flow call initiated', 'in_progress', $3, 'vapi')
         ON CONFLICT DO NOTHING`,
        [leadId, callData.id, lead.organization_id]
      );

      await logFlowEvent(flowRunId, "voice_call_initiated", {
        message: `Vapi call initiated: ${callData.id}`,
        vapiCallId: callData.id,
        assistantId,
        personaKey,
        stepId: step.id,
      });

      // Push next_action_at far out — webhook advances when call ends
      await pool.query(
        `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '4 hours', updated_at = NOW() WHERE id = $1`,
        [flowRunId]
      );
      // Lock intentionally NOT released here — webhook handler releases it
      return;
    }

    // ── email_message ──────────────────────────────────────────────────────────
    if (step.step_type === "email_message" || step.step_type === "email") {
      if (!emailTransporter || !gmailUser) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Gmail not configured",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }
      if (!lead.email) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Lead has no email",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      lockId = await acquireLock({
        leadId,
        acquiredByType: "flow",
        acquiredById: flowRunId,
        channel: "email",
        reason: `Flow email step ${step.step_order}`,
        durationMinutes: 5,
      });
      if (!lockId) {
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '2 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        return;
      }

      let subject: string;
      let body: string;

      if (step.template_key) {
        const tmplSms = orgCtx.templates[`${step.template_key}::email`] || orgCtx.templates[step.template_key];
        subject = tmplSms?.subject
          ? applyTemplateVars(tmplSms.subject, templateVars)
          : `Follow-up from our team`;
        body = tmplSms?.body
          ? applyTemplateVars(tmplSms.body, templateVars)
          : `Hi ${firstName}, this is a follow-up from our team.`;
      } else {
        subject = applyTemplateVars(step.subject_inline || "Follow-up from our team", templateVars);
        body = step.template_inline
          ? applyTemplateVars(step.template_inline, templateVars)
          : `Hi ${firstName}, this is a follow-up from our team.`;
      }

      let emailSent = false;
      try {
        await emailTransporter!.sendMail({
          from: gmailUser,
          to: lead.email,
          subject,
          text: body,
        });
        emailSent = true;

        await logFlowEvent(flowRunId, "email_sent", {
          message: `Email sent to ${lead.email}`,
          stepId: step.id,
        });
        await pool.query(
          `INSERT INTO activity_logs (lead_id, activity_type, description, created_at, organization_id)
           VALUES ($1, 'email_sent', $2, NOW(), $3)`,
          [leadId, `[Flow] Email sent: ${subject}`, lead.organization_id]
        );
      } catch (emailErr: any) {
        console.error("[flow-step-executor] Gmail error:", emailErr?.message || emailErr);
        await logFlowEvent(flowRunId, "step_failed", {
          reason: `Gmail error: ${emailErr?.message || String(emailErr)}`,
          stepId: step.id,
        });
      } finally {
        await releaseLock(lockId);
        lockId = null;
      }

      await advanceToNextStep(flowRunId, emailSent ? "success" : "failure");
      return;
    }

    // ── vob_check ──────────────────────────────────────────────────────────────
    if (step.step_type === "vob_check") {
      if (!isStediConfigured()) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Stedi not configured",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      const carrier = lead.insurance_carrier || "";
      const memberId = lead.insurance_member_id || lead.member_id || "";
      const dob = lead.date_of_birth || lead.dob || "";
      const lFirstName = lead.first_name || (lead.name as string)?.split(" ")[0] || "";
      const lLastName = lead.last_name || (lead.name as string)?.split(" ").slice(1).join(" ") || "";

      if (!memberId || !dob || !lFirstName || !lLastName) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Insufficient lead data for VOB (member_id, dob, name required)",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      const settingsResult = await pool.query(
        `SELECT primary_npi, practice_name FROM practice_settings WHERE organization_id = $1 LIMIT 1`,
        [organizationId]
      );
      const providerNpi = settingsResult.rows[0]?.primary_npi || "1234567890";
      const providerName = settingsResult.rows[0]?.practice_name || "Care Provider";

      const tradingPartnerId = resolveCarrierToPayerId(carrier, orgCtx.payers);

      let vobSucceeded = false;
      try {
        const result = await checkEligibility({
          controlNumber: String(Math.floor(Math.random() * 900000000) + 100000000),
          tradingPartnerServiceId: tradingPartnerId,
          providerNpi,
          providerName,
          subscriberFirstName: lFirstName,
          subscriberLastName: lLastName,
          subscriberDob: dob,
          subscriberMemberId: memberId,
          serviceTypeCodes: ["MH"],
        });

        const vobScore = result.status === "active" ? 100 : 25;
        await pool.query(
          `UPDATE leads SET vob_score = $1, vob_status = $2, updated_at = NOW() WHERE id = $3`,
          [vobScore, result.status === "active" ? "verified" : "incomplete", leadId]
        );

        await logFlowEvent(flowRunId, "vob_completed", {
          message: `VOB check complete: ${result.status}`,
          vobScore,
          policyStatus: result.policyStatus,
          planName: result.planName,
          stepId: step.id,
        });
        await pool.query(
          `INSERT INTO activity_logs (lead_id, activity_type, description, created_at, organization_id)
           VALUES ($1, 'vob_completed', $2, NOW(), $3)`,
          [
            leadId,
            `[Flow] VOB via Stedi: ${result.status} — plan: ${result.planName || "unknown"}`,
            lead.organization_id,
          ]
        );
        vobSucceeded = true;
      } catch (err) {
        console.error("[flow-step-executor] Stedi VOB error:", err);
        await logFlowEvent(flowRunId, "step_failed", {
          reason: "Stedi eligibility error",
          error: String(err),
          stepId: step.id,
        });
      }

      await advanceToNextStep(flowRunId, vobSucceeded ? "success" : "failure");
      return;
    }

    // ── provider_match ─────────────────────────────────────────────────────────
    if (step.step_type === "provider_match") {
      await executeProviderMatch(flowRunId, step, lead, orgCtx);
      return;
    }

    // ── appointment_schedule ───────────────────────────────────────────────────
    if (step.step_type === "appointment_schedule") {
      await executeAppointmentSchedule(flowRunId, step, lead, orgCtx);
      return;
    }

    // ── webhook ────────────────────────────────────────────────────────────────
    if (step.step_type === "webhook") {
      const config = (step.config as Record<string, unknown>) || {};
      const url = config.url as string;
      const method = ((config.method as string) || "POST").toUpperCase();
      const headers = (config.headers as Record<string, string>) || {};
      const timeout = (config.timeout as number) || 10000;

      if (!url) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Webhook step missing url in config",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeout);
        const resp = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          body: method !== "GET" ? JSON.stringify({ lead, flowRunId, orgId: organizationId }) : undefined,
          signal: controller.signal,
        });
        clearTimeout(tid);

        await logFlowEvent(flowRunId, "webhook_called", {
          url,
          method,
          status: resp.status,
          stepId: step.id,
        });

        if (!resp.ok) {
          throw new Error(`Webhook returned ${resp.status}`);
        }
        await advanceToNextStep(flowRunId, "success");
      } catch (err: any) {
        console.error("[flow-step-executor] Webhook error:", err);
        await logFlowEvent(flowRunId, "step_failed", {
          reason: `Webhook error: ${err?.message || String(err)}`,
          stepId: step.id,
        });
        await handleStepFailure(flowRunId, step.id, `Webhook failed: ${err?.message}`);
      }
      return;
    }

    // Unknown step type — skip and advance
    console.warn(`[flow-step-executor] Unknown step type: ${step.step_type}`);
    await logFlowEvent(flowRunId, "step_skipped", {
      reason: `Unknown step type: ${step.step_type}`,
      stepId: step.id,
    });
    await advanceToNextStep(flowRunId, "failure");
  } catch (err) {
    console.error("[flow-step-executor] executeStep error:", err);
    if (lockId) {
      await releaseLock(lockId).catch(() => {});
    }
    await logFlowEvent(flowRunId, "step_failed", {
      error: String(err),
      stepId: currentStepId ?? undefined,
    });
    if (currentStepId) {
      await handleStepFailure(flowRunId, currentStepId, String(err)).catch(() => {});
    }
  }
}
