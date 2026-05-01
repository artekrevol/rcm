import twilio from "twilio";
import nodemailer from "nodemailer";
import { pool } from "../db";
import { acquireLock, releaseLock } from "./comm-locks";
import { logFlowEvent } from "./flow-events";
import { checkEligibility, isStediConfigured } from "./stedi-eligibility";
import { CARITAS } from "../config/caritas-constants";

// ── Twilio / email config (mirror routes.ts inline pattern) ───────────────────
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

// ── Retry / failure helper ────────────────────────────────────────────────────
/**
 * Called whenever a retryable step failure occurs (e.g. Vapi call rejected).
 * Increments attempt_count; if still under the step's max_attempts cap, reschedules
 * with exponential backoff. At cap, marks the flow run as permanently failed.
 * Returns true if the run was permanently failed, false if rescheduled.
 */
export async function handleStepFailure(
  flowRunId: string,
  stepId: string,
  failureReason: string
): Promise<boolean> {
  try {
    // Fetch current attempt_count and the step's max_attempts
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
      // At cap — permanently fail the run
      await pool.query(
        `UPDATE flow_runs
         SET status = 'failed', attempt_count = $1, failure_reason = $2, updated_at = NOW()
         WHERE id = $3`,
        [newAttemptCount, failureReason, flowRunId]
      );
      await logFlowEvent(flowRunId, "flow_failed", {
        message: `Failed permanently after ${newAttemptCount} attempt(s)`,
        failureReason,
        stepId,
      });
      console.log(
        `[flow-step-executor] Flow run ${flowRunId} failed after ${newAttemptCount} attempt(s): ${failureReason}`
      );
      return true;
    }

    // Under cap — reschedule with backoff
    // attempt_count=1 → immediate, 2 → +5 min, 3+ → +15 min
    let delayMinutes = 0;
    if (newAttemptCount === 2) delayMinutes = 5;
    else if (newAttemptCount >= 3) delayMinutes = 15;

    await pool.query(
      `UPDATE flow_runs
       SET attempt_count = $1, next_action_at = NOW() + ($2 || ' minutes')::INTERVAL, updated_at = NOW()
       WHERE id = $3`,
      [newAttemptCount, String(delayMinutes), flowRunId]
    );
    console.log(
      `[flow-step-executor] Flow run ${flowRunId} step failed (attempt ${newAttemptCount}/${maxAttempts}), ` +
      `retrying in ${delayMinutes} min`
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

    // Find next step
    const nextStep = await pool.query(
      `SELECT id, step_order, delay_minutes, step_type
       FROM flow_steps
       WHERE flow_id = $1
       ORDER BY step_order ASC
       LIMIT 1 OFFSET $2`,
      [run.flow_id, nextIndex]
    );

    if (!nextStep.rows.length) {
      // No more steps — complete the run
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

    // Reset per-step retry state when moving to a new step
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
      `SELECT fr.current_step_index, fr.flow_id, fr.organization_id
       FROM flow_runs fr
       WHERE fr.id = $1`,
      [flowRunId]
    );
    if (!runResult.rows.length) return;
    const run = runResult.rows[0];

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

    const firstName = lead.first_name || lead.name?.split(" ")[0] || "";
    const state = lead.state || "";
    const templateVars = {
      first_name: firstName,
      last_name: lead.last_name || "",
      name: lead.name || firstName,
      state,
    };

    await logFlowEvent(flowRunId, "step_started", {
      stepType: step.step_type,
      stepId: step.id,
      stepOrder: step.step_order,
    });

    // ── Handle each step type ────────────────────────────────────────────────

    if (step.step_type === "wait") {
      // Nothing to do — advance immediately (delay was already baked into next_action_at)
      await advanceToNextStep(flowRunId, "success");
      return;
    }

    if (step.step_type === "sms") {
      if (!twilioClient) {
        console.warn("[flow-step-executor] Twilio not configured; skipping SMS step");
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Twilio not configured (missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN)",
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
        // Lead is locked — reschedule in 2 minutes
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '2 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        return;
      }

      const body = step.template_inline
        ? applyTemplateVars(step.template_inline, templateVars)
        : "Hi, this is Caritas Senior Care following up on your inquiry.";

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

        await logFlowEvent(flowRunId, "step_completed", {
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

    if (step.step_type === "call") {
      const vapiApiKey = process.env.VAPI_API_KEY;
      const assistantId = process.env.VAPI_ASSISTANT_ID;
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

      if (!vapiApiKey || !assistantId || !phoneNumberId) {
        console.warn("[flow-step-executor] Vapi not configured; skipping call step");
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Vapi not configured",
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

      // ── Fix 1: Consent check ─────────────────────────────────────────────────
      // If the lead explicitly declined consent (captured from a prior call transcript),
      // skip ALL future call steps for this lead permanently.
      if (lead.consent_to_call === false) {
        console.warn(`[flow-step-executor] Lead ${leadId} has consent_to_call=false — skipping call step`);
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Lead declined consent to call (consent_to_call=false)",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      // ── Fix 2: Business hours guard (Eastern Time) ───────────────────────────
      // Only place calls between 8:00 AM and 8:00 PM ET (UTC-5 standard / UTC-4 daylight).
      // We use UTC-5 as a safe conservative offset (never earlier than 8am ET).
      // CALL_WINDOW_OVERRIDE=true in env skips this guard for dev/testing.
      const CALL_HOUR_START = 8;  // 8:00 AM ET
      const CALL_HOUR_END   = 20; // 8:00 PM ET
      const ET_UTC_OFFSET   = -5; // conservative (EST); EDT is -4 but -5 is safer
      if (!process.env.CALL_WINDOW_OVERRIDE) {
        const utcHour = new Date().getUTCHours();
        const etHour  = ((utcHour + ET_UTC_OFFSET) % 24 + 24) % 24;
        if (etHour < CALL_HOUR_START || etHour >= CALL_HOUR_END) {
          // Reschedule to 8:00 AM ET today (or tomorrow if already past 8pm ET)
          const now = new Date();
          const nextCallAt = new Date(now);
          // Target 8am ET = 13:00 UTC (EST) — set hours in UTC
          nextCallAt.setUTCHours(13, 0, 0, 0);
          if (nextCallAt <= now) nextCallAt.setUTCDate(nextCallAt.getUTCDate() + 1);
          await pool.query(
            `UPDATE flow_runs SET next_action_at = $1, updated_at = NOW() WHERE id = $2`,
            [nextCallAt, flowRunId]
          );
          console.log(
            `[flow-step-executor] Call step deferred — outside business hours ` +
            `(ET hour: ${etHour}). Rescheduled to ${nextCallAt.toISOString()}`
          );
          await logFlowEvent(flowRunId, "step_deferred", {
            reason: `Outside calling hours (ET hour: ${etHour}). Next attempt at ${nextCallAt.toISOString()}`,
            stepId: step.id,
          });
          return;
        }
      }

      // ── Fix 3: In-progress call dedup ────────────────────────────────────────
      // If a Vapi call is already in_progress for this lead (e.g. webhook not yet
      // received from a prior attempt), do NOT fire a second call. Reschedule.
      const existingCall = await pool.query(
        `SELECT id FROM calls WHERE lead_id = $1 AND disposition = 'in_progress' LIMIT 1`,
        [leadId]
      );
      if (existingCall.rows.length > 0) {
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '30 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        console.warn(
          `[flow-step-executor] Call step deferred — lead ${leadId} already has an in_progress call. ` +
          `Rescheduling in 30 min.`
        );
        await logFlowEvent(flowRunId, "step_deferred", {
          reason: "Existing in_progress call found for lead — waiting for webhook",
          stepId: step.id,
        });
        return;
      }

      // ── Fix 4: Lock duration extended to match next_action_at window ─────────
      // The call step pushes next_action_at to +4 hours. The lock must cover at
      // least that window, otherwise it expires and a concurrent tick can re-fire.
      lockId = await acquireLock({
        leadId,
        acquiredByType: "flow",
        acquiredById: flowRunId,
        channel: "call",
        reason: `Flow Vapi call step ${step.step_order}`,
        durationMinutes: 240, // 4 hours — matches the next_action_at offset below
      });

      if (!lockId) {
        await pool.query(
          `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '2 minutes', updated_at = NOW() WHERE id = $1`,
          [flowRunId]
        );
        return;
      }

      const nameParts = (lead.name || "").split(" ");
      const lFirstName = lead.first_name || nameParts[0] || "Unknown";
      const lLastName = lead.last_name || nameParts.slice(1).join(" ") || "";

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
            clinic_name: "Caritas Senior Care",
            clinic_callback_number: "(888) 555-0100",
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
        // Increment attempt_count; reschedule with backoff or fail permanently
        await handleStepFailure(flowRunId, step.id, `Vapi call initiation failed: ${errMsg}`);
        return;
      }

      const callData = await response.json();
      console.log(`[flow-step-executor] Vapi call created: vapi_call_id=${callData.id}`);
      await pool.query(
        `INSERT INTO calls
           (id, lead_id, vapi_call_id, transcript, summary, disposition, organization_id)
         VALUES (gen_random_uuid()::text, $1, $2, '', 'Flow call initiated', 'in_progress', $3)
         ON CONFLICT DO NOTHING`,
        [leadId, callData.id, lead.organization_id]
      );

      await logFlowEvent(flowRunId, "step_started_call", {
        message: `Vapi call initiated: ${callData.id}`,
        vapiCallId: callData.id,
        stepId: step.id,
      });

      // Push next_action_at far out so the orchestrator does not re-fire
      // this step while we wait for the Vapi end-of-call-report webhook.
      // The webhook will call advanceToNextStep() when the call ends.
      // If the webhook never arrives within 4 hours the orchestrator will
      // treat this as a timeout and retry (or an operator can manually advance).
      await pool.query(
        `UPDATE flow_runs SET next_action_at = NOW() + INTERVAL '4 hours', updated_at = NOW() WHERE id = $1`,
        [flowRunId]
      );

      // NOTE: lock is intentionally NOT released here — it will be released
      // in the Vapi webhook end-of-call-report handler (server/routes.ts),
      // which also calls advanceToNextStep().
      return;
    }

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
      const lFirstName = lead.first_name || lead.name?.split(" ")[0] || "";
      const lLastName =
        lead.last_name || lead.name?.split(" ").slice(1).join(" ") || "";

      if (!memberId || !dob || !lFirstName || !lLastName) {
        await logFlowEvent(flowRunId, "step_skipped", {
          reason: "Insufficient lead data for VOB (member_id, dob, name required)",
          stepId: step.id,
        });
        await advanceToNextStep(flowRunId, "failure");
        return;
      }

      // Fetch practice settings for provider NPI
      const settingsResult = await pool.query(
        `SELECT primary_npi, practice_name FROM practice_settings LIMIT 1`
      );
      const providerNpi = settingsResult.rows[0]?.primary_npi || "1234567890";
      const providerName = settingsResult.rows[0]?.practice_name || "Caritas Senior Care";

      // Map common carrier names to Stedi trading partner IDs using CARITAS.payerMappings
      const carrierToPayerId = (carrierName: string): string => {
        const n = carrierName.toLowerCase();
        for (const [key, id] of Object.entries(CARITAS.payerMappings)) {
          if (n.includes(key.toLowerCase())) return id;
        }
        return "00010";
      };

      let vobSucceeded = false;
      try {
        const result = await checkEligibility({
          controlNumber: String(Math.floor(Math.random() * 900000000) + 100000000),
          tradingPartnerServiceId: carrierToPayerId(carrier),
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
          [
            vobScore,
            result.status === "active" ? "verified" : "incomplete",
            leadId,
          ]
        );

        await logFlowEvent(flowRunId, "step_completed", {
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

    if (step.step_type === "email") {
      if (!emailTransporter || !gmailUser) {
        console.warn("[flow-step-executor] Gmail not configured; skipping email step");
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

      const subject = applyTemplateVars(
        step.subject_inline || CARITAS.emailTemplates.nurture.subject,
        templateVars
      );
      const body = step.template_inline
        ? applyTemplateVars(step.template_inline, templateVars)
        : applyTemplateVars(CARITAS.emailTemplates.nurture.body, templateVars);

      let emailSent = false;
      try {
        await emailTransporter!.sendMail({
          from: gmailUser,
          to: lead.email,
          subject,
          text: body,
        });
        emailSent = true;

        await logFlowEvent(flowRunId, "step_completed", {
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
