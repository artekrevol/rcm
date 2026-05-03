/**
 * Tenant-context middleware (Phase 3 Sprint 0).
 *
 * Establishes a request-scoped tenant context using AsyncLocalStorage and
 * exposes a transaction-scoped helper that pins the Postgres GUC
 * `app.current_organization_id` for the duration of a transaction so RLS
 * policies on the new Phase 3 tables filter to the calling tenant.
 *
 * Behavior:
 *   - On every request, resolves the active organization id from the
 *     authenticated user (passport sets req.user) and stores it in an
 *     AsyncLocalStorage frame for the lifetime of that request.
 *   - `withTenantTx(fn)` opens a transaction on a dedicated pool client,
 *     calls `set_config('app.current_organization_id', <orgId>, true)` so the
 *     setting is local to the transaction, runs the caller's function with
 *     that client, then commits (or rolls back on throw).
 *   - When no org id is in context, the GUC is NOT set; RLS policies use
 *     `current_setting('app.current_organization_id', true)` which returns
 *     NULL — every tenant_isolation policy then evaluates to FALSE and the
 *     query returns zero rows. This is the intended fail-closed default.
 *
 * Sprint 0 status: feature flag USE_PROFILE_AWARE_QUERIES is OFF. The
 * middleware is wired so AsyncLocalStorage is populated, but no production
 * code path calls `withTenantTx` yet — the helper service layer added in
 * Step 6 is the first consumer, and it is gated behind the feature flag.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db";

export interface TenantContext {
  organizationId: string | null;
  userId: string | null;
  role: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Express middleware. Place AFTER passport's session deserialization so
 * `req.user` is populated. Safe to mount before route registration.
 */
export function tenantContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const user = (req as Request & { user?: any }).user;
  const organizationId =
    user?.organizationId ?? user?.organization_id ?? null;
  const userId = user?.id ?? null;
  const role = user?.role ?? null;

  storage.run({ organizationId, userId, role }, () => next());
}

/** Returns the org id for the current request, or null if unauthenticated / outside a request. */
export function getCurrentOrgId(): string | null {
  return storage.getStore()?.organizationId ?? null;
}

/** Returns the full tenant context for the current request. */
export function getTenantContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

/**
 * Run `fn` inside a Postgres transaction with `app.current_organization_id`
 * pinned for the transaction. Uses `set_config(name, value, is_local=true)`
 * so the setting is unset on COMMIT/ROLLBACK and the underlying pool client
 * cannot leak the GUC to a subsequent checkout.
 *
 * If no org id is in the AsyncLocalStorage context, the GUC is left unset and
 * RLS policies fail closed (see file header). The caller may pass an explicit
 * `orgIdOverride` for system jobs that legitimately need to act as a specific
 * tenant outside an HTTP request.
 */
export async function withTenantTx<T>(
  fn: (client: PoolClient) => Promise<T>,
  orgIdOverride?: string,
): Promise<T> {
  const orgId = orgIdOverride ?? getCurrentOrgId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Drop privileges to the non-superuser app role for the lifetime of this
    // transaction so RLS policies actually apply. The connecting role
    // (postgres) is a superuser and bypasses RLS regardless of
    // FORCE ROW LEVEL SECURITY; SET LOCAL ROLE reverts on COMMIT/ROLLBACK,
    // returning the pool client clean.
    await client.query("SET LOCAL ROLE claimshield_app_role");
    if (orgId) {
      // set_config supports parameter binding; SET LOCAL does not.
      // is_local=true scopes the setting to the current transaction only.
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, true)",
        [orgId],
      );
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* swallow rollback failures — original error is more useful */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test-only / admin-only helper: run with an explicit tenant context outside
 * an HTTP request. Useful for cron jobs, background workers, and the
 * verification script. Sprint 0 only uses this in scripts/verify-tenant-isolation.ts.
 */
export function runWithTenantContext<T>(
  ctx: TenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    storage.run(ctx, () => {
      fn().then(resolve, reject);
    });
  });
}
