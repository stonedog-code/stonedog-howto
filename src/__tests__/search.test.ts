import { roleSetViewer, seesEverything } from "../access.js";
import { buildSearchIndex, search } from "../search.js";
import type { Article } from "../types.js";

const article = (
  slug: string,
  title: string,
  body: string,
  extra: { summary?: string; roles?: string[] } = {},
): Article => ({
  meta: {
    title,
    slug,
    section: "s",
    order: 0,
    ...(extra.summary !== undefined ? { summary: extra.summary } : {}),
    ...(extra.roles !== undefined ? { roles: extra.roles } : {}),
  },
  body,
});

const articles = [
  article("sharing", "Sharing", "## Share a link\n\nA link exposes the whole collection."),
  article("notes", "Notes", "## Writing notes\n\nNotes support comments and sharing.", {
    summary: "Keeping notes on a customer.",
  }),
  article("access-reviews", "Access Reviews", "## Quarterly review\n\nReview every account.", {
    roles: ["Owner"],
  }),
];

const index = buildSearchIndex(articles);

describe("search", () => {
  it("returns nothing for an empty query", () => {
    expect(search(index, "   ", seesEverything)).toEqual([]);
  });

  it("ranks a title match above a body match", () => {
    const results = search(index, "sharing", seesEverything);
    expect(results.map((r) => r.article.meta.slug)).toEqual(["sharing", "notes"]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("requires every query word to appear, so a second word narrows", () => {
    expect(search(index, "link", seesEverything).map((r) => r.article.meta.slug)).toEqual([
      "sharing",
    ]);
    expect(search(index, "link unrelated", seesEverything)).toEqual([]);
  });

  it("matches the summary", () => {
    expect(search(index, "customer", seesEverything).map((r) => r.article.meta.slug)).toEqual([
      "notes",
    ]);
  });

  it("reports which headings matched, for deep links into the article", () => {
    const results = search(index, "review", seesEverything);
    expect(results[0]?.matchedHeadings).toEqual([
      { id: "quarterly-review", text: "Quarterly review", depth: 2 },
    ]);
  });

  it("never surfaces an article the reader may not open", () => {
    // Filtering after matching would still leak the article's existence through
    // the result count, the ranking, and the title in the list.
    const viewer = roleSetViewer({ roles: [] });
    const results = search(index, "review", viewer);
    expect(results).toEqual([]);
  });

  it("still finds that article for a reader who holds the role", () => {
    const viewer = roleSetViewer({ roles: ["Owner"] });
    expect(search(index, "review", viewer).map((r) => r.article.meta.slug)).toEqual([
      "access-reviews",
    ]);
  });

  it("breaks ties on title so repeated identical queries do not reshuffle", () => {
    const tied = buildSearchIndex([
      article("zebra", "Zebra", "shared word"),
      article("apple", "Apple", "shared word"),
    ]);
    expect(search(tied, "shared", seesEverything).map((r) => r.article.meta.title)).toEqual([
      "Apple",
      "Zebra",
    ]);
  });

  it("honours a result limit", () => {
    expect(search(index, "sharing", seesEverything, { limit: 1 })).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    expect(search(index, "SHARING", seesEverything).length).toBeGreaterThan(0);
  });
});
