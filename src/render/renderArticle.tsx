import { Fragment, type ReactElement } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import rehypeReact, { type Components } from "rehype-react";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * Elements to substitute when rendering an article.
 *
 * Keyed by HTML tag name — `h2`, `a`, `table`, `code`. Anything not overridden
 * renders as the plain element. This is what keeps the renderer independent of
 * any design system: a host passes its own components, and a styled preset is
 * just one such map rather than a dependency every consumer inherits.
 *
 * This is the renderer's own `Components` type, re-exported rather than
 * restated, so a component map that satisfies the renderer satisfies this
 * signature by construction.
 */
export type ArticleComponents = Components;

export interface RenderArticleOptions {
  components?: ArticleComponents;
}

/**
 * Render an article's markdown body to React elements.
 *
 * Headings are given anchor ids by `rehype-slug` — the same slugger
 * `extractToc` uses, which is the whole reason a table-of-contents link lands on
 * its heading. The two run in separate passes and nothing checks at runtime that
 * they agree: when they disagree the anchor is simply dead and the page does not
 * move, with no error anywhere. `render.test.tsx` pins the agreement.
 *
 * Raw HTML embedded in an article is dropped, not rendered. `remark-rehype` is
 * deliberately left without `allowDangerousHtml`: articles are documentation,
 * and a documentation pipeline that renders whatever markup an author pastes in
 * is a script-injection route with a content-authoring interface in front of it.
 */
export function renderArticle(
  markdown: string,
  options: RenderArticleOptions = {},
): ReactElement {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeReact, {
      Fragment,
      jsx,
      jsxs,
      components: options.components ?? {},
    });

  return processor.processSync(markdown).result;
}
