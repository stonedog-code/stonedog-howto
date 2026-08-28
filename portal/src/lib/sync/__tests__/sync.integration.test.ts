/**
 * Integration tier: the sync against real files and a real database.
 *
 * The unit tests decide what SHOULD happen from plain data. Nothing there can
 * see a malformed file on disk, a duplicate slug across two directories, or an
 * article that stops existing between runs — and those are the cases where a
 * sync silently loses something.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import { runSync } from "../run";

const prisma = new PrismaClient();

let root: string;
let articlesDir: string;
let configPath: string;
let accountId: string;
let repoId: string;

const article = (name: string, frontmatter: string, body = "Prose."): void => {
  writeFileSync(join(articlesDir, name), `---\n${frontmatter}\n---\n\n${body}\n`);
};

const writeConfig = (repos: { name: string; path: string }[]): void => {
  writeFileSync(configPath, JSON.stringify({ repos }, null, 2));
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "howto-sync-"));
  articlesDir = join(root, "articles");
  mkdirSync(articlesDir);
  configPath = join(root, "articles.json");

  await prisma.article.deleteMany({});
  await prisma.roleMapping.deleteMany({});
  await prisma.repoGrant.deleteMany({});
  await prisma.repo.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.account.deleteMany({});

  const account = await prisma.account.create({ data: { id: "acct-sync", name: "Sync" } });
  accountId = account.id;

  const repo = await prisma.repo.create({
    data: { accountId, name: "Hopperguard", path: articlesDir, status: "Active" },
  });
  repoId = repo.id;
  // A mapping is what makes a repository "configured" and therefore syncable.
  await prisma.roleMapping.create({
    data: { repoId, role: "Reader", sourceRoles: ["Facility Admin"] },
  });

  writeConfig([{ name: "Hopperguard", path: articlesDir }]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a healthy sync", () => {
  it("takes the articles and records their provenance", async () => {
    article("one.md", 'title: One\nsection: general\nroles: ["Facility Admin"]');
    article("two.md", 'title: Two\nsection: general\nroles: ["System Admin"]');

    const report = await runSync({ prisma, configPath });

    expect(report.totals).toMatchObject({ taken: 2, skipped: 0, missingRoles: 0 });
    const stored = await prisma.article.findMany({ orderBy: { slug: "asc" } });
    expect(stored.map((a) => a.slug)).toEqual(["one", "two"]);
    expect(stored[0]?.sourceRoles).toEqual(["Facility Admin"]);
    expect(stored[0]?.sourcePath).toBe("one.md");
  });

  it("reads nested directories, and records paths relative to the root", async () => {
    mkdirSync(join(articlesDir, "admin"));
    writeFileSync(
      join(articlesDir, "admin", "deep.md"),
      '---\ntitle: Deep\nsection: general\nroles: ["System Admin"]\n---\n\nx\n',
    );

    await runSync({ prisma, configPath });
    const stored = await prisma.article.findUnique({
      where: { repoId_slug: { repoId, slug: "deep" } },
    });
    expect(stored?.sourcePath).toBe("admin/deep.md");
  });
});

describe("what a sync must never do quietly", () => {
  // The reason this whole tier exists. loadArticles throws on the first bad
  // file; one malformed article must not cost the portal the other hundred.
  it("reports a malformed article and keeps the rest", async () => {
    article("good.md", 'title: Good\nsection: general\nroles: ["System Admin"]');
    writeFileSync(join(articlesDir, "broken.md"), "---\nsection: general\n---\n\nno title\n");

    const report = await runSync({ prisma, configPath });

    expect(report.totals.taken).toBe(1);
    expect(report.totals.skipped).toBe(1);
    expect(report.repos[0]?.skipped[0]?.sourcePath).toBe("broken.md");
    expect(await prisma.article.count()).toBe(1);
  });

  // A slug is a URL. Picking a winner means the loser is missing, and a missing
  // article is indistinguishable from one nobody wrote.
  it("skips BOTH sides of a duplicate slug rather than picking one", async () => {
    mkdirSync(join(articlesDir, "a"));
    mkdirSync(join(articlesDir, "b"));
    const fm = '---\ntitle: Clash\nsection: general\nslug: clash\nroles: ["System Admin"]\n---\n\nx\n';
    writeFileSync(join(articlesDir, "a", "clash.md"), fm);
    writeFileSync(join(articlesDir, "b", "clash.md"), fm);

    const report = await runSync({ prisma, configPath });

    expect(report.totals.taken).toBe(0);
    expect(report.totals.skipped).toBe(2);
    expect(await prisma.article.count()).toBe(0);
  });

  it("counts the articles that name no audience", async () => {
    article("tagged.md", 'title: Tagged\nsection: general\nroles: ["System Admin"]');
    article("untagged.md", "title: Untagged\nsection: general");

    const report = await runSync({ prisma, configPath });

    expect(report.totals.missingRoles).toBe(1);
    const stored = await prisma.article.findUnique({
      where: { repoId_slug: { repoId, slug: "untagged" } },
    });
    expect(stored?.missingRoles).toBe(true);
    expect(stored?.sourceRoles).toEqual([]);
  });

  it("removes an article that has gone from source, and says how many", async () => {
    article("keep.md", 'title: Keep\nsection: general\nroles: ["System Admin"]');
    article("gone.md", 'title: Gone\nsection: general\nroles: ["System Admin"]');
    await runSync({ prisma, configPath });
    expect(await prisma.article.count()).toBe(2);

    rmSync(join(articlesDir, "gone.md"));
    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.removed).toBe(1);
    expect((await prisma.article.findMany()).map((a) => a.slug)).toEqual(["keep"]);
  });

  // The empty case is its own bug: `notIn: []` matches nothing, so a repository
  // emptied at source would keep serving every article it ever had.
  it("removes everything when every article is deleted at source", async () => {
    article("solo.md", 'title: Solo\nsection: general\nroles: ["System Admin"]');
    await runSync({ prisma, configPath });
    expect(await prisma.article.count()).toBe(1);

    rmSync(join(articlesDir, "solo.md"));
    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.removed).toBe(1);
    expect(await prisma.article.count()).toBe(0);
  });

  it("reports an unreadable directory instead of aborting the run", async () => {
    // The directory has to be the one the repository ALREADY points at, not a
    // new one. Pointing the config somewhere else is a path change, and that
    // check fires first and refuses to follow it -- correctly, which is why the
    // first version of this test failed.
    const missing = join(root, "does-not-exist");
    await prisma.repo.update({ where: { id: repoId }, data: { path: missing } });
    writeConfig([{ name: "Hopperguard", path: missing }]);

    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.outcome).toBe("unreadable");
    expect(report.repos[0]?.note).toMatch(/could not be read/);
  });
});

describe("reconciliation against the database", () => {
  it("syncs NOTHING for a repository nobody has mapped", async () => {
    await prisma.roleMapping.deleteMany({ where: { repoId } });
    article("one.md", 'title: One\nsection: general\nroles: ["System Admin"]');

    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.outcome).toBe("unconfigured");
    expect(await prisma.article.count()).toBe(0);
  });

  it("makes a repository dormant when the config stops naming it, KEEPING its mapping", async () => {
    article("one.md", 'title: One\nsection: general\nroles: ["System Admin"]');
    await runSync({ prisma, configPath });

    writeConfig([]);
    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.outcome).toBe("dormant");
    expect((await prisma.repo.findUnique({ where: { id: repoId } }))?.status).toBe("Dormant");
    // The whole point of dormant: a typo must not destroy hand-built mapping.
    expect(await prisma.roleMapping.count({ where: { repoId } })).toBe(1);
  });

  it("restores a dormant repository, with its mapping intact, when the name returns", async () => {
    article("one.md", 'title: One\nsection: general\nroles: ["System Admin"]');
    await runSync({ prisma, configPath });
    writeConfig([]);
    await runSync({ prisma, configPath });

    writeConfig([{ name: "Hopperguard", path: articlesDir }]);
    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.outcome).toBe("synced");
    expect((await prisma.repo.findUnique({ where: { id: repoId } }))?.status).toBe("Active");
    expect(await prisma.roleMapping.count({ where: { repoId } })).toBe(1);
  });

  it("refuses to follow a path change without an admin re-confirming", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(
      join(elsewhere, "sneaky.md"),
      '---\ntitle: Sneaky\nsection: general\nroles: ["System Admin"]\n---\n\nx\n',
    );
    writeConfig([{ name: "Hopperguard", path: elsewhere }]);

    const report = await runSync({ prisma, configPath });

    expect(report.repos[0]?.outcome).toBe("path-changed");
    // Nothing from the new directory was taken: the existing mapping was chosen
    // for the OLD articles, and applying it here would grant access to content
    // nobody reviewed.
    expect(await prisma.article.count()).toBe(0);
  });

  it("adopts a repository the config has just introduced, without syncing it", async () => {
    const other = join(root, "other");
    mkdirSync(other);
    writeConfig([
      { name: "Hopperguard", path: articlesDir },
      { name: "Rozcards", path: other },
    ]);

    const report = await runSync({ prisma, configPath });

    const rozcards = report.repos.find((r) => r.name === "Rozcards");
    expect(rozcards?.outcome).toBe("unconfigured");
    expect(await prisma.repo.count({ where: { name: "Rozcards", status: "Unconfigured" } })).toBe(1);
  });
});

describe("the config itself", () => {
  it("reports a bad entry and still syncs the good repositories", async () => {
    article("one.md", 'title: One\nsection: general\nroles: ["System Admin"]');
    writeFileSync(
      configPath,
      JSON.stringify({ repos: [{ name: "Hopperguard", path: articlesDir }, { path: "/nameless" }] }),
    );

    const report = await runSync({ prisma, configPath });

    expect(report.configProblems).toHaveLength(1);
    expect(report.totals.taken).toBe(1);
  });
});
