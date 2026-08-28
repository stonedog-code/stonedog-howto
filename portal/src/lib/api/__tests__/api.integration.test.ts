/**
 * Integration tier: token authentication and cross-repository search.
 *
 * The claim under test is that a token cannot see further than the person it
 * belongs to. That spans a token row, a user, their grants, a repository's
 * mapping and the package's search — no unit test can see all of it, and it is
 * the seam where a leak would happen.
 */

import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { searchForUser } from "../search";
import { hashToken, userFromAuthorization } from "../token";

const prisma = new PrismaClient();

let hgId: string;
let rcId: string;
let readerToken: string;
let operatorToken: string;
let strangerToken: string;

const bearer = (token: string): string => `Bearer ${token}`;

async function mint(userId: string, name: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await prisma.apiToken.create({ data: { userId, name, tokenHash: hashToken(token) } });
  return token;
}

const article = (repoId: string, slug: string, title: string, sourceRoles: string[]) => ({
  repoId,
  slug,
  title,
  section: "general",
  order: 0,
  body: "## Signing in\n\nAuthentication is described here.",
  sourceRoles,
  missingRoles: sourceRoles.length === 0,
});

beforeAll(async () => {
  await prisma.apiToken.deleteMany({});
  await prisma.article.deleteMany({});
  await prisma.roleMapping.deleteMany({});
  await prisma.repoGrant.deleteMany({});
  await prisma.repo.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.account.deleteMany({});

  const account = await prisma.account.create({ data: { name: "Acme" } });

  const hg = await prisma.repo.create({
    data: { accountId: account.id, name: "Hopperguard", path: "/hg", status: "Active" },
  });
  const rc = await prisma.repo.create({
    data: { accountId: account.id, name: "Rozcards", path: "/rc", status: "Active" },
  });
  hgId = hg.id;
  rcId = rc.id;

  await prisma.article.createMany({
    data: [
      article(hgId, "hg-auth", "Authentication in HopperGuard", ["Facility Admin"]),
      article(hgId, "hg-secret", "Authentication internals", ["System Admin"]),
      article(hgId, "hg-unclassified", "Authentication, unclassified", []),
      article(rcId, "rc-auth", "Authentication in RozCards", ["Owner"]),
    ],
  });

  await prisma.roleMapping.create({
    data: { repoId: hgId, role: "Reader", sourceRoles: ["Facility Admin"] },
  });
  await prisma.roleMapping.create({
    data: { repoId: rcId, role: "Reader", sourceRoles: ["Owner"] },
  });

  const reader = await prisma.user.create({
    data: { accountId: account.id, email: "reader@x", passwordHash: "x", role: "Reader" },
  });
  // Granted HopperGuard only. RozCards is mapped for Readers, which must not be
  // enough on its own — the grant is the other half.
  await prisma.repoGrant.create({
    data: { userId: reader.id, repoId: hgId, role: "Reader" },
  });

  const operator = await prisma.user.create({
    data: { accountId: account.id, email: "op@x", passwordHash: "x", role: "SystemAdmin" },
  });
  const stranger = await prisma.user.create({
    data: { accountId: account.id, email: "nobody@x", passwordHash: "x", role: "Reader" },
  });

  readerToken = await mint(reader.id, "mcp");
  operatorToken = await mint(operator.id, "mcp");
  strangerToken = await mint(stranger.id, "mcp");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("token authentication", () => {
  it("resolves a valid token to its user and their current grants", async () => {
    const user = await userFromAuthorization(bearer(readerToken));
    expect(user?.grants).toEqual([{ role: "Reader", repoId: hgId }]);
    expect(user?.accountRole).toBe("Reader");
  });

  it("refuses a missing, malformed, or unknown token identically", async () => {
    expect(await userFromAuthorization(null)).toBeNull();
    expect(await userFromAuthorization("not-a-bearer-header")).toBeNull();
    expect(await userFromAuthorization("Bearer ")).toBeNull();
    expect(await userFromAuthorization(bearer("wrong"))).toBeNull();
  });

  // The plaintext must not be recoverable from the database.
  it("stores only a hash", async () => {
    const rows = await prisma.apiToken.findMany({ select: { tokenHash: true } });
    for (const row of rows) {
      expect(row.tokenHash).not.toContain(readerToken);
      expect(row.tokenHash).toHaveLength(64);
    }
  });

  it("records that a token was used, without failing the request on it", async () => {
    await userFromAuthorization(bearer(readerToken));
    // Fire-and-forget, so allow the write to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(readerToken) },
      select: { lastUsedAt: true },
    });
    expect(row?.lastUsedAt).not.toBeNull();
  });

  // Revoking a person revokes their tokens in the same statement. A token that
  // outlives its user is a credential belonging to nobody.
  it("dies with its user", async () => {
    const doomed = await prisma.user.create({
      data: {
        accountId: (await prisma.account.findFirstOrThrow()).id,
        email: "doomed@x",
        passwordHash: "x",
        role: "Reader",
      },
    });
    const token = await mint(doomed.id, "temporary");
    expect(await userFromAuthorization(bearer(token))).not.toBeNull();

    await prisma.user.delete({ where: { id: doomed.id } });
    expect(await userFromAuthorization(bearer(token))).toBeNull();
  });
});

