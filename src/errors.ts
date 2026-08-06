/** Base for every error this package throws, so hosts can catch one type. */
export class HowToError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HowToError";
  }
}

/**
 * An article could not be parsed, or is missing something required.
 *
 * Carries `sourcePath` because the whole point of a self-describing article is
 * that a problem is traceable to one file — an error that only says "title is
 * required" is useless across a hundred articles.
 */
export class ArticleParseError extends HowToError {
  readonly sourcePath: string | undefined;

  constructor(message: string, sourcePath?: string) {
    super(sourcePath ? `${sourcePath}: ${message}` : message);
    this.name = "ArticleParseError";
    this.sourcePath = sourcePath;
  }
}

/** What is wrong with a set of articles, relative to a config. */
export interface ManifestProblem {
  kind: "duplicate-slug" | "unknown-section" | "duplicate-section-id";
  message: string;
  /** The article slug or section id the problem is about. */
  subject: string;
  /** Files involved, when the problem is about articles. */
  sourcePaths: string[];
}

/**
 * The article set and the configuration disagree.
 *
 * This is thrown rather than warned deliberately: an article assigned to a
 * section that does not exist renders nowhere, and a surface that silently drops
 * an article is worse than one that refuses to build. The failure is meant to
 * happen at the host's build or boot, not in front of a reader.
 */
export class ManifestError extends HowToError {
  readonly problems: ManifestProblem[];

  constructor(problems: ManifestProblem[]) {
    super(
      `how-to manifest is invalid:\n${problems.map((p) => `  - ${p.message}`).join("\n")}`,
    );
    this.name = "ManifestError";
    this.problems = problems;
  }
}
