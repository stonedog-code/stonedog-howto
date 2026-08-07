import { existsSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { globSync } from "tinyglobby";

import pandaConfig from "../../panda.config";

import { renderArticle } from "../render/renderArticle";
import { stonedogArticleComponents } from "../styled/articleComponents";
import { extractToc } from "../toc";

// Globs in panda.config.ts are written relative to the repository root, which is
// where `panda codegen` runs. Jest's `rootDir` is that same directory, so cwd is
// the right base — and it is what the `existsSync` assertions below already
// assume. Not `__dirname`: this suite runs as ESM (jest.config.cjs sets
// `useESM`), where `__dirname` is not defined at all.
const ROOT = process.cwd();

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
  //
  // The globs are READ FROM panda.config.ts rather than restated here. An
  // earlier version hardcoded the paths, which made it a test of the filesystem
  // and not of the config: renaming the package in panda.config alone would
  // leave this passing while Panda parsed nothing. The two can only drift if
  // they are written twice, so they are written once.
  const includes: string[] = pandaConfig.include ?? [];

  it("reads a non-empty include list from panda.config.ts", () => {
    // Guards the guard. If the import ever yields `undefined` — a moved file, a
    // changed export shape — every assertion below iterates an empty array and
    // passes, and this suite goes quietly vacuous.
    expect(includes.length).toBeGreaterThanOrEqual(2);
  });

  // The `node_modules` entries are held out and asserted as a PAIR below. Two
  // locations are listed deliberately, because npm workspaces hoist and which
  // one exists depends on the consuming tree — so either may legitimately match
  // nothing. Running them through this case with an early `return` would print
  // a passing test named after a glob it never checked, which is a worse lie
  // than not listing it.
  it.each(includes.filter((g) => !g.includes("node_modules")))(
    "matches at least one file: %s",
    (glob) => {
      expect(globSync(glob, { cwd: ROOT }).length).toBeGreaterThan(0);
    },
  );

  it("finds @stonedogcode/style's source in one of the two node_modules spots", () => {
    // npm nests a SCOPED package one directory deeper —
    // node_modules/@stonedogcode/style, not node_modules/stonedog-style — so
    // this path moved when the package moved (NEH-482). Getting it wrong emits
    // no error at all.
    const nodeModuleGlobs = includes.filter((g) => g.includes("node_modules"));
    expect(nodeModuleGlobs.length).toBeGreaterThan(0);

    const matched = nodeModuleGlobs.flatMap((g) => globSync(g, { cwd: ROOT }));
    expect(matched.length).toBeGreaterThan(0);
  });

  it("finds this package's own generated styled-system", () => {
    expect(existsSync("styled-system/css")).toBe(true);
  });
});
