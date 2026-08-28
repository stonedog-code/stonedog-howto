/**
 * The access model, in a browser.
 *
 * Every tier below this one tests a piece: the viewer resolves a mapping (unit),
 * the database arbitrates the admin race (integration). None of them can catch
 * the pieces being composed wrongly by page code — and the composition is where
 * a disclosure would come from.
 *
 * The assertion this file exists for is `the response body`, below. It is the
 * only one that can catch filtering drifting client-side, and jsdom cannot see
 * it at all: a title absent from the sidebar but present in the payload is
 * exactly the hole this design was built to close, and it looks perfect in the
 * DOM.
 */

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import {
  ARTICLES,
  PASSWORD,
  REPO_ALPHA,
  REPO_BETA,
  USERS,
  grantRepo,
  makeSystemAdmin,
  resetFixture,
  seedContent,
  seedUsers,
} from "./seed";

const prisma = new PrismaClient();
let alphaId: string;

async function signUp(page: Page, email: string, accountId: string): Promise<void> {
  await page.goto("/signup");
  await page.fill('input[name="accountId"]', accountId);
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
  try {
    await page.waitForURL("**/repos", { timeout: 10_000 });
  } catch {
    // A sign-in that does not redirect has been REFUSED, and the page says why
    // in one deliberately uninformative sentence. Surfacing it turns a bare
    // navigation timeout into the actual reason.
    const alert = await page.getByRole("alert").textContent().catch(() => null);
    throw new Error(
      `sign-in as ${email} did not reach /repos. Page said: ${alert ?? "(no alert rendered)"}`,
    );
  }
}

test.beforeAll(async () => {
  await resetFixture(prisma);
  ({ alphaId } = await seedContent(prisma));
  await seedUsers(prisma);
  await grantRepo(prisma, USERS.readerEmail, alphaId, "Reader");
});

test.afterAll(async () => {
  await resetFixture(prisma);
  await prisma.$disconnect();
});

test.describe("signing up", () => {
  // Its own account, created and destroyed here. The first-admin rule is about
  // an account with NO users, so it cannot be asserted against the shared
  // fixture -- and asserting it there would also make every other test depend
  // on this one having run first.
  const OWN_ACCOUNT = "e2e-signup-account";
  const first = "first@e2e.invalid";
  const second = "second@e2e.invalid";

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { accountId: OWN_ACCOUNT } });
    await prisma.account.deleteMany({ where: { id: OWN_ACCOUNT } });
    await prisma.account.create({ data: { id: OWN_ACCOUNT, name: "Signup" } });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { accountId: OWN_ACCOUNT } });
    await prisma.account.deleteMany({ where: { id: OWN_ACCOUNT } });
  });

  test("the first person to join becomes the admin, and nobody after does", async ({ page }) => {
    await signUp(page, first, OWN_ACCOUNT);
    await page.context().clearCookies();
    await signUp(page, second, OWN_ACCOUNT);

    expect((await prisma.user.findFirstOrThrow({ where: { email: first } })).role).toBe(
      "AccountAdmin",
    );
    expect((await prisma.user.findFirstOrThrow({ where: { email: second } })).role).toBe("Reader");

    // The rule the database arbitrates, seen from outside it.
    expect(
      await prisma.user.count({ where: { accountId: OWN_ACCOUNT, role: "AccountAdmin" } }),
    ).toBe(1);
  });
});

