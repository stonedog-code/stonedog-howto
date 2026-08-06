/**
 * @stonedogcode/howto — a how-to documentation surface for applications.
 *
 * Articles are markdown files that describe themselves in frontmatter. This
 * package turns a pile of them into an arranged, access-controlled, searchable
 * surface. It contains no articles of its own, and no role model of its own.
 */

export { parseArticle, type ParseArticleOptions } from "./article.js";
export {
  filterManifest,
  roleSetViewer,
  seesEverything,
  visibleArticles,
  type RoleSetViewerOptions,
} from "./access.js";
export {
  ArticleParseError,
  HowToError,
  ManifestError,
  type ManifestProblem,
} from "./errors.js";
export { splitFrontmatter, type SplitDocument } from "./frontmatter.js";
export {
  buildManifest,
  validateArticles,
  type Manifest,
  type ManifestSection,
} from "./manifest.js";
export {
  buildSearchIndex,
  search,
  type IndexedArticle,
  type SearchIndex,
  type SearchOptions,
  type SearchResult,
} from "./search.js";
export {
  extractHeadings,
  extractPlainText,
  extractToc,
  type TocOptions,
} from "./toc.js";
export {
  renderArticle,
  type ArticleComponents,
  type RenderArticleOptions,
} from "./render/renderArticle.js";
export { ArticleToc, type ArticleTocProps } from "./components/ArticleToc.js";
export { HowToArticle, type HowToArticleProps } from "./components/HowToArticle.js";
export { HowToNav, type HowToNavProps } from "./components/HowToNav.js";
export { HowToSearch, type HowToSearchProps } from "./components/HowToSearch.js";
export type {
  Article,
  ArticleMeta,
  HowToConfig,
  HowToViewer,
  SectionDef,
  TocEntry,
} from "./types.js";
