import GithubSlugger from "github-slugger";

import { extractHeadings, extractPlainText, extractToc } from "../toc";

describe("extractHeadings", () => {
  it("returns every heading with its depth and anchor id", () => {
    const headings = extractHeadings(
      ["# Title", "", "## First section", "", "### A detail", "", "## Second section"].join("\n"),
    );

    expect(headings).toEqual([
      { id: "title", text: "Title", depth: 1 },
      { id: "first-section", text: "First section", depth: 2 },
      { id: "a-detail", text: "A detail", depth: 3 },
      { id: "second-section", text: "Second section", depth: 2 },
    ]);
  });

  it("flattens inline markup out of the heading text", () => {
    const headings = extractHeadings("## Use `roleSetViewer` for **simple** cases");
    expect(headings[0]?.text).toBe("Use roleSetViewer for simple cases");
  });

  it("ignores a # inside a fenced code block", () => {
    const headings = extractHeadings(
      ["## Real heading", "", "```bash", "# not a heading, a shell comment", "```"].join("\n"),
    );
    expect(headings.map((h) => h.text)).toEqual(["Real heading"]);
  });

  it("disambiguates repeated headings exactly as rehype-slug does", () => {
    // The ids here are computed in a different pass from the one that renders
    // the headings. If the two ever disagree, every table-of-contents link
    // becomes a dead anchor — and nothing fails, the page just does not move.
    // Pinning against a fresh github-slugger is what keeps the two in step,
    // since rehype-slug uses this same slugger and its duplicate counter.
    const markdown = ["## Setup", "", "## Setup", "", "## Setup"].join("\n");

    const slugger = new GithubSlugger();
    const expected = ["Setup", "Setup", "Setup"].map((text) => slugger.slug(text));

    expect(extractHeadings(markdown).map((h) => h.id)).toEqual(expected);
    expect(expected).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("starts the duplicate counter fresh for each document", () => {
    const first = extractHeadings("## Setup");
    const second = extractHeadings("## Setup");
    expect(first[0]?.id).toBe("setup");
    expect(second[0]?.id).toBe("setup");
  });
});

describe("extractToc", () => {
  const article = [
    "# Article title",
    "",
    "## One",
    "",
    "### One point one",
    "",
    "#### Too deep",
    "",
    "## Two",
  ].join("\n");

  it("covers h2 and h3 by default, excluding the h1 title and deeper headings", () => {
    expect(extractToc(article).map((h) => h.text)).toEqual([
      "One",
      "One point one",
      "Two",
    ]);
  });

  it("honours an explicit depth range", () => {
    expect(extractToc(article, { minDepth: 2, maxDepth: 2 }).map((h) => h.text)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("returns nothing when there is only one eligible heading", () => {
    // A one-entry table of contents saves no reader a scroll and costs everyone
    // the space above the first paragraph.
    expect(extractToc("# Title\n\n## Only section\n\nProse.")).toEqual([]);
  });

  it("returns nothing for an article with no headings", () => {
    expect(extractToc("Just prose, no headings at all.")).toEqual([]);
  });
});

describe("extractPlainText", () => {
  it("flattens prose and drops markdown syntax", () => {
    const text = extractPlainText(
      ["## Sharing", "", "A link **exposes** the whole [collection](/c/1)."].join("\n"),
    );
    expect(text).toBe("Sharing A link exposes the whole collection .");
  });

  it("drops code blocks so a sample payload cannot rank an article", () => {
    const text = extractPlainText(
      ["## Setup", "", "```json", '{ "secret": "passkey" }', "```", "", "Real prose."].join("\n"),
    );
    expect(text).toBe("Setup Real prose.");
    expect(text).not.toContain("passkey");
  });
});
