/**
 * Loading a repository's articles, as this reader may see them.
 *
 * The single place a page asks "what may this person read here". Every route
 * goes through it, so there is one filtering path rather than one per page —
 * and a page that forgot to filter would have to have avoided this file
 * deliberately.
 */

import { buildManifest, filterManifest, type Article, type HowToConfig } from "@stonedogcode/howto";

import { prisma } from "./db/client";
import { userCan, type PortalUser, type RepoId } from "./rbac";
import { viewerForRepo, type RepoRoleMapping } from "./viewer";

export interface VisibleRepo {
  id: string;
  name: string;
  status: string;
}

/** A synced row, as the package's `Article` shape. */
function toArticle(row: {
  slug: string;
  title: string;
  section: string;
  order: number;
  summary: string | null;
  body: string;
  sourceRoles: string[];
  sourcePath: string | null;
}): Article {
  return {
    meta: {
      slug: row.slug,
      title: row.title,
      section: row.section,
      order: row.order,
      ...(row.summary !== null ? { summary: row.summary } : {}),
      // An EMPTY list must arrive as `undefined`, not `[]`. The package treats
      // an absent list as "entitles nobody" and rejects an empty one outright;
      // passing `[]` through would be asking a viewer a question the format
      // says is invalid.
      ...(row.sourceRoles.length > 0 ? { roles: row.sourceRoles } : {}),
    },
    body: row.body,
    ...(row.sourcePath !== null ? { sourcePath: row.sourcePath } : {}),
  };
}

async function mappingsFor(repoId: RepoId): Promise<RepoRoleMapping[]> {
  const rows = await prisma.roleMapping.findMany({ where: { repoId } });
  return rows.map((row) => ({
    role: row.role as RepoRoleMapping["role"],
    sourceRoles: row.sourceRoles,
    allSourceRoles: row.allSourceRoles,
    seesUnclassified: row.seesUnclassified,
  }));
}

/**
 * The sections and articles of one repository, filtered for this reader.
 *
 * Sections are derived from the articles themselves rather than configured:
 * the portal presents somebody else's documentation and has no business
 * inventing an arrangement for it. Each source repository already decided.
 */
export async function visibleManifestFor(
  user: PortalUser,
  repoId: RepoId,
): Promise<{ articles: Article[]; config: HowToConfig } | null> {
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { id: true, status: true },
  });
  // A dormant repository's articles are hidden. Same answer as "no such
  // repository", deliberately — a reader learning that a repository exists but
  // is unavailable has still learned it exists.
  if (repo === null || repo.status !== "Active") return null;

  // No grant at all is the same answer too, and this line was missing.
  //
  // Without it the page returned 200 and rendered the repository's NAME to
  // somebody who had never been granted it — an empty article list under a
  // heading that confirms the repository exists and what it is called. Every
  // article was correctly withheld and the disclosure was the page itself.
  //
  // Found by the E2E tier, which is the only place it could be: the viewer is
  // right, `filterManifest` is right, and the composition leaked. The line
  // between "may know it exists" and "may not" is the GRANT — a granted reader
  // whose mapping happens to match nothing still legitimately sees the
  // repository and an honest empty state.
  if (!userCan(user, "article:read", repoId)) return null;

  const rows = await prisma.article.findMany({
    where: { repoId },
    orderBy: [{ section: "asc" }, { order: "asc" }, { title: "asc" }],
    select: {
      slug: true,
      title: true,
      section: true,
      order: true,
      summary: true,
      body: true,
      sourceRoles: true,
      sourcePath: true,
    },
  });

  const articles = rows.map(toArticle);
  const sections = [...new Set(articles.map((a) => a.meta.section))].sort();
  const config: HowToConfig = { sections: sections.map((id) => ({ id, title: id })) };

  const viewer = viewerForRepo(user, repoId, await mappingsFor(repoId));
  const visible = filterManifest(buildManifest(articles, config), viewer);

  return { articles: [...visible.bySlug.values()], config };
}

/**
 * One article, or null.
 *
 * Goes through the same filter as the list rather than fetching by slug and
 * checking afterwards. Filtering only the navigation is the classic hole: the
 * article is gone from the sidebar and still served to anyone who guesses the
 * URL.
 */
export async function visibleArticle(
  user: PortalUser,
  repoId: RepoId,
  slug: string,
): Promise<Article | null> {
  const manifest = await visibleManifestFor(user, repoId);
  if (manifest === null) return null;
  return manifest.articles.find((article) => article.meta.slug === slug) ?? null;
}

/**
 * How many articles this reader may open, per repository.
 *
 * Exists because a *list* of repositories wants a number next to each one, and
 * the obvious number is the wrong one. `/repos` and `/api/repos` both rendered
 * `_count.articles` — the repository's total, straight from the database with
 * no viewer applied — so a reader mapped to a subset was told how much was
 * being withheld from them. On the portal's own content that was
 * `(110 articles)` to somebody who might open two.
 *
 * It is milder than the leaks the rest of this codebase guards against, because
 * it is a quantity rather than a title. It was also the one number on either
 * page that had not been passed through the viewer, sitting directly beneath a
 * comment explaining why everything else had been.
 *
 * ## Why not just build the manifests
 *
 * `visibleManifestFor` gives the honest number and reads every article's BODY
 * to do it. For one repository that is the page you are already rendering; for
 * a list of them it is the whole archive loaded to print three integers.
 *
 * So this reads only what the decision needs — each article's `sourceRoles` —
 * in two queries total, regardless of how many repositories are asked about.
 * Same viewer, same mappings, same answer.
 */
export async function readableArticleCounts(
  user: PortalUser,
  repoIds: readonly RepoId[],
): Promise<Map<RepoId, number>> {
  const counts = new Map<RepoId, number>(repoIds.map((repoId) => [repoId, 0]));
  if (repoIds.length === 0) return counts;

  const [articles, mappingRows] = await Promise.all([
    prisma.article.findMany({
      where: { repoId: { in: [...repoIds] } },
      select: { repoId: true, sourceRoles: true },
    }),
    prisma.roleMapping.findMany({ where: { repoId: { in: [...repoIds] } } }),
  ]);

  const mappingsByRepo = new Map<RepoId, RepoRoleMapping[]>();
  for (const row of mappingRows) {
    const list = mappingsByRepo.get(row.repoId) ?? [];
    list.push({
      role: row.role as RepoRoleMapping["role"],
      sourceRoles: row.sourceRoles,
      allSourceRoles: row.allSourceRoles,
      seesUnclassified: row.seesUnclassified,
    });
    mappingsByRepo.set(row.repoId, list);
  }

  // One viewer per repository, built once rather than per article: it resolves
  // the reader's roles against that repository's mapping, and doing it inside
  // the loop would repeat that work for every article in the archive.
  const viewers = new Map(
    repoIds.map((repoId) => [
      repoId,
      viewerForRepo(user, repoId, mappingsByRepo.get(repoId) ?? []),
    ]),
  );

  for (const article of articles) {
    const viewer = viewers.get(article.repoId);
    if (viewer === undefined) continue;
    // The same `[] means undefined` rule `toArticle` applies. An article with
    // no roles is unclassified, and whether this reader sees it is the
    // mapping's `seesUnclassified` answer -- not a question about an empty
    // list, which the format says is invalid.
    const roles = article.sourceRoles.length > 0 ? article.sourceRoles : undefined;
    if (viewer.canSee(roles)) counts.set(article.repoId, (counts.get(article.repoId) ?? 0) + 1);
  }

  return counts;
}
