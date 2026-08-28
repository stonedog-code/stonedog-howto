/**
 * Where the test tiers' database lives, derived from where the portal's does.
 *
 * ## Why derived rather than configured
 *
 * The obvious design is a `DATABASE_URL_TEST` variable that the test tiers
 * read. It has one fatal property: **forgetting it is silent, and what it falls
 * back to is the portal's own database.** That is not hypothetical — the
 * integration tier ran that way for its whole life, wiping every table in
 * `beforeEach` against the database the running container serves, and left its
 * last fixture behind as the portal's entire contents. Nobody noticed for five
 * days, because a suite destroying real data looks exactly like a suite passing.
 *
 * Deriving removes the thing that can be forgotten. There is no configuration
 * to omit, no `.env` to copy into a worktree, and no CI variable to leave
 * unset: a tier that connects at all connects somewhere safe, because the only
 * way to reach the portal's database is to actively defeat this.
 *
 * ## The suffix, not a fixed name
 *
 * `howto` → `howto_test`, tracking whatever database the operator pointed the
 * portal at rather than hardcoding one. Somebody running two portals against
 * two databases gets two test databases, and neither run can reach the other's
 * content.
 */

/** The suffix that marks a database as the test tiers' own. */
export const TEST_DATABASE_SUFFIX = "_test";

/**
 * The E2E tier's own suffix, so the two non-unit tiers do not share a database.
 *
 * They did, and it broke the E2E tier in a way that read as a product bug. The
 * integration tier ends every run leaving its last fixture behind — including
 * an account row — and `runSync` deliberately **refuses** when more than one
 * account exists rather than guessing which to attach a repository to. So an
 * E2E journey that creates its own account failed with
 *
 *     sync: more than one account exists, and the sync has no rule for
 *     choosing between them
 *
 * which is the sync being right, about state no E2E test put there. The two
 * tiers are separated rather than teaching the E2E seed to wipe everything: its
 * scoped deletes are a deliberate choice with their own comment, and widening
 * them to a blanket wipe would re-create the exact hazard that isolating these
 * databases was meant to end.
 */
export const E2E_DATABASE_SUFFIX = "_e2e";

/**
 * The test tiers' database URL, given the portal's.
 *
 * Throws rather than guessing. A malformed URL here would otherwise resolve to
 * some default and connect somewhere nobody chose, which is the entire failure
 * this function exists to prevent — so it fails loudly and names the variable.
 */
export function testDatabaseUrl(
  portalUrl: string | undefined,
  suffix: string = TEST_DATABASE_SUFFIX,
): string {
  if (!portalUrl) {
    throw new Error(
      "DATABASE_URL is not set, so the test database cannot be derived from it. " +
        "Copy .env.example to .env and run `npm run db:up`.",
    );
  }

  let url: URL;
  try {
    url = new URL(portalUrl);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${portalUrl}`);
  }

  // `pathname` is `/<database>`; a connection string carries exactly one path
  // segment and Postgres has no notion of a nested one.
  const database = url.pathname.replace(/^\//, "");
  if (database === "") {
    throw new Error(`DATABASE_URL names no database: ${portalUrl}`);
  }

  // Idempotent. `npm run test:integration` inside an environment a previous run
  // already rewrote must not reach `howto_test_test` -- which would pass, on a
  // database migrated by nothing, and fail somewhere far from here.
  //
  // Checked against BOTH suffixes, not just the one asked for: the E2E tier
  // spawns `npm run sync` as a child process, and that child inherits an
  // environment already pointing at `howto_e2e`. Checking only `_e2e` there
  // would be fine, but checking only the requested suffix in general would let
  // an integration run inside an E2E environment produce `howto_e2e_test`.
  if (database.endsWith(TEST_DATABASE_SUFFIX) || database.endsWith(E2E_DATABASE_SUFFIX)) {
    return portalUrl;
  }

  url.pathname = `/${database}${suffix}`;
  return url.toString();
}

/**
 * The database name in a connection string, for the `CREATE DATABASE` that has
 * to name it as an identifier rather than pass it as a parameter.
 */
export function databaseNameFrom(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}