describe("search, as the token's holder", () => {
  const hits = async (token: string, query = "authentication") => {
    const user = await userFromAuthorization(bearer(token));
    return (await searchForUser(user!, { query })).map((hit) => hit.slug);
  };

  it("returns only what the reader's grant AND mapping allow", async () => {
    // hg-auth is granted. hg-secret is an unmapped source role. hg-unclassified
    // declares none. rc-auth is in a repository they were never granted, even
    // though a Reader mapping exists there.
    expect(await hits(readerToken)).toEqual(["hg-auth"]);
  });

  it("returns everything for the operator, across repositories", async () => {
    expect((await hits(operatorToken)).sort()).toEqual([
      "hg-auth",
      "hg-secret",
      "hg-unclassified",
      "rc-auth",
    ]);
  });

  it("returns nothing at all for someone with no grants", async () => {
    expect(await hits(strangerToken)).toEqual([]);
  });

  // The count itself is content: matching first and hiding afterwards lets a
  // result count disclose that an article the reader may not open exists and
  // mentions their term.
  it("does not let the result COUNT disclose withheld articles", async () => {
    const reader = await userFromAuthorization(bearer(readerToken));
    const operator = await userFromAuthorization(bearer(operatorToken));

    const readerHits = await searchForUser(reader!, { query: "authentication" });
    const operatorHits = await searchForUser(operator!, { query: "authentication" });

    expect(readerHits).toHaveLength(1);
    expect(operatorHits).toHaveLength(4);
  });

  it("never returns a withheld article's title or summary", async () => {
    const reader = await userFromAuthorization(bearer(readerToken));
    const serialised = JSON.stringify(await searchForUser(reader!, { query: "authentication" }));

    expect(serialised).not.toContain("Authentication internals");
    expect(serialised).not.toContain("Authentication in RozCards");
    expect(serialised).not.toContain("unclassified");
  });

  it("can be narrowed to one repository, without widening anything", async () => {
    const operator = await userFromAuthorization(bearer(operatorToken));
    const only = await searchForUser(operator!, { query: "authentication", repo: "Rozcards" });
    expect(only.map((hit) => hit.slug)).toEqual(["rc-auth"]);
  });

  it("honours a limit, ranked across repositories rather than per repository", async () => {
    const operator = await userFromAuthorization(bearer(operatorToken));
    expect(await searchForUser(operator!, { query: "authentication", limit: 2 })).toHaveLength(2);
  });

  it("returns nothing for a term no article uses", async () => {
    expect(await hits(operatorToken, "kubernetes")).toEqual([]);
  });
});
