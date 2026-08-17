import type { ReactElement } from "react";

import type { SearchResult } from "../search";
import type { Article } from "../types";

import { controlTapTarget, inputTapTarget } from "./tapTarget";

export interface HowToSearchProps {
  /** Current query. Controlled — the host owns the state and the debounce. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Results for `value`.
   *
   * Produced by `search(index, value, viewer)`. This component does not search
   * and holds no viewer: results arrive already filtered to what the reader may
   * open, so a component that renders too eagerly cannot disclose an article.
   */
  results: SearchResult[];
  hrefFor: (article: Article) => string;
  /** Built for a result's matched heading, to deep-link into the article. */
  headingHrefFor?: (article: Article, headingId: string) => string;
  label?: string;
  placeholder?: string;
  className?: string;
}

/** A search box over the article set, with its results. */
export function HowToSearch({
  value,
  onChange,
  results,
  hrefFor,
  headingHrefFor = (article, headingId) => `${hrefFor(article)}#${headingId}`,
  label = "Search the how-to",
  placeholder = "Search articles…",
  className,
}: HowToSearchProps): ReactElement {
  const query = value.trim();

  return (
    <div className={className} data-testid="howto-search">
      <label>
        <span>{label}</span>
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          // A search box is a control too, and a host's padding alone rarely
          // reaches the floor — the demo's own styling landed it at 43.6px
          // (NEH-874).
          style={inputTapTarget}
          data-testid="howto-search-input"
        />
      </label>

      {query === "" ? null : results.length === 0 ? (
        // Said plainly, and without explaining why. "No articles match" is
        // complete; anything about indexes, roles or permissions here would tell
        // a reader that something exists which they cannot see.
        <p data-testid="howto-search-empty">No articles match “{query}”.</p>
      ) : (
        <ul data-testid="howto-search-results">
          {results.map(({ article, matchedHeadings }) => (
            <li key={article.meta.slug}>
              {/* A result title is the whole of its line, with the summary
                  below it rather than around it — a control, not a link inside
                  a sentence (NEH-874). */}
              <a href={hrefFor(article)} style={controlTapTarget}>
                {article.meta.title}
              </a>
              {article.meta.summary ? <p>{article.meta.summary}</p> : null}

              {matchedHeadings.length > 0 ? (
                <ul>
                  {matchedHeadings.map((heading) => (
                    <li key={heading.id}>
                      <a href={headingHrefFor(article, heading.id)} style={controlTapTarget}>
                        {heading.text}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
