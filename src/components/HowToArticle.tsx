import type { ReactElement } from "react";

import { extractToc } from "../toc.js";
import { renderArticle, type ArticleComponents } from "../render/renderArticle.js";
import type { Article, TocEntry } from "../types.js";

import { ArticleToc } from "./ArticleToc.js";

export interface HowToArticleProps {
  article: Article;
  /**
   * The contents to show. Computed from the article when omitted; pass it in
   * when the same entries are already needed elsewhere on the page, so the body
   * is not parsed twice.
   */
  toc?: TocEntry[];
  /** Substitute elements in the rendered body. */
  components?: ArticleComponents;
  /** Set false to render the body alone, without the heading block. */
  showHeader?: boolean;
  className?: string;
}

/**
 * One article: its title, summary, table of contents, and body.
 *
 * The title is rendered from `meta.title` rather than from a `#` heading in the
 * markdown. Articles are addressed by slug and listed by title, so the title has
 * to exist as data; taking it from the body as well would give an article two
 * titles that can disagree.
 */
export function HowToArticle({
  article,
  toc,
  components,
  showHeader = true,
  className,
}: HowToArticleProps): ReactElement {
  const entries = toc ?? extractToc(article.body);

  return (
    <article className={className} data-testid="howto-article">
      {showHeader ? (
        <header>
          <h1>{article.meta.title}</h1>
          {article.meta.summary ? <p>{article.meta.summary}</p> : null}
        </header>
      ) : null}

      <ArticleToc entries={entries} />

      <div data-testid="howto-article-body">
        {renderArticle(article.body, components ? { components } : {})}
      </div>
    </article>
  );
}
