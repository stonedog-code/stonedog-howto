import { NextResponse, type NextRequest } from "next/server";

import { searchForUser } from "../../../lib/api/search";
import { userFromAuthorization } from "../../../lib/api/token";

/**
 * Search, as the token's holder.
 *
 * The same access model as the browser, enforced in the same place. A client
 * cannot see further than the person whose token it carries.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await userFromAuthorization(request.headers.get("authorization"));
  // One response for a missing token, a malformed one and a revoked one.
  // Distinguishing them tells a caller which of those it is holding.
  if (user === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const input = (body ?? {}) as { query?: unknown; limit?: unknown; repo?: unknown };
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query === "") {
    return NextResponse.json({ error: "`query` is required" }, { status: 400 });
  }

  // Capped rather than trusted. An unbounded limit lets one call ask for every
  // article the reader may open, which is a slow query and a large response.
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(Math.trunc(input.limit), 1), 50)
      : 20;

  const results = await searchForUser(user, {
    query,
    limit,
    ...(typeof input.repo === "string" && input.repo !== "" ? { repo: input.repo } : {}),
  });

  return NextResponse.json({ query, count: results.length, results });
}
