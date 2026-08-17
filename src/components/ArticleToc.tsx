import type { ReactElement } from "react";

import type { TocEntry } from "../types";

import { controlTapTarget } from "./tapTarget";

export interface ArticleTocProps {
  entries: TocEntry[];
  /** Accessible name for the navigation landmark. */
  label?: string;
  className?: string;
  /**
   * Built for each entry. Defaults to a same-page anchor. A host whose router
   * intercepts in-page navigation can substitute its own.
   */
  hrefFor?: (entry: TocEntry) => string;
}

/**
 * The clickable contents of one article.
 *
 * Renders nothing when there are no entries — `extractToc` already suppresses a
 * single-entry list, and a `<nav>` wrapping an empty list is a landmark a screen
 * reader announces and then has nothing to say about.
 *
 * Depth is expressed as a `data-depth` attribute rather than nested lists.
 * Markdown headings are not required to nest properly — an article that goes
 * `h2`, `h4` is common and legal — and reconstructing a tree from a sequence
 * that may skip levels invents structure the author did not write.
 */
export function ArticleToc({
  entries,
  label = "On this page",
  className,
  hrefFor = (entry) => `#${entry.id}`,
}: ArticleTocProps): ReactElement | null {
  if (entries.length === 0) return null;

  const shallowest = Math.min(...entries.map((e) => e.depth));

  return (
    <nav aria-label={label} className={className} data-testid="howto-article-toc">
      <ol>
        {entries.map((entry) => (
          <li key={entry.id} data-depth={entry.depth - shallowest}>
            {/* A contents entry is the whole of its row and navigates the
                page, so it is a control and carries the floor (NEH-874). */}
            <a href={hrefFor(entry)} style={controlTapTarget}>
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
