import { defineConfig } from "@playwright/test";

// Before anything reads process.env. Playwright does not load `.env` itself.
import "./test/support/loadEnv";
import { E2E_DATABASE_SUFFIX, testDatabaseUrl } from "./src/lib/db/testDatabaseUrl";

/**
 * The E2E tier.
 *
 * Runs against a REAL build, not `next dev`. The dev server is more forgiving —
 * different error handling, no production bundling — and the artefact that
 * serves people is the built one. A suite that only ever proves the dev server
 * works is a suite that can stay green through a broken release.
 */

/**
 * The test database, not the portal's.
 *
 * `seed.ts` already deletes only its own account, deliberately — so this tier
 * was never the one that destroyed anything. It is redirected anyway, for two
 * reasons. The scoping rule is one careless `deleteMany({})` away from being
 * untrue, and it holds only for as long as everybody who adds a fixture
 * remembers it; and a suite proving "a stranger sees nothing" is more
 * convincing on a database where there is provably nothing else to see.
 *
 * Assigned at module scope because this file is evaluated in the runner AND in
 * every worker, so the seed's client picks it up wherever it is constructed.
 */
const url = testDatabaseUrl(process.env.DATABASE_URL, E2E_DATABASE_SUFFIX);
process.env.DATABASE_URL = url;
process.env.DATABASE_DIRECT_URL = url;

export default defineConfig({
  // Creates and migrates that database before the server is built or started.
  // Shared with the integration tier -- one definition of where tests may write.
  globalSetup: "./test/support/ensureTestDatabase.ts",
  testDir: "./test/e2e",
  // Serial. Every test signs a user in and asserts what that user may read;
  // parallel workers sharing one database would race the fixture and produce
  // failures nobody can attribute.
  workers: 1,
  fullyParallel: false,
  // A retry hides a flake rather than reporting it, and a flaky access-control
  // test is a finding, not noise.
  retries: 0,
  timeout: 30_000,
  // CI also writes the HTML report, because a red run there is read by someone
  // who was not watching it: `list` alone scrolls past in a log, and `trace:
  // retain-on-failure` above produces traces that need the report to reach.
  // The workflow uploads `playwright-report/` on failure — without this line
  // that upload would archive an empty directory and look like it worked.
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    // Built and started here so the suite cannot pass against a stale server
    // somebody left running on this port.
    //
    // The database step is FIRST and has to be, because Playwright starts this
    // command before it runs `globalSetup`. The server's /api/health queries the
    // database, so creating it in globalSetup would be far too late: the health
    // check fails against a database that does not exist, and the run dies with
    // "Timed out waiting 180000ms from config.webServer" — an error naming the
    // web server and never mentioning a database.
    command: "npx tsx scripts/ensure-test-db.ts && npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      // A distinct secret, so a session minted by the dev server cannot be
      // replayed against this one and vice versa.
      SESSION_SECRET: "e2e-session-secret-that-is-long-enough-to-pass",
      // Named explicitly rather than left to inheritance. `webServer.env` is
      // MERGED over process.env, so omitting these would work today — and would
      // break silently the moment a .env reached the server process by another
      // route, putting the app under test back on the portal's database while
      // the suite's own client stayed on the test one. Two halves of one tier
      // reading different databases is a failure that reads as flakiness.
      DATABASE_URL: url,
      DATABASE_DIRECT_URL: url,
    },
  },
});
