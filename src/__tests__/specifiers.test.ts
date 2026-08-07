import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { globSync } from "tinyglobby";

/**
 * No relative import in this package may carry a `.js` extension.
 *
 * This package ships TypeScript **source**, not a bundle. A specifier written
 * as `./article.js` therefore names a file that does not exist — `article.ts`
 * does — and whether that resolves is entirely up to the consumer's toolchain:
 *
 * - `tsc` under `moduleResolution: "bundler"` (this package's own setting, and
 *   its consumers') maps `.js` back to `.ts` and is perfectly happy.
 * - **Turbopack, webpack and Vite do not.** They resolve the literal path and
 *   fail with `Module not found: Can't resolve './article.js'`.
 *
 * So the whole type-check tier, and every unit test, can pass over a package
 * that no bundler can consume. That is exactly what happened: 0.1.0 published
 * with 74 such specifiers across 25 files, and the defect surfaced only when
 * rozcards — a Next.js app — first ran `next build` against it (NEH-436). Two
 * of the three intended consumers are Next apps, so the package was unusable
 * by most of its audience while its own gate was green.
 *
 * The extensions were never required: `moduleResolution: "bundler"` resolves
 * extensionless relative imports, which is what the sibling design-system
 * package `@stonedogcode/style` has always done — it ships TS source the same way
 * and carries zero `.js` specifiers, which is why it bundles cleanly.
 *
 * Bare specifiers are deliberately NOT checked: `foo/bar.js` in a dependency
 * names a real file in someone else's package and rewriting it would break it.
 */
// `process.cwd()` rather than `__dirname`: this package is ESM, where that
// global does not exist. Jest runs from the package root, which is what the
// integration suite already relies on.
const ROOT = process.cwd();

/**
 * Static and dynamic relative imports ending in the JavaScript extension.
 *
 * Written without spelling an offending specifier out: this file is scanned
 * like every other, so an example in the comment is indistinguishable from the
 * real thing and fails the test it documents. Excluding this file instead would
 * have been the obvious fix and the wrong one — it puts a blind spot in the
 * checker to make room for prose.
 */
const RELATIVE_JS = /(?:from\s*|import\(\s*)["'](\.\.?\/[^"']*\.js)["']/g;

describe("module specifiers", () => {
  const files = globSync("src/**/*.{ts,tsx}", { cwd: ROOT, absolute: true });

  it("finds source files to check", () => {
    // Without this the suite passes vacuously if the glob ever stops matching —
    // a green tick over an empty file list, which is the failure this whole
    // test exists to prevent, one level up.
    expect(files.length).toBeGreaterThan(20);
  });

  it("uses no .js extension on a relative import", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [, specifier] of source.matchAll(RELATIVE_JS)) {
        offenders.push(`${relative(ROOT, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
