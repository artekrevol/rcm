import { pool } from "../db";
import { CARITAS } from "../config/caritas-constants";

export async function seedCaritasFlow(): Promise<void> {
  const existing = await pool.query(
    `SELECT id FROM flows WHERE name = 'Caritas Senior Care — Standard Intake' LIMIT 1`
  );
  if (existing.rows.length > 0) {
    console.log("[seed] Caritas flow already exists");
    return;
  }

  const flow = await pool.query(
    `INSERT INTO flows (name, description, trigger_event, trigger_conditions, is_active)
     VALUES ($1, $2, $3, $4, true)
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
    body: string | null;
  };

  const steps: StepDef[] = [
    { order: 1, type: "wait", channel: null, delay: 2, body: null },
    {
      order: 2,
      type: "sms",
      channel: "twilio",
      delay: 0,
      body: CARITAS.smsTemplates.welcome,
    },
    { order: 3, type: "wait", channel: null, delay: 3, body: null },
    {
      order: 4,
      type: "call",
      channel: "vapi",
      delay: 0,
      body: "Caritas intake call — capture insurance carrier, member ID, DOB, urgency, state.",
    },
    { order: 5, type: "vob_check", channel: "system", delay: 0, body: null },
    {
      order: 6,
      type: "call",
      channel: "vapi",
      delay: 15,
      body: "Callback to share verified plan details and offer to schedule a consult.",
    },
    {
      order: 7,
      type: "sms",
      channel: "twilio",
      delay: 1440,
      body: CARITAS.smsTemplates.voicemailFollowup,
    },
    {
      order: 8,
      type: "email",
      channel: "gmail",
      delay: 4320,
      body: CARITAS.emailTemplates.nurture.body,
    },
  ];

  const stepIds: string[] = [];
  for (const s of steps) {
    const r = await pool.query(
      `INSERT INTO flow_steps (flow_id, step_order, step_type, channel, delay_minutes, template_inline)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [flowId, s.order, s.type, s.channel, s.delay, s.body]
    );
    stepIds.push(r.rows[0].id);
  }

  console.log(`[seed] Seeded Caritas flow (id=${flowId}) with ${stepIds.length} steps`);
}
