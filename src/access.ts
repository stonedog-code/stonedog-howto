import type { Manifest, ManifestSection } from "./manifest";
import type { Article, HowToViewer } from "./types";

/** A viewer that sees everything. For development and for single-audience sites. */
export const seesEverything: HowToViewer = { canSee: () => true };

/**
 * What a viewer does with an article that declares no `roles` at all.
 *
 * **Defaults to `deny` everywhere in this package**, and the default is the
 * whole point. An article naming no audience has not said "everyone" — it has
 * said nothing, usually because whoever wrote it forgot. Treating silence as
 * the widest possible audience means the one article nobody finished is the one
 * article everybody can read.
 *
 * `allow` exists for the host that genuinely has a reader entitled to see
 * unfinished articles — typically whoever is expected to fix them. That is a
 * decision about a *person*, so the host makes it per reader:
 *
 * ```ts
 * unrestricted: viewerIsOperator ? "allow" : "deny"
 * ```
 *
 * which is how "only operators see articles missing their roles" is expressed
 * without this package ever learning what an operator is.
 */
export type UnrestrictedPolicy = "deny" | "allow";

export interface RoleSetViewerOptions {
  /** The role names this reader holds. */
  roles: string[];
  /**
   * What this reader may do with an article that declares no `roles`.
   * Defaults to `"deny"`.
   */
  unrestricted?: UnrestrictedPolicy;
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
  const unrestricted = options.unrestricted ?? "deny";

  return {
    canSee(requiredRoles) {
      if (requiredRoles === undefined) return unrestricted === "allow";
      return requiredRoles.some((role) => held.has(role));
    },
  };
}

/**
 * Permitted article roles, per role the reader holds.
 *
 * `"*"` grants every role name the articles use — for a reader trusted with a
 * whole body of documentation, where listing the names would mean editing this
 * mapping every time somebody adds one.
 */
export type RoleMapping = Readonly<Record<string, readonly string[] | "*">>;

export interface MappedRoleViewerOptions {
  /** The role names this reader holds, in the *reader's* vocabulary. */
  viewerRoles: readonly string[];
  /** What each of those roles is permitted to read, in the *articles'*. */
  mapping: RoleMapping;
  /**
   * What this reader may do with an article that declares no `roles`.
   * Defaults to `"deny"`.
   */
  unrestricted?: UnrestrictedPolicy;
}

/**
 * A viewer for the case where the reader's roles and the articles' roles are
 * **different vocabularies**, joined by an explicit mapping.
 *
 * This is what a host needs when it presents articles that were written
 * somewhere else. The names in an article's `roles` belong to whatever wrote
 * it, and the names a reader holds belong to whoever is presenting it; the two
 * coincide only by accident, and where they coincide by accident they are at
 * their most dangerous — one application's `Admin` silently meaning another's.
 *
 * ```ts
 * mappedRoleViewer({
 *   viewerRoles: ["Editor"],
 *   mapping: { Editor: ["Contributor", "Reviewer"], Owner: "*" },
 * });
 * ```
 *
 * ## Absence denies, and that is the load-bearing property
 *
 * A role the mapping does not mention grants nothing. A role name in an article
 * that no mapping entry lists is readable by nobody.
 *
 * This is what makes the mapping safe to get wrong. A mistake in a mapping
 * *hides* articles, which the reader who cannot find one complains about; the
 * alternative — where an unrecognised name simply fails to restrict anything —
 * *reveals* them, and nobody complains about being shown too much. Only one of
 * those two failures reports itself, so the design points every mistake at that
 * one.
 *
 * For the same reason there is no "fall back to matching names directly" mode.
 * It would be convenient exactly until two vocabularies shared a word.
 */
export function mappedRoleViewer(options: MappedRoleViewerOptions): HowToViewer {
  const unrestricted = options.unrestricted ?? "deny";

  let seesEveryRole = false;
  const permitted = new Set<string>();

  for (const held of options.viewerRoles) {
    // `Object.hasOwn` rather than a bare lookup: a mapping is host data, often
    // from a database, and a role named `constructor` or `toString` would
    // otherwise resolve to something off Object.prototype and be treated as a
    // grant.
    if (!Object.hasOwn(options.mapping, held)) continue; // absence denies
    const granted = options.mapping[held];
    if (granted === undefined) continue;
    if (granted === "*") {
      seesEveryRole = true;
      continue;
    }
    for (const role of granted) permitted.add(role);
  }

  return {
    canSee(requiredRoles) {
      // Deliberately checked before `*`. An article with no roles has no role
      // to be granted — its problem is that it is unfinished, not that it is
      // exclusive — so "may read every role" must not quietly also mean "may
      // read the ones nobody classified".
      if (requiredRoles === undefined) return unrestricted === "allow";
      if (seesEveryRole) return true;
      return requiredRoles.some((role) => permitted.has(role));
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
