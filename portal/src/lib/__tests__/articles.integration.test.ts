/**
 * Integration tier: the whole read path, from synced rows to what one person
 * may open.
 *
 * This is the portal's central claim, and it is the first test that exercises
 * every piece together — grant, mapping, viewer, manifest, filter. Each has
 * unit tests; none of them can catch the pieces being composed wrongly, and the
 * composition is where a disclosure would come from.
 */

import { PrismaClient } from "@prisma/client";

import { readableArticleCounts, visibleArticle, visibleManifestFor } from "../articles";
import type { PortalUser } from "../rbac";

const prisma = new PrismaClient();

let repoId: string;
let userId: string;

const reader = (): PortalUser => ({
  id: userId,
  accountRole: "Reader",
  grants: [{ role: "Reader", repoId }],
});

const operator = (): PortalUser => ({ id: "op", accountRole: "SystemAdmin", grants: [] });

const article = (slug: string, sourceRoles: string[]) => ({
  repoId,
  slug,
  title: `Article ${slug}`,
  section: "general",
  order: 0,
  body: "## Heading\n\nProse.",
  sourceRoles,
  missingRoles: sourceRoles.length === 0,
});

beforeEach(async () => {
  await prisma.article.deleteMany({});
  await prisma.roleMapping.deleteMany({});
  await prisma.repoGrant.deleteMany({});
  await prisma.repo.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.account.deleteMany({});

  const account = await prisma.account.create({ data: { name: "Acme" } });
  const user = await prisma.user.create({
    data: { accountId: account.id, email: "r@example.com", passwordHash: "x", role: "Reader" },
  });
  userId = user.id;

  const repo = await prisma.repo.create({
    data: { accountId: account.id, name: "Hopperguard", path: "/x", status: "Active" },
  });
  repoId = repo.id;

  await prisma.article.createMany({
    data: [
      article("facility", ["Facility Admin"]),
      article("org", ["Organization Admin"]),
      article("system", ["System Admin"]),
      article("unclassified", []),
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("what a reader may open", () => {
  it("sees exactly the source roles their mapping names — no more, no fewer", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["Facility Admin"] },
    });

    const manifest = await visibleManifestFor(reader(), repoId);
    expect(manifest?.articles.map((a) => a.meta.slug)).toEqual(["facility"]);
  });

  it("sees nothing at all when nobody has mapped their role", async () => {
    const manifest = await visibleManifestFor(reader(), repoId);
    expect(manifest?.articles).toEqual([]);
  });

  it("is not even told a repository they were not granted exists", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["Facility Admin"] },
    });
    const stranger: PortalUser = { id: userId, accountRole: "Reader", grants: [] };

    // Asserted as null, not as `?.articles` being empty. The optional chain
    // this replaces made null and "a manifest with no articles" the same
    // answer -- so it passed while the page rendered the repository's NAME to
    // somebody with no grant. An assertion that cannot tell those apart is not
    // asserting the thing that matters.
    expect(await visibleManifestFor(stranger, repoId)).toBeNull();
  });

  // The classic hole: gone from the sidebar, still served to anyone who guesses
  // the URL. Both paths go through the same filter, and this is what proves it.
  it("cannot open an unmapped article by guessing its slug", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["Facility Admin"] },
    });

    expect(await visibleArticle(reader(), repoId, "facility")).not.toBeNull();
    expect(await visibleArticle(reader(), repoId, "org")).toBeNull();
    expect(await visibleArticle(reader(), repoId, "system")).toBeNull();
  });
});

describe("articles declaring no roles", () => {
  it("are invisible to a reader, even one granted every source role", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: [], allSourceRoles: true },
    });

    const manifest = await visibleManifestFor(reader(), repoId);
    expect(manifest?.articles.map((a) => a.meta.slug).sort()).toEqual([
      "facility",
      "org",
      "system",
    ]);
    expect(manifest?.articles.map((a) => a.meta.slug)).not.toContain("unclassified");
  });

  it("reach a reader only when their row opts in", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: [], allSourceRoles: true, seesUnclassified: true },
    });

    const manifest = await visibleManifestFor(reader(), repoId);
    expect(manifest?.articles.map((a) => a.meta.slug)).toContain("unclassified");
  });

  it("always reach the system admin", async () => {
    const manifest = await visibleManifestFor(operator(), repoId);
    expect(manifest?.articles).toHaveLength(4);
  });

  // An empty `sourceRoles` column must reach the package as `undefined`. Passed
  // as `[]` it would be an empty role list, which the format rejects outright.
  it("arrive with roles undefined, not as an empty list", async () => {
    const found = await visibleArticle(operator(), repoId, "unclassified");
    expect(found?.meta.roles).toBeUndefined();
  });
});

describe("the system admin", () => {
  it("reads every repository without any mapping existing", async () => {
    expect(await prisma.roleMapping.count()).toBe(0);
    const manifest = await visibleManifestFor(operator(), repoId);
    expect(manifest?.articles).toHaveLength(4);
  });
});

