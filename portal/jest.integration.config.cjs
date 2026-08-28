/**
 * The integration tier: real PostgreSQL, real schema, real store.
 *
 * A separate config rather than a testMatch in the main one, because these need
 * `docker compose up -d` and an applied migration. Folding them into `test`
 * would make the default command fail on a machine with no daemon, and a suite
 * that fails for environmental reasons is a suite people learn to ignore.
 */
const base = require("./jest.config.cjs");

module.exports = {
  ...base,
  testMatch: ["<rootDir>/src/**/__tests__/**/*.integration.test.ts"],
  // The base config EXCLUDES these files so the unit run stays daemon-free.
  // Inheriting that exclusion here matched nothing — and jest exits 1 on "no
  // tests found", which is the only reason it was noticed rather than read as
  // a green integration tier.
  testPathIgnorePatterns: [],
  // Serial. Several of these race deliberately against ONE account row, and
  // parallel workers racing each other as well would make a failure impossible
  // to attribute.
  maxWorkers: 1,
  collectCoverage: false,
  coverageThreshold: undefined,

  // ── The tier runs against its OWN database, and this is how that is enforced.
  //
  // Every file here opens with `deleteMany({})` across all six tables, which is
  // right for a test and catastrophic against the database the portal serves.
  // It WAS that database: the tier inherited DATABASE_URL from .env, wiped the
  // running container's content on every run, and left its last fixture behind
  // as the portal's entire contents. The hourly sync then refused to move a
  // repository whose recorded path was `/x`, correctly, for five days.
  //
  // Two hooks, and both are needed:
  //
  //   globalSetup  creates and migrates the database, once, before any worker
  //                starts -- so a fresh clone or a new worktree needs no setup
  //                step somebody has to remember.
  //   setupFiles   redirects DATABASE_URL inside each worker BEFORE any test
  //                module is imported. These files construct their PrismaClient
  //                at module scope, so a redirect applied in setupFilesAfterEnv
  //                would land after the client had already resolved its URL.
  globalSetup: "<rootDir>/test/support/ensureTestDatabase.ts",
  setupFiles: ["<rootDir>/test/support/useTestDatabase.ts"],
};
