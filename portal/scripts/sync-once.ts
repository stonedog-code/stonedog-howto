/**
 * Run the sync once, and print what it did.
 *
 * The hourly cron calls the same function; this is the operator's way to run it
 * now and read the result. Exits non-zero when anything was skipped, so an
 * unattended run cannot report success while quietly losing articles.
 */
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import { attentionSummary } from "../src/lib/sync/attention";
import { runSync } from "../src/lib/sync/run";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const report = await runSync({
    prisma,
    configPath: process.env.ARTICLES_CONFIG ?? join(process.cwd(), "articles.json"),
    pathPrefix: process.env.ARTICLES_PATH_PREFIX ?? "",
  });

  for (const problem of report.configProblems) {
    console.error(`articles.json: ${problem.message}`);
  }

  for (const repo of report.repos) {
    console.log(
      `${repo.name}: ${repo.outcome} — ${repo.articlesTaken} taken, ` +
        `${repo.skipped.length} skipped, ${repo.missingRoles} missing roles` +
        (repo.removed > 0 ? `, ${repo.removed} removed` : ""),
    );
    if (repo.note) console.log(`  ${repo.note}`);
    for (const skip of repo.skipped) console.error(`  SKIPPED ${skip.sourcePath}: ${skip.reason}`);
  }

  const { taken, skipped, missingRoles, removed } = report.totals;
  console.log(
    `\ntotal: ${taken} taken, ${skipped} skipped, ${missingRoles} missing roles, ${removed} removed`,
  );

  // Repositories the config names that ended the run serving nothing. Reported
  // separately from the skip list because they are a different failure: a skip
  // means one article did not make it, this means none of them did.
  const attention = attentionSummary(report.repos);
  for (const line of attention) console.error(`ATTENTION ${line}`);

  await prisma.$disconnect();

  // Three ways to fail, and the third is the one that was missing.
  //
  // A skipped article is an article the portal does not have and nobody asked
  // it to drop. Exiting 0 on that is how a cron job reports success forever
  // while the archive quietly goes incomplete.
  //
  // A repository serving NOTHING skips nothing — there was no article to skip —
  // so it slipped through the check above and the run reported success. That is
  // not a hypothetical: the portal's only repository sat in `path-changed` for
  // five days printing `sync finished cleanly` on every hourly run while
  // serving zero articles.
  if (skipped > 0 || report.configProblems.length > 0 || attention.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
