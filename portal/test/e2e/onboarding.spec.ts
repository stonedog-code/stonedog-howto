/**
 * Onboarding a repository, from `articles.json` to a reader opening an article.
 *
 * ## Why this exists as its own file
 *
 * `access.spec.ts` seeds its repositories, articles and mappings directly, and
 * says why: the suite is about what a reader CAN SEE, and setting that up
 * through the admin screens would make every access assertion depend on those
 * screens being right. That is the correct call for those tests.
 *
 * It also means **nothing exercised a repository's FIRST mapping**, and that is
 * where the portal was broken end to end. An unconfigured repository syncs
 * nothing, so it has no articles, so the mapping screen had no source roles to
 * offer, so it rendered a sentence instead of the form — and a repository could
 * never be adopted. Every tier was green. The portal served nothing for as long
 * as it had existed.
 *
 * So this file deliberately does the opposite of its neighbour: it seeds
 * **nothing** but an account, and drives the real screens. It is the only test
 * whose starting state is the one a new installation is actually in.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { PASSWORD } from "./seed";

const prisma = new PrismaClient();

const ACCOUNT_ID = "e2e-onboarding";
const REPO_NAME = "WidgetCo";
const ADMIN = "onboarding-admin@e2e.invalid";
const READER = "onboarding-reader@e2e.invalid";

/** The article a mapped reader should end up able to open. */
const SUPPORT_ARTICLE = { slug: "getting-started", title: "Getting started with Widgets" };
/** A second source role, so "adopted" and "granted everything" differ. */
const OPERATOR_ARTICLE = { slug: "rotating-the-key", title: "Rotating the signing key" };

// `__dirname` does not exist: this package is `"type": "module"`, so the spec
// is loaded as ESM and the CommonJS globals are simply absent.
const HERE = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = resolve(HERE, "fixtures", "onboarding");
const REPO_ROOT = resolve(HERE, "..", "..");

/**
 * An `articles.json` in a temp directory rather than the repo's own.
 *
 * The path inside it has to be absolute and machine-specific, so it cannot be a
 * committed fixture — and writing the repo's real `articles.json` during a test
 * run would point the developer's own portal at this fixture.
 */
let configPath: string;

async function wipe(): Promise<void> {
  await prisma.article.deleteMany({ where: { repo: { accountId: ACCOUNT_ID } } });
  await prisma.roleMapping.deleteMany({ where: { repo: { accountId: ACCOUNT_ID } } });
  await prisma.repoGrant.deleteMany({ where: { user: { accountId: ACCOUNT_ID } } });
  await prisma.repo.deleteMany({ where: { accountId: ACCOUNT_ID } });
  await prisma.user.deleteMany({ where: { accountId: ACCOUNT_ID } });
  await prisma.account.deleteMany({ where: { id: ACCOUNT_ID } });
}

/**
 * The sync, run as a SUBPROCESS — `npm run sync`, exactly as the hourly cron
 * invokes it.
 *
 * Not imported. `runSync` reaches `@stonedogcode/howto/node`, and that package
 * ships TypeScript SOURCE, which Playwright's loader refuses outright:
 *
 *     Stripping types is currently unsupported for files under node_modules
 *
 * (`seed.ts` hits the same wall and sidesteps it the same way.) Shelling out
 * turns that constraint into the better test: this asserts the operator-facing
 * output and the EXIT STATUS of the real command, which is what cron reads and
 * what a person runs by hand — not an object only a test ever sees.
 *
 * `process.env` already points at the test database, set at module scope in
 * playwright.config.ts, and the child inherits it.
 */
function sync(): { status: number; output: string } {
  const result = spawnSync("npm", ["run", "--silent", "sync"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ARTICLES_CONFIG: configPath },
    encoding: "utf8",
  });

  return {
    status: result.status ?? -1,
    // Both streams: the per-repository lines go to stdout and the ATTENTION
    // lines to stderr, and an assertion that read only one of them would be
    // blind to half of what this command exists to say.
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.fill('input[name="accountId"]', ACCOUNT_ID);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/repos");
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/repos");
}

