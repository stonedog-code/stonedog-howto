import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["node_modules/**", "coverage/**", "dist/**"] },
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
      // `--fix` is deliberately not wired into any build script here: a build
      // that rewrites tracked sources hides from review the very errors review
      // exists to catch, and leaves the fix uncommitted so it returns on the
      // next checkout.
    },
  },
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}"],
    languageOptions: { globals: { describe: "readonly", it: "readonly", expect: "readonly" } },
  },
];
