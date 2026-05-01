import { pool } from "../db";

export async function seedCaritasFlow(): Promise<void> {
  const existing = await pool.query(
    `SELECT id FROM flows WHERE name = 'Caritas Senior Care — Standard Intake' LIMIT 1`
  );
  if (existing.rows.length > 0) {
    // Ensure flow is always associated with caritas-org-001
    await pool.query(
      `UPDATE flows SET organization_id = 'caritas-org-001', updated_at = NOW()
       WHERE name = 'Caritas Senior Care — Standard Intake'
         AND (organization_id IS NULL OR organization_id = 'demo-org-001')`
    );
    console.log("[seed] Caritas flow already exists");
    return;
  }

  const flow = await pool.query(
    `INSERT INTO flows (name, description, trigger_event, trigger_conditions, is_active, organization_id, version)
     VALUES ($1, $2, $3, $4, true, 'caritas-org-001', 1)
     RETURNING id`,
    [
      "Caritas Senior Care — Standard Intake",
      "Standard 8-step intake sequence for caritasseniorcare.life inquiries",
      "lead_created",
      JSON.stringify({ source: "caritas_web" }),
    ]
  );
  const flowId = flow.rows[0].id;

  type StepDef = {
    order: number;
    type: string;
    channel: string | null;
    delay: number;
    templateKey: string | null;
    config: Record<string, unknown>;
  };

  const steps: StepDef[] = [
    { order: 1, type: "wait",          channel: null,     delay: 2,    templateKey: null,                  config: {} },
    { order: 2, type: "sms_message",   channel: "twilio", delay: 0,    templateKey: "welcome_sms",         config: {} },
    { order: 3, type: "wait",          channel: null,     delay: 3,    templateKey: null,                  config: {} },
    { order: 4, type: "voice_call",    channel: "vapi",   delay: 0,    templateKey: null,                  config: { persona_key: "intake_coordinator", purpose: "intake" } },
    { order: 5, type: "vob_check",     channel: "system", delay: 0,    templateKey: null,                  config: { vendor: "stedi" } },
    { order: 6, type: "voice_call",    channel: "vapi",   delay: 15,   templateKey: null,                  config: { persona_key: "intake_coordinator", purpose: "callback" } },
    { order: 7, type: "sms_message",   channel: "twilio", delay: 1440, templateKey: "voicemail_followup_sms", config: {} },
    { order: 8, type: "email_message", channel: "gmail",  delay: 4320, templateKey: "nurture_email",       config: {} },
  ];

  for (const s of steps) {
    await pool.query(
      `INSERT INTO flow_steps (flow_id, step_order, step_type, channel, delay_minutes, template_key, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [flowId, s.order, s.type, s.channel, s.delay, s.templateKey, JSON.stringify(s.config)]
    );
  }

  console.log(`[seed] Seeded Caritas flow (id=${flowId}) with ${steps.length} steps`);
}
