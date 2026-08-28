import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { extractToc, renderArticle } from "@stonedogcode/howto";

import { visibleArticle } from "../../../../lib/articles";
import { prisma } from "../../../../lib/db/client";
import { currentUser } from "../../../../lib/session/session";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ repo: string; slug: string }>;
}) {
  const user = await currentUser();
  if (user === null) redirect("/login");

  const { repo: repoId, slug } = await params;

  // Fetched through the same filter as the list, not fetched then checked.
  // Filtering only the navigation is the classic hole: gone from the sidebar,
  // still served to anyone who guesses the URL.
  const article = await visibleArticle(user, repoId, slug);
  if (article === null) notFound();

  const repo = await prisma.repo.findUnique({ where: { id: repoId }, select: { name: true } });
  const toc = extractToc(article.body);

  return (
    <main style={{ maxWidth: "44rem", margin: "3rem auto", fontFamily: "system-ui" }}>
      <p><Link href={`/repos/${repoId}`}>← {repo?.name ?? "Back"}</Link></p>

      {article.meta.roles === undefined ? (
        <p
          role="alert"
          data-testid="missing-roles"
          style={{ border: "2px solid #8a1c1c", color: "#8a1c1c", padding: "0.75rem" }}
        >
          <strong>This article declares no roles.</strong> It reaches system
          administrators alone, and it is incomplete until someone adds the
          audience to its frontmatter at source.
        </p>
      ) : (
        // Provenance, not permission. These are the SOURCE application's role
        // names; they grant nothing here on their own, and are shown because a
        // reader deciding whether an article applies to them is helped by
        // seeing who it was written for.
        <p style={{ color: "#555" }}>
          Written for {article.meta.roles.join(", ")} in {repo?.name}
        </p>
      )}

      <h1>{article.meta.title}</h1>
      {article.meta.summary ? <p><em>{article.meta.summary}</em></p> : null}

      {toc.length > 0 ? (
        <nav aria-label="On this page">
          <ul>
            {toc.map((entry) => (
              <li key={entry.id} style={{ marginLeft: `${(entry.depth - 2) * 1}rem` }}>
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {/* Raw HTML in an article is dropped rather than rendered — these are
          somebody else's files, and a pipeline that renders whatever markup
          arrives is a script-injection route with an authoring interface in
          front of it. The package does this; it is noted here because it is
          the reason no `dangerouslySetInnerHTML` appears. */}
      <article>{renderArticle(article.body)}</article>
    </main>
  );
}
