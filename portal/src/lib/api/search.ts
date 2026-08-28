/**
 * Searching across every repository this reader may open.
 *
 * The ranking is the package's: titles outrank summaries, which outrank
 * headings, which outrank prose; every query word must appear; code blocks are
 * excluded. Nothing here re-implements it — a second search would rank
 * differently from the one the UI uses, and the two disagreeing about what
 * matches is worse than either being imperfect.
 */

import { buildSearchIndex, search, type Article } from "@stonedogcode/howto";

import { prisma } from "../db/client";
import type { PortalUser } from "../rbac";
import { viewerForRepo, type RepoRoleMapping } from "../viewer";

export interface SearchHit {
  repo: string;
  slug: string;
  title: string;
  summary?: string;
  /** The SOURCE application's role names. Provenance, not permission. */
  writtenFor?: string[];
  matchedHeadings: string[];
  score: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  /** Restrict to one repository by name. */
  repo?: string;
}

/**
 * Results this reader may open, ranked.
 *
 * Filtering happens **inside** the package's `search`, before matching — not
 * after. Matching first and hiding afterwards still lets result counts, ranking
 * and timing disclose that an article the reader may not open exists and
 * mentions their term. A title is content.
 */
export async function searchForUser(
  user: PortalUser,
  { query, limit = 20, repo }: SearchOptions,
): Promise<SearchHit[]> {
  const repos = await prisma.repo.findMany({
    where: { status: "Active", ...(repo !== undefined ? { name: repo } : {}) },
    select: {
      id: true,
      name: true,
      mappings: true,
      articles: {
        select: {
          slug: true,
          title: true,
          section: true,
          order: true,
          summary: true,
          body: true,
          sourceRoles: true,
        },
      },
    },
  });

  const hits: SearchHit[] = [];

  for (const row of repos) {
    const mappings: RepoRoleMapping[] = row.mappings.map((mapping) => ({
      role: mapping.role as RepoRoleMapping["role"],
      sourceRoles: mapping.sourceRoles,
      allSourceRoles: mapping.allSourceRoles,
      seesUnclassified: mapping.seesUnclassified,
    }));

    const articles: Article[] = row.articles.map((article) => ({
      meta: {
        slug: article.slug,
        title: article.title,
        section: article.section,
        order: article.order,
        ...(article.summary !== null ? { summary: article.summary } : {}),
        // Empty must arrive as `undefined`: the format rejects an empty list,
        // and an absent one is what means "entitles nobody".
        ...(article.sourceRoles.length > 0 ? { roles: article.sourceRoles } : {}),
      },
      body: article.body,
    }));

    const viewer = viewerForRepo(user, row.id, mappings);
    for (const result of search(buildSearchIndex(articles), query, viewer)) {
      hits.push({
        repo: row.name,
        slug: result.article.meta.slug,
        title: result.article.meta.title,
        ...(result.article.meta.summary !== undefined
          ? { summary: result.article.meta.summary }
          : {}),
        ...(result.article.meta.roles !== undefined
          ? { writtenFor: result.article.meta.roles }
          : {}),
        matchedHeadings: result.matchedHeadings.map((heading) => heading.text),
        score: result.score,
      });
    }
  }

  // Ranked across repositories, then trimmed. Trimming per repository first
  // would drop a better hit from one product to make room for a worse one from
  // another.
  hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.title.localeCompare(b.title)));
  return hits.slice(0, limit);
}
