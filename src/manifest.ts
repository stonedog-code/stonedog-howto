import { ManifestError, manifestErrors, type ManifestProblem } from "./errors";
import type { Article, HowToConfig, SectionDef } from "./types";

/** A section with the articles that landed in it, and its nested sections. */
export interface ManifestSection {
  id: string;
  title: string;
  /** Sorted by `order`, then title. */
  articles: Article[];
  children: ManifestSection[];
}

/** The whole how-to: the host's sections, populated. */
export interface Manifest {
  sections: ManifestSection[];
  /** Every article in the manifest, keyed by slug, for direct lookup by route. */
  bySlug: ReadonlyMap<string, Article>;
}

function walkSections(defs: SectionDef[], visit: (def: SectionDef) => void): void {
  for (const def of defs) {
    visit(def);
    if (def.children) walkSections(def.children, visit);
  }
}

/**
 * Everything wrong with this article set, relative to this config.
 *
 * Returns problems rather than throwing so a host can render them all at once —
 * fixing a hundred articles one thrown error at a time is its own punishment.
 *
 * Read `severity` before acting on the result. {@link buildManifest} refuses to
 * build on an `error` and builds anyway on a `warning`, and a host that treats
 * every problem as fatal will refuse to serve a surface over an article that
 * merely forgot to name its audience.
 */
export function validateArticles(
  articles: Article[],
  config: HowToConfig,
): ManifestProblem[] {
  const problems: ManifestProblem[] = [];

  const sectionIds = new Set<string>();
  walkSections(config.sections, (def) => {
    if (sectionIds.has(def.id)) {
      problems.push({
        kind: "duplicate-section-id",
        severity: "error",
        subject: def.id,
        message: `section id \`${def.id}\` is declared more than once; ids place articles, so they must be unique`,
        sourcePaths: [],
      });
    }
    sectionIds.add(def.id);
  });

  const seenSlugs = new Map<string, Article[]>();
  for (const article of articles) {
    const existing = seenSlugs.get(article.meta.slug);
    if (existing) existing.push(article);
    else seenSlugs.set(article.meta.slug, [article]);

    if (!sectionIds.has(article.meta.section)) {
      problems.push({
        kind: "unknown-section",
        severity: "error",
        subject: article.meta.slug,
        message: `article \`${article.meta.slug}\` declares section \`${article.meta.section}\`, which the configuration does not define — it would render nowhere`,
        sourcePaths: article.sourcePath ? [article.sourcePath] : [],
      });
    }

    // Reported, not thrown, and reported at all rather than left to the viewer.
    //
    // An article that names no audience is not "for everyone" — it is an
    // article whose author did not finish. Left silent, the omission is
    // invisible in the only direction that matters: whoever reads it decides
    // the audience, and the most common default is the widest one. So the
    // package says so out loud, and the host chooses what to do about it.
    if (article.meta.roles === undefined) {
      problems.push({
        kind: "missing-roles",
        severity: "warning",
        subject: article.meta.slug,
        message: `article \`${article.meta.slug}\` declares no \`roles\`, so no reader is explicitly entitled to it; add the roles that may read it`,
        sourcePaths: article.sourcePath ? [article.sourcePath] : [],
      });
    }
  }

  for (const [slug, group] of seenSlugs) {
    if (group.length > 1) {
      problems.push({
        kind: "duplicate-slug",
        severity: "error",
        subject: slug,
        message: `slug \`${slug}\` is used by ${group.length} articles; slugs are URLs and must be unique`,
        sourcePaths: group.flatMap((a) => (a.sourcePath ? [a.sourcePath] : [])),
      });
    }
  }

  return problems;
}

function compareArticles(a: Article, b: Article): number {
  if (a.meta.order !== b.meta.order) return a.meta.order - b.meta.order;
  return a.meta.title.localeCompare(b.meta.title);
}

function populate(defs: SectionDef[], bySection: Map<string, Article[]>): ManifestSection[] {
  return defs.map((def) => ({
    id: def.id,
    title: def.title,
    articles: (bySection.get(def.id) ?? []).slice().sort(compareArticles),
    children: def.children ? populate(def.children, bySection) : [],
  }));
}

/**
 * Arrange articles into the host's sections.
 *
 * Throws {@link ManifestError} if anything is wrong **enough**: a problem whose
 * severity is `error`. That is deliberate — the alternative is dropping an
 * article quietly, which looks identical to the article not existing and is
 * found, if ever, by a reader rather than a build.
 *
 * Warnings do not stop the build. An article missing its `roles` still has a
 * correct rendering (the most restrictive one), and refusing to build over it
 * would take a hundred good articles offline for one incomplete one. Call
 * {@link validateArticles} directly to surface those — the manifest cannot
 * carry them, because it is a description of the articles that placed
 * successfully.
 */
export function buildManifest(articles: Article[], config: HowToConfig): Manifest {
  const errors = manifestErrors(validateArticles(articles, config));
  if (errors.length > 0) throw new ManifestError(errors);

  const bySection = new Map<string, Article[]>();
  for (const article of articles) {
    const bucket = bySection.get(article.meta.section);
    if (bucket) bucket.push(article);
    else bySection.set(article.meta.section, [article]);
  }

  const bySlug = new Map<string, Article>();
  for (const article of articles) bySlug.set(article.meta.slug, article);

  return { sections: populate(config.sections, bySection), bySlug };
}
