/**
 * The fixture the E2E suite runs against.
 *
 * Built here rather than by driving the UI, for one reason: the suite is about
 * what a reader CAN SEE, and setting that up through the admin screens would
 * make every access assertion depend on those screens being right. When they
 * are wrong, the test should fail on the assertion, not disappear into a
 * broken setup.
 *
 * Articles are written directly rather than synced, so the suite does not need
 * a source repository on disk and cannot be broken by one changing. The sync
 * has its own tier.
 */

import { PrismaClient } from "@prisma/client";

// The same argon2 binding the app uses, rather than the app's password module.
// Importing that module pulls @stonedogcode/auth in, and it ships TypeScript
// SOURCE -- which Playwright's loader refuses with "Stripping types is
// currently unsupported for files under node_modules".
//
// Hashing here is still real: argon2 records its parameters in the PHC string,
// so the app's verify reads them back and accepts these hashes exactly as it
// would ones it produced itself. The sign-in tests below are what prove that.
import { hash as argon2Hash } from "@node-rs/argon2";

export const REPO_ALPHA = "AlphaProduct";
export const REPO_BETA = "BetaProduct";

/** Passwords the suite signs in with. Local fixtures; the portal never deploys. */
export const PASSWORD = "an-acceptable-e2e-passphrase";

export const ACCOUNT_ID = "e2e-account";

/**
 * Articles chosen so that every access outcome is distinguishable.
 *
 * A reader mapped to `Support` should end with exactly one visible article in
 * Alpha — which means a failure of "sees too much" and a failure of "sees too
 * little" produce different, nameable results rather than both reading as zero.
 */
export const ARTICLES = {
  /** Alpha, `Support`: the one a mapped reader may open. */
  visible: { slug: "alpha-support", title: "Contacting support", roles: ["Support"] },
  /** Alpha, `Operator`: a role that exists but is NOT mapped to the reader. */
  unmapped: { slug: "alpha-operator", title: "Rotating the signing key", roles: ["Operator"] },
  /** Alpha, no roles at all: reaches an operator, nobody else. */
  unclassified: { slug: "alpha-unclassified", title: "An unfinished note", roles: [] },
  /** Beta, `Support`: same source role, different repository, NOT granted. */
  otherRepo: { slug: "beta-support", title: "Beta support runbook", roles: ["Support"] },
} as const;

export interface SeededUsers {
  /** Signed up first, so the database makes them the account admin. */
  adminEmail: string;
  /** Granted Alpha as a Reader, mapped to `Support` only. */
  readerEmail: string;
  /** Granted nothing at all. */
  strangerEmail: string;
}

export const USERS: SeededUsers = {
  adminEmail: "admin@e2e.invalid",
  readerEmail: "reader@e2e.invalid",
  strangerEmail: "stranger@e2e.invalid",
};

/**
 * Reset to a known state.
 *
 * Deletes only what this suite creates. A blanket wipe would take a developer's
 * local portal with it, and the first time that happens nobody connects it to
 * the test run.
 */
export async function resetFixture(prisma: PrismaClient): Promise<void> {
  await prisma.article.deleteMany({ where: { repo: { accountId: ACCOUNT_ID } } });
  await prisma.roleMapping.deleteMany({ where: { repo: { accountId: ACCOUNT_ID } } });
  await prisma.repoGrant.deleteMany({ where: { user: { accountId: ACCOUNT_ID } } });
  await prisma.apiToken.deleteMany({ where: { user: { accountId: ACCOUNT_ID } } });
  await prisma.repo.deleteMany({ where: { accountId: ACCOUNT_ID } });
  await prisma.user.deleteMany({ where: { accountId: ACCOUNT_ID } });
  await prisma.account.deleteMany({ where: { id: ACCOUNT_ID } });
}

/** Create the account and its two repositories, with articles but no grants. */
export async function seedContent(prisma: PrismaClient): Promise<{ alphaId: string }> {
  await prisma.account.create({ data: { id: ACCOUNT_ID, name: "E2E" } });

  const alpha = await prisma.repo.create({
    data: { accountId: ACCOUNT_ID, name: REPO_ALPHA, path: "/e2e/alpha", status: "Active" },
  });
  const beta = await prisma.repo.create({
    data: { accountId: ACCOUNT_ID, name: REPO_BETA, path: "/e2e/beta", status: "Active" },
  });

  const article = (repoId: string, a: { slug: string; title: string; roles: readonly string[] }) => ({
    repoId,
    slug: a.slug,
    title: a.title,
    section: "general",
    order: 0,
    summary: `${a.title} — summary`,
    body: `## ${a.title}\n\nThe body of ${a.slug}.`,
    sourceRoles: [...a.roles],
    missingRoles: a.roles.length === 0,
  });

  await prisma.article.createMany({
    data: [
      article(alpha.id, ARTICLES.visible),
      article(alpha.id, ARTICLES.unmapped),
      article(alpha.id, ARTICLES.unclassified),
      article(beta.id, ARTICLES.otherRepo),
    ],
  });

  // Alpha maps Reader -> Support only. Beta maps Reader -> Support too, which
  // is the point: the reader is never GRANTED Beta, so an identical mapping
  // there must still yield nothing.
  await prisma.roleMapping.create({
    data: { repoId: alpha.id, role: "Reader", sourceRoles: ["Support"] },
  });
  await prisma.roleMapping.create({
    data: { repoId: beta.id, role: "Reader", sourceRoles: ["Support"] },
  });

  return { alphaId: alpha.id };
}

/**
 * Create the suite's users, hashed by the real password factor.
 *
 * Made here rather than by the sign-up tests, and that is the point. Depending
 * on an earlier test's side effects means no test can run alone -- and worse,
 * anything that re-runs `beforeAll` (a worker restart, a `--grep`) wipes the
 * fixture and every later test fails for a reason that has nothing to do with
 * what it asserts. This suite did exactly that before it was restructured.
 *
 * Roles are set directly. The rule that the FIRST signup becomes the admin is a
 * claim the sign-up test makes on its own throwaway account, where it can be
 * asserted rather than assumed.
 */
export async function seedUsers(prisma: PrismaClient): Promise<void> {
  const hash = await argon2Hash(PASSWORD);
  await prisma.user.createMany({
    data: [
      { accountId: ACCOUNT_ID, email: USERS.adminEmail, passwordHash: hash, role: "AccountAdmin" },
      { accountId: ACCOUNT_ID, email: USERS.readerEmail, passwordHash: hash, role: "Reader" },
      { accountId: ACCOUNT_ID, email: USERS.strangerEmail, passwordHash: hash, role: "Reader" },
    ],
  });
}

/** Grant a signed-up user a repository, by email. */
export async function grantRepo(
  prisma: PrismaClient,
  email: string,
  repoId: string,
  role: "Guest" | "Reader" | "Writer" | "AccountAdmin",
): Promise<void> {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  await prisma.repoGrant.create({ data: { userId: user.id, repoId, role } });
}

/** Promote a user to the deployment operator. */
export async function makeSystemAdmin(prisma: PrismaClient, email: string): Promise<void> {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  await prisma.user.update({ where: { id: user.id }, data: { role: "SystemAdmin" } });
}
