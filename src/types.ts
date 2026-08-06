/**
 * The article model.
 *
 * An article is a markdown file that describes itself. Everything the surface
 * needs in order to place it, title it, and decide who may read it lives in the
 * file's own frontmatter — so adding an article is writing a file, and nothing
 * else. There is deliberately no central list of articles to keep in step.
 */

/** What an article declares about itself in its YAML frontmatter. */
export interface ArticleMeta {
  /** Heading and navigation label. Required. */
  title: string;
  /**
   * URL-safe identifier, unique across the whole set. Defaults to the source
   * file's basename when the file is read from disk.
   */
  slug: string;
  /** The id of the section this article belongs to. Must exist in the config. */
  section: string;
  /** Rank within the section, ascending. Ties break on title. Defaults to 0. */
  order: number;
  /** One line shown under the title in listings and search results. */
  summary?: string;
  /**
   * Which roles may read this article.
   *
   * These are *host* role names — this package never interprets them, it only
   * hands the list to the host's {@link HowToViewer}. Different applications
   * name their roles differently and that is expected; the article is the right
   * place for the requirement because the article is the thing being protected.
   *
   * Omitted means "no per-article requirement": the viewer decides the default
   * audience. A host that wants omission to mean "most privileged role only"
   * implements exactly that in its `canSee`.
   */
  roles?: string[];
}

/** A parsed article: its declared metadata plus the markdown body. */
export interface Article {
  meta: ArticleMeta;
  /** The markdown body, with the frontmatter block removed. */
  body: string;
  /**
   * Where the article was read from. Diagnostics only — it appears in
   * validation errors so a broken article is findable, and is never rendered.
   */
  sourcePath?: string;
}

/**
 * Decides what a given reader may see.
 *
 * The host implements this from whatever authorisation it already has. The
 * package never models roles, levels, or scopes itself: doing so would force
 * every application onto one role model, and they do not share one.
 */
export interface HowToViewer {
  /**
   * @param requiredRoles the article's declared `roles`, or `undefined` when it
   *   declared none.
   * @returns whether this reader may see the article — in navigation, in search
   *   results, and in the rendered body alike.
   */
  canSee(requiredRoles: string[] | undefined): boolean;
}

/** A section of the how-to, as declared by the host's configuration. */
export interface SectionDef {
  /** Matches an article's `section`. Unique across the whole tree. */
  id: string;
  /** Navigation label. */
  title: string;
  /** Nested sections, rendered in the order given. */
  children?: SectionDef[];
}

/**
 * The host's arrangement of sections. Order is the order of this array; an
 * article's position inside a section comes from its own `order`.
 */
export interface HowToConfig {
  sections: SectionDef[];
}

/** One entry in an article's table of contents. */
export interface TocEntry {
  /**
   * The heading's anchor id. Produced by the same slugger `rehype-slug` uses,
   * so a link built from this entry resolves against the rendered heading.
   */
  id: string;
  /** The heading's text content, with any inline markup flattened away. */
  text: string;
  /** Markdown heading depth: 1 for `#`, 2 for `##`, and so on. */
  depth: number;
}
