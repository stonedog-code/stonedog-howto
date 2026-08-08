import { renderToStaticMarkup } from "react-dom/server";

import { roleSetViewer } from "../access";
import { ArticleToc } from "../components/ArticleToc";
import { HowToArticle } from "../components/HowToArticle";
import { HowToNav } from "../components/HowToNav";
import { HowToSearch } from "../components/HowToSearch";
import { buildManifest } from "../manifest";
import { filterManifest } from "../access";
import { buildSearchIndex, search } from "../search";
import type { Article, HowToConfig } from "../types";

const article = (
  slug: string,
  title: string,
  section: string,
  body: string,
  roles?: string[],
): Article => ({
  meta: {
    title,
    slug,
    section,
    order: 0,
    ...(roles !== undefined ? { roles } : {}),
  },
  body,
});

const config: HowToConfig = {
  sections: [
    { id: "basics", title: "Basics" },
    { id: "admin", title: "Administration", children: [{ id: "security", title: "Security" }] },
  ],
};

const articles = [
  article("welcome", "Welcome", "basics", "## Start here\n\nProse.\n\n## Next\n\nMore.", [
    "Reader",
  ]),
  article("audit", "Audit log", "security", "## Reading the log\n\nProse.", ["Owner"]),
];

const hrefFor = (a: Article) => `/how-to/${a.meta.slug}`;

describe("ArticleToc", () => {
  it("links each entry to its anchor", () => {
    const out = renderToStaticMarkup(
      <ArticleToc
        entries={[
          { id: "start-here", text: "Start here", depth: 2 },
          { id: "next", text: "Next", depth: 2 },
        ]}
      />,
    );

    expect(out).toContain('href="#start-here"');
    expect(out).toContain("Start here");
    expect(out).toContain('aria-label="On this page"');
  });

  it("renders nothing at all when there are no entries", () => {
    // Not an empty <nav>: that is a landmark a screen reader announces and then
    // has nothing to say about.
    expect(renderToStaticMarkup(<ArticleToc entries={[]} />)).toBe("");
  });

  it("expresses depth relative to the shallowest heading present", () => {
    const out = renderToStaticMarkup(
      <ArticleToc
        entries={[
          { id: "a", text: "A", depth: 2 },
          { id: "b", text: "B", depth: 3 },
        ]}
      />,
    );

    expect(out).toContain('data-depth="0"');
    expect(out).toContain('data-depth="1"');
  });
});

describe("HowToArticle", () => {
  it("renders the title, the contents, and the body", () => {
    const out = renderToStaticMarkup(<HowToArticle article={articles[0]!} />);

    expect(out).toContain("<h1>Welcome</h1>");
    expect(out).toContain('href="#start-here"');
    expect(out).toContain('id="start-here"');
  });

  it("omits the contents for an article with only one heading", () => {
    const out = renderToStaticMarkup(<HowToArticle article={articles[1]!} />);
    expect(out).toContain("<h1>Audit log</h1>");
    expect(out).not.toContain("howto-article-toc");
  });
});

describe("HowToNav", () => {
  const manifest = buildManifest(articles, config);

  it("renders the sections and their articles", () => {
    const out = renderToStaticMarkup(<HowToNav manifest={manifest} hrefFor={hrefFor} />);

    expect(out).toContain("Basics");
    expect(out).toContain('href="/how-to/welcome"');
    expect(out).toContain("Security");
    expect(out).toContain('href="/how-to/audit"');
  });

  it("marks the active article as the current page", () => {
    const out = renderToStaticMarkup(
      <HowToNav manifest={manifest} hrefFor={hrefFor} activeSlug="welcome" />,
    );
    expect(out).toContain('aria-current="page"');
  });

  it("shows nothing a filtered manifest has removed", () => {
    // The component has no viewer by design — it renders what it is handed. This
    // asserts the composition a host is meant to use: filter on the server, then
    // render. A restricted article must be absent from the markup entirely, not
    // merely hidden.
    const filtered = filterManifest(manifest, roleSetViewer({ roles: ["Reader"] }));
    const out = renderToStaticMarkup(<HowToNav manifest={filtered} hrefFor={hrefFor} />);

    expect(out).toContain("Welcome");
    expect(out).not.toContain("Audit log");
    expect(out).not.toContain("Security");
  });
});

describe("HowToSearch", () => {
  const index = buildSearchIndex(articles);
  const noop = () => undefined;

  it("shows nothing but the box for an empty query", () => {
    const out = renderToStaticMarkup(
      <HowToSearch value="" onChange={noop} results={[]} hrefFor={hrefFor} />,
    );

    expect(out).toContain("howto-search-input");
    expect(out).not.toContain("howto-search-results");
    expect(out).not.toContain("howto-search-empty");
  });

  it("lists results and deep-links the headings that matched", () => {
    const results = search(index, "start", roleSetViewer({ roles: ["Reader"] }));
    const out = renderToStaticMarkup(
      <HowToSearch value="start" onChange={noop} results={results} hrefFor={hrefFor} />,
    );

    expect(out).toContain('href="/how-to/welcome"');
    expect(out).toContain('href="/how-to/welcome#start-here"');
  });

  it("says only that nothing matched, never why", () => {
    // "No articles match" is complete. Anything about indexes, roles or
    // permissions would tell a reader that something exists they cannot see.
    const results = search(index, "reading", roleSetViewer({ roles: ["Reader"] }));
    const out = renderToStaticMarkup(
      <HowToSearch value="reading" onChange={noop} results={results} hrefFor={hrefFor} />,
    );

    expect(out).toContain("howto-search-empty");
    expect(out).not.toMatch(/role|permission|denied|restricted/i);
  });

  it("finds the restricted article for a reader who holds the role", () => {
    const results = search(index, "reading", roleSetViewer({ roles: ["Reader", "Owner"] }));
    const out = renderToStaticMarkup(
      <HowToSearch value="reading" onChange={noop} results={results} hrefFor={hrefFor} />,
    );

    expect(out).toContain('href="/how-to/audit"');
  });
});
