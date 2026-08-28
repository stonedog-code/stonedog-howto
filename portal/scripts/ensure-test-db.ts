/**
 * Create and migrate the test database named by DATABASE_URL, then exit.
 *
 * Exists because **Playwright starts `webServer` BEFORE `globalSetup`**. The
 * server's `/api/health` queries the database, so a globalSetup that created it
 * would run minutes too late — the health check fails against a database that
 * does not exist yet, Playwright waits for a URL that will never be ready, and
 * the run dies with
 *
 *     Error: Timed out waiting 180000ms from config.webServer
 *
 * which names the web server and says nothing about a database. It cost half an
 * hour, having warmed the build to rule out the timeout being the build.
 *
 * So the E2E tier's `webServer` command runs this FIRST, in the same child
 * process that then builds and starts the server, and `globalSetup` keeps
 * calling the same idempotent function for the test process's own client.
 */
import { ensureTestDatabase } from "../test/support/ensureTestDatabase";

ensureTestDatabase()
  .then((url) => {
    console.log(`[test-db] ready: ${new URL(url).pathname.replace(/^\//, "")}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
