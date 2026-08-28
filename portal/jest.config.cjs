/** @type {import('jest').Config} */
module.exports = {
  // ESM rather than the default CommonJS transform, matching the source this
  // package ships. Requires NODE_OPTIONS=--experimental-vm-modules, set in the
  // `test` script.
  preset: "ts-jest/presets/default-esm",
  // `.tsx` as well as `.ts`. @stonedogcode/howto ships its React components as
  // SOURCE, so importing anything from its main entry drags `renderArticle.tsx`
  // in behind it. Left out, jest treats that file as CommonJS, `require`s it,
  // and dies on its ESM-only markdown chain with "Must use import to load ES
  // Module: .../rehype-react/index.js" -- an error that names a dependency
  // nobody here imports and reads like a broken package rather than a missing
  // three characters in this file.
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  testEnvironment: "node",
  transform: {
    // `jsx` is set explicitly rather than inherited from tsconfig.json.
    //
    // ts-jest compiles the package's `.tsx` files too (they arrive through the
    // main entry point), and for files outside this project's tsconfig
    // `include` it falls back to the compiler default of `jsx: "preserve"` --
    // which emits the JSX unchanged. The untransformed `<` then reaches the ESM
    // loader as `SyntaxError: Unexpected token '<'`, naming no file.
    //
    // It is cache-sensitive, which is what makes it dangerous: once a warm
    // jest cache holds a good transform the suite passes, so this reproduces
    // only on a cold cache -- a fresh clone, CI, or a docker build.
    "^.+\\.tsx?$": [
      "ts-jest",
      { useESM: true, tsconfig: { jsx: "react-jsx" } },
    ],
  },
  // Unit tier only. The integration tier needs a database and lives in
  // jest.integration.config.cjs — see `test:integration`.
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["\\.integration\\.test\\.ts$"],
  // The three stonedog packages ship TypeScript SOURCE (Panda has to parse
  // @stonedogcode/howto at our build), and jest transforms nothing under
  // node_modules by default — so each reaches the runtime raw and dies on its
  // first `export type`. Named explicitly rather than opening node_modules
  // wholesale: everything else here is already loadable and transforming all
  // of it would be slow for nothing.
  transformIgnorePatterns: [
    "/node_modules/(?!(@stonedogcode/auth|@stonedogcode/howto|@stonedogcode/rbac)/)",
    "\\.pnp\\.[^\\\\]+$",
  ],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/index.ts",
    // The database layer is exercised by the INTEGRATION tier, which is where
    // it can be exercised at all — a unit run has no PostgreSQL. Counting it
    // here would report it as uncovered and push the global percentage down
    // until somebody lowered the threshold, which is the opposite of what the
    // threshold is for. See `test:integration`.
    "!src/lib/db/**",
    // The Next.js app -- pages, server actions, the session cookie. None of it
    // can be exercised by a unit run: it needs a request, a cookie store and a
    // running server. Counting it here would drag the global percentage down
    // until somebody lowered the threshold, which is the opposite of what a
    // threshold is for. It is the E2E tier's job, and that tier does not exist
    // yet -- filed rather than quietly ignored.
    "!src/app/**",
    "!src/lib/session/**",
    // `run.ts` is the sync's database half -- upserts, deletes, repo status
    // transitions. Like src/lib/db it can only be exercised against a real
    // PostgreSQL, and it is, by 14 tests in the integration tier. The pure
    // halves it is built from (config parsing, reconciliation) stay counted
    // here, because those are exactly the parts a unit run CAN check.
    "!src/lib/sync/run.ts",
    // Reads directories off disk. Exercised by the integration tier against
    // real fixture trees -- a malformed file, a duplicate slug across two
    // directories, a nested path -- none of which a unit run can produce
    // without becoming an integration test wearing a different name.
    "!src/lib/sync/readArticles.ts",
    // Three lines choosing an argon2 binding at module scope. No branches, and
    // a test of it would assert that the import worked.
    "!src/lib/auth/**",
    // The read path: Prisma queries feeding the package's manifest and filter.
    // Only a real database can exercise it, and 11 integration tests do --
    // including the two that matter most, that a withheld article cannot be
    // reached by guessing its slug and that an empty sourceRoles column reaches
    // the package as `undefined` rather than as an empty list.
    "!src/lib/articles.ts",
    // Token lookup and cross-repository search: Prisma queries feeding the
    // package's ranking. Covered by 13 integration tests, including that a
    // token cannot see further than its holder and that the result COUNT
    // discloses nothing.
    "!src/lib/api/**",
  ],
  // The domain core: access decisions and the signup race. An uncovered branch
  // here either grants something or hands somebody an admin slot.
  //
  // Enforced by `npm run gate`, which runs `test:coverage` rather than `test`.
  // For a long time nothing ran these at all, and main sat thirty points under
  // the branch threshold — exiting 1 on the one command nobody typed.
  //
  // Raised from 90/85/90/90 once the gate was real and the gaps it exposed were
  // closed (config.ts's malformed entries, signup.ts's non-Error throw). The
  // numbers sit a few points under the measured 100/97.6/100/100 rather than at
  // it: a threshold pinned to current coverage turns every honest refactor red
  // and teaches people to lower it, which is how the old one came to mean
  // nothing. Headroom is what keeps a threshold credible.
  coverageThreshold: {
    global: { statements: 95, branches: 90, functions: 95, lines: 95 },
  },
};
