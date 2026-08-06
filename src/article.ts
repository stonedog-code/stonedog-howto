import { ArticleParseError } from "./errors";
import { splitFrontmatter } from "./frontmatter";
import type { Article, ArticleMeta } from "./types";

export interface ParseArticleOptions {
  /**
   * Where the source came from. Used to derive a default `slug`, and quoted in
   * any error so a bad article is findable.
   */
  sourcePath?: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `articles/security/access-reviews.md` -> `access-reviews`
 *
 * Lowercased, because filename case is a local convention and a slug is a URL.
 * Measured against a real hundred-article set, 29 of them were named
 * `PRD-0001-…` and would otherwise have had to be either renamed or given an
 * explicit `slug:` apiece — friction to satisfy a rule about capital letters
 * that nothing downstream cares about. An explicit `slug` in frontmatter is
 * still validated strictly; this only governs what a bare filename defaults to.
 *
 * Two filenames differing only in case collapse to one slug here. That is not a
 * silent loss: `validateArticles` reports a duplicate slug and names both files.
 */
function slugFromPath(sourcePath: string): string {
  const base = sourcePath.split(/[/\\]/).pop() ?? sourcePath;
  return base.replace(/\.[^.]+$/, "").toLowerCase();
}

function requireString(
  data: Record<string, unknown>,
  key: string,
  sourcePath: string | undefined,
): string {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArticleParseError(
      `frontmatter field \`${key}\` is required and must be a non-empty string`,
      sourcePath,
    );
  }
  return value.trim();
}

function optionalStringList(
  data: Record<string, unknown>,
  key: string,
  sourcePath: string | undefined,
): string[] | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;

  // A single role written unquoted (`roles: Facility Admin`) is a natural
  // mistake and unambiguous, so it is accepted rather than rejected.
  if (typeof value === "string") return [value.trim()];

  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ArticleParseError(
      `frontmatter field \`${key}\` must be a list of strings`,
      sourcePath,
    );
  }

  const list = (value as string[]).map((v) => v.trim()).filter((v) => v !== "");
  // An empty list is not the same as an absent one — it would mean "no role can
  // see this", which is never what an author intends and is invisible once
  // rendered (the article simply disappears). Reject it.
  if (list.length === 0) {
    throw new ArticleParseError(
      `frontmatter field \`${key}\` is an empty list; omit it entirely to leave the audience to the host`,
      sourcePath,
    );
  }
  return list;
}

/**
 * Parse one markdown article: its frontmatter into {@link ArticleMeta}, the rest
 * into `body`.
 *
 * Required: `title` and `section`. `slug` defaults to the file's basename,
 * `order` to 0. Anything malformed throws rather than defaulting — a silently
 * defaulted article lands in the wrong place, and the author has no way to tell.
 */
export function parseArticle(source: string, options: ParseArticleOptions = {}): Article {
  const { sourcePath } = options;
  const { data, body } = splitFrontmatter(source, sourcePath);

  const title = requireString(data, "title", sourcePath);
  const section = requireString(data, "section", sourcePath);

  const rawSlug = data["slug"];
  let slug: string;
  if (rawSlug === undefined || rawSlug === null) {
    if (!sourcePath) {
      throw new ArticleParseError(
        "frontmatter field `slug` is required when the article is not read from a file",
        sourcePath,
      );
    }
    slug = slugFromPath(sourcePath);
  } else {
    slug = requireString(data, "slug", sourcePath);
  }

  if (!SLUG_PATTERN.test(slug)) {
    throw new ArticleParseError(
      `slug \`${slug}\` must be lowercase letters, digits and single hyphens — it appears in URLs`,
      sourcePath,
    );
  }

  const rawOrder = data["order"];
  let order = 0;
  if (rawOrder !== undefined && rawOrder !== null) {
    if (typeof rawOrder !== "number" || !Number.isFinite(rawOrder)) {
      throw new ArticleParseError(
        "frontmatter field `order` must be a number",
        sourcePath,
      );
    }
    order = rawOrder;
  }

  const rawSummary = data["summary"];
  if (rawSummary !== undefined && rawSummary !== null && typeof rawSummary !== "string") {
    throw new ArticleParseError(
      "frontmatter field `summary` must be a string",
      sourcePath,
    );
  }
  const summary =
    typeof rawSummary === "string" && rawSummary.trim() !== ""
      ? rawSummary.trim()
      : undefined;

  const roles = optionalStringList(data, "roles", sourcePath);

  const meta: ArticleMeta = {
    title,
    slug,
    section,
    order,
    ...(summary !== undefined ? { summary } : {}),
    ...(roles !== undefined ? { roles } : {}),
  };

  return {
    meta,
    body,
    ...(sourcePath !== undefined ? { sourcePath } : {}),
  };
}
