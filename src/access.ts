import type { Manifest, ManifestSection } from "./manifest";
import type { Article, HowToViewer } from "./types";

/** A viewer that sees everything. For development and for single-audience sites. */
export const seesEverything: HowToViewer = { canSee: () => true };

export interface RoleSetViewerOptions {
  /** The role names this reader holds. */
  roles: string[];
  /**
   * Whether this reader may also see articles that declare no `roles` at all.
   * Defaults to true. Set false for a reader who should see only what is
   * explicitly granted to one of their roles.
   */
  seesUnrestricted?: boolean;
}

/**
 * A viewer built from plain set membership: the reader may see an article if
 * they hold one of the roles it names.
 *
 * Offered because set membership is what an article's `roles` list actually
 * expresses, and several applications need nothing more. A host with levels,
 * scopes, or per-organisation membership should implement {@link HowToViewer}
 * directly against its own authorisation rather than flattening it to a list of
 * names here — that flattening is where privilege leaks between scopes.
 */
export function roleSetViewer(options: RoleSetViewerOptions): HowToViewer {
  const held = new Set(options.roles);
  const seesUnrestricted = options.seesUnrestricted ?? true;

  return {
    canSee(requiredRoles) {
      if (requiredRoles === undefined) return seesUnrestricted;
      return requiredRoles.some((role) => held.has(role));
    },
  };
}

/** The articles this reader may see, in the order given. */
export function visibleArticles(articles: Article[], viewer: HowToViewer): Article[] {
  return articles.filter((article) => viewer.canSee(article.meta.roles));
}

function filterSection(
  section: ManifestSection,
  viewer: HowToViewer,
): ManifestSection | null {
  const articles = visibleArticles(section.articles, viewer);
  const children = section.children
    .map((child) => filterSection(child, viewer))
    .filter((child): child is ManifestSection => child !== null);

  // A section the reader can open nothing inside is not an empty section, it is
  // a disclosure: its title names a subject they are not entitled to know
  // exists. Prune it.
  if (articles.length === 0 && children.length === 0) return null;

  return { id: section.id, title: section.title, articles, children };
}

/**
 * The manifest as this reader should see it.
 *
 * Apply this on the server, before the manifest reaches the browser. Filtering
 * only in the UI ships every article's title, summary and body to a reader who
 * may not read them, where the network tab is enough to recover the lot.
 */
export function filterManifest(manifest: Manifest, viewer: HowToViewer): Manifest {
  const sections = manifest.sections
    .map((section) => filterSection(section, viewer))
    .filter((section): section is ManifestSection => section !== null);

  const bySlug = new Map<string, Article>();
  for (const [slug, article] of manifest.bySlug) {
    if (viewer.canSee(article.meta.roles)) bySlug.set(slug, article);
  }

  return { sections, bySlug };
}
