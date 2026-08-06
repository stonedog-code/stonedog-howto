import { renderToStaticMarkup } from "react-dom/server";

import { renderArticle } from "../render/renderArticle.js";
import { extractHeadings, extractToc } from "../toc.js";

const html = (markdown: string, components?: Parameters<typeof renderArticle>[1]) =>
  renderToStaticMarkup(renderArticle(markdown, components));

describe("renderArticle", () => {
  it("renders the common documentation blocks", () => {
    const out = html(
      [
        "## Setting up",
        "",
        "Some **bold** prose with `code` and a [link](/docs).",
        "",
        "- first",
        "- second",
        "",
        "> A note.",
        "",
        "```bash",
        "npm install",
        "```",
      ].join("\n"),
    );

    expect(out).toContain("<h2");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain('href="/docs"');
    expect(out).toContain("<li>first</li>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("npm install");
  });

  it("renders GFM tables", () => {
    const out = html(["| Field | Meaning |", "| --- | --- |", "| slug | The URL |"].join("\n"));
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Field</th>");
    expect(out).toContain("<td>slug</td>");
  });

  it("drops raw HTML rather than rendering it", () => {
    // Articles are documentation. A pipeline that renders whatever markup an
    // author pastes in is a script-injection route with an authoring interface
    // in front of it, so remark-rehype is left without allowDangerousHtml.
    const out = html('Before <img src="x" onerror="alert(1)"> after.');

    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
    expect(out).toContain("Before");
    expect(out).toContain("after.");
  });

  it("substitutes host components by tag name", () => {
    const out = html("## Heading\n\nProse.", {
      components: {
        h2: ({ children, ...rest }) => <h2 {...rest} className="host-heading">{children}</h2>,
      },
    });

    expect(out).toContain('class="host-heading"');
  });

  it("keeps the heading id when a host substitutes the heading component", () => {
    // The id arrives as a prop from rehype-slug. A substituted component that
    // forgets to spread its props silently drops every anchor target, so the
    // package's own contract is that the id is passed through — worth pinning,
    // because the symptom is a table of contents that simply does nothing.
    const out = html("## Setting up\n\nProse.", {
      components: {
        h2: ({ children, ...rest }) => <h2 {...rest}>{children}</h2>,
      },
    });

    expect(out).toContain('id="setting-up"');
  });
});

describe("anchor ids agree with the table of contents", () => {
  // This is the defect the whole design guards against, and it fails silently:
  // the id in the rendered heading and the id in the TOC entry are produced by
  // two separate passes. If they disagree the link is still live and still
  // clickable — the page just does not move, with nothing logged anywhere.
  const article = [
    "# Title",
    "",
    "## Setting up",
    "",
    "## Rules & exceptions",
    "",
    "## Setting up",
    "",
    "### A *nested* heading",
  ].join("\n");

  it("emits an element for every id extractToc produced", () => {
    const out = html(article);
    const entries = extractToc(article);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(out).toContain(`id="${entry.id}"`);
    }
  });

  it("agrees on the duplicate-heading suffixes", () => {
    const ids = extractHeadings(article).map((h) => h.id);
    expect(ids).toContain("setting-up");
    expect(ids).toContain("setting-up-1");

    const out = html(article);
    expect(out).toContain('id="setting-up"');
    expect(out).toContain('id="setting-up-1"');
  });

  it("agrees on headings containing punctuation and inline markup", () => {
    const out = html(article);
    const entries = extractHeadings(article);

    const ampersand = entries.find((e) => e.text === "Rules & exceptions");
    expect(ampersand).toBeDefined();
    expect(out).toContain(`id="${ampersand!.id}"`);

    const nested = entries.find((e) => e.text === "A nested heading");
    expect(nested).toBeDefined();
    expect(out).toContain(`id="${nested!.id}"`);
  });
});
