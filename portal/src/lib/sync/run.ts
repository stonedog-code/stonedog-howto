/**
 * One sync run: reconcile the config, read what is mapped, report everything.
 *
 * The reporting is not decoration. A sync that silently drops an article
 * recreates exactly the failure the self-describing article format exists to
 * end — an article missing from the portal is indistinguishable from an article
 * nobody wrote. So every run says what it took, what it skipped and why, and
 * how many articles name no audience.
 */

import { readFileSync } from "node:fs";

import type { PrismaClient } from "@prisma/client";

import { type RepoOutcome } from "./attention";
import { parseConfig, type ConfigProblem } from "./config";
import { reconcile, type KnownRepo } from "./reconcile";
import { readArticlesFrom, type SkippedArticle } from "./readArticles";

export interface RepoReport {
  name: string;
  outcome: RepoOutcome;
  articlesTaken: number;
  /** Articles that named no `roles` at all. The number that has to be seen. */
  missingRoles: number;
  /** Articles removed because they are gone from source. */
  removed: number;
  skipped: SkippedArticle[];
  note?: string;
}

export interface SyncReport {
  repos: RepoReport[];
  configProblems: ConfigProblem[];
  totals: { taken: number; skipped: number; missingRoles: number; removed: number };
}

export interface SyncOptions {
  prisma: PrismaClient;
  configPath: string;
  /**
   * Prefix substituted onto each configured path.
   *
   * The paths in `articles.json` are this machine's, and the portal runs in a
   * container with the source tree bind-mounted somewhere else. Without this a
   * sync reads a nonexistent directory — and the failure mode to avoid is the
   * quiet one, where it reads an EMPTY directory and reports a repository with
   * no articles, which looks exactly like a repository that has none.
   */
  pathPrefix?: string;
}

/**
 * The account a synced repository belongs to.
 *
 * Single-account for now, and asserted rather than assumed. Taking "the first
 * account" would silently attach every repository to whichever was created
 * first, and that mistake surfaces only as somebody reading another account's
 * documentation.
 */
async function soleAccountId(prisma: PrismaClient): Promise<string> {
  const accounts = await prisma.account.findMany({ select: { id: true }, take: 2 });
  if (accounts.length === 0) {
    throw new Error("sync: no account exists to attach repositories to");
  }
  if (accounts.length > 1) {
    throw new Error(
      "sync: more than one account exists, and the sync has no rule for choosing between them",
    );
  }
  return accounts[0]!.id;
}

export async function runSync({
  prisma,
  configPath,
  pathPrefix = "",
}: SyncOptions): Promise<SyncReport> {
  const { repos: configured, problems: configProblems } = parseConfig(
    readFileSync(configPath, "utf8"),
  );

  const known = await prisma.repo.findMany({
    select: {
      id: true,
      name: true,
      path: true,
      status: true,
      _count: { select: { mappings: true } },
    },
  });

  const asKnown: KnownRepo[] = known.map((repo) => ({
    id: repo.id,
    name: repo.name,
    path: repo.path,
    status: repo.status as KnownRepo["status"],
    // "Configured" means an admin has decided who may read it. Until then the
    // repository syncs nothing at all.
    isConfigured: repo._count.mappings > 0,
  }));

  const { actions } = reconcile(configured, asKnown);
  const reports: RepoReport[] = [];

  for (const action of actions) {
    if (action.kind === "dormant") {
      await prisma.repo.update({ where: { id: action.id }, data: { status: "Dormant" } });
      reports.push({
        name: action.name,
        outcome: "dormant",
        articlesTaken: 0,
        missingRoles: 0,
        removed: 0,
        skipped: [],
        note: "absent from articles.json — articles hidden, mapping kept for re-add",
      });
      continue;
    }

    if (action.kind === "path-changed") {
      reports.push({
        name: action.name,
        outcome: "path-changed",
        articlesTaken: 0,
        missingRoles: 0,
        removed: 0,
        skipped: [],
        note: `path changed from ${action.from} to ${action.to} — not followed; an admin must re-confirm`,
      });
      continue;
    }

    if (action.kind === "adopt") {
      const accountId = await soleAccountId(prisma);
      await prisma.repo.upsert({
        where: { accountId_name: { accountId, name: action.name } },
        create: {
          accountId,
          name: action.name,
          path: action.path,
          status: "Unconfigured",
        },
        update: { path: action.path, status: "Unconfigured" },
      });
      reports.push({
        name: action.name,
        outcome: "unconfigured",
        articlesTaken: 0,
        missingRoles: 0,
        removed: 0,
        skipped: [],
        note: "no roles mapped yet — nothing synced, because content nobody has mapped is content nobody has decided about",
      });
      continue;
    }

    let read;
    try {
      read = readArticlesFrom(pathPrefix + action.path);
    } catch (error) {
      // An unreadable directory is reported, not thrown: one missing mount must
      // not stop every other repository syncing.
      reports.push({
        name: action.name,
        outcome: "unreadable",
        articlesTaken: 0,
        missingRoles: 0,
        removed: 0,
        skipped: [],
        note: `could not be read at ${pathPrefix + action.path}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      });
      continue;
    }

    const seen: string[] = [];
    let missingRoles = 0;

    for (const article of read.articles) {
      const roles = article.meta.roles ?? [];
      if (roles.length === 0) missingRoles += 1;

      const fields = {
        title: article.meta.title,
        section: article.meta.section,
        order: article.meta.order,
        summary: article.meta.summary ?? null,
        body: article.body,
        sourceRoles: roles,
        missingRoles: roles.length === 0,
        sourcePath: article.sourcePath ?? null,
      };

      await prisma.article.upsert({
        where: { repoId_slug: { repoId: action.id, slug: article.meta.slug } },
        create: { repoId: action.id, slug: article.meta.slug, ...fields },
        update: fields,
      });
      seen.push(article.meta.slug);
    }

    // Articles gone from source are removed, so the portal stops serving
    // something its author deleted. Counted in the report rather than
    // disappearing quietly — and note an empty `seen` means every article was
    // deleted at source, which must remove all of them rather than none.
    const removed = await prisma.article.deleteMany({
      where:
        seen.length > 0
          ? { repoId: action.id, slug: { notIn: seen } }
          : { repoId: action.id },
    });

    await prisma.repo.update({
      where: { id: action.id },
      data: { status: "Active", path: action.path },
    });

    reports.push({
      name: action.name,
      outcome: "synced",
      articlesTaken: read.articles.length,
      missingRoles,
      removed: removed.count,
      skipped: read.skipped,
    });
  }

  return {
    repos: reports,
    configProblems,
    totals: {
      taken: reports.reduce((sum, r) => sum + r.articlesTaken, 0),
      skipped: reports.reduce((sum, r) => sum + r.skipped.length, 0),
      missingRoles: reports.reduce((sum, r) => sum + r.missingRoles, 0),
      removed: reports.reduce((sum, r) => sum + r.removed, 0),
    },
  };
}