describe("a repository the reader was never granted", () => {
  // Regression. This returned a manifest rather than null, so the PAGE rendered
  // 200 with the repository's name under an empty article list -- every article
  // correctly withheld, and the disclosure was the heading. Caught by the E2E
  // tier; pinned here, where it is cheap to run.
  it("is indistinguishable from one that does not exist", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: [], allSourceRoles: true },
    });
    const ungranted: PortalUser = { id: userId, accountRole: "Reader", grants: [] };

    expect(await visibleManifestFor(ungranted, repoId)).toBeNull();
    expect(await visibleArticle(ungranted, repoId, "facility")).toBeNull();
  });

  it("still shows a GRANTED reader the repository, even when nothing matches", async () => {
    // The line is the grant, not the mapping. Somebody granted a repository may
    // know it exists and see an honest empty state; somebody who was not, may
    // not learn it exists at all.
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["A Role Nothing Uses"] },
    });

    const manifest = await visibleManifestFor(reader(), repoId);
    expect(manifest).not.toBeNull();
    expect(manifest?.articles).toEqual([]);
  });
});

describe("a dormant repository", () => {
  // Same answer as "no such repository". A reader told it exists but is
  // unavailable has still been told it exists.
  it("is invisible even to a reader who was granted it", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: [], allSourceRoles: true },
    });
    await prisma.repo.update({ where: { id: repoId }, data: { status: "Dormant" } });

    expect(await visibleManifestFor(reader(), repoId)).toBeNull();
    expect(await visibleArticle(reader(), repoId, "facility")).toBeNull();
  });

  it("is invisible to the system admin too", async () => {
    await prisma.repo.update({ where: { id: repoId }, data: { status: "Dormant" } });
    expect(await visibleManifestFor(operator(), repoId)).toBeNull();
  });
});

/**
 * The count next to a repository in a LIST.
 *
 * The fixture is four articles under three distinct source roles plus one that
 * declares none, so "the reader's count" and "the repository's count" are
 * different numbers for every reader below. Against a fixture where they
 * happened to agree, every assertion here would pass against the bug.
 */
describe("how many articles a reader may open", () => {
  it("counts what the mapping grants, not what the repository holds", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["Facility Admin"] },
    });

    const counts = await readableArticleCounts(reader(), [repoId]);

    // The repository holds four. This is the number the list must print.
    expect(counts.get(repoId)).toBe(1);
    expect(await prisma.article.count({ where: { repoId } })).toBe(4);
  });

  it("counts nothing for a granted reader whose mapping matches nothing", async () => {
    // Legitimate and not an error: they may know the repository exists, and
    // there is nothing in it for them. An honest zero rather than a total.
    const counts = await readableArticleCounts(reader(), [repoId]);
    expect(counts.get(repoId)).toBe(0);
  });

  it("counts nothing at all for somebody who was never granted the repository", async () => {
    const stranger: PortalUser = { id: userId, accountRole: "Reader", grants: [] };
    const counts = await readableArticleCounts(stranger, [repoId]);
    expect(counts.get(repoId)).toBe(0);
  });

  it("includes the unclassified article only when the mapping says so", async () => {
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["Facility Admin"], seesUnclassified: true },
    });

    expect((await readableArticleCounts(reader(), [repoId])).get(repoId)).toBe(2);
  });

  it("counts every article for an operator", async () => {
    expect((await readableArticleCounts(operator(), [repoId])).get(repoId)).toBe(4);
  });

  it("agrees with the manifest, which is the number it is standing in for", async () => {
    // The whole justification for this function is that it is cheaper than
    // building the manifest. If the two ever disagree, the cheap one is wrong
    // and the list is lying — so they are compared directly rather than each
    // asserted against a hand-written number.
    await prisma.roleMapping.create({
      data: { repoId, role: "Reader", sourceRoles: ["Facility Admin", "System Admin"] },
    });

    const manifest = await visibleManifestFor(reader(), repoId);
    const counts = await readableArticleCounts(reader(), [repoId]);

    expect(counts.get(repoId)).toBe(manifest?.articles.length);
    expect(counts.get(repoId)).toBe(2);
  });

  it("answers for several repositories at once, without mixing them up", async () => {
    const other = await prisma.repo.create({
      data: {
        accountId: (await prisma.account.findFirstOrThrow()).id,
        name: "Rozcards",
        path: "/y",
        status: "Active",
      },
    });
    await prisma.article.create({
      data: {
        repoId: other.id,
        slug: "roz-only",
        title: "Roz only",
        section: "general",
        order: 0,
        body: "b",
        sourceRoles: ["Facility Admin"],
        missingRoles: false,
      },
    });
    await prisma.roleMapping.createMany({
      data: [
        { repoId, role: "Reader", sourceRoles: ["Facility Admin"] },
        { repoId: other.id, role: "Reader", sourceRoles: ["Facility Admin"] },
      ],
    });

    // Granted the first repository only. An identical mapping in the second
    // must still yield nothing, which is the property `access.spec.ts` proves
    // for articles and this proves for the number beside them.
    const counts = await readableArticleCounts(reader(), [repoId, other.id]);

    expect(counts.get(repoId)).toBe(1);
    expect(counts.get(other.id)).toBe(0);
  });

  it("returns a zero for a repository with no articles rather than omitting it", async () => {
    // A missing key would render as blank or crash a `.get(...)!`; the callers
    // print this straight into a list.
    const empty = await prisma.repo.create({
      data: {
        accountId: (await prisma.account.findFirstOrThrow()).id,
        name: "Empty",
        path: "/z",
        status: "Active",
      },
    });

    expect((await readableArticleCounts(operator(), [empty.id])).get(empty.id)).toBe(0);
  });
});
