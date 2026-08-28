import Link from "next/link";
import { redirect } from "next/navigation";

import { readableArticleCounts } from "../../lib/articles";
import { prisma } from "../../lib/db/client";
import { readableRepoIds, userCan } from "../../lib/rbac";
import { currentUser } from "../../lib/session/session";
import { logOutAction } from "../actions";

/**
 * The repositories this reader may open.
 *
 * Filtered on the SERVER, before any markup exists. A page that rendered every
 * repository and hid the forbidden ones in CSS would ship their names — and a
 * repository name alone tells a reader which products exist and that there is
 * documentation they are not entitled to.
 */
export default async function ReposPage() {
  const user = await currentUser();
  if (user === null) redirect("/login");

  const all = await prisma.repo.findMany({
    where: { status: { in: ["Active", "Dormant"] } },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  });

  const readable = new Set(readableRepoIds(user, all.map((repo) => repo.id)));
  const visible = all.filter((repo) => readable.has(repo.id));

  // The number of articles THIS READER may open, not the repository's total.
  // It was the total, sitting directly beneath the comment above explaining why
  // everything else on this page is filtered on the server -- so a reader
  // mapped to a subset was told how much was being kept from them. On this
  // portal's own content that was "(110 articles)" to somebody who might open
  // two. A quantity rather than a title, so much milder than the leaks the rest
  // of this page prevents, and the one number that had not been through the
  // viewer.
  const counts = await readableArticleCounts(user, visible.map((repo) => repo.id));

  const canManageMembers = userCan(user, "member:manage");
  // Per repository rather than globally: `mapping:manage` is scoped, and the
  // mapping screen itself shows only the repositories this person may
  // configure. Asking globally would hide the link from somebody who can
  // legitimately configure one of them.
  const canManageAnyMapping = all.some((repo) => userCan(user, "mapping:manage", repo.id));

  return (
    <main style={{ maxWidth: "40rem", margin: "3rem auto", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>How-to</h1>
        <span>
          {/*
            Derived from what this reader may actually do, never hardcoded.
            Both links were unconditional, so a plain reader was shown "Role
            mapping", followed it, and was redirected straight back — a menu
            item whose only function was to tell them a screen exists that they
            may not open. `userCan` is asked the same question the screen
            itself asks, so the two cannot drift.
          */}
          {canManageMembers ? <Link href="/admin/members">Members</Link> : null}{" "}
          {canManageAnyMapping ? <Link href="/admin/mapping">Role mapping</Link> : null}{" "}
          <form action={logOutAction} style={{ display: "inline" }}>
            <button type="submit">Sign out</button>
          </form>
        </span>
      </header>

      {visible.length === 0 ? (
        // Says nothing about what exists. "You have access to 0 of 3
        // repositories" would disclose that three exist.
        <p>There is nothing here for you to read yet.</p>
      ) : (
        <ul>
          {visible.map((repo) => (
            <li key={repo.id}>
              <Link href={`/repos/${repo.id}`}>{repo.name}</Link>
              {repo.status === "Dormant" ? " — no longer listed in articles.json" : null}
              {" "}({counts.get(repo.id) ?? 0} articles)
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
