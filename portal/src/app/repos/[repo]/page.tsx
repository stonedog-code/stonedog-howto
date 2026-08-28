import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { visibleManifestFor } from "../../../lib/articles";
import { prisma } from "../../../lib/db/client";
import { currentUser } from "../../../lib/session/session";

export default async function RepoPage({ params }: { params: Promise<{ repo: string }> }) {
  const user = await currentUser();
  if (user === null) redirect("/login");

  const { repo: repoId } = await params;
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { id: true, name: true },
  });
  if (repo === null) notFound();

  const manifest = await visibleManifestFor(user, repo.id);
  // Null means dormant or gone. Same answer as "no such repository": a reader
  // told it exists but is unavailable has still been told it exists.
  if (manifest === null) notFound();

  const bySection = new Map<string, typeof manifest.articles>();
  for (const article of manifest.articles) {
    const group = bySection.get(article.meta.section) ?? [];
    group.push(article);
    bySection.set(article.meta.section, group);
  }

  return (
    <main style={{ maxWidth: "44rem", margin: "3rem auto", fontFamily: "system-ui" }}>
      <p><Link href="/repos">← All repositories</Link></p>
      <h1>{repo.name}</h1>

      {manifest.articles.length === 0 ? (
        // Says nothing about how many exist. "0 of 105" would disclose that
        // there are 105 articles this reader may not open.
        <p>There is nothing here for you to read.</p>
      ) : (
        [...bySection.entries()].map(([section, articles]) => (
          <section key={section}>
            <h2>{section}</h2>
            <ul>
              {articles.map((article) => (
                <li key={article.meta.slug}>
                  <Link href={`/repos/${repo.id}/${article.meta.slug}`}>{article.meta.title}</Link>
                  {article.meta.summary ? <> — {article.meta.summary}</> : null}
                  {article.meta.roles === undefined ? (
                    <strong style={{ color: "#8a1c1c" }}> ⚠ no roles declared</strong>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
