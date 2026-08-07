import type { Manifest, ManifestSection, Article, SearchResult } from "@stonedogcode/howto";

// Type-only, so nothing from the server module — least of all `node:fs`,
// reached through the article loader — survives into the browser bundle.
import type { HowToPayload, PayloadSection } from "../server/howto";
import type { ViewerId } from "../shared/viewers";

export type { HowToPayload, ViewerId };

/**
 * Rebuild the package's own shapes from the wire format.
 *
 * The payload is deliberately not the `Manifest` type serialised: `Manifest`
 * holds a `Map`, which JSON cannot carry, and it holds each article twice —
 * once in its section and once in the slug index. Sending slugs in the sections
 * and the articles once keeps the response honest about its size.
 */
export interface DemoState {
  payload: HowToPayload;
  manifest: Manifest;
  /** Results for the current query, or null when the box is empty. */
  results: SearchResult[] | null;
}

function toArticle(article: HowToPayload["articles"][number]): Article {
  return {
    meta: {
      title: article.title,
      slug: article.slug,
      section: article.section,
      // The server has already sorted every section, so rank carries no
      // information by the time it reaches here. Sending it would invite a
      // client-side re-sort that could disagree with what the server decided.
      order: 0,
      ...(article.summary === undefined ? {} : { summary: article.summary }),
      ...(article.roles === undefined ? {} : { roles: article.roles }),
    },
    body: article.body,
  };
}

function toSection(section: PayloadSection, bySlug: Map<string, Article>): ManifestSection {
  return {
    id: section.id,
    title: section.title,
    articles: section.articleSlugs.flatMap((slug) => {
      const article = bySlug.get(slug);
      return article ? [article] : [];
    }),
    children: section.children.map((child) => toSection(child, bySlug)),
  };
}

export function hydrate(payload: HowToPayload): DemoState {
  const bySlug = new Map<string, Article>();
  for (const article of payload.articles) bySlug.set(article.slug, toArticle(article));

  const manifest: Manifest = {
    sections: payload.sections.map((section) => toSection(section, bySlug)),
    bySlug,
  };

  const results =
    payload.results === null
      ? null
      : payload.results.flatMap((result) => {
          const article = bySlug.get(result.slug);
          if (!article) return [];
          return [
            {
              article,
              // Scores are comparable only within one result set and the server
              // already returned them in order, so the client is given none to
              // be tempted into re-ranking with.
              score: 0,
              matchedHeadings: result.matchedHeadings.map((heading) => ({
                ...heading,
                depth: 2,
              })),
            } satisfies SearchResult,
          ];
        });

  return { payload, manifest, results };
}

export interface FetchOptions {
  viewer: ViewerId;
  seesUnrestricted: boolean;
  query: string;
  signal: AbortSignal;
}

export async function fetchHowTo({
  viewer,
  seesUnrestricted,
  query,
  signal,
}: FetchOptions): Promise<DemoState> {
  const params = new URLSearchParams({
    viewer,
    unrestricted: seesUnrestricted ? "1" : "0",
  });
  if (query.trim() !== "") params.set("q", query.trim());

  const response = await fetch(`/api/howto?${params.toString()}`, { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return hydrate((await response.json()) as HowToPayload);
}
