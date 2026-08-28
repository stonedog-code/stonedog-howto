/**
 * The rule that keeps a test run away from the portal's data.
 *
 * Small, and load-bearing out of proportion to its size: the integration tier
 * spent its whole life connected to the database the running container serves,
 * wiping every table in `beforeEach`. Nothing failed. A suite destroying real
 * content and a suite passing look identical from the outside, which is why the
 * rule needs a test rather than a comment.
 */

import { E2E_DATABASE_SUFFIX, databaseNameFrom, testDatabaseUrl } from "../testDatabaseUrl";

const PORTAL = "postgresql://howto:howto-local-only@localhost:55432/howto?schema=public";

describe("the test tiers' database URL", () => {
  it("is never the portal's own", () => {
    expect(testDatabaseUrl(PORTAL)).not.toBe(PORTAL);
    expect(databaseNameFrom(testDatabaseUrl(PORTAL))).not.toBe("howto");
  });

  it("suffixes the database name and changes nothing else", () => {
    const derived = new URL(testDatabaseUrl(PORTAL));
    const portal = new URL(PORTAL);

    expect(derived.pathname).toBe("/howto_test");
    // The host, port, credentials and parameters must survive untouched: this
    // is the SAME cluster, and a run that quietly moved to another one would
    // prove nothing about the Postgres the portal actually uses.
    expect(derived.host).toBe(portal.host);
    expect(derived.username).toBe(portal.username);
    expect(derived.searchParams.get("schema")).toBe("public");
  });

  it("tracks whatever database the operator chose, rather than a fixed name", () => {
    const other = "postgresql://u:p@db.internal:5432/portal_two?schema=public";
    expect(databaseNameFrom(testDatabaseUrl(other))).toBe("portal_two_test");
  });

  it("is idempotent, so a re-entered environment does not reach howto_test_test", () => {
    const once = testDatabaseUrl(PORTAL);
    expect(testDatabaseUrl(once)).toBe(once);
  });

  it("gives the E2E tier a database of its own", () => {
    // The two non-unit tiers must not share one. The integration tier leaves
    // its last fixture behind — including an ACCOUNT — and `runSync` refuses
    // outright when more than one account exists rather than guessing which to
    // attach a repository to. Sharing made an E2E journey fail with the sync
    // being entirely right about state no E2E test had put there.
    const e2e = testDatabaseUrl(PORTAL, E2E_DATABASE_SUFFIX);
    expect(databaseNameFrom(e2e)).toBe("howto_e2e");
    expect(e2e).not.toBe(testDatabaseUrl(PORTAL));
  });

  it("leaves an E2E url alone when a caller asks for the integration suffix", () => {
    // The E2E tier spawns `npm run sync` as a child, and the child inherits an
    // environment already naming howto_e2e. Suffixing again would silently
    // point it at howto_e2e_test — a database migrated by nothing — and the
    // failure would land far from here.
    const e2e = testDatabaseUrl(PORTAL, E2E_DATABASE_SUFFIX);
    expect(testDatabaseUrl(e2e)).toBe(e2e);
    expect(testDatabaseUrl(e2e, E2E_DATABASE_SUFFIX)).toBe(e2e);
  });

  it("refuses an unset DATABASE_URL rather than falling back to a default", () => {
    // The failure mode this guards is the one that hurts: a fallback would
    // connect somewhere nobody chose, and the most likely somewhere is the
    // portal's.
    expect(() => testDatabaseUrl(undefined)).toThrow(/DATABASE_URL is not set/);
    expect(() => testDatabaseUrl("")).toThrow(/DATABASE_URL is not set/);
  });

  it("refuses a URL naming no database", () => {
    expect(() => testDatabaseUrl("postgresql://u:p@localhost:5432")).toThrow(/names no database/);
    expect(() => testDatabaseUrl("not a url")).toThrow(/not a valid URL/);
  });
});
