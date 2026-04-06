import { pool } from "../db";
import { hashPassword, verifyPassword, needsRehash } from "../auth";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  password: string;
  created_at: string;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

const VALID_ROLES = ["admin", "rcm_manager", "intake"];
const MIN_PASSWORD_LENGTH = 8;

function toSafeUser(user: UserRecord): SafeUser {
  const { password, ...safe } = user;
  return safe;
}

function validateRole(role: string): void {
  if (!VALID_ROLES.includes(role)) {
    throw new Error("Invalid role. Must be one of: " + VALID_ROLES.join(", "));
  }
}

function validatePassword(password: string): void {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export async function createUser(data: {
  email: string;
  name: string;
  role: string;
  password: string;
}): Promise<SafeUser> {
  if (!data.email?.trim()) throw new Error("Email is required");
  if (!data.name?.trim()) throw new Error("Name is required");
  validateRole(data.role);
  validatePassword(data.password);

  const email = data.email.trim().toLowerCase();

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    throw new Error("A user with this email already exists");
  }

  const hashed = await hashPassword(data.password);
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, name, role, password, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
     RETURNING id, email, name, role, created_at`,
    [email, data.name.trim(), data.role, hashed]
  );
  return rows[0];
}

export async function updatePassword(userId: string, newPassword: string): Promise<void> {
  validatePassword(newPassword);
  const hashed = await hashPassword(newPassword);
  const { rowCount } = await pool.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashed, userId]
  );
  if (rowCount === 0) throw new Error("User not found");
}

export async function updateUser(
  userId: string,
  data: { name?: string; role?: string }
): Promise<SafeUser> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    if (!data.name.trim()) throw new Error("Name cannot be empty");
    fields.push(`name = $${idx++}`);
    values.push(data.name.trim());
  }
  if (data.role !== undefined) {
    validateRole(data.role);
    fields.push(`role = $${idx++}`);
    values.push(data.role);
  }

  if (fields.length === 0) throw new Error("No fields to update");

  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, email, name, role, created_at`,
    values
  );
  if (rows.length === 0) throw new Error("User not found");
  return rows[0];
}

export async function getUserForAuth(email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query(
    "SELECT id, email, name, role, password, created_at FROM users WHERE email = $1",
    [email]
  );
  return rows[0] || null;
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  const { rows } = await pool.query(
    "SELECT id, email, name, role, created_at FROM users WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

export async function listUsers(): Promise<SafeUser[]> {
  const { rows } = await pool.query(
    "SELECT id, email, name, role, created_at FROM users ORDER BY email"
  );
  return rows;
}

export async function deleteUser(userId: string, currentUserId: string): Promise<void> {
  if (userId === currentUserId) {
    throw new Error("Cannot delete your own account");
  }
  const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  if (rowCount === 0) throw new Error("User not found");
}

export async function rehashIfNeeded(userId: string, password: string, currentHash: string): Promise<void> {
  if (needsRehash(currentHash)) {
    const newHash = await hashPassword(password);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [newHash, userId]);
  }
}
