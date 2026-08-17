import { test, expect, type Page } from "@playwright/test";

/**
 * NEH-874 — every control this package renders must clear 48×48.
 *
 * The floor is the house standard, which is stricter than WCAG 2.5.5's 44×44.
 *
 * **This tier is the only one that can answer the question.** jsdom has no
 * layout engine: every element reports a zero-sized box, so a unit test agrees
 * just as readily that a 22 px link is 48 px tall as that it is not. Only a real
 * browser at a real viewport measures anything.
 *
 * ## The rule is DERIVED, not a list of testids
 *
 * WCAG exempts a link that flows inside a sentence, because shrinking the
 * surrounding prose to make it tappable would be worse than leaving it small.
 * The house rule states the same thing from the other side: **sole content of
 * its container → control; prose beside it in the same paragraph → text.**
 *
 * So an element here is a control when *either* of these holds:
 *
 *  - its computed `display` is not `inline` — an inline box is by definition one
 *    that flows with the text around it, and `min-height` does nothing to it; or
 *  - **its parent contains no text of its own.** There is no sentence for it to
 *    be inside, so the carve-out cannot apply however it is displayed.
 *
 * The second clause is what makes this a guard rather than a tautology. Before
 * the fix, the contents links and the search-result links were plain
 * `display: inline` anchors — under the display test alone they would have been
 * waved through at 22 px, which is the exact defect. An unstyled control is
 * still a control.
 *
 * Nothing here enumerates the five nav links the issue named. A control added to
 * this package next year is caught the day it is written, and an in-sentence
 * link inside an article body is exempt automatically — not because somebody
 * remembered to exempt it.
 *
 * ## The surface under test
 *
 * The demo, like the rest of this tier — it is the package's only browser
 * surface, and it dresses the components with plain CSS rather than the design
 * system, which is the harder case of the two. Only elements inside the
 * package's own containers are measured; the demo's own chrome is the demo's
 * business.
 */

const FLOOR = 48;

/** The containers the package itself renders. */
const SURFACES = [
  '[data-testid="howto-nav"]',
  '[data-testid="howto-search"]',
  '[data-testid="howto-article"]',
].join(", ");

interface MeasuredControl {
  surface: string;
  tag: string;
  display: string;
  label: string;
  width: number;
  height: number;
}

/** Pick who the demo is impersonating. The switcher is a radio group. */
async function impersonate(page: Page, viewer: "guest" | "user" | "admin"): Promise<void> {
  await page.locator(`input[name="viewer"][value="${viewer}"]`).check();
  await expect(page.getByTestId("howto-nav")).toBeVisible();
}

/**
 * Every visible interactive element in the package's surfaces that is NOT
 * flowing as inline text, with its measured box.
 */
async function measureControls(page: Page, surfaces: string): Promise<MeasuredControl[]> {
  return page.evaluate((surfaceSelector) => {
    const INTERACTIVE = "a[href], button, input, select, textarea, summary, [role='button']";
    const out: MeasuredControl[] = [];

    for (const surface of Array.from(document.querySelectorAll(surfaceSelector))) {
      const surfaceName = surface.getAttribute("data-testid") ?? surface.tagName.toLowerCase();

      for (const el of Array.from(surface.querySelectorAll(INTERACTIVE))) {
        const style = window.getComputedStyle(el);
        // A hidden element has no tap target to be too small.
        if (style.display === "none" || style.visibility === "hidden") continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        // Does the parent hold any prose of its own for this element to sit
        // inside? Only DIRECT text nodes count — text in a sibling paragraph is
        // not a sentence this element is part of.
        const parent = el.parentElement;
        const parentHasProse = parent
          ? Array.from(parent.childNodes).some(
              (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
            )
          : false;

        // The carve-out, and the whole reason this guard needs no exemption
        // list: an inline box flowing inside a sentence.
        if (style.display === "inline" && parentHasProse) continue;

        const label =
          el.getAttribute("data-testid") ??
          el.getAttribute("aria-label") ??
          el.textContent ??
          "";

        out.push({
          surface: surfaceName,
          tag: el.tagName.toLowerCase(),
          display: style.display,
          label: label.trim().slice(0, 40) || "(unlabelled)",
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }

    return out;
  }, surfaces);
}

function describe(control: MeasuredControl): string {
  return `${control.surface} › <${control.tag} display:${control.display}> “${control.label}” — ${control.width}×${control.height}`;
}

// Both a phone and a desktop. A floor met only because a wide sidebar happens to
// stretch the row is not a floor, and a phone is where a tap target matters
// most.
const VIEWPORTS = [
  { name: "mobile 375x812", width: 375, height: 812 },
  { name: "desktop 1280x900", width: 1280, height: 900 },
] as const;

test.describe("tap targets clear the 48px floor (NEH-874)", () => {
  for (const viewport of VIEWPORTS) {
    test(`every control is at least ${FLOOR}x${FLOOR} at ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await impersonate(page, "admin");

      // Type a query so the search results — themselves controls — are on
      // screen. A guard that only ever sees the empty state never measures them.
      await page.getByTestId("howto-search-input").fill("a");
      await expect(page.getByTestId("howto-search-results")).toBeVisible();

      const controls = await measureControls(page, SURFACES);

      // A guard that measures nothing passes silently. The nav alone renders
      // more than five links, so this bound is well under reality — it is here
      // to catch a selector that stopped matching, not to assert a count.
      expect(
        controls.length,
        "no controls were measured — the sweep found nothing",
      ).toBeGreaterThan(5);

      // The measurements travel with the run, so a report says what the boxes
      // actually were rather than only which ones failed.
      await testInfo.attach(`measured-controls-${viewport.name}.txt`, {
        body: controls.map(describe).join("\n"),
        contentType: "text/plain",
      });

      const tooSmall = controls.filter((c) => c.width < FLOOR || c.height < FLOOR);

      expect(
        tooSmall.map(describe),
        `controls below the ${FLOOR}x${FLOOR} floor at ${viewport.name}`,
      ).toEqual([]);
    });
  }

  test("a link inside article prose is exempt, and still flows with the text", async ({ page }) => {
    await page.goto("/");
    await impersonate(page, "admin");

    // The other direction of the guard. If everything in this package were
    // forced to a control box, prose links would be dragged out of their
    // sentences — a worse outcome than a small target, and exactly what the
    // WCAG carve-out exists to prevent. Asserting it here keeps the exemption
    // above honest rather than letting it become dead code nobody exercises.
    const proseLink = page.getByTestId("howto-article-body").locator("p a[href]").first();

    await expect(
      proseLink,
      "the demo articles must contain at least one prose link",
    ).toHaveCount(1);

    const display = await proseLink.evaluate((el) => window.getComputedStyle(el).display);
    expect(display, "a link inside a paragraph must keep flowing with the text").toBe("inline");
  });
});
