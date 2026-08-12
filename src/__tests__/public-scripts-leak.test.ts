import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * No script in `scripts/` names an internal tracker id.
 *
 * **This repository is public.** A stranger evaluating whether to depend on the
 * package can read every file in it, and an issue id publishes three things at
 * once: the tracker's key format, a rough issue count, and — where the id sits
 * beside a shipped defect — that a named internal ticket was behind it. Little
 * on its own, free reconnaissance in aggregate, and unprofessional in a package
 * whose whole purpose is to be read by outsiders.
 *
 * ## Comments are deliberately NOT exempt here
 *
 * That is the opposite of the app-side leak rule, which strips comments before
 * scanning precisely so a code comment can *name* the thing it explains. The
 * difference is audience, not secrecy. In an application, a comment is read by
 * someone with repository access; here, "someone with repository access" is
 * everyone. There is no inside.
 *
 * ## What must survive
 *
 * The **reasoning**, in full. The comment explaining why `npm ci` rather than
 * `npm install`, and the one about a checkout one commit behind publishing a
 * tarball missing the very thing it was published for, are the most valuable
 * lines in the script. They read *better* without the identifiers, because a
 * stranger cannot look one up anyway — and a date and a filename are not
 * internal identifiers, so "it did, on 2026-08-04, without TitleLogo.tsx" stays
 * exactly as it is. Strip the id, keep every word around it.
 *
 * ## Why a guard and not just a fix
 *
 * These come back. Whoever writes a publish-script comment is usually mid-
 * incident and reaching for the ticket they just closed, which is the moment
 * the id is most present in their mind and least useful to a reader.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..", "..", "scripts");

/**
 * The shapes an internal reference takes here.
 *
 * The tracker link matters as much as the bare key: a URL leaks the workspace
 * name too, and it is what someone pastes when a bare id feels too terse.
 */
const INTERNAL_REFERENCE = [
  { name: "a tracker issue id", pattern: /\bNEH-\d+\b/g },
  { name: "a Linear URL", pattern: /linear\.app\/[^\s)"']+/g },
  { name: "a Linear branch name", pattern: /\bjessestone\/[a-z0-9-]+/g },
];

const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".sh"));

describe("the publish scripts carry no internal identifiers", () => {
  it("finds no tracker id, tracker link or branch name in scripts/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(SCRIPTS, file), "utf8");
      source.split("\n").forEach((line, i) => {
        for (const { name, pattern } of INTERNAL_REFERENCE) {
          // Fresh lastIndex per line: a `g` regex reused across calls resumes
          // where it stopped and skips half its input, which would make this
          // guard miss every other offender while looking healthy.
          pattern.lastIndex = 0;
          const found = line.match(pattern);
          if (found) {
            offenders.push(`scripts/${file}:${i + 1} — ${name}: ${found.join(", ")}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("actually read the scripts, rather than passing on an empty directory", () => {
    // A guard whose input silently became empty passes forever while checking
    // nothing. Both halves are needed: the directory must have files, and those
    // files must have content.
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(join(SCRIPTS, file), "utf8").length).toBeGreaterThan(500);
    }
  });

  it("keeps the reasoning the ids were embedded in", () => {
    // The failure mode of a leak guard is someone deleting the sentence instead
    // of the identifier, which costs the repo its most useful comments. These
    // pin the two the issue singled out as worth keeping.
    const publish = readFileSync(join(SCRIPTS, "publish-package.sh"), "utf8");
    expect(publish).toContain("npm ci` rather than `npm install`");
    expect(publish).toMatch(/lockfile and manifest disagree/);
  });

  it("recognises an offender when it sees one", () => {
    // The matcher, checked both ways. Built by concatenation so this assertion
    // does not itself plant the string the first test scans for — the file is
    // outside `scripts/`, but a guard that can be defeated by its own fixture
    // is worth not writing in the first place.
    const bad = `# fixed under NEH${"-"}123, see the ticket`;
    const good = `# fixed on 2026-08-04, without TitleLogo.tsx`;
    expect(bad).toMatch(INTERNAL_REFERENCE[0]!.pattern);
    expect(good).not.toMatch(INTERNAL_REFERENCE[0]!.pattern);
  });
});
