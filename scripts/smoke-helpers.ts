import { pool } from "../server/db";
import { runWithTenantContext } from "../server/middleware/tenant-context";
import {
  getActivePracticeProfile,
  getEnrolledPayers,
} from "../server/services/practice-profile-helpers";

(async () => {
  const profile = await runWithTenantContext(
    { organizationId: "chajinel-org-001", userId: null, role: null },
    () => getActivePracticeProfile(),
  );
  console.log("Chajinel active profile code:", profile?.profile?.profileCode);
  console.log("  display:", profile?.profile?.displayName);
  console.log("  is_primary:", profile?.isPrimary);
  console.log(
    "  rule_subs count:",
    Array.isArray(profile?.profile?.ruleSubscriptions)
      ? (profile?.profile?.ruleSubscriptions as any[]).length
      : "none",
  );

  const demo = await runWithTenantContext(
    { organizationId: "demo-org-001", userId: null, role: null },
    () => getEnrolledPayers(),
  );
  console.log("demo-org-001 enrollments:", demo.length);

  const chajinel = await runWithTenantContext(
    { organizationId: "chajinel-org-001", userId: null, role: null },
    () => getEnrolledPayers(),
  );
  console.log("chajinel-org-001 enrollments:", chajinel.length);

  const noCtx = await getEnrolledPayers();
  console.log("no-ctx enrollments (must be 0):", noCtx.length);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
