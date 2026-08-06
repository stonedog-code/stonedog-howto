import { extractHeadings, extractPlainText } from "./toc";
import type { Article, HowToViewer, TocEntry } from "./types";

/** One article, prepared for matching. */
export interface IndexedArticle {
  article: Article;
  headings: TocEntry[];
  /** Lowercased title / summary / heading text / prose, for matching. */
  haystack: {
    title: string;
    summary: string;
    headings: string;
    text: string;
  };
}

export type SearchIndex = IndexedArticle[];

export interface SearchResult {
  article: Article;
  /** Higher is a better match. Comparable only within one result set. */
  score: number;
  /** Headings that matched — offer these as deep links into the article. */
  matchedHeadings: TocEntry[];
}

/**
 * Prepare articles for searching.
 *
 * Parsing every article once up front, rather than per keystroke, is the whole
 * reason this is a separate step: the markdown parse is the expensive part and
 * the article set does not change between queries.
 */
export function buildSearchIndex(articles: Article[]): SearchIndex {
  return articles.map((article) => {
    const headings = extractHeadings(article.body);
    return {
      article,
      headings,
      haystack: {
        title: article.meta.title.toLowerCase(),
        summary: (article.meta.summary ?? "").toLowerCase(),
        headings: headings.map((h) => h.text).join(" ").toLowerCase(),
        text: extractPlainText(article.body).toLowerCase(),
      },
    };
  });
}

export interface SearchOptions {
  /** Cap on results returned. Defaults to unlimited. */
  limit?: number;
}

// Weights are ordered, not tuned: a query word in the title is a stronger
// signal than the same word in the prose, and that ordering is the only claim
// being made here.
const WEIGHT_TITLE = 8;
const WEIGHT_SUMMARY = 4;
const WEIGHT_HEADING = 2;
const WEIGHT_TEXT = 1;

/**
 * Find articles matching `query`, as seen by `viewer`.
 *
 * The viewer filter runs BEFORE matching, not after. This is the order that
 * matters: matching first and hiding afterwards still lets result counts,
 * ranking, and timing disclose that an article the reader may not open exists
 * and mentions their search term. A title is content.
 *
 * Every whitespace-separated word in the query must appear somewhere in the
 * article — an added word narrows the results, which is what a reader typing a
 * second word expects.
 */
export function search(
  index: SearchIndex,
  query: string,
  viewer: HowToViewer,
  options: SearchOptions = {},
): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [];

  const results: SearchResult[] = [];

  for (const entry of index) {
    if (!viewer.canSee(entry.article.meta.roles)) continue;

    let score = 0;
    let matchedEveryWord = true;

    for (const word of words) {
      let wordScore = 0;
      if (entry.haystack.title.includes(word)) wordScore += WEIGHT_TITLE;
      if (entry.haystack.summary.includes(word)) wordScore += WEIGHT_SUMMARY;
      if (entry.haystack.headings.includes(word)) wordScore += WEIGHT_HEADING;
      if (entry.haystack.text.includes(word)) wordScore += WEIGHT_TEXT;

      if (wordScore === 0) {
        matchedEveryWord = false;
        break;
      }
      score += wordScore;
    }

    if (!matchedEveryWord) continue;

    const matchedHeadings = entry.headings.filter((heading) => {
      const text = heading.text.toLowerCase();
      return words.every((word) => text.includes(word));
    });

    results.push({ article: entry.article, score, matchedHeadings });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Ties break on title so the order is stable rather than input-order
    // dependent — a list that reshuffles between identical queries reads as a
    // bug even when every result is correct.
    return a.article.meta.title.localeCompare(b.article.meta.title);
  });

  return options.limit !== undefined ? results.slice(0, options.limit) : results;
}
