import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { renderArticle } from "../render/renderArticle.js";
import { stonedogArticleComponents } from "../styled/articleComponents.js";
import { extractToc } from "../toc.js";

const html = (markdown: string) =>
  renderToStaticMarkup(renderArticle(markdown, { components: stonedogArticleComponents }));

describe("stonedogArticleComponents", () => {
  it("keeps every heading anchor the table of contents points at", () => {
    // The critical assertion for this map. Each heading is rendered through a
    // design-system component, and if any of them fails to pass `id` through,
    // every table-of-contents link in the article dies at once — silently, since
    // the link stays live and the page simply does not move. Testing the bare
    // spread elsewhere does not cover this: the failure would be inside
    // StyledHeading, not in the map.
    const article = [
      "## Setting up",
      "",
      "Prose.",
      "",
      "### A detail",
      "",
      "Prose.",
      "",
      "## Setting up",
      "",
      "Prose.",
    ].join("\n");

    const out = html(article);
    const entries = extractToc(article);

    expect(entries.length).toBeGreaterThan(2);
    for (const entry of entries) {
      expect(out).toContain(`id="${entry.id}"`);
    }
  });

  it("renders each block element through the map", () => {
    const out = html(
      [
        "## Heading",
        "",
        "A paragraph with `code` and a [link](/docs).",
        "",
        "- item",
        "",
        "> quote",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    expect(out).toContain("<h2");
    expect(out).toContain("<code");
    expect(out).toContain('href="/docs"');
    expect(out).toContain("<ul");
    expect(out).toContain("<blockquote");
    expect(out).toContain("<table");
  });

  it("gives a wide table its own horizontal scroll container", () => {
    // Otherwise one wide table makes the whole page scroll sideways, breaking
    // every other paragraph on a narrow screen.
    const out = html(["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"));
    const beforeTable = out.slice(0, out.indexOf("<table"));
    expect(beforeTable).toContain("<div");
  });

  it("emits class names, not bare elements", () => {
    const out = html("## Heading\n\nProse.");
    expect(out).toMatch(/class="/);
  });
});

describe("the Panda include globs resolve to real files", () => {
  // A glob that matches nothing is silent: Panda parses no source, emits no
  // rules, and the components still render with the class names. The page is
  // simply unstyled, with a green build. So the globs are asserted rather than
  // assumed — this is the only place that failure has a symptom.
  it("finds stonedog-style's source where panda.config.ts looks for it", () => {
    const hoisted = existsSync("../../node_modules/stonedog-style/src/index.ts");
    const local = existsSync("node_modules/stonedog-style/src/index.ts");

    expect(hoisted || local).toBe(true);
  });

  it("finds this package's own generated styled-system", () => {
    expect(existsSync("styled-system/css")).toBe(true);
  });
});
