import { NextResponse, type NextRequest } from "next/server";

import { readableArticleCounts } from "../../../lib/articles";
import { userFromAuthorization } from "../../../lib/api/token";
import { prisma } from "../../../lib/db/client";
import { readableRepoIds } from "../../../lib/rbac";

/** The repositories this token's holder may read. Nothing about the others. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await userFromAuthorization(request.headers.get("authorization"));
  if (user === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = await prisma.repo.findMany({
    where: { status: "Active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const readable = new Set(readableRepoIds(user, active.map((repo) => repo.id)));
  const visible = active.filter((repo) => readable.has(repo.id));

  // The count this token may OPEN, not the repository's total. It was the
  // total, and here that is worse than on the web page: an API count is exact
  // and machine-readable, so a caller could diff it against what `search`
  // returns and compute precisely how much was being withheld -- the inference
  // the whole access model is arranged to prevent. This tool's own description
  // promises it "says nothing about repositories it may not read"; the number
  // has to keep the same promise about articles.
  const counts = await readableArticleCounts(user, visible.map((repo) => repo.id));

  return NextResponse.json({
    repos: visible.map((repo) => ({ name: repo.name, articles: counts.get(repo.id) ?? 0 })),
  });
}
