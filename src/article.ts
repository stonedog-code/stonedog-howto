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
 * Every frontmatter key this package understands.
 *
 * Anything else is rejected. That is the point of NEH-470: the parser used to
 * read these six and ignore the rest, so `sumary:` parsed cleanly and produced
 * an article with no summary, reporting nothing.
 *
 * The package's central argument against a central list of articles is that
 * "the failure when they disagree is silent — the article is simply not there,
 * and looks exactly like an article nobody wrote". A dropped key reintroduces
 * that same class of failure *inside the answer to it*, and one of the six
 * makes it an access-control defect rather than a cosmetic one: a misspelled
 * `roles` does not restrict a thing, so `role: [Admin]` states an intent and
 * publishes the article to everyone.
 *
 * Every other validation here refuses rather than guesses — a missing `title`,
 * an empty `roles: []`, a non-numeric `order` all throw naming the file. This
 * closes the one hole in that policy.
 */
const KNOWN_KEYS = ["title", "slug", "section", "order", "summary", "roles"] as const;

/**
 * The escape hatch: `x-` prefixed keys are the host's, and are ignored here.
 *
 * A host legitimately wants its own metadata in frontmatter — an owner, a
 * review date, a feature flag — and without somewhere to put it, strictness
 * just makes this package unusable for them. A reserved prefix keeps the check
 * meaningful, which "allow any unknown key" would not: `sumary` is still caught,
 * because a typo of a known field does not begin with `x-`.
 *
 * The values are not read, validated or carried onto `ArticleMeta`. Reading
 * them would make the host's schema this package's problem; the point is only
 * that declaring one is not an error.
 */
const HOST_KEY_PREFIX = "x-";

/**
 * Edit distance, capped — used only to suggest what a bad key was meant to be.
 *
 * A bare "unknown frontmatter key `sumary`" is correct and nearly useless at
 * 3am; "did you mean `summary`?" is the difference between a fixed typo and a
 * deleted line. Full Levenshtein on strings this short costs nothing.
 */
function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + cost,
      );
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * The known key a misspelling was probably aiming at, if any.
 *
 * Case-insensitive, because `Roles:` is a typo of exactly the kind that matters
 * most and edit distance alone would rank it no better than a stranger. The
 * distance ceiling scales with the key's length so `roles` does not "helpfully"
 * suggest itself for an unrelated short word — a wrong suggestion is worse than
 * none, since it invites the author to make a second wrong edit.
 */
function suggestKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const known of KNOWN_KEYS) {
    const distance = editDistance(lower, known);
    const ceiling = Math.max(1, Math.floor(known.length / 3));
    if (distance <= ceiling && distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Reject any frontmatter key this package does not define.
 *
 * Runs BEFORE the field validations, so a file with both a typo and a missing
 * title reports the typo. That ordering is deliberate: the typo is the more
 * surprising of the two and the one an author cannot see by reading their own
 * file, and reporting the missing title first sends them to fix a field they
 * did in fact write.
 */
function rejectUnknownKeys(
  data: Record<string, unknown>,
  sourcePath: string | undefined,
): void {
  const known = new Set<string>(KNOWN_KEYS);
  for (const key of Object.keys(data)) {
    if (known.has(key)) continue;
    if (key.startsWith(HOST_KEY_PREFIX)) continue;
    const suggestion = suggestKey(key);
    throw new ArticleParseError(
      suggestion
        ? `unknown frontmatter key \`${key}\` — did you mean \`${suggestion}\`? ` +
          `Host-specific metadata goes under an \`${HOST_KEY_PREFIX}\` prefix.`
        : `unknown frontmatter key \`${key}\`. Known keys are ` +
          `${KNOWN_KEYS.map((k) => `\`${k}\``).join(", ")}; host-specific ` +
          `metadata goes under an \`${HOST_KEY_PREFIX}\` prefix.`,
      sourcePath,
    );
  }
}

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
 *
 * An **unrecognised key** throws too, for the same reason (NEH-470). Host
 * metadata belongs under an `x-` prefix, which is ignored here.
 */
export function parseArticle(source: string, options: ParseArticleOptions = {}): Article {
  const { sourcePath } = options;
  const { data, body } = splitFrontmatter(source, sourcePath);

  rejectUnknownKeys(data, sourcePath);

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