test.describe("a reader granted one repository, mapped to one source role", () => {
  test("sees exactly the mapped article — not more, not fewer", async ({ page }) => {
    await signIn(page, USERS.readerEmail);
    await page.goto(`/repos/${alphaId}`);

    await expect(page.getByRole("link", { name: ARTICLES.visible.title })).toBeVisible();
    await expect(page.getByRole("link", { name: ARTICLES.unmapped.title })).toHaveCount(0);
    await expect(page.getByRole("link", { name: ARTICLES.unclassified.title })).toHaveCount(0);
  });

  test("is told how many articles THEY may open, not how many the repository holds", async ({
    page,
  }) => {
    // Alpha holds three; this reader is mapped to one. The list used to print
    // the repository's total, which is the only number on that page that had
    // not been through the viewer — so it announced that two more existed.
    //
    // Milder than the leaks the assertions above prevent, because it is a
    // quantity rather than a title. Asserted anyway: the empty state next door
    // refuses to say "0 of 3 repositories" for exactly this reason, and a count
    // beside a name is the same sentence with the noun changed.
    await signIn(page, USERS.readerEmail);

    await expect(page.getByRole("link", { name: REPO_ALPHA })).toBeVisible();
    await expect(page.getByText("(1 articles)")).toBeVisible();
    await expect(page.getByText("(3 articles)")).toHaveCount(0);
  });

  /**
   * The reason this file exists.
   *
   * Reads the RESPONSE, not the DOM. Filtering happens on the server; if it
   * ever moves client-side, the page still looks correct and every DOM
   * assertion above still passes, while the withheld titles ride along in the
   * payload where a network tab recovers them.
   */
  test("the response body carries no trace of a withheld article", async ({ page }) => {
    await signIn(page, USERS.readerEmail);

    const response = await page.request.get(`/repos/${alphaId}`);
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).toContain(ARTICLES.visible.title);

    for (const withheld of [ARTICLES.unmapped, ARTICLES.unclassified]) {
      expect(html).not.toContain(withheld.title);
      expect(html).not.toContain(withheld.slug);
      expect(html).not.toContain(`summary of ${withheld.slug}`);
      expect(html).not.toContain(`The body of ${withheld.slug}`);
    }
  });

  test("cannot open a withheld article by guessing its URL", async ({ page }) => {
    await signIn(page, USERS.readerEmail);

    const granted = await page.request.get(`/repos/${alphaId}/${ARTICLES.visible.slug}`);
    expect(granted.status()).toBe(200);

    for (const withheld of [ARTICLES.unmapped, ARTICLES.unclassified]) {
      const response = await page.request.get(`/repos/${alphaId}/${withheld.slug}`);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(withheld.title);
    }
  });

  test("a grant in one repository does not carry into another with the same mapping", async ({
    page,
  }) => {
    // Beta maps Reader -> Support exactly as Alpha does. The reader was never
    // granted Beta, and a mapping alone must not be enough.
    await signIn(page, USERS.readerEmail);
    const beta = await prisma.repo.findFirstOrThrow({ where: { name: REPO_BETA } });

    const list = await page.request.get(`/repos/${beta.id}`);
    expect(list.status()).toBe(404);

    const article = await page.request.get(`/repos/${beta.id}/${ARTICLES.otherRepo.slug}`);
    expect(article.status()).toBe(404);

    await page.goto("/repos");
    await expect(page.getByRole("link", { name: REPO_BETA })).toHaveCount(0);
    await expect(page.getByRole("link", { name: REPO_ALPHA })).toBeVisible();
  });
});

test.describe("someone granted nothing", () => {
  test("is told nothing about what exists", async ({ page }) => {
    await signIn(page, USERS.strangerEmail);

    const html = await (await page.request.get("/repos")).text();

    // Not "0 of 2 repositories" — that would disclose that two exist.
    expect(html).not.toContain(REPO_ALPHA);
    expect(html).not.toContain(REPO_BETA);
    expect(html).toContain("nothing here for you to read");
  });

  test("cannot reach a repository by guessing its id", async ({ page }) => {
    await signIn(page, USERS.strangerEmail);
    const response = await page.request.get(`/repos/${alphaId}`);
    // 404, not 403: "you may not see this" still confirms it exists.
    expect(response.status()).toBe(404);
  });
});

test.describe("an article that declares no roles", () => {
  test("reaches the operator, and says loudly that it is unfinished", async ({ page }) => {
    await makeSystemAdmin(prisma, USERS.adminEmail);
    await signIn(page, USERS.adminEmail);

    await page.goto(`/repos/${alphaId}/${ARTICLES.unclassified.slug}`);
    // Targeted rather than `getByRole("alert")`, which matched two elements —
    // a locator that is ambiguous today is one that silently starts asserting
    // about the wrong element tomorrow.
    const badge = page.getByTestId("missing-roles");
    await expect(badge).toContainText("declares no roles");
    // Named as incomplete rather than as exclusive: its problem is that nobody
    // finished it, not that it is secret.
    await expect(badge).toContainText("incomplete");
  });

  test("still reaches nobody else, even with the repository granted", async ({ page }) => {
    await signIn(page, USERS.readerEmail);
    const response = await page.request.get(`/repos/${alphaId}/${ARTICLES.unclassified.slug}`);
    expect(response.status()).toBe(404);
  });
});

test.describe("signing in", () => {
  test("says the same thing for a wrong password and an unknown address", async ({ page }) => {
    // Two different messages answer "is this person registered here" to anyone
    // who asks.
    await page.goto("/login");
    await page.fill('input[name="email"]', USERS.readerEmail);
    await page.fill('input[name="password"]', "not-the-right-password");
    await page.click('button[type="submit"]');
    const wrongPassword = await page.getByRole("alert").textContent();

    await page.goto("/login");
    await page.fill('input[name="email"]', "nobody-has-this-address@e2e.invalid");
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    const unknownUser = await page.getByRole("alert").textContent();

    expect(wrongPassword).toBe(unknownUser);
    expect(wrongPassword).not.toMatch(/password|email|registered|exist/i);
  });

  test("keeps a signed-out visitor away from every article page", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/repos/${alphaId}/${ARTICLES.visible.slug}`);
    await page.waitForURL("**/login");
  });
});
