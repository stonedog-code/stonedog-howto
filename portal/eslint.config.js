import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    // `.next/**` is generated: thousands of bundled files that lint reports on
    // and nobody can fix. Left in, the real errors are 2,000 lines up.
    ignores: ["node_modules/**", "coverage/**", "dist/**", ".next/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `--fix` is deliberately not wired into any script here: a build that
      // rewrites tracked sources hides from review the very errors review
      // exists to catch, and leaves the fix uncommitted so it returns on the
      // next checkout.
    },
  },
  {
    // Server-side modules legitimately read the Node globals. Scoped to the
    // directories that actually run on a server rather than switching the
    // whole project to node globals — the access core is environment-free and
    // should keep failing if it ever reaches for `process`.
    files: ["src/lib/db/**/*.ts", "src/lib/session/**/*.ts", "src/lib/api/**/*.ts", "src/lib/sync/**/*.ts", "src/app/**/*.ts", "src/app/**/*.tsx"],
    languageOptions: {
      globals: {
        process: "readonly",
        globalThis: "readonly",
        Buffer: "readonly",
        FormData: "readonly",
        URL: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // Root config files run in Node, not in the browser or the app.
    files: ["*.mjs", "*.cjs", "*.js"],
    languageOptions: { globals: { process: "readonly" } },
  },
  {
    files: ["src/**/__tests__/**/*.ts"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        beforeAll: "readonly",
        afterEach: "readonly",
        setTimeout: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        Buffer: "readonly",
        process: "readonly",
      },
    },
  },
];
