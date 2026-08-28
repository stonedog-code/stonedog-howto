/**
 * Reading one repository's articles off disk.
 *
 * `loadArticles` throws on the first malformed file, which is right for a host
 * building its own surface — a broken article should fail that build. It is
 * wrong here: one bad file in a source repository must not cost the portal the
 * other hundred. So this walks the directory itself and parses per file,
 * reporting each failure and continuing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { parseArticle, type Article } from "@stonedogcode/howto";

export interface SkippedArticle {
  /** Path relative to the repository root, so it reads the same on any machine. */
  sourcePath: string;
  reason: string;
}

export interface ReadResult {
  articles: Article[];
  skipped: SkippedArticle[];
}

function markdownFilesIn(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    // Sorted, so the order does not depend on what the filesystem happened to
    // hand back — an unstable order makes a diff between two runs meaningless.
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(full);
    }
  };

  walk(root);
  return found;
}

/**
 * Every article under `root`, plus every file that could not be read.
 *
 * **Read-only, always.** This is somebody's live working tree: it may be
 * mid-edit, on a feature branch, or a worktree. Nothing here writes.
 */
export function readArticlesFrom(root: string): ReadResult {
  const articles: Article[] = [];
  const skipped: SkippedArticle[] = [];

  for (const file of markdownFilesIn(root)) {
    // Normalised to forward slashes so a path recorded on one platform reads
    // the same on another.
    const sourcePath = relative(root, file).split(sep).join("/");

    try {
      articles.push(parseArticle(readFileSync(file, "utf8"), { sourcePath }));
    } catch (error) {
      skipped.push({
        sourcePath,
        reason: error instanceof Error ? error.message : "could not be parsed",
      });
    }
  }

  // A slug is a URL, so two articles claiming one is a genuine conflict. Both
  // are skipped rather than one silently winning: picking a winner means the
  // loser is missing, and a missing article is indistinguishable from one
  // nobody wrote.
  const bySlug = new Map<string, Article[]>();
  for (const article of articles) {
    const group = bySlug.get(article.meta.slug);
    if (group) group.push(article);
    else bySlug.set(article.meta.slug, [article]);
  }

  const kept: Article[] = [];
  for (const [slug, group] of bySlug) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }
    for (const article of group) {
      skipped.push({
        sourcePath: article.sourcePath ?? slug,
        reason: `slug \`${slug}\` is claimed by ${group.length} articles; slugs are URLs and must be unique`,
      });
    }
  }

  return { articles: kept, skipped };
}
