import { NextResponse, type NextRequest } from "next/server";

import { visibleArticle } from "../../../../../lib/articles";
import { userFromAuthorization } from "../../../../../lib/api/token";
import { prisma } from "../../../../../lib/db/client";

/** One article's full body, if this token's holder may open it. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ repo: string; slug: string }> },
): Promise<NextResponse> {
  const user = await userFromAuthorization(request.headers.get("authorization"));
  if (user === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { repo: repoName, slug } = await params;
  const repo = await prisma.repo.findFirst({
    where: { name: repoName },
    select: { id: true, name: true },
  });

  // Same answer whether the repository does not exist, the article does not
  // exist, or this reader may not open it. Three different 404s would let a
  // caller map what exists by trying.
  if (repo === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const article = await visibleArticle(user, repo.id, slug);
  if (article === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    repo: repo.name,
    slug: article.meta.slug,
    title: article.meta.title,
    section: article.meta.section,
    summary: article.meta.summary ?? null,
    // Provenance, not permission: the source application's role names.
    writtenFor: article.meta.roles ?? null,
    body: article.body,
  });
}
