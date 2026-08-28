/**
 * Create and migrate the test tiers' database, before any tier connects.
 *
 * Run as the `globalSetup` of both the integration tier and the E2E tier, so
 * neither can be started against a database that does not exist or is behind on
 * migrations. It is idempotent: the common case is that the database is already
 * there and `migrate deploy` has nothing to apply.
 *
 * ## It never opens a connection to the portal's database
 *
 * `CREATE DATABASE` has to be issued from some other database, and the obvious
 * choice — the portal's, since its URL is the one we have — is the wrong one.
 * The whole point of this file is that a test run cannot reach the portal's
 * data; a run that connects to it "only to create something else" has already
 * given up the property, and the next person to add a statement here inherits a
 * live handle on production-shaped content. So it connects to `postgres`, the
 * maintenance database every cluster has and nothing stores anything in.
 */

import { execFileSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import "./loadEnv";
import { databaseNameFrom, testDatabaseUrl } from "../../src/lib/db/testDatabaseUrl";

/** Postgres: `duplicate_database`. The database is already there, which is fine. */
const DUPLICATE_DATABASE = "42P04";

function maintenanceUrl(from: string): string {
  const url = new URL(from);
  url.pathname = "/postgres";
  // `schema` is a Prisma-ism and means nothing on the maintenance database.
  url.searchParams.delete("schema");
  return url.toString();
}

async function createIfAbsent(url: string): Promise<void> {
  const name = databaseNameFrom(url);
  const admin = new PrismaClient({ datasourceUrl: maintenanceUrl(url) });

  try {
    // The name is an IDENTIFIER, so it cannot be a bound parameter and has to
    // be interpolated. It comes from DATABASE_URL with a fixed suffix appended,
    // not from anything a request can reach -- but quote it anyway, because the
    // day that stops being true this line should still be safe rather than
    // merely lucky.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    console.log(`[test-db] created ${name}`);
  } catch (error) {
    const code = (error as { meta?: { code?: string } }).meta?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === DUPLICATE_DATABASE || message.includes("already exists")) {
      // The normal path on every run after the first.
    } else {
      throw error;
    }
  } finally {
    await admin.$disconnect();
  }
}

export async function ensureTestDatabase(): Promise<string> {
  const url = testDatabaseUrl(process.env.DATABASE_URL);

  await createIfAbsent(url);

  // `migrate deploy` rather than `migrate dev`: it applies the committed
  // migrations and nothing else. `dev` would offer to reset the database and
  // to author a new migration from schema drift, neither of which belongs in
  // an unattended test run.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DATABASE_DIRECT_URL: url },
  });

  return url;
}

/**
 * The globalSetup for BOTH tiers, and it needs no argument to tell them apart.
 *
 * The two arrive here differently, and the derivation covers both:
 *
 *   jest        globalSetup runs BEFORE any `setupFiles`, so DATABASE_URL is
 *               still the portal's and this derives `_test` — the same value
 *               the workers then derive for themselves.
 *   Playwright  the config's module scope has already rewritten DATABASE_URL to
 *               `_e2e`, because a config module is evaluated before its
 *               globalSetup is called. The derivation is idempotent, so reading
 *               an already-redirected URL returns it unchanged.
 *
 * So this creates and migrates whichever database its caller is pointed at,
 * with no flag to pass and none to get wrong.
 */
export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase();
}
