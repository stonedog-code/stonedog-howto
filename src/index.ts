/**
 * @stonedogcode/howto — a how-to documentation surface for applications.
 *
 * Articles are markdown files that describe themselves in frontmatter. This
 * package turns a pile of them into an arranged, access-controlled, searchable
 * surface. It contains no articles of its own, and no role model of its own.
 */

export { parseArticle, type ParseArticleOptions } from "./article";
export {
  filterManifest,
  mappedRoleViewer,
  roleSetViewer,
  seesEverything,
  visibleArticles,
  type MappedRoleViewerOptions,
  type RoleMapping,
  type RoleSetViewerOptions,
  type UnrestrictedPolicy,
} from "./access";
export {
  ArticleParseError,
  HowToError,
  ManifestError,
  manifestErrors,
  manifestWarnings,
  type ManifestProblem,
  type ManifestProblemSeverity,
} from "./errors";
export { splitFrontmatter, type SplitDocument } from "./frontmatter";
export {
  buildManifest,
  validateArticles,
  type Manifest,
  type ManifestSection,
} from "./manifest";
export {
  buildSearchIndex,
  search,
  type IndexedArticle,
  type SearchIndex,
  type SearchOptions,
  type SearchResult,
} from "./search";
export {
  extractHeadings,
  extractPlainText,
  extractToc,
  type TocOptions,
} from "./toc";
export {
  renderArticle,
  type ArticleComponents,
  type RenderArticleOptions,
} from "./render/renderArticle";
export { ArticleToc, type ArticleTocProps } from "./components/ArticleToc";
export { HowToArticle, type HowToArticleProps } from "./components/HowToArticle";
export { HowToNav, type HowToNavProps } from "./components/HowToNav";
export { HowToSearch, type HowToSearchProps } from "./components/HowToSearch";
export type {
  Article,
  ArticleMeta,
  HowToConfig,
  HowToViewer,
  SectionDef,
  TocEntry,
} from "./types";
