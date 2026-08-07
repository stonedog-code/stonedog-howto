import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { parseArticle } from "../article";
import { splitFrontmatter } from "../frontmatter";
import type { Article } from "../types";

export interface LoadArticlesOptions {
  /** File extension to read. Defaults to `.md`. */
  extension?: string;
  /**
   * When an article omits `section`, use the directory it sits in.
   *
   * `security/access-reviews.md` becomes section `security`; a nested
   * `development/prds/PRD-0001-x.md` becomes `development-prds`; a file at the
   * root becomes the value of {@link rootSection}.
   *
   * Off by default. On, it is a real convenience — measured against a
   * hundred-article set, twelve directories mapped one-to-one onto the twelve
   * sections wanted — but it makes the arrangement implicit in the filesystem,
   * so moving a file silently re-sections the article. Opt in per project.
   */
  sectionFromDirectory?: boolean;
  /** Section for files directly in the root. Defaults to `general`. */
  rootSection?: string;
}

function walk(dir: string, extension: string): string[] {
  const found: string[] = [];
  // `withFileTypes` so a directory is identified without a second stat call per
  // entry, and sorted so the returned order is stable across filesystems —
  // readdir order is not guaranteed, and an unstable order makes article
  // ordering depend on the machine that built it.
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, extension));
    else if (entry.name.endsWith(extension)) found.push(full);
  }
  return found;
}

function sectionFor(relPath: string, rootSection: string): string {
  const parts = relPath.split(sep);
  parts.pop();
  return parts.length === 0 ? rootSection : parts.join("-").toLowerCase();
}

/**
 * Read every article under `root`, recursively.
 *
 * This exists because every consumer would otherwise write the same walk,
 * read and parse loop, and the interesting part — what happens when one file in
 * a hundred is malformed — would be reimplemented each time, differently. Here
 * it is one behaviour: the error names the file, and nothing is silently
 * skipped.
 *
 * Node-only, and behind its own entry point (`stonedog-howto/node`) so a browser
 * bundle never pulls `node:fs` in through the package's main export.
 *
 * `sourcePath` is set to the path **relative to `root`**, not the absolute one.
 * Errors then read the same on every machine and in CI, and an absolute path
 * from a developer's disk cannot end up quoted in a build log.
 */
export function loadArticles(root: string, options: LoadArticlesOptions = {}): Article[] {
  const extension = options.extension ?? ".md";
  const rootSection = options.rootSection ?? "general";

  return walk(root, extension).map((file) => {
    const relPath = relative(root, file);
    const source = readFileSync(file, "utf8");

    if (!options.sectionFromDirectory) {
      return parseArticle(source, { sourcePath: relPath });
    }

    // Only injected when the article did NOT declare a section, so a file can be
    // moved on disk without being re-sectioned against its author's wishes.
    //
    // Checked explicitly rather than by inserting the key and letting YAML's
    // last-one-wins settle it: duplicate keys are a spec error that parsers
    // handle differently, and leaning on that behaviour makes the outcome a
    // property of the parser version rather than of this function.
    const { data } = splitFrontmatter(source, relPath);
    if (typeof data["section"] === "string" && data["section"].trim() !== "") {
      return parseArticle(source, { sourcePath: relPath });
    }

    const section = sectionFor(relPath, rootSection);
    const withDefault = /^---[ \t]*\r?\n/.test(source)
      ? source.replace(/^(---[ \t]*\r?\n)/, `$1section: ${section}\n`)
      : `---\nsection: ${section}\n---\n\n${source}`;

    return parseArticle(withDefault, { sourcePath: relPath });
  });
}
