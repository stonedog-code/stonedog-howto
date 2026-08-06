/** @type {import('jest').Config} */
module.exports = {
  // ESM, not the default CJS transform. Every markdown dependency in this
  // package's tree — unified, remark-*, mdast-*, unist-*, github-slugger — is
  // ESM-only, and the CJS path can only load them by adding each one (and each
  // of their transitive micromark/vfile helpers) to a transformIgnorePatterns
  // allowlist that silently rots as the tree changes. Running Jest as ESM lets
  // Node resolve them the way the published package will.
  //
  // Requires NODE_OPTIONS=--experimental-vm-modules, set in the `test` script.
  preset: "ts-jest/presets/default-esm",
  // `.tsx` as well as `.ts`. Omitting it loads the component modules as
  // CommonJS, where the first ESM-only import fails with "Must use import to
  // load ES Module" — pointing at the dependency rather than at this list.
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  testEnvironment: "node",
  moduleNameMapper: {
    // Source imports carry `.js` specifiers because that is what real ESM
    // requires of the published package. TypeScript resolves them back to `.ts`
    // itself; Jest does not, so the extension is stripped here.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/__tests__/**",
    "!src/index.ts",
  ],
};
