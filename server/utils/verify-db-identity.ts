import { Client } from "pg";

export interface DatabaseIdentity {
  connection_target: "production" | "dev" | "unknown";
  host: string;
  database_name: string;
  claim_count: number;
  cci_edit_count: number;
  org_count: number;
  most_recent_claim: string | null;
  warnings: string[];
}

export async function verifyDatabaseIdentity(
  connectionString: string
): Promise<DatabaseIdentity> {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const result = await client.query(`
    SELECT
      current_database() AS db_name,
      inet_server_addr()::text AS server_ip,
      (SELECT COUNT(*)::int FROM claims) AS claim_count,
      (SELECT COUNT(*)::int FROM cci_edits) AS cci_edit_count,
      (SELECT COUNT(*)::int FROM organizations) AS org_count,
      (SELECT MAX(created_at)::text FROM claims) AS most_recent_claim
  `);

  await client.end();

  const row = result.rows[0];
  const host = new URL(connectionString).hostname;

  let target: "production" | "dev" | "unknown" = "unknown";
  const warnings: string[] = [];

  if (row.claim_count >= 80 && row.cci_edit_count >= 1_000_000) {
    target = "production";
  } else {
    target = "dev";
    warnings.push(
      `This connection has ${row.claim_count} claims and ${row.cci_edit_count} CCI edits — looks like dev, not production`
    );
  }

  if (row.org_count === 0) {
    warnings.push("Zero organizations — database likely not seeded");
  }

  if (host.includes("neon.tech") || host === "helium") {
    warnings.push(
      `Connection is to ${host} — this is the Replit dev database, NOT Railway production`
    );
  } else if (host.includes("railway") || host.includes("rlwy.net")) {
    // expected for production
  } else {
    warnings.push(
      `Unknown host: ${host} — verify this is the intended target`
    );
  }

  return {
    connection_target: target,
    host,
    database_name: row.db_name,
    claim_count: row.claim_count,
    cci_edit_count: row.cci_edit_count,
    org_count: row.org_count,
    most_recent_claim: row.most_recent_claim,
    warnings,
  };
}

async function main() {
  const target = process.argv[2] || "PRODUCTION_DATABASE_URL";
  const url = process.env[target];

  if (!url) {
    console.error(`ERROR: ${target} is not set in environment`);
    process.exit(1);
  }

  let identity: DatabaseIdentity;
  try {
    identity = await verifyDatabaseIdentity(url);
  } catch (err: any) {
    console.error(`ERROR connecting via ${target}: ${err.message}`);
    process.exit(1);
  }

  console.log("\n=== DATABASE IDENTITY ===");
  console.log(JSON.stringify(identity, null, 2));
  console.log("\nTarget: " + identity.connection_target.toUpperCase());

  if (identity.warnings.length > 0) {
    console.log("\nWARNINGS:");
    identity.warnings.forEach((w) => console.log("  - " + w));
  }

  if (identity.connection_target !== "production") {
    console.error(
      "\nNOT POINTING AT PRODUCTION — verification cannot proceed"
    );
    process.exit(2);
  } else {
    console.log("\n✓ Confirmed against production");
  }
}

// tsx does not set require.main === module — use argv check instead
if (process.argv[1] && process.argv[1].includes("verify-db-identity")) {
  main();
}
