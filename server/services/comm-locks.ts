import { pool } from "../db";

export interface AcquireLockParams {
  leadId: string;
  acquiredByType: "flow" | "manual_user" | "inbound_response";
  acquiredById: string;
  channel: "sms" | "call" | "email" | "any";
  reason?: string;
  durationMinutes?: number;
}

export async function acquireLock(params: AcquireLockParams): Promise<string | null> {
  const {
    leadId,
    acquiredByType,
    acquiredById,
    channel,
    reason = "",
    durationMinutes = 10,
  } = params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check for an active lock on this lead for this channel (or 'any')
    const existing = await client.query(
      `SELECT id FROM comm_locks
       WHERE lead_id = $1
         AND released_at IS NULL
         AND expires_at > NOW()
         AND (channel = $2 OR channel = 'any' OR $2 = 'any')
       LIMIT 1`,
      [leadId, channel]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const result = await client.query(
      `INSERT INTO comm_locks
         (lead_id, acquired_by_type, acquired_by_id, channel, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [leadId, acquiredByType, acquiredById, channel, reason, expiresAt]
    );

    await client.query("COMMIT");
    return result.rows[0].id as string;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[comm-locks] acquireLock error:", err);
    return null;
  } finally {
    client.release();
  }
}

export async function releaseLock(lockId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE comm_locks SET released_at = NOW() WHERE id = $1`,
      [lockId]
    );
  } catch (err) {
    console.error("[comm-locks] releaseLock error:", err);
  }
}

export async function getActiveLock(leadId: string, channel: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM comm_locks
     WHERE lead_id = $1
       AND released_at IS NULL
       AND expires_at > NOW()
       AND (channel = $2 OR channel = 'any' OR $2 = 'any')
     LIMIT 1`,
    [leadId, channel]
  );
  return result.rows.length > 0;
}
