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

/**
 * How badly a problem breaks the surface.
 *
 * - `error` — the manifest cannot be built. The article would render nowhere,
 *   or two articles claim one URL.
 * - `warning` — the manifest builds, and something is wrong with an article
 *   that the host should surface rather than hide.
 *
 * The two need opposite handling, which is why the distinction exists. An
 * article assigned to a section that does not exist has no correct rendering,
 * so the build must stop. An article that forgot to say who may read it *does*
 * have a correct rendering — the most restrictive one — and refusing to build
 * for it would take down a hundred good articles for one incomplete one, which
 * is how a useful check ends up deleted by whoever needed a green build.
 */
export type ManifestProblemSeverity = "error" | "warning";

/** What is wrong with a set of articles, relative to a config. */
export interface ManifestProblem {
  kind:
    | "duplicate-slug"
    | "unknown-section"
    | "duplicate-section-id"
    | "missing-roles";
  severity: ManifestProblemSeverity;
  message: string;
  /** The article slug or section id the problem is about. */
  subject: string;
  /** Files involved, when the problem is about articles. */
  sourcePaths: string[];
}

/** The problems that stop a manifest being built. */
export function manifestErrors(problems: ManifestProblem[]): ManifestProblem[] {
  return problems.filter((problem) => problem.severity === "error");
}

/** The problems a host should surface without refusing to build. */
export function manifestWarnings(problems: ManifestProblem[]): ManifestProblem[] {
  return problems.filter((problem) => problem.severity === "warning");
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
