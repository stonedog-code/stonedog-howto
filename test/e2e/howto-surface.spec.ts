import { test, expect, type Page } from "@playwright/test";

/**
 * NEH-440 — the E2E tier.
 *
 * The three assertions here are the ones this issue named, and each is chosen
 * because no lower tier can reach it. The unit and integration tiers already
 * assert what `buildManifest` and `buildPayload` RETURN; this tier is the only
 * one that can say what a reader actually sees.
 *
 * The demo is the surface under test. That is deliberate rather than a
 * compromise: it is the worked example consumers copy from, and the README
 * points at it as the way to check the package's central promise.
 */

/** Pick who the demo is impersonating. The switcher is a radio group. */
async function impersonate(page: Page, viewer: "guest" | "user" | "admin"): Promise<void> {
  await page.locator(`input[name="viewer"][value="${viewer}"]`).check();
  // The payload is refetched on change; wait for the article list to settle
  // rather than sleeping. `howto-nav` is the article list — `howto-article-toc`
  // is the heading TOC WITHIN one article, which is a different thing and is
  // absent entirely when a viewer can read nothing.
  await expect(page.getByTestId("howto-nav")).toBeVisible();
}

test.describe("the how-to surface (NEH-440)", () => {
  test("a table-of-contents link actually moves the page", async ({ page }) => {
    await page.goto("/");
    await impersonate(page, "admin");

    const toc = page.getByTestId("howto-article-toc");
    await expect(toc).toBeVisible();

    // Take the LAST entry, so a working anchor has somewhere to scroll to. The
    // first one is often already at the top, where a broken anchor and a
    // working one look identical.
    const link = toc.getByRole("link").last();
    const href = await link.getAttribute("href");
    expect(href, "TOC entries must be real anchors").toMatch(/^#/);

    // The defect this catches: the anchor ids are produced by one pass and
    // consumed by another. When they disagree the link renders, is clickable,
    // and does nothing at all — no error anywhere.
    const targetId = href!.slice(1);
    // NOT `#${CSS.escape(id)}` — CSS.escape is a browser global and this code
    // runs in Node, where it is undefined. An attribute selector sidesteps
    // escaping entirely.
    const target = page.locator(`[id="${targetId}"]`);
    await expect(
      target,
      `TOC links to #${targetId}, but no element has that id — the TOC pass and the render pass disagree`,
    ).toHaveCount(1);

    const before = await page.evaluate(() => window.scrollY);
    await link.click();
    // Let the scroll settle; smooth scrolling is not instant.
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.scrollY);

    // Guard against a vacuous pass: if the whole document fits the viewport
    // there is nothing to scroll and this assertion would prove nothing.
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 10,
    );
    test.skip(!scrollable, "document fits the viewport — no scrolling possible to observe");

    expect(after, "clicking a TOC link did not move the page").toBeGreaterThan(before);
  });

  test("search filters what is on screen", async ({ page }) => {
    await page.goto("/");
    await impersonate(page, "admin");

    const results = page.getByTestId("howto-search-results");
    const input = page.getByTestId("howto-search-input");

    await input.fill("invoices");
    await expect(results.getByRole("link", { name: /invoice/i }).first()).toBeVisible();

    // A term that matches nothing must produce the empty state, not silently
    // leave the previous results on screen — which is what a filter that runs
    // on stale data looks like.
    await input.fill("zzzz-no-article-matches-this");
    await expect(page.getByTestId("howto-search-empty")).toBeVisible();
  });

  test("a reader without the role sees neither the article nor its title", async ({ page }) => {
    await page.goto("/");

    // `administration/billing/invoices.md` declares roles: [Admin].
    // The Guest holds only ["Guest"].
    await impersonate(page, "admin");
    await expect(
      page.getByTestId("howto-nav").getByRole("link", { name: /invoice/i }),
      "precondition: an Admin can see the Admin-only article",
    ).toHaveCount(1);

    await impersonate(page, "guest");

    // Not in the navigation...
    await expect(
      page.getByTestId("howto-nav").getByRole("link", { name: /invoice/i }),
      "a Guest must not see the Admin-only article in the nav",
    ).toHaveCount(0);

    // ...and its TITLE must not be anywhere in the page either. Withholding the
    // body while leaking the title is the exact half-measure this package's
    // access model exists to prevent, and it is invisible to a test that only
    // checks the nav.
    await expect(
      page.locator("body"),
      "the withheld article's title leaked into the page",
    ).not.toContainText("Invoices", { ignoreCase: true });

    // Search must not become a back door to the same title.
    await page.getByTestId("howto-search-input").fill("invoices");
    await expect(page.getByTestId("howto-search-empty")).toBeVisible();
  });
});