test.beforeAll(async () => {
  await wipe();
  await prisma.account.create({ data: { id: ACCOUNT_ID, name: "Onboarding" } });

  configPath = join(mkdtempSync(join(tmpdir(), "howto-onboarding-")), "articles.json");
  writeFileSync(
    configPath,
    JSON.stringify({ repos: [{ name: REPO_NAME, path: ARTICLES_DIR }] }),
  );
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

// Serial, and genuinely so: this is one journey told in steps, and each step's
// starting state is the previous step's result. Splitting it into independent
// tests would mean re-driving the whole flow four times to assert four things
// about it.
test.describe.configure({ mode: "serial" });

test.describe("adopting a repository for the first time", () => {
  test("the first sync takes nothing, because nobody has mapped it", async () => {
    const { status, output } = sync();

    expect(output).toContain(`${REPO_NAME}: unconfigured`);
    expect(output).toContain("0 taken");
    expect(await prisma.article.count({ where: { repo: { accountId: ACCOUNT_ID } } })).toBe(0);

    // Taking nothing is CORRECT here — the safe state for content nobody has
    // decided about is not to be in the portal — and it is still something an
    // operator has to act on, so the command says so and exits non-zero.
    expect(output).toContain("ATTENTION");
    expect(status).toBe(1);
  });

  test("the mapping screen offers a form even with nothing synced", async ({ page }) => {
    await signUp(page, ADMIN);
    // The compound unique is `@@unique([accountId, email])`, so Prisma names it
    // `accountId_email` — in that order. Reversed, it is not a field Prisma
    // knows and the failure is a bare PrismaClientValidationError.
    await prisma.user.update({
      where: { accountId_email: { accountId: ACCOUNT_ID, email: ADMIN } },
      data: { role: "SystemAdmin" },
    });

    await page.goto("/admin/mapping");

    await expect(page.getByRole("heading", { name: REPO_NAME })).toBeVisible();

    // THE REGRESSION. This branch used to render an explanatory sentence
    // INSTEAD of the form, and a repository could never be adopted.
    const grantEverything = page.getByRole("checkbox", {
      name: "Reader may read every source role",
    });
    await expect(grantEverything).toBeVisible();

    // The per-role columns are legitimately absent — nothing has been synced,
    // so the repository's own role names are genuinely unknown. Asserted so
    // that "the form is here" cannot quietly come to mean "and it already has
    // the columns", which would be a different bug wearing this fix.
    await expect(page.getByRole("checkbox", { name: /may read Support$/ })).toHaveCount(0);
    await expect(page.getByText(/Nothing has been synced from this repository yet/)).toBeVisible();
  });

  test("granting All roles adopts the repository, and the next sync takes its articles", async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await page.goto("/admin/mapping");

    await page.getByRole("checkbox", { name: "Reader may read every source role" }).check();
    await page.getByRole("button", { name: `Save ${REPO_NAME}` }).click();

    await expect(page.getByRole("checkbox", { name: "Reader may read every source role" }))
      .toBeChecked();

    const { status, output } = sync();
    expect(output).toContain(`${REPO_NAME}: synced`);
    expect(output).toContain("total: 2 taken, 0 skipped, 0 missing roles");
    // Nothing left needing attention, so the command reports success — which
    // is the state the portal had never once reached before this.
    expect(output).not.toContain("ATTENTION");
    expect(status).toBe(0);
  });

  test("the columns appear once there is content to describe", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/admin/mapping");

    // Both source roles the fixture articles declare, gathered from the synced
    // content. This is the state the screen was originally written for, and it
    // is reachable now.
    await expect(page.getByRole("checkbox", { name: "Reader may read Support" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Reader may read Operator" })).toBeVisible();
  });

  test("a member with no grant is told nothing about what exists", async ({ page }) => {
    // Created directly: signup is its own journey and this test is about what
    // happens AFTERWARDS, when somebody who has joined has not yet been given
    // anything. Their role column says Reader, which — deliberately — grants
    // nothing on its own.
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    await prisma.user.create({
      data: {
        accountId: ACCOUNT_ID,
        email: READER,
        // The same hash the admin signed up with, so the real verify accepts it.
        passwordHash: admin.passwordHash,
        role: "Reader",
      },
    });

    await signIn(page, READER);

    await expect(page.getByText("There is nothing here for you to read yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: REPO_NAME })).toHaveCount(0);

    // And the administration they cannot use is not advertised to them. Both
    // links were unconditional, so a reader was shown "Role mapping", followed
    // it, and was redirected straight back.
    await expect(page.getByRole("link", { name: "Members" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Role mapping" })).toHaveCount(0);
  });

  test("the admin grants the repository THROUGH THE SCREEN", async ({ page }) => {
    // The regression this file's newest section exists for. Nothing in the
    // application wrote a RepoGrant at all: the access model's other half could
    // only be created by an integration test or by hand in psql, so a second
    // person could sign up, be given any role, and see nothing, permanently.
    await signIn(page, ADMIN);

    await page.getByRole("link", { name: "Members" }).click();
    await expect(page).toHaveURL(/\/admin\/members$/);

    const repo = await prisma.repo.findFirstOrThrow({ where: { accountId: ACCOUNT_ID } });

    await page
      .getByRole("checkbox", { name: `${READER} holds Reader in ${REPO_NAME}` })
      .check();
    await page.getByRole("button", { name: `Save ${READER}` }).click();

    // Polled, not read once. A server action is a POST that `click()` does not
    // wait for, and the obvious assertion here — that the checkbox is checked —
    // passes INSTANTLY against the box the test itself just ticked, whether or
    // not anything was saved. It did: the first version of this test asserted
    // exactly that, went green on the checkbox and then failed on the row.
    await expect
      .poll(() => prisma.repoGrant.count({ where: { repoId: repo.id, role: "Reader" } }))
      .toBe(1);

    // And the SERVER renders it back that way on a fresh request, which is a
    // different claim from the browser remembering a click.
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: `${READER} holds Reader in ${REPO_NAME}` }),
    ).toBeChecked();
  });

  test("the granted reader can now open the article, and the journey is complete", async ({
    page,
  }) => {
    const repo = await prisma.repo.findFirstOrThrow({ where: { accountId: ACCOUNT_ID } });

    await signIn(page, READER);
    await page.goto(`/repos/${repo.id}`);

    // Reader was mapped to EVERY source role, so both are readable — which is
    // what "All roles" means and why it is the right control for adoption.
    await expect(page.getByRole("link", { name: SUPPORT_ARTICLE.title })).toBeVisible();
    await expect(page.getByRole("link", { name: OPERATOR_ARTICLE.title })).toBeVisible();

    await page.getByRole("link", { name: SUPPORT_ARTICLE.title }).click();
    await expect(
      page.getByRole("heading", { name: SUPPORT_ARTICLE.title, level: 1 }),
    ).toBeVisible();
  });

  test("revoking the grant takes effect on the reader's next request", async ({ page }) => {
    // `currentUser` re-reads grants from the database on every call rather than
    // trusting the cookie, which is what makes this true — and is worth an
    // assertion, because caching them in the session would be an easy
    // optimisation that silently turns revocation into "on next sign-in".
    await signIn(page, ADMIN);
    await page.goto("/admin/members");
    await page
      .getByRole("checkbox", { name: `${READER} holds Reader in ${REPO_NAME}` })
      .uncheck();
    await page.getByRole("button", { name: `Save ${READER}` }).click();

    const repo = await prisma.repo.findFirstOrThrow({ where: { accountId: ACCOUNT_ID } });
    await expect.poll(() => prisma.repoGrant.count({ where: { repoId: repo.id } })).toBe(0);

    await signIn(page, READER);
    await expect(page.getByText("There is nothing here for you to read yet.")).toBeVisible();

    // Not merely absent from the list: the repository must not be reachable by
    // its id either, which is the hole a navigation-only filter leaves.
    const direct = await page.goto(`/repos/${repo.id}`);
    expect(direct?.status()).toBe(404);
  });
});
